# feat-system3-desktop 交接

## 1. TL;DR

- 产品为独立 Jev Native + DSH Native，入口第一目标、合理过程快决策第二目标。
- 用户选定 dataelement/dsh-desktop，并同意对齐 DSH 0.1.7-rc.2。
- 用户明确要求完整后端 Goal：入口、过程、能力/记忆与长期目标维护；必须尊重 Jev 9B 的有限能力。
- 本轮为统一设计阶段；中文 v1.0 定稿候选 HTML 已生成，产品代码尚未实施。
- 工作区 feat-system3-desktop 从上一工作分支创建；主目录与旧工作区保持干净。

## 2. 本轮交付物

| 路径 | 行数 | 说明 |
|---|---:|---|
| `docs/feat-system3-desktop/system3-native-v1.html` | 222 | 统一设计、性能与可恢复压缩、离线架构/交互、G0—G6验收 |
| `docs/feat-system3-desktop/verification.json` | 68 | 固定来源、设计复核与检查记录；明确未实施项 |
| `tasks/feat-system3-desktop/plan.md` | 31 | 当前 Goal 的可勾选计划 |
| `tasks/todo.md` | 93 | 承接历史目标与新阶段入口 |
| `tasks/lessons.md` | 58 | 完整后端、真实版本、速度与记忆边界经验 |
| `tasks/feat-system3-desktop/handoff.md` | 72 | 冷启动入口 |

## 3. 设计约束

- 不加入 Duse 产品依赖，不迁入 agent-jev-pilot 代码。
- DSH 是唯一执行所有者；Jev 只选少量合法候选或弃权。
- 规则管权限、隐私、取消、预算与验收；复杂规划与生成属于 System2。
- 前端不直接调用 Jev、不自行修改模型；按持久事件和投影展示真实采用。
- 设计确认后按 G1—G6 实施，遵守 Human Gate；所有代码在隔离 worktree 修改。
- 本轮文档集中到 `docs/feat-system3-desktop/`，流程交接到 `tasks/feat-system3-desktop/`。

## 4. 已发现的真实行为

- 本仓库实际共同祖先是官方 rc.1；到 rc.2 有346提交、3433文件变化。定制与升级交叠46文件，不能只改版本。
- dataelement 的 package.json 为 rc.2，README 仍写 rc.1；存在25个DSH补丁、另2个依赖补丁。
- Desktop 通过独立 Electron Node 进程运行 DSH CLI Web profile，不是第二 AgentLoop。
- SessionController 生命周期补丁与 Jev router 的取消、恢复、人工固定和卸载需要一起验收。
- AgentLoop 先 assemble 捕获 selection/工具 schema，再 pre-step；首期中间节点适合上下文选择，不能在此随意裁工具/换模型。
- 当前 modelSelection wire 只有 lastUsed/next；缺少自动/固定意图与恢复自动 API。
- header 只证明请求配置已准备；采纳→输入 rpcId→turn/step→有效 header→输出/attempt 需要完整关联；分页缺档不能认定未采用。
- Goal 恢复/fork 后 disarmed；只有轮数限制，费用/Token/时间预算需补。Schedule 只处理 live Agent，不唤醒 cold Session。
- supervisor 是检查消费库，不是 verifier；空检查和证据引用缺口需要修复才能用于独立完成判定。
- 原生 Goal 完成入口还需统一约束所有模型工具、Remote API 和服务路径，不能只修 supervisor；人类确认必须有可识别授权。
- Skill 正文加载不证明已进入请求，需 waterfall 排序、reject/cancel 与统一防重复；安全 profile 的事件解码和投影必须独立于 Jev provider。
- 整体完成至少有一个经规则对照、实际采用并可回放的过程节点，全部 shadow/禁用不能算完成。
- 最新用户补充：体验更快、记忆压缩不丢关键上下文、原生特点覆盖重要环节。HTML 已补 choice/score/noul、端到端延迟及 compaction 的块选择、事实保护与查回；不承诺摘要语义绝对无损。

## 5. 下一里程碑任务清单

- [ ] 具体设计确认。
- [ ] G1：rc.2 源码合并与核心回归，桌面补丁映射，自有 runtime 联调。
- [ ] G2：原生 routing mode API、投影与 Conversation 决策卡；真实入口验收。
- [ ] G3：Skill 小候选选择、实际加载与规则对照。
- [ ] G4—G6：基础记忆/诊断、委派/Goal 维护、整体真实链路与收益验收。

## 6. 分支/部署状态

- 分支：feat-system3-desktop，基于 feat-independent-harness；本轮尚无产品代码修改。
- main 保持原有状态；没有 PR、merge 或新的常驻部署。
- 当前 Goal active，未因设计文档交付标记完整完成。
- 上轮远端 Actions 受 budget 阻止，不能视为 CI 通过。

## 7. 冷启动 checklist

- [ ] 先读本文件，再读 `tasks/todo.md` 和统一 HTML。
- [ ] 核实用户是否已确认具体设计；未确认时不开始产品实现。
- [ ] 查看 git status/diff/stash/worktree 与 HEAD，保护用户改动。
- [ ] 读 `tasks/lessons.md`、原生架构及相关子树 AGENTS。
- [ ] 按 G1 源码合并，不以 package version 替代实际升级；各批次跑相关检查。

## 8. 本轮验证

独立架构/UI复核通过；新增性能与压缩复核要求所有fallback也经过同一事实检查，已纳入。HTML28链接和15锚点、1360/390px九项状态检查通过，无控制台错误；文档快检20/20、doc-sync42/42、Host构建与lint、Ruff双检查通过。rc.2只做merge-tree冲突预览，未实施合并；后端Goal仍active。完整记录见 `docs/feat-system3-desktop/verification.json`。
