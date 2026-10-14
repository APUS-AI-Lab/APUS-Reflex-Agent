---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-continuum-memory-admission

[English](2026-10-14-continuum-memory-admission.md) | 中文

## 概述

新增 continuum/memory-admission 事件：记录一次 Reflex 判断，即 Continuum 把哪些被压缩的用户原话保留为记忆记录。

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
    after: "c85c189b80b451a3ad4e24fbc5af77a470329f90f33cfdb00a4e5b9ded830b28"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增事件类型，已有日志不受影响。准备阶段的回执在发出 Jev 请求之前持久化并读回确认；取消或进程失败后，它可能没有对应的完成回执。完成回执列出所有被判断的候选及被保留的子集；回放时读取回执，从不重新调用 Jev。早于此类型的构建会拒绝包含它的日志。

<a id="verification"></a>
## 验证

Continuum Jev 写入测试：13 个通过，覆盖发出请求前持久化准备回执、每批最多 16 条以及失败回退。发行版 headless CLI e2e 每轮在独立进程中运行并接本地 Reflex 网关：6 个场景通过。

<a id="dev-note"></a>
## 开发备注

无。
