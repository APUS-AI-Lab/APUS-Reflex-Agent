# feat-jev-decision-kernel 接管交接

## TL;DR

- 2026-10-08 Codex 已继承 Claude 主线、发布基线与 WIP；两个已批准 P0 为完成核验及模型线路监控。
- 当前 worktree `.claude/worktrees/feat-jev-decision-kernel`，分支 `worktree-feat-jev-decision-kernel`；主目录 main 保持干净，未同步或部署。
- prd 已在线完成云盘后的分区与 ext4 扩展，最终检查 984G / 156G 可用 / 84%，服务 active，无重启。
- 完成核验补齐持久化及两 SDK；三项状态隔离问题已修，System3 包243项回归、完成核验/任务卡/内核三源码100%覆盖、真实 DeepSeek + Jev E2E 2/2 通过。
- 新增 mu P0 审查、14 项招牌 + 8 组原生能力 + 3 个候选验收矩阵；新候选尚待具体设计确认。当前本地 built Web 完成核验浏览器闭环已通过；生产升级、专用依据 UI 及独立 Jev 评测仍未收口，部署 WIP 保持 shadow。

## 本轮交付物

以下包括继承后收口的 WIP 与本轮新增文件；行数为完整文件，不是增量。handoff 本身的行数为生成前值。

