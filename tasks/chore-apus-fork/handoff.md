# APUS Reflex Harness 仓库接续

## TL;DR

新仓库 cryptoSUN2049/APUS-Reflex-Harness 为私有独立副本，保留 Git 历史、分支和标签。新 main 以 worktree-feat-jev-decision-kernel 的 a2f3e160e6b0cf7844450ece301201067cabdccd 为基线，包含当前产品报告、CEO PPT 和演示方案。原 xDAN 仓库及应用未修改。

## 本轮交付物

- tasks/chore-apus-fork/handoff.md：新仓库接续与边界。
- tasks/chore-apus-fork/import-verification.json：最终远端提交、分支与标签数量、验证记录。

## 设计约束

Model as Harness：共享大小脑决策、Host 投影和 System3 UI 在此维护；APUS-Reflex-Frontend 负责 Electron 装配与正式安装包。更名不改变包名、Session 格式、运行配置或部署环境。

## 已发现的真实行为

同一账号的原生 GitHub fork API 返回原仓库，因此新建保留历史的私有副本，GitHub 页面无 fork 关系。source remote 指向旧 xDAN 仓库，upstream 指向 DeepSeek Harness。原 main 保存为 source-main，新 main 继承当前功能分支。

Frontend 当前固定的 3127b62274bf324a3eac0cba28d03a37c3b91a30 已在当前历史中。复制新仓库不代表把安装包升级到新 main。xDAN System3 与 Harness Dev 可以同时运行，应按可执行文件和 runtime manifest 判断测试对象。

## 下一里程碑

- [ ] 与 Frontend 的 feat-reflex-experience 设计完成确认。
- [ ] 在隔离 worktree 实现五项体验能力及模型核对，逐项补真实 E2E。
- [ ] 固定经过验收的 Harness 提交，由 Frontend 打包并验证。
- [ ] 按需迁移 Issues、PR 和 Release 附件；Git 复制不包含这些平台数据。

## 分支与部署状态

main 是新产品基线。原工作树、安装包、服务器和旧远端保持不变；导入历史标签期间关闭新仓库 Actions，避免触发历史版本发行。未声称旧功能在新安装包上已重新验收。

## 冷启动 checklist

1. 读本文件，再读 tasks/feat-jev-decision-kernel/handoff.md。
2. 核对分支、HEAD、origin 与 source；不再默认向 xDAN 原仓库推送。
3. 读 Frontend 功能分支 docs/feat-reflex-experience/engineering-plan.md，区分设计与实现状态。
4. 在 worktree 中修改共享插件；按相关测试、快照和真实产品路径验收。
