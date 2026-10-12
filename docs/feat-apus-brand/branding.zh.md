# APUS Reflex Harness 品牌与装配

[English](branding.md) | 中文

APUS Reflex Harness 的中文名为“瞬策”，Slogan 为“瞬时执行，深度思考”，产品定位为 Model-as-a-Harness。报告中的管理范围是战略目标；品牌文案不代表记忆等能力已经接入或通过验收。

## 权威输入

Web 静态品牌定义位于 `apps/web/public/brand.json`；唯一原图是同目录的 `brand-source.webp`，即用户提供的 140×140 透明渐变飞鸟位图。`brand-mark.svg` 嵌入原图的无损 PNG 表示，不是矢量重绘。共享 UI 的 `BrandWordmark` 和 `FishLogo` 保留组件 API，使用同一原图生成的 PNG 数据显示 APUS 飞鸟和字标。

在仓库依赖已安装后，运行 `pnpm exec tsx apps/desktop/scripts/generate-brand-assets.ts`，从该原图生成 Web favicon、共享 React 品牌数据、应用 PNG/ICO、原生桌面资源和安装器字标，保留颜色、比例和透明度。macOS 同时用系统 iconutil 生成 ICNS；其他平台使用已提交的 ICNS。该脚本使用现有 sharp 依赖。

`frontend/` 桌面宿主在 prepare 阶段验证并复制这些品牌输入到 `.build/brand`，安装包与原生页面消费这组资源。更改 Harness 后，从同一工作树重新准备运行时；修改仓库名称不会改变已安装应用。

## 兼容与归属

`@deepseek-ai/*`、`dsh`、System3 插件标识、Session 字段、现有应用 ID、协议及数据目录继续承担技术兼容职责。DeepSeek 模型和账户服务按实际提供方命名，许可证和第三方贡献保留真实归属。历史验收文档不因更名改写。

APUS 产品不能使用显示名称决定是否启用上游更新或诊断服务。桌面宿主使用明确产品策略禁用这些服务。Harness 原生桌面也默认禁用 feed 检查，即使包内带有上游元数据；强制更新查询仅在显式配置策略时运行。自有更新服务的接入与发布需要独立配置和验收。
