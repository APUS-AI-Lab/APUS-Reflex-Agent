---
description: "System3 实验包的确定性本地优先路由准入策略。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-policy

[English](README.md) | 中文

## 概述

这是实验性 System3 harness 的隐私边界。Jev、DSH 或 provider registry 可以提出候选路由，但 `admitSystem3Routes()` 会先应用用户的 `local-only`、`controlled` 或 `cloud-approved` 策略，再允许选择路由。模型评分不能绕过被阻断的网络路由。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用方式

本包没有 Cordis 插件，也不会发起网络请求。把有序候选路由传给纯函数，只有准入结果中的 `selected` 才能执行。

```ts
import { selectSystem3Route } from '@deepseek-ai/dsh-experimental-system3-policy'

const decision = selectSystem3Route(
  { mode: 'local-only' },
  [
    { id: 'local-9b', executionDomain: 'local', dataClasses: ['workspace', 'secret'] },
    { id: 'codex', executionDomain: 'network', dataClasses: ['workspace'] },
  ],
  'codex', // a Jev preference; policy still wins
)
// decision.selected?.id === 'local-9b'
```

`controlled` 或 `cloud-approved` 必须同时提供明确的远程路由 id 和数据类别 allowlist。没有合法候选时返回 `requiresClarification: true`，调用方必须请求授权或安全失败。

-----

<a id="understand-the-implementation"></a>
## 实现说明

<details>
<summary>实现内部细节——点击展开</summary>

本地候选始终保留。网络候选必须通过路由 id 和每一个数据类别的 allowlist； `cloud-approved` 还要求 `cloudApproval: true`。重复 id 只保留首次出现，原始候选顺序保持不变，因此该函数可以作为分类与执行之间可审计的确定性 seam。

**Runtime invariant:** 不发布 runtime invariant companion。本库根据显式输入计算结果，不维护可相互偏离的独立可变观测。

</details>

-----

<a id="model-experience"></a>
## 模型体验

### 路由准入

#### What the model sees

本包不会把任何内容加入模型上下文；选中的路由只是执行决策，被阻断的路由不会收到候选路由对应的模型可见输入。

#### Token effect

没有直接影响；本包只在本地执行比较，不产生模型请求。

#### KV Cache effect

没有直接影响；本包不组装或发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包只检查声明的路由域和数据类别，不检查 provider 的实际网络行为，也不提供操作系统级隔离。
- 路由元数据必须来自可信宿主。System3 consumer 在 Jev shadow 请求前应用此策略；其他执行路径由调用方负责。
- 本包不会把模型置信度当作授权。用户授权界面和持久化导出 ledger 属于后续 System3 工作。

<a id="dev-note"></a>
### 开发备注

无。
