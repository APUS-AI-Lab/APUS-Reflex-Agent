---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-system3-memory-score

[English](2026-10-13-system3-memory-score.md) | 中文

## 概述

新增 system3/memory-score 事件，记录记忆评分保留了哪些已被压缩的用户原话。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-system3-memory-score
baseline: false
changes:
  - root: "event:system3/memory-score"
    previous: null
    after: "7432947d80eb37a0c3ad872e726a41b90c752cd14eb78aef8a0a684e8509f62d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新的可选写入方：仅当 System3 memoryScoring 以 active 模式配置、且一次压缩替换了被 Jev 判定仍需保留的用户原话时写入。已有日志仍然有效，不认识此事件的构建只会拒绝包含它的日志。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/memory.spec.ts：7 个测试通过；vitest --config vitest.e2e.config.ts packages/experimental/system3/tests/memory-scoring.e2e.ts：1 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
