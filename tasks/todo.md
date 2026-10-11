# 独立 Jev + DeepSeek Harness 工作计划

- [x] 用户批准新建独立仓库，核心方向为 Jev 理念与模型能力嵌入 DSH。
- [x] 创建私有仓库 xDAN-System3-Harness，保留来源历史与上游许可证。
- [x] 创建 feat-independent-harness 隔离 worktree；原项目保留。
- [x] 核查现有 typed Jev provider、shadow 决策记录与 Session 回放。
- [x] 移除 AG-UI 默认人格及工具说明中的 Duse 产品依赖。
- [x] 配置独立 CI，继承的上游发布与自动化改为显式启用。
- [x] 编写独立 Jev 配置入口、集成路线和验收边界。
- [x] 完整构建、相关单测、Session snapshot 与文档检查（42 项 doc-sync 全通过）。
- [x] 隔离环境下验证 profile 配置、Web 启动及认证 HTTP 200。
- [x] Ruff 双检查、提交与推送，回读新 main。
- [x] 写入 tasks/feat-independent-harness/handoff.md。
- [x] 迁移并核对正式本地目录 /Users/gumpm5/Documents/Code/xDAN-System3-Harness，修复并保留隔离 worktree。

## Review

初始实现保留显式 Jev API 和非权威 shadow 记录，不声称已实现自动语义监督、自动路由或完整任务验收。后续自动决策必须先补有界任务证据、独立 verifier 与预算所有权。

## 后续里程碑

- [x] M1a 首片：入口决策服务、空闲文本适配及原生选模，校验输入长度、候选准入、请求绑定与回合有效期；质量收益与累计费用预算仍需后续评测。
- [ ] M1b：入口专业委派、规划／澄清、活跃输入批次与 headless／SDK／ACP 分别适配验收。
- [ ] M2：沿同一机制增强记忆、能力、恢复、升级、长程目标与沟通；先修复 supervisor 空检查与证据引用缺口，再考虑自动完成判断。
- [ ] M3：依据能力实测接入本地 9B／27B Lead，并补持久任务和主动跟进的恢复机制。

## README 架构图

- [x] 按 Jev Native + DSH Native 修订架构图，区分现有基础与候选设计，输出 SVG 与 PNG。
- [x] 在中英文 README 嵌入图片并更新配对记录。
- [x] 检查图片、文档与推送门禁，发布到 GitHub main。

## System1 / System2 融合评估

- [x] 审计 DSH 生命周期、插件扩展点及中间决策机会。
- [x] 对照 agent-jev-pilot 架构与实验教训；遵照用户纠偏，不导入其代码或能力。
- [x] 修订架构图与中英文 README，形成原生混合架构专项 HTML；完成独立反方 review 与最终复核。
- [x] 发布已验证的文档；产品代码实施另行确认。

## 中文方案与 Jev 原生决策主线

- [x] 将专项 HTML 和主架构图改为中文为主，围绕原生事实、Jev 判断、动作采纳与结果反馈组织。
- [x] 记忆、路由、长程跟进和主动沟通沿 Jev 主线展开；本地 9B/27B Lead 作为未来部署演进。
- [x] 独立评审、中文图形检查与离线页面验证通过；证据选择试验保留在过程决策评估中，当前以入口决策优先。
- [x] doc-sync 42/42、lint 与 Ruff 双检查通过，准备按正常流程发布 main。

## 入口决策优先与过程协同

- [x] 核实入口输入、模型选择与专业委派的原生时序，明确不同运行入口覆盖范围。
- [x] 更新中文专项方案和主图：入口决策为第一目标，过程智能与顺畅协作为第二目标。
- [x] 重排里程碑与验收，同步根 README 和集成指南双语；独立复核、离线页面、doc-sync 42/42、lint 和 Ruff 双检查通过。

## Fidoo 与原生入口路由实施（用户已批准推进）

- [x] 复核隔离 worktree、已有设计、原生 SessionController/ModelSelection 时序。
- [x] 提供 API 原生可释放的 prompt router；取消、人工选型、持久恢复和单回合有效期。
- [x] System3 opt-in Jev 入口消费者：有界语义、候选白名单、隐私准入、弃权与完整决策记录。
- [x] 接入 Fidoo LiteLLM provider，核实已授权的模型与真实生成链路。
- [x] 补行为测试、真实 Loader 集成、Session/SDK 回放与持久类型声明。
- [x] 更新中英文使用说明与实施状态，完成构建、lint、934 相关测试、doc-sync 42/42、Ruff。
- [x] 独立 review 完成，更新交接与验收记录，交付工作分支；既存默认发行版隔离失败单独记录。

### 实施审查

首期只覆盖 Web/API 空闲、无待处理输入的文本请求。没有 router 时保持原行为。LiteLLM 承担 System2 调用，Jev 使用原生决策协议；不从连通性推断决策收益。

### M1a 最终 review

独立审查发现并修复：弃权不得读取全局默认、其他 maintenance 期间输入应保留原生排队、冷恢复后的 next 模型展示必须与实际选择一致。934 个相关测试通过；两个新决策模块四项覆盖率均 100%。真实 Web profile 中 Jev 9B 将公开改写请求交给 Flash、复杂设计请求交给 Pro，采纳记录与实际 request/header 一致。SDK 测试仅证明事件协议和持久化，不声称 SDK 入口已有自动路由。

## Web UI 选型与独立发行收尾

