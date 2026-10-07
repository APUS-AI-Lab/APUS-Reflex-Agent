---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-system3-interjection

[English](2026-10-08-system3-interjection.md) | 中文

## 概述

新增 system3/interjection 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-interjection
baseline: false
changes:
  - root: "event:system3/interjection"
    previous: null
    after: "92745119ec7ac2871a3716b932458c18b2cacff7cb3d4e9aaef08b968fe7184d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是新增；已有 Session 不包含该事件。只有配置 taskFrame.interjection 且用户在运行中的轮次之后排队纯文本消息时，System3 才写入 system3/interjection，记录判断以及消息是否已移入。移入本身是普通的收件箱 steer，照常记录；该事件不是模型可见内容。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/task-frame.spec.ts：17 个测试通过，包括排队的要求在同一轮的下一步送达、被取走时不再重复判断，旁支问题留到下一轮，shadow 模式，移入失败或没有控制器时条目保持排队，以及跳过直接插入、带附件和判断失败的消息。

<a id="dev-note"></a>
## 开发备注

无。
