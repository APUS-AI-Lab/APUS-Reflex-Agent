# Reflex control handoff

## TL;DR

- Harness 本轮实现已提交并推送到 `feat-reflex-control`；Frontend `feat-reflex-control` 也已提交并推送；尚未创建 PR 或合并 main。上一批品牌、MIT 与 GitHub 工作已合 main，用户授权完成前后端并最终合 main，授权持续有效。
- 统一验收入口为 [测试验收目标清单](../../docs/feat-reflex-control/acceptance-checklist.zh.md)：37 项目标、12 条完整用户流程，分别标明真实证据、回归与缺口；收尾先核对此页。
- Context v3 的 Host16 真实浏览器财务→完整 Host 重启→自动恢复，以及 TS/Python 录制与独立重放全部通过；旧误删、自动恢复失败与多余检索证据仍保留。
- Goal 首轮 Codex 真实浏览器增量 JSON 任务通过；受控 native stall 恢复 v4 真实 API / Codex / 正常终态 / 产物通过。狭义受控重复失败和 Host20 语义偏航均有真实纠偏、原生输入消费、结构化 verification-target、独立产物与 `improved`；健康长任务误干预、用户中途改 Goal 和正式 Electron 仍待验收。
- Host17 字面量首次试验失败保留；透明传输观察的真实 literal unittest 已61.77秒通过。监督连续证据后缀、独立语义触发与同证据去重已107 tests/严格100%；Host20 真实语义试验已取得 correction-loop target 与 `improved`，旧 Host16/Host19/v5/v6/v7 失败记录继续保留。
- C-06 真实跨进程缓存配对已通过：四条件、12 轮、三个独立 CLI 进程、按行 remove、恢复、cache/session 前缀保护和路由/工具稳定性均有脱敏证据 `docs/feat-reflex-control/evidence/cache-c06-real.{md,zh.md,json}`；不宣称供应商冷缓存或成本收益。
- F-01 Web 配置真实保存、重启恢复和真实请求 low 已通过，随后恢复部署默认 high；证据 `docs/feat-reflex-control/evidence/reflex-settings-real.{md,zh.md,json}`。Frontend `feat-reflex-control` 已固定 Harness revision，unsigned macOS arm64 目录包的 Electron 正常启动、配置保存/重启、Safe Mode 和恢复已通过；原生 200% 缩放、签名/公证及 PR/main 合并仍未完成；所有 Web server7–13 已停止。

## 本轮交付物

完整当前 changed + untracked 路径、文件总行数与字节数见 [files.md](files.md)，不是 diff 增量行数。主要改动包括 System3 Goal 路由、Reflex 上下文投影/可恢复记忆、普通监督/原生恢复、人工输入优先；Subagent 控制队列与 Codex evidence / verification-target 采集；专用 Reflex 设置页；计量、持久化与 SDK 投影。

设计和证据集中于 `docs/feat-reflex-control/`。冷启动优先读 `reflex-complete-design.html`、`context-cache-design.md`、`supervision-semantic-design.md`，以及 `evidence/context-semantic-validation.md`、`evidence/context-v3-priority-validation.md` 和 `evidence/supervision-semantic-validation.md`。交付验证不以单一最终答案代替事件、产物与模型请求核对。

当前通过证据：

