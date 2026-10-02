---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-system3-entry-retained-route

[English](2026-10-02-system3-entry-retained-route.md) | 中文

## 概述

为 System3 入口决策记录新增可选的沿用路由字段。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-entry-retained-route
baseline: false
changes:
  - root: "event:system3/entry-decision"
    previous: "2026-09-29-system3-entry-routing"
    after: "be2c1d523179fc16f51f6b7c160c4e14def9b0bff4ea34ac29b64a76e47bb9fd"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效，不含该字段。只有启用 retainOnAbstain、Jev 弃权或置信度低于阈值、且上一轮路由仍是获准候选时，路由器才写入该字段。忽略该字段的读取方看到的仍是相同的 abstain 或 low-confidence 结果；System3 运行时投影版本已递增，缓存的折叠结果会带着沿用路由重建。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests：100 个测试通过，覆盖弃权与低置信度时沿用、provider 失败时回到 baseline、只沿用获准候选。

<a id="dev-note"></a>
## 开发备注

无。
