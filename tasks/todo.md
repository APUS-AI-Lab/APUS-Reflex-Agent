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

- [ ] M1a：入口共享决策服务、空闲文本请求适配及原生选模，校验语义输入、预算、请求绑定和策略有效期。
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