- Context Host16：`evidence/browser-context-v3.json`、`reflex-context-v3-finance.png`、`reflex-context-v3-restored.png`。财务仅六次 read、无额外 memory 调用，必要金额保留，合计 1137.41；旧旅行行只从未发送尾部移出。完整退出重启后，同 Session 在首个模型请求前追加 `reflex-memory`，零工具调用回答四项原始事实；旧 44 条事件及输入哈希不变。
- SDK Host16：TS context v3 / semantic verification-target refresh 与独立 replay 两场景均过；Python 两场景各 record 与独立 replay 通过。日志 `/private/tmp/reflex-final-sdk-ts-{refresh,replay}.log`、`/private/tmp/reflex-final-python-{context,semantic}-{record,replay}.log`。普通监督、Goal 和原生恢复另有已通过的录制/重放；不为无行为变化重复跑。
- Goal：`evidence/browser-goal-json-independent.json`、`browser-goal-json-tests.log`、`reflex-goal-json-completed.png`；10 tests、金额与文件 hash 独立核对通过。
- Repeated failure：`evidence/supervision-real-repeated-failure.json`；真实 gpt-6 relay 在 300 秒预算内完成三次失败、Reflex 诊断、脱敏 native `item/started`/`item/completed`、修复、相关验证和 `improved`，受保护文件 hash 未变。该证据使用 `semantic=false`、500ms 观察和 30s 停滞阈值，不等于发布默认配置。
- Semantic Host20：`evidence/semantic-codex-host20-persistent.{json,md,zh.md}`；134.18 秒受控真实试验记录 stale fence、fresh accepted realign、原生消费、四项营销偏航操作、四项纠偏后财务操作、结构化 `verification-target`、`1137.41` 独立校验和 `improved`；受保护输入与 verifier 未变。历史语义失败证据仍保留，所有临时解析器/测试配置改动已撤回。
- Native recovery：`evidence/native-recovery-real-v4.json` / `.log`；127.41 秒内同 thread 续 turn，正常 completed、产物与验证脚本 hash 通过。
- C-06：`evidence/cache-c06-real.json`；四个独立条件均通过答案、输入保护、Session JSONL 追加前缀、请求前缀、部署路由、稳定工具哈希、无运行时错误和启用条件的真实 `reflex/context-projection/remove`。
- F-01：`evidence/reflex-settings-real.json`；规范模型连接判断通过、无效模型预期失败、low 保存后跨 server 进程重载并被真实请求消费，最后恢复 high 并删除用户覆盖项。
- 门禁：Host16、Client11、Web11 通过；full lint final2 通过（`/private/tmp/reflex-control-lint-final2.log`）；Ruff check / format-check 全仓 105 文件通过；MIT 324 / NOTICE、export-jsdoc、persistence 86 / 27 检查通过。通过范围按对应日志，不等于全部 doc-sync 或发布验收已完成。

## 设计约束

所有代码改动只在两个 `feat-reflex-control` worktree；主目录现存用户 WIP 不动。Model-visible 必须 logged，自动输入必须带来源、不能冒充人工。人工更新、Goal revision、取消优先于旧判断与排队控制。原生恢复须确认 matching interrupted 终态才同 thread 续 turn；未知结果不盲目重放，不重复未知副作用。

Reflex 冻结整个已提交前缀及生成的助手文本，请求失败、重启或切路由都不解冻。只编辑未发送尾部，生产 `protectRecentMessages=4` 不降低。原文日志保持完整；按行和 Unicode 安全片段选择。恢复冻结/压缩后的信息只能追加，不改旧 marker。不能宣称修改 Codex 私有上下文、无限物理内存、供应商必然 cache hit，或尚无配对证据的成本/延迟改善。

真实模型不确定时允许保留；不得通过降低阈值追求删除率。必要金额/约束误删必须判失败。语义反馈只有相关、成功且含实际 `verification-target` 的验证才可 improved；读取测试文件、传输 ACK 或无关测试成功不够。受限 AST 解析不执行结果、不发送原始命令、不凭 unknown 补造路径。

GitHub 操作须显式 `--repo cryptoSUN2049/APUS-Reflex-Harness` 或 Frontend；本地 `gh repo view` 无仓库参数会解析到上游 deepseek-ai/deepseek-harness，禁止凭默认推断创建或合并PR。

构建由 root 协调；不要并行 build 与 doc-sync（后者 doc-typecheck 会构建 Host），不要在 built SDK / 原生验收时重写 lib。凭据只静默读取 `~/.config/xdan-system3/runtime.env`，不打印密钥或带 auth 启动 URL。

## 已踩坑/已发现的真实行为

