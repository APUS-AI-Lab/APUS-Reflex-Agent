---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-09-continuum-source-facts

[English](2026-11-09-continuum-source-facts.md) | 中文

## 概述

为 Continuum 召回与写入事件补充只读源事实：查询/粗召/过滤/选择事实、recallId、写入与尝试归属、逐版本索引证据，并新增两个 log-only 写入事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-09-continuum-source-facts
baseline: false
changes:
  - root: "event:continuum/memory-admission"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "931970c6934a41874dabb1a169ccd4d7e8c43adb47ec4eba4030a961ea002c12"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "26297c7dac1296c937844127fae35de765e377c35b071079ee7ce34c0f7fb2ad"
    decision: same-version
  - root: "event:continuum/memory-index"
    previous: "2026-11-08-session-format-v5"
    after: "8d13957d44bf5fe029187cc8dcd7d2136b485a368ecc0491f2de6636faa0608d"
    decision: same-version
  - root: "event:continuum/memory-index-queued"
    previous: "2026-11-08-session-format-v5"
    after: "e026850b847da4f077e1e21bb40df80ef0fb1bff2cfe667a7d86ef954484a37f"
    decision: same-version
  - root: "event:continuum/memory-index-rebuilt"
    previous: "2026-11-08-session-format-v5"
    after: "366f0e845a3940a6ad50d7277c5d3434f3aba7a76f9329780b0a59641537114b"
    decision: same-version
  - root: "event:continuum/memory-injected"
    previous: "2026-11-08-session-format-v5"
    after: "c46d236e588f7d38794fb580b7c90c251de6aa5756906f41ef8db5f1b7446675"
    decision: same-version
  - root: "event:continuum/memory-recall-decision"
    previous: "2026-11-08-recall-query-origin"
    after: "1abc944f3eef75ac0346381e6ecc12da6af6a56b790ccc1c25ca44769ab48475"
    decision: same-version
  - root: "event:continuum/memory-record"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "40cb7d19124fbfbbd259eecb397bb2a162acd382957d9f8648471f25bfa0dad1"
    decision: same-version
  - root: "event:continuum/memory-retrieval"
    previous: "2026-11-08-recall-query-origin"
    after: "18ace0606da6896b111dd56771f9aedf478b6c47d546f9fc277e7dc24ad4eab3"
    decision: same-version
  - root: "event:continuum/memory-write-candidates"
    previous: null
    after: "6782125f181bab4354969675b89e25da90b25659375045a0fa3c01893086c612"
    decision: same-version
  - root: "event:continuum/memory-write-result"
    previous: null
    after: "edda07db25b874a2fcecc8ff7901408aebcc313e12815bc450fb39e3c704506a"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

所有新增都是可选属性，两个新事件根描述此前不存在的事实，因此已有记录仍然有效，Session 结构版本不变。不认识新事件根的 reader 只有在事件带 ignorable 时才会跳过，否则拒绝解释该日志，与本仓其他声明事件的规则一致；本改动所在的构建声明这两个类型。历史事件保持原义：缺少 recallId、writeId 或 appliedRecords 表示当时没有记录该事实，不能读成 0。

<a id="verification"></a>
## 验证

./node_modules/.bin/vitest run packages/context/continuum/tests packages/experimental/continuum-jev/tests：396 个测试通过。recall-facts.spec.ts 与 write-facts.spec.ts 覆盖新增字段；两个包的 tsc --noEmit 与改动文件的 oxlint 均通过。

<a id="dev-note"></a>
## 开发备注

无。
