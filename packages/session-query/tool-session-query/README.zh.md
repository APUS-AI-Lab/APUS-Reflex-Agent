---
description: "面向 agent（智能体）开发者与维护者、经工作区授权且面向模型的会话历史工具，用于选择、配置或排查既往会话搜索、追踪与事件读取。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-session-query

[English](README.md) | 中文

## 概述

使用 `dsh-tool-session-query` 让模型搜索早期会话、查看事件命中、追踪关系，并通过有界分页读取精确事件数据。五个只读工具仅在目标与调用方的 `cwd` 完全相同时授权跨会话访问；没有 `cwd` 的调用方只能读取自身。搜索排除调用会话，达到部署结果上限后请模型缩小查询。本包按需启用，会为每次模型请求增加固定指导和五个工具 schema。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当 agent 应该能搜索自己的既往会话并检查其关系与事件时挂载本包。常用路径是显式的：在 `ctx.sessionQuery`（由 `dsh-session-query-sqlite` 支撑）之上挂载插件，然后让模型调用这些工具。

### 何时选择

当部署需要模型驱动的既往工作检索时选择它——例如 coding agent（编程智能体）在开始任务前搜索更早会话中做过的事。只需要程序化检索时避免使用：`ctx.sessionQuery` 本身服务代码调用方，无需面向模型的 schema、提示词与授权层。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `maxSearchResults` | `100` | 一次搜索调用返回的最大已授权命中数 |
| `searchTimeoutMs` | `30000` | 附加到两个全文搜索工具的协作式截止时间 |
| `maxReadBytes` | `8192` | 完整事件读取输出的 UTF-8 字节预算，至少 `256` |

生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-tool-session-query)是每个受支持字段及其 JSDoc 的穷尽式真源。

### 模型可以做什么

| 工具 | 模型得到什么 |
|---|---|
| `session_search` | 匹配字面查询的会话，经排序，带标题与最佳匹配摘录；始终省略调用方会话 |
| `session_event_search` | 一个已授权会话内匹配字面查询的事件；针对当前会话时，在调用它的步骤之前停止 |
| `session_trace` | 一个会话的已授权祖先链与后代树；未授权边界以不含隐藏 id 的标记出现 |
| `session_event_trace` | 一个事件的位置替换与被引用源事件关系 |
| `session_event_read` | 预算内返回完整事件 JSON 与可选邻接摘要；否则返回带续读偏移和事件摘要的有界精确页 |

工作区授权是保守的：跨会话访问要求目标与调用方会话的 `cwd` 严格相等，没有 `cwd` 的调用方只能检查自己。请求的父 id 会在搜索前去重并按权限检查；缺失与跨工作区猜测行为完全相同。搜索结果无游标：结果达到上限时请模型缩小查询，绝不暴露提供方游标、偏移、分页大小或模型可控上限。工具边界的时间戳是带时区限定的 ISO 8601，并转换为包含端点的 epoch 毫秒过滤器。

显式 `view: event-json` 返回 `JSON.stringify(event, null, 2)` 的分页，不是底层 JSONL 字节。`view: text-block` 配合 `block` 返回对应原始消息文本，不裁剪空白。页包含 `sha256`、UTF-16 `offset`/`end`/`total`、`content` 和 `next_offset`（末页为 null）；位置不会切开有效代理对。续读沿用视图与块，将 `next_offset` 作为 `offset`，并把返回摘要传入 `expected_sha256`；事件改变会拒绝读取。显式分页不能与非零 `before`/`after` 混用。超预算的旧读取自动返回事件 JSON 首页，并标记请求的邻接内容已省略。

### 失败与恢复

每次可信查询调用均经过错误净化：保留调用方取消，提供方诊断留在内部日志，不安全失败转换为 `SESSION_QUERY_TOOL_FAILED`。本地校验与授权保留工具自有错误。事件读取对完整输出字符串执行 `maxReadBytes` 限制；元数据也无法容纳时返回不含源内容的 `SESSION_QUERY_TOOL_READ_BUDGET_TOO_SMALL`。其他工具仍依赖可选的通用 spill 策略限制过大的内联结果。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释工具背后的设计决策，并指出实现它们的代码位置；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

本消费方建立在一个分离与三项承诺之上：

- **窄而只读的工具。** 五个扁平 snake-case schema 将搜索分页留在内部，只在需要时暴露原文续读。
- **授权来自调用方，绝不由模型提供。** 调用方身份来自 `ToolExecution.exec.agent`；工作区是字符串精确 `cwd` 相等，并对照每次结果观察到的 header 重新校验。
- **一个模型边界净化器。** 每个可信 `ctx.sessionQuery` 调用都经过服务边界，它保留取消，并将诊断与分类失败限制在边界内。
- **精确原文页。** 各页内容拼接还原选定的原字符串；每页通过摘要绑定完整事件。