- Codex 使用 Harness host 本地 package-local 官方 0.153.4 app-server，模型推理远程；不是当前聊天 agent。设置页 low 保存/刷新/完整重启及实际请求 effort=low 通过，之后浏览器已恢复 high。入口简单算术路由约 1066–1088 ms、整体约 3 秒，仅为观察，不是首屏基准。
- Goal 路由曾把明确“用 Codex”判 abstain；语义 prompt 已让明确肯定选择优先，不使用关键词直接授权。真实 JSON 任务 reserved/start/completed，Codex 完成 seq59 先于父模型首工具；甲店 150.20、乙店 480.30，原 invoice / 旧 CSV hash 保持。
- 上下文最初误删订单 A 的 875.12，概率 .90465，定位和行映射正确。每题 inline 文本与必要证据标准解决已知误删；乱序/多源/注入矩阵保留必要信息，但注入批次无关内容可能保守保留，不能宣称完整删除召回。
- `browser-context-v2.json`：财务通过，重启后四次 memory 搜索找到原文，但自动恢复概率 .033086，自动恢复失败。v3 分开有序 `currentUserRequests`、active Goal 与 prior task-frame；固定五次真实对照中恢复 .998499。39 focused tests / 四项 100% 通过。
- `browser-context-v3-attempt1.json`：财务算对且 cache 保护通过，但主模型因 marker 额外检索旧旅行两次；效率失败，未执行恢复后半段。工具说明明确仅当前具体缺失事实才查，旧 marker 字节未改，初轮系统+工具启发式增加 63 tokens。Host16 同 prompt 新 Session 才完整通过；两个旧失败不得删除或改写。
- 只缓存 fencing 有效、成功且为空的完整相同判断；失败、stale 与正向恢复不缓存。当前任务/候选/配置变化重判。恢复支持同批文本去重、工具 pending admission 去重，取消不永久封禁后续恢复。
- SDK supervision fixture 必须在人工消息 admission 后触发；pre-step 时消息仍 claimed，人工优先 fence 正确拒绝旧监督。已移到 `llm/stream`，不放宽生产 fence。Context replay 手工工具流必须先消费对应 recorded response，避免重放游标重复；动态 memory reference 使用当前真实 seq。
- Python native 曾出现随机 runId 与末尾 idle 竞态；先断言原始事件一致，再规范化 runId，等待第二 turn/end 后 idle。不通过删除通知掩盖差异。
- 六次并行 read 曾触发 process-supervision 无进展；部署 progressTools 已含 read/grep/glob，文案按工具调用次数。修复已含 Host16。
- 旧 steer-only 150/300 秒及 v4 303 秒测试未完整成功；后者首次 native 命令都未返回，不能说是三次重复失败识别失败，也不能声称真实通过。`semantic-steer-real-v4.json` / `.log` 保留。
- Host16 semantic 原生测试 80.57 秒完成且独立验证通过，但 20 秒 recovery 提前打断故障注入，没有实际营销偏航 / realign / improved，故闭环失败；见 `semantic-codex-host16.json` / `.md` / `.zh.md`。官方 wrapper 命令无 target 的具体原因当时未保存，不能猜测。
- `verification-target` 解析接受有界 literal pytest / python -m pytest / unittest `.py` 参数和单层 POSIX wrapper，拒绝链式、扩展、重定向。依赖 `@yarnpkg/parsers`；Host17 新增纯诊断类别 API 和 `copyReflexEvidence` 显式返回类型。单通道 native unittest 诊断在 150 秒内未返回命令，不能归因解析器；先补传输时序，再决定 semantic。新 semantic fixture 使用部署 180 秒恢复阈值。
- 迟到 ACK 在 Goal/人工变化后复活反馈的竞态已修：捕获 Goal + controlRevision；ACK 期间仅 native 新证据仍可用于反馈。消费者 103 tests / 严格 100% 通过。受控 semantic SDK 已验证真实服务链，但不替代未完成的真实模型闭环。
- Electron 隔离必须设置 `SYSTEM3_DESKTOP_USER_DATA_DIR`；单设 DSH_HOME 不够。`--safe-mode` 有效；gstack 不能直接连接 Electron DOM。不要把 Web DOM 验收当 Electron 验收。

## 下一里程碑任务清单

