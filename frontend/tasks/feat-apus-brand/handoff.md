# APUS Frontend 品牌交接（品牌与许可证交付完成）

## TL;DR

- 工作树 `feat-apus-brand`，Frontend品牌、许可证与安全CI已完成，待root合并/push。
- Harness固定 `8222704fb582babf1d0ab2ab4e618291cdc356b0`，最终closed runtime manifest `sourceDirty=false`。
- 最终完整179文件/1575tests、typecheck、build、Ruff均通过；Electron HTTP200 probe与prod/dev arm64目录包通过。
- 六份原版权/许可原文随Resources/licenses保留并逐字节校验；原LICENSE未修改。
- 原生normal/safe、明暗/390窄屏、临时会话重启与最终许可HTTP200验收完成；所有测试进程已关闭。没有安装、签名或发行。

## 本轮交付物

| 文件 | 当前行数 | 说明 |
| --- | ---: | --- |
| `.github/scripts/feishu_release_notes.py` | 635 | 品牌、许可、CI或对应验收 |
| `.github/scripts/github_release_notes.py` | 223 | 品牌、许可、CI或对应验收 |
| `.github/workflows/backfill-archive.yml` | 102 | 品牌、许可、CI或对应验收 |
| `.github/workflows/ci.yml` | 28 | 品牌、许可、CI或对应验收 |
| `.github/workflows/release.yml` | 1168 | 品牌、许可、CI或对应验收 |
| `.gitignore` | 37 | 品牌、许可、CI或对应验收 |
| `README.es.md` | 128 | 品牌、许可、CI或对应验收 |
| `README.ja.md` | 127 | 品牌、许可、CI或对应验收 |
| `README.md` | 139 | 品牌、许可、CI或对应验收 |
| `README.pt.md` | 128 | 品牌、许可、CI或对应验收 |
| `README.ru.md` | 128 | 品牌、许可、CI或对应验收 |
| `README.zh.md` | 138 | 品牌、许可、CI或对应验收 |
| `THIRD_PARTY_NOTICES.md` | 9 | 品牌、许可、CI或对应验收 |
| `build/dsh-desktop.patch.yml` | 70 | 品牌、许可、CI或对应验收 |
| `build/plugin-recovery.html` | 1096 | 品牌、许可、CI或对应验收 |
| `build/safe-mode.html` | 493 | 品牌、许可、CI或对应验收 |
| `build/splash.html` | 76 | 品牌、许可、CI或对应验收 |
| `build/web-import.html` | 267 | 品牌、许可、CI或对应验收 |
| `docs/architecture.md` | 111 | 品牌、许可、CI或对应验收 |
| `docs/development.md` | 116 | 品牌、许可、CI或对应验收 |
| `docs/feat-apus-brand/frontend-brand.md` | 11 | 品牌、许可、CI或对应验收 |
| `docs/feat-system3-integration/desktop-packaging.md` | 49 | 品牌、许可、CI或对应验收 |
| `electron-builder.dev.cjs` | 22 | 品牌、许可、CI或对应验收 |
| `package.json` | 492 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-client-ui/client.js` | 180 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-client-ui/index.js` | 2 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-client-ui/package.json` | 36 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-market-installer/client.js` | 790 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-market-installer/index.js` | 1175 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-market-installer/package.json` | 51 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-onboarding/client.js` | 307 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-onboarding/index.js` | 48 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-onboarding/package.json` | 33 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-preset-transfer/index.js` | 343 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-preset-transfer/package.json` | 25 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-workbenches/client.js` | 1776 | 品牌、许可、CI或对应验收 |
| `packages/dsh-desktop-workbenches/package.json` | 34 | 品牌、许可、CI或对应验收 |
| `patches/@deepseek-ai+dsh-client-ui-agent-preset+0.1.7-rc.2.patch` | 215 | 品牌、许可、CI或对应验收 |
| `patches/@deepseek-ai+dsh-client-ui-settings-models+0.1.7-rc.2.patch` | 909 | 品牌、许可、CI或对应验收 |
| `scripts/generate-system3-patch.mjs` | 27 | 品牌、许可、CI或对应验收 |
| `scripts/install-brand-assets.mjs` | 93 | 品牌、许可、CI或对应验收 |
| `scripts/package-system3-runtime.cjs` | 64 | 品牌、许可、CI或对应验收 |
| `scripts/patch-system3-runtime.mjs` | 118 | 品牌、许可、CI或对应验收 |
| `scripts/prepare-brand.d.mts` | 3 | 品牌、许可、CI或对应验收 |
| `scripts/prepare-brand.mjs` | 37 | 品牌、许可、CI或对应验收 |
| `scripts/prepare-system3-runtime.mjs` | 152 | 品牌、许可、CI或对应验收 |
| `scripts/recovery-ui-smoke.ts` | 226 | 品牌、许可、CI或对应验收 |
| `scripts/sign-windows-unpacked.mjs` | 181 | 品牌、许可、CI或对应验收 |
| `scripts/smoke-signed-windows-installer.ps1` | 170 | 品牌、许可、CI或对应验收 |
| `scripts/verify-brand.mjs` | 10 | 品牌、许可、CI或对应验收 |
| `scripts/verify-release-assets.mjs` | 126 | 品牌、许可、CI或对应验收 |
| `scripts/workbench-doc-page.mjs` | 129 | 品牌、许可、CI或对应验收 |
| `src/main/desktop-service/index.ts` | 47 | 品牌、许可、CI或对应验收 |
| `src/main/index.ts` | 3616 | 品牌、许可、CI或对应验收 |
| `src/main/mobile/lan-mobile-pages.ts` | 424 | 品牌、许可、CI或对应验收 |
| `src/main/plugin-recovery-view.ts` | 334 | 品牌、许可、CI或对应验收 |
| `src/main/repair-agent.ts` | 900 | 品牌、许可、CI或对应验收 |
| `src/main/runtime/disclaimed-utility-process.ts` | 108 | 品牌、许可、CI或对应验收 |
| `src/main/runtime/harness-runtime.ts` | 1046 | 品牌、许可、CI或对应验收 |
| `src/main/safe-mode.ts` | 435 | 品牌、许可、CI或对应验收 |
| `src/main/state/host-disabled-plugins.ts` | 142 | 品牌、许可、CI或对应验收 |
| `src/main/state/safe-mode-profile.ts` | 52 | 品牌、许可、CI或对应验收 |
| `src/main/system3-identity.ts` | 10 | 品牌、许可、CI或对应验收 |
| `src/main/system3-runtime.ts` | 68 | 品牌、许可、CI或对应验收 |
| `src/main/update/update-manager.ts` | 340 | 品牌、许可、CI或对应验收 |
| `src/main/version-info.ts` | 42 | 品牌、许可、CI或对应验收 |
| `src/main/web-import-view.ts` | 68 | 品牌、许可、CI或对应验收 |
| `src/main/windows-menu.ts` | 113 | 品牌、许可、CI或对应验收 |
| `src/preload/index.ts` | 1420 | 品牌、许可、CI或对应验收 |
| `src/preload/update-view.ts` | 128 | 品牌、许可、CI或对应验收 |
| `src/shared/product-brand.ts` | 14 | 品牌、许可、CI或对应验收 |
| `tasks/feat-apus-brand/notes.md` | 23 | 品牌、许可、CI或对应验收 |
| `test/branding-patch.test.ts` | 30 | 品牌、许可、CI或对应验收 |
| `test/desktop-client-ui.test.ts` | 123 | 品牌、许可、CI或对应验收 |
| `test/desktop-onboarding.test.ts` | 395 | 品牌、许可、CI或对应验收 |
| `test/feishu-release-notes.test.ts` | 244 | 品牌、许可、CI或对应验收 |
| `test/github-release-notes.test.ts` | 94 | 品牌、许可、CI或对应验收 |
| `test/lan-mobile-pages.test.ts` | 807 | 品牌、许可、CI或对应验收 |
| `test/product-brand.test.ts` | 24 | 品牌、许可、CI或对应验收 |
| `test/product-services.test.ts` | 26 | 品牌、许可、CI或对应验收 |
| `test/release-automation-gate.test.ts` | 18 | 品牌、许可、CI或对应验收 |
| `test/release.test.ts` | 577 | 品牌、许可、CI或对应验收 |
| `test/safe-mode.test.ts` | 374 | 品牌、许可、CI或对应验收 |
| `test/sign-windows-unpacked.test.ts` | 98 | 品牌、许可、CI或对应验收 |
| `test/system3-identity.test.ts` | 20 | 品牌、许可、CI或对应验收 |
| `test/system3-patch-context.test.mjs` | 57 | 品牌、许可、CI或对应验收 |
| `test/system3-profile-generation.test.mjs` | 24 | 品牌、许可、CI或对应验收 |
| `test/update-rollout.test.ts` | 64 | 品牌、许可、CI或对应验收 |
| `test/update-ui.test.ts` | 84 | 品牌、许可、CI或对应验收 |
| `test/verify-release-assets.test.mjs` | 106 | 品牌、许可、CI或对应验收 |
| `test/version-info.test.ts` | 47 | 品牌、许可、CI或对应验收 |
| `test/workbench-guide-sync.test.mjs` | 118 | 品牌、许可、CI或对应验收 |

