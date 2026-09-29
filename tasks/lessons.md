# 项目经验

## 2026-09-24：先保留产品目标，再收敛实施切片

用户明确System3的核心是本地9B自主处理普通/隐私任务、Jev快速决策，以及DSH编排Claude Code/Codex。不能把整个目标缩减为日志压缩或Token优化插件；这些只是支持能力。排序要先覆盖本地执行、专业委派、验收与数据边界，再优化效率和训练。用户继续完善方案不等于批准产品代码实施。

## 2026-09-26：先核实用户指定网关，再复用凭据

用户明确要走 `proxy.fidoo.ai` 时，不能根据旧 AGENTS.md 中的 LiteLLM IP 默认选择另一台服务器。先核实域名、模型白名单和既有虚拟 key；在正确网关已有 `system3-dsh` 时复用它，不创建重复 key。模型别名必须与 `/v1/models` 和实际响应一致，不能把 `deepseek-v4-flash` 擅自命名为未注册的 `deepseek-v4.1-flash`。

## 2026-09-29：新项目以 Jev 决策能力为核心

用户要求另建独立仓库，目标是把 Jev 理念与模型能力嵌入 DeepSeek Harness，不是继续扩展 Duse 配套 App。保留旧仓库；新仓库清除产品运行依赖，并明确区分 provider 连通、显式 shadow、语义决策与自动执行控制。

## 2026-09-29：独立产品不再围绕旧 App 组织目标

用户再次明确 xDAN-System3-Harness 不需要考虑 Duse。新产品文档、优先级和验收以 Jev 的任务决策、DSH 执行、独立证据及成本质量对照为中心；来源项目仅作为历史信息，不再作为产品兼容性或设计约束。

## 2026-09-29：System3 是双模型协作，不能缩减为结束检查

用户明确 System3 = System1（Jev-like 决策模型）+ System2（高性能大模型）。架构设计先识别 DSH 全流程中规则覆盖不了、完整生成又太贵的中间决策，再选择首个实施切片；完成前检查只是候选节点。评估 agent-jev-pilot 时区分可复用决策协议与 Codex/Claude Code 专属 hook 适配，不能仅凭现有 provider 推断已经实现内置自动编排。

## 2026-09-29：原生混合架构优先于外部插件迁移

用户明确不能直接引入 agent-jev-pilot 的能力和代码。Pilot 仅用作经验与实验对照；System3 必须从 DSH 的原生 Session、AgentLoop、provider、工具与上下文语义设计。Cordis 插件只是 DSH 内部组织机制，不代表外围外挂；不预先将外部插件的七类功能映射成产品模块。

## 产品定位：Jev Native + DSH Native

System3 以 Jev Native + DSH Native 为核心：保留 Jev 的原生有界决策接口和 DSH 的原生生命周期、状态与执行机制，使规则、System1 和 System2 在同一宿主中协作；禁止将原生集成偷换为旁路调用或外部插件迁入。
