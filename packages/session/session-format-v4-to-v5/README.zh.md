---
description: "V4 到 V5 的 Session 头部提升，沿用已发布的 V4 物理框架与当前格式准入：不转换事件，按 V5 判定交付归属。"
kind: "package-library"
---

# @deepseek-ai/dsh-session-format-v4-to-v5

[English](README.md) | 中文

## 概述

把受支持的已发布 V4 Session 还原为 V5，而不改写已存储的代际。V5 写入器不改变任何事件表示：它移除了两个从未由已发布写入器写出的仅日志提供方选择事件名，放宽一处 Continuum 准入来源联合，并新增可选载荷属性。本包负责头部提升、原样转发的正文阶段、原生 V5 codec 与目标校验。文件读取与后继发布由持久化层负责。

## 目录

- [使用本包](#use-this-package)
- [V4 到 V5 规范](#v4-to-v5-specification)
  - [头部与物理框架](#header-and-framing)
  - [正文保留](#body-preservation)
  - [继承切点](#inherited-cut)
  - [交付代际](#delivery-generations)
- [原生 V5 准入](#native-v5-admission)
- [理解实现](#understand-the-implementation)
- [延伸阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

完整还原请使用[目录](../session-format-catalog/README.zh.md)。直接导入供目录装配与持久化使用。本包不发布运行时 invariant companion，因为它不注册任何内容，也不拥有可观察状态：解码器、迁移阶段与校验状态都属于一次由调用方持有的还原。本包导出相邻迁移、已发布的 V4 源 codec、V5 codec、V5 头部校验器、工件还原器与关系校验器。

```text
const targetHeader = sessionFormatV4ToV5.migrateHeader(sourceHeader)
```

每次还原都会创建独立的阶段状态。[JSONL 持久化](../session-persistence-jsonl/README.zh.md)负责源读取、准备与经过校验的排他后继发布。

<a id="v4-to-v5-specification"></a>
## V4 到 V5 规范

本边只提升头部，原样转发每个事件。它不创建事件、消息或引用，也不重映射任何坐标。

<a id="header-and-framing"></a>
### 头部与物理框架

| 输入 | V5 结果 | 保留或拒绝 |
|---|---|---|
| 逻辑 V4 头部 | `version: 4` 变为 `5` | 先运行已发布的 V4 头部校验；其余逻辑头部字段保持不变。 |
| V4 物理行 | 已发布的 V4 源 codec 解码事件与紧凑运行 | 物理框架与原生 V4 准入仍由前一个包拥有。 |
| V5 物理行 | `releasedV5SessionFormatCodec` 复用已发布的 V4 框架与 V4 行准入 | 本边不改变任何物理表示。 |

<a id="body-preservation"></a>
### 正文保留

阶段原样发出每个源事件与紧凑运行，因此序号、时间戳、载荷、引用与 surface 元数据保持逐字节一致。V5 的载荷差异是新增或移除，且无需重新解释：

- `tool/provider-selected` 在 V4 期间已经携带 V5 的载荷形态。被移除的 `lsp/provider-selected` 与 `web/provider-selected` 目录条目从未有已发布写入器：引入提供方选择的那次部署变更直接追加 `tool/provider-selected`，因此没有任何已提交日志载有旧名，本边也不需要改名。
- `continuum/memory-index.data.admission.source` 接受 `compaction` 与 `user-message`。在 V4 下写出的 `compaction` 记录在 V5 下仍然有效，无需转换。

<a id="inherited-cut"></a>
### 继承切点

未带种子的工件切点为零。带种子的工件若源未提供切点，则依据最后一个携带 `data.inherited: true` 的 `session/end-seed` 事件推导；若未带种子的工件含有该标记，阶段会拒绝；若推导结果与源提供的切点不一致，也会拒绝。既无标记又无切点时拒绝，而不当作零。

<a id="delivery-generations"></a>
### 交付代际

`session-log-deepseek/delivery-accepted` 水位标记指明它覆盖哪个代际的坐标。V4 校验器只认第 4 代标记，因此本包自行校验第 5 代的归属：除非位于子会话的继承前缀内，V5 标记必须指明工件自己的 Session。更早的代际作为历史记录保留，不被重新解释。

<a id="native-v5-admission"></a>
## 原生 V5 准入

`restoreReleasedV5Artifact` 校验 V5 头部、坐标稠密、未知必需事件拒绝且保留 ignorable 载荷、继承切点标记一致、完整的 V4 逐事件检查（退役语法、system 消息字段、tool 结果角色、fork 结果、developer 数据、消息来源）、生命周期关系，以及 V5 交付归属。`assertV5Relationships` 对外提供逐事件与生命周期部分，供已校验过信封的调用方使用——JSONL 持久化在扫描当前格式文件后调用它。

所有检查都委托给 V4 边，而不是重新表述。仅有的 V5 专属新增是头部版本与活跃交付代际。

<a id="understand-the-implementation"></a>
## 理解实现

- `src/migration.ts` —— 头部提升、原样转发的正文阶段、继承切点推导。
- `src/codec.ts` —— 在已发布 V4 行之上的 V5 物理框架。
- `src/validation.ts` —— V5 头部校验、还原、关系检查与交付归属。

<a id="further-exploration"></a>
## 延伸阅读

- [已发布 Session 格式迁移](../../../.agents/notes/implemented/architecture/2026-08-31-released-session-format-migrations.zh.md) —— 阶段协议、codec 复用与发布规则。
- [Session 日志版本机制](../../../.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.zh.md) —— 何种结构变化要求升版。
- [版本与发布状态](../../../docs/session-format-status.zh.md) —— 写入器权威与已发布格式记录。

<a id="model-experience"></a>
## 模型体验

本包不接触模型请求、提示词、工具 schema 或模型可见文本。它在 Session 还原之前转换已存储历史，因此迁移后的 Session 推导出的消息与其 V4 源完全一致。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与后续工作

- **被移除的提供方选择名** —— `lsp/provider-selected` 与 `web/provider-selected` 目录条目保持不解释。V5 读取方把它们当作未知历史记录；本边不把它们改名为 `tool/provider-selected`，因为没有任何已发布写入器产生过它们，凭空编造载荷映射会赋予旧名从未保证过的字段。
- **转换覆盖** —— 正文无法原样转发的 V4 源会被拒绝，不发布后继也不改动源文件。后续修复可以在 V5 输出保持兼容的前提下扩大可接受源。
- **已安装词汇** —— 还原只解释已安装 Session 包认识的事件类型；其余必需类型被拒绝，未知 ignorable 载荷保持不透明。

<a id="dev-note"></a>
## 开发备注

无。
