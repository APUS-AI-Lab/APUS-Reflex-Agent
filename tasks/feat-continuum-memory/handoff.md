# APUS Continuum 连续记忆设计交接

## TL;DR

- 当前已进入分模块工程预览，使用 feat-continuum-memory 工作树；已交付 P1.1–P1.7 的可审计模块实现，仍未交付完整产品功能。
- 推荐名称 APUS Continuum（连续记忆）；HTML 是本轮设计入口，候选名未做重名核验。
- 无限记忆为 Reflex 专属开关；关闭或未接入时兼容原版，不提供无 Reflex 的同等产品模式。
- 用户已授权在同名 worktree 分支逐步拆分验证和实现；下一步完成 P0 基线，再进入 P1。

## 本轮交付物

- docs/feat-continuum-memory/continuum-memory-proposal.html：249 行；模块 D/I/R/J/C/O、P0–P5、摘要树/cache 取舍和三层真实验收门禁。
- packages/core/agent-loop/tests/continuum-admission.spec.ts：312 行；8 项覆盖当步召回、完整 envelope 计量、最终路由、末端拒绝、重建、off、卸载和取消。
- packages/core/agent-loop/package.json / pnpm-lock.yaml：测试所需 token-meter workspace devDependency。
- packages/context/continuum/：P1.1 记录语义库加 P1.2 Session 事件/JSONL 重启回放、README 双语、包配置和 16 项相关测试。
- packages/context/continuum/：补充精确来源事件读取、active-only 有界检索、UTF-8 预算和 `agent/pre-step` 同一步 recall 消费；相关测试总计 21 项。
- packages/context/continuum/：补充 Reflex 专属 switch/controller、精确 scope 授权、停用/关闭 generation invalidation、controller 消费者、2×2 tree/cache 消融实现与 fixture，以及 Session-backed Cordis profile service。
- deploy/system3/runtime.patch.yml / deploy/system3/runtime/package.json：显式加载 Continuum service，默认 off；由 `CONTINUUM_MEMORY_*` 环境变量选择性开启。
- packages/experimental/continuum-jev/：P1.3 Reflex/Jev selection adapter、Session 决策回执、Cordis profile selector、双语 README 和 8 项 fake-provider/回放控制测试。
- tasks/todo.md：426 行；追加分模块 P0–P5 checklist 和结果；保留原有任务。
- tasks/lessons.md：149 行；记录用户纠正的专属开关与原版兼容含义，避免误推无 Jev 产品模式。
- tasks/feat-continuum-memory/handoff.md：本交接，包含范围、约束与冷启动路径。

## 设计约束

Continuum 包含完整 Service Definition、Provider 和消费者；Reflex 通过 ctx.jev 管理记忆。底层存储、授权与预算模块化，但产品开启必须具有 Reflex 控制器。关闭或未接入回到原版；Baseline 只用于测试和有限故障兜底。显式开启缺必需配置时报错，运行故障显示降级，用户取消不继续执行。开关关闭不删除数据，后续请求停止记忆管理与注入。

Harness 持有事实、权限、预算、版本和执行权。模型提炼先成为候选；明确用户来源或独立验证才能确认，不把模型摘要提升为用户指令。Markdown 是可读视图/导入格式。原事件与实际注入均须可追溯；回放禁止重新检索或再次调用 Jev。

首版跨会话沿用精确 cwd 授权规则，不宣称已支持跨用户共享。停用使当前视图和派生数据失效，物理擦除另设计；跨进程多写者不是首版范围。文档都位于 docs/feat-continuum-memory，流程文件位于 tasks/feat-continuum-memory。

## 已踩坑与已发现的真实行为

