# feat-system3-foundation 交接

## 1. TL;DR

- 产品：System3 = APUS System1 + 强模型System2 + 确定性执行与验收。
- 已clone官方DSH46a7f68，创建cryptoSUN2049/xDAN-System3-DSH并验证private=true。
- 四线研究与设计完成；用户已通过“继续”确认进入实现，目标仍未完成。
- M0门禁修复、构建、测试和私有基线已推送；M1-a/b/c、M1-d观察层和真实 AgentLoop smoke 已完成，决策层仍在进行。
- 先读docs/feat-system3-foundation/system3-special-plan.html；再读design.md。

## 2. 本轮交付物

| 路径 | 行数 | 说明 |
| --- | --- | --- |
| docs/feat-system3-foundation/design.md | 202 | 四线设计与源码插口 |
| docs/feat-system3-foundation/index.html | 18 | 离线阅读版 |
| docs/feat-system3-foundation/evidence.json | 147 | 来源哈希与验证状态 |
| tasks/todo.md | 18 | 执行计划 |
| packages/experimental/system3-policy/src/index.ts | 143 | 本地优先隐私路由准入纯函数 |
| packages/experimental/system3-policy/tests/policy.spec.ts | 67 | 5项隐私、偏好和fail-closed测试 |
| packages/experimental/system3-policy/README.md/.zh.md | — | 包契约、模型体验与限制 |
| packages/experimental/system3/src/index.ts | 150 | 统一 `ctx.system3` 服务与可选 AgentLoop 非侵入观测 |
| packages/experimental/system3/tests/service.spec.ts | 66 | 路由、证据、监督组合及 AgentLoop 边界观测 smoke |
| packages/experimental/system3/README.md/.zh.md | — | 服务使用、观测语义与限制 |
| docs/feat-system3-foundation/*.{zh.md,i18n.yaml} | — | 补齐专项设计文档双语配对记录 |

本handoff自身行数以wc -l为准；未修改继承的产品代码。

### 专项方案 v2 新增

- `docs/feat-system3-foundation/system3-special-plan.html`：完整产品与架构方案，15个章节；含本地9B、Jev、DSH、Claude Code/Codex、多智能体、隐私、训练、优先级和验收。
- `docs/feat-system3-foundation/system3-special-plan.md`：HTML入口摘要。
- `docs/feat-system3-foundation/system3-special-evidence.json`：源码锚点及身份快照。
- Jev融合专章逐项覆盖8个位置：输入澄清、路由、上下文证据、子代理拆分、语义无进展、完成验收、生成/工具选择、异常升级；每项包含触发、输入、输出、DSH执行、回退、记录与验收。
- 浏览验证：1280px无横向溢出；390px无横向溢出；预设路由案例可切换；local-only策略会阻断code外发；DOM id唯一；15个章节、14个表格、1个交互按钮。


## 3. 设计约束

- docs与tasks均按worktree名归档；所有后续代码在隔离worktree修改。
- 保留上游MIT与历史、现有包名；不复制loop或trainer。
- 模型提供建议，权限/预算/取消/证据与验收由确定性代码守住。
- decision/generate分开验收，概率不等于校准信心，candidate_done不等于完成。
- model-visible内容必须落盘可重放；原始日志可恢复。
- 每次push前两项Ruff必须通过；失败不绕过。

## 4. 已发现真实行为

- DSH hooks桥是在DSH执行宿主hook配置，不能推论反向注入原生Codex/Claude。
- `System3` 的 `observeAgentLoop` 使用字符串事件名并只记录计数；它证明了可挂载的观测边界，不代表已经拥有模型决策、Session持久化或专家调度权。
- 真实 smoke 使用 `MockAdapter` 驱动一轮生产 AgentLoop，并确认 `turn/start`、`step/start`、`step/end`、`turn/end` 已写入 Session；它仍未接入真实 APUS 9B。
- sdk-minimal无压缩/skills/subagents等完整能力，训练必须固定完整profile+patch。
- DSH已具备头尾裁剪、独立摘要模型、阶段路由、子代理和有界goal；这些必须做基线。
- APUS现有决策评测不证明代码/长日志摘要质量；旧全景9B未启动状态已过时。
- Uni-Agent新16步文本OPD有更新/reload；旧工具checkpoint有负提升，两者不能混淆。
- 原始上游Ruff0.13.3：bootstrap.py两处E402、test_client.py一处F841、test_runtime_resolution.py一处F401；28文件格式不合要求。

## 5. 下一里程碑任务清单

- [x] 获得设计批准；M0门禁修复与私有基线push已完成。
- [x] M1-a本地优先策略包：类型、测试、包文档与双语门禁已完成。
- [x] M1-b日志证据片段选择：类型、测试、包文档与双语门禁已完成。
- [x] M1-c影子监督与统一费用账本原语：类型、测试、包文档与双语门禁已完成。
- [x] M1-d接入DSH AgentLoop 四个边界事件并完成可控 fake-agent smoke（只观测、不改行为）。
- [x] M1-e-观察验证用真实 AgentLoop + MockAdapter 完成 durable turn smoke。
- [ ] M1-f接入DSH Session事件、证据持久化、真实本地9B provider与Jev决策。
- [ ] 固定模型/DSH/SDK/runtime/profile/patch/verifier版本并真实process smoke。
- [ ] 规则vsJev日志筛选、影子监督、费用账本；正式holdout独立封存。
- [ ] 单宿主接入能力验证；不先承诺全流量截获。
- [ ] controller与generator分阶段训练，收益达标才晋级。

## 6. 分支/部署状态

- 根仓库 /Users/gumpm5/Documents/Code/xDAN-System3-DSH：main，46a7f68b0922371ce7144b668b90e377d8e799f4。
- 本worktree .Codex/worktrees/feat-system3-foundation；分支feat-system3-foundation。
- origin为自有私有仓库，upstream为deepseek-ai/deepseek-harness。
- GitHub仓库已创建且私有；M0、M1-a/b/c与观察层提交已push到私有origin；真实 AgentLoop smoke 已在本地通过；CI未运行；无产品部署和GPU创建。
- 原xDAN-DSH-uni-agent工作区及未提交修改全部保留。

## 7. 冷启动 checklist

1. 读本文件→design.md→evidence.json→tasks/todo.md。
2. 读本repo AGENTS与docs/AGENTS，核git status/diff/stash/branch/HEAD/worktree。
3. 核远端private与refs，确认私有仓库与feature分支commit一致。
4. 先回读四个System3包契约/测试，再进入M1-f Session事件接入、真实本地9B provider与Jev决策。
5. 训练细节回读performance-9b最新报告与实际版本，不按旧root文档推断。
6. 按改动面验证、两项Ruff通过再push，保留本worktree。