- [x] 搜索 DSH 原生及社区 UI，核对宿主版本、入口调用与 Jev 决策所有权。
- [x] 形成中文 UI 评估及原生接入方案；区分源码审计、兼容声明和实际运行验证。
- [x] 修复 CLI 默认生产依赖引入 experimental AG-UI，保留源码按需组合及人格回放。
- [x] 运行相关隔离、配置、构建、回放、文档与 lint 验证，更新交接，准备工作分支交付。
- [x] 核实远端 CI：main 的任务未开始，GitHub Actions budget 阻止执行；feature 无 run，不能视为通过。

### Web UI 与隔离修复 review

完整构建、102 项相关测试、默认产品隔离、205 个 Cordis 配置、AG-UI built SDK 回放和真实 Web 鉴权 smoke 通过。文档快检 20/20、doc-sync 42/42、lint、依赖策略与包元数据通过，Ruff 双检查通过。UI 仅完成中文设计与原生／第三方源码审查，未安装候选插件或实现新 UI。独立评审纠正了 header 与执行成功的区别，以及缺档时不能推断未采用。交付保留工作分支，main 与常驻部署未变。

## 第二名桌面与完整后端 Goal

- [x] 用户选定 dataelement 桌面并允许对齐 rc.2；综合历史产品目标。
- [x] 创建 feat-system3-desktop 隔离工作区并完成三项独立源码审计。
- [x] 形成统一 v1.1 中文 HTML、交互示意、接口草案和 G1—G6 后端验收。
- [x] 完成文档独立复核与浏览器验证，交付设计。
- [x] 按用户补充统一正式 rc.2 与 TypeSafe SDK；官方、自有9B真实合成 smoke 和 DSH 响应解析通过。
- [ ] 具体设计确认后，按 [当前工作区计划](feat-system3-desktop/plan.md) 持续实施完整后端 Goal。

### Review

当前交付为设计，不代表 rc.2、桌面、记忆或长期目标后端已经打通。统一方案在 [system3-native-v1.html](../docs/feat-system3-desktop/system3-native-v1.html)，冷启动先读 [handoff](feat-system3-desktop/handoff.md)。

## 即时决策与能力感知交互评审

- [x] 读取交接、经验、原设计与相关前端/交互 skills，确认既有 worktree 干净。
- [x] 浏览器检查原型的默认视图、状态切换、展开层与窄屏。
- [x] 并行审查任务旅程及能力反馈所需的原生事实。
- [x] 形成交互改造评审与独立离线示意，覆盖入口、过程、记忆、委派、Goal、异常及用户控制。
- [x] 验证示意交互、键盘、窄屏与文档检查，更新交接和评审结果。

本轮是设计评审；产品代码实施仍以具体设计确认作为前置条件。

### 本轮交互 Review

主 HTML 升至 v1.2，嵌入完整 Jev/Harness 架构图，未来本机 9B/27B Lead 与专家编排有独立位置；增加七场景离线体验入口和页内回放。中英文评审与一致性记录完整。66 项交互断言、明暗主题/窄屏/键盘/减少动态效果、doc-sync 42/42 和 Host lint 通过。复核修正固定模型、历史恢复与后续排除的组合状态；不宣称新增后端或性能收益。证据见 [experience-verification.json](../docs/feat-system3-desktop/experience-verification.json)。

## Jev / Harness 调用关系架构图

- [x] 复核 worktree 与调用所有权，采用 baoyu-diagram 架构布局。
- [x] 绘制调用和返回关系，标明本机 Lead 经原生工具委派专家。
- [x] 嵌入主 HTML，给 v2 增加页内查看和独立 SVG / PNG 入口。
- [x] 检查图中文字、链接、窄屏与原有交互，更新交接并打开 HTML。

范围为设计交付：调用图补充现有流程图，沿用原生接口，不引入新 API 或产品代码；SDK 替换和本机 Lead 明确标为拟实施。

### 调用图 Review

新增独立调用关系 SVG / 2× PNG，主 HTML 内嵌，v2 提供导航与可折叠查看。独立源码审查确认原生调用所有权，图中区分自动入口的条件调用、固定或不适用的旁路、SDK 替换和未来本机 Lead。静态资源与脚本、1360/390px、键盘展开及 66 项原有交互断言通过，Markdown 链接和换行检查通过。证据见 [invocation-verification.json](../docs/feat-system3-desktop/invocation-verification.json)。

## 对外三层智能体验设计与前端仓库

- [x] 确认 dataelement 桌面选型及创建独立私有前端仓库的授权。
- [x] 完成本地克隆、私有仓库首推与一致性核验，保留 upstream 和许可证。
- [x] 复核入口、过程、体感三层机制及当前原型缺口。
- [x] 形成跨 UI / Host / Agent / 模型 / 工具 / 事件 / SDK 的完整设计与验收。
- [x] 制作基于桌面工作台结构的 v3 连续任务体验，覆盖业务文件、专业专家和中断续做。
- [x] 验证交互、无障碍关键路径、窄屏、事实语义，更新主 HTML 与交接后打开。

设计复用 dataelement 桌面壳与原生 Conversation；本轮不启动后端或产品代码实施。仓库复制保持上游源代码基线。

### 三层智能 Review

主设计升至 v1.3，v3 连续工作台与跨层实施设计已关联。私有前端仓库 main 首推并核验，保留 481 条上游历史；应用未接入自有 runtime。v3 浏览器状态 37 断言、独立 Node VM 62 断言、v2 回归 66 断言与 23 组布局检查通过；修正提交快照、停止后待答复/取证恢复、来源排除验收和普通任务/Goal 区分。验证记录见 [intelligence-verification.json](../docs/feat-system3-desktop/intelligence-verification.json)。

## 三层智能目标记录与 UI/UX 接入完成度复核（2026-10-01）

