---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-system3-prefetch

[English](2026-10-14-system3-prefetch.md) | 中文

## 概述

新增 system3-prefetch 用户消息来源，用于 System3 在一步的模型请求之前预取的只读工作区信息。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-system3-prefetch
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-11-continuum-memory-decision"
    after: "8a20a925a9b09e6fad61d844d4b2c16b1144907cd1b00a9b9f039cfc392055f4"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-11-continuum-memory-decision"
    after: "923ca7339c013d032ff7fc02324bfa57d4f49096eec6af7abfbf26088d23091f"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-11-continuum-memory-decision"
    after: "c1da67d8f0567d12008e6d45383c94d42deb0e63c0e5af74183638efb420e168"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-11-continuum-memory-decision"
    after: "74b1aabf947a4793d44fe4d5728f9da74e034803f6f9f912e1f6631f35035220"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

仅为归属标记：消息内容是普通文本，读取方没有该写入方也会原样保留。已有记录仍然有效，已有来源类型不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/prefetch.spec.ts：7 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
