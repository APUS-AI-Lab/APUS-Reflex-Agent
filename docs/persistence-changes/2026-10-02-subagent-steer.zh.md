---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-subagent-steer

[English](2026-10-02-subagent-steer.md) | 中文

## 概述

新增 subagent/steer 事件，并为 system3/delegation-progress 新增可选的 steerable。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-subagent-steer
baseline: false
changes:
  - root: "event:subagent/steer"
    previous: null
    after: "124270b202ad483c85f6c8bbb226d0e6e7f58f8510d5d22aadeb246f77671ec5"
    decision: same-version
  - root: "event:system3/delegation-progress"
    previous: "2026-10-02-system3-delegation-alert"
    after: "d2a568622f9a85d22c3f32d648d2f9a0b80f05b8f76e0c39268ddbc4c2e36ee2"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

subagent/steer 是新的普通事件类型：只有运行中的 one-shot 子 agent 通过 subagents.steerByParent 接受了用户输入之后，subagent 服务才把它追加到发起委派的父会话；事件包含生命周期 run id、provider 名称和原文，对父模型不可见。已有进度快照仍然有效，不含 steerable，读取方将缺失视为 false。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/subagent packages/experimental/system3 packages/experimental/client-ui-system3：全部测试通过，覆盖 steerByParent 的接受、拒绝、其他父会话、已结束运行和文本长度上下限，Codex 的 turn/steer 请求，投影保留最近三条补充说明，以及客户端补充说明表单。

<a id="dev-note"></a>
## 开发备注

无。
