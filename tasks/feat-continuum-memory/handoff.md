# APUS Continuum 连续记忆设计交接

## TL;DR

- 当前为方案评审阶段，已创建 feat-continuum-memory 工作树，没有实现产品功能。
- 推荐名称 APUS Continuum（连续记忆）；HTML 是本轮设计入口，候选名未做重名核验。
- 无限记忆为 Reflex 专属开关；关闭或未接入时兼容原版，不提供无 Reflex 的同等产品模式。
- 下一步须取得用户对具体 HTML 设计的明确确认，再推进 M1 开发和验证。

## 本轮交付物

- docs/feat-continuum-memory/continuum-memory-proposal.html：209 行；目标、组件图、专属开关、记忆与接口、UniiChat 13 维横向表、文件范围和验收分期。
- tasks/todo.md：405 行；追加 Continuum 设计、开发与验证 checklist 和结果；保留原有任务。
- tasks/lessons.md：149 行；记录用户纠正的专属开关与原版兼容含义，避免误推无 Jev 产品模式。
- tasks/feat-continuum-memory/handoff.md：56 行；本交接，包含范围、约束与冷启动路径。

## 设计约束

Continuum 包含完整 Service Definition、Provider 和消费者；Reflex 通过 ctx.jev 管理记忆。底层存储、授权与预算模块化，但产品开启必须具有 Reflex 控制器。关闭或未接入回到原版；Baseline 只用于测试和有限故障兜底。显式开启缺必需配置时报错，运行故障显示降级，用户取消不继续执行。开关关闭不删除数据，后续请求停止记忆管理与注入。

Harness 持有事实、权限、预算、版本和执行权。模型提炼先成为候选；明确用户来源或独立验证才能确认，不把模型摘要提升为用户指令。Markdown 是可读视图/导入格式。原事件与实际注入均须可追溯；回放禁止重新检索或再次调用 Jev。

首版跨会话沿用精确 cwd 授权规则，不宣称已支持跨用户共享。停用使当前视图和派生数据失效，物理擦除另设计；跨进程多写者不是首版范围。文档都位于 docs/feat-continuum-memory，流程文件位于 tasks/feat-continuum-memory。

## 已踩坑与已发现的真实行为

- base 有持久化和自动压缩，Web standard/ptc/cordis preset 有压缩；全文检索默认 openAt: never，默认未挂载 tool-session-query。
- 当前 task-frame 有 maxItems 截尾、长文本/非纯文本跳过、顶层 Agent 限定且判定异步，不能当可靠的完整要求集。
- runtime-context 先于 agent/pre-step 渲染；当步召回应参考 skill-selection 追加 accepted message，不能只修改 context 回调。
- compaction-basic 计量最近持久请求，未涵盖尚未提交的新输入和召回。最终路由改变也要重核容量，M1 先验证这个接入点。
- session-query SQLite 是可重建索引，自定义事件不会自动提取全文；唯一记忆不能只写索引。
- 跨 Session 引用需要 sessionId + seq，不能借用同 Session 的 sourceEventSeqs。
- 停用提交要使在途读取、后台摘要和准备发送的输入失效；未索引尾部补查也受预算限制。
- .Codex 目录写入受沙箱保护，本轮文档迁入使用了针对性授权；不要通过其他路径绕过保护。

## 下一里程碑任务清单

- [ ] 用户确认设计后，先读根 AGENTS.md、docs/architecture.md、docs/defensive-patterns.md、packages/AGENTS.md 和相关子树规则。
- [ ] 验证新注入、实际路由、token-meter、compaction 的预算组合，再冻结 M1 接口和事件类型。
- [ ] 实现 Continuum 的持久记忆事件、任务工作集、索引、原文回读、纠正/停用、权限和确定性兜底。
- [ ] 接入 Reflex adapter 与专属开关；无 Reflex 兼容原版；用内部 Baseline 消融，先 shadow 再 active。
- [ ] 按行为面构建、lint、单元/集成、keyless Session 与两个 SDK 快照；随后真实模型对照。
- [ ] 用户明确授权前不推送、建 PR 或部署；推送前执行 dsh-pre-push-checks 与 Ruff 双检查。

## 分支、部署和验证状态

工作树：.Codex/worktrees/feat-continuum-memory。分支：worktree-feat-continuum-memory。从 main 的 bcbc2cc7e4 创建；创建前已检查 status、diff、stash、branch、HEAD 和 worktree list，stash 为空。主目录已有 README 设计和未跟踪 undefined 文件，未带入或改动这些用户工作。产品代码、运行配置与服务器均未变，未运行产品测试；新分支未推送，CI 未触发。

最终版 22 个链接、13 个 ID、SVG XML、尾换行及 git diff --check 通过；真实 1440px/390px 页面无横向溢出，13 维 5 列表完整，手机表内横向滚动且可聚焦，无 console 错误。独立审阅未发现对方能力失实、目标冒充当前或无 Reflex 产品模式残留。对比仅据作者设计与本地源码，未执行 UniiChat 原程序或新记忆模型评测。未安装依赖、未运行产品测试或全仓文档门禁；仅本地提交设计文档，不推送。

## 冷启动 checklist

1. 先读 docs/feat-continuum-memory/continuum-memory-proposal.html，再读本文件和 tasks/todo.md 的 Continuum 部分。
2. 确认用户是否明确批准具体设计；仅要求输出 HTML 和准备工作树不等于跳过 Human Gate。
3. 查看本工作树 status、branch 和 HEAD，勿把 main 上其他文档工作带入。
4. 优先验证预算与同一步注入，再开始 M1；所有产品代码与测试在本工作树推进。