- [x] 核对当前设计工作区与前端初始化分支，读取交接和既有验收范围。
- [x] 在当前工作区计划中记录完整产品目标、首条真实任务链和不可替代的完成标准。
- [x] 分别复核交互设计成熟度、真实前端接口、运行时接入与用户验收缺口。
- [x] 把缺口、优先级和验收动作补入设计 HTML，同步交接并检查文档。

本轮授权为目标记录与设计复核，不把提问视作产品实现批准；不修改运行时或前端产品代码。

### 目标与接入复核 Review

已明确指定 Frontend 仓库与三个实际装配位置，记录五类完成度及八项 UX 缺口。结论为原型已验证、生产交互尚需收敛、前端接入及用户验收未完成；纳入独立 ops 工作区的公网 Jev 新进展。新增评审页1360/390px无整页溢出，三页共99个本地资源/链接引用通过检查，Markdown wrap/link和diff检查通过；未运行产品构建、模型调用或部署。

## 入口智能与体感速度优化审查（2026-10-01）

- [x] 读取性能技能与真实入口代码，核查已有乐观提交、串行决策与供给验证范围。
- [x] 记录按用户路径排序的优化机会、测量方案和不可破坏的行为。
- [x] 更新现有体验复核与工作区计划，交付优先级；本轮不修改产品代码或默认模型档位。

### 速度审查 Review

确认原生即时回显已存在，自动入口先等 Jev 再准入；默认 HTTP 超时30秒不等于入口总截止。文本流现有三帧合并可作为首块策略对照；Fidoo modelInfo 读取本地 snapshot，桌面已预热且稳定窗口为0，不重复提出已存在的优化。记录9项候选及测量卡，未宣称实测提速、未调用模型或改变high/low配置。现有评审页390/1360px无溢出，HTML链接、Markdown wrap/link与diff检查通过。

# System3 G1 产品实施预检历史（运维会话，实施授权前）

- [x] 读取三层产品设计、两仓交接和当前状态。
- [x] 固定源码来源，完成 rc.2 只读合并预检与桌面补丁清单。
- [x] 写出 G1 的文件范围、接口兼容义务和产品验证计划。
- [ ] 用户确认产品 G1 或优先完成 Pod 自动恢复。
- [ ] G1a：合并 rc.2 并验证 Session/System3 与双 SDK。
- [ ] G1b：逐项适配桌面补丁。
- [ ] G1c：固定自有 runtime，开发与目录安装包真实启动。
- [ ] G1d：实网 high 装配、失败和恢复验证。

## Review

本轮仅完成源码预检和具体实施方案；模型服务保持已验收状态，产品实现待用户明确实施方向。既有 feat-system3-desktop 在读取过程中新增了 feat-system3-desktop 文档提交，本轮从该固定点另建 feat-system3-g1，避免干扰并行工作。未修改源码、未进行合并、未声称产品测试通过。

## 当前产品实施与真实部署（2026-10-01，用户已授权）

- [x] 接受完整打通、真实部署和统一 rc.2 的授权；固定双会话写入归属。
- [x] 合并正式 dsh-v0.1.7-rc.2，六个自有包统一版本；提交 system3-g1-foundation。
- [x] Jev 切换 TypeSafe SDK 0.6.0，验证整体超时、取消、协议解析和密钥不泄漏。
- [x] 修复 rc.2 provider 配置，TypeScript 与 Python 的 System3 entry-route/shadow 回放通过。
- [x] 完成入口总截止、合法回退、固定/自动模式和可重放的前端事实投影。
- [x] 完成真实 Skill 选择与原生模型消息注入，补回归和快照。
- [x] Frontend 接入自有 rc.2 runtime，开发与 Mac arm64 目录应用真实启动。
- [x] 完成入口、过程和体感 UI，与实际模型、工具、交付物及原生用户控制联动。
- [x] Linux 原生构建及非 root systemd 预检通过；原生工作区 sandbox 保留。
- [x] 冻结最终源码，重新构建并发布到 litellm 独立 System3 服务。
- [x] 真实浏览器执行公共 CSV 任务，验证 Jev、Fidoo、Skill、文件交付、取消及重启恢复。
- [x] 独立审查并修复；运行相关构建、测试、lint、文档及 Ruff 门禁。
- [x] 记录当前成果、未完成的后续里程碑、部署/回滚证据和冷启动 handoff；完成 ship（两仓 PR 已创建，远端 CI 预算受限，未合并）。
- [x] 按追加的手动部署授权核对运行差异，恢复 SSH 隧道、验证认证页面、打开现有 Desktop 与默认浏览器并更新访问交接。

### 当前 Review

首个固定审查提交和检查证据见 [implementation-ready.md](feat-system3-g1/implementation-ready.md)，双会话归属见 [coordination-ack.md](feat-system3-g1/coordination-ack.md)。预检构建和接口健康不代表最终产品验收；最终发布必须对应完整固定提交。

