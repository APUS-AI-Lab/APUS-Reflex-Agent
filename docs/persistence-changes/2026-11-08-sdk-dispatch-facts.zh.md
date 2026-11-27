---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-11-08-sdk-dispatch-facts

[English](2026-11-08-sdk-dispatch-facts.md) | 中文

## 概述

新增两个仅记录日志的 Session 事件，保存最小模型派发事实：llm/dispatch（Session、确切已提交前缀终点、turn/step）与 llm/dispatch-settled（对应派发记录与被关闭的 assistant 结算事件）。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-11-08-sdk-dispatch-facts
baseline: false
changes:
  - root: "event:llm/dispatch"
    previous: null
    after: "51dc09b0cc092ccf146dc03542d280da687fbb519436865f78426991b6cbd609"
    decision: same-version
  - root: "event:llm/dispatch-settled"
    previous: null
    after: "5044ddd4d7ae6ef58098ffda9b908d944166c0b3d421608c3e58044bcf449696"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

两个事件都是新增、仅日志、不携带模型内容。缺少它们时既有记录照常可读；带这两个事件的新日志由本 build 读取，旧 build 按一般的词表增长规则拒绝未知类型。请求重建不依赖它们：没有这两个事件的日志与之前完全一致。

<a id="verification"></a>
## 验证

pnpm exec vitest run packages/sdk/server/tests packages/sdk/protocol/tests packages/sdk/client/tests：174 个测试通过。Python：PYTHONPATH=src python3 -m pytest tests/test_request_view.py tests/test_client.py tests/test_service.py：78 个测试通过。

<a id="dev-note"></a>
## 开发备注

无。
