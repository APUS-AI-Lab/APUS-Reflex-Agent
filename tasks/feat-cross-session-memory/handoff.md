# feat-cross-session-memory 交接

## TL;DR

- PR #8 已手动合并到远程 main，本 worktree 从该版本创建；主目录存在用户 WIP，未移动或覆盖。
- 本批是 B2 的跨会话持久输入与任务续做切片，不是无限记忆整体完成。
- 125 个任务测试通过，全部 task-*.ts 的四项覆盖率 100%。新 guard 防止缺少可选 task service 时重用旧任务历史。
- 最终构建、profile / SDK 回放、125 任务测试、256 既有回归、lint、18 hygiene 检查已通过；doc-sync 41 项通过，剩余 Summary 字数已修复并单独复验通过。
- 唯一总设计入口：docs/feat-lossless-memory/design.html；本批附录：docs/feat-cross-session-memory/design.html。

## 本轮交付物

| 文件 | 总行数 | 说明 |
|---|---:|---|
| `apps/cli/composition.md` | 300 | 配置 / 实现 / 文档 |
| `apps/cli/package.json` | 165 | 配置 / 实现 / 文档 |
| `apps/cli/tests/built-bin.e2e.ts` | 1322 | 行为验收 / 快照 |
| `docs/capability-seams.i18n.yaml` | 10 | 生成目录 / 类型确认 |
| `docs/capability-seams.md` | 686 | 生成目录 / 类型确认 |
| `docs/capability-seams.zh.md` | 688 | 生成目录 / 类型确认 |
| `docs/event-producer-consumer.md` | 113 | 生成目录 / 类型确认 |
| `docs/event-producer-consumer.zh.md` | 115 | 生成目录 / 类型确认 |
| `docs/feat-lossless-memory/design.html` | 91 | 配置 / 实现 / 文档 |
| `docs/persistence-catalog.i18n.yaml` | 3067 | 生成目录 / 类型确认 |
| `docs/persistence-catalog.md` | 12931 | 生成目录 / 类型确认 |
| `docs/persistence-catalog.zh.md` | 12933 | 生成目录 / 类型确认 |
| `docs/persistence-changes/historical-formats/README.i18n.yaml` | 28 | 生成目录 / 类型确认 |
| `docs/persistence-changes/historical-formats/README.md` | 75 | 生成目录 / 类型确认 |
| `docs/persistence-changes/historical-formats/README.zh.md` | 75 | 生成目录 / 类型确认 |
| `docs/persistence-schema.json` | 129098 | 生成目录 / 类型确认 |
| `docs/subsystems/extensions.md` | 656 | 生成目录 / 类型确认 |
| `docs/subsystems/extensions.zh.md` | 656 | 生成目录 / 类型确认 |
| `packages/bundle/base/cordis.patch.yml` | 531 | 配置 / 实现 / 文档 |
| `packages/bundle/base/package.json` | 137 | 配置 / 实现 / 文档 |
| `packages/bundle/base/tests/base.spec.ts` | 88 | 行为验收 / 快照 |
| `packages/bundle/sdk-minimal/cordis.patch.yml` | 161 | 配置 / 实现 / 文档 |
| `packages/bundle/sdk-minimal/package.json` | 73 | 配置 / 实现 / 文档 |
| `packages/bundle/sdk-minimal/tests/sdk-minimal.spec.ts` | 90 | 行为验收 / 快照 |
| `packages/context/continuum/README.i18n.yaml` | 49 | 配置 / 实现 / 文档 |
| `packages/context/continuum/README.md` | 99 | 配置 / 实现 / 文档 |
| `packages/context/continuum/README.zh.md` | 94 | 配置 / 实现 / 文档 |
| `packages/context/continuum/package.json` | 80 | 配置 / 实现 / 文档 |
| `packages/context/continuum/tsconfig.json` | 51 | 配置 / 实现 / 文档 |
| `packages/core/session/src/known-event-types.ts` | 116 | 配置 / 实现 / 文档 |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 8790 | 生成目录 / 类型确认 |
| `pnpm-lock.yaml` | 30742 | 配置 / 实现 / 文档 |
| `scripts/check-workspace-constraints.ts` | 645 | 配置 / 实现 / 文档 |
| `scripts/gen-cordis-catalog.ts` | 1314 | 配置 / 实现 / 文档 |
| `scripts/gen-doc-graphs.ts` | 1772 | 配置 / 实现 / 文档 |
| `snapshots/sdk/sdk.snapshot.ts` | 1317 | 行为验收 / 快照 |
| `tsconfig.base.json` | 567 | 配置 / 实现 / 文档 |
| `apps/cli/config/examples/continuum-task.patch.yml` | 13 | 配置 / 实现 / 文档 |
| `apps/cli/tests/profiles/headless/tests/continuum-task.e2e.ts` | 139 | 行为验收 / 快照 |
| `apps/cli/tests/profiles/headless/tests/fixtures/continuum-task-observer.mjs` | 91 | 行为验收 / 快照 |
| `docs/feat-cross-session-memory/acceptance.json` | 71 | 配置 / 实现 / 文档 |
| `docs/feat-cross-session-memory/design.html` | 23 | 配置 / 实现 / 文档 |
| `docs/persistence-changes/2026-10-13-cross-session-tasks.i18n.yaml` | 28 | 生成目录 / 类型确认 |
| `docs/persistence-changes/2026-10-13-cross-session-tasks.md` | 52 | 生成目录 / 类型确认 |
| `docs/persistence-changes/2026-10-13-cross-session-tasks.schema.json` | 470 | 生成目录 / 类型确认 |
| `docs/persistence-changes/2026-10-13-cross-session-tasks.zh.md` | 52 | 生成目录 / 类型确认 |
| `packages/context/continuum/src/task-binding.ts` | 46 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/task-guard.ts` | 40 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/task-journal.ts` | 307 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/task-pages.ts` | 163 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/task-service.ts` | 352 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/task-source.ts` | 100 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/task-types.ts` | 110 | 配置 / 实现 / 文档 |
| `packages/context/continuum/src/tasks.ts` | 8 | 配置 / 实现 / 文档 |
| `packages/context/continuum/tests/task-guard.spec.ts` | 181 | 行为验收 / 快照 |
| `packages/context/continuum/tests/task-journal.spec.ts` | 313 | 行为验收 / 快照 |
| `packages/context/continuum/tests/task-pages.spec.ts` | 138 | 行为验收 / 快照 |
| `packages/context/continuum/tests/task-service.spec.ts` | 450 | 行为验收 / 快照 |
| `packages/context/continuum/tests/task-source.spec.ts` | 298 | 行为验收 / 快照 |
| `packages/context/continuum/tsdown.config.ts` | 18 | 配置 / 实现 / 文档 |
| `python/sdk/tests/expected/continuum-task.json` | 10 | 行为验收 / 快照 |
| `python/sdk/tests/test_continuum_task_snapshot.py` | 128 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/cordis.snapshot.yml` | 15 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/cordis.yml` | 43 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/notifications.expected.jsonl` | 36 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/request-check.mjs` | 51 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/result.expected.json` | 1 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/session.v4.jsonl` | 36 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/snapshot.yml` | 8 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/system-prompt.expected.md` | 27 | 行为验收 / 快照 |
| `snapshots/sdk/continuum-task-pages/tool-schemas.expected.json` | 639 | 行为验收 / 快照 |

