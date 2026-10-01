# System3 架构融合清单

[English](architecture-sources.md) | 中文

本清单说明 [统一架构 HTML](architecture.html) 的范围、来源及旧稿覆盖关系。核查日期为 2026-10-01；当前事实优先取已发布实现及冻结证据，旧设计保留历史。本文不是新增 API 或部署验收。

## 范围和计数

本次融合 12 份既有直接相关 HTML，按逻辑资料计数，不重复统计其他 worktree 副本、译本、PNG 导出。分组为 7 份核心架构或综合方案、2 份体验演示、2 份入口实施或验收、1 份前端选型。

| HTML 来源 | 融合内容 | 本页更新原则 |
| --- | --- | --- |
| [独立项目设计](../feat-independent-harness/design.html) | 决策和原生执行所有权 | 当前运行范围按最终实现更新 |
| [Jev Native + DSH Native](../feat-independent-harness/jev-native-dsh-native-plan.html) | 入口第一、过程第二，完整目标 | 目标不等于所有节点已接通 |
| [入口实施](../feat-independent-harness/entry-routing-implementation.html) | 原生 router 与事件关联 | 实际接口以当前定义为准 |
| [入口历史验收](../feat-independent-harness/entry-routing-verification.html) | 首期链路和限制 | 当前发布用最终证据 |
| [Web UI 选型](../feat-independent-harness/web-ui-selection.html) | 唯一 Conversation 与工作台 | 保留选型依据，不替换产品技术栈 |
| [四线基础设计](../feat-system3-foundation/index.html) | 产品、工程、评测和训练分工 | 本次架构不承诺训练与收益完成 |
| [本地模型专项](../feat-system3-foundation/system3-special-plan.html) | 本机 Lead、本地材料、专家接力 | 9B/27B 通用 Lead 与当前远程 Jev 分开 |
| [原生架构主稿](../feat-system3-desktop/system3-native-v1.html) | 架构、调用关系、完整目标 | 覆盖 rc.2、SDK、Skill 等过期状态 |
| [体验 v2](../feat-system3-desktop/system3-experience-v2.html) | 单节点体感和展开层 | 保留离线设计身份 |
| [体验 v3](../feat-system3-desktop/system3-experience-v3.html) | 连续任务、资料、成果与专家视图 | 演示数据不作发布证据 |
| [三层穿透设计](../feat-system3-desktop/system3-intelligence-design.html) | UI、Host、模型、工具、控制和验收 | 草案字段与公开 API 分开 |
| [目标与 UX 审计](../feat-system3-desktop/delivery-objectives-and-ux-audit.html) | 完成定义与体感测量 | 覆盖前端未接入等旧状态 |

另有 9 个直接相关 Markdown 资料族：[原生架构](../architecture.zh.md)、[独立接入](../feat-independent-harness/README.zh.md)、Foundation 的 [基础设计](../feat-system3-foundation/design.zh.md)、[9B 接入](../feat-system3-foundation/jev-9b-integration-design.zh.md)、[模型链](../feat-system3-foundation/model-chain.zh.md)、[专项方案](../feat-system3-foundation/system3-special-plan.zh.md)、[体验评审](../feat-system3-desktop/system3-experience-review.zh.md)、当前 [实施](implementation.zh.md) 与 [部署](deployment.zh.md)。译本作为同一资料处理。

3 份旧 SVG 为 [初期架构](../feat-independent-harness/architecture.svg)、[流程图](../feat-system3-desktop/diagram/jev-harness-flow.svg)、[调用图](../feat-system3-desktop/diagram/jev-harness-invocation.svg)。新页首先提供 [AgentLoop × N 融合机制](diagram/system3-fusion.svg)，再提供 [当前架构](diagram/system3-current.svg)、[目标架构](diagram/system3-target.svg) 和 [双实例部署](diagram/system3-deployment.svg)，且将图内嵌以便离线阅读。

## 当前事实基线

运行实现为 `system3-g1-reviewed-rc2`，冻结验收为 `system3-g1-acceptance-rc2`。[Desktop 验收](desktop-acceptance.json) 与 [服务器验收](deployment-final.json) 拥有精确源码、前端 pin、任务、注入 ID、产物及恢复事实。本次只读取源码和既有证据，不调用模型或重新部署。

