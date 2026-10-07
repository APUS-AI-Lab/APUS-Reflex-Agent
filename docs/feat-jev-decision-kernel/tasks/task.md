# feat-jev-decision-kernel — 吸收 mu 的可借鉴能力

批准：2026-10-07，用户要求“mu 借鉴能力都要吸收”。设计稿：[../design.html](../design.html)；对照分析：[../../system3-delegation-progress/mu-comparison.html](../../system3-delegation-progress/mu-comparison.html)。

## 原则

- 先有证据再开启：每个新判定上线默认 `shadow`（只记录），用真实 Jev 标注集定阈值，prd 数据达标后才 `active`。
- 达不到目标就改问法，不放宽阈值凑数。
- 判定失败（超时、出错、隐私拒绝）一律回退，不阻塞主流程。
- 进入模型的内容都能从会话日志重建：判定写 `system3/judgement`，约束写 `system3/constraint`。
- 已有判定（入口路由、Skill 选择、交接包）的事件格式本期前几个阶段不动，最后阶段再迁移。
- 每项交付：单元/组合测试（新代码覆盖率 100%）、修改前后对照、全量单测（只允许已知 3 个上游失败）、prd 实测。

## 阶段一：地基与两个独立小项

- [ ] 1. 判定内核 `decision-kernel.ts`
  - 规格：id、version、mode（off/shadow/active）、deadlineMs、questions、decide、fallback
  - 统一阈值：是非题 yes/no 阈值与“拿不准”区间；选择题最低概率 + 逃生选项
  - 隐私准入、超时、错误回退；`system3/judgement` 事件（请求、响应、结论、是否生效、耗时）
  - 配置：`decisions.<id>: { mode, thresholds, deadlineMs }`
- [ ] 2. Jev 连接防卡死（mu `judge-fetch`）
  - 连续 N 次无响应即重建连接；记录重建次数
  - 对照：模拟卡死连接，修改前判定持续回退，修改后自动恢复
- [ ] 3. 测试日志无损折叠（mu `tool.admission.test-log` 规则档）
  - 只折叠逐字重复的段落为一行加计数，不调用模型；失败项与摘要一律保留
  - 用真实测试输出样本测折叠率，确认失败行零丢失

## 阶段二：约束（mu `task.frame` + `tool.constraint`）

- [ ] 4. 约束识别：每条用户消息一道是非题（复用交接包已验证的问法），写 `system3/constraint`，保留最近 6 条；并行执行不增加等待
- [ ] 5. 约束检查：`tools/pre-execute` 对 write/edit/委派/非只读 bash 检查是否违反约束；shadow 只记录并在 dock 提示，active 返回 `ask`（原生确认卡片引用用户原话）
- [ ] 6. 交接包改读约束清单
- [ ] 标注集：20 个“调用 × 约束”样本（含近似误导项），目标精确率 ≥ 0.9

## 阶段三：过程监督复核（mu `turn.completion` / `turn.drift`）

- [ ] 7. 规则触发后经内核问 Jev 是否真的卡住或缺少验证；确认才提醒，否定只记录，拿不准按规则提醒
- [ ] 标注集：20 段真实轨迹，原样包含 10-06 两次误报、10-07 一次漏报和真正卡住的样本

## 阶段四：任务框架（mu `task.frame` 完整版）

- [ ] 8. 维护“目标 + 原话约束 + 验收项”；判断新消息是新任务、补充约束还是纠错
- [ ] 9. 缺少验证提醒与交接包读取验收项

## 阶段五：其余可借鉴判定点（按证据逐个评估，先 shadow）

- [ ] 10. 运行中消息分类（mu `input.interjection`）：纠错改 steer、补充改 followUp
- [ ] 11. 外部内容注入检测（mu `tool.injection`）：web_fetch / web_search 结果逐段判断是否含针对 AI 的指令
- [ ] 12. 模型可调用的 Jev 批量判断工具（mu `judge_items`）
- [ ] 13. “答应了却停下”的继续判断（mu `turn.continue`）
- [ ] 14. 已有判定迁移到判定内核（入口路由、Skill 选择、交接包；需持久化格式评审）
- [ ] 14a. 补强已有项：需澄清 / 先规划提示（#1）、隐藏无关技能（#4）、Jev 复核危险命令（#17）、Jev 审批模式（#18）、委派改动越界检查（#35）

## mu 全部 38 个判定点的处理方式

文章写 35 个，是 mu 旧版 README 的数字；代码（`packages/kyrn-judge/manifest.json`）是 38 个，2026-10-05 新增 `tool.injection`、`turn.continue`、`judge.items`。下表逐项给出去向。“已有”表示 System3 / DSH 已有等价或更强的实现，只在差距处补强；证据存疑的项也吸收，但只以 shadow 上线，量化收益后再决定是否开启。

