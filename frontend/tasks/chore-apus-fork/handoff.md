# APUS Reflex Frontend 仓库接续

## TL;DR

新仓库为 cryptoSUN2049/APUS-Reflex-Frontend，私有。以 feat-system3-integration 的 1e98c11 为产品基线，保留原 Git 提交历史与版本标签；按用户要求清理历史分支。原 xDAN 仓库和运行中的 App 保持原样。

## 本轮交付物

- package.json：仓库、问题页、主页指向新 APUS 仓库。
- .github/workflows/release.yml：自有 Harness 获取地址改为 APUS-Reflex-Harness；已验收 pin 3127b62274bf324a3eac0cba28d03a37c3b91a30 保留。
- tasks/chore-apus-fork/handoff.md：新仓库冷启动入口。

## 设计约束

共享 System3 UI 和 Host 逻辑由 APUS-Reflex-Harness 维护；Frontend 负责 Electron 装配和正式安装包。复制仓库不等于重新部署，也不更改 appId、用户数据目录或自动更新渠道。

## 已发现的真实行为

GitHub 对同一账号自有仓库的 fork API 返回原仓库，故使用保留 Git 历史的独立私有副本；GitHub 页面不会显示 fork 关系。source remote 指向旧 xDAN 仓库，upstream 指向原 DSH Desktop。历史分支留在原 xDAN 仓库；新仓库只保留 main 与当前开发分支 feat-reflex-experience。main 从 System3 integration 开始。

`import-verification.json` 是首次导入的历史核验快照；当前分支策略与清理结果以 `branch-cleanup-verification.json` 为准。

## 下一里程碑

- [ ] 确认 docs/feat-reflex-experience 中的体验/模型核对设计，再实施五项能力。
- [ ] 新 Harness 固定提交经 prepare、补丁重放、打包和真实桌面 E2E 后再升级安装包。
- [ ] 按需迁移 Issues、PR、Release 资产及发行凭据；Git 历史复制不包含这些 GitHub 数据。

## 分支与部署状态

main 是新的产品基线；地址适配和迁移记录已归入 main。未启动部署或覆盖安装包。最终远端 SHA、导入数量和检查证据见本目录 import-verification.json；新仓库 Actions 当前关闭，避免导入历史标签触发发行。已配置专用于新 Harness 的只读 Deploy Key 及 Frontend SYSTEM3_HARNESS_READ_KEY secret；未迁移模型凭据或签名凭据，未声称 CI 已运行。

## 冷启动 checklist

1. 读本文件，再读 tasks/feat-system3-integration/handoff.md。
2. 核对 main、origin、固定 Harness SHA 和本机实际 App runtime manifest。
3. 继续体验设计时读 tasks/feat-reflex-experience/handoff.md 所在功能分支；不得把原型数据当实测。
4. 在隔离 worktree 实施并测试；当前正式安装包仍是旧已验收版本。
