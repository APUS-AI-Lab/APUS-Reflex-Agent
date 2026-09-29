---
description: "运行独立 Harness，区分已实现与规划中的 Jev 集成。"
---

# 独立 Jev 集成

[English](README.md) | 中文

## 概要

本项目将 Jev 作为 DeepSeek Harness 内部的决策模型发展：生成模型提出工作，Jev 评估有界问题，确定性代码检查动作是否被允许。仓库提供独立、通用的 Agent 运行时。当前实现提供显式的类型化决策与可回放影子记录；尚未自动路由每个请求，也不能验证任意任务是否完成。

## 目录

- [独立运行](#run-independently)
- [挂载 Jev](#mount-jev)
- [集成路线](#integration-roadmap)
- [验证独立性](#verify-independence)
- [开发备注](#dev-note)

<a id="run-independently"></a>
## 独立运行

使用[根 README](../../README.zh.md#run-from-source)介绍的源码构建。标准 Web、headless 与 SDK profile 保留各自的模型配置。可选 AG-UI 桥接受兼容客户端及客户端指定的人格；默认身份与能力说明不绑定具体产品。

<a id="mount-jev"></a>
## 挂载 Jev

[Jev overlay](system3-jev.patch.yml)挂载现有决策 provider 与 System3 服务，不替换生成模型。`JEV_ENDPOINT` 与 `JEV_MODEL` 必填；此 overlay 发起决策时还要求 `JEV_API_KEY` 凭据引用。缺失凭据会返回不可用决策，不发送匿名请求。overlay 默认采用 local-only 准入与 network 执行域，因此宿主只有在推理确实发生于本机时，才能显式声明 `JEV_EXECUTION_DOMAIN=local`。通往远端 GPU 的隧道仍是网络执行，需要单独审核的 controlled 隐私策略。

```sh
pnpm dsh --patch docs/feat-independent-harness/system3-jev.patch.yml --profile headless --dump-config
```

该命令检查组合配置，不发起 Jev 决策。消费者以分类后的事实及独立检查调用 `ctx.system3.shadowDecision`，再从当前或恢复后的 Session 读取 `lastDecision`。参见 [System3 包](../../packages/experimental/system3/README.zh.md)与 [Jev provider](../../packages/experimental/apus-dsh-jev-plugin/README.zh.md)。当前记录保存输入、模型答案、确定性基线、provider 报告的用量，以及隐私拒绝或 provider 失败。仅挂载服务不会安装自动监督逻辑。

<a id="integration-roadmap"></a>
## 集成路线

[设计方案](design.html)定义后续切片。下列自动行为均为规划，不能当作已实现功能。

| 阶段 | 交付物 | 验收证据 |
|---|---|---|
| 独立底座 | 产品无关的 Harness、类型化 Jev provider、影子记录与回放 | 无密钥 HTTP 集成、会话回放、独立运行时组合 |
| 有证据的决策 | 有界目标、轨迹及 verifier 输入，明确隐私分类 | 完整持久化输入、证据引用、无未授权外发 |
| 自动影子监督 | 在文档化的生命周期事件调用 Jev，保持执行行为不变 | 真实 AgentLoop fixture、取消、回放及基线对照 |
| 有界控制 | 确定性干预预算下采纳允许的继续、重试、升级建议 | 检查失败、目标过期、预算及并发回归 |
| 路由与委派 | 从准入的模型或专家候选中选择 | 配对任务成功率、总成本及延迟测量 |

Choice 概率不等于校准后的成功率；模型提出 `candidate_done` 不证明任务已经完成。将当前 supervisor 晋级为自动完成判定者之前，必须处理空检查列表及通过项缺少证据的问题。当前影子输入只有结构化检查事实，不包含用户任务的语义投影。决策质量与成本收益仍未证明。

<a id="verify-independence"></a>
## 验证独立性

聚焦单测与 HTTP 集成测试位于 `packages/experimental/{agui,apus-dsh-jev-plugin,system3,system3-policy,system3-evidence,system3-supervisor}`。无密钥 `system3-shadow` SDK 场景回放持久化决策记录。[交接文档](../../tasks/feat-independent-harness/handoff.md)记录实际执行的命令与结果；仅检查源码不能证明部署就绪。

<a id="dev-note"></a>
## 开发备注

独立 CI 在 GitHub-hosted Ubuntu 执行无密钥 Jev/System3/AG-UI 测试、host 构建、Ruff 及 System3/人格 SDK 回放。继承工作流要求仓库变量 `DSH_UPSTREAM_AUTOMATION=true`；在适配其 runner、secrets 和发布部署目标之前，应保持未设置。跳过的上游任务不是验证证据，此聚焦工作流也不等于完整的上游平台矩阵。

旧 `docs/feat-system3-foundation`、`docs/feat-dsh-agui` 与任务记录保留来源项目历史和可选部署示例，不定义本项目默认部署。此快速入口不使用其中的 SSH 凭据脚本或 App overlay。保留源码历史与上游许可证；本次初始化不重命名或重新发布包。