- [x] Context v3 源码、真实模型固定对照、Host16 浏览器完整重启恢复、双 SDK 最终验收。
- [x] Goal 首轮真实 Codex JSON 增量任务；受控 native stall 恢复 v4；人工优先/排队控制/迟到 ACK 回归。
- [x] Reflex 设置页、语义采集/消费者、verification-target 解析与定向严格覆盖；Host16 semantic SDK 全链路。
- [x] full lint final2、Ruff 全仓 105 文件、MIT/NOTICE、export-jsdoc、persistence 已通过检查。
- [x] Host17 构建 exit0（session 22268）。
- [ ] 补无内容修改的传输观测，定位原生 literal unittest 无命令结果的等待位置。上一试验已 aborted，报告保留依赖检查重叠，不能推断仅模型原因。不要并行真实验收、安装与构建。
- [ ] 根据审计决定是否再做一次有界真实 semantic 验收。必须实际偏航→Reflex realign→provider 消费→相关 verification-target→improved，不能以普通完成或 SDK 模拟代替；先处理清理超时和 target 语法可观测性。
- [x] 旧 doc-sync 九项失败分别补齐有效 PASS；只读文档编译 88 blocks、网站构建与 5862 片段引用通过。后续仅对新增验收清单及最终修改补相关检查。
- [ ] 完成最后 review，并核对统一清单的手动选型优先级、服务地址/模型配置真实链路等新明确的证据缺口。
- [x] Harness Conventional Commit，取得并推送 clean SHA；Frontend release workflow 已固定该 SHA。
- [x] Frontend Conventional Commit / push；完成真实 unsigned 目录包及 runtime 验收。
- [x] Electron 隔离环境正常启动与 Safe Mode 实测；原生 200% 缩放和签名/公证发布仍未完成。Frontend 完整 `npm test` 为 179 files / 1577 tests，通过的 typecheck/build/package 不能替代尚未完成的发布签名验收。
- [ ] 按授权 push / PR / 最终合 main；push 前遵循 pre-push skill，Ruff check . 与 format --check . 必须有覆盖最终变更的通过记录。不得覆盖主目录用户 WIP。

## 分支/部署状态

Harness worktree：`/Users/gumpm5/Documents/Code/APUS-Reflex-Harness/.Codex/worktrees/feat-reflex-control`，分支 `feat-reflex-control`，已推送且当前有 acceptance/evidence/handoff 文档改动待提交。Frontend 位于 `/Users/gumpm5/Documents/Code/APUS-Reflex-Frontend/.Codex/worktrees/feat-reflex-control`，同名分支已推送，当前只有证据截图和 handoff 文档改动待提交；其 `.github/workflows/release.yml` 已固定该 Harness revision。Frontend 本地 manifest 为 `sourceDirty=false` 的已部署包才算正式 runtime 证据。

Host16 完整通过并完成本轮 SDK/浏览器验收。Host17 已由 root 收集 exit0，session 22268，日志 `/private/tmp/reflex-control-host17.log`。Client11 / Web11 通过。C-06 real7 已完成且无活动模型进程；literal 诊断失败记录已落盘。所有 Web server7–16 已停止；以后新启动使用新编号并保留独立日志。

浏览器隔离 home 为 `/private/tmp/reflex-ux-acceptance/home`，workspace 为同目录 `workspace`；专用 `launch.mjs` 和 `browse.sh`，不要接管其他会话浏览器。最新通过 Session 为 `session-23def194-ec8f-4440-a71a-5f19536615ac`。当前浏览器 tab 可能指向已停止服务，不能凭页面残留判断服务仍运行。测试 workspace 显式准入 public + workspace，没有修改用户全局隐私策略。

## 冷启动 checklist

1. 先读[测试验收目标清单](../../docs/feat-reflex-control/acceptance-checklist.zh.md)、本文件、[files.md](files.md)和 `tasks/todo.md` 最新 Review，再读未完成目标对应设计与证据。
2. 查看 git status / 分支 / worktree / agents，以及 Host17 日志和运行进程；由 root 统一分配构建与 built 验收窗口，不重复启动。
3. 确认 supervision agent 的 native literal unittest 诊断结果；在真实 semantic 闭环成功前保持本项未完成。不能把 Host16 的无偏航完成当通过。
4. 需要核对上下文时直接看最终 browser v3 和 SDK 日志，同时保留 v2 与 attempt1 失败证据。按行指后续请求中的省略，原文仍在；不是编辑 Codex 私有上下文。
5. 当前分工：root 负责集成、真实浏览器、发布和最终合并；supervision_design 负责 native target 诊断/真实 semantic；settings 负责配置/文档相关门禁；context 的最终 SDK 和证据文档已完成。
6. 最后收口 clean SHA pin、正式包、Electron 正常/safe mode；先核对遗漏验收，不重复已通过且未变的检查。凭据不入日志/文件/commit。