| 文件 | 行数或大小 | 说明 |
|---|---:|---|
| `.github/workflows/independent-harness.yml` | 64 | CI中双SDK核验场景 |
| `deploy/system3/acceptance/accept.py` | 569 | 验收脚本或固定构建证据检查 |
| `deploy/system3/runtime.patch.yml` | 248 | 验收脚本或固定构建证据检查 |
| `docs/config-catalog.md` | 4841 | 源代码生成的配置/事件参考 |
| `docs/config-catalog.zh.md` | 4843 | 源代码生成的配置/事件参考 |
| `docs/event-producer-consumer.md` | 111 | 源代码生成的配置/事件参考 |
| `docs/event-producer-consumer.zh.md` | 113 | 源代码生成的配置/事件参考 |
| `docs/feat-jev-decision-kernel/architecture.html` | 213 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/completion-browser-result.json` | 349 | 当前built Web真实浏览器验收证据 |
| `docs/feat-jev-decision-kernel/completion-browser-session.jsonl` | 62 | 当前built Web真实浏览器验收证据 |
| `docs/feat-jev-decision-kernel/completion-browser.png` | 126907 bytes | 当前built Web真实浏览器验收证据 |
| `docs/feat-jev-decision-kernel/completion-continuation.html` | 22 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/completion-evaluation-history.json` | 432 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/completion-live-product-result-requirement.json` | 3734 | 真实主模型/Jev/原生工具及JSONL重开证据 |
| `docs/feat-jev-decision-kernel/completion-live-product-result.json` | 2928 | 真实主模型/Jev/原生工具及JSONL重开证据 |
| `docs/feat-jev-decision-kernel/feature-acceptance.html` | 50 | 14招牌、8原生组、3候选逐项验收排程 |
| `docs/feat-jev-decision-kernel/feature-acceptance.json` | 488 | 14招牌、8原生组、3候选逐项验收排程 |
| `docs/feat-jev-decision-kernel/model-integrity-design.html` | 130 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/mu-p0-review.html` | 37 | mu源码评审、P0排序及待确认设计v2 |
| `docs/feat-jev-decision-kernel/mu-p0-review.json` | 175 | mu源码评审、P0排序及待确认设计v2 |
| `docs/feat-jev-decision-kernel/relay-directory-status.json` | 50 | 三站只读目录审查，不含凭据 |
| `docs/feat-jev-decision-kernel/report.html` | 557 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/report-ceo-onepage.html` | 189 | CEO一页价值、大小脑架构与场景交付汇报 |
| `docs/feat-jev-decision-kernel/report-ceo-onepage.pdf` | 979509 bytes | 实际导出的A4单页，中文文字与架构可读 |
| `docs/feat-jev-decision-kernel/report-ceo-onepage-verification.json` | 62 | 三种宽度及PDF页面文字核对 |
| `docs/feat-jev-decision-kernel/tasks/task.i18n.yaml` | 40 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/tasks/task.md` | 109 | 架构/设计及配对任务更新 |
| `docs/feat-jev-decision-kernel/tasks/task.zh.md` | 109 | 架构/设计及配对任务更新 |
| `docs/persistence-catalog.i18n.yaml` | 2620 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-catalog.md` | 11103 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-catalog.zh.md` | 11105 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/2026-10-08-system3-completion-review.i18n.yaml` | 28 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/2026-10-08-system3-completion-review.md` | 48 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/2026-10-08-system3-completion-review.schema.json` | 133 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/2026-10-08-system3-completion-review.zh.md` | 48 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/historical-formats/README.i18n.yaml` | 28 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/historical-formats/README.md` | 75 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-changes/historical-formats/README.zh.md` | 75 | 新审计事件的持久化确认/生成物 |
| `docs/persistence-schema.json` | 115916 | 新审计事件的持久化确认/生成物 |
| `packages/core/session/src/known-event-types.ts` | 103 | 新审计事件的持久化确认/生成物 |
| `packages/experimental/system3/README.i18n.yaml` | 70 | 公开语义说明与双语配对 |
| `packages/experimental/system3/README.md` | 162 | 公开语义说明与双语配对 |
| `packages/experimental/system3/README.zh.md` | 162 | 公开语义说明与双语配对 |
| `packages/experimental/system3/package.json` | 79 | 真实FS/Goal测试的工作区依赖 |
| `packages/experimental/system3/src/completion-review.ts` | 253 | 完成核验接线与状态/取消隔离 |
| `packages/experimental/system3/src/decision-kernel.ts` | 171 | 完成核验接线与状态/取消隔离 |
| `packages/experimental/system3/src/index.ts` | 423 | 完成核验接线与状态/取消隔离 |
| `packages/experimental/system3/src/task-frame.ts` | 346 | 完成核验接线与状态/取消隔离 |
| `packages/experimental/system3/tests/completion-loader-composition.spec.ts` | 259 | 行为、配置、竞态及生命周期回归 |
| `packages/experimental/system3/tests/completion-product.e2e.ts` | 152 | 行为、配置、竞态及生命周期回归 |
| `packages/experimental/system3/tests/completion-review.e2e.ts` | 172 | 行为、配置、竞态及生命周期回归 |
| `packages/experimental/system3/tests/completion-review.spec.ts` | 624 | 行为、配置、竞态及生命周期回归 |
| `packages/experimental/system3/tests/decision-kernel.spec.ts` | 159 | 行为、配置、竞态及生命周期回归 |
| `packages/experimental/system3/tests/task-frame.spec.ts` | 580 | 行为、配置、竞态及生命周期回归 |
| `pnpm-lock.yaml` | 30509 | 真实FS/Goal测试的工作区依赖 |
| `scripts/smoke-python-runtime.py` | 4085 | 验收脚本或固定构建证据检查 |
| `scripts/snapshots/python-sdk-single-exe/system3-completion-review/model-visible.json` | 4109 | 双SDK/Session回放及owner-local期望输出 |
| `scripts/snapshots/python-sdk-single-exe/system3-completion-review/result.json` | 3318 | 双SDK/Session回放及owner-local期望输出 |
| `scripts/snapshots/python-sdk-single-exe/system3-completion-review/session.v4.jsonl` | 56 | 双SDK/Session回放及owner-local期望输出 |
| `scripts/verify-repository-references.spec.ts` | 228 | 行为、配置、竞态及生命周期回归 |
| `scripts/verify-repository-references.ts` | 125 | 验收脚本或固定构建证据检查 |
| `snapshots/sdk/sdk.snapshot.ts` | 1139 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/cordis.snapshot.yml` | 15 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/cordis.yml` | 32 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/notifications.expected.jsonl` | 56 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/replay.override.json` | 90 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/result.expected.json` | 1 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/session.v4.jsonl` | 58 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/snapshot.yml` | 12 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review-stale/workspace/completion-evidence.txt` | 1 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/cordis.snapshot.yml` | 15 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/cordis.yml` | 30 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/jev-fixture.mjs` | 78 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/notifications.expected.jsonl` | 54 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/replay.override.json` | 90 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/result.expected.json` | 1 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/session.v4.jsonl` | 56 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/snapshot.yml` | 11 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/system-prompt.expected.md` | 27 | 双SDK/Session回放及owner-local期望输出 |
| `snapshots/sdk/system3-completion-review/workspace/completion-evidence.txt` | 1 | 双SDK/Session回放及owner-local期望输出 |
| `tasks/feat-jev-decision-kernel/handoff.md` | 190 | 计划、经验与冷启动交接 |
| `tasks/feat-jev-decision-kernel/lessons.md` | 19 | 计划、经验与冷启动交接 |
| `tasks/feat-jev-decision-kernel/notes.md` | 19 | 计划、经验与冷启动交接 |
| `tasks/todo.md` | 313 | 计划、经验与冷启动交接 |

