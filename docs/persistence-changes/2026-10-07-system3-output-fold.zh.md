---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-07-system3-output-fold

[English](2026-10-07-system3-output-fold.md) | 中文

## 概述

新增 system3/output-fold 事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-07-system3-output-fold
baseline: false
changes:
  - root: "event:system3/output-fold"
    previous: null
    after: "a08b64e63b930ddf31679dc4de8424786c7f497169323a50ab043b260545e26f"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

这是新增；已有 Session 不包含该事件。只有配置 outputFolding 且匹配的 shell 结果发生折叠时，System3 才写入 system3/output-fold；该事件只记录计数，本身不是模型可见内容。折叠后的文本本身就是记录下来的工具结果，工具的结构化 value 保留完整输出。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests/output-folding.spec.ts：13 个测试通过，覆盖折叠日志（含 CRLF）的逐字节还原、相邻重复的计数、链式副本、大小与节省门槛、经由 agent loop 的 active 与 shadow 模式、跳过的调用，以及加载时拒绝无效阈值和正则。

<a id="dev-note"></a>
## 开发备注

无。
