# APUS Continuum 连续记忆设计交接

## TL;DR

- 当前已完成 P0.4、P1.1–P1.7、P2 索引、P3 安全/严格评测门禁和 P5 Session-backed summary view；P3 完整质量/成本对照、P4 浏览器验收、P5 批合并/服务端 cache 仍未交付。Continuum 专属 flush 故障注入已通过；P4 最小 General 设置开关已实现并完成单元、类型和 bundle 验证。
- 推荐名称 APUS Continuum（连续记忆）；HTML 是本轮设计入口，候选名未做重名核验。
- 无限记忆为 Reflex 专属开关；关闭或未接入时兼容原版，不提供无 Reflex 的同等产品模式。
- 用户已授权在同名 worktree 分支逐步拆分验证和实现；下一步是 P3 完整质量/成本、P4 UI/预算和 P5 批合并/真实服务端 cache。

## 本轮交付物

- docs/feat-continuum-memory/continuum-memory-proposal.html：模块 D/I/R/J/C/O、P0–P5、摘要树/cache 取舍和设计验收门禁。
- docs/feat-continuum-memory/continuum-full-chain-acceptance.html：全链路验收专项 HTML，逐项链接测试/JSON 证据并明确 PARTIAL/BLOCKED，不把局部通过外推为最终通过。
- docs/feat-continuum-memory/p3-performance-design.md/.zh.md/.i18n.yaml：真实性能证据口径。
- docs/feat-continuum-memory/continuum-performance-report.json：20-cell 真实 provider usage、候选一致性、P50/P95。
- docs/feat-continuum-memory/p5-summary-view-design.md/.zh.md/.i18n.yaml：Session-backed summary view/zoom 设计。
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
- packages/context/continuum/src/summary-view.ts：从 Session 记录投影 summary/zoom，并返回 sourceRefs。

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
- [x] P0.4 基线与真实评测 manifest 冻结；严格 evaluator 20/20 请求、11/11 applicable assertions 通过。
- [x] P1.1–P1.7：记录语义、Session 持久化/回放、来源读取、预算与同一步消费者、Reflex switch、Jev off/shadow/active、取消/权限/停用和 TypeScript/Python 回放。
- [x] P2 工程切片：可重建倒排索引、enqueue、bounded backlog rebuild；profile controller 在提交变更后保持派生索引；真实 JSONL 1,000 条重启/尾部检索 smoke 通过。
- [x] P3 安全切片：显式 provider timeout、取消传播、弃权、baseline fallback 和有界顺序多选；每次请求仍使用 Jev 单选闭集。
- [x] P3 性能证据：固定 20-cell 真实评测生成 provider usage、候选一致性和 P50/P95；[ ] 完整任务质量/总成本对照仍待完成。
- [ ] P4：运行中开关投影移除、最终预算与完整产品浏览器验收；Continuum 专项 Chromium 开关显示/切换/reload 持久化已 1/1 通过，完整 Web 基线仍待收敛。
- [x] P5 摘要 view/zoom：Session 重建、重启来源回读、UTF-8 上限已通过；[ ] 后台批合并、真实超模型窗口历史、服务端 cache 用量和完整成本/延迟实验。
- [x] flush failure semantics：Continuum 专属一次失败/重试、重复 flush 和冷启动恢复已通过。
- [ ] 用户明确授权前不推送、建 PR 或部署；推送前执行 dsh-pre-push-checks 与 Ruff 双检查。

## 分支、部署和验证状态

工作树：.Codex/worktrees/feat-continuum-memory。分支：feat-continuum-memory。从 main 当前基线创建；创建前已检查 status、diff、stash、branch、HEAD 和 worktree list，stash 为空。主目录已有 README 设计和未跟踪 undefined 文件，未带入或改动这些用户工作。运行源码、配置与服务器未变，分支未推送，CI 未触发。

最终版 HTML 浏览器检查通过：桌面/手机无页面横向溢出，13 维对比表、模块/验收章节完整，无 console 错误。P0 `continuum-admission.spec.ts` 通过 8/8；Continuum/Jev/agent-loop 11 个测试文件 59/59；SDK client 44/44；P1.3 Jev adapter 与 Session 回执已包含在内；focused Oxlint、两包 TypeScript 构建、native flock 构建、README Model Experience、persistence acknowledgement 和相对链接门禁通过。刷新 3 个历史 persistence format facts 后，`pnpm run test:docs` 最终 20/20 通过。实时 RunPod Jev adapter E2E 当前通过；DeepSeek 旧 JSON 曾记录 21 passed，但最新受保护运行只形成核心 7/7；vision lane 在 max-tokens/重试超时后未形成稳定通过证据，不能引用旧摘要宣称视觉通过。严格 A0/A1/B/C/U 评估器 20/20 请求完成、11/11 applicable assertions 通过。全仓 `pnpm run build` 已通过。

## 当前实现 Review

`appendMemoryRecordEvent` 写入完整变更记录，`foldMemoryRecordEvents` 从 Session 日志按顺序恢复；真实 JSONL flush/restart 测试覆盖 create/supersede/deactivate。来源通过 `sessionId + eventSeq` 精确回读。Session/core persistence contract 已证明 flush 失败会显式传播并允许恢复重试；Continuum 专属故障注入进一步证明一次 persistBatch 失败后的重试、去重和冷启动折叠。

