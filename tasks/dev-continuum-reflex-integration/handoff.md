# dev/continuum-reflex-integration handoff

## TL;DR

- 当前分支：`dev/continuum-reflex-integration`
- 基线：`feat-reflex-control` 当前提交。
- 目标：在控制面主力分支上集成 `feat-continuum-memory`，完成冲突解释和场景化验收。
- 当前状态：已合入最新 `feat-reflex-control` 控制面提交，完成 opt-in 用户消息准入、JSONL 磁盘 flush/resume/recall/attribution 聚焦链路，以及 5 个真实 Jev System3 E2E 文件；`reflex-context` 语义 E2E 和全仓基线仍阻塞公开发布。

## 本轮交付物

- `tasks/dev-continuum-reflex-integration/handoff.md`：集成交接入口。
- `docs/dev-continuum-reflex-integration/integration-plan.md`：合并顺序、冲突边界和验收矩阵。
- `docs/dev-continuum-reflex-integration/memory-admission-design.md` / `.zh.md`：自动准入设计与事件来源约束。
- `docs/dev-continuum-reflex-integration/release-readiness.md` / `.zh.md`：开源发布就绪审计和阻断项。
- `packages/context/continuum/tests/admission.spec.ts`：自动准入、持久化回放、seed 重启 recall 和 explicit 负向控制。
- 合并与修复提交已保留在本分支历史中。

## 设计约束

- Session 是记忆事实源；Reflex/Jev 只做有界决策。
- 默认 profile 必须保持原版行为；Continuum 只能显式启用。
- 不接受静默 fallback、越权 scope 或迟到决策注入。
- 所有模型可见记忆必须可以从 Session 日志重放。
- 保留 `feat-continuum-memory` 和 `feat-reflex-control` 原始分支，不在其上强制改写历史。

## 已完成验收

- [x] 在本分支执行 `git merge --no-ff feat-continuum-memory`。
- [x] 解决 runtime 配置、Session event types、persistence catalog、快照和文档门禁冲突。
- [x] `pnpm run build` 全量通过；`pnpm run verify-cordis-config` 通过 226 个配置文件。
- [x] 双边定向回归通过：103 个文件、1957 个测试通过。
- [x] Continuum 浏览器验收通过：2 个测试通过；覆盖设置显示、开关持久化和原版配置兼容。
- [x] 文档、persistence changes、persistence formats 门禁通过。
- [x] Python Continuum replay 通过：2 个测试通过。
- [x] `pnpm run typecheck`、`pnpm run lint`、TypeScript aliases、Cordis catalog 全部通过。
- [x] `pnpm exec vitest run packages/context/continuum/tests packages/core/agent-loop/tests/continuum-admission.spec.ts`：11 个文件、55 个测试通过。
- [x] `pnpm run doc-sync`：42 个文档/目录门禁全部通过。
- [x] `pnpm run verify-cordis-config`：226 个配置文件通过；persistence changes、tsconfig paths、targeted oxlint 通过。
- [x] JSONL durable profile E2E：2/2 通过；真实 AgentLoop resume 从磁盘恢复，不使用 seed 替代，并验证 explicit 负向控制。
- [x] 真实 Jev System3：6 个选定 E2E 文件中 5 个通过；`reflex-context` 保留 1 个严格语义失败。
- [x] RunPod Jev endpoint health 返回 ready；未提供有效 `JEV_API_KEY` 时 `/v1/models` 正确返回 401，说明真实 Jev E2E 不能伪造为通过。
- [x] 修复运行时开关开启后仍解析为 `off` 的配置重叠问题；profile 默认使用确定性 `shadow`，Jev provider 仍保持 `off`。
- [x] 只读检查 RunPod `Jev-Serving` pod：`/root/.config/openjev/gateway.key` 存在且权限为 `600`，真实 key 访问 `/v1/models` 返回 200；key 未写入仓库。
- [x] `scripts/continuum-live-e2e.ts` 使用真实 Jev 完成：选择 `migration`，置信度约 `0.7991`，延迟约 `1.9s`。
- [x] `scripts/continuum-evaluation.ts` 使用真实 Jev + DeepSeek gateway 完成 20 个变体/任务单元；11 个适用断言全部通过，结果写入 `docs/feat-continuum-memory/continuum-evaluation-results.json`。

## 未完成的正式验收

- [x] 接入 opt-in 生产级 user-message admission caller；默认仍为 `admission: explicit`，需要 scope 和 Continuum 开关。
- [x] 生产插件组合链路：用户输入 → memory-record → Session flush → 上下文销毁 → `AgentLoop.resume()` 磁盘恢复 → recall 注入 → 模型请求归因；仍需 shipped `dsh --profile` 子进程黑盒作为公开发布补充证据。
- [ ] 修复或解释 `reflex-context` 真实语义失败，并重跑 System3 完整 real-API 矩阵；不能用重试或弱化断言替代。
- [ ] 重新设计并执行完整 Web built suite；当前只证明 Continuum 定向浏览器测试通过。
- [ ] 全量 `pnpm run test` 尚未全绿：本次运行 19 个失败、2 个未处理错误；失败集中在合并前未修改的桌面/UI/workflow 基础设施测试，需单独归档或修复后才能宣称仓库级全绿。
- [ ] 公开发布前复核包 tarball、CI secrets lane、版本/tag 和干净 release commit；不得把本地 API key 写入配置、fixture、HTML、日志或提交。

## 分支/部署状态

- 本地 worktree：`.Codex/worktrees/dev-continuum-reflex-integration`
- 分支已推送到 `origin/dev/continuum-reflex-integration`，未创建 PR，未部署；仓库当前没有 `dev` 目标分支。
- 源分支 worktree 均保持不变。

## 冷启动 checklist

1. 阅读本文件和 `docs/dev-continuum-reflex-integration/integration-plan.md`。
2. 检查 `git status`、当前 HEAD 和所有 worktree。
3. 查看两个源分支最新提交后再开始 merge。
4. 先解决功能配置和事件类型，再处理生成文档、锁文件和快照。
5. 按“已完成验收/未完成正式验收”分界阅读，不得将 skip 或 test-only consumer 当作产品链路通过。
6. 若继续开发，先运行 `docs/dev-continuum-reflex-integration/release-readiness.md` 的 staging 黑盒序列，再处理 System3 和全仓基线失败。
