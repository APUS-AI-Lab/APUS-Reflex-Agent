---
description: "System3 实验包的确定性本地优先路由准入策略。"
kind: "package-library"
---

# @deepseek-ai/dsh-experimental-system3-policy

[English](README.md) | 中文

## 摘要

这是实验性 System3 harness 的隐私边界。Jev、DSH 或 provider registry 可以
提出候选路由，但 `admitSystem3Routes()` 会先应用用户的
`local-only`、`controlled` 或 `cloud-approved` 策略，再允许选择路由。模型
评分不能绕过被阻断的网络路由。

## 目录

- [使用方式](#use-this-package)
- [实现说明](#understand-the-implementation)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发说明](#dev-note)

-----

<a id="使用方式"></a>
## 使用方式

本包没有 Cordis 插件，也不会发起网络请求。把有序候选路由传给纯函数，只有
准入结果中的 `selected` 才能执行。

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

`controlled` 或 `cloud-approved` 必须同时提供明确的远程路由 id 和数据类别
allowlist。没有合法候选时返回 `requiresClarification: true`，调用方必须请求
授权或安全失败。

<a id="实现说明"></a>
## 实现说明

本地候选始终保留。网络候选必须通过路由 id 和每一个数据类别的 allowlist；
`cloud-approved` 还要求 `cloudApproval: true`。重复 id 只保留首次出现，原始
候选顺序保持不变，因此该函数可以作为分类与执行之间可审计的确定性 seam。

<a id="模型体验"></a>
## 模型体验

### 路由准入

本包本身不增加 prompt、不调用模型，也不写入 Session event；Jev 可以提供可选的 `preferredId`，但最终以策略结果为准。

#### 模型看到的内容

本包不会把任何内容加入模型上下文；选中的路由只是执行决策，被阻断的路由不会收到候选路由对应的模型可见输入。

#### Token 影响

没有直接影响；本包只在本地执行比较，不产生模型请求。

#### KV Cache 影响

没有直接影响；本包不组装或发送模型请求。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- 本包只检查声明的路由域和数据类别，不检查 provider 的实际网络行为，也不提
  供操作系统级隔离。
- 路由元数据必须来自可信的 provider registry。后续 M1 集成会把纯策略绑定到
  DSH 路由注册和审计事件。
- 本包不会把模型置信度当作授权。用户授权界面和持久化导出 ledger 属于后续
  System3 工作。

<a id="dev-note"></a>
### 开发说明

测试覆盖 local-only 阻断、controlled 数据类别过滤、显式云授权、Jev 偏好回退、
重复候选抑制和无候选时安全失败。运行
`vitest run packages/experimental/system3-policy/tests/policy.spec.ts`。
