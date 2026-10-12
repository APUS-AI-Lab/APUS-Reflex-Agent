# Continuum + Reflex 经典案例

[English](classic-cases.md) | 中文

这些案例是解释产品行为和重复验收所需的最小场景。每个案例都说明用户可见结果，以及发布结论必须具备的证据。

## 原版兼容

用户在关闭 Continuum 或未接入 Jev 时发送普通任务。任务沿原有 provider 路径完成，不追加 `continuum/memory-record`，模型请求也不产生 `continuum-memory` 消息。

证据：`packages/context/continuum/tests/service.spec.ts`、`packages/context/continuum/tests/admission.spec.ts`，以及无密钥 shipped profile snapshot lane。

## 开启记忆后的自动准入

用户打开 Reflex 专属记忆开关、选择 scope 并发送事实消息。已提交的 `user/message` 转为一条不可变 `continuum/memory-record`，来源精确指向 Session id 和 event sequence。系统生成的 recall 消息不会再次成为事实。

证据：`packages/context/continuum/tests/admission.spec.ts` 和 `packages/context/continuum/tests/durable-admission.spec.ts`。

## 重启与召回

进程 flush JSONL 后退出，再启动新的 Host。新 Agent 从磁盘恢复 durable Session，折叠 memory record，检索有界 working set，并在模型请求中追加带 record id 的 `continuum-memory` 消息。

证据：`packages/context/continuum/tests/durable-admission.spec.ts` 和 `apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts`；后者在两个真实进程中分别运行 source 与构建产物 profile，并检查第二进程的 provider request。

## Jev shadow 与 active 选择

Shadow 模式调用 Jev 并记录 `continuum/memory-decision`，但保留确定性 baseline。Active 模式只应用有界候选中的 selected ids，并记录 decision receipt。路由不可用或隐私拒绝时保留 baseline 并记录原因。

证据：`packages/experimental/continuum-jev/tests`、`packages/context/continuum/tests/context.spec.ts`，以及部署 Jev 的 System3 E2E 矩阵。

## 上下文整理中的约束保护

历史用户消息包含明确的精度、安全、隐私、权限或文件完整性要求。Jev 可以对片段进行分类，但整理步骤不能删除仍有效的受保护约束；判定和尝试执行的 projection 都可审计。当前用户明确替换旧约束时，片段重新进入普通选择。

证据：`packages/experimental/system3/tests/reflex-context.spec.ts` 和 `packages/experimental/system3/tests/reflex-context.e2e.ts`；严格的真实 Jev 场景还检查无关旅行片段，以及新 Host 的恢复。

## 可恢复的历史记忆

用户切换话题或发生压缩后，询问具体历史事实。Reflex search 返回带稳定 event/block 引用的有界摘录；restore 以 `reflex-memory` 消息追加原文，明确标记为历史数据，不授予执行权限。

证据：`packages/experimental/system3/tests/reflex-context.spec.ts`，以及真实 Jev 严格上下文场景的重启部分。

## 发布证据规则

只有当同一提交上的 focused behavior test、negative control，以及真实入口或 provider 证据全部通过时，案例才算发布完成。跳过测试、用无密钥测试代替真实 provider 测试，或只做组件测试，都必须记录为不完整证据。
