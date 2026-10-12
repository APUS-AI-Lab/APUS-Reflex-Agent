# APUS 品牌实现参考

[English](implementation.md) | 中文

## 图像

用户提供的 `apps/web/public/brand-logo.webp` 是唯一图像输入。更改后运行 `pnpm exec tsx apps/desktop/scripts/generate-brand-assets.ts`。生成的 `BRAND_LOGO_DATA_URI` 为 `FishLogo`、`BrandWordmark` 及组合 SVG 消费者提供无需网络图片请求的图像。SVG 包装嵌入 PNG 像素，以兼容原生渲染器。原始图像仍为 140 × 140；调整尺寸不增加细节。

## 主题

既有 `--dsw-*` 样式 API 在 `design-platform.css` 中映射到 APUS 语义 token。浅色强调色为 `#4058c8`，深色为 `#9daeff`；青色和紫色标识飞鸟图像。画布、侧栏、抬升表面、文字、选中态、主操作及焦点指示共享配色。错误、警告、成功颜色保留各自含义。`boot-theme.ts` 中首屏背景与加载后的深色配色一致。

## 产品文案

Model as Harness 保持为产品定位。额度文案明确指向已连接的 DeepSeek 账号，说明用量和计费归属提供方。DeepSeek 凭据表单保留真实提供方名称，并说明如何在模型设置中配置其他提供方。这些文字修改不改变凭据、计费、请求或提供方激活。

## 验证记录

[对比度测量](contrast.json) 记录十六组前景与背景检查。测试命令、限制、文件清单及当前集成状态位于[工作树交接](../../tasks/feat-apus-visual-harness/handoff.md)。包测试和浏览器检查不代表用户已安装的应用已经被替换。
