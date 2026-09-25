# System3 本地9B与多智能体协作专项方案

English | [中文](system3-special-plan.zh.md)

完整内容以 [专项HTML](system3-special-plan.html) 为准。设计状态：待实施；本轮仅文档。

## 核心优先级

1. 本地9B能力接入与数据策略。
2. DSH委派单个专家并回到本地验收。
3. Jev影子路由、证据筛选与进展监督，验收后主动接管。
4. Claude Code/Codex双专家协作、任务图与工作区隔离。
5. 最终部署身份下的高性能双模式9B。
6. 有界模型–Harness联合RL与晋级。

## 本轮补充结论

- System1/System2是工作方式，不等同本地/云端；9B生成也可承担轻量推理。
- 隐私与能力为独立维度，本地失败不能自动把原始数据交给云端。
- 专家worker使用最小工作包；worktree隔离代码修改，但不是隐私沙箱。
- 现有产品provider为one-shot，不能直接视为可续聊Agent Teams成员。
- 同权重双模式是长期优化目标，MVP允许双adapter/服务。

## 章节

- [产品定义：一个本地优先的智能体系统](system3-special-plan.html#vision)
- [整体架构：本地拥有任务，专家承接工作包](system3-special-plan.html#architecture)
- [核心目标优先级：先打通分工，再优化智能](system3-special-plan.html#priority)
- [任务分流：隐私与能力是两个独立维度](system3-special-plan.html#routing)
- [隐私设计：从“本地模型”扩展到“本地数据边界”](system3-special-plan.html#privacy)
- [多智能体编排：一个调度者，多个有范围的执行者](system3-special-plan.html#orchestration)
- [DSH 源码匹配：能直接复用什么，还缺什么](system3-special-plan.html#source)
- [Jev 在系统中的八个智能位置](system3-special-plan.html#jev)
- [Jev 八个融合点：从一次判断到可审计控制回路](system3-special-plan.html#jev-contract)
- [本地9B路线：双模式契约，逐步统一权重](system3-special-plan.html#model)
- [模型–Harness 联合训练：先分角色，再学长期策略](system3-special-plan.html#training)
- [工程拆分与数据契约](system3-special-plan.html#contracts)
- [里程碑与验收：以完成条件排序](system3-special-plan.html#roadmap)
- [产品体验与首发定位](system3-special-plan.html#product)
- [证据、假设与方案边界](system3-special-plan.html#evidence)
