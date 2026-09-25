# System3 工作计划

- [x] 检查原工作区与交接，保留用户未提交改动。
- [x] 确认官方上游、完整clone、保留upstream、自有origin与main。
- [x] 创建私有仓库并回读private=true。
- [x] 创建feat-system3-foundation隔离worktree。
- [x] 深读DSH核心、Jev材料、微信与上游skill、Uni-Agent最新训练证据。
- [x] 编写四条工作线设计、API草案、文件清单与验收实验。
- [x] 用户审批设计（通过用户多次“继续”与当前goal激活确认）。
- [x] 修复上游4项Ruff lint与28文件格式问题，并完成相关验证。
- [x] 推送私有基线，确认远端HEAD与CI。
- [ ] M1：日志证据筛选、影子监督、统一费用账本。
- [x] M1-a：实现本地优先隐私路由准入纯策略包并通过单测、类型与文档门禁。
- [x] M1-b：实现可恢复、可审计的长工具输出证据片段选择纯策略包。
- [x] M1-c：实现独立完成监督、Jev shadow 对照与 provider/estimated usage ledger。
- [ ] M2：一个外部宿主真实接入与配对任务评测。
- [ ] A线：冻结基线→可信数据→独立controller训练与晋级。

## Review

M0完成了上游门禁修复、依赖安装、构建与Python SDK回归测试，并已推送私有仓库。M1-a新增确定性本地优先路由策略；完整日志筛选、影子监督与费用账本仍未完成。设计与专项HTML做过文件、hash、浏览器布局及交互检查；性能与训练结果来自标注来源，未在本轮复测。

M1-a/b/c验证：策略包 `vitest` 分别 5/5、5/5、6/6 通过；`tsc -b tsconfig.host.json` 通过；包级 Oxlint、package meta、export JSDoc、package paths、README model-experience/limitations、全仓双语 pairing、`ruff check .` 与 `ruff format --check .` 均通过。

## 专项方案 v2 · 本地9B + Jev + 多智能体

- [x] 恢复worktree交接与Git状态，确认本轮仅更新方案。
- [x] 核对Claude/Codex provider的真实编排与隔离边界。
- [ ] 设计本地优先、隐私隔离、双模式9B和专家委派闭环。
- [x] 输出完整专项HTML，明确优先级、里程碑、接口及验收。
- [x] 逐项详细设计Jev八个融合点：触发、输入、输出、执行者、回退、日志与验收。
- [x] 验证专项HTML交互、桌面/手机布局、DOM id和来源hash。
- [ ] 验证离线路由演示、移动布局、链接和来源；更新交接并本地提交。