## 设计约束

- 产品是完整 APUS Reflex Harness：Jev 决策、System2 推理执行与 DSH 原生能力共同构成产品，产品和技术图都保留底座。
- 继续历史已批准的两个 P0。用户最新要求提前评审 mu 的执行前约束、普通任务续跑、语义卡住恢复；交付顺序与范围见 docs/feat-jev-decision-kernel/mu-p0-review.html 和 tasks/task.zh.md。
- 三个候选有文件、接口、状态、降级和真实正反例设计；具体设计确认后再实施。主模型、权限、取消与原生 goal 生命周期不能被 Jev 重写。
- 只用公开扩展点，不改 agent-loop；模型可见文本必须能从 Session 重建，新增持久事件同步声明、生成物与两 SDK。
- 每一项功能以完整实现和固定源码真实 E2E 为完成条件；keyless 回放与单元覆盖补充证据。要宣称界面可用，必须再验 shipped profile / 真实浏览器。
- report.html 保留用户指定的宣传定位。实际实现、证据与缺口由 feature-acceptance.html/json 逐项维护，不能把拟议能力说成已发布。
- shadow → 独立标注评测与真实浏览器 → active；不能调阈值或反复试同一留出集制造达标。
- 凭据留在仓库外；交接只记位置和完整性，不复制密码、token 或 API key。

## 已踩坑 / 已发现的真实行为

### 历史基线与根盘

- Claude 主会话对应 ~/.claude/projects/ 下本 worktree 的 2fc262b9-ecd1-419a-9f1c-8aee03ecb971.jsonl。只读提取授权和摘要，未复制原始内容；最后 organization disabled。驻留进程不等于任务仍在推进，其他项目会话保持不动。
- 2026-10-08 07:58:48 UTC 的用户指令已批准两个 P0 加入开发。v0.1 Release 与远端 main 已核对；本地主目录 main 落后该基线 33 个提交，保持未动。
- 历史 seal-v01d/accept.log：routing、folding、task-frame、goal-interrupt、codex-forward 五场景通过。旧脚本未独立证明非零测试数、全部通过、原始日志 hash 或 1秒/3秒 SLA；也不证明本轮新构建。
- 扩容前 vda 为 1000GiB，vda2/ext4 仍约 800GiB，根盘 100% / 0 可用。growpart 默认临时目录失败；使用 TMPDIR=/run，dry-run 保持起点后 growpart / resize2fs 在线扩展。
- 分区表备份 /run/system3-vda-before-grow-20261008.sfdisk 重启会消失；sfdisk verify、ext4 rw、服务用户 write/fsync/read、active 和受保护 API 401 通过。没有删除共享数据、重启或部署。
- 最终 df 984G / 788G used / 156G available / 84%。后续增长归因 SSH 被关闭，来源仍待调查；ship.sh 会发布并重启，不当诊断命令。

### 完成核验与状态隔离

