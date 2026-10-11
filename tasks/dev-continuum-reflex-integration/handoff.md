# dev/continuum-reflex-integration handoff

## TL;DR

- 当前分支：`dev/continuum-reflex-integration`
- 基线：`feat-reflex-control` 当前提交。
- 目标：在控制面主力分支上集成 `feat-continuum-memory`，完成冲突解释和场景化验收。
- 当前状态：已完成本地合并、冲突修复、构建和定向回归；产品级自动记忆录入链路仍未接入，不能宣称完整 E2E 已通过。

## 本轮交付物

- `tasks/dev-continuum-reflex-integration/handoff.md`：集成交接入口。
- `docs/dev-continuum-reflex-integration/integration-plan.md`：合并顺序、冲突边界和验收矩阵。
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
- [x] RunPod Jev endpoint health 返回 ready；未提供有效 `JEV_API_KEY` 时 `/v1/models` 正确返回 401，说明真实 Jev E2E 不能伪造为通过。
- [x] 修复运行时开关开启后仍解析为 `off` 的配置重叠问题；profile 默认使用确定性 `shadow`，Jev provider 仍保持 `off`。

## 未完成的正式验收

- [ ] 接入生产级 memory admission caller；当前 `ContinuumMemoryService.create()` 仍是显式 API，只有测试 consumer 使用它。
- [ ] 补齐真实链路：用户输入 → memory-record → Session flush → 重启恢复 → recall 注入 → 模型请求。
- [ ] 在具备真实凭据的环境重跑 System3 real-API E2E；本地 8 个控制面 E2E 因缺少凭据全部 skip，不能计为通过。
- [ ] 重新设计并执行完整 Web built suite；当前只证明 Continuum 定向浏览器测试通过。
- [ ] 全量 `pnpm run test` 尚未全绿：本次运行 19 个失败、2 个未处理错误；失败集中在合并前未修改的桌面/UI/workflow 基础设施测试，需单独归档或修复后才能宣称仓库级全绿。

## 分支/部署状态

- 本地 worktree：`.Codex/worktrees/dev-continuum-reflex-integration`
- 分支未推送，未创建 PR，未部署。
- 源分支 worktree 均保持不变。

## 冷启动 checklist

1. 阅读本文件和 `docs/dev-continuum-reflex-integration/integration-plan.md`。
2. 检查 `git status`、当前 HEAD 和所有 worktree。
3. 查看两个源分支最新提交后再开始 merge。
4. 先解决功能配置和事件类型，再处理生成文档、锁文件和快照。
5. 按“已完成验收/未完成正式验收”分界阅读，不得将 skip 或 test-only consumer 当作产品链路通过。
6. 若继续开发，先明确 memory admission 的隐私策略和触发入口，再实现生产 caller 与真实 Session E2E。
