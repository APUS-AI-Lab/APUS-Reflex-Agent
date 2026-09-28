---
description: "System3 的确定性完成监督、影子对照与 usage ledger 原语。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-supervisor

[English](README.md) | 中文

## 概述

这是无依赖的监督库，让 Jev 建议服从独立证据。只有目标 revision 最新、所有必需检查通过、证据引用存在且预算仍有余量时，`candidate_done` 才会变成 `done`。 它还记录模型与基线的分歧，并区分 provider usage 与估算值。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

```ts
import { superviseSystem3Advice } from '@deepseek-ai/dsh-experimental-system3-supervisor'

const result = superviseSystem3Advice({
  currentGoalRevision: 'goal:1',
  advice: { action: 'candidate_done', goalRevision: 'goal:1', evidenceRefs: ['test:1'] },
  requiredChecks: [{ id: 'tests', status: 'pass', evidenceRefs: ['test:1'] }],
  availableEvidenceRefs: ['test:1'], budgetRemaining: 10,
})
```

只有 `result.action` 可以作为完成决策。把 `compareSystem3Advice()` 的输出作为 shadow evidence 持久化；把 provider 报告的 usage 以 `source: 'provider'` 传给 `validateSystem3CostRecord()`，估算值保持显式标记。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

监督器在处理建议前拒绝过期目标 revision 和缺失证据。检查失败返回 `retry`， 检查未知返回 `escalate`，未知建议安全失败。`sumSystem3CostRecords()` 只做算术， 不会把估算值变成 provider 事实。

**Runtime invariant:** 不发布 runtime invariant companion。本库根据显式输入计算结果，不维护可相互偏离的独立可变观测。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 完成监督

#### What the model sees

本包不增加 prompt；模型请求返回后，它把 `candidate_done` 与持久化检查转换成执行动作。

#### Token effect

没有直接影响。ledger 记录真实 usage 或明确标注的估算值，以便评估 Jev 额外请求和它避免的工作。

#### KV Cache effect

没有直接影响；监督器不组装请求，调用方记录决策时可以保留固定 prompt 前缀。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 监督器信任独立检查提供方和证据清单，不运行测试、不检查文件，也不执行进程沙箱。
- 成本记录包含 token 数和耗时，不包含 provider 价格表；价格版本关联属于 DSH 账务层。
- Shadow 对照只是观测 seam，不会自动训练或晋级 Jev checkpoint。

<a id="dev-note"></a>
### 开发备注

无。
