# feat-local-jev-mlx 实现计划

[English](todo.md) | 中文

2026-10-14 用户指令「开展完整打通 这个本地推理的配套 UIUX和服务 打包」。产品 6 个确认项按设计文档默认值执行：只做 mac-arm64；已登录且有可用生成线路时不强制密钥；权重走 Hugging Face + hf-mirror；本机失败不自动外发；自检通过自动启用并可撤销；runner 由本仓库锁版本维护。

## 实现期间发现的设计偏差

- 桌面端目前**不装载 System3 与 Jev**（只有 `deploy/system3/runtime.patch.yml` 的 Web 部署装载）。所以在桌面上「本机判断」没有消费者，设计里的「云端不稳 / 隐私拦截 → 改本机」两个提醒时机在桌面不存在。
- 交付形态因此改为一个**可选 bundle**「本机决策引擎」（与 `voice-input-bundle` 同路径，进 `OPTIONAL_BUNDLES`）：打开即装载 Jev（默认 provider 为本机）+ 本机引擎 + System3（`privacyMode: local-only`、`jevExecutionDomain: local`，只开不依赖云端路线的决策点）+ dock。
- 引导收敛为：插件页开关 → 激活提示 → 单主按钮卡片（下载并启用 → 进度/暂停 → 自检 → 已启用 + 撤销）→ dock「本机」标记。

## 包与改动

- [x] `apus-dsh-jev-plugin`：`endpoint`/`model` 可省略；省略时不注册内置 System One，`providerId` 只做默认选择（文档 + 测试）
- [x] `reflex-local`（Host）：配置、`runtime/assets.json`（固定 revision + sha256）、Range 续传下载、llama-server 进程（`--port 0` + 随机 key + `/health`）、契约渲染（Python `json.dumps` 等价 + 黄金样例）、Jev provider（逐问串行、score→choice、noul、>16 拒绝、缺候选报 invalid-response）、准备状态机（检查/下载/暂停/校验/自检/启用/停用/删除）、`ctx.reflexLocal` 服务
- [x] `api-reflex-local`：Typert Remote `reflexLocal/*`（follow/prepare/pause/cancel/enable/disable/remove）
- [x] `client-ui-reflex-local`：`plugins.bundle.config` 单主按钮卡片 + `plugins.bundle.activation` 激活提示 + locales
- [x] `reflex-local-bundle`：`cordis.patch.yml` + icon + locale；加入 `OPTIONAL_BUNDLES` 与 cli/desktop 依赖
- [x] runner 平台包 `llama-server-darwin-arm64`：构建期下载 b11118 + sha256 校验 + soname 物化；桌面打包签名
- [x] `client-ui-system3`：dock 决策行「本机」标记
- [x] 就绪弹窗：`ui-settings-models/src/client/index.ts:81`、`onboarding-state.ts:228`、`welcome-api.ts:53-66`
- [ ] 文档：各包 README（中英 + i18n.yaml）、`packages/README.md`、用户指南

## 验证

- [x] 各包 focused tests + `test:coverage`（逐文件 100%）
- [x] `typecheck` / `lint` / `duplication` / `hygiene` / `doc-sync`
- [x] 本机 e2e：真实 llama-server + 4B Q8_0 跑三种 primitive；黄金样例逐字节
- [ ] 桌面打包冒烟：签名后的运行时目录里 llama-server 可启动

## Review

- 已完成：上面所列全部包与改动，调整如下：runner 改为随桌面 primary runtime 分发（不做 npm 平台包）；Jev 新增 `defaultProviderId`；就绪弹窗的修复落在 `AccountOnboarding.tsx`（不是 `onboarding-state.ts`），`welcome-api.ts` 有意保持原逻辑；dock 的「本机 / 云端」只覆盖入口决策。
- 验证：`typecheck`、`lint`、`hygiene`、`doc-sync`、`constraints` 通过；改动包 81 个测试文件、1,183 个测试通过；全仓覆盖率门禁没有逐文件阈值错误；真实 e2e（契约 + provider、引擎、Loader 组合）通过。`duplication` 只剩 `system3/src/index.ts` 内部一处基线已有的克隆。
- 全量测试余下的失败都在本分支未触及的区域（品牌图标与侧栏图形测试、macOS 签名环境、Windows 路径解析、既有会话 fixture、浏览器与时序敏感测试）。
- 未完成：用户指南页面；完整的桌面打包冒烟（本机只跑了 runner 暂存步骤）；Developer ID 签名与公证（P4）。
