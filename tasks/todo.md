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
