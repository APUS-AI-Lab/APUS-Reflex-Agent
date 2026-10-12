# dev/continuum-reflex-integration handoff

## TL;DR

- 当前分支：`dev/continuum-reflex-integration`
- 历史集成基线：`feat-reflex-control`；当前工作是公开资料、部署配置和 README／架构说明整改。
- 当前目标：完成本轮审阅与必要验证，将清理和配置修复合入两仓 main；两仓已转入 `APUS-AI-Lab`，仍保持独立、私有。
- 历史集成状态（不是本轮完整发布验收）：已合入 `feat-reflex-control` 控制面提交，完成 opt-in 用户消息准入、JSONL 磁盘 flush/resume/recall/attribution 链路，以及真实 Jev System3 E2E；旧 shipped profile 黑盒记录为 4/4，但本轮发现共用请求日志与重复查询 canary 的证据缺陷；旧结果不再作为跨进程召回完整证明。严格隔离的五场景验收已分两次过滤运行全部通过（lib 正向 1/1；其余 4/4；过滤项不算执行）。公开发布仍受全仓基线和 CI/打包门禁约束。

## 历史集成交付物

- `tasks/dev-continuum-reflex-integration/handoff.md`：集成交接入口。
- `docs/dev-continuum-reflex-integration/integration-plan.md`：合并顺序、冲突边界和验收矩阵。
- `docs/dev-continuum-reflex-integration/memory-admission-design.md` / `.zh.md`：自动准入设计与事件来源约束。
- `docs/dev-continuum-reflex-integration/release-readiness.md` / `.zh.md`：开源发布就绪审计和阻断项。
- `packages/context/continuum/tests/admission.spec.ts`：自动准入、持久化回放、seed 重启 recall 和 explicit 负向控制。
- `apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts`：真实 `dsh --profile headless` source/lib 双进程链路，以及 no-reflex/disabled 负向控制。
- `apps/cli/tests/profiles/headless/tests/fixtures/continuum-recording-llm.ts`：只记录模型可见请求的 keyless provider fixture。
- `docs/dev-continuum-reflex-integration/classic-cases.md` / `.zh.md` / `.html`：可复现经典案例和发布证据口径。
- 合并与修复提交已保留在本分支历史中。

## 设计约束

- Session 是记忆事实源；Reflex/Jev 只做有界决策。
- 默认 profile 必须保持原版行为；Continuum 只能显式启用。
- 不接受静默 fallback、越权 scope 或迟到决策注入。
- 所有模型可见记忆必须可以从 Session 日志重放。
- 保留 `feat-continuum-memory` 和 `feat-reflex-control` 原始分支，不在其上强制改写历史。

## 历史集成验收（不是本轮全量复验）

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
- [x] 真实 Jev System3：选定 E2E 文件通过；`reflex-context` 严格场景的约束保留断言由确定性 marker 安全层保护，Jev 判定仍完整记录；新增“无关 replacement 不解除约束”回归。
- [x] RunPod Jev endpoint health 返回 ready；未提供有效 `JEV_API_KEY` 时 `/v1/models` 正确返回 401，说明真实 Jev E2E 不能伪造为通过。
- [x] 修复运行时开关开启后仍解析为 `off` 的配置重叠问题；profile 默认使用确定性 `shadow`，Jev provider 仍保持 `off`。
- [x] 只读检查 RunPod `Jev-Serving` pod：`/root/.config/openjev/gateway.key` 存在且权限为 `600`，真实 key 访问 `/v1/models` 返回 200；key 未写入仓库。
- [x] `scripts/continuum-live-e2e.ts` 使用真实 Jev 完成：选择 `migration`，置信度约 `0.7991`，延迟约 `1.9s`。
- [x] `scripts/continuum-evaluation.ts` 使用真实 Jev + DeepSeek gateway 完成 20 个变体/任务单元；11 个适用断言全部通过，结果写入 `docs/feat-continuum-memory/continuum-evaluation-results.json`。

## 正式发布验收状态

- [x] 接入 opt-in 生产级 user-message admission caller；默认仍为 `admission: explicit`，需要 scope 和 Continuum 开关。
- [x] 严格 shipped-profile 复验：首进程落盘来源与 ID → 独立恢复进程请求完整旧 canary，查询不包含 canary；覆盖 source/lib、新 Session 隔离、no-Jev 和 disabled。旧 4/4 记录因证据缺陷不作为该项通过依据。
- [x] 修复 `reflex-context` 真实语义失败：显式精度/文件完整性约束不可由 Jev 删除，补充 41 条本地回归和真实 Jev 严格 E2E。
- [ ] 重跑更大 System3 real-API 矩阵；选定 6 文件已通过，扩展矩阵仍属发布前补充证据。
- [ ] 重新设计并执行完整 Web built suite；当前只证明 Continuum 定向浏览器测试通过。
- [ ] 历史全量 `pnpm run test` 记录有 19 个失败、2 个未处理错误；本轮未完成全量复验，失败集中在合并前未修改的桌面/UI/workflow 基础设施测试，需单独归档或修复后才能宣称仓库级全绿。
- [ ] 公开发布前复核包 tarball、CI secrets lane、版本/tag 和干净 release commit；不得把本地 API key 写入配置、fixture、HTML、日志或提交。

## 分支/部署状态

