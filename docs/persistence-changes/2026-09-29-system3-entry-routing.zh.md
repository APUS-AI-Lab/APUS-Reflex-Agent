---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-29-system3-entry-routing

[English](2026-09-29-system3-entry-routing.md) | 中文

## 概述

新增分别持久化的 Jev 入口建议与自动采用的模型选择，通过输入请求 ID 关联。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-29-system3-entry-routing
baseline: false
changes:
  - root: "event:model/automatic-selection"
    previous: null
    after: "8cf64ffe0f1b4f590140051634a0abb3513a07fd9c699d393620189321536a92"
    decision: same-version
  - root: "event:system3/entry-decision"
    previous: null
    after: "b391a61506715ea660db7c77d9b23bd3bd69942e758dab5b3e8ee88354b47631"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有事件载荷保持不变。两个新增事件均为读取时必需的事件：无法识别它们的旧版本会拒绝读取此类日志。新增事件名不改变 Session 事件封装格式。API 模型选择投影从既有记录和新的自动选择记录重建带版本的缓存。

<a id="verification"></a>
## 验证

node_modules/.bin/vitest run packages/experimental/system3/tests 在四个文件中通过 25 个测试，包括 Loader HTTP 组合测试。node_modules/.bin/tsc -b packages/experimental/system3 --pretty false 通过。持久化分类报告两个新增事件根，均无需增加格式版本。 TypeScript SDK 使用构建产物回放，通过两个 System3 场景。Python SDK 入口路由 smoke 使用本仓库的官方 dsh 启动器，无需模型凭据，通过 SDK 事件载荷与持久化 JSONL 的对比；这验证协议和持久化，不代表打包可执行文件验收。

<a id="dev-note"></a>
## 开发备注

无。
