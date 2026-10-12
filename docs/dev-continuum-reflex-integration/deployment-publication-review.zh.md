# 部署配置公开性审阅

[English](deployment-publication-review.md) | 中文

## 审阅范围

本次审阅识别了文档之外的部署依赖。当前改动已移除 Jev bundle 和 System3 路由的维护者默认配置；Frontend 仍需固定到对应 Harness 提交才能将整改打包。在已审阅的受跟踪配置中未发现原始模型凭据；环境变量名不是凭据。但实际目的地址、数据策略和提供方耦合仍需在组织迁移或公开前处理。

## 整改记录

| 位置 | 整改前发现 | 整改后的配置或剩余验收 |
| --- | --- | --- |
| [Jev bundle](../../packages/experimental/apus-dsh-jev-plugin/cordis.patch.yml) | endpoint 与部署模型是字面量；provider 读取这些配置字段，导出同名环境变量不会自动替换。 | 显式配置 endpoint／model；均未配置则关闭 Jev，部分配置则启动失败。 |
| [System3 部署](../../deploy/system3/runtime.patch.yml) | expert／frontier 路由采用特定网关与模型别名；provider 基址为字面量。 | 默认仅有官方 fast／reasoning 路由和已配置的 Codex；用户 profile 可以增加自己的远程 provider。 |
| [Codex 部署](../../deploy/system3/codex/config.toml) | provider URL 作为字面量打包。 | 公开 OpenAI Responses 示例仅安装到新的 Codex home；保留既有用户配置。 |
| Frontend 运行时准备 | 固定版本的 Harness bundle 被复制到安装包；清理 README 或截图不会改变它。 | 替代 Harness 配置验收后再升级 pin，检查最终包内配置。 |
| Frontend patch 生成器 | 将 Session 数据类别表达式替换为 `workspace`，并要求特定网关的凭据引用。 | 生成器保留隐私表达式，不再要求私有网关凭据引用。 |
| Jev 凭据引用 | 声明的 `apiKeyEnv` 未设置或为空时会触发 missing-credential。 | 显式指定名称的凭据仍为必需；省略凭据引用支持匿名服务。 |

普通源码 `dsh web/headless` 不会自动挂载 Jev bundle；System3 服务和正常桌面装配会挂载，因此需分开验收。公共供应商 URL、loopback 示例和标准 proxy 环境变量支持都不是私有凭据，不应按关键词一律删除。

## 实现与 API 范围

当前改动调整部署组合与前端准备过程，保持生成／运行时 API 和 Session 格式。公开默认配置必须无需维护者基础设施即可启动。用户显式配置生成 provider 和可选 Reflex provider，私有部署通过自己的 profile 或真正受支持的环境变量覆盖接入。用户已批准此实现范围：移除专属部署默认值，保留显式 provider 和隐私配置，更新两个 main 分支并迁移独立仓库。

## 验收计划

- 在无 Jev／网关凭据的干净通用模型 profile 中验证启动、设置和已配置的生成请求。
- 配置测试 Reflex endpoint 与 model，分别覆盖鉴权及显式匿名服务，捕获实际目的地与请求字段。
- 检查缺失、空值、非法配置；拒绝已启用但不可用的路由，不静默选择其他外部目的地。
- 验证关闭 Reflex、未配置的 expert／frontier 候选，以及既有用户 profile 和 Safe Mode。
- 验证隐私数据类别与获准路由，证明被阻止的 workspace 内容未发送到记录端点。
- 构建固定版本的 Frontend runtime，检查包内 profile，重跑正常／恢复入口；签名公证和真实 provider 效果单独记录。
