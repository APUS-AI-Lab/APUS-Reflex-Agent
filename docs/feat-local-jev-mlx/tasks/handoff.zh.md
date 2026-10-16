# feat-local-jev-mlx 交接

[English](handoff.md) | 中文

## TL;DR

本机决策引擎（APUS Reflex 4B 在用户 Mac 上做 Jev 判断）与「登录后没有可用回答模型时的引导」已**完整实现**，全部改动在本 worktree 中、尚未提交。

标准 DSH 通过新的可选 bundle「本机决策引擎」交付：插件页打开 → 一键下载并启用（续传、sha256、自检、自动启用并可撤销）→ dock 进度标签与「本机」判断标记。runner（llama.cpp `llama-server` b11118）随桌面 primary runtime 分发。

真实验收（M5 24 GB，4B Q8_0）：自检约 410 tok/s、参考判断约 300 ms；三问请求冷态约 1.0 s、暖态 0.2–0.4 s；Jev 重新加载后 runner 不重启。

下一步：用户审阅并决定是否提交与开 PR；之后是 Developer ID 签名公证真机验收、M1/M2 速度校准、System3 桌面接线与邀请卡。

## 本轮交付物

| 路径 | 说明 |
| --- | --- |
| `packages/experimental/reflex-local/`（src 约 1,700 行，tests 约 2,060 行） | Host 引擎：配置、设备门控、Range 续传下载、llama-server 进程、契约渲染（与 Python 契约逐字节一致的黄金样例）、Jev provider、准备状态机、`ctx.reflexLocal` |
| `packages/experimental/api-reflex-local/` | Typert Remote `reflexLocal/*`（follow/snapshot/prepare/pause/cancel/enable/disable/remove/acknowledge） |
| `packages/experimental/client-ui-reflex-local/`（src 约 780 行） | 插件页单主按钮卡片、激活提示、自动启用撤销 Toast（关闭时确认）、dock 准备进度标签（含慢机「暂不启用」） |
| `packages/experimental/reflex-local-bundle/` | 可选 bundle：Jev（`defaultProviderId: reflex-local`，无云端端点）+ 引擎 + Remote + UI + System3（`local-only`、`jevExecutionDomain: local`，只开 taskFrame / completionReview(shadow) / skillSelection(≤16)）+ dock；含真实 Loader 组合测试 |
| `packages/experimental/apus-dsh-jev-plugin/` | `endpoint`/`model` 可省略；新增 `defaultProviderId`（与内置 System One 的 `providerId` 分离） |
| `packages/experimental/system3/` + `client-ui-system3/` | 运行时投影带出入口决策的 `executionDomain`（stateVersion 14），dock 显示「本机 / 云端」 |
| `packages/client/ui-settings-models/` + `ui-settings-account/` + `apps/desktop/src/welcome-api.ts` | 就绪弹窗：只在没有可用回答线路时弹；已登录且账号线路可用不再要求密钥；「稍后配置」本次页面内不再弹，输入框上方留提示 |
| `scripts/primary-runtime/*` + `packages/skill/tool-workspace-dependencies/` + `apps/desktop-host/src/primary-runtime-source.ts` | runner 构建期下载、sha256 校验、按 soname 物化、smoke；Host 在 profile 加载前导出 `DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE` |
| `packages/boot/app-boot/src/profile.ts`、`apps/cli/package.json` | bundle 加入 `OPTIONAL_BUNDLES` 与 CLI 依赖 |
| `docs/feat-local-jev-mlx/` | 设计、体验稿、原型、实现规格（impl-spec）、笔记、教训、todo；均为中英配对 |

## 设计约束（不可违反）

1. 决策模型不是聊天模型；功能名「本机决策引擎」。
2. 本机失败不自动外发：失败映射到既有 `transport` / `timeout` / `invalid-response`，System3 回落 baseline。
3. 不新增 `JevErrorCode`，不新增会话事件。
4. noul 一律渲染为契约规范的是非候选（实测二选一渲染会反转判断）；prompt 必须与 Python 契约逐字节一致（黄金样例）。
5. runner 锁定 b11118；key 经环境变量 `LLAMA_API_KEY` 传入，启动时校验 `/props` 无 key 401；只绑 127.0.0.1、`--port 0`。
6. Jev 的 `providerId` 是内置 System One 的注册 id；切换默认 provider 只改 `defaultProviderId`。
7. 引擎服务只依赖 `subprocess`；provider 注册在嵌套的 `inject(['jev'])` 里，Jev 重新加载只重做注册。
8. 卡片永远只有一个主按钮；慢机（低于 `minPrefillTokensPerSecond`，默认 150）不自动启用。

