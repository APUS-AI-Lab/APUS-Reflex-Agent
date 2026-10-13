# Reflex 前置环节验收盘点

[English](stage-acceptance.md) | 中文

本参考记录 2026-10-13 检查到的实现与可用证据，区分源码测试、真实模型调用和产品观察。第二轮 GUI 验证后，已协调执行下列无需密钥的测试批次，没有构建、启动新服务或线上模型调用。历史结果仍仅适用于注明的范围。

## 实现与证据

| 环节 | 当前实现 | 既有证据 | 待验收事项 |
|---|---|---|---|
| 需求识别 | System3 在主模型派发前，将普通文本分类为六种固定意图，仅支持且达到置信度阈值的标签进入回执。 | [真实诊断](live-intent-diagnostic.zh.md)：真实 Jev、隔离的生成桌面 profile、空 Skill 注册表和 mock 主模型；high 12/15 标签符合预期，low 9/15。此前预览记录一次真实问候判断为 1540 ms。 | 扩展意图准确性、从输入到实际可见的计时，以及歧义和低置信度输入的 UI 行为。分类不代表任务已执行。 |
| Skill 选择与加载 | 完整目录至多包含 15 个允许模型调用的 Skill 时，在意图问题旁加入一个 Skill 问题；读取并校验选中的当前正文，提交为指令消息。 | [Skill 测试](../../packages/experimental/system3/tests/skill-selection.spec.ts)使用原生注册表与循环、mock Jev 和 mock 主模型。[桌面 profile 测试](../../packages/experimental/system3/tests/desktop-profile.spec.ts)使用生成配置与真实 Loader。两者均在下方记录的六组批次中再次通过。 | 预览 `skills/list` 曾报告 113 个允许模型调用的 Skill；当前走 intent-only 并记录 `too-many-candidates`，不截取前 15 项，也不能称 Jev 已从 113 项选出 Skill。本轮尚未实现本地候选召回及真实大目录选择。 |
| 记忆召回 | Continuum 已有有界本地检索、带来源记录、控制器授权、可选 Jev 排序与持久化；上下文消费者等待下游 pre-step 后才准备召回。 | 现有[检索](../../packages/context/continuum/tests/retrieval.spec.ts)、[上下文](../../packages/context/continuum/tests/context.spec.ts)和[持久化](../../packages/context/continuum/tests/persistence.spec.ts)测试覆盖合成记录、注入预算和真实临时 JSONL 重启。[Jev 组合测试](../../packages/experimental/continuum-jev/tests/composition.spec.ts)使用真实 Loader/JSONL、本地 HTTP fixture（测试前置数据）和 mock 主模型。本次检索、上下文和持久化已通过；HTTP 组合测试仅检查源码，未重新执行。 | 用户最新截图显示独立的 Continuum 开关已开启；此前 System3 报告 `contextMemory.enabled=false`，二者属于不同模块，不能用该能力值判断 Continuum 开关状态。开关开启本身也不证明召回成功。预览未导入历史记忆；当前用户记忆召回或跨会话续做仍不在本报告验收范围内。 |
| 本地文件检索 | 已有原生 glob/grep 和文件读取工具；本轮变更未在 Reflex 识别意图后自动启动文件检索。 | 现有[搜索集成](../../packages/fs/tool-fs-search/tests/integration.spec.ts)使用真实子进程服务、随包 rg 与临时文件；[文件集成](../../packages/fs/tool-fs/tests/integration.spec.ts)包含带行号读取及分页。搜索集成已在六组批次中通过，三项筛选后的读取测试单独通过；其余 30 项文件集成测试因名称筛选而明确跳过。 | 将已授权、有界文件准备接入目标输入路径；验证返回路径、源版本、实际行范围、文件缺失与取消。开发 agent（智能体）执行的 shell 读取不是产品预取证据。 |
| 材料注入 | Skill 路径提交原生 `skill-invocation` 消息；Continuum 独立添加 `continuum-memory`，包含 ID、修订、源引用和有界摘录。 | 已有 Skill/上下文测试断言消息正文。本阶段此前通过的 [SDK 场景](../../snapshots/sdk/system3-entry-route/decision-producer.mjs)覆盖随包 profile、本地 Jev HTTP fixture、回放主模型、实际 Skill 注入、持久化与投影。 | 当前预览尚未展示合并后的记忆、文件和 Skill 材料进入真实主模型请求。fixture 的回答和归一化耗时不代表真实回答质量或速度。 |
| 并行整链 | 本轮没有统一协调记忆、文件和 Skill 准备的协调器；独立 pre-step listener 构成嵌套瀑布，不能证明并行执行。 | [并行准备设计](parallel-preparation-and-acceptance.zh.md)规定目标依赖图和场景；它是设计，不是已执行的产品路径。 | 实现协调器、共享预算、取消与源版本校验，再在一致的 A/B/C 测试中记录真实分支重叠、首次主模型派发、有效输出可见与整项任务完成。 |