`ContinuumMemoryController` 负责 Reflex 专属开关、exact scope 授权、generation invalidation 和当前派生索引；关闭、停用或迟到 Jev 结果不会注入。`continuum-jev` 的 off/shadow/active、候选闭集、弃权、超时、取消、fallback、有界顺序多选和 `continuum/memory-decision` 回放均有测试；真实 RunPod Jev 与 DeepSeek 严格 evaluator 已通过。

摘要树、summary view 和稳定前缀是确定性本地导航/计量；summary view 从 Session 记录重建，zoom 返回 sourceRefs，2×2 消融报告检索覆盖与布局复用，未冒充 provider cache hit。P2 索引是可丢弃派生状态，Session 仍是唯一事实源；没有自动后台 FTS 或服务端 cache 账单。

## 冷启动 checklist

1. 先读 docs/feat-continuum-memory/continuum-memory-proposal.html，再读本文件和 tasks/todo.md 的 Continuum 部分。
2. 阅读 `tasks/todo.md` 的 P0–P5 清单；用户已授权同名 worktree 分模块实施，不重复请求同范围批准。
3. 查看本工作树 status、branch 和 HEAD，勿把 main 上其他文档工作带入。
4. 先读最新验证区和 P0–P5 清单；继续推进 P3 完整质量/成本、P4 UI/预算或 P5 批合并/服务端 cache，所有产品代码与测试仍在本工作树推进。

## 2026-10-11 latest validation

- Deterministic summary tree, stable-prefix layout instrumentation, rebuildable Continuum memory index, and a 1,000-record JSONL restart/retrieval smoke are implemented in `packages/context/continuum/src/summary-tree.ts`; the ablation measures 2/3 → 3/3 retrieval coverage and 79/120 plus 133/206 local reused-prefix bytes. These are local layout measurements, not provider cache hits or billing.
- Python SDK exposes `latest_continuum_memory_decision()` and replays the latest Session receipt without calling Jev; installed project-environment tests pass 2/2 with `uv sync --offline --group test && uv run --offline python -m pytest -q tests/test_continuum_replay.py`.
- Jev active now has an explicit provider timeout, deterministic baseline fallback, and bounded sequential multi-selection; the strict evaluator completed 20/20 protected real requests. B/C passed 8/8 applicable assertions and A1 passed 3/3; A0/U are not-applicable controls. Scope filtering removes the private candidate before Jev.
- Latest gates: Continuum/Jev/agent-loop 11 files / 59 tests, SDK client replay 44/44, Python replay 2/2, host build passed, docs 20/20 before the latest anchor correction, Cordis config 215/215, persistence 80 roots/28 history records; DeepSeek adapter/runtime 7 passed and 1 vision test failed in the latest real run, so vision is not accepted. Full keyless snapshot replay reaches 180 passed, 0 failed, and 2 expected Windows-only pwsh skips on macOS; browser-use-stagehand-native is fixed. UI package tests 2/2, typecheck, oxlint, package bundle, and Web production build passed. The platform skips remain explicitly recorded and are not counted as passes. Worktree is not pushed; current handoff update may leave generated evidence/docs staged for the next commit.
- Latest docs rerun: `pnpm run test:docs` 20/20 passed after bilingual anchor correction. `pnpm run test:web:built` did not pass: document-preview, settings-chrome, lifecycle-chrome, and smoke-real reported existing browser/runtime failures; the run was stopped after those failures and must not be reported as a Continuum UI acceptance.


## 2026-10-11 continuation validation

- The summary-view implementation and follow-up restart test added Session-backed summary view/zoom and restart source lookup. Controller rejects disabled/stale tickets, exact scopes only, active records only; summary text has UTF-8 bounds and escaped paths.
- The Continuum-specific persistence test added JSONL flush fault injection: one persist failure propagates, retry succeeds, duplicate flush does not duplicate events, and cold restart folds the same records.
- Strict evaluator gate now rejects failed assertions, missing/duplicate cells, empty responses and non-`end_turn` finishes. Protected rerun with max_tokens=4096: 20/20 requests, 11/11 applicable assertions, 0 failed.
- `continuum-performance-report.json` records P50/P95, provider input/output usage, baseline agreement and unknown Jev/local/cache costs. The local summary-tree/cache ablation remains explicitly a local measurement, not provider cache billing.
- Focused Continuum tests: 43/43 after summary/restart slice; current local script/performance tests also pass. After this handoff update, `pnpm run test:docs` passed 20/20.
- DeepSeek runtime truth remains: core 7/7 passed with vision disabled; optional vision smoke returned `max-tokens` once and timed out on retries, so it is not counted as passed.
- Continuum browser acceptance: `apps/web/tests/continuum-memory.e2e.ts` 1/1 passed; targeted settings dialog test 1/1 passed. The overlay mounts Jev and Continuum while keeping the Reflex memory switch off before the user action.
- `pnpm run test:docs` rerun after the acceptance report passed 20/20. Focused Continuum/Jev tests passed 54/54; context TypeScript and focused Oxlint passed. `apps/web/tsconfig.json` direct check remains invalid because the repository intentionally resolves shared test-support sources outside that app root; use the Vitest/build gates instead.
- `pnpm run test:web:built` remains partial: document-preview, lifecycle-chrome, smoke-real and the broader settings lane have existing failures; do not call the full Web suite green.