Frontend 的实际入口是自己的 Electron 壳与自有 Harness：首选回环端口 43129，占用时可选临时端口；服务器是另一个独立 Harness，回环端口 18731 经 SSH tunnel 访问。两者各自拥有 Session、工作区、凭据和执行状态，未验收自动同步。相关实现见私有 Frontend 的 [runtime](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/blob/feat-system3-integration/src/main/runtime/harness-runtime.ts) 和 [打包指南](https://github.com/cryptoSUN2049/xDAN-System3-Frontend/blob/feat-system3-integration/docs/feat-system3-integration/desktop-packaging.md)。

## 覆盖旧状态，保留目标原则

- rc.2、TypeSafe SDK 0.6.0、恢复自动、Client-safe 投影和真实 Skill 注入已经发布；旧稿的待实施状态不作为当前结论。
- 当前接口是 SessionController 和 `system3Runtime`；TaskView、来源排除、完整预算及复合停止仍属设计，不能拷贝草案为已发布 API。
- 固定模型只跳过入口 Jev，自动 Skill 可独立判断；原生 adopted 也可以是合法 baseline。服务器低置信回退不是 Jev 成功选路正例。
- 当前 Jev 9B 在 A100 网络服务运行，协议为 `/v1/systemone`。本机 9B/27B Lead 是未来通用生成和编排角色，普通 vLLM 生成接口不替代决策协议。
- 原生 Schedule 已有持久任务及 cold Session 恢复投递；Host 必须运行，投递只针对原 Session，不保证 exactly-once，外部通知尚未贯通。Schedule storage-domain 表和 Session 日志各有所属数据。
- `subagent/start/end` 为 live Cordis 事件，不能直接当作同名持久 Session 事件。专家内部工具由自己的 runtime 管，父 Harness 管交接与控制。
- 当前 evidence/supervisor 不构成生产全过程消费者；自动完成前必须修复空检查和证据引用缺口，并接到唯一 Goal owner 的所有完成入口。
- safe 启动成功不代表完整 System3 任务恢复通过；同源码双发布回滚不证明旧源码降级兼容。单次时延观察不写成 SLA、p50/p95 或总体收益。
- 发布切片名称 G1 与原始 G1—G6 里程碑不同。现有功能涵盖底座、限定入口和首个过程节点；后续对照、记忆、专家、Goal 与整体验收仍未全部完成。

## 页面组织和验证范围

结构沿用户指定的 Duse 架构页：十二节目录、产品结论、系统图、穿透场景、接口、数据、模型、安全、部署、进展、后续与资料。参考页属于另一项目；其 App BFF、邮件、日历和业务数据库不迁入 System3。旧正文保留为历史设计；用户追加要求重画的 Native v1 与 Jev Native + DSH Native 已在本工作树替换首张总图，指向同一个 AgentLoop × N 示意和统一当前资料。原主目录与其他工作树不修改。

HTML 的主题、架构切换、六场景、锚点和打印均为离线页面交互，不发送模型、工具或业务请求。浏览器与文档验证见 [architecture-verification.json](architecture-verification.json)；页面设计通过不增加当前产品的功能验收范围。

## 最新设计定位

核心是 Jev 即时决策模型与推理思考模型在同一 Harness 内协作：判断实际改变下一步方法，推理与工具结果回到后续上下文及判断，原生服务拥有采用和执行。AgentLoop × N 表达单 Agent 和多 Agent 共用执行单元；N=10 为一个主实例加九个子实例的目标示意，各自拥有 Session，不是当前并发成绩。

MAAH 作为本项目拟研究方向，不声明术语首创或已证新颖性，并区分设计时优化、运行时候选控制和执行后轨迹学习。本页整合独立运维论证的角色及评测原则，不复制其对外故事或把研究先例当作本产品收益。

DNHM（Decision-Native Harness Models）是工作定义：可观测执行状态与带类型及语言描述的合法动作，经过直接候选打分、选择或弃权、原生核验与采用，再获得执行反馈。Runtime Harness Generalization 是拟研究的问题：冻结 controller，跨封存的未见任务族、控制节点和执行模型迁移。三组实验分别检验泛化、直接打分净收益及状态变化下的有效采用；固定候选构造、执行条件和防泄漏协议，端到端评测保留失败，计入准备、网络、验证及恢复成本。完整方法与代码比对、正式训练和 benchmark 尚未完成；已发布的入口与 Skill 消费者不证明上述研究主张。