## 设计约束

- task/domain/principal/workspace 由宿主显式配置，模型不能选授权主体。首批单宿主单写者。
- 原始业务 Session 与独立 task-journals 日志分开；后者不能进入业务会话列表。
- 源 flush/readback → 域 append/flush/readback → 发布回执。读取/保存不等于处理完成。
- 纠正采用 CAS + requestId，保留退休原文；旧 Session 失效后拒绝继续派发，新 Session 读取当前任务。
- 模型请求持有域租约直到 stream 结束；纠正/准入串行。辅助 compaction 不套主请求消息 ID 集合约束。
- 每次 push 前必须 ruff check . 和 ruff format --check .；正常 git hooks，不绕过测试失败。

## 已踩坑 / 真实行为

- 静态注入的 SessionPersistence 在 service ctx.isolate 下仍引用业务后端；必须从 ctx.root.isolate 建独立后端，并显式拥有其 fiber。
- ctx.sessions.flush(live) 返回 false 表示没有持久监听器，不能确认源已经可靠保存；cold source 需临时独占 write handle。
- runtime-context 是 user/message source.kind=runtime-context，而非 system role。先装配上下文再准入当前输入，页 revision 可比新消息旧一版；过期游标从首页重读。
- 异步 session-title 辅助请求可能早于主 loop 请求；验收记录 purpose 并分别核对，不能把第一条 stream 当主请求。
- 全新 tasks subpath 不会被 gen-tsconfig-paths 自动加入；tsconfig.base.json 需要手动源 alias。
- 可选任务插件卸载后仅靠自身 llm listener 不够；base + sdk-minimal 常驻轻量 guard，绑定 Session 无匹配 authority 必须拒发。
- 原生 compaction 请求只含所选旧片段，不应要求含本次主请求 human message ID。两次 compactNow 修前失败、修后可继续。
- tsdown 多入口禁用 codeSplitting 被构建器拒绝；每个 entry 独立配置构建，防止漏发布共享 chunk。
- GitHub Actions 曾因账单/额度拒跑；远端状态必须重查，不能把本地通过说成 CI 通过。

## 下一里程碑任务清单

- [x] 完成本批实现、本地验收与 Conventional Commit。
- [ ] 跟进本批 PR 的远程检查与审查，不把当前切片称为 B2 全部完成。
- [ ] B1/B3：持久源准入游标、源已保存/域未提交崩溃补账、处理区间账本与操作版本。
- [ ] B2 后续：工具/助手进度可信记录、客户端任务绑定、旧派生历史自动更新。
- [ ] 接入任务投影的 Reflex 覆盖优先排序，读取原文再交主模型；保留 deterministic 对照。
- [ ] B4：最终实际路由计量、完整请求预算、长输入分段处理与继续。
- [ ] B5：真实 Flash + Reflex 独立 Session 续做、实际 2x/10x 窗口压力及盲测。旧 PR #8 的同 Session 冷恢复不能冒充此批通过。

## 分支 / 部署状态

- 当前分支 feat-cross-session-memory，已提交本批实现和本地验收；远程 main 已含 PR #8。推送与 PR 状态以远端查询为准。
- 没有更新 Release 或部署，不把尚未合并代码列作发布能力。
- 工作日志在 tasks/feat-cross-session-memory/*.log，覆盖在 task-coverage/。

## 冷启动 checklist

1. 先读本 handoff、tasks/todo.md 和 docs/feat-cross-session-memory/design.html。
2. git status / diff --stat / stash list / worktree list，保护主目录用户 WIP。
3. 读取本批最终 build、task-coverage、profile、SDK、doc-sync、hygiene 日志；不要沿用更早构建判断。
4. gh 必须显式 -R APUS-AI-Lab/APUS-Reflex-Harness，避免解析为 upstream。
5. 恢复上述剩余里程碑，保持“保存、读取、处理、完成”四种状态独立。
