# feat-independent-harness 交接

## 1. TL;DR

- 新私有仓库：cryptoSUN2049/xDAN-System3-Harness；独立 Git 历史副本，无共享 object alternates。
- 产品顺序：第一目标是 Jev 入口策略与调度，第二目标是执行环节更智能、更顺畅；总体为 Jev Native + DSH Native。
- 独立底座与本地验收完成；初始化提交已推送并回读确认，正式目录迁移完成。
- M1a 首片已实现：显式启用的 Web/API 空闲文本选模，真实 Jev 9B → Fidoo Flash / Pro 已验证；其他入口及过程智能仍待后续。
- 最新入口：docs/feat-independent-harness/README.zh.md；第 12 节记录 Web UI 选型及默认产品隔离修复，总体方案仍为 jev-native-dsh-native-plan.html。

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
- ctx.jev 与 ctx.system3.shadowDecision 保留显式决策和影子记录；entryRouting 显式启用 Web/API 空闲文本选模。自动过程监督与任务完成判断未实现。

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

- [x] M1a 首片：共享入口决策服务与 Web/API 空闲文本适配，两个兼容模型，实际路由采用、请求准入、取消、过期和每回合有效期；详见第 11 节。
- [ ] M1b：专业委派与规划／澄清，附件／排队批次关联，headless／SDK／ACP 分别适配与验收。
- [ ] M2：同一原生机制上的记忆、能力、恢复、升级、目标与沟通；完成证据相关缺口在自动完成判断前补齐。
- [ ] M3：通过实测的本地 9B/27B Lead 与跨会话任务恢复、主动跟进。

## 6. 分支与部署状态

- 工作分支：feat-independent-harness；目标默认分支：main。
- 正式本地目录：/path/to/projects/xDAN-System3-Harness。
- 隔离 worktree：.Codex/worktrees/feat-independent-harness，交付时保留。
- origin 只指向新私有仓库；upstream 为官方 DSH，push URL 为 DISABLED；已移除 donor remote。
- 新项目未部署。独立 CI 使用 hosted runner；继承 workflow 的 50 个 job 仅在 DSH_UPSTREAM_AUTOMATION=true 时执行。
- 首次 push 已完成，远端 main 已回读确认；首次 HTTP/2 上传失败后用 HTTP/1.1 成功重试。Actions 已启用，但回读时尚无 workflow run，远端 CI 未验证；没有把跳过的继承任务视为验证通过。

## 7. 冷启动 checklist

1. 读本交接、独立 README 与 jev-native-dsh-native-plan.html；design.html 仅为初始化方案。
2. 在正式仓库根核对 git status、HEAD、worktree 和 origin，再进入隔离 worktree 开发。
3. 初始化依赖与 native；根据修改范围选择测试。无密钥回放与真实模型验证分别报告。
4. 查看最新远端 CI；不要为恢复旧自动化而直接启用 DSH_UPSTREAM_AUTOMATION。
5. 先完成证据与预算所有权，再让 Jev 改变执行流程。

## 8. Jev Native + DSH Native 专项方案

- 交付：中英文根 README 的架构入口；docs/feat-independent-harness/architecture.svg、architecture@2x.png、jev-native-dsh-native-plan.html；集成指南链接与双语配对记录；tasks 的计划及纠偏经验。
- HTML 为离线单文件，图形与样式内嵌；能力、场景、记忆、路由与长期 Goal 的接入位置均经过审查。没有修改运行时代码，也未引入 Pilot 代码。
- DSH / Pilot 源码审计与两轮反方 review 后，撤回“首期必需新增 pre-assembly 契约”；首个恢复试验固定 route、不裁工具，现有生命周期优先。联合路由需另验容量、compaction、重试与单一 selection 所有者。
- Goal 已有原生状态及续轮，但恢复后 disarm；Schedule 不唤醒冷会话；workflow 无跨重启恢复；storage/FTS 不等于语义长期记忆。不能在方案中把这些条件抹掉。
- 最终只读复核无新增实质阻断项；不是运行时或收益验收。首个任务族、候选、实际 Jev 部署及预算仍需实施前确认。
- 交付物：专项 HTML 251 行、SVG 86 行、PNG 2400×2520；根 README 与集成指南双语同步。
- 图形人工检查、浏览器离线加载（零外部资源）、22 个 HTML 链接及 Markdown 链接检查通过；doc-sync 42/42、pnpm run lint 通过。首次检查发现旧交接中的提交 hash 违反仓库引用规则，已修正并通过复验。
- 专项方案、SVG/PNG 与中英文 README 已推送新仓库 main；推送前 Ruff 双检查与类型检查通过。正式目录 main 与保留 worktree 同步交付。


