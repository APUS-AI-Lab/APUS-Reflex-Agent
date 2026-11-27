---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-29-wp5-trajectory-facts

[English](2026-10-29-wp5-trajectory-facts.md) | 中文

## 概述

新增十个仅日志事件，以及既有事件体上的可选属性，且这些事实都无法由探针侧读取。agent 循环记录每轮的 pre-step 处置（被拒绝的提议不会开启 step，日志是这次拒绝唯一的留存处）与每步的执行计划；工具管道记录管道错误的精确阶段与抛出者；超时策略、溢出策略、skill 注册表、web 与 LSP 的 provider 选择、审批接缝的无服务降级、回答者回执与 Continuum journal 回执，各自在提交点记录属主事实。既有事件在压缩起止、请求头与上下文、轮次结束、工具结果、PTC 分发、Continuum 记忆与任务绑定、reflex 缓存锚点、审批决定与工作区变更上增加可选字段。凡是探针能从公开缝读到的事实（已解析工具目录、pre-execute 与 post-execute 决策、结果改写、截止时间计时、turn-stopping 聚合、inbox 取消、工具归属）都留在探针侧，不在此写入。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-29-wp5-trajectory-facts
baseline: false
changes:
  - root: "event:approval/decided"
    previous: "2026-09-11-initial"
    after: "1d6245c887b3b46dd7380b030aff9ca37d82b411dadcd1ff319f82f19103c720"
    decision: same-version
  - root: "event:approval/unavailable"
    previous: null
    after: "bfc9af609afd6a5f25784896f522ef859446bb4abc5539166605db095f57eff4"
    decision: same-version
  - root: "event:compaction/end"
    previous: "2026-09-11-initial"
    after: "465928649d1f783833f94c56e32973f4c8d83d4ddfac4a9fb08b2367c81d1e35"
    decision: same-version
  - root: "event:compaction/start"
    previous: "2026-09-11-initial"
    after: "7a555dc46fd3452b9511462391a26980c6a6f6bebd0fdc8a64aa882331a4cf47"
    decision: same-version
  - root: "event:continuum/memory-admission"
    previous: "2026-10-14-continuum-memory-admission"
    after: "58e4b099d1f8aa9b18b563fd18444a507b523e3f8ee31ae14a7dd2f0ef568a93"
    decision: same-version
  - root: "event:continuum/memory-decision"
    previous: "2026-10-14-continuum-tag-routing"
    after: "cc3669886d11f489c62a8d05718124468f4cdb4bf87707c0c04e1e1c3a6fa530"
    decision: same-version
  - root: "event:continuum/memory-index"
    previous: "2026-10-14-continuum-memory-admission"
    after: "a584d92e1bdb0edb34cbeabf743208dee4e8faf4eb22f1c27c9b5a8a17827e4f"
    decision: same-version
  - root: "event:continuum/memory-record"
    previous: "2026-10-11-continuum-memory-record"
    after: "58dcdae3ef200ae86529df4759b462debbcb50070ada273c374b4a7fa7c2c77b"
    decision: same-version
  - root: "event:continuum/task-binding"
    previous: "2026-10-13-cross-session-tasks"
    after: "2f27b8a61e281bcfa57508f9871ecd2420e03e84cbc632226df4fd7ccd5f9c5b"
    decision: same-version
  - root: "event:continuum/task-receipt"
    previous: null
    after: "28f74c18a98cc0e36c93365eacfde691e48edbbdf572a7f781fadee7b88e460a"
    decision: same-version
  - root: "event:lsp/provider-selected"
    previous: null
    after: "f0f6ac6fd0819e816149b8f81e5ecb7ef9963f0b6c252788c2c4604c3929bcbe"
    decision: same-version
  - root: "event:reflex/context-cache-anchor"
    previous: "2026-10-10-reflex-control"
    after: "fbb61681de5d23d2e3154affd1d933cae2c1c28810ffc687dc83d3738efb025c"
    decision: same-version
  - root: "event:request/context"
    previous: "2026-09-11-initial"
    after: "3868c8800c2d32e50fb47365a6d6da405985ae69e9b08ef5541de2a0df66435b"
    decision: same-version
  - root: "event:request/header"
    previous: "2026-09-16-session-format-v4"
    after: "01e171dca28ceb008e4dedee5f179edbcbed51167f8109566a7850a1b7e6cd99"
    decision: same-version
  - root: "event:skill/loaded"
    previous: null
    after: "960d0d368eb8e26ba92090024267e3307c43f94979b9bf035259470495386d98"
    decision: same-version
  - root: "event:spill/spilled"
    previous: null
    after: "6042f95f9dbb962193d0ddf844c3abfe78018e8f76119ef3e3444d6125657368"
    decision: same-version
  - root: "event:tool/execution-plan"
    previous: null
    after: "bf1ec7cfd073c2c4c718ff1e0a7cf6e9f91d2495184e5d2b554df8772e5fd491"
    decision: same-version
  - root: "event:tool/pipeline-error"
    previous: null
    after: "5f4beefbb20ee0571cfad0a210e73e3007140b956658e3687ef41321ad20bda8"
    decision: same-version
  - root: "event:tool/ptc-dispatch"
    previous: "2026-09-16-session-format-v4"
    after: "83355b96d5212116e4067b73f9d592254d8fe5e8ce5bc376af7d232dfffa5e35"
    decision: same-version
  - root: "event:tool/ptc-dispatch-start"
    previous: "2026-09-11-initial"
    after: "81d3eada05c8dd4912687ee8d0b2e0f73ff64d7fb5135549b2821d479c1d9672"
    decision: same-version
  - root: "event:turn/end"
    previous: "2026-09-16-session-format-v4"
    after: "522768b39af8ace05e9bd642bbf93d0b42a61c2460d1af4673d5bb15848886aa"
    decision: same-version
  - root: "event:turn/pre-step"
    previous: null
    after: "08eb09eac7a6489c7d0c19d0d4e7396340e7027ee7c7ae7dab57265bce8ec76a"
    decision: same-version
  - root: "event:user-question/answered"
    previous: null
    after: "678323dcfa591b76f6d5bf0d83ea61a7e1f126bf200aa8a7189de4b71fb006fb"
    decision: same-version
  - root: "event:web/provider-selected"
    previous: null
    after: "21f900ba604573e685be0623cd2d34b944512fbb6dde68724ee4f200bc1d0f2c"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

