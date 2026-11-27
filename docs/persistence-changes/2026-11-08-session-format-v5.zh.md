---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-session-format-v5

[English](2026-11-08-session-format-v5.md) | 中文

## 概述

将 Session 写入器版本从 4 升到 5，以便确认当前 schema，并记录已接受的 V4 基线之后累积的类型变化。破坏性变化有两项：仅日志的 `lsp/provider-selected` 与 `web/provider-selected` 事件被移除，由统一的 `tool/provider-selected` 记录取代；`continuum/memory-index.data.admission.source` 由字面量 `compaction` 放宽为 `compaction | user-message`。其余根类型只是新增可选属性或新的仅日志事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-session-format-v5
baseline: false
changes:
  - root: "SessionHeader"
    previous: "2026-09-16-session-format-v4"
    after: "22c6899a78214dd841c266348ae997027ef391174ddb21127f1b71dc1b362824"
    decision: version-bump
  - root: "event:agent/inbox/spliced"
    previous: "2026-10-14-system3-prefetch"
    after: "1fe33cf301dd7e25fc4df76f0e3fb360f359653f4a085328eb6dd85e5337937b"
    decision: version-bump
  - root: "event:continuum/memory-budgeted"
    previous: null
    after: "3cc94e3b1009e365fd25bdd2dfb1181bf0ec5d3191195cc4a98fd2f2a7045ae8"
    decision: version-bump
  - root: "event:continuum/memory-index"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: "d957369b30f16bf1f17c395b424b35915bc39bd8fbdf792403084feebc4cf681"
    decision: version-bump
  - root: "event:continuum/memory-index-queued"
    previous: null
    after: "90decc8b160b1783fbed0653e9e7c6f8ec2d8e9bf969494792e5d0e30dce77bd"
    decision: version-bump
  - root: "event:continuum/memory-index-rebuilt"
    previous: null
    after: "1e56911072efa80548cb770e4307a55d631abafc7c980a395b2dcfa1bcee9532"
    decision: version-bump
  - root: "event:continuum/memory-injected"
    previous: null
    after: "3544f425275428b971445968a34ba6235158d1c9078ac278c07cf5abcb41f21a"
    decision: version-bump
  - root: "event:continuum/memory-recall-decision"
    previous: null
    after: "ebc96301fd38bc561480ea9f1f751811bc92f787e5cd3e44449df6200fb69793"
    decision: version-bump
  - root: "event:continuum/memory-retrieval"
    previous: null
    after: "1436683bce21c83423016fc410d772eb5a4c96b41a8fbe19d4129451574bc803"
    decision: version-bump
  - root: "event:continuum/memory-scored"
    previous: null
    after: "d12879f833e7a326e0664e87bb3638d97194b612bd79541e8a1d07f824b1c10c"
    decision: version-bump
  - root: "event:developer/message"
    previous: "2026-10-14-system3-prefetch"
    after: "da37a00edc3c9ac64c5505fea471c0acfa882f5e88cdd6c5cf58bfc688cca16a"
    decision: version-bump
  - root: "event:job/settled"
    previous: null
    after: "3a2b9280ee61ea2cda5c13a1101a8d577bb6e84f7bf1c78088c9cfba6b781bf5"
    decision: version-bump
  - root: "event:lsp/provider-selected"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: null
    decision: version-bump
  - root: "event:session/title-llm-request"
    previous: "2026-10-14-system3-prefetch"
    after: "2119ad33d027df8d72be2aad1a3a76105f41a5fde731a3913ee8631130429391"
    decision: version-bump
  - root: "event:subagent/model-selection-observation"
    previous: null
    after: "4beaa17506f917ebba34fef47f0821f19547052e3ab3e72a0aa7720d8d3c1822"
    decision: version-bump
  - root: "event:subagent/run-end"
    previous: null
    after: "1d61ae85033c15eebce776bb95fdb65c9a8d1c81c02a972d6f306ff9cfb66049"
    decision: version-bump
  - root: "event:tool/catalog-resolved"
    previous: null
    after: "83edb7db54322540b15557d28e4eb4b0e282e6b27fa86145c9b7053dbbc3b8ad"
    decision: version-bump
  - root: "event:tool/execute-deadline"
    previous: null
    after: "15db0c5f5a596478297789f216b9c8180b17053a1eadb8d1d2dc2b53053cde2b"
    decision: version-bump
  - root: "event:tool/pre-execute-decision"
    previous: null
    after: "15ed1d7b80ecfd8e8b68ac190c84a439bad72263663c3adf7cad8c84419741f5"
    decision: version-bump
  - root: "event:tool/provider-selected"
    previous: null
    after: "63422af78a373fa2bc05cc0f201cbf6da367dde32effcf485e289b6032915052"
    decision: version-bump
  - root: "event:tool/result-rewrite"
    previous: null
    after: "0df20de5e4cd6ff603bdc6388a8d845ae1b216856b8d93f030d0f6c1d863bd40"
    decision: version-bump
  - root: "event:tool/retry-started"
    previous: null
    after: "db13c63746926d32ed5cc3dd232e0ae0d84f981b94f404637538b524345e3a80"
    decision: version-bump
  - root: "event:turn/stopping"
    previous: null
    after: "f85859dd522a7f907dc3ec6701b19b0e4797d9cc8c819ae9503fd75edc330bef"
    decision: version-bump
  - root: "event:user/message"
    previous: "2026-10-14-system3-prefetch"
    after: "406ffcd4751c5c68f6b67e097472b84eefa8ea805fbf05229b12d202a0c3423a"
    decision: version-bump
  - root: "event:web/deepseek-search-llm-request"
    previous: "2026-09-11-initial"
    after: "07b5fbbfe375e1587aff38307c4ee1e521cb0e5f2dfba47d6571fe1f8eff826d"
    decision: version-bump
  - root: "event:web/provider-selected"
    previous: "2026-10-29-wp5-trajectory-facts"
    after: null
    decision: version-bump
  - root: "event:web/search-route"
    previous: null
    after: "14704222bd712300a108fa710fd70e97aaf866e13b9abf5853f16b8bbfb834b3"
    decision: version-bump
