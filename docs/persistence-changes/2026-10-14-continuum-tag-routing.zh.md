---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-14-continuum-tag-routing

[English](2026-10-14-continuum-tag-routing.md) | 中文

## 概述

为 Continuum 记忆判断回执新增可选的标签路由：路由请求、响应和选中的 L1 标签；标签列表为空且没有排序，表示路由未选中任何标签。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-14-continuum-tag-routing
baseline: false
changes:
  - root: "event:continuum/memory-decision"
    previous: "2026-10-13-continuum-relevance-evaluation"
    after: "b74161b6a6e4a4a87014a0b73610e5cf71d5ecf04e6989b31e47a0cbcd1dcc95"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增可选字段；已有回执仍然有效，回放结果不变。只有阈值选择且候选数超过 routeAbove 时才会路由，因此没有路由的回执含义不变。回放从不重新调用 Jev。

<a id="verification"></a>
## 验证

Continuum Jev 选择测试覆盖按标签路由、未选中标签、路由失败，以及路由的 state 和措辞；Continuum 核心测试覆盖带标签的选择候选池和召回字节预算。

<a id="dev-note"></a>
## 开发备注

无。
