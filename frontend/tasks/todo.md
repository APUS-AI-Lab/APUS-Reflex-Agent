# System3 Desktop真实接入

- [x] 用户授权与隔离worktree。
- [x] 已批准设计落盘及显式runtime加载切片。
- [x] 依赖安装、focused tests、typecheck。
- [x] rc.2封闭runtime产物及宿主共享peer验证。
- [x] 真实System3入口/采用/Skill状态和原生进度成果控制。
- [x] Desktop品牌与真实应用启动。
- [x] 浏览器/恢复回归及交接。

## Review
已完成的真实安装、入口 / Skill、成果和恢复验收见 [handoff.md](feat-system3-integration/handoff.md) 与 Harness 固定验收记录；不扩展签名分发、Windows 安装或任意旧版本降级范围。

## PR CI 收口

- [x] 核对两个工作树、PR 固定 head、现有工作流条件及预算失败注释。
- [x] 落盘 [CI 核验方案](../docs/feat-system3-integration/ci-recovery-plan.md)。
- [ ] 补跑现有 PR 检查并确认实际执行结果。
- [ ] 根据实际失败确定最小修复，验证后更新固定提交及 PR。
- [ ] 双仓 CI 与审查满足后收口合并；部署验收另有固定来源。

- [x] 修复 Windows 实际失败的两组断言；本地173文件/1559测试、typecheck、build、actionlint、Ruff与自有无模型启动探针通过。
- [x] 补齐固定 Harness 跨仓只读获取、Windows构建和 own runtime 打包验证链。
- [ ] 新固定Frontend head的Windows CI实际完成闭包、打包和安装包smoke。
