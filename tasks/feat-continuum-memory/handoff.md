# APUS Continuum 连续记忆设计交接

## TL;DR

- 当前为方案评审阶段，已创建 feat-continuum-memory 工作树，没有实现产品功能。
- 推荐名称 APUS Continuum（连续记忆）；HTML 是本轮设计入口，候选名未做重名核验。
- 默认自有 Reflex、其他 Jev、无 Jev Baseline 共享完整记忆能力；不启用 Continuum 时保持原行为。
- 下一步须取得用户对具体 HTML 设计的明确确认，再推进 M1 开发和验证。

## 本轮交付物

- docs/feat-continuum-memory/continuum-memory-proposal.html：182 行；目标、组件图、三种装配、记忆与接口、运行语义、文件范围、对照验收和分期。
- tasks/todo.md：404 行；追加 Continuum 设计、开发与验证 checklist 和结果；保留原有任务。
- tasks/lessons.md：149 行；追加用户明确要求的默认 Reflex 与无 Jev 完整兼容原则。
- tasks/feat-continuum-memory/handoff.md：56 行；本交接，包含范围、约束与冷启动路径。

## 设计约束

Continuum 核心包含 Service Definition、Provider 和消费者，不依赖 System3/Jev；可选适配器连接 ctx.jev。APUS profile 显式选择 Reflex，通用组件使用 Baseline。关闭 Jev 不关闭记忆；缺失显式必需配置时报错，运行期超时/弃权才回退，用户取消不回退继续执行。

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
- [ ] 实现独立 Continuum 的持久记忆事件、任务工作集、索引、原文回读、纠正/停用、权限和 Baseline。
- [ ] 接入可选 Jev adapter，原版无 Jev 用例必须完整通过；Reflex 先 shadow，比较后再 active。
- [ ] 按行为面构建、lint、单元/集成、keyless Session 与两个 SDK 快照；随后真实模型对照。
- [ ] 用户明确授权前不推送、建 PR 或部署；推送前执行 dsh-pre-push-checks 与 Ruff 双检查。

## 分支、部署和验证状态

工作树：.Codex/worktrees/feat-continuum-memory。分支：worktree-feat-continuum-memory。从 main 的 bcbc2cc7e4 创建；创建前已检查 status、diff、stash、branch、HEAD 和 worktree list，stash 为空。主目录已有 README 设计和未跟踪 undefined 文件，未带入或改动这些用户工作。产品代码、运行配置与服务器均未变，未运行产品测试；新分支未推送，CI 未触发。

最终 HTML 的 20 个链接、12 个 ID、SVG XML 与尾换行有效，无外部资源；1440px/390px 真实页面无横向溢出，图内可滚动，SVG 文本不越 viewBox，折叠交互通过，清空旧 console 后无错误。git diff --check 通过。仓库没有 node_modules，未安装依赖，未运行产品测试或全仓文档门禁；本轮仅提交设计文档，不推送。

## 冷启动 checklist

1. 先读 docs/feat-continuum-memory/continuum-memory-proposal.html，再读本文件和 tasks/todo.md 的 Continuum 部分。
2. 确认用户是否明确批准具体设计；仅要求输出 HTML 和准备工作树不等于跳过 Human Gate。
3. 查看本工作树 status、branch 和 HEAD，勿把 main 上其他文档工作带入。
4. 优先验证预算与同一步注入，再开始 M1；所有产品代码与测试在本工作树推进。
