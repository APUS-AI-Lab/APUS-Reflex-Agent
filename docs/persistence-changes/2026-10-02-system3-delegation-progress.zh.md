---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-system3-delegation-progress

[English](2026-10-02-system3-delegation-progress.md) | 中文

## 概述

新增 system3/delegation-progress 事件：在委派方 Agent 的 Session 中写入节流后、不含内容的子 agent 运行进度快照。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-delegation-progress
baseline: false
changes:
  - root: "event:system3/delegation-progress"
    previous: null
    after: "b7a5287089022cc0d2f384d42fef9d4b853a4192785d29543b9502569d12423b"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是新的普通事件类型；已有日志仍然有效，且不包含该事件。只有启用 delegationProgress 时 System3 才写入：运行开始时一次，有步骤时每个间隔最多一次，运行结束时带停止原因再写一次。快照只含步骤类别和计数，不含子 agent 内容，也不对模型可见。不认识该类型的读取方会像对待其他新的必需事件类型一样拒绝该日志。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests：全部测试通过，覆盖经真实 subagent 服务产生的开始、节流运行中和结束快照，失败的运行、插件卸载、投影的最新运行以及客户端运行卡片。

<a id="dev-note"></a>
## 开发备注

无。
