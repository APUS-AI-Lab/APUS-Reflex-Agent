# 独立 Jev + DeepSeek Harness 工作计划

## 当前激活执行目标（2026-10-11）

目标：完成 APUS Reflex Harness 的最终可发布闭环，以真实用户 E2E 证明入口路由、Reflex 模型配置、Codex 长时 Goal 监督与纠偏、动态上下文恢复和 UIUX；保护 cache 区与原始 Session，完成 MIT/NOTICE/安全/贡献者开源门禁、双仓 CI 和 PR/main 合并。

- [ ] P0：完成真实语义监督闭环：偏航 → Reflex realign → Codex 消费 → verification-target → improved → 独立产物验证。
- [ ] P0：冻结并实测 1 秒 admission/status、路由 p50/p95、远端首字节/总耗时三段指标。
- [ ] P0：完成 Electron 原生 200%、启动失败恢复、会话恢复、签名/公证和包内 MIT/NOTICE 核对。
- [ ] P0：完成 Harness Jev/System3 CI、秘密扫描、脱敏回归，并将两个 Draft PR 转 Ready。
- [ ] P1：统一 README quickstart、贡献者 API 文档、CODEOWNERS、Release notes、演示和 benchmark。
- [ ] P1：独立 review 通过后合并两个仓库 main，回读 SHA、运行包和发布清单。

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

## Reflex 完整能力实现（用户已批准设计）

- [x] 统一设计与测试验收目标清单：用户需求 → 场景 → 通过/失败标准 → 证据 → 当前状态。
- [x] 用户“开始”批准；隔离工作树 feat-reflex-control，main保持不动。
- [x] 专用配置页面与Host凭据/真实连接测试。
- [ ] Codex监督证据、Reflex判定、自动steer和反馈。
- [x] 按行上下文投影、检索与重启恢复（Harness 会话范围；不改 Codex 私有上下文）。
- [ ] 前后端装配与单元/回归/快照/真实E2E。
- [ ] Review、交接、提交与授权范围内合并。

### 真实验收收尾与新增缓存约束

- [x] Reflex配置页保存low、刷新及Host重启后保留low；真实task.frame/context请求effort=low。
- [x] taskFrame/context组合真实Loader的TypeScript、Python SDK录制与重放。
- [x] Goal首轮路由在主模型编辑前真实委派Codex，独立端到端验收。
- [ ] 区分重复失败纠偏与模型请求挂起恢复；确认中断终态和恢复有效性。
- [x] 强制冻结已提交请求前缀，只整理未提交尾部；恢复追加并去重，逐相邻请求验收（TS/Python SDK）。
- [ ] 提供方缓存命中与成本基准单独记录；不能用token估算代替实测。
- [x] 浏览器实际移除、完整 Host 重启、Reflex 自动追加恢复与正确回答；旧 44 条事件保持，记录逐请求用量但不冒称配对成本基准。

### 最新真实验收 Review（2026-10-10）

真实 native recovery v4 通过：127.41 秒，真实 Reflex 判断一次、Codex 确认中断并在原线程续跑、正常 completed、独立结果验证和输入/验证脚本哈希保持。该场景为受控挂起首次上游请求，不替代仍失败的 steer-only 重复失败场景。

浏览器 Goal 账龄 JSON 增量任务正常完成，10 项测试及独立 Decimal 金额核对通过，原 CSV 哈希保持；Codex 终态先于父模型编辑。首轮真实上下文场景答案 1137.41 正确，但误删必要订单 A，严格相关性验收失败。v2 浏览器必要金额全部保留、旧旅行移出通过；完整 Host 重启后能经 4 次记忆检索找回旅行信息，但 Reflex 自动恢复因旧任务范围干扰失败。v3 已明确有序当前请求与旧约束区别，39 项回归、严格覆盖率与固定 5 次真实模型对照通过；Host16 浏览器 v3 完整流程已通过：财务仅 6 次读取，金额保留；完整重启后 Reflex 在主模型请求前自动追加旅行原文，无工具调用、正确回答；旧 44 条事件及输入哈希保持。v3 首次多余检索失败保留，工具说明改进后有限复验通过。

结构化操作/工作区路径语义监督已实现，workspace 未批准时保留指纹监督；96 项消费者回归四模块四项覆盖率均 100%，79 项采集回归通过。真实语义对照保留初始低置信失败及最终成功响应；完整 Codex 语义回正 E2E 仍待验证。人工输入入队及已领取未准入期间会阻止旧监督干预。TypeScript 与 Python 的 Goal、native recovery、普通监督最终录制及独立重放均通过；普通及新增语义监督双 SDK 在 Host14 录制和独立重放通过；context v3 与新增 verification-target 的 TypeScript/Python 场景在 Host16 最终录制及独立重放均通过。

最终 doc-sync 首轮33/42通过；9项失败涉及新API类型文档/分类、生成catalog陈旧、README bundle分类与排版，均已修正并分别取得有效通过证据。随后只读文档编译88 blocks、双语配对1192对、网站构建及5862个片段引用检查通过。品牌/MIT已在main，本批代码仍未提交或合并，不宣称完整交付。

监督 Host16 真实语义场景未通过：原生任务正常结束、独立金额及哈希检查成功，但测试的 20 秒 native recovery 在首个工具前抢先中断故障注入，没有实际偏航/realign/improved。部署阈值为 180 秒；Host17 已补固定类别解析诊断，独立 literal unittest 试验在150秒内无命令返回，下一步先增加无内容修改的传输时序观测。不能用上述结果声称完整语义闭环通过。Full lint 修正后通过，Ruff check/format 105 文件通过。

### 统一验收清单 Review