手动访问核验已交付，见 [deployment-notes.md](feat-system3-g1/deployment-notes.md#manual-access-verification--2026-10-01)。本轮仅更新访问文档和交接，test:docs 20/20、doc-sync 42/42、lint、Ruff check/format 与 diff 检查通过；未重新部署产物、重启服务或调用模型。远端 CI 仍因 Actions 预算未执行，保持未合并。

## System3 统一架构总览（参考 Duse，用户要求融合既有文档）

- [x] 读取参考 HTML 并盘点本项目既有架构设计与体验稿；保留历史来源。
- [x] 按十二节结构整合已发布能力、三层体验、调用关系、数据和目标架构。
- [x] 绘制当前 / 目标与双实例部署图，将未来本机 9B/27B 和专家编排放入正确位置。
- [x] 完成浏览器、响应式和链接复核；四图、两种架构、六场景、七种屏宽均验证。
- [x] 按追加要求将两路图抽象为 AgentLoop × N，同步指定旧方案的工作树副本。
- [x] 修复新 Actions 实际执行后发现的 persona expected 提示词错配；三个相关 keyless SDK 回放通过。
- [x] 完成仓库文档检查；更新 handoff、提交并打开新 HTML。

详细范围与验证计划见 [architecture-plan.md](feat-system3-g1/architecture-plan.md)。

### 统一架构 Review

[统一架构](../docs/feat-system3-g1/architecture.html) 已完成；核心为大小脑融合与 AgentLoop × N。12 份既有 HTML 整合成十二节页面，四图及六场景验证；七种屏宽无整页横向溢出，两个指定旧方案同步新图。test:docs 20/20、doc-sync 42/42、lint、Ruff 与 diff 检查通过。相关 keyless SDK 回放 3/3，通过不代表未来过程节点、N=10 或模型收益验收。

### 研究定位补充与 CI 收口

- [x] REST 确认统一架构版本的 [独立 Harness CI](https://github.com/cryptoSUN2049/xDAN-System3-Harness/actions/runs/36831007221) 成功。
- [x] 第 7 节补充 DNHM 工作定义、Runtime Harness Generalization 与三组可证伪实验。
- [x] 复核新折叠内容、窄屏及打印，运行文档门禁，准备新的固定架构提交。
- [x] DNHM 固定版本的独立 Harness CI 已核对成功并交接；后续文档提交另行核对，不扩展运行验收。

## 产品架构主图表达修订

- [x] 将固定数量对照合为参数化 Agent 执行对象 × N，每实例独立 Session / 生命周期。
- [x] 主图改为业务标签优先的 Jev Native AgentLoop Harness 编排总管及 9 组件产品目标架构。
- [x] 步骤 / 条件 / 重试 / 终态另存原生流程 SVG，置于 details；主图与流程 ID 前缀独立。
- [x] 三页内嵌同步，独立只读验证语义、宽窄屏、颜色、ARIA、ID 与折叠。
- [x] 导出实际 PNG、完成本地文档检查及固定提交；不改运行源码 / 部署 / 论文。

本次 Review：最终产品主图与流程细节 PNG 已独立确认对应 SVG，三个 HTML 引用完整。test:docs 20/20、doc-sync 42/42、lint、Ruff 与 diff 检查通过；浏览器与打印证据更新至 architecture-verification.json，运行基线保持冻结。固定提交用于更新既有 PR；此前 CI 成功不代表新提交远端 CI 通过。

## 下一阶段：CI 收口与首个过程恢复消费者

- [x] 核对 Harness 固定产品图提交的 Independent harness 工作流实际成功。
- [x] 核对 Frontend PR 的未启动原因及完整工作流条件；允许原有 Windows PR 检查实际执行。
- [x] 只读分析原生重试、重复提醒、工具事实与 pre-step 接入；落盘 [过程恢复设计](../docs/feat-system3-g1/process-recovery-plan.html)。
- [ ] 确认新增运行能力的具体设计，再实施恢复消费者与前端事实投影。
- [ ] 完成失效状态 / 取消 / 去重、真实原生组合、两 SDK 与 Session 回放。
- [ ] 用原生大脑、确定性规则、Jev 策略三组对照核验真实任务收益。
- [x] Frontend Windows 实际 CI 通过，固定证据与双仓 PR 交接完成；两 PR 保持 OPEN。
- [ ] 新过程恢复能力经设计确认、独立验收后再发布。

本轮 CI Review：Windows 原生测试 1563 通过 / 4 跳过，固定自有 Harness 构建、27 补丁装配、Electron HTTP 200、开发安装包与隔离应用启动通过。固定提交、工作流步骤、产物 API 摘要及范围见 [review-regression.json](feat-system3-g1/review-regression.json) 的 windowsFrontendCiAcceptance。服务器和已安装 Mac App 未更新；过程恢复设计尚未实施。

## Codex 接管核验（2026-10-08）

- [x] 阅读两份指定 HTML、历史任务、经验与 Claude 续接记录。
- [x] 核对主目录和目标 worktree 的分支、HEAD、未提交文件与 stash；保留原有 WIP。
- [x] 找到 v0.1 五场景历史验收日志；核对凭据文件权限，不复制密钥。
- [x] 独立运行完成核验相关 keyless 测试，审查实现与设计差异。
- [x] 核实远端 release / main；记录本地与发布基线差异。
- [x] 写入本 worktree 冷启动 handoff、P0 顺序与验收缺口。

### 接管 Review

本轮接管与基线审计不等于 v0.2 验收；新增模型监控实现须先完成对照实验与设计确认。既有源码、部署配置和文档 WIP 保持原样。

接管结果：52 项相关 keyless 测试通过，但完成核验缺持久事件登记；prd 根盘本轮实测 100%、可用 0，为最高优先级运行阻断。详见 [接管 handoff](feat-jev-decision-kernel/handoff.md)。

## prd 根盘在线扩容（2026-10-08，用户已授权）

- [x] 检查 vda / vda2 / ext4、工具与 growpart dry-run，确认分区起点保持不变。
- [x] 将分区表备份到 /run，用 TMPDIR=/run 扩展 vda2，再在线扩展 ext4。
- [x] 验证分区表、rw 挂载、System3 服务用户 write/fsync/read、服务状态及鉴权接口。

### 扩容 Review

根文件系统 984G，使用 788G、可用 156G、使用率 84%；容量阻断已解除。分区表无错误，文件写入验证通过，服务 active，无需重启。完整 Session API 未验收；共享磁盘增长来源仍待调查。当前证据见 [handoff](feat-jev-decision-kernel/handoff.md)。

## Claude 历史继承与完成核验 P0（2026-10-08）

- [x] 读取主会话、最近用户指令和压缩摘要，确认 P0 开发已授权；Claude 最后因 organization disabled 停止。
- [x] 保留当前 worktree 与既有 WIP，写出 completion-continuation.html 接续设计。
- [x] 真实 Loader / Goal / JSONL 重读回归，先复现词表缺失，再验证生成物修复。
- [x] 新增 keyless TypeScript 与 Python SDK 完成核验场景。
- [x] 持久化 acknowledgement、config/catalog 与相关验证。
- [x] 修复异步任务卡过期、旧Goal回写、fork额度及配置/卸载/取消，补确定性屏障与真实原生Goal回归。
- [x] 核查真实 Jev 历史评测，完成当前本地 built Web 的完成核验浏览器闭环；生产升级与独立评测仍待收口。

### 完成核验接续 Review

状态隔离、关闭依赖与卸载/取消已修；System3包243项/18文件通过，completion-review.ts、task-frame.ts和decision-kernel.ts均100%覆盖；真实 Loader 持久化回归、稳定和 stale 两条 TS SDK 回放、Python 当前 built CLI 通过。真实 DeepSeek + Jev 的基础与追加要求 E2E 2/2 通过，均重开日志一致。两场景为 in-process production services；另有当前 built Web 本地浏览器闭环：61事件/62条JSONL记录，第一次拒绝、真实读写后完成rev2，刷新保留拒绝且未新增判断。生产升级尚未验收；历史 Jev 留出集未达标，部署 WIP 保持 shadow，模型线路监控仍是设计与历史探针。完整背景与后续顺序见 [handoff](feat-jev-decision-kernel/handoff.md)。

## 完整实现与真实 E2E（2026-10-08，追加要求）

- [ ] 将报告中每个功能点对应到完整实现、真实外部模型 / 工具 / 浏览器场景与固定版本证据；mock 与 keyless 回放仅为补充。
- [x] 修复完成核验三项状态隔离问题，并执行真实 Jev 与原生 Goal 完成闭环 E2E。
- [x] Review 最新 mu 源码，按用户收益、宣传定位、DSH 已有基础和真实验收成本重排候选 P0。
- [x] 交付可 review 的 mu P0 设计与逐功能验收矩阵，标注已发布 / 已实现未验 / 缺失；新增能力实施按已授权范围和具体设计确认推进。

### 追加要求 Review

[mu P0 设计](../docs/feat-jev-decision-kernel/mu-p0-review.html)提前执行前约束、普通任务续跑和语义卡住恢复；[逐项验收矩阵](../docs/feat-jev-decision-kernel/feature-acceptance.html)覆盖报告实际14项招牌、8组原生和3个候选。候选尚待具体设计确认，未当已实现；线路 probe 继续并行。每项完整实现及真实 E2E 仍是总完成条件，本轮两条完成核验真实场景不替代全部功能验收。

### 当前构建浏览器 Review

[浏览器报告](../docs/feat-jev-decision-kernel/completion-browser-result.json)、[原始日志](../docs/feat-jev-decision-kernel/completion-browser-session.jsonl)和[截图](../docs/feat-jev-decision-kernel/completion-browser.png)绑定当前源码与 built Web：真实 DeepSeek + Jev，拒绝 → read/write/read → complete rev2；Jev 2914/1960ms；刷新没有新增事件。此为本地 shipped profile，未部署到 prd，专用核验依据 UI 和独立准确率评测未完成。初始用户额外限制会在 create_goal 重置任务卡时丢失，已加入 mu 设计 v2 的共同前提，不能称约束已受保护。OpenOx 8/8 完整 key 已私密保存；三站真实模型权限仍待验证。

## CEO 一页汇报（2026-10-09）

- [x] 读取 report、handoff 与验收矩阵，提取业务价值、大小脑协作与已验证场景。
- [x] 定义一页结构：价值主张、目标架构、场景成果、验证依据、试点建议；原 report 保留。
- [x] 输出自包含 HTML，以非技术语言表达架构，保留 DSH 原生底座。
- [x] 用浏览器核对桌面与窄屏，实际导出并核对 A4 单页 PDF。
- [x] 完成文档检查、交接与本地提交。

### CEO 汇报 Review

本页为用户明确请求的汇报交付物，不新增运行功能。既有证据、待完善能力与建议试点分别标注；业务收益以试点测量，不从局部时延或通过用例数推算。

交付：[一页 HTML](../docs/feat-jev-decision-kernel/report-ceo-onepage.html)、[A4 单页 PDF](../docs/feat-jev-decision-kernel/report-ceo-onepage.pdf)及[布局核对](../docs/feat-jev-decision-kernel/report-ceo-onepage-verification.json)。实际核对375/768/1440宽度、离线资源、SVG文字与PDF页内文本；独立内容审查后限定可见依据范围，去掉未由精确计时证据支撑的时延大字。

文档检查：test:docs20/20、doc-sync42/42、lint:contracts-ready、相对链接、Ruff check/format及diff检查通过；本轮未重复运行产品模型测试，既有验证范围保持原样。

## Model as Harness 战略表达修订（2026-10-09）

- [x] 采用用户确认战略：大小脑混合模型接管 tools、skills、memory、context、subagent 的事务管理；Slogan为“瞬时执行，深度思考”。
- [x] 重画一页架构，明确模型管理层、五类事务、运行时执行与场景交付；同步完整报告定位。
- [x] 复核实际浏览器、A4单页PDF与事实范围，更新交接和用户纠正经验。
- [x] 完成文档检查及本地提交。

### 战略修订 Review

一页图明确模型管理层、五类Harness事务、DSH执行/权限/事实记录与结果回流；实际PDF为A4一页，375/768/1440宽度无文档越界，Slogan逐字核对。独立审查通过，完整五域管理仍为战略目标，未宣称自动学习已实现；完整report同步战略、标题与电梯稿，原案例和度量保留。doc-quick20/20、doc-sync42/42、lint:contracts-ready与Ruff检查通过，运行源码及部署未变。

## CEO 分页 PPT（2026-10-09）

- [x] 核对现有 worktree/WIP，读取参考 PPT 的六页、16:9、苹方字体与暖白/深绿/橙色版式；保留参考文件原样。
- [x] 制作六页可编辑 PPT：战略 → 大小脑架构 → 五类事务 → 场景交付 → 真实验证 → 试点决策，沿用用户指定 Slogan。
- [x] 用实际演示应用打开并导出分页 PDF，检查六页渲染、文本、架构箭头和版面，独立复核事实范围。
- [x] 更新汇报入口、验证记录和 handoff；运行相关文档检查，本地提交并打开交付文件。

### 分页 PPT Review

交付六页可编辑PPT、Keynote实际导出的分页PDF、六页预览及验证记录。参考原PPT的16:9、苹方、暖白/深绿/橙色版式；大小脑、五类事务与场景成果使用原生形状和文本，六页均含讲稿备注。独立内容复核通过，生产历史基线、当前本地闭环和战略目标分别表达。

真实导入先暴露备注母版未在presentation.xml登记导致Keynote报“文件格式无效”；补齐notesMasterIdLst引用后，最终交付文件直接打开成功，六页PDF全部文本与PPT匹配，形状及PDF文字均无页外越界。该修复保留备注，不要求用户更换软件。

检查：当前分页批次test:docs20/20（38.37s）、Ruff check/format与diff通过；实际Keynote回读六页备注，并核对最终PPT全部页内文本与六页PDF一致。产品源码与部署未改，本轮仅本地提交。

## CEO 汇报思维复核（2026-10-09）

- [x] 阅读用户指定四份战略/成果定位/沟通材料，以及关联模型定位与产品赋能说明。
- [x] 对照六页PPT进行独立只读复核，识别成果身份、公司产品与数据积累、资源取舍及组织承接缺口。
- [x] 提炼可用于重构汇报的能力框架、六页叙事和表达建议，记录为后续工作准则。

Review：本次交付为分析建议；现有PPT仍是上一版。模型历史指标未重跑，产品接入、训练循环和个人职责不得当已完成或已授权。后续修改先核对自有模型品牌与部署版本；不复述私人沟通经过到产品汇报。

## CEO 汇报 PPT v2（2026-10-09）

- [x] 继承上一轮战略复核，核对现有工作区及真实调用模型标识；主讲四页、备查两页。
- [x] 生成独立v2文件：已有成果与公司价值、大小脑架构、产品任务与能力积累、推荐/取舍/责任、验证证据、五类事务进展。
- [x] 独立审查事实与经营表达，实际Keynote导入、备注回读、六页PDF与页内文本/版面验证。
- [x] 更新汇报入口和交接，本地提交，打开新版PPT。

设计约束：继承16:9、苹方与暖白/深绿/橙色；全页文字与架构用原生可编辑对象，保留讲稿和正确notesMaster登记。模型使用“APUS即时决策模型”说明自有成果，备注保留实际APUS-OpenJev版本；不将候选模型品牌当正式发布。产品接入、训练循环、职责分配和资源取舍均标明建议或目标，不新增日期、预算、效果承诺。与上一版使用不同文件名。

## Mac 试用与演示方案（2026-10-09）

- [x] 启动隔离配置的当前 Mac 开发版，真实选路及文件读写冒烟通过，保持用户会话运行。
- [x] 只读核对用户截图：入口1659ms、本轮8757ms，入口不在本轮计时内；确定按入口/执行两层呈现。
- [x] 交付六场景演示脚本及合成数据：提示词、插话时机、观察点、成功判据、证据范围与未彩排标记。
- [x] 交付可视化HTML及两层计时排版提案，验证移动端、场景切换、复制受限时选中文本、下载目标与打印。
- [x] 更新文档入口、配对记录、交接及经验，运行相关检查并本地提交。

设计：交付物集中在docs/feat-jev-decision-kernel；主故事为临时改要求后的真实成果交付，故障注入完成核验单独标明。HTML离线可打开，无外部依赖，提供场景导航与提示词复制；Markdown双语配对。仅写演示文档和静态排版提案，不更改运行源码、计时事件或正在使用的Mac会话。验证文档交互与合成数据，不把文档检查当六个新产品场景的真实E2E。

### 本批 Review

PPT v2为4页主讲+2页备查，实际Keynote打开、六页备注回读和PDF导出通过；246个原生可编辑对象、155项页内文字均与PDF一致，独立CEO审查通过。Mac当前源码开发版已启动，真实Jev选路、主模型文件write/read/bash冒烟通过，未改旧安装包或生产；用户正在手测，后续不接管其会话。

演示页交付六场景、19项覆盖审查、两层计时提案及相对原版的UIUX对照；英文/中文Markdown与合成材料同时交付。新增脚本均标待彩排；材料自身已验算，未将其当产品E2E。原14招牌为脚本直接展示6、部分6、未覆盖2；Skills、Memory和三项新增P0无直接实演。独立复核纠正9月账本“本月”歧义，已统一为2026年9月样本。

文档快速检查20/20通过；最终双语配对和相对链接另检。浏览器验证三宽度无页面横向溢出、六场景/三路线切换、四计时状态和独立展开、打印详情恢复；环境拒绝clipboard写入，实际选中文本的降级通过，不宣称系统剪贴板回读成功。产品UI源代码未改，两层排版和动效建议没有冒充已落地。

## APUS 全品牌统一

- [x] 用户批准两仓设计，创建 feat-apus-brand 隔离工作树。
- [x] Harness 共享 UI、Web/PWA、CLI 与桌面品牌。
- [x] Frontend 菜单、恢复、手机、图标和运行策略。
- [x] 两仓构建、针对性测试、产物联动与真实界面验证。
- [x] Conventional Commits 与工作树 handoff。

- [x] MIT 原版权、许可分发和上游致谢；GitHub 品牌描述、topics、反馈链接。
- [x] 按用户追加授权合并两仓 main，推送并核对 CI；Python SDK CI 依赖与品牌期望补修后复验。

## APUS Continuum 连续记忆（2026-10-10）

- [x] 核对 main 的压缩、持久化、查询、任务卡、Jev 协议和原生注入时序，并进行独立复核。
- [x] 按用户要求创建 feat-continuum-memory 隔离工作树，主目录原有改动不带入。
- [x] 交付 HTML：命名、架构、Reflex 专属无限记忆开关、原版兼容、数据与接口、文件清单、测试矩阵和分期。
- [x] 修正候选事实采用、隐私接口独立性、停用竞态和未索引尾部预算，完成独立设计审阅。
- [x] 验证最终 HTML 的链接、桌面/手机排版与图示，补齐交接。
- [x] Human Gate：用户明确授权在同名 worktree 分支逐步拆分验证、分模块实现（2026-10-10）；不重复请求相同范围的批准。
- [ ] M1：先验证待准入计量、实际路由及日志化注入的组合；完成 Continuum、任务要求投影、历史回读、纠正、预算和恢复。
- [ ] M1：交付 Reflex/Jev adapter 的 shadow 路径和专属开关；关闭或未接入保持原版，显式开启缺依赖拒绝。
- [ ] M2：固定 Baseline 与预算，验证 Reflex active / fallback 的任务质量、完整成本与 P50/P95 延迟。
- [ ] M3：根据规模评测加入摘要树和缓存稳定视图，继续验证关闭功能的原版行为。
- [x] 按用户纠正移除“无 Jev 完整无限记忆”产品模式，加入 UniiChat 13 维横向表与公平实验方案。

### Continuum Review

当前只有设计产物，未修改产品代码、配置或部署。产品开关开启要求 Reflex 管理，关闭或未接入保持原版；底层模块化不意味着提供无 Reflex 的无限记忆产品模式。原文、有效约束、权限、预算和持久记录不交给模型决定；Reflex 管理有限候选和允许动作。新输入和记忆采用必须可回放。UniiChat 的 cache/tree 更具体，本项目完整记忆控制尚待实现，不能宣称已领先。未安装依赖，产品测试与真实对照留待对应阶段。

最终 HTML 检查：22 个链接、13 个 ID、SVG XML 和尾换行有效，无外部资源；真实 1440px/390px 页面无横向溢出，13 维 5 列比较表完整，手机表内可横向滚动与聚焦，无 console 错误。独立审阅通过，git diff --check 通过。初版架构图与折叠交互已验；未运行需要 node_modules 的全仓文档门禁或产品对照测试。

### 分模块实施计划（本轮起替代粗粒度任务跟踪）

所有批次在 `feat-continuum-memory` 工作树与同名分支推进；模块 D/I/R/J/C/O 与依赖关系定义在 HTML 的 `#decomposition`，每批按行为提交，不为模块机械拆包。完整产品和真实效果仍未验收。

- [x] P0.1：确认现有工作树，保留 main WIP，分支改为与 worktree 同名。
- [x] P0.2：设计补齐六模块、P0–P5、摘要树/cache 独立取舍和三层真实验收门禁。
- [x] P0.3：实现原生 Loop/Session/TokenMeter 接入可行性测试；验证当步召回、pending 计量缺口、最终路由、末端拒绝、日志重建、off、卸载与取消。
- [ ] P0.4：冻结真实模型评测 manifest、代表性任务、期望产物和 A0/A1 原版基线；实跑并保存来源证据。
- [x] P1.1：实现独立 Continuum 记录语义库；不可变来源记录、revision 冲突、原子 supersede、deactivate 及错误码测试通过。
- [x] P1.2：复用 Session.append 与 ctx.sessions.flush 接入真实持久事件；完成 persistence acknowledgement 和重启恢复；flush failure semantics 仍需独立故障注入批次。
- [x] P1.2 设计门：明确复用既有 Session event log、JSONL flush/restart 和事件折叠；设计稿见 `docs/feat-continuum-memory/p1-2-persistence-design.html`。
- [ ] P1.2：原文精确回读与同一步采用；最小 profile 贯通，重启从原日志恢复；未出现完整检索前不增加抽象 provider。
- [x] P1.2 精确来源回读与有界工作集：按 `sessionId + eventSeq` 回读真实事件，active-only 词法检索、候选上限和 UTF-8 字节预算通过 21 项相关测试。
- [ ] P1.3：Reflex 公共 Jev 接口 adapter，显式依赖校验、shadow、取消；真实双模型与文件产物验收。
- [x] P1.3 基础 adapter：新增实验性 `continuum-jev`，覆盖 off/shadow/active、baseline、候选 ID 封闭集、置信度回退与取消；真实 gateway E2E 未通过前不得标记完成。
- [x] P1.2 同一步消费者：`installContinuumMemoryContext` 在 `agent/pre-step` 追加带 `continuum-memory` source 的有界 recall；无 per-agent store 时保持原版消息。
- [x] P1.3 决策回执：`continuum/memory-decision` 写入 Session 并支持最新回放；真实 Jev gateway 仍未通过。
- [x] P1.4 生命周期安全切片：Reflex 专属 switch/controller、精确 scope 授权、停用/关闭 generation invalidation，以及 controller 到同一步消费者的集成测试。
- [x] P1.5 摘要树/cache 评测切片：固定 3 条样本完成 2×2 本地消融，结果写入 `docs/feat-continuum-memory/continuum-ablation.json`；缓存数字明确标为布局复用估计。
- [ ] P2：任务工作集、supersedes、FTS、权限与尾部覆盖；新 Session 续做、旧版本拒绝、索引重建与积压。
- [ ] P3：Reflex active 多候选/动作、弃权、超时与有限兜底；固定候选和端到端两种对照。
- [ ] P4：专属开关 UI、停用/关闭后的活动投影移除、在途失效、最终模型预算、两个 SDK 和离线回放；原版回归。
- [ ] P5：摘要树/zoom、持久视图与批合并；真实长历史、树 × cache 消融、完整成本与延迟；无收益须记录，不静默宣称完成。
- [ ] Release：确定性正确性、真实产品链路、预注册效果门槛三者全过；必测 skip 或凭据缺失不算通过。

### 本批验证记录

已在本 worktree 安装锁定依赖。真实模型凭据前置检查：当前进程无 JEV_API_KEY/DEEPSEEK_API_KEY，worktree 与主目录均无 .env；已请求现有测试配置路径，不请求密钥明文。接入测试的 adapter 为受控替身，Session 为内存日志，不证明磁盘持久化、真实模型效果或完整产品。

本轮严格定向验收：Continuum 4 个测试文件 21/21、continuum-jev 1 个测试文件 6/6；两包 TypeScript build、Oxlint、`verify-persistence-changes`（80 roots、28 history records）通过。首次 `test:docs` 因生成的历史 persistence format facts 过期失败，运行 `pnpm run verify-persistence-formats --write` 刷新 3 个引用文件后最终 `test:docs` 20/20 通过。真实 Jev/DeepSeek 端点仍因 TLS 超时未计为通过。

P1.4/P1.5 追加验收：Continuum 6 个测试文件 26/26、TypeScript build 和 Oxlint 通过；active 模式未挂载 Reflex 会显式拒绝，关闭/停用会使在途读取失效，未授权 scope 不进入工作集。固定消融显示摘要树使样本命中率从 2/3 到 3/3；稳定布局的估算复用分别为 79/118 与 165/204，未当作服务端 cache hit。

实时重试验收：RunPod Jev endpoint 当前可达，`continuum-live-e2e.ts` 使用部署配置中的 JEV key 实跑成功，结果保存在 `docs/feat-continuum-memory/continuum-live-e2e.json`（APUS-OpenJev-v1-9B-5949，confidence 0.9487993897）。官方 DeepSeek endpoint 当前可达但对用户提供的 key 返回 HTTP 401；llm-deepseek adapter/runtime 真实测试 16 项因此全部失败于 AUTH，未计为主模型通过。TypeScript SDK fake-runtime 回放 `continuum/memory-decision` 1/1 通过；真实生成模型仍待有效 key。

### P1.1 Review

新增 `packages/context/continuum`，先完成纯记录语义，再通过 `continuum/memory-record` 接入现有 Session log。`MemoryRecordStore` 的旧记录、新记录、来源引用、revision、superseded/deactivated 状态均为 immutable snapshot；冲突和重复 ID 不产生部分提交。P1.1/P1.2 相关测试 16/16 通过；包级 Oxlint、TypeScript 构建、native flock、README Model Experience、persistence acknowledgement、双语配对与文档门禁通过。下一批仍不得新增第二事实源。

### P1.2 Review

`appendMemoryRecordEvent` 写入完整变更后记录，`foldMemoryRecordEvents` 在恢复时按顺序重建记录。测试使用真实 JSONL backend 和 native flock：写入 create/supersede/deactivate，显式 flush，销毁 writer，重新挂载 reader，读取并比较完整快照。未知事件在 catalog 更新前被 reader fail-closed；运行生成器和 persistence acknowledgement 后 catalog、schema、双语记录均已更新。尚未完成产品 profile、Reflex adapter、检索、同一步采用或 flush 故障注入。

### P1.3 Review

新增实验性 `packages/experimental/continuum-jev`。`selectContinuumMemory` 只接收有限候选，OFF 返回确定性 baseline，SHADOW 保留 baseline 并暴露 Jev 建议，ACTIVE 只接受候选集内且达到阈值的选择；provider unknown、非法 ID、低置信度和取消均有明确行为。fake provider 测试 5/5、包级构建和 Oxlint、README Model Experience 门禁通过。真实 Jev gateway 当前 TLS 握手超时，SSH 主机变量也未配置，因此真实 E2E 未通过。
严格 live harness 已加入 `scripts/continuum-live-e2e.ts`；缺少 `CONTINUUM_JEV_ENDPOINT`、`CONTINUUM_JEV_API_KEY` 或 `CONTINUUM_JEV_MODEL` 时硬失败，不会 skip。当前缺失配置的失败已实跑记录。
