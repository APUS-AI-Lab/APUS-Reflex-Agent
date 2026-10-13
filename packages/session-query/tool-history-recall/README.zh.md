---
description: "面向模型的工具：读回并搜索压缩检查点背后的原始对话，供需要无损长会话的智能体开发者使用。"
kind: "package-reference"
---

# @deepseek-ai/dsh-tool-history-recall

[English](README.md) | 中文

## 概述

使用 `dsh-tool-history-recall` 让模型找回被压缩替换的对话。`history_read` 逐页读取某个检查点背后的原始消息，`history_search` 在所有检查点的原文中查找字面字符串。两者都读取当前会话只追加的日志，因此压缩后的会话不会丢失模型曾经看到的任何内容。请与配置了 `recallFooter: true` 的 `dsh-compaction-basic` 配合使用，它会在每个检查点末尾写入这些工具接受的 id。

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

当长会话在压缩后仍须让所有早期细节可达时，把本包与压缩后端和 `ctx.sessionQuery` 一起挂载。

### 何时选择

任务超出上下文窗口、且后续步骤依赖摘要可能改写或遗漏的早期精确值、路径或错误字符串时选择它。压缩后端未开启 `recallFooter: true` 时，模型没有可用的检查点 id，只能搜索。

### 配置

| 字段 | 默认值 | 含义 |
|---|---|---|
| `pageChars` | `24000` | 一次 `history_read` 返回的字符数 |
| `maxMatches` | `20` | 一次 `history_search` 返回的最大匹配数 |
| `snippetRadius` | `160` | 匹配两侧各显示的上下文字符数 |

### 模型可以做什么

| 工具 | 模型得到的内容 |
|---|---|
| `history_read` | 检查点原始区间的一页，按 `User:`、`Assistant:`、`Tool result:` 渲染并带事件序号，外加下一页偏移或结束标记 |
| `history_search` | 不区分大小写的字面匹配片段，标注检查点 id 与偏移，外加扫描、命中、截断计数 |

替换了更早检查点的检查点会连同其脚注一起渲染那个更早的检查点，因此更早的区间仍可经由它到达。推理块被省略，因为提供方不会把它们作为对话重发。

### 失败与恢复

未知检查点 id 以 `HISTORY_RECALL_UNKNOWN_CHECKPOINT` 失败并列出已知 id。偏移越界或为负以 `HISTORY_RECALL_INVALID_OFFSET` 失败，空查询以 `HISTORY_RECALL_INVALID_QUERY` 失败，无智能体的调用以 `HISTORY_RECALL_NO_AGENT` 失败。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

### 设计

会话日志已经保存了每个被替换的事件，每个 `compaction/summary` 事件记录了 `shadowedSeqs`。召回是该日志的纯函数：没有新存储、索引或模型调用，因此无密钥回放保持确定。偏移指向渲染后区间的字符位置，相同日志渲染结果相同。设计遵循[可召回压缩提案](../../../.agents/notes/proposed/feature/2026-07-06-recallable-compaction.zh.md)；其中冻结索引存根与独立状态检查点未在此实现。

### 源码地图

| 文件 | 作用 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置、提示段、两个工具、分页与搜索操作 |
| [`src/transcript.ts`](src/transcript.ts) | 检查点列举与对话渲染 |

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

- [dsh-compaction-basic](../../compaction/compaction-basic/README.zh.md) — 其 `recallFooter` 选项为检查点命名的后端。
- [dsh-session-query](../session-query/README.zh.md) — 这些工具读取所经的服务。
- [dsh-tool-session-query](../tool-session-query/README.zh.md) — 跨会话的搜索与读取工具。

-----

<a id="model-experience"></a>
## 模型体验

### 系统提示词

#### 模型看到什么

模型收到一个固定的召回指引段。

##### 召回指引

```markdown
Checkpoints that condense earlier conversation end with a footer naming a checkpoint id. The original messages are never lost: use history_read with that id to read them page by page, or history_search to find an exact string, value, path, or error message across every checkpoint. Read the originals before relying on details that a checkpoint summary omits or only paraphrases.
```

#### Token 影响

插件挂载期间，每次请求带一个固定的简短段落。

#### KV Cache 影响

插件与指引文本不变时前缀稳定。

### 工具 schema

#### 模型看到什么

模型看到生成的 [`history_read` 与 `history_search` schema](../../../docs/tool-catalog.zh.md#deepseek-aidsh-tool-history-recall)。

#### Token 影响

可见期间每次请求发送两个固定的只读 schema。

#### KV Cache 影响

工具可见性与定义不变时前缀稳定。

### 工具结果

#### 模型看到什么

每次成功调用输出一个纯文本块：带标题与续读标记的一页，或带覆盖计数的片段列表。

#### Token 影响

`pageChars` 限制一页大小，`maxMatches` 与 `snippetRadius` 限制搜索结果；结果在压缩前留在已记录的工具历史中。

#### KV Cache 影响

召回文本位于请求尾部，不会使更早的缓存条目失效。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- **仅限当前会话** — 工具读取调用者自己的会话；其他会话由 `dsh-tool-session-query` 覆盖。
- **整份日志读取** — 每次调用通过 `ctx.sessionQuery.readSession` 读取完整会话日志，耗时与日志长度成线性。
- **字面搜索** — 匹配为不区分大小写的字面文本，不支持正则或语义匹配。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文——点击展开</summary>

无。

</details>

**运行时不变量：** 不发布伴随模块。这个只读模型适配器除已校验注册的注册表外，不拥有任何事件或可变数据关系。