设计历史记录在[面向模型的会话查询工具笔记](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md)与 [session-search-not-shipped-default 笔记](../../../.agents/notes/archived/feature/2026-08-02-session-search-not-shipped-default.md)中。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、提示词章节、五个工具注册 |
| [`src/input.ts`](src/input.ts) | 模型 schema、参数规范化、过滤器构造 |
| [`src/workspace-access.ts`](src/workspace-access.ts) | 调用方身份、工作区授权、标题访问、血缘投影 |
| [`src/service-boundary.ts`](src/service-boundary.ts) | 可信调用与模型安全错误转换 |
| [`src/operations.ts`](src/operations.ts) | 五个操作工作流 |
| [`src/presentation.ts`](src/presentation.ts) | 文本结果渲染与工具调用卡片 |

### 操作流程

每个执行器先派生调用方，把模型的参数规范化为服务过滤器，对照调用方工作区授权目标（或请求的父 id），然后通过服务边界收集结果。两个搜索工具在观察世代仍有效时内部翻页消费提供方游标，停在 `maxSearchResults`；由于一次搜索会消费与世代绑定的提供方游标，两个搜索工具与同级工具调用排他执行，而三个精确追踪/读取工具选择并行执行。血缘输出用不含隐藏会话 id 的标记替换未授权祖先与后代边界。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当包级约定不够用时阅读以下页面。它们从工具表面逐步进入底层服务、schema 目录与设计证据。

- [生成的工具目录](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-query)——模型看到的五个工具 schema。
- [dsh-session-query](../session-query/README.zh.md)——这些工具调用的服务。
- [dsh-session-query-sqlite](../session-query-sqlite/README.zh.md)——两个搜索工具背后的全文后端。
- [会话查询子系统参考](../../../docs/subsystems/session-query.zh.md)——工具之下的类型级约定。
- [面向模型的会话查询工具](../../../.agents/notes/archived/feature/2026-07-24-model-facing-session-query-tools.md)——工作区授权、无游标结果与 spill 决策。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

模型会收到一个固定的既往历史指引章节。

##### 既往历史指引

```markdown
Use session_search to find relevant work from prior sessions, or session_event_search to search earlier events in one session. Search results are cursor-free and workspace-scoped. Follow a useful hit with session_trace, session_event_trace, or session_event_read when you need lineage, relationships, or exact data.
```

#### Token 影响

插件挂载期间，每次请求都存在一个固定精简章节。

#### KV Cache 影响

插件与指引文本不变时，前缀稳定。

### 工具 schema

#### 模型看到什么

模型看到生成的 [`session_search`、`session_event_search`、`session_trace`、`session_event_trace` 和 `session_event_read` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-session-query)。搜索游标与模型自定结果上限仍不暴露；事件读取暴露视图、块下标、偏移和预期摘要。

#### Token 影响

可见期间，每次请求都会发送五个固定只读 schema。

#### KV Cache 影响

工具可见性与定义不变时，前缀稳定。

### 工具结果

#### 模型看到什么

每次成功调用输出一个文本块。搜索结果包含标题和摘录，追踪结果包含已授权关系。事件读取保留完整小结果，对大结果分页；通用 spill 策略仍可能进一步缩短工具的内联输出。

#### Token 影响

结果取决于数据，并保留在已记录工具历史中直到压缩（compaction）；`maxSearchResults` 限制搜索命中数。

#### KV Cache 影响

仅追加的结果文本位于可重用请求前缀之后，不会使较早的缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明本包何时不合适，或何时需要特别的运维注意。它们是当前包约束，不是任务积压。

- **搜索有上限且无延续**——搜索最多返回部署上限，匹配更多时会请模型缩小查询；不提供延续 token。
- **保守的工作区身份**——工作区身份是字符串精确 `cwd` 相等，因此符号链接等价的路径不共享权限。
- **原文读取仍加载完整事件**——分页限制模型输出，不限制后端内存；追踪结果仍需 spill 策略限制内联输出。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

本开发备注是维护者的工作上下文：开放设计问题与尚未决定的探索方向。它明确不具权威性——已交付的行为、限制与既定理由以上文、包代码和相关 Agent Note 为准。

#### 未来：更宽泛的工作区语义

字符串精确 `cwd` 相等是刻意保守的选择；符号链接感知或规范路径的工作区身份会改变哪些会话共享权限，尚未决定。

</details>

**运行时不变式：** 不发布伴生入口。这个只读模型适配器不拥有任何超出注册表范围的事件关系或可变数据关系；这些注册表已经负责校验注册。