```

<a id="compatibility"></a>
## 兼容性

V5 写入器沿用 V4 的物理行框架，且不追加需要转换的载荷，因此读 V5 日志的 V4 运行时必须按版本拒绝，而不能误读。新边 `@deepseek-ai/dsh-session-format-v4-to-v5` 只提升头部：它原样转发每个事件，在 seeded 源未提供继承切点时依据最后一个 inherited end-seed 标记推导，并用已发布的 V4 准入规则校验目标。普通事件新增和可选载荷属性本身不要求升版，逐事件的 `ignorable` 标记负责覆盖词汇增长。本次升版是因为已接受的 V4 基线已把两个事件移除和 admission source 的类型变更判定为破坏性，`verify-persistence-changes` 在 v4 定稿检查点下拒绝以同版本记录确认它们。本次变更之前写出的记录仍可读，V4 生成物保持原样。被移除的事件从未由已发布的 V4 写入器写出：引入提供方选择的那次部署变更当时追加的就是 `tool/provider-selected`，因此没有任何已提交日志载有旧名，该边也不需要事件改名。仍在已读日志中遇到 `lsp/provider-selected` 或 `web/provider-selected` 的读取方把它们当作历史记录，V5 不为它们增加解释。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/session/session-format-v4-to-v5/tests/migration.spec.ts：10 个测试通过。该套件覆盖仅头部提升、事件对象与坐标不变、紧凑运行转发、各阶段状态独立、继承切点推导与不一致拒绝、V4 框架往返、V5 头部与物理记录拒绝、稀疏行、未知必需事件拒绝且保留 ignorable 载荷、seeded 标记一致，以及 V5 交付归属。在交付校验中注入缺陷时，归属测试先失败，恢复后重新通过。

<a id="dev-note"></a>
## 开发备注

无。
