---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-04-system3-process-supervision

[English](2026-10-04-system3-process-supervision.md) | 中文

## 概述

新增 system3/process-notice 事件和 system3-supervision 消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-04-system3-process-supervision
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-02-system3-entry-delegation"
    after: "522a5e09d8f11b02fed1ef9c5d50591aed0eb9fa59f993d3e17b975f16d462ee"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-02-system3-entry-delegation"
    after: "7f16f9eee70e108e75e21fde7700f3491a8fe6235f7bf2793b09cd70afaf67a6"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-02-system3-entry-delegation"
    after: "8bf9b5c7cdc780c031c64a3a78ed5c85ce86118a9c5bdad6256b4052b3874e27"
    decision: same-version
  - root: "event:system3/process-notice"
    previous: null
    after: "310a36ad49580b64f5f22ee000de5d58ec37334a253610f83bb3cf9102023108"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-02-system3-entry-delegation"
    after: "bd80919d08e6f675e935b38577dc71c66e9cc5dc18cb2261e607987e161ec0f0"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两者都是新增项，已有 Session 中均不存在。只有配置了 processSupervision 且某条停滞或证据规则触发时，System3 才写入 system3/process-notice；该事件本身对模型不可见。advise 模式下，建议以来源为 system3-supervision 的用户消息送达模型；这是仅用于归属的来源类型，没有该生产方的读取方会把它当作普通内容保留。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/process-supervision.spec.ts：9 个测试通过，覆盖重复失败、失败次数、连续无进展、修改后缺少验证、observe 模式不给建议、委派运行中的命令失败，以及加载时拒绝无效阈值和匹配规则。

<a id="dev-note"></a>
## 开发备注

无。
