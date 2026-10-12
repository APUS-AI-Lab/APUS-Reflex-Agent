# 一体化仓库与 Release 交接

## TL;DR

- 用户批准以现有 APUS Reflex Harness 为主仓整合前端，审查后公开仓库与 Release；产品首版 `0.1.0`，标签 `v0.1.0`，按未签名预发布验收。
- 工作树 `feat-integrated-product`；已创建集成 checkpoint，并以 `merge: sync current Harness product and runtime changes` 提交合并当时的 Harness main；尚未 push，精确 HEAD 用 `git rev-parse HEAD` 查询。
- 前端完整串行测试 180 文件、1592 测试通过；发布相关 50、原生 Reflex UI 44、真实首配 pipeline 2、provider 最终 17 项通过。
- 后端完整构建、桌面生产构建、运行时装配、27 个兼容补丁、Electron 后端 HTTP 200 探针通过。实际空白桌面已进入主页和模型/Reflex 设置页，截图 `/private/tmp/apus-desktop-accept-5PyCmq/`。产品版本显示修复通过 19 项测试，已提交待最终安装包实测。
- 首轮干净提交打包 session `11513` 因实际依赖扫描发现上游 CI 元数据夹带令牌而主动停止（exit 143，未发布）。依赖 `.coveralls.yml` 精确清理与 runtime/ASAR 拒绝回流已实现，17 项定向测试通过；不是本项目凭证，未探测令牌有效性。首次预选真实 DeepSeek 模型的处理偏好已向用户询问，尚待答复。
- 当前没有 Release，远端 0 个 tag；源码仍 private，当前账号只有 WRITE/admin=false，无可用签名身份。实际安装、首个真实任务和匿名下载仍待验收。

## 本轮交付物

关键文件行数为此次交接时的快照，不列全部导入文件：

| 文件 | 行数 | 交付内容 |
| --- | ---: | --- |
| `README.md` / `README.zh.md` | 各 148 | APUS 产品入口，保留最新 Loop Working/Continuum 架构与限制，统一下载、配置、源码启动与许可链接 |
| `frontend/README.md` | 27 | 桌面产品入口；另有中文、日文、俄文、西班牙文、葡萄牙文页面 |
| `scripts/product.mjs` | 121 | 单仓 setup、桌面启动及打包编排 |
| `scripts/product-release.mjs` | 111 | 同提交产物绑定、版本与附件校验、Release 元数据 |
| `release/manifest.json` / `release/notes.md` | 9 / 25 | 产品 0.1.0、首版范围、未签名预发布说明 |
| `.github/workflows/product.yml` / `product-release.yml` | 45 / 80 | 产品 CI 与 Release 草稿流程 |
| `docs/feat-integrated-product/installation.md` | 31 | 安装、更新和平台限制；有中文配对 |
| `docs/feat-integrated-product/configuration.md` | 55 | 普通模型首配、原生 Reflex 配置与能力边界；有中文配对 |
| `docs/feat-integrated-product/development.md` | 42 | 单仓开发命令；有中文配对 |
| `docs/feat-integrated-product/releases.md` | 43 | 打包、依赖追溯与发行验收；有中文配对 |
| `frontend/scripts/runtime-dependency-inventory.cjs` | 78 | 实际 runtime 包 manifest 清单与校验 |
| `frontend/scripts/prepare-system3-runtime.mjs` | 153 | 从当前仓库准备、实体化并验证桌面运行时 |
| `frontend/build/dsh-desktop.patch.yml` | 70 | 桌面 profile 装配 |

复用原生“设置 → Reflex 模型配置”和既有 credentials 服务；此前自建桌面 System3 设置插件已由原生方案替代。首次未配置时可编辑地址/模型；草稿测试不保存，保存后对新请求生效。新 API Key 需独立新引用，拒绝覆盖已配置引用。连接成功不自动启用路由、监督或 Continuum，候选、数据授权与记忆准入仍需显式配置。前端更新后的 generation/recovery 必要修复已纳入。两份依赖锁中的 sharp 已升级至 `0.35.5`。

新增品牌：用户提供的透明渐变飞鸟原图保存在 `apps/web/public/brand-source.webp`（140×140）；Web、React、桌面和安装器均从该文件生成。原图不是矢量，SVG 为嵌入图像包装。品牌相关回归：根 UI 353、前端 177、备用桌面 142、新 Logo 209 项通过。合仓术语检查修复及相关测试 70 项通过；最终文档 quick 检查 20/20 通过；完整 doc-sync 42/42、全仓 lint:contracts-ready、ruff check 和 ruff format --check 全部通过。

## 设计约束

`frontend/` 是 Electron 宿主，Web UI 和 Runtime 继续由 Harness 提供；安装包从同一已审查提交组装。保留前端 npm 锁、根 pnpm 锁、原许可证、appId 与用户数据目录。不内置真实凭证，不把私有生产服务作为新用户默认值。产品术语严格使用 **Model-as-a-Harness**。

