---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-execution-write-decision

[English](2026-11-08-execution-write-decision.md) | 中文

## 概述

新增仅日志的 `continuum/memory-write-decision` 事件，记录一次 step 之后执行事实判断的终态结果。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-execution-write-decision
baseline: false
changes:
  - root: "event:continuum/memory-write-decision"
    previous: null
    after: "a5f3fe5e1e3f8d21f5f3f49cfa208259eb73207b04674fb2b213f87715cb3c21"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效。该事件是普通可选新增，旧读取方可以忽略，因为它从不进入模型 surface，回放也不会从中派生记录；记录内容仍保存在 `continuum/memory-record`。不认识该类型的读取方会拒绝整份日志，除非信封标记为可忽略，这与所有普通事件一致。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/context/continuum/tests/execution-admission.spec.ts：14 个测试通过；pnpm run gen-persistence-catalog --check：已是最新。

<a id="dev-note"></a>
## 开发备注

无。
