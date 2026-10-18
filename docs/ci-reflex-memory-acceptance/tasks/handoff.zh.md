# ci-reflex-memory-acceptance 交接

[English](handoff.md) | 中文

## TL;DR

本 worktree 让 main 的 Independent harness workflow 运行 Continuum 记忆单测与录制会话，并新增需显式开启的真实 Jev 记忆验收 job。真实验收脚本现在用真实 Jev gateway 检查排序、事实与闲聊的收录判断和阈值召回。无 key 检查已在本地通过；真实运行等待 `CONTINUUM_JEV_API_KEY`。

## 交付物

- `.github/workflows/independent-harness.yml`：`Jev and System3` job 增加 `packages/context/continuum/tests`、`packages/experimental/continuum-jev/tests`、`packages/session-query/tool-history-recall/tests` 和五个 `continuum-*` 录制会话；新的 `jev-live` job 在设置 `CONTINUUM_JEV_ENDPOINT` 仓库变量时运行，缺少模型变量或 key secret 时失败。
- `scripts/continuum-live-e2e.ts`：在原有排序检查之外增加两批收录（两条事实、两条闲聊）和一次阈值召回。
- `packages/experimental/continuum-jev/README.md`、`README.zh.md`、`README.i18n.yaml`：真实验收范围。

## 设计约束

- fork 和 Dependabot PR 永远拿不到 secret，live job 不会为它们运行。
- endpoint 和模型来自仓库变量而非 workflow 文件，Pod 迁移不需要改代码。

## 已发现的真实行为

- workspace 包导出 `lib/`，因此 `tsx scripts/continuum-live-e2e.ts` 需要先运行 `build:native-system` 和 `build:lib:host`。
- 本改动之前，main 的 push CI 不运行任何 Continuum 测试；只有 PR 运行完整的 `ci.yml`。

## 本地证据

- 对 CI 步骤的十个目录运行 `vitest run`：110 个文件、1930 个测试通过。
- 按 CI 过滤条件运行 `test:snapshot`：15 个通过，其中包含五个 Continuum 会话。
- `tsc -b tsconfig.host.json`、`actionlint` 和 `test:docs`（20 个门禁）通过。

## 下一步任务

- [ ] 在本机添加 `JEV_API_KEY`，用 `APUS-OpenJev-v1-9B-5949` 运行真实验收脚本。
- [ ] 在仓库中设置 `CONTINUUM_JEV_ENDPOINT`、`CONTINUUM_JEV_MODEL` 变量和 `CONTINUUM_JEV_API_KEY` secret。
- [ ] PR 检查与真实运行通过后合并。
- [ ] 从合并后的 main 重建榜单 runtime 并重跑 preflight。

## 分支状态

分支 `worktree-ci-reflex-memory-acceptance` 起点为合入 PR #28 之后的 `origin/main`。

## 冷启动

1. 阅读本交接文档。
2. 运行 `git fetch origin`，比较 `origin/main` 与分支起点。
3. 设置三个 `CONTINUUM_JEV_*` 变量后运行真实验收脚本。