新增[测试验收目标清单](../docs/feat-reflex-control/acceptance-checklist.zh.md)，以27项目标和8条完整用户流程关联设计、通过/失败条件、证据及缺口；英文版本与配对记录同步。独立复核纠正入口测试链接，并明确手动选型优先级未验收、配置effort通过不代表服务地址/模型修改全链路已通过。本次不新增产品通过结论，不重试真实模型任务。

检查：`test:docs` 首轮18/20通过；中英文目录锚点已统一并通过两组相关配对复验，会话格式索引由生成器刷新当前v4类型数量并通过复验。历史v0–v3 schema未修改；新增文档的全部本地链接、六个稳定目录锚点及diff检查通过，不为提交重复通过项。

### 完整测试与 UI/UX 验收（用户已授权）

- [x] 补齐用户视角 UI/UX 标准：首次使用、配置反馈、进度与纠偏、取消及追加要求、上下文恢复、明暗/窄屏/键盘、桌面启动与重启。
- [ ] 通过无内容修改的传输观测定位 Codex 等待位置，修复实际原因，完成语义偏航的真实闭环与部署默认配置验收；重复失败真实闭环已单独通过。
- [ ] 核对入口手动选型优先级、失败处理，以及配置服务地址/模型/effort 的实际生效链路。
- [ ] 完成有限配对的路由及上下文缓存基准，保留失败、实际用量与性能限制。
- [x] 修复真实 UI/UX 问题并复测；独立审查与最终 Electron 正常、重启、Safe Mode 及配置恢复验收已完成。
- [ ] 完成 200% 原生缩放验收、Frontend 提交与推送，并按既有授权完成两仓提交和合并。

### 2026-10-11 进度校正

- [x] Harness 与 Frontend `feat-reflex-control` 修订已提交并推送；Frontend 已固定 Harness runtime，unsigned macOS arm64 目录包的 Electron 正常启动、Reflex 设置保存/重启、Safe Mode 与恢复已实测通过。
- [x] 重复失败受控场景补齐脱敏 native `item/started` / `item/completed` 事件；S-01/S-05 在该 `semantic=false` 场景可审计通过，S-06 仍因缺少纠偏流程的结构化 `verification-target` 保持未完成。
- [x] 语义监督真实试验已形成独立审计：[英文](../docs/feat-reflex-control/evidence/supervision-audit-20261011.md)、[中文](../docs/feat-reflex-control/evidence/supervision-audit-20261011.zh.md)、[JSON](../docs/feat-reflex-control/evidence/supervision-audit-20261011.json)。两次试验观察到 accepted realign 与 native 输入接收，但没有 target 或 `improved`，且不能证明纠偏消息导致后续财务工作；临时解析器/测试配置改动已撤回。
- [ ] 真实发布默认配置的语义偏航闭环、健康长任务误干预对照、中途追加要求、原生 200% 缩放、签名/公证包、两仓 PR/main 合并仍未完成；不能据此宣布三项核心能力全部验收。

#### Review

本轮只收拢真实证据和交接状态，没有把失败试验改写成成功，也没有扩大严格 verification-target 解析器。文档会在提交前运行双语配对、`test:docs`、`git diff --check`，push 前运行 Ruff 双检查。

## feat-reflex-control 收尾 Review（2026-10-10）

- [x] C-06 真实跨进程配对：四条件、12 轮、三个独立 CLI 进程；答案、按行 `remove`、恢复、输入/持久化前缀、请求前缀、路由和工具稳定性通过；脱敏报告写入 `docs/feat-reflex-control/evidence/cache-c06-real.json`。
- [x] F-01 Web Reflex 模型配置：真实连接判断、无效模型预期失败、low 保存、跨 server 进程重启恢复、实际请求采用 low、恢复 high 并清除用户覆盖项；脱敏报告写入 `docs/feat-reflex-control/evidence/reflex-settings-real.json`。
- [x] 监控 UI/UX：加入明确 observing 状态、最近 12 条无内容执行时间线，新人工消息清除陈旧判断；projection/client focused tests、typecheck 通过。
- [x] C-06 设计文档、验收清单、中英文配对记录和 handoff 已同步。
- [x] 重复失败真实闭环：gpt-6 relay 在 300 秒预算内完成三次失败观察、Reflex 诊断、监督消息消费、修复、相关验证和 `improved`；受保护文件哈希保持不变，脱敏证据写入 `docs/feat-reflex-control/evidence/supervision-real-repeated-failure.json`。
- [ ] Codex 真实语义偏航后的 realign→消费→相关 verification-target→improved 闭环仍未通过；不得以回归或受控 native recovery 代替。
- [x] Frontend 已固定 Harness SHA、完成最终构建与 Electron 正常/Safe Mode 用户验收；200% 原生缩放尚未执行。
- [ ] 最终门禁复核、Frontend commit/push、两仓 PR/main 合并并回读远端；Harness 已完成其 commit/push 与 Ruff 双检查。

## 2026-10-11 Snapshot 回归复核

- [x] 97 个变更相关测试文件、1876 项确定性回归全部通过。
- [x] TypeScript/Python `system3-entry-route` 与 `system3-shadow` snapshot replay 全部通过。
- [x] 完整 keyless snapshot 串行回放 185/187 通过，2 项按现有策略跳过；完整 headless 文件 132/134 通过，2 项跳过。
- [x] Node 22 browser-use native fixture loader 修复后，browser snapshot 与 loader 回归通过。
- [ ] 并发 snapshot lane 的单次 `subagent-list-agents` 超时仍保留为资源争用观察，不作为功能通过或发布门禁通过。

#### Review

本轮只修复测试 fixture 的 Node 22 loader 兼容性并同步有意变更的 snapshot 期望，没有修改真实模型验收标准；真实 Codex 语义偏航闭环、签名/公证包和最终合并仍未完成。
