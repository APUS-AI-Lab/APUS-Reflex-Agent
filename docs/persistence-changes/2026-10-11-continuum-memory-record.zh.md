---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-11-continuum-memory-record

[English](2026-10-11-continuum-memory-record.md) | 中文

## 概述

新增仅写日志的 Continuum memory-record 事件，用于记录有来源的记忆记录变更。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-11-continuum-memory-record
baseline: false
changes:
  - root: "event:continuum/memory-record"
    previous: null
    after: "229669c953c776861d1f8dd4e6f2e99eb572237979a2fd4ffc8a5c0fab7b2569"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是新增事件根，不改变已有事件载荷，也不升级 Session 格式版本。不认识该事件的旧 reader 按现有未知事件失败关闭策略拒绝日志；只有声明该事件的 Harness 才启用这项能力。

<a id="verification"></a>
## 验证

Continuum 持久化测试写入 create、supersede、deactivate 三类事件，使用现有 JSONL Session persistence 执行 flush，重新挂载 Context 后读取事件并折叠为完全一致的记录快照。包级 TypeScript 构建和聚焦事件测试通过。

<a id="dev-note"></a>
## 开发备注

无。
