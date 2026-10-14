---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-system3-memory-recall

[English](2026-10-13-system3-memory-recall.md) | 中文

## 概述

新增 system3/memory-recall 事件，记录逐轮记忆召回为某条用户输入展示了哪些保留的记忆。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-system3-memory-recall
baseline: false
changes:
  - root: "event:system3/memory-recall"
    previous: null
    after: "e467cf9bf8c7f6c3ea3843bd6df1ceae8107078a893b7deb386af8e26f8d30b7"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增可选写入方：只有在 System3 配置了 active 模式的 memoryRecall（同时配置 memoryScoring），且某条输入召回了至少一条保留的记忆或清除了之前的召回时才写入该事件。已有日志仍然有效；不认识该事件的构建只拒绝包含它的日志。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3：22 个文件、280 个测试通过；vitest --config vitest.e2e.config.ts packages/experimental/system3/tests/memory-recall.e2e.ts 与 memory-scoring.e2e.ts：2 个测试通过；针对 DeepSeek 官方 API 与已部署 APUS Reflex 端点的 memory-recall-live.e2e.ts：1 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
