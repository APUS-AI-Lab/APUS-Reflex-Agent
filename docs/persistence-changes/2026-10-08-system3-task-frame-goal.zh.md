---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-system3-task-frame-goal

[English](2026-10-08-system3-task-frame-goal.md) | 中文

## 概述

任务卡的目标除了消息之外，也可以是 DSH 目标的 objective。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-task-frame-goal
baseline: false
changes:
  - root: "event:system3/task-frame"
    previous: "2026-10-07-system3-task-frame"
    after: "77495110dac52ca61c5c0e3cf585ab45269bcf0e36d5273f2c06f9cb09c343f5"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

goal.messageId 改为可选，并新增可选属性 goal.goalId；两者恰好有一个。已有的 system3/task-frame 事件仍以消息作为目标，继续有效。由 DSH 目标设定任务时写入的事件携带 goalId 和 objective 文本。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts：13 个测试通过，包括由 GoalService.create 建立任务卡、修改 objective 时保留要求、消息不能替换进行中的目标、目标完成或清除后消息可以开启新任务卡，以及从种子 Session 恢复进行中的目标。

<a id="dev-note"></a>
## 开发备注

无。