## 9. 中文原生决策方案修订

- 用户再次明确：产品主线和特点是 Jev Native 深入 DSH 架构、能力与各环节决策；记忆、路由、长程目标和主动沟通沿此展开，9B/27B Lead 是未来部署演进。不能改成泛本地 Lead 平台。
- 主图采用中文，中心为原生事实、合法候选、Jev 判断、原生服务采纳及结果反馈；正文十节，明确六类作用点的输入、结构化判断、DSH 消费者与限制。中文和英文根 README 同步此定位。
- 本次修订当时建议固定执行模型、工具和路由，验证失败诊断后下一项证据选择；该试验现按第 10 节移至第二目标。规则、Jev、System2 使用同一候选与证据比较，包含候选形成及所有失败代价；不以完整 Lead 平台或新增核心接口为前提。
- 反方最终复核无实质阻断；可行性表已将 Jev 行置首。模型能力、自动融合与净收益均未声称已实现；没有运行模型实验或发送外部消息。
- 图形与离线浏览器检查通过：中文路径字形、22 个本地链接及锚点、唯一 ID、内嵌 SVG、零外部资源，桌面和 390px 手机宽度均无整页横向溢出。PNG 为 2400×3100。
- 本轮检查：doc-sync 42/42、pnpm run lint、ruff check .、ruff format --check . 均通过。按正常流程提交推送至 main，由 pre-push 执行增量类型检查；发布以远端回读为准，保留 worktree。

本次文档改动清单（文件总行数）：

| 路径 | 行数／尺寸 | 用途 |
|---|---:|---|
| `README.md` | 90 | 英文架构入口 |
| `README.zh.md` | 111 | 中文架构入口 |
| `README.i18n.yaml` | 6 | 双语配对记录 |
| `docs/feat-independent-harness/jev-native-dsh-native-plan.html` | 248 | 中文专项方案 |
| `docs/feat-independent-harness/architecture.svg` | 92 | 中文原生决策图 |
| `tasks/lessons.md` | 37 | 用户纠偏规则 |
| `tasks/todo.md` | 45 | 任务与验收记录 |
| `docs/feat-independent-harness/architecture@2x.png` | 2400×3100 | GitHub 图像 |
| `tasks/feat-independent-harness/handoff.md` | 200 | 冷启动入口与本次结果 |


## 10. 入口第一目标与过程第二目标

