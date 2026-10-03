---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-03-system3-entry-explicit-delegation

[English](2026-10-03-system3-entry-explicit-delegation.md) | 中文

## 概述

为 system3/entry-decision 新增可选的 explicit 字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-03-system3-entry-explicit-delegation
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-10-02-system3-entry-delegation"
    after: "b21037892a17d8375f1124a35300ccf73135bc598404d2f9d39ddcd03807d896"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有决策记录仍然有效，不含该字段。只有在准入与可用性检查之后，输入匹配所选委派候选的 explicitPatterns 时，System3 才写入 explicit: true；这类决策的 outcome 仍为 selected，不发送 Jev 请求，request 记为 null。忽略该字段的读取方看到的仍是一次普通的已选委派。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/delegation.spec.ts：7 个测试通过，覆盖明确要求时不调用 Jev 直接委派、无关输入仍询问 Jev、委派不可用时忽略匹配规则，以及加载时拒绝空白或无效的匹配规则。

<a id="dev-note"></a>
## 开发备注

无。
