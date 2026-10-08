---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-system3-interjection-forward

[English](2026-10-08-system3-interjection-forward.md) | 中文

## 概述

为 system3/interjection 新增可选字段 forwardedTo。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-interjection-forward
baseline: false
changes:
  - root: "event:system3/interjection"
    previous: "2026-10-08-system3-interjection"
    after: "9780e6c61638f34589fadb53836173b40d7c8a18ab51dc805ad9c7ffd15cbbd0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

forwardedTo 是新增的可选属性；已有的 system3/interjection 事件仍然有效。当正在运行的委派也接收了被移入的消息时，System3 把它设为该委派的 provider；转发的文本由普通的 subagent/steer 事件记录。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts：19 个测试通过，包括转发给正在运行且可补充的委派，以及委派已结束或不可补充、委派拒绝、没有子 agent 服务时不转发。

<a id="dev-note"></a>
## 开发备注

无。
