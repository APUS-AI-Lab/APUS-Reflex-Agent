---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-recall-query-origin

[English](2026-11-08-recall-query-origin.md) | 中文

## 概述

为检索事件与召回决策事件新增可选 `queryOrigin`，并为召回决策事件新增 `alreadyPresentRecords`，记录召回查询的来源以及本次请求已包含的记录数。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-recall-query-origin
baseline: false
changes:
  - root: "event:continuum/memory-recall-decision"
    previous: "2026-11-08-session-format-v5"
    after: "62c71a62e2a2750232cda7672d1505ca1f8742249e4d44017e6766b30cb36b05"
    decision: same-version
  - root: "event:continuum/memory-retrieval"
    previous: "2026-11-08-session-format-v5"
    after: "5078a685d07859721694955c12182f6f793ba6bfdb95841b65bf7098d217ef18"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录仍然有效且保持不变。这三个属性都是仅日志的可选事实，从不进入模型 surface；不认识它们的旧读取方会忽略，回放也不会据此派生记录或注入。`querySource` 因属于每条旧记录而保持原类型；来自 Session goal 或执行文本的新查询只写入 `queryOrigin`，`querySource` 保持旧值，因此该改动不需要 Session 格式版本升版。已逐字存在的召回沿用既有的 `no-query-match` 原因并设置 `alreadyPresentRecords`，因为原因联合新增成员需要版本升版。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/context/continuum/tests/context.spec.ts：42 个测试通过；pnpm run gen-persistence-catalog --check：已是最新。

<a id="dev-note"></a>
## 开发备注

无。
