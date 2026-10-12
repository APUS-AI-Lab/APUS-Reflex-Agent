# 给新人的架构跟进任务清单

[English](architecture-followups.md) | 中文

这份清单把可以用仓库定向测试完成的工作，与必须依赖发布负责人、真实 provider 或平台凭据的工作分开。勾选只表示当前代码库已有证据，不表示所有发布门禁都已完成。

## P0：发布与用户信任

- [ ] 恢复 GitHub Actions 预算并重新运行两个仓库的必需 workflow。记录运行 URL，并把 skipped 与 passed 分开记录。
- [ ] 为 Jev shadow、Jev active、Jev 不可用和 Reflex disabled 增加 shipped-profile 黑盒矩阵，逐项验证模型可见请求、决策 receipt、Session 事件和回退行为。
- [ ] 通过真实 Web/Electron 路径验证健康长任务和中途修改 Goal，证明迟到的监督结果不能覆盖更新后的 Goal。
- [ ] 在支持的发布 runner 上完成 Electron 启动失败恢复、会话重开、包 manifest、签名、公证和 staple 检查。
- [ ] 用可复现 provider fixture 和一个真实 endpoint 测量 admission、远端首字节、总耗时和用户可见回退，发布 p50/p95 与失败证据。

## P1：架构加固

- [ ] 把维护文档中的 commit pin 替换成 release tag 或稳定仓库链接，运行 `pnpm run verify-repository-references`，并只在允许的机器证据文件中保留 revision。
- [ ] 把公开证据从 feature branch 和本地 `.Codex/worktrees` 路径迁移到合并后的 `main` 或版本化发布产物。
- [ ] 增加记忆生命周期契约：准入、去重、保留、删除、作用域隔离、检索限制和 Session 回放归属。
- [ ] 增加跨用户、跨 Session、跨 scope 以及 disabled/no-Jev 的记忆泄漏负向测试，并证明投影不会改写源 Session。
- [ ] 增加 provider 切换黑盒测试：provider A 写入记忆，重启后切到 provider B，验证召回、归因和兼容性。
- [ ] 对大规模记忆集增加检索质量与有界性指标，报告 recall precision、选中 bytes/tokens、延迟和无关叶拒绝，不宣称无限 token。
- [ ] 让 Reflex decision receipt 和通用模型执行 trace 可以分别查询，便于审计建议、采用和执行的差异。

## P2：适合新人独立完成

- [ ] 为每个新增公共配置字段增加一个 keyless 单测和一个 parser/loader 非法配置 fixture。
- [ ] 给 README 增加最小 no-Jev 路径和 opt-in Jev 路径，并在干净 checkout 中执行每条文档命令。
- [ ] 增加一个可回放的最小 Session fixture，一次展示输入保留、记忆恢复和有界上下文投影。
- [ ] 增加诊断命令或报告，显示 active mode（`general`、`shadow` 或 `active`）、记忆开关、provider 身份和 Session 目录，但不打印秘密。
- [ ] 增加浏览器断言：未挂载 Jev 时 Reflex 专属记忆开关隐藏或无效，同时原版 DSH 路径仍可用。
- [ ] 增加发布说明，解释兼容行为、已知限制，以及持久记忆和模型 token 窗口的区别。

## 不适合新人首次独立处理

- 不要在未阅读 released-format 规则、未同步更新 TypeScript/Python 回放面的情况下修改 Session event type、持久化版本或迁移行为。
- 不要在没有设计评审和跨进程回归证据的情况下修改 `agent-loop`、上下文投影、cache 前缀保护或取消语义。
- 不要自行修改 Jev 安全约束、provider 凭据流、签名/公证或公开仓库转移设置。
- 不要把本地 mock provider、跳过的 workflow 或组件测试当作真实 Jev、Electron 或 provider 路径的证据。

## 推荐上手顺序

1. 阅读 `docs/architecture.md`、`docs/dev-continuum-reflex-integration/release-readiness.md` 和 README 中的 Loop Working 架构。
2. 运行 Continuum 与 System3 定向测试，再查看一个记录的 Session 和一条 provider 可见请求。
3. 先完成一个 P2 fixture 或诊断任务，并为它增加非法场景，再修改运行时代码。
4. 做 P1 工作时先写小型设计说明，增加定向测试，运行 build/typecheck/lint，再把证据附到任务中。
