# 公开配置中的模型服务

[English](public-provider-configuration.md) | 中文

公开 System3 profile 包含官方 DeepSeek 生成服务及 `fast`、`reasoning`、`codex` 候选，不包含维护者 relay 或 Reflex 地址。通过凭据存储或受保护的启动环境设置 `DEEPSEEK_API_KEY`。System3 自动化需要通过 `SYSTEM3_SESSION_DATA_CLASSES` 显式分类。未设置、空字符串或 JSON `null` 会禁用整个 System3 行，包括本地过程监督；普通生成继续使用用户配置的 provider。这不是全局禁止出网：通用模型请求仍按对应 provider 配置发送。非空 JSON 数组如 `["workspace"]` 启用部署的 controlled 策略并允许对应类别。入口路由启用时，非法 JSON、未知类别或空数组导致启动失败，应用不能静默丢弃已启用的 System3 插件。已有用户 profile 的自有分类或 local-only 配置仍可使用，显式 `disabled: true` 优先。

## 可选 Reflex

同时设置 `JEV_ENDPOINT` 和 `JEV_MODEL`。未由用户 profile 覆盖时，两者均缺失或为空则禁用 Reflex；只配一个或 URL 非法时启动失败。匿名服务无需 `JEV_API_KEY`。`JEV_API_KEY_ENV` 显式指定凭据存储或启动环境中的引用；已命名但缺失的凭据阻止 HTTP 请求。旧版仅覆盖 config 的 profile 仍会启用；显式 `disabled: true` 优先。也可以通过 profile 设置 `jev.disabled: false`，显式指定 `endpoint`、`model` 和可选 `apiKeyEnv`，参见 [bundle 配置](../../packages/experimental/apus-dsh-jev-plugin/README.zh.md#configure-the-gateway)。

## 自有 relay

YAML 补丁替换目标行完整的 `config`；请复制原行并保留仍需使用的设置。使用用户 profile 补丁，在 `llm-pi-ai.config.providers` 中加入自己的 provider，包含字面值 `baseURL`、凭据引用和支持的模型，同时保留其他候选需要的 provider 条目。用完整的候选列表替换 `system3.config.entryRouting.candidates`，保留需要的默认路由。将允许的候选 ID 加入 `approvedRemoteIds`，声明执行域和数据类别，并保留显式会话数据策略。仅添加 provider 不会使其成为路由候选。参见 [生成适配器配置](../../packages/llm/llm-pi-ai/README.zh.md)。也可以通过 `agent-default-model` 把自有 relay 设为基线路径，无需 Reflex。

## Codex 委派

[Codex 示例](../../deploy/system3/codex/config.toml) 使用公共 OpenAI Responses API 和 `OPENAI_API_KEY`。模型是可编辑的示例，不保证账号权限或可用性。使用其他 provider 时，编辑字面值 `model`、provider 段、`base_url`、`env_key`，并让服务子进程可以读取对应凭据。TOML 字符串不展开环境变量。`SYSTEM3_CODEX_HOME` 指定服务自己的配置目录。发布脚本只在配置不存在时安装示例，因此升级保留运维人员配置的 provider。子进程透传 `OPENAI_API_KEY` 和旧版引用 `SYSTEM3_LITELLM_API_KEY`；其他凭据引用需在 profile 的 `env` 中显式声明，因为父进程秘密变量会被过滤。Codex 候选需要已安装并认证的 Codex runtime，不能替代生成模型凭据。

## 验证范围

public-bundle 测试通过实际启动 Loader 加载已发布的表达式，覆盖缺失、部分配置、非法配置与 profile 覆盖，并在本地 HTTP 服务记录认证和匿名请求。已声明但缺失的凭据不会发出请求。System3 隐私与组合测试负责验证策略和生成行为。真实 provider 测试要求显式地址和模型；跳过不等于通过远程验收。历史四档路由 fixture 验证可选路由，不代表公开默认配置。