所有检测到的变更都是增量且判定为同版本。可选属性在此前写入的记录中不存在；读取端把缺失视为“未记录该事实”，不得推断。新的普通事件类型通过 Session.append 写入，而该 API 无法设置信封 ignorable 标记，因此旧构建读取含这些事件的日志时会按 required-on-read 规则拒绝——这是既定的安全失败而非静默误读，也是当前生成器已登记的新词汇不需要提升 SESSION_FORMAT_VERSION 的原因。不对模型可见或跨运行变化的文本记录摘要：request/context 只记 section 名、不带逐段哈希；pre-step 改写只记 id 增量、不带批次摘要；spill 记录不含存储文本与预览摘要——因为这些文本内嵌时钟时间、每次运行不同的 locator 文件名与插值后的 cwd，快照夹具无法归一化，读取端也无法反推。所有新记录都是仅日志：deriveMessages() 忽略它们，恢复、授权、投影与调度路径都不读取；tool/result 仍以持久结果为准，Continuum 隔离 journal 仍是其只读回执背后的唯一权威。

<a id="verification"></a>
## 验证

执行 verify-persistence-changes --check --json：所有检测到的根均为同版本。重新生成持久化目录与 schema 清单，使 KNOWN_SESSION_EVENT_TYPES 与仍有写入者的事件一致。跑受影响包套件：core/agent-loop、core/tools 与 guard/timeout-policy（892 个用例），spill-policy（57 个），以及 interaction、web、LSP 套件。在移除跨运行可变摘要后，keyless 刷新并复验录制会话快照；模型可见消息内容与改动前夹具逐字段核对未变。

<a id="dev-note"></a>
## 开发备注

无。
