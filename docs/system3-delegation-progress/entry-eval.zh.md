# System3 入口路由评测 · 2026-10-02

[English](entry-eval.md) | 中文

来源：`packages/experimental/system3/tests/entry-routing-eval.e2e.ts`，两组任务集：`tests/fixtures/entry-routing-eval.tasks.json`（两档）和 `tests/fixtures/entry-routing-eval.tiers.json`（部署配置的四档）。原始输出：[entry-eval-report.json](entry-eval-report.json)。

运行：`SYSTEM3_ENTRY_EVAL_REPORT=<path> pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/system3/tests/entry-routing-eval.e2e.ts`

## 设置

- 路由器：已发布的 `createSystem3EntryRouter`，未作修改；Jev 为 `APUS-OpenJev-v1-9B-5949`，effort high，`minConfidence` 0.8，候选描述与 `deploy/system3/runtime.patch.yml` 一致。
- 50 条公开输入：14 条简单、14 条困难、12 条指代路由器收不到的历史的后续消息、10 条对抗输入（5 条短而难的问题，5 条长而简单的请求）。
- Baseline 是 Flash，所以只有 `reasoning` 决策会改变实际回答的模型。

## 结果

| 指标 | Jev | 始终 baseline | 关键词 / 长度规则 |
| --- | --- | --- | --- |
| 决策与标签一致 | 48 / 50 | 12 / 50 | 40 / 50 |
| 实际回答模型与标签一致 | 49 / 50 | 31 / 50 | 40 / 50 |
| 对抗子集的实际回答模型 | 9 / 10 | 5 / 10 | 0 / 10 |
| 后续消息未弃权而被路由 | 1 / 12 | 0 / 12 | 0 / 12 |

Outcome：38 条 selected、10 条 abstain、2 条 low-confidence、0 次传输失败。从这台 Mac 到 Runpod 端点的延迟：p50 467 ms、p95 1211 ms、最大 1932 ms。第二次运行得到相同的 50 个决策。

两条不一致：`follow-07`（“换成英文”）选中 Flash，与 baseline 相同；`short-hard-03` 置信度低于 0.8，保留 Flash。

## 四档

部署配置经同一个代理在四档之间路由：`fast`（deepseek-v4-flash，baseline）、`reasoning`（deepseek-v4-pro）、`expert`（gpt-5.6-sol-relay）、`frontier`（gpt-6-sol-relay）。任务集每档 6 条，另有 6 条后续消息。

| 指标 | Jev | 始终 baseline |
| --- | --- | --- |
| 决策与标签一致 | 29 / 30 | 6 / 30 |
| 实际回答模型与标签一致 | 29 / 30 | 12 / 30 |
| 后续消息未弃权而被路由 | 0 / 6 | 0 / 6 |

Outcome：23 条 selected、5 条 abstain、2 条 low-confidence。延迟 p50 482 ms、p95 1323 ms。唯一不一致是 `frontier-03`，一道严格不等式证明，Jev 答 `frontier` 但置信度 0.79 低于 0.8 阈值，因此保留 Flash。30 条中 17 条离开 baseline。

评测关闭 `retainOnAbstain`，以便给 Jev 自身的决策打分。部署配置开启了它，后续消息会沿用上一轮的路由。

## 这组结果能说明和不能说明的事

- 在这组输入上，Jev 能区分简单与困难输入，对依赖上下文的后续消息弃权，每次决策约半秒。
- 规则是对照前 40 条输入写的，对抗输入是为了让它失效而挑选的。它的 0 / 10 由构造决定；这组对照说明长度和关键词不够用，不代表调优后的规则表现。
- 标签由任务集作者标注。没有中等难度输入。
- 评测给路由决策打分，没有测量 Pro 回答困难输入是否优于 Flash，也没有测量每成功任务成本。
- 档位标签由任务集作者判断，`expert` 与 `frontier` 的边界最不确定。
- 开启 `retainOnAbstain` 后，后续消息沿用上一轮路由；读取会话历史的路由尚未实现。