## 2026-10-10 收尾记录

- [x] C-06 真实配对第三次执行：三个独立 headless CLI 进程、四条件、12 轮，真实 `remove` 投影与恢复事实均通过；原始报告仅留 `/private/tmp/reflex-cache-c06-real7`，提交物为脱敏摘要。
- [x] F-01 Web 配置跨 server 进程复验：保存 low、重启仍为 low、真实请求采用 low，最后恢复 high；凭据和 endpoint 不写入证据。
- [x] 监控 UI 加入 observing 状态与有界执行时间线，新人工消息清除陈旧的 recovery/supervision/context 状态；焦点组件与 projection 测试通过。
- [ ] 真实 Codex 语义偏航 → Reflex realign → 消费 → verification-target → improved 闭环仍未通过，保留 Host19 失败证据，不降低阈值。
- [ ] 完成 Harness / Frontend 最终构建、Electron 正常和 safe mode、版本 pin、Ruff 双检查、提交、push、PR/main 合并和远端回读。

## 2026-10-11 Snapshot 回归复核

- [x] System3、Codex evidence/verification、Reflex 设置页及相关 Jev、Session、计量、上下文回归共 97 个测试文件、1876 项通过。
- [x] TypeScript SDK 的 `system3-entry-route` 与 `system3-shadow`、Python SDK 同名 replay 均通过；期望记录已与动态 effort 和新选路提示同步。
- [x] 完整 keyless snapshot 串行回放通过：4 个测试文件、185 项通过、2 项跳过；完整 headless 文件串行回放通过：1 个文件、132 项通过、2 项跳过。
- [x] 修复 Node 22 同步 loader 对 browser-use fixture 的兼容问题：外部 TS fixture 转为 data URL，保留 `zod` 的包内 file URL 和相对 fixture 导入；对应 browser snapshot 与 loader 回归通过，未留下生成目录。
- [ ] 默认并发 snapshot 曾出现 `subagent-list-agents` 120 秒资源争用超时；串行重跑通过，尚未把并发 lane 标为稳定通过。
- [ ] 以上均为确定性/回放层证据；真实 Codex 语义偏航闭环、最终签名/公证 Electron 包及两仓 PR/main 状态仍按前述清单保持未完成。
## 2026-10-11 开源发布与品牌收口

- [x] 专家 HTML 新增开源 P0/P1 门禁：许可证/归属、安全边界、可复现 CI、公开能力声明、新用户上手、贡献者维护、传播材料可信度。
- [x] Harness 新增 `SECURITY.md` 并在中英文 README 提供私密漏洞报告入口；保留 MIT/NOTICE 和 DSH 技术归属。
- [x] Frontend 新增 `SECURITY.md`、`CONTRIBUTING.md` 和 PR 证据模板；用户可见主品牌仍为 APUS Reflex Harness。
- [x] 明确 DSH 发行版本归属只出现在技术/法律/关于页位置，不进入产品主标题、用户入口或任务状态文案。
- [ ] Harness Jev/System3 与 Frontend 测试 CI 完成后回读；真实语义监督闭环、正式包许可随附、签名/公证、原生 200% 与 main 合并仍未完成。
## 2026-10-11 Host20 真实语义闭环

- [x] 真实 E2E 单次运行通过：`pnpm exec vitest run --config vitest.e2e.config.ts packages/experimental/system3/tests/reflex-supervision.e2e.ts -t 'realigns a persistent delegated marketing detour'`。
- [x] Host20 证据记录一次 stale fence 后重新判断、`realign accepted`、Codex 原生消费、纠偏后财务动作、`finance/test_remaining.py` structured verification-target、独立 `1137.41` 校验和 `improved`。
- [x] 修复 E2E relay 正常请求误 abort 与默认自动重试；真实测试现在请求/响应清理可达 quiescence，`retry: 0`。
- [x] 反馈判断保留未改善调整，只有新证据才复核；117 项监督回归和 TS/Python 语义 snapshot 通过。
- [ ] 健康长任务无误干预、用户中途改 Goal、R-04 1 秒 p50/p95、Electron 原生 200%/签名/公证与两仓 main 合并仍未完成。
## 2026-10-11 R-04 路由延迟评测