- base 有持久化和自动压缩，Web standard/ptc/cordis preset 有压缩；全文检索默认 openAt: never，默认未挂载 tool-session-query。
- 当前 task-frame 有 maxItems 截尾、长文本/非纯文本跳过、顶层 Agent 限定且判定异步，不能当可靠的完整要求集。
- runtime-context 先于 agent/pre-step 渲染；当步召回应参考 skill-selection 追加 accepted message，不能只修改 context 回调。
- compaction-basic 计量最近持久请求，未涵盖尚未提交的新输入和召回。最终路由改变也要重核容量，M1 先验证这个接入点。
- session-query SQLite 是可重建索引，自定义事件不会自动提取全文；唯一记忆不能只写索引。
- 跨 Session 引用需要 sessionId + seq，不能借用同 Session 的 sourceEventSeqs。
- 停用提交要使在途读取、后台摘要和准备发送的输入失效；未索引尾部补查也受预算限制。
- .Codex 目录写入受沙箱保护，本轮文档迁入使用了针对性授权；不要通过其他路径绕过保护。

## 下一里程碑任务清单

- [x] 用户已确认分模块实施，已读根 AGENTS.md、docs/architecture.md、docs/defensive-patterns.md、packages/AGENTS.md 和相关子树规则。
- [ ] 验证新注入、实际路由、token-meter、compaction 的预算组合，再冻结 M1 接口和事件类型。
- [x] P1.1 先实现纯记录语义；[x] P1.2 通过现有 Session persistence 实现 durable append/flush/restart；[ ] 故障注入和产品消费者。
- [x] P1.3 基础 off/shadow/active adapter；[ ] 真实 Jev gateway、Session receipt、检索消费者和 active 产品开关。
- [x] P1.2 来源回读、工作集和同一步消费者；[ ] 接入产品 profile 的 Reflex 专属开关与 Jev 决策结果。
- [x] controller 级 Reflex 专属开关、权限和停用失效语义；[ ] 接入默认产品 profile 与完整 UI。
- [x] 接入默认 profile 的 Continuum service；无 Reflex 时保持原版，开启但未挂载 Reflex 时返回 `reflex-required`；Jev active 选择已由 companion selector 自动消费。
- [ ] 接入 Reflex adapter 的自动 profile 消费与专属 UI；无 Reflex 兼容原版；用内部 Baseline 消融，先 shadow 再 active。
- [ ] 按行为面构建、lint、单元/集成、keyless Session 与两个 SDK 快照；随后真实模型对照。
- [ ] 用户明确授权前不推送、建 PR 或部署；推送前执行 dsh-pre-push-checks 与 Ruff 双检查。

## 分支、部署和验证状态

工作树：.Codex/worktrees/feat-continuum-memory。分支：feat-continuum-memory。从 main 当前基线创建；创建前已检查 status、diff、stash、branch、HEAD 和 worktree list，stash 为空。主目录已有 README 设计和未跟踪 undefined 文件，未带入或改动这些用户工作。运行源码、配置与服务器未变，分支未推送，CI 未触发。

最终版 HTML 浏览器检查通过：桌面/手机无页面横向溢出，13 维对比表、模块/验收章节完整，无 console 错误。P0 `continuum-admission.spec.ts` 通过 8/8；Continuum/adapter/agent-loop/evaluator 11 个测试文件 54/54；P1.3 Jev adapter 与 Session 回执已包含在内；focused Oxlint、两包 TypeScript 构建、native flock 构建、README Model Experience、persistence acknowledgement 和相对链接门禁通过。刷新 3 个历史 persistence format facts 后，`pnpm run test:docs` 最终 20/20 通过。实时 RunPod Jev adapter E2E 当前通过；DeepSeek v4-pro adapter/runtime 实跑 21 passed、0 skipped、0 failed。严格 A0/A1/B/C/U 评估器 20/20 请求完成、11/11 applicable assertions 通过。全仓 `pnpm run build` 已通过。

## P1.2 Review

`appendMemoryRecordEvent` 写入完整变更后记录，`foldMemoryRecordEvents` 在恢复时按顺序重建记录。测试使用真实 JSONL backend 和 native flock：写入 create/supersede/deactivate，显式 flush，销毁 writer，重新挂载 reader，读取并比较完整快照。未知事件在 catalog 更新前被 reader fail-closed；运行生成器和 persistence acknowledgement 后 catalog、schema、双语记录均已更新。尚未完成产品 profile、Reflex adapter、检索、同一步采用或 flush 故障注入。

