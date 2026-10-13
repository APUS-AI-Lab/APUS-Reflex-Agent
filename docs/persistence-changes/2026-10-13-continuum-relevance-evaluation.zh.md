---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-continuum-relevance-evaluation

[English](2026-10-13-continuum-relevance-evaluation.md) | 中文

## 概述

为 Continuum 记忆决策回执添加可选批量相关性 evaluation，包含 prepared 与 settled 阶段、完整有界请求与响应及全候选排序元数据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-continuum-relevance-evaluation
baseline: false
changes:
  - root: "event:continuum/memory-decision"
    previous: "2026-10-11-continuum-memory-decision"
    after: "24a0ed8247a7e53928a16190a4db75daac26f27c02f705a4d36dc0daee5ba804"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

历史 version-one 回执无需 evaluation 仍然有效。新回执保留已有字段与版本。prepared unknown 回执在发送前记录获准输入；取消或进程失败可没有 settled 结果。回放不调用 provider。

<a id="verification"></a>
## 验证

Continuum Jev 单元与真实 Loader/JSONL/OpenJev/Typesafe HTTP 组合共 39 项通过；selector 源码语句、分支、函数和行覆盖率均为 100%。覆盖互补及低分记忆保留、未知分类拒绝、HTTP 前持久化及生命周期失效阻止发送。

<a id="dev-note"></a>
## 开发备注

无。
