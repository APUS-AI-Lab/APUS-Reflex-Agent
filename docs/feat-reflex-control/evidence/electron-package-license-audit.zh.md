# Electron 包品牌与许可证审计

[English](electron-package-license-audit.md) | 中文

直接检查了现有未签名 macOS arm64 目录包。`Info.plist` 标识为 `APUS Reflex Harness Dev`；`Resources/brand.json` 包含 `APUS Reflex Harness`、`APUS / REFLEX` 和 Model as Harness 元数据。包内四个许可证/通知文件分别与 Frontend 和 Harness 源文件逐字节一致，因此 MIT 全文、原版权归属和第三方通知均保留。

目录包已从当前 clean Harness 分支重新构建，deployed runtime manifest 已与该源码一致；真实执行 `--safe-mode --remote-debugging-port=19224` 后在清理自有进程前成功到达 CDP 端点。本机没有有效 Developer ID 身份，也没有 stapled 公证票据；签名/公证发布仍是 CI 凭据门禁。

准确字段和范围见[脱敏审计](electron-package-license-audit.json)。
