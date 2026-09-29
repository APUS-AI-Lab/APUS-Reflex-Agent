---
description: "运行独立 Harness，区分已实现与规划中的 Jev 集成。"
---

# 独立 Jev 集成

[English](README.md) | 中文

## 概要

本项目将 Jev 作为 DeepSeek Harness 的原生决策模型发展：入口策略与调度是第一目标，执行过程更智能、更顺畅是第二目标。Jev 评估有界选择，DSH 拥有准入与执行，System2 承担开放推理与生成。仓库提供独立、通用的 Agent 运行时。当前实现提供显式类型化决策、可回放记录，以及可选的 Web/API 空闲文本入口选模。它尚未覆盖所有 DSH 入口，也不能验证任意任务是否完成。

## 目录

- [独立运行](#run-independently)
- [挂载 Jev](#mount-jev)
- [Fidoo 与入口选模](#fidoo-entry)
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

<a id="fidoo-entry"></a>
## Fidoo 与入口选模

[Fidoo overlay](system3-fidoo.patch.yml)使用现有 `llm-pi-ai` adapter，通过 OpenAI 兼容的 `https://proxy.fidoo.ai/v1` 调用模型。凭据读取环境变量 `SYSTEM3_LITELLM_API_KEY`，声明 `deepseek-v4-flash` 与 `deepseek-v4-pro`。两者采用保守的 131,072-token 上下文配置与 8,192-token 输出上限；这是部署配置，不代表网关最大能力。此生成配置也可单独使用。

```sh
pnpm dsh --patch docs/feat-independent-harness/system3-fidoo.patch.yml --profile headless "Reply with exactly READY. Do not use tools."
```

启用入口决策前，配置 `JEV_ENDPOINT`、`JEV_MODEL`、`JEV_API_KEY` 和 `SYSTEM3_LITELLM_API_KEY`，并用 JSON 数组形式的 `SYSTEM3_SESSION_DATA_CLASSES` 显式声明整个会话的数据分类。仅公开数据会话才能使用 `["public"]`。分类涵盖执行模型可能收到的历史；这是部署声明，不是自动敏感信息检测。[入口 overlay](system3-entry.patch.yml)据此批准 Jev 与指定生成候选处理这些分类。通过 loopback 隧道访问的远端 GPU 仍是网络执行。

```sh
pnpm dsh --patch docs/feat-independent-harness/system3-jev.patch.yml --patch docs/feat-independent-harness/system3-fidoo.patch.yml --patch docs/feat-independent-harness/system3-entry.patch.yml --profile web --no-open
```

新会话中，空闲、无待处理输入且没有人工选模记录的文本请求进入 Jev 有界判断。选中的模型用于该请求触发的整个回合，包含工具续步。Provider 故障、输入超限、弃权或置信不足时沿用 baseline；候选配置错误拒绝准入。取消阻止迟到的请求入队。人工选择模型后，此会话停用自动入口选模；首期可新建会话重新使用自动选择。

`system3/entry-decision` 保存完整决策请求与建议，`model/automatic-selection` 保存已准入的回合选型，`request/header` 标识实际调用模型。记录包含用户输入，适用 Session 日志的存储与访问策略。自动选择不覆盖用户保存的默认模型。附件、忙碌输入、headless、SDK、ACP 与可选 AG-UI 桥继续使用原准入路径。

实测部署的 `APUS-OpenJev-v1-9B-5949` 是使用原生决策协议的 Jev-like 模型，其分数不是校准后的成功率。示例中的 0.8 阈值和 16 KiB 决策输入限制均可配置，只是起始值。入口判断仅收到当前输入与允许候选；依赖历史的指代应弃权。详见[实施范围](entry-routing-implementation.html)与[验收记录](entry-routing-verification.html)。

<a id="integration-roadmap"></a>
## 集成路线

[Jev Native + DSH Native 专项方案](jev-native-dsh-native-plan.html)定义整体架构。M1a 提供首个入口选模切片，更广泛的调度与过程能力仍为规划。[Web UI 选型与接入评估](web-ui-selection.html)比较原生界面及社区扩展，定义决策展示的首个候选切片；第三方界面尚未联调。

| 阶段 | 交付物 | 验收证据 |
|---|---|---|
| 独立底座 | 产品无关的 Harness、类型化 Jev provider、影子记录与回放 | 无密钥 HTTP 集成、会话回放、独立运行时组合 |
| M1a：入口模型调度 | 共享决策服务与 Web/API 适配，空闲文本请求在兼容模型候选中选择 | 输入与路由绑定、显式用户选型、取消、有效期及真实任务结果 |
| M1b：入口策略与覆盖扩展 | 专业交接、规划／澄清路径、排队输入与其他 DSH 入口适配 | 任务归属、结果回收、模态／容量检查及各入口回放 |
| M2：执行过程智能 | 沿同一决策机制接入记忆、能力、恢复、升级、目标与沟通 | 减少返工、重复交接和路由震荡，质量不退化 |
| M3：本地模型与持续工作 | 验证本地 9B／27B Lead，补持久任务恢复与独立授权的通知 | 能力、资源、恢复、取消与投递实测 |

Choice 概率不等于校准后的成功率；模型提出 `candidate_done` 不证明任务已经完成。将当前 supervisor 晋级为自动完成判定者之前，必须处理空检查列表及通过项缺少证据的问题。当前影子输入只有结构化检查事实，不包含用户任务的语义投影。决策质量与成本收益仍未证明。

<a id="verify-independence"></a>
## 验证独立性

聚焦单测与 HTTP 集成测试位于 `packages/experimental/{agui,apus-dsh-jev-plugin,system3,system3-policy,system3-evidence,system3-supervisor}`。无密钥 `system3-shadow` 与 `system3-entry-route` SDK 场景回放持久决策记录；SDK 事件回放不代表 SDK prompt 已接入 Web/API router。[交接文档](../../tasks/feat-independent-harness/handoff.md)记录实际执行的命令与结果；仅检查源码不能证明部署就绪。

<a id="dev-note"></a>
## 开发备注

独立 CI 在 GitHub-hosted Ubuntu 执行无密钥 Jev/System3/AG-UI 测试、host 构建、Ruff 及 System3/人格 SDK 回放。继承工作流要求仓库变量 `DSH_UPSTREAM_AUTOMATION=true`；在适配其 runner、secrets 和发布部署目标之前，应保持未设置。跳过的上游任务不是验证证据，此聚焦工作流也不等于完整的上游平台矩阵。

旧 `docs/feat-system3-foundation`、`docs/feat-dsh-agui` 与任务记录保留来源项目历史和可选部署示例，不定义本项目默认部署。此快速入口不使用其中的 SSH 凭据脚本或 App overlay。保留源码历史与上游许可证；本次初始化不重命名或重新发布包。