| # | mu 判定点 | 去向 | 阶段 |
|---|---|---|---|
| 1 | `input.preflight` | 已有（入口路由，真切换模型）；补“需澄清 / 先规划”提示 | 五 |
| 2 | `task.frame` | 吸收：约束识别 + 任务框架 | 二、四 |
| 3 | `input.interjection` | 吸收：运行中消息自动分类 | 五 |
| 4 | `skills.disclosure` | 已有（Skill 选择，方向相反）；补“隐藏无关技能” | 五 |
| 5 | `capability.disclosure` | 吸收：按需开启工具包 / MCP | 六 |
| 6 | `tool.admission` | 吸收（shadow）：mu 自身回测零裁剪，必须先证明净收益 | 六 |
| 7 | `tool.admission.test-log` | 吸收：规则档无损折叠 | 一 |
| 8 | `context.forget` | 吸收（shadow）：旧工具输出缩成墓碑 | 六 |
| 9 | `context.compact` | 吸收（shadow）：按分数裁工具输出的压缩 | 六 |
| 10 | `memory.recall` | 吸收：经验召回 | 七 |
| 11 | `memory.capture` | 吸收：从纠错中记录经验 | 七 |
| 12 | `memory.outcome` | 吸收：从先失败后成功中记录经验 | 七 |
| 13 | `memory.worth` | 吸收：经验是否值得保存 | 七 |
| 14 | `memory.merge` | 吸收：经验去重与矛盾处理 | 七 |
| 15 | `memory.applied` | 吸收：经验是否被采用、退役 | 七 |
| 16 | `cache.warming` | 已有（Jev 连接保温）；补主模型缓存预热判断 | 六 |
| 17 | `tool.risk` | 已有（权限预设与沙箱）；补 Jev 复核危险命令 | 五 |
| 18 | `tool.approval` | 吸收：Jev 审批模式 | 五 |
| 19 | `tool.constraint` | 吸收：修改前检查用户约束 | 二 |
| 20 | `tool.injection` | 吸收：外部内容注入检测 | 五 |
| 21 | `files.locate` | 吸收：文件定位排序工具 | 六 |
| 22 | `judge.items` | 吸收：模型可调用的批量判断工具 | 五 |
| 23 | `browser.step` | 吸收（shadow）：浏览器下一步判定 | 七 |
| 24 | `review.triage` | 吸收：代码审查发现分级 | 六 |
| 25 | `diagnostics.delivery` | 吸收：编辑后诊断的送达时机 | 六 |
| 26 | `turn.drift` | 已有（过程监督规则）；补 Jev 复核 | 三 |
| 27 | `turn.rewind` | 吸收：死路时提议回到检查点（需用户确认） | 六 |
| 28 | `turn.completion` | 已有（缺少验证提醒）；补 Jev 复核 | 三 |
| 29 | `turn.continue` | 吸收：答应了却停下时继续 | 五 |
| 30 | `output.drift` | 吸收（shadow）：流式输出违背规则时打断 | 七 |
| 31 | `goal.met` | 已有（原生 goal 包）；补 Jev 判断目标达成 | 六 |
| 32 | `board.read` | 已有（System3 dock，更强）；补“有新进展才更新”判断 | 六 |
| 33 | `notify.routing` | 已有（委派提醒）；补外部事件的送达时机 | 六 |
| 34 | `swarm.routing` | 已有（委派候选）；补角色与强度选择 | 七 |
| 35 | `swarm.patch` | 吸收：委派交回的改动是否越界 | 五 |
| 36 | `hive.publish` | 吸收：多代理共享发现 | 七 |
| 37 | `hive.deliver` | 吸收：多代理消息投递 | 七 |
| 38 | `hive.relate` | 吸收：多代理消息更正与矛盾 | 七 |

## 阶段六：上下文与工具层（均先 shadow）

- [ ] 15. 按需开启工具包 / MCP（#5）
- [ ] 16. 工具输出语义裁剪（#6）、旧输出墓碑（#8）、打分压缩（#9）：只记录判定，统计省下的 token 与误删，净收益为正才开启
- [ ] 17. 主模型缓存预热判断（#16）、文件定位工具（#21）、审查分级（#24）、诊断送达（#25）
- [ ] 18. 检查点回退提议（#27）、目标达成判断（#31）、看板更新判断（#32）、外部事件送达（#33）

## 阶段七：记忆、多代理与浏览器（均先 shadow，需单独设计评审）

- [ ] 19. 经验记忆六项（#10–#15）：存储位置、隐私与跨会话边界需先设计
- [ ] 20. 多代理角色与强度（#34）、Hive 三项（#36–#38）
- [ ] 21. 浏览器下一步判定（#23）、流式输出打断（#30）

## 进度记录

| 日期 | 项 | 结果 |
|---|---|---|
