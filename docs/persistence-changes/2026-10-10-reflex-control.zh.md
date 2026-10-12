---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-10-reflex-control

[English](2026-10-10-reflex-control.md) | 中文

## 概述

记录可恢复的Reflex上下文选择、已提交前缀保护、有来源的Codex监督与原生恢复，以及Goal入口委派。未调用提供方时，shadow判断回执可省略effort。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-10-reflex-control
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-04-system3-process-supervision"
    after: "c1fe95dac80771a3358fef7988bfd4ce07584e6eb971be00908a6604a13b4310"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-10-04-system3-process-supervision"
    after: "eb7aa640cc063b31859879d2544988b1b402ced64fb0dca47105a757c1daef80"
    decision: same-version
  - root: "event:reflex/context-cache-anchor"
    previous: null
    after: "7d81861752534ce9e1a57f4e16a5bdff43c0ef980b12bc0d9af77b153d0ecf05"
    decision: same-version
  - root: "event:reflex/context-projection"
    previous: null
    after: "90f1a61cc3b180a2e97bb0a81a5ff9dd88d884ea3c2d0cd3a733ca9de26202b7"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-10-04-system3-process-supervision"
    after: "743febf415a07c3f2f421712b3fb5a3872880959e81946d53620fad64558d53d"
    decision: same-version
  - root: "event:subagent/supervision-recovery"
    previous: null
    after: "1dd8db7c98269328f8a3ee3f1631091847480533820d6f9a8b2665d57728fc1d"
    decision: same-version
  - root: "event:subagent/supervision-steer"
    previous: null
    after: "a6a7c46282acd0caf7ef68ae71bebb8d778f607168430ce51e2ee8c9fefdb7b5"
    decision: same-version
  - root: "event:system3/decision"
    previous: "2026-09-26-system3-jev-shadow"
    after: "dbfbc640a8ae84ae7d7c605f63b7df0065f8de4061737e04001f915c7c3be8ef"
    decision: same-version
  - root: "event:system3/goal-entry"
    previous: null
    after: "840ee4fd78dd30b2160d2f57759c4cfae2472173400e2c6d593230454fb97373"
    decision: same-version
  - root: "event:system3/reflex-evidence"
    previous: null
    after: "2855e18062bae755c5f94fa3d8d40fbeeec2211e2a00825b52667172d0772c38"
    decision: same-version
  - root: "event:system3/reflex-recovery"
    previous: null
    after: "6863abf4ee0cb0727a5399cdee17739e8053682e63d268231a3783d92adefce7"
    decision: same-version
  - root: "event:system3/reflex-supervision"
    previous: null
    after: "4537ba05aa683ea4c9c183f73d891785e794322589ae6d0ade70e121f4ba6174"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-10-04-system3-process-supervision"
    after: "adf173c2b3a2f8207c6216719f6c9adf0a1b737d01e610ff1bc74ab5b7aedbc8"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

现有format-4记录仍有效。不认识新增必需事件类型的读取器会拒绝读取。仅归属标记的reflex-memory和system3-goal-delegation来源保留普通用户消息负载。恢复和委派意图标识所属Goal与执行；模型可见的精确委派输入及输出保留在日志中。原始会话事件和已提交历史代际保持不变。

<a id="verification"></a>
## 验证

定向行为测试覆盖上下文缓存保护、追加恢复、过期输入检查、Goal委派、自动纠偏及原生恢复权限。项目自带真实Codex app-server已中断受控停滞响应，在同一线程继续，并生成经独立检查的文件。这些检查不代表完整真实模型Web验收；组合改动的TypeScript/Python重放及其余浏览器场景仍待验证。

<a id="dev-note"></a>
## 开发备注

无。