- 原 system3/completion-review 非 ignorable 事件未进入词表；真实 Loader + JSONL 重开先复现 SessionFormatUnsupportedError，再用 owning generator 修复。新增同版本普通事件 acknowledgement，未改历史代际数据。
- 初始人类消息在 task-frame seq6 保存，但 native create_goal seq18 使用模型 objective 并清空 items，可能丢失附加限制；容量/长度也限制当前卡片。新执行前约束设计 v2 先保存人类指令来源，未实施。不能称所有初始限制已受保护。
- 真正 update_goal 完成前检查目标/要求及工具结果；提前申请返回持久拒绝，Goal 不变，模型补证后再完成。自然语言结束声明和无法关联任务卡的目标不在此能力范围。
- Jev 返回成功答复后若任务卡对象变化，review 记录 unsure、空 unmet、goalUnmet=false；active 在额度内拒绝并引用当前原话。无成功答复的失败/超时保留放行；shadow 不拒绝、不计数；取消不记录 review。
- 拒绝额度已为 WeakMap<Session, Map<GoalId, number>>，真实 fork 同 id 独立计数，弱引用不保留丢弃 Session。额度仍在内存，重启/重载清零；达到配置上限仍记录但允许完成。
- task-frame 的旧异步判断不回写已变更目标。尚未 claimed 的 stale 消息保留队列供下一轮重判；已 claimed 的 pending stale 判定仅重判一次，第二次 stale 丢弃，不阻塞主步骤。dispose 后不继续排队。
- 使用确定性屏障补竞态回归，RED → GREEN；最新18个spec共243项，completion-review.ts、task-frame.ts与decision-kernel.ts各四指标100%；配置2项与生命周期12项负例均先RED后GREEN。
- 稳定及 stale 两条 TypeScript SDK 回放 2/2，Session corpus 3/3，Python 当前 built CLI smoke 通过。stale 用真实 Goal.edit rev2 触发过期判断，拒绝后原生 read 再完成 rev3；外部 Jev 用本地 fixture，不冒充真实调用。
- SDK fixture localhost 在子代理旧 sandbox 中 listen(0) EPERM；宿主同命令通过，未改产品逻辑或放宽预期。doc-sync 会清理并重建 lib，不能与 built SDK smoke 并行。
- 两条最新真实 E2E使用真实DeepSeek主模型、实际部署Jev、生产Goal/fs工具及JSONL，没有mock模型答案。基础：49事件，47.105s跨度，Jev2306/3768ms；incomplete/refused → read/write/read → complete/rev2。追加要求：65事件，15.699s跨度，Jev1496/2331ms；原文入任务卡，首次旧卡 unsure/refused，后续 Jev r1 实际包含新文件名，正确副本完成/rev2。两日志关闭重开和 deriveMessages 一致。
- 真实报告 completion-live-product-result.json 和 -requirement.json 包含 UTC、四源码 SHA256、每次 judgement 耗时与实际事件。执行范围为 in-process production services；这两条单独不证明 shipped profile 或跨任务准确率；当前本地 built Web 的独立浏览器证据另见 completion-browser-result.json。
- 最终配置/生命周期审计另复现：off任务卡仍允许非off核验并可能恢复旧card；System3卸载后旧Jev仍拒绝工具。配置与生命周期已修：非off review依赖off frame加载报错；插件单独移除时不记录或应用旧核验，原生Goal完成rev2；用户取消保持active/rev1，迟到success/unknown不记录。确定性屏障及真实原生Goal回归通过，源码组合与built Web证据已全部刷新；持久事件字段不变。
- 工具证据摘要仅最近 N 次结果首尾，可能漏中间或较早的必要内容；禁止类要求只凭摘要未违反，不足以完整安全保证。新执行前约束须保留权限和确定规则。

- 当前本地 built Web（runtime 0.1.7-rc.2；精确标记见浏览器报告）另有真实浏览器闭环：62条JSONL记录含header，61事件；create_goal → 提前update_goal拒绝 → read/write/read → complete rev2。两次Jev都是judged，2914/1960ms。实际副本与源文件SHA256一致，源文件未变；拒绝card可见，刷新后仍可展开，日志无新增判断。报告保存源码/CLI/System3/UI bundle hash、active配置、原始JSONL和截图；并未发布生产。
- Web客户端不能由Host-only构建保证新鲜。此次完整build重建client，核对UI版本；隔离DSH_HOME、DSH_AGENTS_HOME和documentsDirectory，fixture放在documents/deepseek-harness/default-workspace。只停止本次启动的Web/browser进程，私密验收目录保留。

### Jev 评测、监控与 mu

- 历史主集16条 precision/recall 1/1；留出8条 1/.75，另10条 .833/.833，标注亦需独立复核。历史证据保存 completion-evaluation-history.json，未重跑旧留出集；部署 WIP 仍 shadow，阈值未改，未部署。
- route-integrity.ts、routeIntegrity 与对应浏览器场景尚无实现。历史监控150记录/6线路各25，未重跑。model 字段与 token 差异不能认证模型身份，须区分质量变化、路由变化、网络故障和身份线索。
- ~/.config/xdan-system3/relays.md、relays.json 权限0600；AILink12/12、UUAPI15/15 key非空，OpenOx8/8，非空不等于已验证调用。UUAPI官方目录一次GET 200返回9模型；AILink目录入口未确认、OpenOx官方教程空白，未猜URL；三站推理权限/质量均未实测。安全摘要为relay-directory-status.json。
- mu 上游最新源码已核对，未运行 mu；swarm.patch 只看任务/路径/行数，不读 diff、不拦应用，preflight clarification 是提示。DSH 已有权限继承、goal 续跑、重复提醒等，新增只补确定规则解决不了的语义点。
- 新排序：任务卡 → 执行前约束 → 完成核验 → 普通任务续跑 → 卡住恢复；线路质量 probe 并行。三个候选尚未实现或真实验收，P0 含义为交付优先级。

