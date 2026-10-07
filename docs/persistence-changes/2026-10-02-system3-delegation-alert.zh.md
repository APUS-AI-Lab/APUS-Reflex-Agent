---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-system3-delegation-alert

[English](2026-10-02-system3-delegation-alert.md) | 中文

## 概述

为 system3/delegation-progress 新增可选的 lastStepAt 与 note，并新增 system3/delegation-alert 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-delegation-alert
baseline: false
changes:
  - root: "event:system3/delegation-alert"
    previous: null
    after: "20dcc98052694791c25e6c5320ca2cd95d97ec162b4665bc76648da80f7033e0"
    decision: same-version
  - root: "event:system3/delegation-progress"
    previous: "2026-10-02-system3-delegation-progress"
    after: "5c3f9b13622a7f3243d94ac99789f33f66bc78d2774ac24184ed53685f3bf88e"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有进度快照仍然有效，不含新字段；读取方将缺失视为尚无步骤、没有说明。提醒事件是新的普通事件类型，只有配置了 delegationProgress.monitor 时 System3 才写入：运行在 startupMs 内没有第一个步骤时写一次，每次超过 stallMs 没有新步骤时各写一次，每到 overtimeMs 的整数倍写一次。两种事件都不对模型可见。note 只包含子 agent 自己写的简短进度消息，由 subagent 服务限制在 200 个字符以内。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests packages/subagent：全部测试通过，覆盖假时钟下的启动过慢、停滞和超时提醒，投影中提醒的清除，说明长度上限，以及客户端带继续等待和停止操作的提醒。

<a id="dev-note"></a>
## 开发备注

无。
