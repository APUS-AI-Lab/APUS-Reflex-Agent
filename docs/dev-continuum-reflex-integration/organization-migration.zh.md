# 组织迁移审阅

[English](organization-migration.md) | 中文

## 当前归属与权限

两个独立仓库现为 [APUS-AI-Lab/APUS-Reflex-Harness](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness) 和 [APUS-AI-Lab/APUS-Reflex-Frontend](https://github.com/APUS-AI-Lab/APUS-Reflex-Frontend)，均保持私有。当前认证账号具有 pull 和 push 权限，但没有仓库管理权限；需要管理权限的设置应由组织管理员处理。

仓库转移已经完成，保留的是已推送到 GitHub 的历史；本地未提交的修改不会随转移上传。已发布源码应以各远端 main 的内容为准。仓库归属、已合并源码与公开发布就绪是三个不同状态。

## 公开前的历史资料处理

当前文件树清理将部署截图、原始 Session／请求转储、私有来源清单和内部管理演示稿归档到仓库之外。此前提交的版本仍在历史中，并随私有仓库一起迁移。秘密模式扫描通过不代表内部商业内容获准公开。

将任一仓库公开前，需要审阅并执行历史处理方案：从所有待发布历史 ref 移除所列敏感路径／值，或者发布脱敏源码快照并私有保留原仓库。保留许可证、已发布 Session 文件代际和当前源码内容；改写历史不属于顺带的文档修改。

## 兼容性影响

改写历史会改变 commit 标识。Frontend 工作流固定 Harness revision，发布清单也记录 revision，因此需要明确旧新映射、更新 pin 并验收对应产物。快照发布同样需要可解析的 Runtime 输入。不静默 force-push 共享 ref，不丢弃私有原件。

## 已完成与待核实项

- [x] 将两个独立仓库分别转入 APUS-AI-Lab，保持私有可见性。
- [x] 核实新所有者、私有可见性及当前账号的 pull／push 权限；账号没有管理权限。
- [ ] 处理待发布 ref 与附件中的私有资料清单；仅秘密模式扫描不足以完成该项。
- [ ] 公开前审阅并执行历史处理方案及其 Runtime pin 调整。
- [ ] 取得所需管理权限后，核实默认分支、ref、重定向、协作者、Actions secrets、分支保护、工作流仓库引用和 Runtime pin。
- [ ] 完成仓库规范链接及包元数据更新，再运行受影响检查。
- [ ] 审阅剩余 CI、E2E 和签名包限制后，单独决定公开可见性。
