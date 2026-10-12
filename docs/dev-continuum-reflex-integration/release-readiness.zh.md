# APUS Continuum + Reflex 发布就绪审计

[English](release-readiness.md) | 中文

## 结论

该分支已经是 Continuum/Reflex 集成功能的 release candidate，但还不应打公开发布标签。核心 opt-in 记忆链路已经实现并通过本地验证，剩余阻断项是发布证据和产品部署验收。

## 已就绪

- 原版 profile 仍是默认路径：Continuum 关闭，自动准入必须显式配置。
- Reflex 专属开关同时控制准入和 recall；缺少 Jev service 时回到原版路径。
- 已提交的人类消息可以带精确 Session 来源引用准入，从 `continuum/memory-record` 回放，并在 seed 重启后恢复 recall。
- 定确定性的有界检索以及 Jev shadow/active 选择已有定向测试覆盖。
- 包元数据、MIT 许可、双语 README、生成目录和凭据引用齐全；仓库扫描未发现提交的真实 API key。
- RunPod Jev 鉴权和 DeepSeek 网关评估已用临时凭据执行，凭据未提交。

## 公开发布前的阻断项

- 仍需针对发布 profile 运行产品级 E2E；新增的生产组合测试已经证明 JSONL flush、上下文销毁、`AgentLoop.resume()` 磁盘恢复、recall 注入和模型可见来源归因，并包含 explicit 模式负向控制。
- System3 真实 Jev 验证中 task-frame、handoff-pack、delegation calibration、entry routing、completion-review 五个文件通过；`reflex-context` 仍有语义断言失败，因为本次返回了 `[Reflex omitted]`，没有注入预期的 Decimal 和不可修改 CSV 约束。断言保持严格。
- 全仓测试在本分支仍未全绿，原因是合并前已存在的 desktop/UI/workflow 基础设施失败；在声称仓库级发布就绪前，必须修复或由负责人明确隔离。
- CI 必须用仓库托管的 secrets 运行新的准入/重启测试和真实 provider lane；本地凭据绝不能进入配置、fixture、HTML、日志或 commit。
- 在精确 release commit 上通过最终 build、typecheck、lint、文档、persistence、catalog、snapshot 和定向回归门禁后，从干净 release branch 发布功能。

## 建议发布顺序

1. 在 staging 部署 profile，配置 `CONTINUUM_MEMORY_ENABLED=true`, `CONTINUUM_MEMORY_MODE=active`, `CONTINUUM_MEMORY_ADMISSION=user-message`, and a non-empty explicit scope.
2. 运行黑盒 session：发送事实、flush、从持久存储重启、提出相关问题，并断言 recall 消息引用原始事件序号。
3. 用相同对话运行原版 profile，断言不产生 `continuum/memory-record` 或 `continuum-memory` 消息。
4. 修复或记录剩余 System3 evaluator 配置和基线测试失败。
5. 在精确 commit 上重跑发布门禁，检查 package tarball，然后打 tag 发布。
