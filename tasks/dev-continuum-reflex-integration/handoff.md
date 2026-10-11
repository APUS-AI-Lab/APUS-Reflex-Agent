# dev/continuum-reflex-integration handoff

## TL;DR

- 当前分支：`dev/continuum-reflex-integration`
- 基线：`feat-reflex-control`，HEAD `8b35810552`
- 目标：在控制面主力分支上集成 `feat-continuum-memory`，完成冲突解释和场景化验收。
- 当前状态：集成分支已创建，尚未合并 Continuum。

## 本轮交付物

- `tasks/dev-continuum-reflex-integration/handoff.md`：集成交接入口。
- `docs/dev-continuum-reflex-integration/integration-plan.md`：合并顺序、冲突边界和验收矩阵。

## 设计约束

- Session 是记忆事实源；Reflex/Jev 只做有界决策。
- 默认 profile 必须保持原版行为；Continuum 只能显式启用。
- 不接受静默 fallback、越权 scope 或迟到决策注入。
- 所有模型可见记忆必须可以从 Session 日志重放。
- 保留 `feat-continuum-memory` 和 `feat-reflex-control` 原始分支，不在其上强制改写历史。

## 下一里程碑任务

- [ ] 在本分支执行 `git merge --no-ff feat-continuum-memory`。
- [ ] 解决 `runtime.patch.yml`、Session event types、persistence catalog、lockfile 等重叠文件。
- [ ] 运行控制面回归和 Continuum 定向测试。
- [ ] 增加跨重启、纠正、停用竞态、scope、预算、Jev 故障和长历史场景验收。
- [ ] 记录完整集成验收结果；未完成项不得标记为通过。

## 分支/部署状态

- 本地 worktree：`.Codex/worktrees/dev-continuum-reflex-integration`
- 分支未推送，未创建 PR，未部署。
- 源分支 worktree 均保持不变。

## 冷启动 checklist

1. 阅读本文件和 `docs/dev-continuum-reflex-integration/integration-plan.md`。
2. 检查 `git status`、当前 HEAD 和所有 worktree。
3. 查看两个源分支最新提交后再开始 merge。
4. 先解决功能配置和事件类型，再处理生成文档、锁文件和快照。
5. 合并后按验收矩阵逐项运行测试并记录证据。
