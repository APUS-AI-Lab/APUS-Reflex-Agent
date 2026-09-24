# feat-system3-foundation 交接

## 1. TL;DR

- 产品：System3 = APUS System1 + 强模型System2 + 确定性执行与验收。
- 已clone官方DSH46a7f68，创建cryptoSUN2049/xDAN-System3-DSH并验证private=true。
- 四线研究与设计完成；尚待用户审批M0+M1，未实现功能。
- 原始上游Ruff失败；远端为空，未push，未部署/训练。
- 先读docs/feat-system3-foundation/index.html或design.md。

## 2. 本轮交付物

| 路径 | 行数 | 说明 |
| --- | --- | --- |
| docs/feat-system3-foundation/design.md | 202 | 四线设计与源码插口 |
| docs/feat-system3-foundation/index.html | 18 | 离线阅读版 |
| docs/feat-system3-foundation/evidence.json | 147 | 来源哈希与验证状态 |
| tasks/todo.md | 18 | 执行计划 |

本handoff自身行数以wc -l为准；未修改继承的产品代码。

## 3. 设计约束

- docs与tasks均按worktree名归档；所有后续代码在隔离worktree修改。
- 保留上游MIT与历史、现有包名；不复制loop或trainer。
- 模型提供建议，权限/预算/取消/证据与验收由确定性代码守住。
- decision/generate分开验收，概率不等于校准信心，candidate_done不等于完成。
- model-visible内容必须落盘可重放；原始日志可恢复。
- 每次push前两项Ruff必须通过；失败不绕过。

## 4. 已发现真实行为

- DSH hooks桥是在DSH执行宿主hook配置，不能推论反向注入原生Codex/Claude。
- sdk-minimal无压缩/skills/subagents等完整能力，训练必须固定完整profile+patch。
- DSH已具备头尾裁剪、独立摘要模型、阶段路由、子代理和有界goal；这些必须做基线。
- APUS现有决策评测不证明代码/长日志摘要质量；旧全景9B未启动状态已过时。
- Uni-Agent新16步文本OPD有更新/reload；旧工具checkpoint有负提升，两者不能混淆。
- 原始上游Ruff0.13.3：bootstrap.py两处E402、test_client.py一处F841、test_runtime_resolution.py一处F401；28文件格式不合要求。

## 5. 下一里程碑任务清单

- [ ] 获得设计批准；先M0门禁修复与私有基线push，再M1。
- [ ] 固定模型/DSH/SDK/runtime/profile/patch/verifier版本并真实process smoke。
- [ ] 规则vsJev日志筛选、影子监督、费用账本；正式holdout独立封存。
- [ ] 单宿主接入能力验证；不先承诺全流量截获。
- [ ] controller与generator分阶段训练，收益达标才晋级。

## 6. 分支/部署状态

- 根仓库 /Users/gumpm5/Documents/Code/xDAN-System3-DSH：main，46a7f68b0922371ce7144b668b90e377d8e799f4。
- 本worktree .Codex/worktrees/feat-system3-foundation；分支feat-system3-foundation。
- origin为自有私有仓库，upstream为deepseek-ai/deepseek-harness。
- GitHub仓库已创建且私有；代码未push，CI未运行；无产品部署和GPU创建。
- 原xDAN-DSH-uni-agent工作区及未提交修改全部保留。

## 7. 冷启动 checklist

1. 读本文件→design.md→evidence.json→tasks/todo.md。
2. 读本repo AGENTS与docs/AGENTS，核git status/diff/stash/branch/HEAD/worktree。
3. 核远端private与refs，不能把创建仓库误写成已推送代码。
4. 查看用户是否已批准设计；未批准不进入功能实施。
5. 训练细节回读performance-9b最新报告与实际版本，不按旧root文档推断。
6. 按改动面验证、两项Ruff通过再push，保留本worktree。