## 下一里程碑任务清单

- [x] 继承 Claude 授权、发布和 WIP，保留原 worktree / main。
- [x] 在线扩容 prd 分区和 ext4，验证写入及服务状态。
- [x] 修复持久登记、真实 Loader/JSONL 重开、两 SDK 和生成物。
- [x] 修复状态隔离、关闭依赖及卸载/取消，243项回归和三源码100%覆盖。
- [x] 真实 DeepSeek + Jev + Goal/fs 两条 E2E 通过，日志重开一致。
- [x] Review mu、提前排列三个候选，交付具体设计与逐功能验收矩阵。
- [ ] 复核标注并设计未泄漏的新独立评测，核验精度、召回、延迟、失败与取消。
- [x] 当前本地 built Web 使用真实主模型/Jev/原生工具完成提前拒绝→真实文件读写→完成rev2，刷新保持记录；与历史生产版本分开。
- [ ] 专用核验依据 UI、独立准确率评测与生产新版本完整验收通过后再决定 active。
- [ ] 具体设计确认后逐项实现约束、普通续跑、卡住恢复；每项真实正反例及界面闭环。
- [x] OpenOx8/8完整key私密保存（0600）；AILink12/12、UUAPI15/15，未新增或删除key。
- [ ] 三站模型调用权限与受控错配/正常对照实测区分力、误报和预算，再定告警/避开/恢复。
- [ ] 按 feature-acceptance 排程补齐全部14招牌及8组原生能力真实验收；不以一条成功场景替代整体。
- [ ] 追踪磁盘增长，具体审阅清理范围后再操作共享数据。

## 分支 / 部署 / 验证状态

- 本轮里程碑包含继承 WIP 和接管修复，本地提交状态以 git HEAD 核对；主目录 main 干净，stash 为空。尚未推送、合并或部署，远端 CI 没有本轮证据。
- build:lib:host 与受影响 Session/System3 构建已通过；新批次 typecheck:contracts-ready、focused type-aware lint、Ruff check/format 通过。
- 最新行为：System3包243项/18文件通过、三源码100%；真实源码组合2/2与当前本地built Web浏览器1/1；TS SDK2/2、corpus3/3、Python smoke通过。完整pnpm build通过（含client），最后生命周期修复后Host重新构建通过；前端源码未变，当前Web实际UI与bundle另行核对。
- 最终doc-quick20/20、doc-sync42/42（103.18s）全部通过；lint:contracts-ready、typecheck:contracts-ready、Ruff check/format与diff通过。唯一浏览器机器证据允许保留原始UI revision，维护页面仍只用版本和证据链接；该规则13项正反回归通过。

## 冷启动 checklist

- [ ] 先读本文件、lessons.md、mu-p0-review.html、feature-acceptance.html、completion-continuation.html 和 tasks/task.zh.md。
- [ ] 核对 status、diff、stash、branch、HEAD、worktree list 及其他会话写入归属，不覆盖 WIP。
- [ ] 修改 packages 前读 architecture.md、defensive-patterns.md、相关 AGENTS；review 来源文件而非复述稿。
- [ ] 保持 shadow；先补独立评测与当前构建浏览器证据，再决定上线。
- [ ] 新候选按已确认具体设计推进；每次固定源码和配置、验收产物/反例，再更新矩阵及交接。
- [ ] 构建与 built smoke 顺序执行，只报告实际检查和范围。

## CEO 汇报交付（2026-10-09）

- 用户明确要求将 report 浓缩为一页老板汇报；原 report 保留，新增 report-ceo-onepage.html/pdf 与布局证据，均在本 worktree 文档目录。
- 叙事为业务价值、大小脑和DSH执行底座、软件/文档/业务助手成果、限定范围的真实证据、可衡量的试点建议；以可复用交付体系表达潜力，不宣称尚未测得的成本收益或全部功能完成。
- gstack browse实际核对375/768/1440宽度；文档本身无横向越界，手机架构区域可横滑。PDF为A4一页，所有文字块在页内；无外部资源、SVG文字无越界、三个本地链接有效。
- 独立CEO内容审查完成。当前完成核验为本地验证未生产发布，质量监控和新增P0仍待完善；汇报不扩大运行验收范围，不变更产品源码或生产环境。
- 文档检查：test:docs20/20、doc-sync42/42、lint:contracts-ready、相对链接、Ruff check/format与diff通过。此次仅本地提交，未推送或部署；默认浏览器已打开HTML供用户查看。
