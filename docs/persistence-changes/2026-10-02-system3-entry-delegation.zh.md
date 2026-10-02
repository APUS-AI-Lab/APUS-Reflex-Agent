---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-02-system3-entry-delegation

[English](2026-10-02-system3-entry-delegation.md) | 中文

## 概述

为 System3 入口决策的候选新增可选的委派目标，并新增 system3-delegation 用户消息来源。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-02-system3-entry-delegation
baseline: false
changes:
  - root: "event:agent/inbox/spliced"
    previous: "2026-09-16-session-format-v4"
    after: "ce37491ebd158783a03c8dc4cf95f6395e68d32db64c4991ab6974e468afdc1e"
    decision: same-version
  - root: "event:developer/message"
    previous: "2026-09-16-session-format-v4"
    after: "2b3c955cf3c1fa480a9e90cf19c76025db80138be75bb24ca05a4e544d2b0ebf"
    decision: same-version
  - root: "event:session/title-llm-request"
    previous: "2026-09-16-session-format-v4"
    after: "29eb43aa171e65a15bc49c632bb092af59f21f1d9131a62bbdd56d71d08448df"
    decision: same-version
  - root: "event:system3/entry-decision"
    previous: "2026-10-02-system3-entry-candidate-label"
    after: "0cfb145b502a904af1045bbed75063afa0713b8155f27b54d2fcc0d0ff2e6f29"
    decision: same-version
  - root: "event:user/message"
    previous: "2026-09-16-session-format-v4"
    after: "2e5ce80ebb1064ff297c922fbfa63b984d84fdca0cdfea45eb3c1254f4a6e412"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有记录和消息仍然有效。只有 Jev 选中委派候选时，路由器才写入委派目标；随后 System3 注入一条来源为 system3-delegation、写明 subagent 工具的用户消息。决策、注入的指令和之后的工具调用仍是独立的 Session 事实。忽略新来源的读取方会把该指令当作普通用户消息。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/experimental/system3/tests packages/experimental/client-ui-system3/tests：全部测试通过，覆盖只在 provider 和工具可用时提供委派、每个委派输入只注入一条指令，以及投影的已注入和已调用阶段。

<a id="dev-note"></a>
## 开发备注

无。