- 本地 worktree：`.Codex/worktrees/dev-continuum-reflex-integration`
- 分支已推送到 `origin/dev/continuum-reflex-integration`；历史 PR #4 已合并（`https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/pull/4`）；远端 main 已包含该集成 PR。本轮文档／配置清理尚未合并；精确 revision 通过 `git rev-parse HEAD origin/main` 回读。PR 的 Jev/System3 与 Gitleaks 检查因 GitHub Actions budget 未启动，不能视为远端通过；本地定向验收证据已写入 PR。
- 精确 `dev` 分支无法与现有 `dev/continuum-reflex-integration` refs 同时创建，Git 远端拒绝了该 ref。
- 源分支 worktree 均保持不变。
- 当前仓库为 `APUS-AI-Lab/APUS-Reflex-Harness` 与 `APUS-AI-Lab/APUS-Reflex-Frontend`，均 private；当前账号 pull/push 为 true、admin 为 false。转移已完成，不代表本轮未提交修改已经进入远端 main。

## 冷启动 checklist

1. 阅读本文件和 `docs/dev-continuum-reflex-integration/integration-plan.md`。
2. 检查 `git status`、当前 HEAD 和所有 worktree。
3. 回读两仓 main、当前分支和远端归属，区分历史合并与本轮未提交改动。
4. 先解决功能配置和事件类型，再处理生成文档、锁文件和快照。
5. 区分历史集成、本轮定向验证与正式发布验收；不得将 skip 或 test-only consumer 当作产品链路通过。
6. 若继续开发，先运行 `docs/dev-continuum-reflex-integration/release-readiness.md` 的 staging 黑盒序列，再处理 System3 和全仓基线失败。

## 当前里程碑：公开资料与部署配置整改

- 用户批准去掉维护者专属部署默认值，保留配置能力，并更新两仓 main。两仓已转入 APUS-AI-Lab 且仍私有；本轮工作树改动尚未合并推送。
- README 和架构图由主会话继续重构，以最终差异和验证结果为准；新人任务入口是 `docs/dev-continuum-reflex-integration/architecture-followups.md`（另有中文版）。
- 原始 Session 请求、内部管理资产、部署截图已移至仓库外私有备份并保留校验和；历史提交中的副本仍存在，不代表已获准公开。
- 当前受跟踪源码 Gitleaks：124.24 MB，无命中；Frontend 历史：424 commits，无命中；Harness 历史扫描 12,223 commits / 320.52 MB，470 个命中经逐项分类为哈希、合成 fixture、普通文字或标识；未识别出真实凭据，不把非零扫描退出码伪称为零命中通过。
- Frontend 历史文档 PR #2 已合并；本轮配置整改需使用最终 Harness pin 验证并合并，不能用旧 PR 证明新改动已发布。
- GitHub Actions 因账户预算未启动不能记作通过。本地验证逐项记录，不把该环境问题改写为功能成功。
- 机器受到外部编辑器搜索进程持续争用；记录到 built profile 正常首启约 49.53 秒。本文件 E2E 使用同相邻用例的 60 秒单进程预算、120 秒 case 与零重试；五场景真实断言现已通过，前期超时记录仍保留。

### 下一步

- [x] 后端配置修复完成：System3 真实 Loader 13/13、Jev public-bundle 15/15、app-boot startup 20/20 定向通过；相关增量类型和 lint 检查通过。
- [ ] 以最终 Harness pin 完成 Frontend 生成器及打包配置的聚焦验收。
- [x] 完成独立日志与磁盘来源的 shipped memory 验证；5/5 真实执行通过，零重试，保留前期冷启动超时记录。
- [ ] 完成双语配对、文档门禁、Ruff、最终差异审阅和增量类型检查。
- [ ] 合并 Harness main，Frontend 固定其确切 SHA 后验证并合并。
- [x] 两个独立仓库已迁入 APUS-AI-Lab，回读归属、私有状态和当前 push/pull 权限。
- [ ] 核实待公开历史资料处理方案；由具备权限的组织管理员核实协作者、Actions secrets、保护规则等迁移后设置。

### 本轮记忆证据复验

`pnpm run test:e2e apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts` 使用 `-t` 分别选择 built 正向及剩余四场景：1 passed / 4 filtered，随后 4 passed / 1 filtered；合计五个不同用例全部执行通过。该 keyless recording provider 证明持久化和请求注入，不证明真实模型效果或启动 SLA。单文件 typed lint 与 diff check 通过。

### 发布复核发现与修复

独立审阅发现两项升级兼容问题：旧 Jev config-only profile 被禁用、旧 Codex 凭据不再透传，均由配置回归覆盖修复；缺少 Session 分类时 System3 schema 错误仅警告的问题也已修复：未配置、空字符串或 JSON null 明确关闭 System3，显式启用但配置无效时阻断启动。通用生成仍按用户配置出网，不宣称全局禁止联网。文档 quick gate 的提交引用错误已修；文档标准测试曾因主机争用超过默认 5 秒（实测 7.294 秒）失败，单独使用 15 秒预算检查功能，不作为性能通过。

### 本轮公开配置回归

`packages/experimental/system3/tests/public-runtime.spec.ts` 的 13 个真实 Loader 用例全部通过，覆盖未设置分类、错误分类、受控 workspace 策略、既有 config-only/local-only 配置及显式开关。`public-bundle.spec.ts` 的 15 个用例覆盖 Jev 配置与本地 HTTP 的认证／匿名／缺少凭据路径；app-boot 的 20 个 startup 定向用例通过。这些结果与历史真实模型验收分开记录，不代表全量 CI、真实服务质量或签名发布包全部通过。System3 新增 app-boot 开发依赖，离线生成的 lock 仅增加该 importer 映射；增量 TypeScript、typed lint 和 diff 检查通过。