15 个 Skill 是配置的产品限制，加上弃权项后符合当前网关每题 16 个选项的限制。113 个 Skill 来自主线程此前经认证的官方 RPC 观察；本次盘点没有重复调用。该限制不是对模型固有容量的判断。部署变化后，源码配置、安装产物与实时能力状态必须分别核实。

## 可执行的已有小批量测试

以下前三条命令已合并为六文件批次执行，随后执行文件读取筛选命令，不使用线上模型凭据。第一批覆盖输入与 Skill 行为，第二批覆盖记忆组件与预算，第三批覆盖本地文件工具。临时写入限于测试自己的目录。Jev 组合测试还会启动并关闭回环 HTTP fixture，因此与首轮“不新增服务”的批次分开。

```sh
pnpm exec vitest run packages/experimental/system3/tests/skill-selection.spec.ts packages/experimental/system3/tests/desktop-profile.spec.ts
pnpm exec vitest run packages/context/continuum/tests/retrieval.spec.ts packages/context/continuum/tests/context.spec.ts packages/context/continuum/tests/persistence.spec.ts
pnpm exec vitest run packages/fs/tool-fs-search/tests/integration.spec.ts
pnpm exec vitest run packages/fs/tool-fs/tests/integration.spec.ts -t 'returns line-numbered content|paginates a multi-line file|read works'
```

2026-10-13 22:12:45（+08:00），六文件批次 113/113 项通过，总耗时 2.48 秒；22:12:55，文件读取筛选批次 3/3 项通过，总耗时 851 ms，另有 30 项明确跳过。两进程退出码均为 0。这里是 Vitest 运行耗时，不是用户任务延迟。首批出现一条 `MaxListenersExceededWarning`，提示 process 有 11 个 exit listener；已保留而未抑制，不能据此认定产品内存泄漏。日志位于 `/tmp/apus-reflex-stage-acceptance-keyless.log` 与 `/tmp/apus-reflex-stage-file-read.log`。

可选的既有组合命令是 `pnpm exec vitest run packages/experimental/continuum-jev/tests/composition.spec.ts`，它验证本地 HTTP 协议与持久化组合，不验证真实 Jev 相关性质量。现有 SDK 场景在本阶段已有通过结果，不为重复该结果而提议重新构建或回放。

## 面向用户的主张需要哪些证据

逐环节记录输入、数据范围、候选数量、选中来源 ID 或路径、判断/加载/采用结果、耗时与失败原因。区分“选中”“正文就绪”和“主模型实际消费”。保留 `not-run`、`disabled`、`fallback`、`timeout` 和 `no-source`，不得解释为成功。任何跨会话记忆主张都需要真实且已授权的源历史；合成 fixture 必须保持标注。

模块测试通过，不代表完整产品链路或端到端提速通过。目前 3 倍主张不成立。它要求固定任务集、相同主模型设置与质量、关闭 Reflex 的基线、等价本地选择对照、保留全部失败，并对同一可观察节点配对计时。意图判断更快不能替代有效输出或整项任务完成更快。