## 已查实的真实行为

- 标准 DSH 不装载 System3/Jev；System3 桌面是独立前端仓库，装载 `deploy/system3/runtime.patch.yml`。
- primary runtime 的 `$DSH_HOME` 副本是懒安装的（首次调用 `load_workspace_dependencies` 才装），所以 runner 路径指向随包资源目录。
- ad-hoc 签名下 llama-server 因 dylib 无 Team ID 被拒；同一 Team ID（模拟）下 Metal 正常、不需要 JIT。真实 Developer ID 与公证尚未验证。
- b11118 认 `LLAMA_API_KEY`，不认 `LLAMA_ARG_API_KEY`。
- 真实 System3 请求在本机：每问 0.3–0.6 s；task.frame 6 问 1.6 s；entry 0.56 s（云端 p50 约 0.47 s）。详见 [notes.zh.md](notes.zh.md)。
- `isJsonValue` 拒绝 `-0`；数字样键的 choice 按 JS 数值序映射字母。
- 仓库 `docs/**` 必须中英配对；handoff 每次修改都要同步两种语言并 `verify-translation-pairing --write`。

## 验证记录（本轮）

- `pnpm run typecheck`、`lint`、`hygiene`、`doc-sync`、`constraints` 通过。
- 改动包与此前失败的测试：81 个测试文件、1,183 个测试通过；全仓 `test:coverage` 门禁没有逐文件阈值错误。
- `pnpm run duplication` 只剩 `system3/src/index.ts` 内部一处克隆，基线已有，本分支未改该文件。
- 真实 e2e：契约 + provider（2）、引擎端到端（1）、bundle 真实 Loader 组合（1）通过；`optional-bundles.spec.ts` 10/10。
- 全量测试余下的失败都不在本分支改动的文件里：品牌图标与侧栏图形测试、macOS 签名环境、Windows 路径解析、既有会话 fixture、浏览器与时序敏感测试。

## 下一里程碑任务清单

- [ ] 用户审阅 → 提交（Conventional Commits）与 PR；标注需要设计评审的界面（就绪提示、引擎卡片、dock 标签、本机标记）
- [ ] P4：Developer ID 签名并公证的安装包真机验收（首次下载、续传、无网络启动、删除重装、升级）
- [ ] M1/M2 × 8/16 GB 速度校准 `minPrefillTokensPerSecond`；评估 9B
- [ ] System3 桌面接线：在其 profile 插入 `reflex-local`（`cloudProviderId: system-one`、前端提供 `runnerPath`）+ `api-reflex-local` + `ui-reflex-local`，并为卡片提供非 bundle 的宿主位置（当前卡片挂在 bundle 插件页）
- [ ] 邀请卡（判断满 20 次、14 天「以后再说」）需要 Host 侧判断计数
- [ ] skill / taskFrame / completionReview 的回执补 `executionDomain`，让 dock 标记覆盖全部决策
- [ ] Toast 在窗口不可见时也会计时消失：需要共享 Toast 组件支持可见期计时
- [ ] dock 准备标签与 System3 判断行合并为一行：需要 System3 那一行开放插槽
- [ ] 用户指南：本机决策引擎与隐私范围（`docs/user/guide`）

## 分支与状态

- worktree `.Codex/worktrees/feat-local-jev-mlx`，分支 `worktree-feat-local-jev-mlx`，基于建立分支时的 `main`；全部改动未提交。
- 主检出有用户自己的未提交改动（`tasks/lessons.md`、`tasks/todo.md`、`docs/main/`、`tasks/main/`），不要动。
- 测试用权重与 runner 在会话临时目录，不在仓库内。

## 冷启动 checklist

1. 读 [impl-spec.zh.md](impl-spec.zh.md)（包划分、接口、已实测的决定）。
2. 读 [../local-jev-mlx-design.zh.md](../local-jev-mlx-design.zh.md) 与体验稿 `local-inference-experience.html`。
3. 读本文「已查实的真实行为」与 [lessons.zh.md](lessons.zh.md)。
4. `pnpm install`；跑 `pnpm vitest run packages/experimental/reflex-local packages/experimental/client-ui-reflex-local`。
5. 真实 e2e：设置 `REFLEX_LOCAL_RUNNER`、`REFLEX_LOCAL_WEIGHTS`（及 `REFLEX_LOCAL_URL`/`REFLEX_LOCAL_KEY`）后跑 `pnpm vitest run --config vitest.e2e.config.ts packages/experimental/reflex-local packages/experimental/reflex-local-bundle`。
