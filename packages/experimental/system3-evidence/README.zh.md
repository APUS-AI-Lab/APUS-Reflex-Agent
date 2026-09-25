---
description: "System3 长工具输出的确定性、可恢复证据片段选择。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-evidence

[English](README.md) | 中文

## 摘要

这是无依赖的长工具输出边界库，不删除原始来源。
`selectSystem3Evidence()` 保留明确的字符片段，记录省略范围，并携带用于恢
复的 `artifactRef`。Jev 可以在紧凑证据视图上分类，同时不会把视图冒充成完整
日志。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

```ts
import { selectSystem3Evidence } from '@deepseek-ai/dsh-experimental-system3-evidence'

const selection = selectSystem3Evidence({
  artifactRef: 'tool:run-42', text: completeOutput, maxChars: 8192,
  requiredTerms: ['error', 'failed'], contextChars: 160,
})
```

把 `completeOutput` 按 `artifactRef` 持久化。只把 `retainedSpans` 发送给模型，
并保留 `omittedRanges` 供显式展开或验收请求使用。偏移量是原始 artifact 的半开
字符范围。

<a id="understand-the-implementation"></a>
## 实现说明

选择器是纯函数且具有确定性：先保留 required terms 周围的大小写不敏感窗口，
再应用 head/tail 预算，合并重叠范围并计算明确的省略范围。artifact 未超限时
返回一个 `full` 片段。本包不会自行摘要、哈希或发送数据。

<a id="model-experience"></a>
## 模型体验

### 证据投影

#### What the model sees

模型只会收到选中的片段和稳定的 `artifactRef`；省略范围仍可恢复，但不会被默
默当成模型文本。

#### Token effect

`maxChars` 会在可选的 Jev 摘要之前限制投影大小，因此可以与未裁剪基线对照真实
token 影响。

#### KV Cache effect

稳定的片段顺序与未改变的前缀有助于缓存复用；新的 required term 或 artifact 版本
会产生新的投影。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 字符上限不是 tokenizer 上限，仍必须根据 provider 的实际输入 token 计量。
- 选择器信任调用方提供的 artifact reference 和完整文本，不提供文件保留、加密
  或访问控制。
- 行级片段、结构化 JSON 字段和 provider 专用 token 预算，等 DSH 集成契约确定
  后再实现。

<a id="dev-note"></a>
### 开发说明

测试覆盖完整透传、required term 优先、大小写不敏感匹配、显式省略范围与非法限
制。运行 `vitest run packages/experimental/system3-evidence/tests/evidence.spec.ts`。
