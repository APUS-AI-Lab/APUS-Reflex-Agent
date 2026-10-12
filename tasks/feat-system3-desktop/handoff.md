# feat-system3-desktop 交接

## 1. TL;DR

- 产品为独立 Jev Native + DSH Native，入口第一目标、合理过程快决策第二目标。
- 用户选定 dataelement/dsh-desktop，并同意对齐 DSH 0.1.7-rc.2。
- 用户明确要求完整后端 Goal：入口、过程、能力/记忆与长期目标维护；必须尊重 Jev 9B 的有限能力。
- 本轮为统一设计阶段；中文 v1.3 架构、v3 连续任务体验和三层跨端设计已生成，产品代码尚未实施。
- 工作区 feat-system3-desktop 从上一工作分支创建；主目录与旧工作区保持干净。

## 2. 本轮交付物

| 路径 | 行数 | 说明 |
|---|---:|---|
| `docs/feat-system3-desktop/system3-native-v1.html` | 569 | v1.2：内嵌完整架构、本机 Lead 演进位置、体验入口与页内回放 |
| `docs/feat-system3-desktop/system3-experience-v2.html` | 91 | 七场景离线体验：记忆、诊断、专家、恢复、降级、缺档与控制 |
| `docs/feat-system3-desktop/system3-experience-review.md` / `.zh.md` | 各 114 | 体验方向、信息层级、原稿改造、原生事实与验证计划 |
| `docs/feat-system3-desktop/system3-experience-review.i18n.yaml` | 6 | 中英文一致性记录 |
| `docs/feat-system3-desktop/diagram/jev-harness-flow.svg` | 137 | 可访问、离线的中文流程架构图 |
| `docs/feat-system3-desktop/diagram/jev-harness-flow@2x.png` | 2880×2560 | 高清架构图导出 |
| `docs/feat-system3-desktop/diagram/jev-harness-invocation.svg` | 178 | 调用与返回架构图 |
| `docs/feat-system3-desktop/invocation-verification.json` | 84 | 本次设计与浏览器验证记录 |
| `docs/feat-system3-desktop/diagram/jev-harness-invocation@2x.png` | 3200×3080 | 高清调用架构图 |
| `docs/feat-system3-desktop/experience-verification.json` | 118 | 本轮交互、图、文档与 lint 证据；后端未验收 |
| `docs/feat-system3-desktop/jev-sdk-preflight.json` | 117 | SDK固定来源、两种供给合成smoke；不含凭据 |
| `docs/feat-system3-desktop/verification.json` | 85 | 固定来源、设计复核与检查记录；明确未实施项 |
| `tasks/feat-system3-desktop/plan.md` | 36 | 当前 Goal 的可勾选计划 |
| `tasks/todo.md` | 121 | 承接历史目标与新阶段入口 |
| `tasks/lessons.md` | 70 | 完整后端、真实版本、速度与记忆边界经验 |
| `tasks/feat-system3-desktop/handoff.md` | 101 | 冷启动入口 |

## 3. 设计约束

- 不加入 Duse 产品依赖，不迁入 agent-jev-pilot 代码。
- DSH 是唯一执行所有者；Jev 只选少量合法候选或弃权。
- 规则管权限、隐私、取消、预算与验收；复杂规划与生成属于 System2。
- DSH/Host/Client/System3/桌面 runtime 全部统一正式0.1.7-rc.2；两种 Jev 供给统一官方 TypeSafe SDK。
- 前端不直接调用 Jev、不自行修改模型；按持久事件和投影展示真实采用。
- 设计确认后按 G1—G6 实施，遵守 Human Gate；所有代码在隔离 worktree 修改。
- 本轮文档集中到 `docs/feat-system3-desktop/`，流程交接到 `tasks/feat-system3-desktop/`。

## 4. 已发现的真实行为

