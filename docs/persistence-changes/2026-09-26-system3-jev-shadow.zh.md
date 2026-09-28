---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-09-26-system3-jev-shadow

[English](2026-09-26-system3-jev-shadow.md) | 中文

## 概述

新增显式 Jev 影子监督使用的非模型可见 system3/decision receipt。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-09-26-system3-jev-shadow
baseline: false
changes:
  - root: "event:system3/decision"
    previous: null
    after: "b923b60d7839c5e3d3e03be20abbe587b9029440c839b8459cd1672149f971fe"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录的声明 schema 保持有效。新事件保存完整的结构化 Jev 请求与结果，并保留未改变的确定性 supervisor 结果。不认识此必读事件的旧构建会拒绝读取日志；这次事件词汇扩展不改变 Session envelope 版本。

<a id="verification"></a>
## 验证

真实 Loader composition 测试驱动 llm-pi-ai 和 System One HTTP，flush JSONL 并恢复成功与失败 receipt，确认重放不新增 HTTP 请求。协议、隐私、超时和取消行为均有针对性测试。

<a id="dev-note"></a>
## 开发备注

无。
