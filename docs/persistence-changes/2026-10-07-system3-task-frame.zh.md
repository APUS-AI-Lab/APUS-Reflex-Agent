---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-07-system3-task-frame

[English](2026-10-07-system3-task-frame.md) | 中文

## 概述

新增 system3/judgement 与 system3/task-frame 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-system3-task-frame
baseline: false
changes:
  - root: "event:system3/judgement"
    previous: null
    after: "a916521e7d79713dffb82460a2790977991d333ee61739f4c3c768964e0afcb4"
    decision: same-version
  - root: "event:system3/task-frame"
    previous: null
    after: "ac45da2b86d3e15e2fb89536caa52be80e721155be5489e1242afaf860661c42"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两者都是新增；已有 Session 都不包含。配置 taskFrame 且处于 shadow 或 active 模式时，System3 为每次任务卡判断写入 system3/judgement，包含完整的 Jev 请求和响应；它本身不是模型可见内容。active 模式下任务卡每次变化时写入 system3/task-frame；任务卡只通过 system3:task-frame 运行时上下文进入模型，agent loop 会把该上下文记录为 runtime-context 用户消息。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts packages/experimental/system3/tests/decision-kernel.spec.ts：15 个测试通过，覆盖任务卡建立、要求追加、之后请求中的运行时上下文、条数上限、新任务、跳过的消息、shadow 与 off 模式、从日志恢复以及失败处理；Loader 组装测试持久化并恢复了带任务卡的 Session。

<a id="dev-note"></a>
## 开发备注

无。