产品版本与 DSH 包版本、Session 格式版本分别管理；`0.1.0` 不代表正式签名或稳定性已验收，GitHub prerelease 标志独立于版本后缀。源码压缩包不是安装包。下载入口只列通过验收的实际附件。

Runtime 部署会动态合成依赖集合；双锁摘要标识源码输入，实际 `runtime-dependencies.json` 记录装配后的包名、版本、路径与包 manifest 摘要。它不保证下一次解析相同依赖，也不对包内所有文件求摘要。打包前后及 Release 构建记录必须绑定实际清单，不能以旧包冒充当前提交产物。

## 已踩坑/已发现的真实行为

构建、typecheck、测试和 Runtime 复制可能重建共享产物；本机并发曾引发严重内存压力，必须串行。首轮前端失败已被最新串行 1592 测试通过结果替代，但不能由此推断最终 setup 或安装包已通过。本轮完整 Harness 构建已通过，但部署及桌面 setup 后半段仍待完成。`doc-sync` 自带 Host 构建，必须与 setup 串行；一次重叠 doc-sync 已停止，不计通过。

旧前端工作流归档于 `frontend/.upstream-workflows/workflows`，Python 工具仍在 `frontend/.github/scripts`。根桌面命令启动 APUS 宿主，原 Harness 桌面使用独立维护命令。后端源码变化后需重新 setup 准备运行时。

公开审计覆盖前期源码树与历史及 210 文件最终增量；实际运行时 706 个依赖身份、完整依赖闭包、sharp 0.35.5 与原始许可已验证。实际运行时扫描发现第三方 CI 元数据夹带令牌，清理与拒绝回流已实现；最终安装包仍需完整复核。原始日志在 `/private/tmp/apus-*`，不得将含敏感内容的日志直接提交。凭证扫描结果不替代依赖安全或包内许可检查。

28 个旧远端 tag 已备份至 `.artifacts/legacy-tag-backup-20261012`，bundle 校验通过后已删除；远端当前为 0 个 tag。不要执行 `git push --tags`，避免重新发布本地旧标签；首版只在确认后推送目标 `v0.1.0`。

## 下一里程碑任务清单

- [x] 导入前端，落地单仓准备、启动与发行编排，保留上游许可。
- [x] 合并最新 Harness 产品与运行时，保留 Loop Working/Continuum 架构及能力限制。
- [x] 统一 Model-as-a-Harness、六语言前端入口、双语教程与产品首版 0.1.0。
- [x] 完成最新前端全套串行测试及发布、原生 Reflex UI/pipeline、provider 定向回归。
- [x] 完整 doc-sync 42/42 通过，最新 main 无待同步提交。
- [x] 全仓 lint:contracts-ready 和 Ruff 双门禁通过。
- [x] 修复临时部署根项目，3 项实际离线 pnpm 回归和真实依赖装配通过。
- [x] 对齐全部 27 个桌面兼容补丁，运行时装配、桌面构建及 Electron 后端 HTTP 200 探针通过。
- [ ] 验证桌面和 Web 启动、普通模型首配、真实响应、文件任务、重启和设置保留。
- [ ] 从最终审查提交重新打包，核对依赖清单、许可、版本、哈希及未签名状态。
- [ ] 安装即将发布的实际产物，在无开发依赖环境完成首次任务及支持的更新验收。
- [ ] 复核最终公开增量与产物，完成所需文档及推送门禁；推送分支供审查。
- [ ] 由具备管理员权限者公开仓库；仅发布通过验收的 v0.1.0 预发布附件并验证匿名下载。

## 分支/部署状态

工作树路径为 `.Codex/worktrees/feat-integrated-product`，分支 `feat-integrated-product`。已有本地集成 checkpoint 与合并主线提交，最终品牌、首配和部署修复已提交，依赖元数据清理正在补充。用 `git log -2 --oneline` 和 `git rev-parse HEAD` 查询当前提交。尚未 push，没有 Release，未覆盖用户已安装版本。主目录及其他工作树的用户改动保持不动。

远端为 `APUS-AI-Lab/APUS-Reflex-Harness`；当前账号 `cryptoSUN2049` 权限 WRITE，admin=false，不能自行改为 public。公开与发布已获用户授权，仍须完成审查、管理员操作和发行验收。当前无可用代码签名身份，不宣称签名或公证。

## 冷启动 checklist

1. 先读本交接、`docs/feat-integrated-product/design.md`、`configuration.md`、`releases.md` 与 `tasks/todo.md`。
2. 核对分支、HEAD、工作树和当前 agent 消息；先确认当前运行中的命令与上述日志；旧 session 58636 已失败，不启动重复 setup/build/test。
3. 根据临时部署路径修复和新 setup 的真实结果继续。保留已通过的定向与全套测试证据，仅因新变更、失败或未解决问题补测。
4. 核对最新版本、runtime 清单和产物构建记录；旧安装包不能代表合并后源码。按下一里程碑清单完成实际桌面、安装与真实任务验收。
5. 推送前执行仓库要求的相关检查及 ruff 双门禁；不要 push --tags。核对 tag 备份、远端标签、公开权限和签名状态后再执行发布步骤。
