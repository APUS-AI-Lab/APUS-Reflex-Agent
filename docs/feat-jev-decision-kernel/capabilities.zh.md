# System3 能力清单：对照 DSH 原版

[English](capabilities.md) | 中文

DSH 原版（0.1.7-rc.2）提供 agent 底座：agent loop、多模型接入、工具集、子 agent、目标、待办、技能、压缩、沙箱与审批、会话持久化、Web 与桌面界面。System3 是叠加在它之上的插件层，定位是 agent 的管家和模型路由管理层；所有能力都通过 DSH 公开的扩展点接入，不改 agent loop。方案见 [steward-plan.html](steward-plan.html)，任务进度见 [tasks/task.zh.md](tasks/task.zh.md)。

“验收”一栏指在公网 system3.xdan.work 上用浏览器、以用户身份完成的检查；带 `accept.py` 的项目已纳入可重跑的 [浏览器验收集](../../deploy/system3/acceptance/README.zh.md)。

## 已实现

| 能力 | DSH 原版 | System3 增加 | 证据与验收 |
|---|---|---|---|
| 模型选择 | 用户手动选一个模型，整个会话一直用它 | 入口路由：每条消息由 Jev 在 DeepSeek Flash、Pro（官方 API）、GPT-5.6、GPT-6（中转）和委派 Codex 之间选择；说“交给 codex”直接委派；拿不准时沿用上一轮；带图片时只选支持图片的模型；自动避开变慢的线路 | prd 翻译走 Flash，推理题走更强的模型，判断 0.3–1 秒；`accept.py routing` |
| Jev 连接 | 无 | 连接保温；连续没有响应时重开连接池 | #23 |
| 技能 | 用户显式 `/技能名` 调用，或模型自己读目录 | 自动选技能：Jev 选出最合适的一个，正文注入给模型 | 已上线 |
| 委派 Codex | 有 Codex、Claude Code 子 agent 接口和补充输入 API；界面只有过程卡片 | 委派全过程：注入委派指令；交接包把更早的要求原话带给 Codex；进度快照；启动慢、停滞、超时提醒；dock 补充说明与停止；补充内容复述给主模型；输入框显示“已交给 codex” | prd 上 Codex 56–309 秒完成 |
| 过程监督 | `dsh-guard` 防死循环 | 过程提示：同一错误重复、失败过多、长时间没有进展、改了文件没验证（催一次）、委派里命令连续失败；识别 `; echo $?` 和管道掩盖的失败 | 规则版已上线；10-06、10-07 的误报与漏报已修 |
| 长输出 | 超长输出按大小落盘，给模型路径 | 测试与构建日志无损折叠：重复段换成“与上文第几行相同，开头是……”，可逐字节还原 | #25；真实失败日志节省 57–65%；`accept.py folding` |
| 目标与要求 | `/goal` 保存目标、空闲时自动续跑；完成与否由模型自报 | 任务卡：用户提的要求按原话记下，作为运行时上下文一直给模型看，dock 上可见；建了目标就以目标为准，目标进行中不被聊天替换 | #26、#27；126 条真实 Jev 标注集；`accept.py task-frame` |
| 运行中插话 | 用户自己选排队或插入；默认排到本轮结束 | 插话分流：判断是不是当前任务的要求、纠正或打断，是就插入正在运行的这一轮，并转给正在运行的 Codex；旁支问题与闲聊照常排队 | #28、#29；`accept.py goal-interrupt`、`accept.py codex-forward` |
| 判断可审计 | 无 | 判定内核：每次 Jev 判断写入会话，含完整请求与响应，可回放；每次调用 Jev 或切换线路前做隐私准入 | #26 |
| 界面 | 过程卡片、目标条、待办、排队列表 | System3 dock：路由行、任务卡、插话提示、过程提示、Codex 卡片、执行依据；每轮开头的路由行；输入框的委派标记 | 各项验收截图 |
| 部署 | 本地运行 | 公网 system3.xdan.work（TLS、启动令牌与 30 天 Cookie）；原子发布与回滚；浏览器验收集 | `deploy/system3` |

## 规划中

- [ ] 完成核验：模型标记完成前，按任务卡逐条核对要求与完成标准（mu `goal.met`、`turn.completion`、`turn.continue`）
- [ ] 约束守护：修改类工具调用前，拿用户原话检查是否违背（mu `tool.constraint`、`tool.risk`、`tool.approval`、`swarm.patch`）
- [ ] 偏离监控的 Jev 复核：规则提示之后的语义复核（mu `turn.drift`）
- [ ] 外部内容注入防护：网页与 MCP 内容中针对 AI 的指令被扣下（mu `tool.injection`）
- [ ] 运行中路由升降级：卡住时升级到更强模型或交给 Codex（mu `swarm.routing`）
- [ ] 按需亮工具与技能披露、澄清提示（mu `capability.disclosure`、`skills.disclosure`、`input.preflight`）
- [ ] 经验记忆：跨会话记住用户定下的规矩（mu `memory.*`）
- [ ] 插话的“改回排队”：需要在服务端提供原子操作后再做

## 边界说明

- 过程监督仍是规则版，完成与否仍由模型自报；System3 现在能看住任务、及时传话、管住委派，判断“做没做对”要等完成核验和约束守护。
- 唯一改动 DSH 核心的地方是为任务卡登记一个运行时上下文位置（`SYSTEM3_TASK_FRAME`）。