## 设计约束

产品全称 APUS Reflex Harness；中文名 瞬策；字标 APUS / REFLEX；Slogan 瞬时执行，深度思考；定位 Model as Harness。Harness `apps/web/public/brand.json` 与 SVG/PNG/ICNS/ICO 是统一输入，prepare 复制到忽略的 `.build/brand`，构建校验名称和资产存在。Web 品牌由 Harness primitives 提供，Desktop sidebar/onboarding 复用它们。

兼容保留：`ai.xdan.system3` / `.dev` appId，`xdan-system3` / `xdan-system3-dev` userData，`xdan-system3-frontend` npm name，`xdan-system3` runtime manifest product，`.build/system3-runtime` 路径，`SYSTEM3_*` / `JEV_API_KEY` / `DSH_HOME` 环境变量，`@deepseek-ai/*` 与 `dsh-desktop-*` 包名，dsh CLI、IPC、插件 ID、API 路由及持久化 key。上游署名、许可证、社区链接和历史验收事实不改造成 APUS 自有事实。

上游诊断和更新通过 `PRODUCT_SERVICES` 明确禁用，不再从 app.name 推断。用户数据不迁移、不清理。所有原生验收使用独立 SYSTEM3_DESKTOP_USER_DATA_DIR，不写用户安装版。