- 本仓库实际共同祖先是官方 rc.1；到 rc.2 有346提交、3433文件变化。定制与升级交叠46文件，不能只改版本。
- dataelement 的 package.json 为 rc.2，README 仍写 rc.1；存在25个DSH补丁、另2个依赖补丁。
- Desktop 通过独立 Electron Node 进程运行 DSH CLI Web profile，不是第二 AgentLoop。
- SessionController 生命周期补丁与 Jev router 的取消、恢复、人工固定和卸载需要一起验收。
- AgentLoop 先 assemble 捕获 selection/工具 schema，再 pre-step；首期中间节点适合上下文选择，不能在此随意裁工具/换模型。
- 当前 modelSelection wire 只有 lastUsed/next；缺少自动/固定意图与恢复自动 API。
- header 只证明请求配置已准备；采纳→输入 rpcId→turn/step→有效 header→输出/attempt 需要完整关联；分页缺档不能认定未采用。
- Goal 恢复/fork 后 disarmed；只有轮数限制，费用/Token/时间预算需补。Schedule 只处理 live Agent，不唤醒 cold Session。
- supervisor 是检查消费库，不是 verifier；空检查和证据引用缺口需要修复才能用于独立完成判定。
- 原生 Goal 完成入口还需统一约束所有模型工具、Remote API 和服务路径，不能只修 supervisor；人类确认必须有可识别授权。
- Skill 正文加载不证明已进入请求，需 waterfall 排序、reject/cancel 与统一防重复；安全 profile 的事件解码和投影必须独立于 Jev provider。
- 整体完成至少有一个经规则对照、实际采用并可回放的过程节点，全部 shadow/禁用不能算完成。
- 最新用户补充：体验更快、记忆压缩不丢关键上下文、原生特点覆盖重要环节。HTML 已补 choice/score/noul、端到端延迟及 compaction 的块选择、事实保护与查回；不承诺摘要语义绝对无损。
- 自有 Jev 9B 与官方 API 都纳入：已有单一 ctx.jev provider registry；官方 TypeSafe API 文档已核实，instructions与Score等级限制需要适配，自有 effort 扩展不盲传。两种供给均通过 SDK0.6.0 的真实三类问题 smoke 和 DSH 响应解析；临时 SSH 通道已关闭。单次样例不代表采用链、性能或质量验收。

- 浏览器重复 load-html 使用 setContent 时可能保留旧脚本绑定；刷新到 about:blank 后重新加载，最新版本1360/390px九项检查均通过。

- 本轮体验评审覆盖完整任务，不缩减为决策日志。恢复历史资料与本次注入分别显示，用户排除控制后续查回/注入；固定模式回执不能残留自动选模结果。
- 图的 sharp 导出器在本机丢失全部文字；最终 PNG 由 gstack browse 以 2× 截图，中文和框内排版已核对。

设计交付、SDK补充交付和本轮复核三个连续Goal回合均未收到具体设计实施确认；只读审计、独立复核与两种SDK真实预检已完成，剩余实现依赖用户Human Gate。

## 5. 下一里程碑任务清单

- [ ] 具体设计确认。
- [ ] G1：rc.2 源码合并与核心回归，桌面补丁映射，自有 runtime 联调。
- [ ] G2：原生 routing mode API、投影与 Conversation 决策卡；真实入口验收。
- [ ] G3：Skill 小候选选择、实际加载与规则对照。
- [ ] G4—G6：基础记忆/诊断、委派/Goal 维护、整体真实链路与收益验收。

## 6. 分支/部署状态

- 分支：feat-system3-desktop，基于 feat-independent-harness；本轮尚无产品代码修改。
- main 保持原有状态；没有 PR、merge 或新的常驻部署。
- Goal 未完成；当前实施前置条件是具体设计确认，状态以 Goal 工具为准。
- 上轮远端 Actions 受 budget 阻止，不能视为 CI 通过。

## 7. 冷启动 checklist

- [ ] 先读本文件，再读 `tasks/todo.md` 和统一 HTML。
- [ ] 核实用户是否已确认具体设计；未确认时不开始产品实现。
- [ ] 查看 git status/diff/stash/worktree 与 HEAD，保护用户改动。
- [ ] 读 `tasks/lessons.md`、原生架构及相关子树 AGENTS。
- [ ] 按 G1 源码合并，不以 package version 替代实际升级；各批次跑相关检查。

## 8. 本轮验证

独立架构/UI复核通过；新增性能与压缩复核要求所有fallback也经过同一事实检查，已纳入。HTML32链接和15锚点、1360/390px九项状态检查通过，无控制台错误；文档快检20/20、doc-sync42/42、Host构建与lint、Ruff双检查通过。rc.2只做merge-tree冲突预览，未实施合并；后端Goal未完成。完整记录见 `docs/feat-system3-desktop/verification.json`。

## 9. v1.2 体验与架构补充

