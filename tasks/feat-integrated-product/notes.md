# 集成进行记录

## 主线同步

初始导入后两仓远端继续推进。已创建本地集成 checkpoint，并在隔离分支合并 Harness origin/main 的新增工作；主目录未覆盖。前端较新 main 的 generation、Reflex bundle 和恢复界面修复正在逐项保留。所有旧基线构建证据仅适用于当时源码，不能代替当前最终构建。

## 旧标签清理

用户明确要求清理历史发布入口，以首次 APUS 编译包为起点。2026-10-12 清理前查询正式 Releases 数量为 0，旧远端 tags 为 28（23 个 dsh，4 个 System3，1 个 APUS 里程碑）。已验证 Git bundle 和原始 ref/OID 对应后删除全部 28 个远端旧标签，再查数量为 0；源码提交历史未删除。

可恢复备份保存在本工作树 `.artifacts/legacy-tag-backup-20261012/`：`legacy-tags.bundle`、`refs.json`、`removed.json`、`RESTORE.txt`。另外保留本地 `refs/archive/pre-apus-release-20261012/*`。不要用 `git push --tags` 将旧本地标签意外重新上传。新产品标签按用户指定为 `v0.1.0`，尚未创建；最终验收通过后才指向实际发布提交。

## 平台范围

产品首次版本由用户指定为 0.1.0；底层 DSH 保持独立版本。当前发行目标只有 macOS arm64。Windows 有现有 NSIS 构建脚本但未完成本次原生构建/安装验收；Web 可源码启动，现有 system3 Dockerfile 仅供维护者构建并导出到宿主 systemd，不是面向普通用户的独立运行镜像。不能声称三端预编译包均已交付。

## 构建调度

`doc-sync` 的文档检查包含 `build:lib:host`，也会写构建产物。它必须与 setup、运行时复制和打包串行执行。本轮一次 doc-sync 已主动停止以避免重叠，不能将该次记录为通过。npm 自动审计元数据请求遇到连接重置时，本地安装使用 `npm_config_audit=false`；依赖安全审查仍独立执行，不能把跳过安装时的自动审计写成审计通过。

完整文档检查 42/42 通过（`/private/tmp/apus-final-doc-sync.log`），全仓 `lint:contracts-ready` 通过（`/private/tmp/apus-final-lint-rerun.log`），Ruff 双门禁通过（110 文件已格式化）。当前 main 无新增待合并提交。setup 真实失败点为 pnpm legacy 嵌套部署项目对 bin 目录的相对路径计算；离线最小样例确认，临时工作区根项目部署修复进行中，不能归因于网络或系统目录权限。

临时根部署修复已落地，3 项独立离线 pnpm 回归通过；最终待提交增量 210 个文件重新扫描，gitleaks exit 0 / 0 findings，脱敏报告 `/private/tmp/apus-publish-final-yvwat77c/report.json`。此结果不覆盖尚未生成的安装包。独立发布复核明确：裸 Web probe 不覆盖实际 desktop overlay；依赖清单仅记录包身份与 manifest 摘要，不能声称完整运行时字节一致。最终必须使用干净提交串行打包并实测该安装包。