## 已踩坑 / 已发现的真实行为

- 改应用显示名会使原先 startsWith('xDAN System3') 的服务阻断失效；现已解耦并测试自动/手动更新和诊断均不启动。
- Desktop sidebar 与 onboarding 原先分别内嵌 whale SVG，只改 Harness 会漏掉它们；现已共同消费 FishLogo（兼容导出名，实际 APUS 图形）。
- release workflow 的 mac/signed-Windows 分支还保留上游应用/安装包名，已同步 APUS，未宣称签名发行已验证。
- npm test 的 pretest 与 npm build 都重建 `.build/ppt-runtime`；禁止两者并行。第一次并发导致测试读到短暂缺失的 metadata；最终串行完整测试全部通过。
- 预检查发现另一个 feat-reflex-experience 工作树的 xDAN System3.app 已在运行（PID 67398，PID只作历史记录）；不要终止它。正式品牌包直接在本工作树dist验收，显式隔离userData；必要时用dev包独立mobile端口。
- 旧 build whale 资源和旧生成器仍保留为存量文件，但本产品打包/启动消费 `.build/brand`，splash 不再使用 whale GIF。
- npm ci 完成并重放 27 兼容补丁。依赖审计报告 29 个现有问题（15 moderate / 14 high），未做脱离品牌范围的依赖升级。

## 下一里程碑任务清单

- [x] Harness 完整稳定 build 完成，并获得最终提交 SHA。
- [x] 更新 `.github/workflows/release.yml` 的 SYSTEM3_HARNESS_REVISION 为 `8222704fb582babf1d0ab2ab4e618291cdc356b0`。
- [x] `npm run runtime:deploy -- --source <Harness worktree>`；本地未提交预验收用 `--allow-dirty`，最终发布必须 clean。
- [x] `SYSTEM3_ALLOW_DIRTY_PACKAGE=1 node scripts/probe-electron-node-runtime.mjs --system3`（仅 dirty 本地预验收）。
- [x] `SYSTEM3_ALLOW_DIRTY_PACKAGE=1 node_modules/.bin/electron-builder --dir --mac --arm64 --publish never`（仅 dirty 本地预验收）。
- [x] 从 dist-dev/mac-arm64/APUS Reflex Harness Dev.app 正常/安全启动，隔离 userData、DSH_AGENTS_HOME和mobile43128；验证临时会话重启读取（生产包已打包验证，未并发占用用户prod端口）。
- [x] 最终 Resources brand/icon、HTML 标题、27补丁、6份许可证及实际UI验证完成。
- [ ] Conventional Commit，按 root 协调决定是否推送；本轮默认不部署/替换安装版。

## 分支 / 部署状态

分支 `feat-apus-brand`，基于 main b4cca087。品牌分支已快进合并并推送 main；既有 feat-reflex-experience WIP 与用户正式应用未触碰。本地Windows未验证；新增main/PR只读CI，远端运行由root负责。

## 冷启动 checklist