使用 frontend-ui-engineering、dsh-client-ui-ux、ui-animation、gstack browse 与 baoyu-diagram；两项独立产品/原生事实审查。主 HTML 直接嵌入 SVG，来源图及 PNG 可单独打开；体验稿有七场景、自动/固定、暂停/恢复、停止收尾、来源查看与后续排除。66 项浏览器交互断言通过；320—1440px 无整页溢出，明暗主题、键盘、减少动态效果和页内回放已核对。doc-sync 42/42、Host lint、静态链接/脚本/SVG 与 diff 检查通过。新评审已完整配对；旧验证记录的仓库 commit 引用改为实际 release tag/文档，原固定信息在历史版本保留。产品后端与本机 Lead 仍待批准后实现，不能把样例结果当实测收益。

## 10. 调用关系图补充

主 HTML 的 `#invocation-architecture` 内嵌调用图；v2 顶部“调用关系图”跳到页内可折叠图，并提供 SVG / PNG 及完整说明入口。新增图明确 UI→Host、System3→Jev、AgentLoop→模型、工具→专家及结果回父任务→UI 的方向；固定或不适用入口跳过 Jev。当前 Fetch provider、目标 SDK 替换、待实施过程节点和未来本机通用 9B/27B Lead 分别标明。专家内部执行由专家运行时管理，Harness 负责委派生命周期与结果归属。

本次为静态设计补充，没有改变产品代码。新增 SVG 的 IDs 与样式使用 `ji-` 前缀隔离；主 HTML 内嵌与独立 SVG 一致。浏览器检查两页 1360/390px、键盘展开、图中文字及 66 项既有场景断言通过，静态链接/脚本/XML、Markdown 链接/换行与 diff 检查通过；未重复运行上一轮完整 doc-sync 或产品构建。当前文件校验记录在 `docs/feat-system3-desktop/invocation-verification.json`，上一轮体验记录保留其当时文件摘要。

## 11. 三层智能与私有前端仓库

最新体验入口为 `docs/feat-system3-desktop/system3-experience-v3.html`，详细实施设计为 `system3-intelligence-design.html`；主 HTML v1.3 内提供链接与嵌入。v3 使用离线编写样例，支持月报、专家接力、历史续做，形成同一任务的入口、过程与体感体验。真实后端 G1—G6 仍未实施。

| 本轮文件 | 行数 | 内容 |
|---|---:|---|
| `docs/feat-system3-desktop/system3-native-v1.html` | 573 | 统一 v1.3 入口与图 |
| `docs/feat-system3-desktop/system3-experience-v2.html` | 91 | 保留参考，纠正收到与准入 |
| `docs/feat-system3-desktop/system3-experience-v3.html` | 74 | 工作台结构与控件 |
| `docs/feat-system3-desktop/system3-experience-v3.css` | 9 | 响应式、明暗与动态偏好 |
| `docs/feat-system3-desktop/system3-experience-v3.js` | 716 | 离线状态与用户控制 |
| `docs/feat-system3-desktop/system3-intelligence-design.html` | 184 | 三层机制、两仓职责、API 草案、G0—G6 |
| `docs/feat-system3-desktop/system3-browser-qa.json` | 428 | 浏览器布局、键盘、v2 回归证据 |

`intelligence-verification.json` 保存本轮文件摘要与验证范围。v3 37 项浏览器状态断言、独立 Node VM 14组/62断言、v2 66项回归与23组布局检查通过；Markdown wrap/link、JS/HTML/SVG 静态检查、Ruff 双检查和 diff 检查通过。没有重复运行产品构建或完整后端测试。

原型已修复提交快照与下一草稿混用、停止后遗失待答复/取证、排除来源仍通过验收、普通任务误称 Goal 的问题。恢复依据独立待办事实，重新允许来源不倒填旧请求。推进按钮禁用后仅在该用户动作原本持焦点时交接到新控件。

前端本地根目录为 `/path/to/projects/xDAN-System3-Frontend`，隔离工作区 `.Codex/worktrees/chore-bootstrap`；GitHub `cryptoSUN2049/xDAN-System3-Frontend` 已核验 private=true、fork=false、default=main，远端与本地初始化提交一致。保留 481 条上游历史和 MIT；origin 为私有仓库、upstream 为 dataelement。HTTPS 首推连接重置后，HTTP/1.1 加缓冲完成传输。应用品牌与 runtime 未修改、未安装依赖或启动。后续从该仓库 `tasks/chore-bootstrap/handoff.md` 冷启动。

- [x] 完成三层穿透设计、桌面 v3 与前端私有源码仓库。
- [ ] 确认具体设计，执行 G1 版本与桌面接入；保持唯一 Harness 执行核心。
- [ ] G2/G3 优先完成真实入口回执与一个实际采用的过程节点，再推进 G4—G6。

