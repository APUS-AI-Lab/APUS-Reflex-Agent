# feat-independent-harness 交接

## 1. TL;DR

- 新私有仓库：cryptoSUN2049/xDAN-System3-Harness；独立 Git 历史副本，无共享 object alternates。
- 产品目标：将 Jev 理念与模型能力嵌入 DSH，构建通用决策、执行与验证闭环。
- 独立底座与本地验收完成；初始化提交已推送并回读确认，正式目录迁移完成。
- 最新设计入口：docs/feat-independent-harness/jev-native-dsh-native-plan.html；旧 design.html 为初始化方案。

## 2. 本轮交付物

行数为本轮交付时的文件总行数，生成目录仅列发生变化的文件。

| 路径 | 行数 | 说明 |
|---|---:|---|
| `.github/workflows/build-exe-for-python-sdk.yml` | 507 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/build-preview-cloudflare.yml` | 171 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/ci-master.yml` | 523 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/ci.yml` | 726 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/docs-pages.yml` | 95 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/e2e.yml` | 125 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/expected-filenames.yml` | 29 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/independent-harness.yml` | 61 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/issue-lifecycle.yml` | 55 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/issue-policy.yml` | 59 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/node-addon-system-release.yml` | 191 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/node-addon-system.yml` | 170 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/pi-ai-provider-e2e.yml` | 73 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/python-release.yml` | 251 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/release-publish.yml` | 133 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/release-vendor-publish.yml` | 116 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/release-vendor.yml` | 108 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/release.yml` | 182 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/sandbox.yml` | 142 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/weighted-approval-review-event.yml` | 18 | 独立 CI 或继承自动化启用条件 |
| `.github/workflows/weighted-approval.yml` | 62 | 独立 CI 或继承自动化启用条件 |
| `AGENTS.md` | 182 | 产品定位、接口说明或生成目录同步 |
| `README.i18n.yaml` | 6 | 产品定位、接口说明或生成目录同步 |
| `README.md` | 80 | 产品定位、接口说明或生成目录同步 |
| `README.zh.md` | 101 | 产品定位、接口说明或生成目录同步 |
| `docs/capability-seams.i18n.yaml` | 6 | 同步配置、服务、事件或双语派生目录 |
| `docs/capability-seams.md` | 667 | 同步配置、服务、事件或双语派生目录 |
| `docs/capability-seams.zh.md` | 669 | 同步配置、服务、事件或双语派生目录 |
| `docs/config-catalog.i18n.yaml` | 6 | 同步配置、服务、事件或双语派生目录 |
| `docs/config-catalog.md` | 4381 | 同步配置、服务、事件或双语派生目录 |
| `docs/config-catalog.zh.md` | 4383 | 同步配置、服务、事件或双语派生目录 |
| `docs/event-producer-consumer.i18n.yaml` | 6 | 同步配置、服务、事件或双语派生目录 |
| `docs/event-producer-consumer.md` | 102 | 同步配置、服务、事件或双语派生目录 |
| `docs/event-producer-consumer.zh.md` | 104 | 同步配置、服务、事件或双语派生目录 |
| `docs/feat-independent-harness/README.i18n.yaml` | 6 | 独立入口、配置与 Jev 产品路线 |
| `docs/feat-independent-harness/README.md` | 62 | 独立入口、配置与 Jev 产品路线 |
| `docs/feat-independent-harness/README.zh.md` | 62 | 独立入口、配置与 Jev 产品路线 |
| `docs/feat-independent-harness/design.html` | 52 | 独立入口、配置与 Jev 产品路线 |
| `docs/feat-independent-harness/system3-jev.patch.yml` | 19 | 独立入口、配置与 Jev 产品路线 |
| `docs/subsystems/mcp.i18n.yaml` | 6 | 同步配置、服务、事件或双语派生目录 |
| `docs/subsystems/mcp.md` | 162 | 同步配置、服务、事件或双语派生目录 |
| `docs/subsystems/mcp.zh.md` | 162 | 同步配置、服务、事件或双语派生目录 |
| `packages/experimental/agui/README.i18n.yaml` | 6 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/README.md` | 121 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/README.zh.md` | 121 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/cordis.patch.yml` | 12 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/package.json` | 92 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/src/agui.ts` | 105 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/src/http.ts` | 70 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/src/index.ts` | 420 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/src/persona.ts` | 160 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/src/projection.ts` | 63 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/src/run.ts` | 195 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/tests/agui.spec.ts` | 239 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/tests/harness.ts` | 148 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/agui/tests/persona.spec.ts` | 48 | 通用人格、HTTP 接口说明及行为回归 |
| `packages/experimental/apus-dsh-jev-plugin/package.json` | 56 | 独立仓库归属 |
| `packages/experimental/apus-dsh-jev-plugin/src/index.ts` | 129 | 产品定位、接口说明或生成目录同步 |
| `packages/experimental/system3-evidence/package.json` | 21 | 独立仓库归属 |
| `packages/experimental/system3-policy/package.json` | 30 | 独立仓库归属 |
| `packages/experimental/system3-supervisor/package.json` | 21 | 独立仓库归属 |
| `packages/experimental/system3/README.i18n.yaml` | 6 | 产品定位、接口说明或生成目录同步 |
| `packages/experimental/system3/README.md` | 87 | 产品定位、接口说明或生成目录同步 |
| `packages/experimental/system3/README.zh.md` | 87 | 产品定位、接口说明或生成目录同步 |
| `packages/experimental/system3/package.json` | 61 | 独立仓库归属 |
| `packages/experimental/system3/src/index.ts` | 227 | 产品定位、接口说明或生成目录同步 |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 8142 | 产品定位、接口说明或生成目录同步 |
| `packages/mcp/mcp-client/src/index.ts` | 217 | 产品定位、接口说明或生成目录同步 |
| `packages/preset/agent-preset/skills/cordis-composition-reference/references/packages.md` | 504 | 产品定位、接口说明或生成目录同步 |
| `scripts/gen-cordis-catalog.ts` | 1319 | 登记 Jev/System3 服务与 MCP 事件文档归属 |
| `scripts/gen-doc-graphs.ts` | 1705 | 登记 Jev/System3 服务与 MCP 事件文档归属 |
| `snapshots/sdk/agui-persona/cordis.snapshot.yml` | 15 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/cordis.yml` | 33 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/notifications.expected.jsonl` | 16 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/persona-producer.mjs` | 12 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/result.expected.json` | 1 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/session.v4.jsonl` | 18 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/snapshot.yml` | 9 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/agui-persona/system-prompt.expected.md` | 41 | 真实 SDK profile 人格会话及回放预期 |
| `snapshots/sdk/sdk.snapshot.ts` | 1035 | 真实 SDK profile 人格会话及回放预期 |
| `tasks/feat-independent-harness/handoff.md` | 165 | 本轮冷启动入口 |
| `tasks/feat-system3-foundation/handoff.md` | 87 | 独立项目执行记录与经验 |
| `tasks/lessons.md` | 17 | 独立项目执行记录与经验 |
| `tasks/todo.md` | 24 | 独立项目执行记录与经验 |

## 3. 设计约束

- 产品目标不受原消费 App 的业务需求或兼容性约束；来源仅保留历史价值。
- 原项目代码、分支和部署未改；保留上游 MIT、历史与包名，不发布 npm 包。
- 使用 DSH profile 与插件 extension point，不复制或修改 AgentLoop。
- 模型建议不能改变权限、隐私、取消与权威预算；candidate_done 不能替代独立验收。
- 现有 ctx.jev 与 ctx.system3.shadowDecision 是显式决策和影子记录；自动语义监督和执行控制未实现。

## 4. 已踩坑与真实行为

- 最新来源代码已经有 typed Jev provider、Session 决策记录和回放，旧 foundation handoff 仍有过期状态。
- 现有 shadow state 只有结构化 checks/evidence refs/budget，没有任务语义投影；不能据此声称模型已理解执行进展。
- 当前 supervisor 允许空 checks，且 passing check 的 evidenceRefs 未逐项验证；自动完成判断前必须修复。
- 独立 overlay 默认 local-only + network，会拒绝未批准的网络决策；SSH 隧道不能声明成本地执行。
- overlay 需要 JEV_ENDPOINT、JEV_MODEL；发起决策还需要 JEV_API_KEY 凭据引用。
- --dump-config 保留 !!js 表达式，不代表环境已求值。--dump-config-schema 输出 JSON 但因继承的 session-title subject UTF-16 原生长度验证警告退出 1，本轮未改该已知限制。
- Web 认证启动 URL 含一次性 token；检查启动必须保留 Cookie，不可把缺少认证的 401 当作启动失败。验证后已结束并等待自有进程退出，日志 token 已脱敏。
- 修改 workspace manifests 后需要重新 pnpm install --offline --frozen-lockfile 同步元数据，再执行 pnpm scripts。
- 文档检查暴露了继承代码缺失的 JSDoc、MCP 事件 mode/owner、Jev/System3 服务分类和不可编译示例；本轮补齐并重新生成目录，未跳过门禁。

### 实际验证

| 检查 | 结果 |
|---|---|
| pnpm install --offline --frozen-lockfile | 通过，独立 workspace 依赖 |
| pnpm run build | 通过，native、Host、Client 与 Web 产物 |
| Jev/System3 五包 focused Vitest | 9 文件、35 测试通过 |
| AG-UI focused Vitest | 18 测试通过 |
| persona.ts scoped coverage | statements/branches/functions/lines 均 100%，不是全仓覆盖率 |
| SDK system3-shadow replay | 1 场景通过，无模型密钥 |
| SDK agui-persona refresh + replay | 新场景真实 profile/生产 installer，最终回放通过 |
| catalog partition 与 doc graph 回归 | 10 + 3 测试通过 |
| pnpm run lint:contracts-ready | 全仓通过 |
| pnpm run verify-package-meta | 通过；沙箱 IPC 阻塞后原命令宿主重跑 |
| pnpm run doc-sync | 42 passed，0 failed，含文档构建与类型示例 |
| 隔离 DSH_HOME 启动 Web + Jev overlay | 认证后 HTTP 200 与 HTML；无 App 服务或模型凭据，不发起真实推理 |
| ruff check . / ruff format --check . | 通过，31 个 Python 文件格式已符合要求 |
| git diff --check / independent workflow actionlint | 通过 |

本轮没有复测真实 Jev/生成模型质量，没有完成全平台或完整覆盖率矩阵。现有 HTTP 集成 fixture 与 live provider 实测不是同一种证据。

## 5. 下一里程碑任务清单

- [ ] 定义独立 verifier、目标版本与完成证据要求，修复空 checks 和 evidenceRefs 完整性。
- [ ] 构建有界任务/轨迹/证据语义投影，分类准入后保存完整 Jev 输入。
- [ ] 用 agent/turn-stopping 等 extension point 安装自动 shadow consumer，明确次数、取消及卸载行为。
- [ ] 绑定真实预算所有权和并发预留；目标变化后拒绝应用旧决策。
- [ ] 配对任务验证成功率、每成功任务总成本、P95 和错误完成，再晋级有界控制、路由与专家委派。

## 6. 分支与部署状态

- 工作分支：feat-independent-harness；目标默认分支：main。
- 正式本地目录：/Users/gumpm5/Documents/Code/xDAN-System3-Harness。
- 隔离 worktree：.Codex/worktrees/feat-independent-harness，交付时保留。
- origin 只指向新私有仓库；upstream 为官方 DSH，push URL 为 DISABLED；已移除 donor remote。
- 新项目未部署。独立 CI 使用 hosted runner；继承 workflow 的 50 个 job 仅在 DSH_UPSTREAM_AUTOMATION=true 时执行。
- 首次 push 已完成，远端 main 已回读确认；首次 HTTP/2 上传失败后用 HTTP/1.1 成功重试。Actions 已启用，但回读时尚无 workflow run，远端 CI 未验证；没有把跳过的继承任务视为验证通过。

## 7. 冷启动 checklist

1. 读本交接、独立 README 与 design.html，保持 Jev 决策/执行/验证目标。
2. 在正式仓库根核对 git status、HEAD、worktree 和 origin，再进入隔离 worktree 开发。
3. 初始化依赖与 native；根据修改范围选择测试。无密钥回放与真实模型验证分别报告。
4. 查看最新远端 CI；不要为恢复旧自动化而直接启用 DSH_UPSTREAM_AUTOMATION。
5. 先完成证据与预算所有权，再让 Jev 改变执行流程。

## 8. Jev Native + DSH Native 专项方案

- 交付：中英文根 README 的架构入口；docs/feat-independent-harness/architecture.svg、architecture@2x.png、jev-native-dsh-native-plan.html；集成指南链接与双语配对记录；tasks 的计划及纠偏经验。
- HTML 为离线单文件，图形与样式内嵌；原子能力、场景、记忆、路由与长期 Goal 均作为候选领域审查。没有修改运行时代码，也未引入 Pilot 代码。
- DSH / Pilot 源码审计与两轮反方 review 后，撤回“首期必需新增 pre-assembly 契约”；首个恢复试验固定 route、不裁工具，现有生命周期优先。联合路由需另验容量、compaction、重试与单一 selection 所有者。
- Goal 已有原生状态及续轮，但恢复后 disarm；Schedule 不唤醒冷会话；workflow 无跨重启恢复；storage/FTS 不等于语义长期记忆。不能在方案中把这些条件抹掉。
- 最终只读复核无新增实质阻断项；不是运行时或收益验收。首个任务族、候选、实际 Jev 部署及预算仍需实施前确认。
- 交付物：专项 HTML 251 行、SVG 86 行、PNG 2400×2520；根 README 与集成指南双语同步。
- 图形人工检查、浏览器离线加载（零外部资源）、22 个 HTML 链接及 Markdown 链接检查通过；doc-sync 42/42、pnpm run lint 通过。首次检查发现旧交接中的提交 hash 违反仓库引用规则，已修正并通过复验。
