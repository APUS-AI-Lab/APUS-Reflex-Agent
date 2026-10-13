# 读取完整的 Continuum 原文

[English](README.md) | 中文

## 概要

[原文读取 overlay](../../apps/cli/config/examples/continuum/source-read.cordis.yml) 为已配置的 profile 添加现有的工作区授权 Session 工具。模型可沿 Continuum 来源引用分页读取准确原文，并在下一次请求中使用各页内容。这是独立的显式启用项；Continuum 实时开关不会撤销这些工具。

## 目录

- [启用原文读取](#enable-source-reads)
- [读取与续页](#read-and-continue)
- [验证](#verification)
- [限制](#limits)
- [开发说明](#dev-note)

<a id="enable-source-reads"></a>
## 启用原文读取

从已构建且模型配置可用的源码仓库开始。在已有 `pnpm dsh --profile headless` 命令中添加 `--patch apps/cli/config/examples/continuum/source-read.cordis.yml`。使用自动召回时保留已有 Continuum 与模型 patch；此 overlay 不配置模型，也不启用 Continuum 输入接纳。

此 overlay 保留默认的 8192 字节事件读取结果预算。移除 overlay 并重启 profile 即可移除其工具。默认关闭全文索引时仍可准确读取原文；`session_search` 与 `session_event_search` 需要另外启用索引。完整的工具与配置语义见[工具包](../../packages/session-query/tool-session-query/README.zh.md)。

<a id="read-and-continue"></a>
## 读取与续页

让模型沿召回的 `sources` 条目调用 `session_event_read`，将 `sessionId` 传为 `session_id`、`eventSeq` 传为 `seq`。读取原始消息文本时选择 `view: "text-block"` 和对应文本的 `block` 序号。使用返回的 `next_offset` 和 `sha256` 继续读取，直到 `next_offset` 为 null。模型收到普通的持久化工具结果；原文不会被生成式摘要替换。

遇到事件变化错误时，应从偏移零重新读取。遇到工作区拒绝时，应选择已授权的来源；提供其他会话 ID 不会授予访问权。完整分页规则及 JSON 与文本的区别见[原文分页参考](../../packages/session-query/tool-session-query/README.zh.md#use-this-package)。

<a id="verification"></a>
## 验证

无密钥 Headless 验收使用已配置的录制模型，并保留真实工具、持久化、授权和子进程重启：

```sh
pnpm exec vitest run --config vitest.e2e.config.ts apps/cli/tests/profiles/headless/tests/continuum-source-read.e2e.ts
```

SDK 场景回放模型工具调用，读取经公开持久化接口写入的固定原始事件，并保留其真实摘要值：

```sh
pnpm run test:snapshot snapshots/sdk/sdk.snapshot.ts -t continuum-source-pages
```

<a id="limits"></a>
## 限制

此源码仓库 overlay 不改变桌面端/Web 默认组合。它不会将工具可用性绑定到 Continuum 实时开关，不提供跨工作区访问，也不会自动处理全部历史输入。有界分页保留所选原文；完整任务覆盖和上下文调度仍是[整体设计](../feat-lossless-memory/design.html)中的独立要求。

<a id="dev-note"></a>
## 开发说明

[集成设计](design.html)记录本批的组合与证据范围。
