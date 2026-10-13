---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-13-reflex-input-intent

[English](2026-10-13-reflex-input-intent.md) | 中文

## 概述

为 System3 Skill 决策回执及可回放的客户端视图增加可选的有界输入意图分类。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-13-reflex-input-intent
baseline: false
changes:
  - root: "event:system3/skill-decision"
    previous: "2026-10-01-system3-entry-skill"
    after: "adb7756e9caefc250f3b00df121661a0a1c99baee3ed8587b99f865d165d9675"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

既有 v4 回执可以不含 intent 并继续有效。新写入仅使用六种声明的意图标签；字段缺失表示未获得分类，绝不代表已执行动作。派生 system3Runtime 缓存版本由 16 升至 17，并从不变的会话日志重新生成。

<a id="verification"></a>
## 验证

Skill 选择、桌面配置 Loader 组合及运行时投影聚焦测试通过；非法或低置信标签不展示，新轮次清除上一轮标签。

<a id="dev-note"></a>
## 开发备注

无。
