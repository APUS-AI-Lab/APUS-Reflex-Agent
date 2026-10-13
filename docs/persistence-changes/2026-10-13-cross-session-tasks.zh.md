---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-cross-session-tasks

[English](2026-10-13-cross-session-tasks.md) | 中文

## 概述

新增跨会话持久任务操作和业务 Session 的不可变任务绑定。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-cross-session-tasks
baseline: false
changes:
  - root: "event:continuum/task-binding"
    previous: null
    after: "a7f4ecd9f59ad6b3bf422e50f046b234701a59499580ab11671a42aaf8865de8"
    decision: same-version
  - root: "event:continuum/task-operation"
    previous: null
    after: "a58e387cc30b034ac55f2cb8ffa9a2d6b00e908e4937320f8b6c0f787a1b1913"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有 Session 事件与头字段不变。新增事件是当前写入版本下的可追加类型，读取端不认识这些必读事件时拒绝相应日志。域日志使用独立 JSONL 根目录，不混入业务 Session。已接受的持久化历史记录保持不变。

<a id="verification"></a>
## 验证

任务日志 39 项测试通过，覆盖 JSONL 冷重开、CAS、幂等、flush/readback 失败与损坏日志；来源读取 28 项通过，覆盖规范工作区授权、定向持久化 flush 与人类原文回读；任务服务 20 项通过，覆盖不同 Session 恢复、授权隔离、撤销后拒绝发送、请求串行化及禁用串行化负控。

<a id="dev-note"></a>
## 开发备注

无。
