---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-system3-entry-candidate-label

[English](2026-10-02-system3-entry-candidate-label.md) | 中文

## 概述

为 System3 入口决策记录新增可选的已选候选及其显示标签。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-entry-candidate-label
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-10-02-system3-entry-retained-route"
    after: "dda31555cc43297d5150dde4b465457b4043b0c62583a9fa260104192fcddfe8"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效，不含该字段。Jev 选中候选或沿用上一轮路由时，路由器写入该字段，客户端在决策记录到达时即可显示配置的路由名称。忽略该字段的读取方看到的结果和选择不变。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests：全部测试通过，覆盖选中与沿用记录中的候选和标签、投影的路由以及客户端的路由提示。

<a id="dev-note"></a>
## 开发备注

无。
