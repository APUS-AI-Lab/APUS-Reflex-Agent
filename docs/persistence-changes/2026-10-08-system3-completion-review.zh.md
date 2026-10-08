---
description: "记录持久化类型更改及其兼容性确认。"
kind: persistence-change
---

# 2026-10-08-system3-completion-review

[English](2026-10-08-system3-completion-review.md) | 中文

## 概述

新增 System3 完成核验审计事件。

## 目录

- [声明](#declaration)
- [兼容性](#compatibility)
- [验证](#verification)
- [开发备注](#dev-note)

<a id="declaration"></a>
## 声明

```yaml persistence-change
schemaVersion: 1
id: 2026-10-08-system3-completion-review
baseline: false
changes:
  - root: "event:system3/completion-review"
    previous: null
    after: "75ad06e893027545fee49d958f7cdaaee1ef6411d8de5d14295a5befca1e1214"
    decision: same-version
```

<a id="compatibility"></a>
## 兼容性

已有 Session 记录仍然有效。新事件记录所核验的目标、判断、未满足要求的消息 id，以及工具调用是否被拒绝。此事件在读取时必须识别：不认识它的构建会拒绝该非 ignorable 记录。重新打开只读取审计，不重复 Jev 判断或目标更新。此普通事件新增保持当前 Session 格式版本。

<a id="verification"></a>
## 验证

System3 包的18个spec文件共243个测试通过，completion-review.ts、task-frame.ts和decision-kernel.ts的语句、分支、函数及行覆盖率均为100%。确定性屏障覆盖过期任务卡、旧目标回写、fork额度、关闭依赖、插件移除及用户取消。真实Loader、原生Goal与JSONL回归在生成前因未知事件失败，生成后通过。两个真实DeepSeek与Jev场景拒绝提前完成，使用原生文件工具实际读写，完成原生目标并重开相同日志；第二个场景将用户追加要求送入实际Jev问题。TypeScript SDK keyless回放与Python SDK smoke使用当前runtime。本地built Web浏览器验收记录实际拒绝、文件操作、完成及刷新后保留的历史。

<a id="dev-note"></a>
## 开发备注

无。
