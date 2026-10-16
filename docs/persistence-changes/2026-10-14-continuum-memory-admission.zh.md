---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-continuum-memory-admission

[English](2026-10-14-continuum-memory-admission.md) | 中文

## 概述

新增两个 Continuum 事件：continuum/memory-index 是一条 L1 索引项，只保存 Reflex 标签和指向用户原话的指针，从不保存原文；continuum/memory-admission 是 Reflex 对被压缩的用户原话进行挑选和打标的一次判断回执。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-continuum-memory-admission
baseline: false
changes:
  - root: "event:continuum/memory-admission"
    previous: null
    after: "ebb630c555c99590587ad1ba0e4d02ee6f0d60f83c1673b7a1bb8e7c2c2ca0fe"
    decision: same-version
  - root: "event:continuum/memory-index"
    previous: null
    after: "09503da0d57aee064fcb4a8d523dc35879c3042ce1a4be9d9f8afb6f1c4ea077"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增事件类型，已有日志不受影响。折叠日志时从来源事件解析索引项的原文，因此日志中不会保存第二份副本。准备阶段的写入回执在发出 Jev 请求之前持久化并读回确认；取消或进程失败后，它可能没有对应的完成回执。完成回执列出所有被判断的候选、被索引的子集及各自的标签。回放从不重新调用 Jev。早于这些类型的构建会拒绝包含它们的日志。

<a id="verification"></a>
## 验证

Continuum 与 Continuum Jev 单元测试：334 个通过，覆盖从 L2 来源折叠索引、逐标签判断、发出请求前持久化准备回执以及失败回退。发行版 headless CLI e2e 每轮在独立进程中运行并接本地 Reflex 网关。

<a id="dev-note"></a>
## 开发备注

无。