## P1.3 Review

`continuum-jev` 是实验性、非默认加载的 Reflex/Jev selection adapter。OFF 保持 deterministic baseline；SHADOW 不改变采用结果；ACTIVE 只接受 supplied candidate 且要求置信度阈值。Session 决策回执使用 `continuum/memory-decision`，可在不调用 Jev 的情况下回放最新选择。fake-provider 与回放 6/6 通过。实时 RunPod gateway 当前通过，证据为 `docs/feat-continuum-memory/continuum-live-e2e.json`；DeepSeek v4-pro adapter/runtime 证据为 19 passed、2 optional image skipped、0 failed。严格 live harness 复跑仍返回 jev/migration/confidence 0.948799389710666。
严格 live harness 为 `scripts/continuum-live-e2e.ts`；缺少 `CONTINUUM_JEV_ENDPOINT`、`CONTINUUM_JEV_API_KEY` 或 `CONTINUUM_JEV_MODEL` 会硬失败。当前已验证缺配置失败路径，并在有部署配置时完成一次真实 Jev 选择。

`readMemorySourceEvents` 复用现有 Session persistence 按 `sessionId + eventSeq` 精确读取；`retrieveMemoryWorkingSet` 只选 active 记录并执行候选/UTF-8 预算；`installContinuumMemoryContext` 在 `agent/pre-step` 追加带来源类型的 recall 消息。Session-backed profile service 负责恢复 projection 并暴露显式生命周期 API；Jev active 选择已由 companion selector 在同一步消费并记录 receipt；相关记录、重启、检索、选择和竞态测试 48/48 通过。持久化检查当前为 80 roots、28 history records，确认无未登记变化。

P1.7 追加：profile selector 的 active/shadow 过滤和 Session receipt 已接通；关闭后的迟到选择不会注入。

P1.4/P1.5 追加：`ContinuumMemoryController` 通过 generation token 使关闭和停用后的在途读取失效，并按 exact scope 过滤 active 记录；active Jev 缺失时抛出明确配置错误，off/无 Reflex 仍解析为原版。新增 controller/ablation 测试后 Continuum 26/26 通过。`continuum-ablation.json` 是固定 3 样本的本地 2×2 结果，摘要树把命中率从 2/3 提升到 3/3；cache 指标只是字节复用估计。

## 冷启动 checklist

1. 先读 docs/feat-continuum-memory/continuum-memory-proposal.html，再读本文件和 tasks/todo.md 的 Continuum 部分。
2. 阅读 `tasks/todo.md` 的 P0–P5 清单；用户已授权同名 worktree 分模块实施，不重复请求同范围批准。
3. 查看本工作树 status、branch 和 HEAD，勿把 main 上其他文档工作带入。
4. 优先完成 P0.4 真实 A0/A1 基线；再实现 P1 记录/回读，所有产品代码与测试在本工作树推进。

## 2026-10-11 latest validation

- Deterministic summary tree and stable-prefix layout instrumentation are implemented in `packages/context/continuum/src/summary-tree.ts`; the ablation measures 2/3 → 3/3 retrieval coverage and 79/120 plus 133/206 local reused-prefix bytes. These are local layout measurements, not provider cache hits or billing.
- Python SDK exposes `latest_continuum_memory_decision()` and replays the latest Session receipt without calling Jev; focused source-SDK tests pass 2/2 with `PYTHONPATH=python/sdk/src`.
- The strict evaluator completed 20/20 protected real requests. B/C passed 8/8 applicable assertions and A1 passed 3/3; A0/U are not-applicable controls. Scope filtering removes the private candidate before Jev.
- Latest gates: Continuum/Jev/agent-loop/evaluator 54/54 tests, host build passed, docs 20/20, Cordis config 215/215, persistence 80 roots/28 history records. Worktree is clean and not pushed.