- 当前方案明确入口 Jev 策略与原生调度为第一目标，执行环节智能与顺畅协作为第二目标；首图、正文、根 README、集成指南与里程碑已统一。9B/27B Lead 保留未来演进，未改运行时代码。
- 入口先选处理方式，再由相应原生服务采用模型、专业委派或澄清；入口和过程共享输入／任务身份、版本、证据与采用记录，单一动作拥有者提交决定。不能将分类或建议当作真实调度。
- 源码确认 selectModel 会保存用户默认，自动请求策略不能直接使用它；内部 selectForNextRequest 可复用会话内行为，但并非跨入口公共 API。Web/API、headless、SDK、ACP 路径不同，逐项适配验收。
- idle 检查不等于原子准入；等待 Jev 时可进入新工作。活跃 followup／steer 与排队消息不能共用一个可被覆盖的 selection.current。首片限定空闲且无待处理输入的文本任务，并补准入保护、身份版本复核与取消。
- 原生插件组合（claimed 输入身份 + awaited assemble）值得验证，但须测试监听顺序、无新输入续步、主动组装、恢复与清理；不预设必须改核心循环。
- 自动选型首片按匹配输入触发的一个回合有效，回合内工具续步可沿用，结束或取消后重新准入；用户固定约束单独记录。未提交首个匹配请求就失败或取消时，记录失效并恢复未消费选择，不回写历史。
- 独立方案评审未发现实质阻断，提出的策略有效期已具体化。工程回放与真实模型质量评测分别验收；入口首片不宣称完整全入口或专家调度已完成。
- 本轮验证：doc-sync 42/42、pnpm run lint、Ruff 双检查通过；中文 SVG/PNG 人工检查及浏览器离线加载通过，29 个本地链接／锚点有效，桌面与 390px 手机宽度无整页横向溢出，零外部资源。
- 本轮文档按正常流程发布 main，pre-push 继续执行类型检查；远端发布状态以 ref 回读为准。没有运行真实模型实验或修改运行时代码。

本次交付清单（文件总行数）：

| 路径 | 行数／尺寸 | 说明 |
|---|---:|---|
| `README.md` | 90 | 入口第一、过程第二 |
| `README.zh.md` | 111 | 中文优先级和架构入口 |
| `README.i18n.yaml` | 6 | 根双语配对 |
| `docs/feat-independent-harness/README.md` | 62 | 入口优先实施路线 |
| `docs/feat-independent-harness/README.zh.md` | 62 | 中文实施路线 |
| `docs/feat-independent-harness/README.i18n.yaml` | 6 | 集成指南双语配对 |
| `docs/feat-independent-harness/jev-native-dsh-native-plan.html` | 304 | 目标、机制、接口、范围及验收 |
| `docs/feat-independent-harness/architecture.svg` | 110 | 入口与过程协同架构图 |
| `tasks/todo.md` | 51 | 当前计划与门禁结果 |
| `tasks/lessons.md` | 41 | 用户明确的目标顺序 |
| `docs/feat-independent-harness/architecture@2x.png` | 2400×3540 | GitHub 架构图 |
| `tasks/feat-independent-harness/handoff.md` | 229 | 冷启动与本次交付 |

## 11. M1a 原生入口与 Fidoo

### 已交付

- SessionController 注册单一可释放 router，System3 原生 Jev consumer 通过 Cordis effect 挂载；不改 AgentLoop，不引入 Pilot。
- 自动选型绑定已准入 requestId，只覆盖当前回合及工具续步；下一回合恢复 Session baseline，人工选型始终优先。
- 维护占用保留排队，等待 Jev 可取消，卸载不切换正在运行的回合模型；恢复和模型展示按实际请求记录处理。
- 两个新增 required-on-read Session 事件有持久类型声明，Session envelope 仍为 V4；新旧 SDK replay 各自独立。
- Fidoo overlay 与入口 overlay 无凭据；配置必须显式声明会话数据分类，Jev 决策只收到当前文本。

### 本轮文件清单

行数为当前交付文件总行数；生成文件及 snapshot goldens 也列出，旧 generation 未改。