- [x] 真实 Jev 评测器改为优先读取 `JEV_ENDPOINT`、`JEV_MODEL`、`SYSTEM3_ENTRY_MIN_CONFIDENCE`，兼容 profile YAML 回退；修复当前部署 overlay 不在旧 regex 中导致的假失败。
- [x] two-tier 50 题 route decision p50/p95=309/588ms；four-tier 30 题 p50/p95=317/405ms；无传输失败。证据见 `docs/feat-reflex-control/evidence/entry-routing-eval-v2.{json,md,zh.md}`。
- [x] 本地 admission/status 与首个用户回显已测量；队列状态 16ms，正常/6× CPU 回显矩阵 p95 为 82.275/523.978ms。远端首字节、完整回答耗时和用户可见失败回退仍待 R-04 完整验收。
## 2026-10-11 CI 回读

- Harness PR #1 当前分支的 Jev/System3 job 与两次 rerun 均在 runner 分配前失败（`runner_id=0`、0 steps、约 3 秒），未执行代码测试；不能归因源码。
- Frontend PR #1 的 `test` 已通过；最新 release workflow 旧 run 的 Validate dispatch job 同样在 runner 分配前失败，Windows/macOS job 未启动。
- 两个 PR 仍为 Draft，GitHub 状态 `MERGEABLE` 但 `UNSTABLE`；不得在 required checks 未恢复前合并 main。

## 2026-10-11 轻量监督与 Electron 系统缩放

- 用户明确 Codex 过程监控不要复杂化；后续只沿有界证据、异常判断、有界调整和结果复核收口，不增加全轨迹分析或评分平台。经验已写入 `tasks/lessons.md`。
- 两次健康 Codex 对照在 150 秒取消预算处 `aborted`，零自动 steer；字面量 relay 记录上游请求零首字节。该事实不构成健康长任务完整通过，脱敏记录见 `docs/feat-reflex-control/evidence/healthy-codex-20261011.*`。
- Frontend `feat-reflex-control` 已推送，加入真实 Electron 恢复界面 200% 系统缩放门禁。四 scale 共 160 变体通过（scale 2 为 40 变体），typecheck 与完整 179 files / 1577 tests 通过。
- 系统界面 scale 2 不等于应用内页面 zoom factor 2；页面级 200%、正式签名/公证、会话/启动失败恢复仍待验收，不能将此 smoke 写成最终包完整通过。

## 2026-10-11 R-04 本地首反馈

- [x] 真实 Playwright 队列场景在挂起第一轮时提交第二条输入；本地 `Sending…` admission/status 实测 16ms，低于 1000ms，输入框清空且保持可编辑。证据见 `docs/feat-reflex-control/evidence/r04-admission-status-queue.*`。
- [x] 修正 writer-held Web 快照里的旧 DSH 产品文案，保持真实上游归属不变。
- [ ] R-04 的远端首字节、完整回答时延和用户可见失败回退仍未测量；16ms 不能外推为模型响应时间。
- [x] 新增本地回显性能矩阵：真实 Playwright、短/业务/长中文输入，正常 CPU p50/p95/max 为 57.779/82.275/82.275ms，6× CPU throttle 为 373.555/523.978/523.978ms，均低于 1,000ms。证据见 `docs/feat-reflex-control/evidence/r04-local-echo-perf.*`。

## 2026-10-11 Electron 包审计

- [x] 直接产物审计确认 `APUS Reflex Harness` 品牌、Info.plist 标题，以及四个 MIT/NOTICE 文件逐字节保留；可关闭未签名目录包的许可证/品牌保留项。
- [ ] 该目录包 runtime manifest 仍固定旧 Harness revision，未包含当前监督修复；需要用当前 clean revision 重建再验收。
- [ ] 本机没有有效 Developer ID 身份或公证票据；签名、公证、staple 必须在具备 Apple CI secrets/runner 的环境完成。
