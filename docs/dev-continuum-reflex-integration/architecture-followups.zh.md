# 给新人的架构跟进任务清单

[English](architecture-followups.md) | 中文

这份任务参考区分已有代码、测试用例与剩余验收工作。链接到测试只是提供入口，不代表该测试已在发布版本通过。关闭任务前记录被测版本、命令、结果和证据位置。下述审查风险在复现前均不视为已确认故障。

## P0：发布与用户信任

| 任务 | 现有证据或入口 | 剩余增量与验收标准 | 新人适配度 |
| --- | --- | --- | --- |
| 重启证据隔离 | [Headless 进程测试](../../apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts)已隔离进程日志并核对持久化来源引用。 | 在发布 revision 上记录源码／构建、关闭／无 Jev 和新 Session 五个场景的结果。恢复查询不得重复原始 canary；只能用恢复进程请求满足召回断言。 | Fixture 维护者验收；扩展现有测试。 |
| CI 与公开发布 | [发布就绪报告](release-readiness.zh.md) | 核对两个仓库当前必需 workflow，解决仍存在的容量阻塞，重跑并记录运行 URL。审计受跟踪的数据、Markdown、HTML 和历史中的秘密及私有运维信息。跳过或未启动的检查仍属未验证。 | 发布负责人；新人可盘点文档。 |
| 监督与桌面发布 | [监督测试](../../packages/experimental/system3/tests/reflex-supervision.spec.ts)、[发布说明](../feat-reflex-control/release-notes.zh.md) | 通过 Web/Electron 运行健康长任务和中途修改 Goal，拒绝过期监督结果。在支持的 runner 上验证启动恢复、Session 重开和签名、公证后的安装包。 | 资深工程师与发布负责人。 |
| 用户可见延迟 | [入口路由测试](../../packages/experimental/system3/tests/entry-routing.spec.ts) | 使用可复现 fixture 和真实 endpoint 测量 admission、远端首字节、总耗时及可见回退。分别报告负载、p50/p95 与失败请求。 | 结对完成；负责人提供 provider 访问条件。 |

## P1：架构加固

优先选择前两项：代码归属集中，验收不需要密钥。修改运行时前须由维护者确认检索语义和预算定义。

| 任务 | 现有证据或入口 | 剩余增量与验收标准 | 新人适配度 |
| --- | --- | --- | --- |
| 检索一致性 | [索引](../../packages/context/continuum/src/memory-index.ts)、[检索](../../packages/context/continuum/src/retrieval.ts)、[索引测试](../../packages/context/continuum/tests/memory-index.spec.ts) | 复现完整 token 索引查询与子串评分可能存在的不一致。比较索引开关下英文部分词、中文文本、Unicode 和退役记录的候选结果。确认预期匹配语义，再使对照测试通过。 | 推荐首项，需代码评审。 |
| 召回字节预算 | [检索测试](../../packages/context/continuum/tests/retrieval.spec.ts)、[上下文渲染](../../packages/context/continuum/src/context.ts) | 当前计数约束 excerpt 字节，标签、分隔符和标题另占字节。明确限制覆盖内容还是完整注入消息，用长 ID、多字节文本、多候选和过小预算验证约定。 | 推荐第二项；维护者负责 API 含义。 |
| Shipped selector 矩阵 | [Headless 进程测试](../../apps/cli/tests/profiles/headless/tests/continuum-memory.e2e.ts)、[selector 测试](../../packages/experimental/continuum-jev/tests/index.spec.ts) | 在已有重启及 disabled/no-Jev 用例上补充挂载后的 shadow、active 和不可用 selector。在源码及构建产物模式验证持久化 receipt、恢复后的模型请求和回退。确定性 provider 证据与真实 Jev 效果分开记录。 | 中级；与 fixture 负责人结对。 |
| Provider 切换 | [持久化准入测试](../../packages/context/continuum/tests/durable-admission.spec.ts) | 用生成 provider A 持久化，以 B 恢复同一个 Session，检查 B 请求中的召回与归因。新 Session 属于独立访问策略任务。 | 中级；先做无密钥 fixture。 |
| 记忆生命周期与隔离 | [记录测试](../../packages/context/continuum/tests/records.spec.ts)、[作用域及失效测试](../../packages/context/continuum/tests/policy.spec.ts) | 保留已有 supersede/deactivate 和 scope 测试。定义保留期、物理删除与用户级授权，再验证不同用户、Session 的隔离和投影后源事件不变。停用记录本身不等于物理擦除。 | 资深设计；新人可补已明确的场景。 |
| 规模与可审计性 | [树及缓存实验](../../packages/context/continuum/tests/ablation.spec.ts)、[决策 receipt](../../packages/experimental/continuum-jev/tests/index.spec.ts) | 测量大规模检索 precision/recall、选中 bytes/tokens、延迟和无关候选。验证建议、采用与执行决策可分别查询。本地缓存布局结果不能证明 provider 计费节省。 | 中级，需 benchmark 评审。 |

## P2：适合新人独立完成

| 任务 | 现有证据或入口 | 剩余增量与验收标准 | 新人适配度 |
| --- | --- | --- | --- |
| 使用中关闭记忆 | [浏览器开关测试](../../apps/web/tests/continuum-memory.e2e.ts)、[迟到选择测试](../../packages/context/continuum/tests/context.spec.ts) | 已有隐藏设置行和重载持久化用例。补使用中从开启到关闭：下一请求不含召回，重载仍关闭，持久化记录仍可在授权重新开启后使用。 | 推荐 UI 任务，需 fixture 评审。 |
| 干净 checkout 示例 | [README](../../README.zh.md)、[Continuum 包](../../packages/context/continuum/README.zh.md) | 执行 no-Jev 与显式启用 Reflex 示例，说明同 Session 恢复、有界投影和 Reflex 专属记忆开关。记录确实成功的命令及缺失前提。 | 适合独立完成。 |
| 配置与安全诊断 | [服务测试](../../packages/context/continuum/tests/service.spec.ts)、[配置](../../packages/context/continuum/src/service.ts) | 添加测试前盘点尚未覆盖的 parser 场景，补定向非法配置用例；若增加诊断，从运行状态读取实际模式和可用性，并验证不含凭据及私有内容。 | 选定一个小场景后适合独立完成。 |

## 不适合新人首次独立处理

- 修改 Session event type、持久化代际及迁移，需要遵循[已发布格式规则](../session-format-status.zh.md)，并覆盖两个 SDK 的回放。
- 修改 `agent-loop`、上下文投影、cache 前缀保护或取消语义，需要设计评审及跨进程回归证据。
- Jev 安全策略、凭据、签名/公证和仓库转移由发布负责人负责。迁移到 APUS-AI-Lab 需独立核实权限并审阅历史资料；组织成员身份本身不代表有权创建仓库或完成迁移。
- 已有 disabled/no-Jev、scope 过滤、shadow/active 选择和浏览器可见性测试应扩展而非重建。Mock 测试不能证明真实 provider 效果。

## 推荐上手顺序

1. 阅读[架构](../architecture.zh.md)、[发布就绪报告](release-readiness.zh.md)和 [Continuum 限制](../../packages/context/continuum/README.zh.md#known-limitations-and-deferred-work)。
2. 查看所链接的测试，选择检索一致性或字节预算，在提出修复前复现一个边缘场景。
3. UI 工作选择使用中关闭记忆，复用浏览器 scaffold，保留已有可见性和持久化断言。
4. 提交单一聚焦改动、验收证据和相关文档检查结果。只有剩余增量确实验证后才能将任务标记完成。
