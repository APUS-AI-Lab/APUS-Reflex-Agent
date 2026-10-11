---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-11-continuum-memory-decision

[English](2026-10-11-continuum-memory-decision.md) | 中文

## 概述

新增持久化的 continuum/memory-decision 回执，以及 Reflex 记忆召回使用的 continuum-memory 消息来源类型。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-11-continuum-memory-decision
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-04-system3-process-supervision"
    after: "9dc6e47a65591c4d4ea39afad833ad7f1084bf7a7833d6e68f5ac6186eb6fb28"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: null
    after: "774ecfa0befd8db48043c917a9f9beb3cc41f4d35e1e645ef2cfb97804900151"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-04-system3-process-supervision"
    after: "95151d8f2c5e89c4d929e950f1b8907bcb69314fb21680a83157129b4e152e96"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-04-system3-process-supervision"
    after: "d5e2cf00a3746feb82ebb29c7f5f25e3ad1a5abfc3dc962c2935704a436fc4bf"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-04-system3-process-supervision"
    after: "eed210e05c1fa38ff4a06376a3f82d77288418ec38028bfbf570b59c71bf638c"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新回执是可选事件；按照现有事件封套规则，旧读取器会忽略未知事件类型。continuum-memory 来源仅用于归因：未加载 Continuum producer 的读取器仍保留消息内容，同时保留来源 kind。不需要提升 Session 格式版本。

<a id="verification"></a>
## 验证

Continuum 的记录、持久化、检索、上下文、Jev adapter 测试均在本地通过。已针对变更后的源码运行持久化目录生成器和确认检查器。真实 Jev gateway 在本次验收窗口内未计为通过，因为配置的 RunPod 与官方 DeepSeek HTTPS 端点均发生 TLS 超时。

<a id="dev-note"></a>
## 开发备注

无。
