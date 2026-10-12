# 一体化仓库公开审查

[English](publication-audit.md) | 中文

本参考记录覆盖 2026-10-12 的源仓库文件、可达 Git 历史和产品默认配置。它不代替安装包验收，也不把密钥扫描通过解释为任意资料均适合公开。

## 扫描范围与结果

使用本机 Gitleaks 8.30.1，强制内置默认规则，忽略仓库 allow 注释与 ignore 清单，报告采用 `--redact=100`。原始 JSON、扫描文件副本、远端 refs 清单和提取文本仅存于本机临时目录；本文件不包含匹配正文、凭据或报告副本。

| 对象 | 范围 | 扫描文本量 | 命中 | 复核 |
|---|---|---:|---:|---|
| Harness 当前文件 | `main` 的 14,460 个已跟踪非符号链接文件 | 119.17 MB | 32 | 全部为散列或测试样例 |
| Harness Git 历史 | 本地全部 refs 可达 20,398 个提交；工具处理 12,227 个产生 diff 的提交 | 320.82 MB | 502 | 全部为散列、测试样例或非凭据文本 |
| Frontend 当前文件 | `main` 的 706 个已跟踪非符号链接文件 | 9.18 MB | 0 | 未检出 |
| Frontend Git 历史 | 本地全部 refs 可达 524 个提交；工具处理 426 个产生 diff 的提交 | 29.35 MB | 0 | 未检出 |
| 演示和汇报附件 | 三份 PDF、两份 PPTX 和演示 ZIP 的可提取文本 | 615.70 KB | 0 | 未检出 |

两个本地仓库均不是浅克隆。历史扫描使用 `gitleaks git --log-opts=--all`，覆盖本地分支、远端跟踪 refs 和标签的可达历史。GitHub API 返回的 `APUS-AI-Lab/APUS-Reflex-Harness` 36 个 refs，包括 4 个分支、4 个 PR head refs 和 28 个标签，其提交全部属于扫描可达集合。源仓库远端跟踪 refs 与本地开发分支也参与扫描，因此本地扫描范围大于当时 GitHub 可见范围。Frontend 未单独核对 GitHub 全部 refs；导入的是已扫描当前文件。

Git 扫描基于文本 diff；合并提交数量与工具计数不同，不代表提交丢失。结果不覆盖 reflog、不可达对象、随后新增提交、尚未生成的 Release 文件、图片文字和未提取二进制内部数据。发布前应对最终提交和实际安装产物补扫。

## 命中分类

Harness 当前文件的 32 条命中包括 26 条翻译配对文件中的路径与 Git 散列、3 条导入验证 JSON 中的提交散列，以及 3 条测试样例。没有将目录名本身用作整目录放行依据。

Harness 历史的 502 条命中包括：

- 481 条 `*.i18n.yaml` 翻译配对散列；逐条核对为 Markdown 文件键及 40 或 64 位十六进制摘要。
- 5 条验证 JSON 中的 Git 或文件摘要，其中 2 条位于 `docs/feat-reflex-experience/jev-api-guide-verification.json`，3 条位于 `tasks/chore-apus-fork/import-verification.json`。
- 13 条测试样例，位于模型设置、凭据保存和遥测脱敏测试；包括显式 `FIXTURE_SECRET`、连续数字样例和脱敏用 JWT。
- 3 条普通文本误报，分别位于性能证据 Markdown、Session projection 模块说明和旧桌面 renderer 的 localStorage 键。

规则统计为 `generic-api-key` 495 条、`cloudflare-api-key` 5 条、`gcp-api-key` 1 条和 `jwt` 1 条。全部原始报告的 `Secret` 字段均验证为完整脱敏。审查没有发现已确认的真实密钥，因此没有据此轮换凭据或改写历史。

## 产品默认配置的发布要求

源 Frontend 的 `scripts/generate-system3-patch.mjs` 从 Harness 的 `deploy/system3/runtime.patch.yml` 生成桌面配置，并把 `SYSTEM3_SESSION_DATA_CLASSES` 的空默认值替换为 `[workspace]`。源配置含组织模型网关与 Jev 部署地址。该方式适用于已有运维配置，不能直接作为公开安装包的通用默认配置。

公开产品必须使用独立的产品配置：模型凭据由用户配置，不预装组织密钥；组织生产网关不得成为普通用户启动的必要条件；远端 Jev 和工作区数据授权须由用户显式配置。安装包中不应带入开发者环境文件、运行日志、会话数据、内部运维 patch 或 shell 配置。上述要求需由最终构建和首次启动测试验证，本次源文件审查不替代该验证。

## 文档与内部资料

部署地址和个人路径检查在 Harness 定位 70 行、Frontend 定位 12 行。测试中的私网 IP 属于网络功能样例；需要与真实部署信息区分。真实组织部署引用主要位于 `deploy/system3/`、`docs/feat-independent-harness/`、`docs/feat-system3-foundation/` 和对应 `tasks/` 记录，部分验收 JSON 含开发者本机路径。这些引用不是凭据，但不适合作为面向所有用户的默认配置教程。

`docs/feat-jev-decision-kernel/` 中的 CEO PDF、PPTX、预览图片和 `report-ceo-onepage.html` 属于管理汇报资料；`report.html` 也含公司战略和资源投入论述。文本补扫未发现真实密钥、明确财务金额或机密标记。现有证据不足以要求清除这些文件的 Git 历史；面向用户的 Release 包应排除这些非运行资料。是否在源码仓库保留它们属于内容精简决策，不能仅凭文件名推断商业机密。

README 可简化声明，但不能删除实际分发依赖要求的许可证全文与第三方通知。公开范围也包括旧提交和 PR refs；仅从新提交删除文件不能撤回历史内容。

## 发布复核

- [x] 当前源文件与本地可达历史完成密钥扫描和误报分类。
- [x] 当前 Harness GitHub refs 的提交覆盖已核对。
- [x] 可提取的演示与汇报附件文本完成补扫。
- [ ] 最终一体化提交完成增量扫描。
- [ ] 产品 profile 不依赖组织生产部署，并验证用户显式配置和数据授权。
- [ ] 实际安装包完成密钥、环境文件、第三方通知和首次启动验收。
- [ ] 发布前复核远端 refs 是否发生变化。

## Dev Note

本文件是本次公开审查的时间点证据。没有修改源仓库历史，没有读取或输出本机环境文件中的凭据，没有对候选凭据发起联网验证。