| 文件 | 行数 |
|---|---:|
| `.github/workflows/independent-harness.yml` | 62 |
| `README.i18n.yaml` | 6 |
| `README.md` | 90 |
| `README.zh.md` | 111 |
| `docs/capability-seams.i18n.yaml` | 6 |
| `docs/capability-seams.md` | 667 |
| `docs/capability-seams.zh.md` | 669 |
| `docs/config-catalog.i18n.yaml` | 6 |
| `docs/config-catalog.md` | 4413 |
| `docs/config-catalog.zh.md` | 4415 |
| `docs/event-producer-consumer.i18n.yaml` | 6 |
| `docs/event-producer-consumer.md` | 102 |
| `docs/event-producer-consumer.zh.md` | 104 |
| `docs/feat-independent-harness/README.i18n.yaml` | 6 |
| `docs/feat-independent-harness/README.md` | 84 |
| `docs/feat-independent-harness/README.zh.md` | 84 |
| `docs/feat-independent-harness/entry-routing-implementation.html` | 19 |
| `docs/feat-independent-harness/entry-routing-verification.html` | 15 |
| `docs/feat-independent-harness/jev-native-dsh-native-plan.html` | 305 |
| `docs/feat-independent-harness/system3-entry.patch.yml` | 29 |
| `docs/feat-independent-harness/system3-fidoo.patch.yml` | 39 |
| `docs/module-graph.i18n.yaml` | 6 |
| `docs/module-graph.md` | 1679 |
| `docs/module-graph.zh.md` | 1681 |
| `docs/persistence-catalog.i18n.yaml` | 6 |
| `docs/persistence-catalog.md` | 9792 |
| `docs/persistence-catalog.zh.md` | 9794 |
| `docs/persistence-changes/2026-09-29-system3-entry-routing.i18n.yaml` | 6 |
| `docs/persistence-changes/2026-09-29-system3-entry-routing.md` | 52 |
| `docs/persistence-changes/2026-09-29-system3-entry-routing.schema.json` | 712 |
| `docs/persistence-changes/2026-09-29-system3-entry-routing.zh.md` | 52 |
| `docs/persistence-changes/historical-formats/README.i18n.yaml` | 6 |
| `docs/persistence-changes/historical-formats/README.md` | 75 |
| `docs/persistence-changes/historical-formats/README.zh.md` | 75 |
| `docs/persistence-schema.json` | 104836 |
| `docs/subsystems/session.i18n.yaml` | 6 |
| `docs/subsystems/session.md` | 1294 |
| `docs/subsystems/session.zh.md` | 1298 |
| `packages/api/session-controller/README.i18n.yaml` | 6 |
| `packages/api/session-controller/README.md` | 137 |
| `packages/api/session-controller/README.zh.md` | 137 |
| `packages/api/session-controller/src/agent.ts` | 574 |
| `packages/api/session-controller/src/commands.ts` | 714 |
| `packages/api/session-controller/src/index.ts` | 525 |
| `packages/api/session-controller/src/model-selection-projection.ts` | 95 |
| `packages/api/session-controller/src/prompt-router.ts` | 136 |
| `packages/api/session-controller/src/types.ts` | 638 |
| `packages/api/session-controller/tests/prompt-router.host.spec.ts` | 345 |
| `packages/api/session-controller/tsconfig.host.json` | 57 |
| `packages/core/session/src/known-event-types.ts` | 90 |
| `packages/experimental/system3/README.i18n.yaml` | 6 |
| `packages/experimental/system3/README.md` | 95 |
| `packages/experimental/system3/README.zh.md` | 95 |
| `packages/experimental/system3/package.json` | 63 |
| `packages/experimental/system3/src/entry-routing.ts` | 195 |
| `packages/experimental/system3/src/index.ts` | 250 |
| `packages/experimental/system3/tests/entry-loader-composition.spec.ts` | 186 |
| `packages/experimental/system3/tests/entry-routing.spec.ts` | 250 |
| `packages/experimental/system3/tsconfig.json` | 51 |
| `packages/extensions/tool-cordis/src/api-catalog.ts` | 8156 |
| `pnpm-lock.yaml` | 29255 |
| `scripts/gen-cordis-catalog.ts` | 1321 |
| `scripts/gen-doc-graphs.ts` | 1705 |
| `scripts/smoke-python-runtime.py` | 3562 |
| `scripts/snapshots/python-sdk-single-exe/system3-entry-route/model-visible.json` | 639 |
| `scripts/snapshots/python-sdk-single-exe/system3-entry-route/result.json` | 1160 |
| `scripts/snapshots/python-sdk-single-exe/system3-entry-route/session.v4.jsonl` | 21 |
| `snapshots/sdk/sdk.snapshot.ts` | 1051 |
| `snapshots/sdk/system3-entry-route/cordis.snapshot.yml` | 17 |
| `snapshots/sdk/system3-entry-route/cordis.yml` | 33 |
| `snapshots/sdk/system3-entry-route/decision-producer.mjs` | 106 |
| `snapshots/sdk/system3-entry-route/notifications.expected.jsonl` | 19 |
| `snapshots/sdk/system3-entry-route/result.expected.json` | 1 |
| `snapshots/sdk/system3-entry-route/session.v4.jsonl` | 21 |
| `snapshots/sdk/system3-entry-route/snapshot.yml` | 10 |
| `tasks/lessons.md` | 45 |
| `tasks/todo.md` | 69 |
| `tasks/feat-independent-harness/handoff.md` | 345 |

