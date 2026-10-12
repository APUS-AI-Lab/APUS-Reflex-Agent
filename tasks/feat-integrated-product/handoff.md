# 一体化仓库与 Release 交接

## TL;DR

- 用户批准以现有 Harness 为主仓整合前端，并在审查后公开仓库与 Release。
- 工作树 feat-integrated-product；main 的未提交设计、经验和其他工作树保持不动。
- 已批准方案在 docs/feat-integrated-product/design.md；术语必须为 Model-as-a-Harness。
- 当前阶段：源码与发布流程实现已落盘，Harness 完整构建通过；正在运行时、回归和安装验收。尚未提交、推送或发布。

## 本轮交付物

进行中；最终文件行数与结果在里程碑完成时补齐。桌面源码位于 frontend/，产品编排在 scripts/product.mjs，版本与附件校验在 scripts/product-release.mjs，产品版本为 release/manifest.json 的 0.1.8-beta.1。双语安装、配置、开发、发布教程位于 docs/feat-integrated-product/。root README 与六语言 frontend README 收拢到这些入口。CI 创建草稿，不自动公开发行。

新插件 frontend/packages/dsh-desktop-system3-settings/ 提供显式启用、凭证引用与本地激活状态。默认不带生产端点，不启用 System3 决策，不远程导出会话。Model-as-a-Harness 已在活跃品牌与引导文案中修正。

## 设计约束

frontend/ 是 Electron 宿主，Web UI 和 Runtime 继续由 Harness 提供。保留前端 npm 锁、根 pnpm 锁、许可证、appId 与用户数据目录；不得内置真实凭证或把生产服务作为新用户默认值。产品发行版本独立于 DSH 包版本。下载入口只列已验证产物。

## 已踩坑/已发现的真实行为

现有前端 release macOS 缺少 own runtime prepare，Windows build 先于品牌准备。根 dev:desktop 原本指向另一套宿主，需保留显式维护入口。测试、构建与 Runtime 复制会重建共享产物，必须顺序运行。源码构建需要原生编译器与 Node headers。

本机并发主构建与前端全套测试造成严重内存压力。首轮全套前端测试 1579 通过、33 失败，包含合仓后的旧路径/文案断言及运行时超时；正在修复及串行复验，不能记录为全通过。首轮 setup 在新增 mjs 类型声明缺失处中止；补声明后单独 pnpm run build 完整通过，setup 后半段仍待实际执行。旧工作流归档在 frontend/.upstream-workflows/workflows，Python 脚本保留 frontend/.github/scripts 路径。

GitHub 实际归属 APUS-AI-Lab/APUS-Reflex-Harness，当前账号 cryptoSUN2049 只有 WRITE，admin=false，仓库仍 private。必须管理员操作才可公开。当前机器没有有效代码签名身份；仅准备明确标注 unsigned 的 beta 预览，不能宣称签名/公证。真实安装和公开下载尚未验收。

公开审计当前树及历史已完成，确证凭证泄漏为零；最终增量和安装包仍需扫描。npm 生产依赖审计另有继承风险，需按实际装包闭包评估，不得把凭证审计等同依赖安全结论。原始扫描和构建日志保留 /private/tmp/apus-*，禁止提交凭证日志。

## 下一里程碑任务清单

- [ ] 导入前端并完成单仓 setup/start/package。
- [ ] 默认普通模型配置可用，协同配置明确且无生产凭证依赖。
- [ ] 统一 Model-as-a-Harness、README 和配置教程。
- [ ] 公开审计覆盖当前树与历史；修复确证问题。
- [ ] 构建、测试、实际安装包验收与许可检查。
- [ ] 提交推送、审查后公开仓库并发布已验证 Release。

## 分支/部署状态

feat-integrated-product 基于 main。未发布、未改可见性、不覆盖用户安装版；公开与发布已获用户授权，仍须完成审查及验收。

## 冷启动 checklist

1. 读本交接与 design.md，检查 tasks/todo.md。
2. 检查工作树状态及子任务消息，避免重复构建/复制。
3. 核对公开审查结果与真实安装验收，不能将静态检查替代发行验证。
