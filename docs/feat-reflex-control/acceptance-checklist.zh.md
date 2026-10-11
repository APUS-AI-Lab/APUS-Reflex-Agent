# APUS Reflex Harness 测试验收目标清单

[English](acceptance-checklist.md) | 中文

## 概述

本清单是 `feat-reflex-control` 的需求与验收总入口，供产品验收、开发收尾和下一会话交接使用。核对日期为 2026-10-11；结果对应已推送的 Harness 与 Frontend `feat-reflex-control` 修订，不代表 main 或已签名/公证发布版。已有设计、源码和试验记录各自保留职责，本页统一定义“达到什么结果才能勾选完成”，不复制底层报告。

当前结论：入口与配置的代表性真实场景、Harness 按行裁剪及重启恢复、受控原生静默恢复、狭义受控重复失败流程、Host20 受控语义偏航纠偏、C-06 四条件真实跨进程配对，以及未签名 macOS arm64 Electron 目录包的配置流程已有通过证据。健康长任务误干预对照、中途追加要求、页面级 200% 缩放、签名/公证发布和合并仍未完成；Electron 恢复界面 200% 系统缩放矩阵已有单独证据。不能将全部三项核心能力标为已验收。

## 目录

- [需求与设计对应](#acceptance-design)
- [判定规则](#acceptance-rules)
- [逐项验收](#acceptance-cases)
- [完整用户流程](#acceptance-journeys)
- [证据记录与执行顺序](#acceptance-evidence)
- [发布完成条件](#acceptance-release)

<a id="acceptance-design"></a>

## 需求与设计对应

现有方案分别负责能力设计、缓存约束和恢复规则。本清单负责验收状态，后续状态更新优先改本页，再由交接文档链接。

| 用户目标 | 设计依据 | 验收编号 |
| --- | --- | --- |
| 根据问题自动选择模型或 agent | [完整方案](reflex-complete-design.html)、[Goal 入口方案](goal-routing-design.html) | R-01～R-04 |
| 观察 Codex 长任务并自动纠偏，确认调整有效 | [语义监督](supervision-semantic-design.zh.md)、[原生恢复](recovery-addendum.zh.md)、[验证目标识别](verification-target-design.zh.md) | S-01～S-09 |
| 按行或片段移出无关上下文，按需恢复事实 | [上下文实现](reflex-context-implementation.zh.md)、[缓存保护设计](context-cache-design.zh.md) | C-01～C-07 |
| 专用 Reflex 模型配置页，设置实际生效 | [配置页方案](reflex-settings-proposal.html) | F-01～F-03 |
| APUS 品牌、MIT 与两仓最终交付 | [品牌规则](../../BRAND_GUIDELINES.zh.md)、[工作树交接](../../tasks/feat-reflex-control/handoff.md) | D-01～D-04 |
| 用户能理解、操作并控制整个任务过程 | 本页 UI/UX 用户体验验收；共享设置与任务界面的真实操作证据 | UX-01～UX-10 |

<a id="acceptance-rules"></a>

## 判定规则

状态按证据分层：“真实通过”只覆盖列出的真实场景；“回归通过”指确定性单测或受控 SDK 回放，不等于真实模型通过；“未通过”表示试验执行后未满足标准；“待测”表示缺少对应证据。一次成功不代表普遍可靠性，也不抹去早前失败。

P0 是本轮功能完整交付的必需项；P1 是性能或推广范围的验收项，在通过前不得作对应效果承诺。确定性竞态和错误分支可以通过回归验收，但三项核心能力的完整流程必须另有真实模型与用户入口证据。没有约定的性能指标不能事后根据结果反推“达标”。

<a id="acceptance-cases"></a>

## 逐项验收

以下每行同时给出用户场景、通过标准和当前证据。表中“回归通过；真实待测”仍保持未完成。

### 用户入口路由

| ID / 级别 | 场景与通过标准 | 当前证据与缺口 |
| --- | --- | --- |
| R-01 / P0 | 用户问“0.10 元加 0.20 元是多少”；Reflex 先判断，实际生成请求使用选定模型，用户得到 0.30 元。 | 真实通过；[路由记录](evidence/browser-progress.json)的 routing 部分与[截图](evidence/reflex-ux-routing.png)。该旧报告其他部分由本页所引新证据替代。 |
| R-02 / P0 | 用户设置 Goal 并要求 Codex 为账龄工具增加 JSON 输出；首轮自动委派，原 CSV 不变，新增结果及已有行为通过独立验证。 | 真实浏览器通过；[独立报告](evidence/browser-goal-json-independent.json)、[10 项测试](evidence/browser-goal-json-tests.log)、[完成截图](evidence/reflex-goal-json-completed.png)。 |
| R-03 / P0 | 模型判断失败、弃权或无可用候选时执行配置的失败处理，不越权切换、不丢输入；明确用户手动选型与自动路由的优先级，并验证实际行为。 | [控制器手动选型保护](../../packages/api/session-controller/tests/prompt-router.host.spec.ts)、[入口](../../packages/experimental/system3/tests/entry-routing.spec.ts)与[Goal 回归](../../packages/experimental/system3/tests/goal-entry-routing.spec.ts)合计93项通过；[真实浏览器路由记录](evidence/browser-manual-routing.json)也通过固定模型、恢复自动、手动优先及对应请求完成。可见失败/无候选路径仍待测；该记录来自 dirty 开发构建。 |
| R-04 / P1 | 固定简单、复杂、含糊及明确委派题集，对比自动路由与固定模型，记录正确性、入口额外延迟、首个可见输出及总耗时。 | [本地 admission/status](evidence/r04-admission-status-queue.zh.md)在真实 Playwright 队列场景中以 16ms 通过；[本地用户回显性能](evidence/r04-local-echo-perf.zh.md)在短题、业务题、长文本及正常/6 倍 CPU 降速下均低于 1,000ms；[真实 Jev v2 评测](evidence/entry-routing-eval-v2.zh.md)报告路由决策 p50/p95：two-tier 50 题为 309/588ms，four-tier 30 题为 317/405ms，没有传输失败。远端首字节、完整回答耗时和用户可见回退仍待测。 |

### 长时 Goal 监督与纠偏

| ID / 级别 | 场景与通过标准 | 当前证据与缺口 |
| --- | --- | --- |
| S-01 / P0 | Codex 连续失败或重复无效操作；Reflex 观察到足够证据后提出调整，Codex 实际消费，执行有效修复与相关验证，正常完成。 | 狭义受控真实重复失败流程已通过：[脱敏证据](evidence/supervision-real-repeated-failure.zh.md)记录三次失败验证操作、带来源的调整、脱敏原生输入生命周期事件、后续诊断/文件变更/验证证据、受保护文件哈希与正常完成。这是 `semantic=false` 且阈值不是发布默认值的受控场景；语义偏航仍待验收，此前 aborted 的 steer 试验保留于[监督验证](supervision-validation.zh.md)。 |
| S-02 / P0 | 长时间无新进展时进行观察；同一份无变化证据不持续付费重判，有新证据后可再判断，正常耗时任务不因时间长直接判错。 | [监督回归](../../packages/experimental/system3/tests/reflex-supervision.spec.ts)通过；[最新真实对照](evidence/healthy-codex-20261011.zh.md)在 150 秒预算取消且零 steer，字面量 relay 无首字节。不能算完整通过，默认部署健康长任务对照仍待测。 |
| S-03 / P0 | 原生请求静默且无待定副作用或审批；Reflex 授权中断，确认 interrupted 终态，再于原线程续跑，最终 completed 且独立验收通过。 | 受控真实通过，127.41 秒；[v4 报告](evidence/native-recovery-real-v4.json)。实际取消预算 180 秒，报告遗留的 150 秒字段不适用于此场景，说明见[监督验收](supervision-validation.zh.md)。不代表不可控生产故障均能恢复。 |
| S-04 / P0 | 财务 Goal 下持续修改无关营销材料；即使每次操作成功，Reflex 仍识别持续偏航并让 Codex 回到财务任务；相关调查和证据不足时不误纠偏。 | [Host20 受控真实试验](evidence/semantic-codex-host20-persistent.zh.md)记录了 stale fence、接受回正、消费后的财务操作和独立完成。历史失败保留在 [Host16](evidence/semantic-codex-host16.zh.md) 与 [Host19](evidence/semantic-codex-host19-persistent.zh.md)；健康长任务与中途修改 Goal 仍单独验收。 |
| S-05 / P0 | 自动建议可追踪来源；分别记录决定、投递 ACK、原生 Codex 输入消费；消费后有新执行证据。 | 受控重复失败报告记录了独立的 Reflex judgement、`accepted`、带来源的 `subagent/supervision-steer`、脱敏的原生 `item/started` 与 `item/completed` 生命周期事件，以及调整后的诊断/文件变更证据，见[证据](evidence/supervision-real-repeated-failure.zh.md)。这满足该受控场景的接收/消费要求；语义偏航仍需要独立完整流程。 |
| S-06 / P0 | 调整后运行与 Goal 相关的成功验证；收集真实 verification-target，再由 Reflex 评估改善；读取测试文件、echo 测试名或无关测试不得算改善。 | [Host20](evidence/semantic-codex-host20-persistent.zh.md) 包含成功的结构化 `verification-target` `finance/test_remaining.py`、独立 `1137.41` 校验和 `improved`。受控重复失败报告仍是没有结构化 target 的独立证据。 |
| S-07 / P0 | 执行中用户追加中文列名与兼容性要求，或修改/取消 Goal；旧判断、排队调整和迟到 ACK 不得覆盖新意图，预算与冷却限制在重启后仍有效。 | 人工优先、版本与迟到 ACK [回归通过](../../packages/experimental/system3/tests/reflex-supervision.spec.ts)；带最终产物的真实用户中途改需求流程待测。 |
| S-08 / P0 | 未准许工作区数据外发时只使用获准证据；不把原始命令、输出、代码差异或思考内容送到 Reflex；回执未知不盲目重复副作用。 | [采集回归](../../packages/subagent/subagent-codex/tests/evidence-summary.spec.ts)与[监督回归](../../packages/experimental/system3/tests/reflex-supervision.spec.ts)通过；以权限拒绝和数据检查为验收，不要求真实泄露。 |
| S-09 / P0 | 使用实际发布配置完成 S-01～S-06，报告观察窗口、恢复阈值、模型和 effort；证据不完整时保持保守。 | Host20 使用语义部署参数（`intervalMs=15000`、`stallMs=180000`、`feedbackMs=60000`、`maxInterventions=3`，Codex relay 的 `effort=low`），完成受控 S-04/S-06 链路。健康长任务无误干预对照和中途修改 Goal 仍待测。 |

### 动态上下文、记忆与 cache

| ID / 级别 | 场景与通过标准 | 当前证据与缺口 |
| --- | --- | --- |
| C-01 / P0 | 同轮分别读取六份材料；移出无关旧旅行行，保留发票与回款数值、精度和原文件约束；结果为 1137.41 元，恰好六次 read。 | [Host16 浏览器真实通过](evidence/browser-context-v3.json)，无多余记忆调用；早前误删与多余检索失败保留于[汇总](evidence/context-semantic-validation.zh.md)。 |
| C-02 / P0 | 对长行、Unicode、多文本块及混合删除/恢复准确定位；不损坏字符、结构化内容或工具调用与结果配对；原文可追溯。 | [上下文回归](../../packages/experimental/system3/tests/reflex-context.spec.ts)通过；真实 E2E 已证明普通行选择，不代表所有文档格式均已实测。 |
| C-03 / P0 | 完整退出 Host 后重新打开同一会话，询问已移出旅行的旅馆、早餐、时间、地点；首个主模型请求前自动恢复，无重读文件或联网。 | [真实通过](evidence/browser-context-v3.json)：回答四项事实，零工具调用，原文件哈希与旧 44 条事件不变；[截图](evidence/reflex-context-v3-restored.png)。 |
| C-04 / P0 | 已提交前缀及模型生成内容保持不变；失败、取消或重启不解冻；只编辑未发送尾部，已冻结信息的恢复追加末尾。 | Host16 真实流程与 [TypeScript](../../snapshots/sdk/reflex-context/) / [Python](../../scripts/snapshots/python-sdk-single-exe/reflex-context/) 回放通过；没有精确供应商缓存边界时冻结整个已提交前缀。 |
| C-05 / P0 | 用户切换话题时重新判断相关性，同时保留未撤销的权限、精度等约束；保护最近 4 条消息，无候选或预算不足时安全跳过；重复恢复去重。 | [回归及有限真实 v3 探针通过](evidence/context-v3-priority-validation.zh.md)。单个最新工具结果可能完全不裁剪，这是保护行为；不能宣称每轮必省 tokens。 |
| C-06 / P1 | 相同模型、effort、工具与匹配任务下比较开关裁剪，覆盖冷热缓存、恢复和路由切换，记录 provider cache 用量、Reflex 开销、总成本和延迟。 | 真实跨进程配对通过；[脱敏报告](evidence/cache-c06-real.zh.md)覆盖四条件、12 轮、三进程 Session 恢复、输入/持久前缀/请求前缀/路由/工具和真实 `remove` 投影。供应商未提供冷缓存隔离，`coldCacheGuaranteed=false`、价格未知，尚不能宣称 cache 命中率或成本收益，也未覆盖 Anthropic/OpenAI。 |
| C-07 / 范围限制 | 明确管理对象及存储含义。 | 已确认：裁剪的是 Harness 后续请求，原会话日志保留；未管理 Codex 私有内部上下文，未实现跨全部会话的统一记忆或无限物理历史。这些不属于可勾选的现有能力。 |

### Reflex 模型配置

| ID / 级别 | 场景与通过标准 | 当前证据与缺口 |
| --- | --- | --- |
| F-01 / P0 | 用户打开专用“Reflex 模型配置”页，编辑服务、模型与 effort，测试连接并保存；刷新和完整重启后仍保留，真实判断使用保存值。 | 真实通过；[F-01 脱敏报告](evidence/reflex-settings-real.zh.md)证实规范模型连接判断、无效模型预期失败、low 保存、跨进程重启后仍为 low、真实请求采用 low，随后恢复部署默认 high。 |
| F-02 / P0 | 错误 key 或无效配置显式报错，不覆盖已保存的有效配置；UI 和证据不回显秘密。 | [真实错误凭据截图](evidence/reflex-ux-settings-rejected-key.png)及配置回归通过；不把“测试连接成功”当任务执行成功。 |
| F-03 / P0 | 最终 Electron 包在独立用户目录保存配置，退出后重启；safe mode 可启动，正常模式恢复原设置，用户已有配置不丢失。 | Frontend `feat-reflex-control` 的未签名 macOS arm64 目录包通过正常启动、Reflex 配置保存/重启、Safe Mode、正常模式恢复、服务/模型保留和不显示密钥；恢复界面 200% 系统缩放 40 变体通过；[包审计](evidence/electron-package-license-audit.zh.md)确认品牌与 MIT/NOTICE 保留；当前 runtime 修订一致性、签名/公证和页面级 200% 缩放仍待测。 |

### 品牌、许可与交付

| ID / 级别 | 场景与通过标准 | 当前证据与缺口 |
| --- | --- | --- |
| D-01 / P0 | 用户可见品牌为 APUS Reflex Harness，配置页称 Reflex；MIT 原版权、许可和上游致谢随产物保留。 | 上一批品牌已合 main；本批 324 个 Harness 包 MIT 与第三方通知检查通过。未签名 Electron 目录包已直接通过品牌与四个 MIT/NOTICE 文件逐字节比对，见[包审计](evidence/electron-package-license-audit.zh.md)；当前 runtime 一致性和签名/公证产物仍归入 F-03。 |
| D-02 / P0 | 模型可见输入、自动纠偏、上下文投影和恢复均可从日志重建；TypeScript/Python 消费同一事件，历史格式不被覆盖。 | 定向回归、持久化检查及 Goal、监督、恢复、上下文的双 SDK 录制/独立回放通过；外部模型夹具不算真实模型 E2E。 |
| D-03 / P0 | 后端提交形成干净版本，前端固定该版本；生成真实运行包，manifest 无 dirty 标记，实际启动与配置链路通过。 | Harness 与 Frontend `feat-reflex-control` 修订均已提交并推送；发布 workflow 固定该 Harness 修订，部署 manifest 报告匹配的干净源码且 `sourceDirty=false`，未签名目录包的启动/配置流程通过。 |
| D-04 / P0 | 必需检查通过、独立审查无未解决阻断、PR 按授权合并两仓 main；回读远端与 CI，并保留交接。 | 进行中；相关构建、lint、Ruff、文档和包检查已有通过记录，真实闭环与正式包仍阻断完整交付。CI 未运行或仍排队都不算通过。 |

### UI/UX 用户体验

从用户可见入口实际操作，不从内部 API 绕过交互。真实模型任务与受控错误/状态回放分别标记；后者可验证难以稳定制造的异常提示，但不能替代核心任务的真实流程。当前验收平台为 macOS arm64 的浏览器及最终 Electron 包；其他操作系统不宣称已实测。

| ID / 级别 | 场景与通过标准 | 当前证据与缺口 |
| --- | --- | --- |
| UX-01 / P0 | 首次启动找到工作区、对话与 Reflex 配置；未配置/无记录时有明确下一步，不出现无解释空白、开发术语或假成功。 | 待完成首次使用与空状态操作证据。 |
| UX-02 / P0 | 配置字段含清楚标签与说明；无效地址、effort、超时可定位到具体字段；测试、保存、等待、成功/失败可区分，错误不丢已保存配置或泄露凭据。 | 字段错误关联与 Escape 已实测；服务/模型实际生效、全部反馈和保存后重启仍需完整复验。 |
| UX-03 / P0 | 自动/固定模型状态明确；路由建议、实际采用、最终响应不混淆；手动切换、恢复自动和失败回退的界面与真实请求一致。 | [真实浏览器路由记录](evidence/browser-manual-routing.json)通过固定模型、恢复自动、手动优先及实际请求一致性。失败回退和最终 Electron 复验仍待测。 |
| UX-04 / P0 | 长任务展示当前阶段、已用时间和最近有效进展；无进展、等待审批与正常工作可区分，不持续重复提示，不因子任务结束提前显示整个 Goal 完成。 | 组件回归已覆盖 Reflex “正在观察”状态与受限时间线；真实长任务与受控无进展状态仍待最终 Electron 包验收。 |
| UX-05 / P0 | 用户能找到补充要求、停止/取消及继续等待；发送反馈明确，无意重复提交被防止；最终任务遵守追加要求，已停止任务不继续悄悄工作。 | 组件回归存在，真实操作与最终成果联动待测；对应 S-07。 |
| UX-06 / P0 | 分清正在判断、发送建议、已接收待验证、送达未知、恢复中及改善已验证；未知回执不显示为模型未决定或任务成功。 | 组件回归与投影检查通过；监控卡新增“Reflex 正在观察”提示和最近 12 条无内容时间线，用户新消息会清除陈旧改善状态。最终新构建真实界面复验仍待完成。 |
| UX-07 / P0 | 上下文移出与恢复提示说明原文可恢复；相关信息恢复后能回答，避免“已永久删除”或“无限上下文”误导，过程不遮挡输入和答案。 | 后端真实恢复与跨进程 C-06 已过；UI 的可恢复提示和时间线已加入并有组件回归，最终包的对话可读性仍待专项核对。 |
| UX-08 / P0 | 网络/凭据错误、超时、断开与重启有可理解的说明和恢复路径；保留用户输入和已有内容，不要求用户读原始日志才能继续。 | 待有限错误场景与重启体验验收。 |
| UX-09 / P0 | 375/768/1280 宽度、明暗主题、200% 缩放下，关键字段与按钮可用、无横向页面溢出或遮挡；键盘顺序、可见焦点、Escape 与焦点返回正确，弹层适应边缘。 | [初测证据](evidence/uiux/before.json)保留375px侧栏挤压输入到约59px的失败。[构建后复验](evidence/uiux/after.json)已通过375/768/1280明暗矩阵、键盘遍历、字段错误关联、Escape、焦点返回及清理历史缓冲后的零控制台错误；Frontend 的真实 Electron 恢复界面 200% 系统缩放矩阵通过；页面级 200% 缩放仍待测。 |
| UX-10 / P0 | 最终 Electron 正常/安全模式、关闭/重开、设置及会话恢复可用；品牌与标题一致，窗口边框不遮挡控制；启动失败可恢复且不留下本轮拥有的后台进程。 | 未签名 arm64 包已通过正常/Safe Mode 启动、关闭重开、配置恢复、APUS Reflex 品牌一致性和进程清理；恢复界面 200% 系统缩放已通过；会话恢复、启动失败恢复和页面级 200% 缩放仍待测。 |

<a id="acceptance-journeys"></a>

## 完整用户流程

分项测试之外，以下流程决定是否能向用户宣布完整交付。原始输入和独立验证脚本预先固定，验收过程中不得放宽结果标准。

- [x] 浏览器配置 Reflex → 保存 low → 完整重启 → 实际请求采用 low → 恢复部署默认 high。对应 F-01，证据见 `evidence/reflex-settings-real.zh.md`。
- [x] 用户提交账龄 JSON Goal → 首轮委派 Codex → 正常完成 → 10 项测试与独立金额核对。对应 R-02。
- [x] 财务核对中移出旧旅行行 → 结果 1137.41 → 三个独立 CLI 进程跨进程恢复 → 追问旧旅行 → 自动恢复且输入/持久前缀不变。对应 C-01、C-03、C-04、C-06。
- [x] 受控挂起原生请求 → Reflex 授权恢复 → 确认中断 → 同线程续跑 → 正常终态与独立成果验证。对应 S-03，明确使用故障注入。
- [ ] 重复失败 → Codex 消费自动建议 → 相关结构化 verification-target 成功 → Reflex 确认改善 → 正常完成。狭义故障流程的修复、产物和原生输入接收通过；S-06 目标证据仍未完成。
- [ ] 成功但偏离 Goal 的工作 → Reflex 识别 → Codex 回正 → 完整真实验证和改善反馈；再用部署默认窗口复验。对应 S-04～S-06、S-09。
- [ ] 用户中途追加要求 → 陈旧纠偏失效 → 最终成果满足新要求与兼容性。对应 S-07。
- [ ] 最终干净 Electron 包 → 正常及 safe mode → 配置持久化 → 代表性路由、Goal、上下文流程 → 两仓 main。对应 F-03、D-01、D-03、D-04。
- [ ] 首次用户打开应用 → 找到工作区与配置 → 理解自动/固定模式 → 提问并识别实际完成状态。对应 UX-01～UX-03。
- [ ] 长任务等待 → 查看进展/纠偏/恢复 → 追加要求或停止 → 核对提示与真实任务结果。对应 UX-04～UX-06。
- [ ] 错误配置或连接中断 → 理解错误并恢复 → 保留已有输入/设置 → 重启后继续使用。对应 UX-02、UX-08、UX-10。
- [ ] 窄屏与200%缩放、明暗主题、仅键盘完成关键流程 → 结果和恢复提示仍清晰可读。对应 UX-07、UX-09。

<a id="acceptance-evidence"></a>

## 证据记录与执行顺序

每次真实试验记录 case ID、日期、源码/产物身份及 dirty 状态、实际模型与 effort、配置差异、原始用户输入、正常或注入场景、session/run/decision 对应关系、时序、最终状态、独立产物检查和失败原因。秘密与思考内容不得写入验收包。性能缺失字段保持未知；保留全部有限试验，禁止无限重试到成功后只展示成功样本。

S-06 的无内容修改传输观测已完成：两次实际响应首字节约26秒与25秒，原生命令与独立验证通过。Host20 新增受控真实纠偏证据：接受回正、原生消费、结构化 `verification-target`、独立 `1137.41` 校验和 `improved`。此前语义失败记录继续保留。不要在真实验收期间并行安装依赖、构建或重写运行产物。

功能闭环通过后形成后端干净版本，再固定前端版本并执行 F-03/D-03 与最终 UI/UX 流程，最后审查与合并。P1 基准采用预先固定的有限配对场景，在取得证据前只报告观察值。用户已授权完整测试与 UI/UX 验收；文档检查不算产品场景通过。

<a id="acceptance-release"></a>

## 发布完成条件

- [ ] 所有 P0 行的缺口关闭，且上面的完整用户流程全部满足；分支实现不能代替正式包验收。
- [ ] 每条完成状态能打开对应证据，证据对应实际交付版本；历史失败保留，原因和修复后的验证可区分。
- [ ] 相关构建、lint、行为回归、双 SDK、持久化和文档检查覆盖最终差异；每次 push 前 Ruff 双检查符合项目要求。
- [ ] 两仓 PR/main 与前端运行包的版本对应，远端检查和实际启动结果明确；交接给出未纳入本次的 P1 与范围限制。

## 开发备注

本页是当前工作树的验收记录，不是对所有模型、平台和任务的可靠性保证。实现细节以链接的设计与源码为准；测试日志详情以相应证据文件为准。