### 验证与部署状态

- API/System3/Jev/policy：50 文件、934 测试；两个新增路由源文件 statements/branches/functions/lines 均 100%，非全仓覆盖率声明。
- 真实 Loader：Jev 选择改变实际生成模型；HTTP 503 保留 baseline；JSONL 恢复无额外 HTTP。
- 实网：同一 Web profile 中改写→Flash、设计→Pro；另两个模型均通过官方 headless 短答。SSH 隧道和 Web smoke 进程均已关闭，未部署常驻服务。
- TS SDK：system3-shadow 与 system3-entry-route built replay；Python 新场景使用官方 dsh launcher wrapper，属于协议测试，非打包可执行文件验收。
- 完整 build、最后 Host 构建与全仓 lint 通过；NodeNext 322 包声明、依赖策略、metadata 和应用启动入口检查通过。doc-sync 42/42、Ruff 双检查、actionlint 通过；最终双 SDK 回放通过。
- 既存限制：verify-default-product-isolation 失败于 apps/cli 对 experimental-agui 的依赖；该 manifest 与本轮 HEAD 基线相同。本轮不声称完整 hygiene 通过，不修改现有 optional AG-UI 打包。
- 当前工作分支 feat-independent-harness；主目录 main 保持不动。本轮以工作分支交付供审查，不创建部署。

### 真实行为与下一轮

- Agent.status=idle 包含 maintenance；runMaintenance 同步拒绝占用，不得吞异步任务异常。
- 全局默认模型可能由其他会话更新，弃权必须保持当前会话基线。自动选型记录本身不是执行证据。
- 远端 gateway 使用 APUS-OpenJev-v1-9B-5949；confidence 未校准。真实 SSH 主机由本次用户提供，不将凭据或专用连接写入公开配置。
- [ ] 建立固定模型基线的路由任务集：分流错误、弃权率、延迟、总成本、重工。
- [ ] 设计明确的自动／人工选型切换体验；首期人工选型后新建会话才能恢复自动。
- [ ] 后续分别接附件／排队批次、SDK／ACP／headless、专业委派；再推进记忆、恢复、目标与沟通。
- 冷启动先读本节与 entry-routing-verification.html，进入本 worktree 核对 git 状态，再按独立集成指南启动；不要运行来源项目的 App overlay。

## 12. Web UI 选型与默认产品隔离修复