1. 读本文件与 `docs/feat-apus-brand/frontend-brand.md`。
2. 读 Harness 同名工作树 handoff，确认最终 SHA 和构建状态。
3. 核对 git status、runtime-manifest sourceRevision、.build/brand 输入和 release pin。
4. 依次执行剩余 Runtime/pack/native 验收，禁止并行重建 PPT 资源。
5. 仅报告实际运行的 checks；当前全套测试日志 `/private/tmp/apus-frontend-tests-final.log`。

## 装配验证补充

生产目录包 `dist/mac-arm64/APUS Reflex Harness.app` 的 Info.plist 显示名/可执行文件名正确，appId仍为 `ai.xdan.system3`；Resources 包含 canonical PNG/SVG/JSON。afterPack 校验 7 自有包与 27 兼容补丁成功。使用 `CSC_IDENTITY_AUTO_DISCOVERY=false`，未签名、未安装。

发布说明 Python 生成器统一 APUS 名称，stable通知改为从发布页面手动安装已验证包；11项本地生成器测试通过，未发送消息或创建 release。产品profile包解析扩展为读取组/包下 manifest name，deployed/workspace 两模式与补丁回归共13项通过。

## MIT、GitHub 与最终验收

原 LICENSE 保留 DataElement 全文，THIRD_PARTY_NOTICES.md 感谢 DSH Desktop / DeepSeek Harness 与贡献者，明确第三方各自许可。Resources/licenses 包含6份原文（Frontend/Harness MIT与双方notices、Electron LICENSE、Chromium notices HTML），afterPack检查逐字节一致。About的主/备用原生对话框提供本地许可目录入口，仅可信主窗口可调用IPC。LICENSE*.md排除规则已移除。最终prod/dev包均从固定Harness提交重建并通过。

GitHub发行门禁 `APUS_RELEASE_AUTOMATION` 必须明确true；默认不发行、不签名、不上传上游ModelScope、不发飞书。PR和手动development仍构建。Root负责GitHub变量false、启用Actions、最终merge/push；本agent不自行发布。

实际原生验收为Dev包、独立Profile，gstack沿其实际HTTP端口验证；1280明暗和390窄屏截图无横向溢出。测试空白session重启后仍保留同一ID并可读取。人为停止进程期间浏览器记录预期断线错误，不宣称全程零console错误。安全模式亦ready。验收进程已全部停止。

最终Harness固定提交：`8222704fb582babf1d0ab2ab4e618291cdc356b0`；root已回读两仓自动发行变量为false。Frontend ruff check . / ruff format --check . 均通过（2 Python文件）。

## 最终干净装配证据

`npm run runtime:deploy -- --source <Harness worktree>`（无allow-dirty）完成；`node scripts/probe-electron-node-runtime.mjs --system3`返回HTTP200。prod/dev均以`CSC_IDENTITY_AUTO_DISCOVERY=false node_modules/.bin/electron-builder --dir --mac --arm64 --publish never`构建，dev加`--config electron-builder.dev.cjs`，没有dirty豁免。afterPack校验7自有包、27严格补丁和6份许可原文。生产清单JSON位于`artifacts/brand/production-package-verification.json`，包含许可证SHA256；验收产物本地保留不提交。

最终Dev实际进程PID18754曾ready，并沿实际URL通过gstack验证General的MIT/Third-party links；`/LICENSE.txt`与`/THIRD_PARTY_NOTICES.txt`均HTTP200且包含DeepSeek归属，截图`artifacts/brand/apus-native-licenses.png`。该进程与独立browse daemon已关闭。About本地许可证IPC沿用可信主窗口校验，完整文本在Resources/licenses。

新增`.github/workflows/ci.yml`在main push/PR运行Node24 Ubuntu的npm ci、typecheck、npm test，contents权限只读，无发布步骤；YAML本地解析通过。发行/签名/上游归档与飞书由APUS_RELEASE_AUTOMATION显式true控制，root已确认远端变量false。

最终测试日志：`/private/tmp/apus-frontend-tests-final.log`（179/1575）；打包日志`/private/tmp/apus-frontend-pack-{prod,dev}-clean.log`，干净装配日志`/private/tmp/apus-frontend-deploy-clean.log`。首次clean装配与Harness pre-push重建并发失败，等hook结束重试同一命令成功；以后先冻结产物再复制。

## GitHub 收尾

产品提交已合并并推送 main，GitHub 描述与 topics 统一 APUS；完整 MIT 原文与上游致谢进入源码及实际生产/开发目录包。Actions 已恢复，APUS_RELEASE_AUTOMATION=false；此文档推送触发只读 Frontend checks，未触发发行。Harness pin 仍对应已验收的产品提交，后续 Harness CI/文档修复不改变 Runtime。
