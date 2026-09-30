---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-01-system3-entry-skill

[English](2026-10-01-system3-entry-skill.md) | 中文

## 概述

记录恢复自动模式、入口决策开始和有截止期限的原生 Skill 选择收据。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-01-system3-entry-skill
baseline: false
changes:
  - root: "event:model/selection-reset"
    previous: null
    after: "55cccc53a50e1f166343b888724ec2785af115ec14afffb49fe8bd94f3ee3425"
    decision: same-version
  - root: "event:system3/entry-start"
    previous: null
    after: "0f109d50397f1d347b2f62df20bd1e21a200c839428c8bca5449e8ed37ab633a"
    decision: same-version
  - root: "event:system3/skill-decision"
    previous: null
    after: "2da260ec5f7fe67028206d4c6254ff01a52dfe9a7f9aa67dedf72324ac4748ce"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

新增必需事件名，不改变已有载荷或 Session 格式 4。不认识这些事件的构建会拒绝相应日志。Skill 指令复用现有 skill-invocation 来源，收据关联精确提交的消息。已有固定与自动选择历史保持原语义。

<a id="verification"></a>
## 验证

SessionController、Jev 与 System3 回归在最终来源复用调整前通过 51 个文件、966 项测试。调整专项通过 8 个文件、80 项测试，覆盖原生 Skill 注入、JSONL 回放、期限回退、取消和实际使用关联。Host 构建通过。

<a id="dev-note"></a>
## 开发备注

无。