- 用户补充希望配套好用的 DSH Web UI。调研候选为 zhu1090093659/dsh-web 与 MichengAI/dsh-codex-ui，报告与原生接入设计在 web-ui-selection.html，独立 README 双语已链接。未安装第三方插件，未新增 UI 运行时代码。
- 建议保留原生 Web，会话只读决策卡为下一切片，自动／固定模式需要后续 Host 状态 API。第三方看板的 selectModel 会触发人工固定，Team 与 Goal 续轮不在 M1a 输入入口覆盖内。看板 succeeded 不等于独立验收。
- 版本证据：本仓库 CLI 0.1.7-rc.1；dsh-web v0.4.4 要求 ≥0.2.0-rc.1，dev 要求 ≥0.2.0-rc.2；Codex UI 当前 manifest 显式列出 0.1.7-rc.1，但尚未本地联调。
- 独立 review 修正了两处展示设计：header 在模型流开始前写入；输入关联经 user/message.source.rpcId 与 turn/step。缺档显示未知／等待确认，不自动判为未采用。
- CLI 的 experimental-agui 移至 devDependencies，overlay 改为相对构建入口，默认生产隔离检查恢复通过。profile resolver 不暴露 devDependencies，单纯移动 manifest 会使裸包名 overlay 失效；相对入口沿用现有 inspector 机制，不放宽 resolver 或检查规则。README 明确已构建源码检出的支持范围。

### 本轮文件（总行数）

| 路径 | 行数 | 说明 |
|---|---:|---|
| `apps/cli/package.json` | 159 | 移除默认AGUI生产依赖 |
| `pnpm-lock.yaml` | 29255 | 同步开发依赖 |
| `packages/experimental/agui/cordis.patch.yml` | 12 | 按overlay相对位置加载构建入口 |
| `packages/experimental/agui/README.md` | 123 | 源码组合支持范围 |
| `packages/experimental/agui/README.zh.md` | 123 | 中文支持范围 |
| `packages/experimental/agui/README.i18n.yaml` | 6 | 配对记录 |
| `docs/feat-independent-harness/web-ui-selection.html` | 68 | 中文UI选型及接入设计 |
| `docs/feat-independent-harness/README.md` | 84 | 报告入口 |
| `docs/feat-independent-harness/README.zh.md` | 84 | 中文报告入口 |
| `docs/feat-independent-harness/README.i18n.yaml` | 6 | 配对记录 |
| `tasks/feat-independent-harness/notes.md` | 13 | 隔离修复与smoke记录 |
| `tasks/lessons.md` | 46 | 展示语义经验 |
| `tasks/todo.md` | 81 | 计划与验收 |
| `tasks/feat-independent-harness/handoff.md` | 385 | 冷启动与剩余任务 |

### 验证、分支与下一步

- 完整 build、102 项相关测试、默认产品隔离、205 个 Cordis 配置、built AG-UI persona SDK 回放通过；派生图重新生成无差异。
- 真实 built Web + AG-UI overlay：匿名 /agui/threads 返回 401，测试 Bearer 返回 200 和空 threads；没有调用模型，临时目录与自有进程已清理。故障与修复过程见本目录 notes.md。
- 中文报告离线浏览器检查：1280px 与 390px 均无横向溢出，零外部资源；16 个链接，图文已人工检查。报告为设计，不是 UI 功能验收。
- 最终文档快检 20/20、doc-sync 42/42、lint、依赖策略、包元数据、Ruff 双检查均通过；本轮以 feat-independent-harness 工作分支交付，main 不动，没有常驻部署。推送使用正常类型检查 hook，发布结果以远端 ref 回读为准。
- 远端 CI 新核实：main 的 Independent harness run 36562864544 因 GitHub Actions budget 未开始执行；feature 无 run。不能声称远端 CI 通过，也不应为此修改测试逻辑。
- [ ] 原生 System3 只读决策卡与回放展示。
- [ ] 明确的自动／固定模式 Host 状态与 UI 操作。
- [ ] 固定模型基线对照的路由质量、延迟、费用与返工评测。
- [ ] 选定社区插件后在隔离 profile 实测版本、工具审批、恢复与 Jev 路由；不为界面直接升级整个 Harness。
- 冷启动先读本节、web-ui-selection.html、entry-routing-verification.html，再检查工作分支状态；远端 CI 需要账户 Actions budget 恢复后才能补证。
