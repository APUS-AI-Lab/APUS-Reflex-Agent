---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-17-recall-prefix-audit

[English](2026-11-17-recall-prefix-audit.md) | 中文

## 概述

为已记录的事件补充审计与归组事实：assistant attempt 上记录请求所依据的最后一个已提交偏移，scored 与 budgeted 事实上的 recallId，rerank 评估中的问题与候选绑定，重建索引条目的可选 terms，准入的 outcome/reason/requestStatus，以及记录日志到达持久化位置的 session/flushed 根。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-17-recall-prefix-audit
baseline: false
changes:
  - root: "event:assistant/attempt"
    previous: "2026-09-16-session-format-v4"
    after: "463a4598379da6d544ad3c456c39600f7f41d88633cfb0e2e10f26464c1dc2a7"
    decision: same-version
  - root: "event:assistant/message"
    previous: "2026-09-16-session-format-v4"
    after: "6c56797e4410ca9f31eeba31f721a387450754c9b5a26acd2b3f05156e797641"
    decision: same-version
  - root: "event:continuum/memory-admission"
    previous: "2026-11-09-continuum-source-facts"
    after: "d4c56ac107ceba993dcdfe7b1bbc475c015b24e4debba1f3c8fec345119567a6"
    decision: same-version
  - root: "event:continuum/memory-budgeted"
    previous: "2026-11-08-session-format-v5"
    after: "9eee829dcefab670816662d26caf5cdbd72030c8857a37439418124a6fb022f4"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: "2026-11-09-continuum-source-facts"
    after: "5d5f00d8934a742f06e5417646bd0876e256c8a99dd34d4df60b793ccb2a0a91"
    decision: same-version
  - root: "event:continuum/memory-index-rebuilt"
    previous: "2026-11-09-continuum-source-facts"
    after: "a980fdffd572f50c0481ce57f650d631392d9fec505bdca57ce86ed618fdded2"
    decision: same-version
  - root: "event:continuum/memory-scored"
    previous: "2026-11-08-session-format-v5"
    after: "927c6ea728c0514f44446d0c4a4ab9c1269c7104696dcce089ed6da315a58762"
    decision: same-version
  - root: "event:session/flushed"
    previous: null
    after: "1ef4c7e0eefff1ceef90bce6d860e01d17c31e2f105f70abe4c09ccf134ab90d"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

全部变更为新增可选正文字段或把必填字段改为可选；已有记录仍然有效，不读新字段的实现不受影响。历史 attempt 缺 prefixEnd 表示无法核对配对，不是已经匹配；缺 recallId 表示当次召回身份未记录，按相邻关系归组只是猜测。session/flushed 只进日志、仅作说明，不认识该类型的构建仍能读取日志。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/core/session/tests/session.spec.ts packages/core/agent-loop/tests/cancel.spec.ts packages/context/continuum/tests/execution-scan.spec.ts：3 个文件、127 条用例全部通过。prefixEnd 的 -0 用例首次运行失败；校验器现在与 turn/step 一样拒绝 -0。AutoEval 侧对已记录轨迹复核：residual=0、node_missing=0、new=0。

<a id="dev-note"></a>
## 开发备注

无。
