---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-system3-handoff-pack

[English](2026-10-04-system3-handoff-pack.md) | 中文

## 概述

新增 system3/handoff-pack 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-system3-handoff-pack
baseline: false
changes:
  - root: "event:system3/handoff-pack"
    previous: null
    after: "c4519065a7d2c21ca6154ac2cfe65e97587ad8e210623c01371fee5f959d35d3"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是新增项，已有 Session 中不存在。只有配置了 entryRouting.handoffPack 时，System3 才在注入委派指令的 pre-step 中、在该指令之前写入 system3/handoff-pack。它记录完整的 Jev 请求或 null、收到时的响应、结果，以及作为要求转交的更早用户消息的 id。该事件本身对模型不可见；转交的文本包含在已记录的 system3-delegation 指令消息中到达模型。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/handoff-pack.spec.ts：6 个测试通过，覆盖原文转交并记录消息 id、没有要求、没有历史、隐私拒绝、Jev 缺失或失败、超时、轮次取消，以及加载时拒绝无效设置。

<a id="dev-note"></a>
## 开发备注

无。