## 12. 任务目标记录与前端接入复核（2026-10-01）

用户要求把完整任务目标记录下来，并审视 UI/UX 与前端对接是否完成，再次明确前端目录为 `/path/to/projects/xDAN-System3-Frontend`。当前计划已记录三层目标、完整完成标准和具体接入文件；评审文档为 `docs/feat-system3-desktop/delivery-objectives-and-ux-audit.html`，主设计和详细设计均已链接。

完成度：设计覆盖和离线原型已交付，生产交互尚未全部定稿；Frontend 产品接入未实施，真实安装包/用户验收未完成。前端相对上游只有两份 Python 格式与两份文档改动；`src/main/index.ts` / `src/main/runtime/harness-runtime.ts` 仍加载官方 npm runtime；`build/dsh-desktop.patch.yml` 与 `packages/dsh-desktop-client-ui/` 是可复用装配点。后端当前 shadow 投影 Host-only，不能直接作为客户端入口采用投影。

独立 ops 工作区交接记录 Jev 9B 公网 HTTPS 已于 2026-09-30 通过26项验证，日常不再依赖SSH；没有配置无人值守重启恢复。本轮只读核对该记录，没有探活、读密钥、改默认effort或合并运维分支。新供给条件不代表桌面已装配。

UX复核要求收敛首次使用/真实材料、任务与对话/Goal、成果优先和窗口高度、控制部分失败、预算/排队/专家异常、真实等待、原生可访问性和目标用户验证。下一步按一条真实任务同时交付后端事实、界面反馈、控制和失败恢复；首条切片不替代G1—G6全部目标。建议首批接口升级核对任务，任务族仍属建议。

本轮只改目标/评审文档，未改变模型、runtime、前端应用或部署；产品代码仍按用户既定设计确认流程开展。

本轮新评审 HTML 107 行、计划 78 行；主 HTML 574 行和详细设计 184 行新增评审入口，todo/lessons 同步。验证：新增页1360/390px无整页横向溢出、表格可聚焦；三页99个本地资源/链接引用通过；Markdown wrap 2240文件、links 2218文件与diff检查通过。前端工作区和 Harness 主目录未改动；本轮不推送、不部署，保留设计 worktree。

## 13. 入口与体感速度审查（2026-10-01）

使用 dsh-speed-up-perf、既有UIUX/动效规范及两项只读审查；优化方案归入 `delivery-objectives-and-ux-audit.html#speed`，计划新增速度验收清单。未新建原型，未修改产品代码、effort、网络或部署，未运行性能基准或真实模型请求。

确认：Conversation 已有 beginSubmission→nextPaint 的立即回显；入口自动路径等待 Jev 再准入；HTTP 默认30秒timer在凭据解析后启动，不能替代入口总deadline；Fidoo modelInfo为本地snapshot；文本流连续3个rAF合并且无首块即时分支；桌面已有预热、稳定窗口为0。优化优先验证入口总预算/合法基线、无实质选项旁路、首个有效输出与阶段成果、首块发布策略；再按分段测量处理公网连接、启动/准备、模型与过程判断频率。

测量卡包含真实用户终点、公开任务、冷暖/并发/错误、单调时钟与请求关联、原始样本和p50/p95、质量/成本/资源、负对照与停止规则。100ms本地回显是待校准体验目标，非实测SLA；历史low入口与公网high多问题不可混比。检查范围为HTML引用、390/1360px布局、Markdown wrap/link与diff；不把文档检查称为产品提速验证。

## 14. A100 新供给与核心目标（2026-10-01）

用户截图与 ops-jev9b-a100 指南一致：A100/high32；27决策+15原生回归、5指南示例通过。计划已更新8086决策根地址和8002标准Base URL；结构化决策无stream、原生SSE可用且共用high引擎，模型名不可混用。旧Pod不再作为当前接入目标。新决策样本中位数3.52秒（15项成功含并发）不是生产SLA或与旧环境可比基准；未配置自动重启恢复。本轮只读核对，无服务请求、密钥读取或运行配置变更。

核心目标是Harness与 `/path/to/projects/xDAN-System3-Frontend` 贯通入口、过程、体感的真实任务。下一主线是自有runtime装配→真实入口与过程采用→成果/控制/恢复UI→端到端验收，不能用服务部署或静态设计替代。更新文件：plan.md、现有UX审查HTML、lessons.md及本交接；未合并运维分支。
