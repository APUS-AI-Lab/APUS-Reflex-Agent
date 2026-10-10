# APUS 全品牌统一交接

## TL;DR

- 用户批准两仓产品品牌统一为 APUS Reflex Harness，中文瞬策，Slogan“瞬时执行，深度思考”。
- 两仓均在 feat-apus-brand 隔离工作树；保留 main、体验分支 WIP、用户旧应用和真实 Profile。
- Harness 完整构建、Web 实测与品牌相关回放通过；Frontend 原生明暗/窄屏、隔离 Profile 重启和安全模式通过，最终固定版本装配进行中。
- MIT 原文、上游致谢和本地许可入口已完成；用户已授权 GitHub 收尾、合并 main 与推送，未授权发行安装包。

## 本轮交付物

完整文件路径、行数与二进制大小见同目录 files.json。

- docs/feat-apus-brand/design.md、design.zh.md：已批准设计。
- docs/feat-apus-brand/branding.md、branding.zh.md：共享品牌输入与兼容要求。
- docs/feat-apus-brand/evidence/：真实 Web 明暗主题、中文、窄屏截图及检查记录。
- apps/web/public/brand.json、brand-mark.svg、brand-icon.*：跨仓品牌输入和原生资产。
- apps/desktop/scripts/generate-brand-assets.ts：生成图标、安装器字标和卸载器侧栏。
- apps/、packages/client/、packages/core/system-prompt/、packages/boot/app-boot/、packages/bundle/web-app/：应用品牌和模型可见身份。
- website/、docs/user/index.*：当前文档网站入口。
- snapshots/：当前身份回放与新 Session 代际；未修改既有 Session 文件。

## 设计约束

完整名用于窗口和应用身份，紧凑字标 APUS / REFLEX。真实 DeepSeek 账户、模型、版权和上游署名保留。包名、协议、appId、数据目录、System3 API 与持久化兼容标识不因改名迁移。更新和诊断策略独立于显示名；未接自有更新服务时默认禁用。MIT 原版权和许可全文保留，第三方按各自许可证归属。

## 已踩坑/已发现的真实行为

Frontend 是 Electron 宿主，装配 Harness Web UI，release 固定 Harness revision。宿主旧鲸鱼覆盖共享品牌的问题已修复；原 app.name 条件已改为显式策略。Harness 自带 Desktop 默认也不再自动查询上游更新。

完整 build 会删除并重建客户端构建记录；不要与 built-boot 测试或 Frontend runtime prepare 并发。Frontend 严格 runtime 补丁需要适配新品牌上下文，但仍保持 fuzz=0。

资产生成器使用 fileURLToPath 支持空格/中文路径；已在临时路径实际生成通过。托盘渲染已支持新的 A 矢量；Windows 卸载器侧栏也已替换。

Stagehand source 模式在本机 Node22/tsx 加载时失败；错误刷新产物已还原，built 模式刷新和回放通过。PowerShell 回放使用临时目录中的官方 ARM64 发行版，不安装系统软件。

旧 Session 输入不覆盖；刷新器按当前 writer 输出新的 v4 文件。cordis-tool-round 和 schedule-catalog 的两个 pinned 历史提示词保留原身份，这是历史记录，不是运行时旧品牌。

## 验证记录

- pnpm run build：通过；包含 Host、Client 和 352 个客户端构建产物（包含两份完整许可文件）。
- Web 最终 replay：8 文件、33 测试通过，覆盖真实回合、PTC、插件、onboarding、PWA、built boot。
- Headless 身份相关回放 42、PowerShell 2、Stagehand built 1、SDK 11 测试通过。
- Desktop 相关测试 342 通过；新增更新策略、类型修复与资产针对性检查通过；资产测试 2 文件 8 测试通过。
- UI i18n 926 源文件通过；针对性 lint、diff 检查通过。
- 文档站检查 151 测试及构建通过；双语配对 1181 对通过。
- doc-sync 最终 42/42 通过。生成目录和 README 格式已修；历史导入机器证据保留，仅精确允许两个 JSON 的 revision pins，其他文件及组织 URL 检查继续生效，13 项针对性测试通过。
- gstack browse：标题、标识、Slogan、中文、明暗主题和 390px 窄屏通过；无横向溢出和 console errors；未调用模型。

## 下一里程碑任务清单

- [x] Harness UI、Web/PWA、CLI、Desktop 和模型身份。
- [x] 实际构建、Web 回放及浏览器证据。
- [x] 完成 Harness MIT/上游致谢及分发核对。
- [x] README 格式复验与文档 42 项检查。
- [x] Frontend 独立 Profile、正常/安全模式、重启和明暗/窄屏验收；固定版本包另见前端交接。
- [x] Harness 产品提交合并并推送 main；Frontend 固定对应 revision，保留两工作树。

## 分支/部署状态

两仓分支 feat-apus-brand。用户旧体验应用未停止或覆盖；未部署、未修改模型服务器。GitHub 描述和 topics 已统一；Harness Actions 恢复，DSH_UPSTREAM_AUTOMATION=false 保持上游发行和消息禁用；Frontend 发行同样设置 APUS_RELEASE_AUTOMATION=false。前轮 main 设计原文归档在 approved-preflight.md；既有任务记录保留。

## 冷启动 checklist

1. 阅读本文件、设计和 Frontend tasks/feat-apus-brand/handoff.md。
2. 核对两仓 git status、分支与现有进程，不覆盖其他工作树修改。
3. 阅读 docs/feat-apus-brand/evidence/ 和 Frontend 原生验收结果。
4. Harness 构建稳定后才执行 Frontend runtime prepare；核对固定 revision。
5. 区分真实产品验收、静态检查与已有文档基线问题。

## 合并与发布记录

Harness 产品品牌提交已快进合并并推送到 GitHub main，正常 pre-push typecheck 通过。Frontend 的 Harness pin 指向此产品提交；随后本仓补项目指令中的产品名称、交接、CI Python 依赖安装与 SDK 品牌回放，不改变 Runtime。精确 revision 以 git log 和 Frontend runtime manifest 为准。

GitHub 两仓描述、topics、Issues 链接与 MIT 标识已核对。Harness 上游自动化明确关闭，独立只读 CI 已恢复；Frontend 新增常规只读 CI，发行/归档/外部通知统一由默认关闭的 APUS_RELEASE_AUTOMATION 控制。未制作签名发行、未发布 Release、未替换用户安装版。

最终装配曾遇到 Harness pre-push 重建 lib 与 Frontend 复制并发；在 hook 完成后重试，检查临时副本 bin.js 存在。后续遵守冻结产物而不只是冻结源码的要求。

远端首轮 Independent harness 的 TypeScript 行为及 Session 回放通过，Python SDK 步骤缺 pydantic。改为 uv 按 python/sdk 项目安装依赖，并实际刷新和重放 completion-review、entry-route、shadow 三场景通过；仅品牌提示词与当前原生 writer 输出元数据变化，历史 Session 文件无改动。

后续 CI 暴露 pool-reset 测试模拟器遗漏已取消 AbortSignal：动态 import 在负载下晚于20ms期限，模拟fetch只等未来abort事件而挂住。新增预取消确定性负例先复现5000ms超时，再让模拟器立即拒绝已取消信号；Jev provider目录28项通过，未改生产transport、未延长超时。
