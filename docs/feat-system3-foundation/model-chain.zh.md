---
description: "通过显式 System3 源码 checkout profile，运行 Fidoo 生成路由与受控的 RunPod Jev gateway。"
---

# System3 模型链路

[English](model-chain.md) | 中文

## 摘要

源码 checkout overlay 将主生成路由配置为经 `https://proxy.fidoo.ai/v1` 调用的 `fidoo/deepseek-v4-flash`，并挂载独立的 Jev 决策 gateway。Fidoo 服务器已有 `system3-dsh` 虚拟 key。Profile 读取凭据引用，而非密钥值。Jev 仍由 System3 显式执行 shadow decision；挂载 profile 不会在每个 AgentLoop step 自动调用 Jev。

## 目录

- [准备凭据与连接](#prepare-credentials-and-connectivity)
- [创建并检查 profile](#create-and-inspect-the-profile)
- [运行 profile](#run-the-profile)
- [验证决策链路](#verify-the-decision-path)
- [限制](#limitations)
- [开发说明](#dev-note)

-----

<a id="prepare-credentials-and-connectivity"></a>
## 准备凭据与连接

在仓库 worktree 中运行命令。[启动脚本](run-system3.py) 需要已有的 Fidoo 与 RunPod SSH 访问权限。它通过 SSH 捕获 Fidoo `system3-dsh` key 与 RunPod gateway key，仅在 dsh 子进程环境中提供 `SYSTEM3_LITELLM_API_KEY` 与 `APUS_JEV_API_KEY`。RunPod key 仍保存在 `/root/.config/openjev/gateway.key`；脚本不创建凭据文件，也不打印 key。

[Tunnel overlay](system3-fidoo-runpod-tunnel.patch.yml) 使用 `http://127.0.0.1:30135`；开发机上的这个地址必须通过 SSH tunnel 到达 RunPod 宿主。它采用 `jevExecutionDomain: network`、`privacyMode: controlled`，仅批准 `jev` route 与 `public` 数据。SSH 转发到其他宿主时，loopback URL 不代表本地执行。

[同机覆盖层](system3-fidoo-runpod-local.patch.yml) 只适用于 harness 进程运行在包含 Jev gateway 的 RunPod 宿主上。它必须在 tunnel overlay 后应用；它用 `local-only` 准入与 `jevExecutionDomain: local` 替换完整 System3 config。这些 System3 设置控制 Jev 准入。两种部署中的主 LLM 生成请求仍然发送到 Fidoo。

<a id="create-and-inspect-the-profile"></a>
## 创建并检查 profile

从交付的 `headless` 模板创建独立的 `system3` profile，并在执行任务前检查生效配置树：

```sh
pnpm dsh --profile system3 --from-default-profile headless --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml --dump-config
```

仅在 profile 尚不存在时使用 `--from-default-profile`。`system3` 已有 profile manifest 时，此参数会失败。后续检查省略该参数：

```sh
pnpm dsh --profile system3 --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml --dump-config-schema
```

Overlay 使用相对 TypeScript 插件路径，并相对于 YAML 文件所在目录解析，因此指向当前源码 checkout。打包部署必须在 profile 中安装实验包，并将这两处源码路径改为对应包名。Overlay 禁用 DeepSeek 直连适配器，替换主 LLM route 与新 Agent 默认值；它不修改交付组合包。

<a id="run-the-profile"></a>
## 运行 profile

脚本在已忽略的 `.cache/system3-live` home 下创建或复用隔离的 `system3-live` profile。它在随机 loopback 端口启动一个前台 SSH tunnel，只重写临时 Jev endpoint 与源码插件路径，运行 dsh，并在退出时等待两个自有进程结束。临时 overlay 不含 key，任务结束后删除。脚本不安装 daemon，也不修改远端服务。

检查启动计划；此操作不连接 SSH、不读取凭据，也不写文件：

```sh
python3 docs/feat-system3-foundation/run-system3.py --dry-run -- --json "Reply with exactly the word READY."
```

使用已有 gateway key 运行一个任务：

```sh
python3 docs/feat-system3-foundation/run-system3.py -- "Reply with exactly the word READY."
```

`--repo-root`、`--dsh-home` 与 `--profile` 用于修改本地启动位置。在 `--` 前重复提供 `--patch <file>`，可在模型链路 overlay 之后追加 consumer 或验证 overlay。`--` 后的参数交给 headless app。

手动启动时，通过环境或 harness credential store 提供两个凭据引用，并保持受控 tunnel 在 `30135` 监听；随后启动已经检查的已有 profile：

```sh
pnpm dsh --profile system3 --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml "Reply with exactly the word READY."
```

Harness 在 Jev RunPod 宿主上运行时，在任务位置参数前追加同机覆盖层：

```sh
pnpm dsh --profile system3 --patch docs/feat-system3-foundation/system3-fidoo-runpod-tunnel.patch.yml --patch docs/feat-system3-foundation/system3-fidoo-runpod-local.patch.yml "Reply with exactly the word READY."
```

用户期望的 `deepseek-v4.1-flash` 标识尚未出现在已验证的 Fidoo registry 中。Overlay 选择实际已注册的 `deepseek-v4-flash`；alias 不应暗示未经验证的模型版本。Overlay 中的模型容量与 reasoning 设置属于部署配置，无需改插件源码即可调整。

<a id="verify-the-decision-path"></a>
## 验证决策链路

[System3 服务](../../packages/experimental/system3/README.zh.md) 向显式 consumer 提供 `shadowDecision(session, request, signal)` 与 `lastDecision(session)`。Consumer 提供结构化 supervisor 检查、数据类别与可选 turn/step 元数据。System3 根据这些事实构建固定 Choice 候选项与 Jev state，再把完整发送请求与校验后的结果记录到 decision receipt。首轮接入覆盖显式 shadow supervision；自动路由与证据筛选属于其他 consumer。Jev 失败返回不可用结果；确定性准入仍为权威。只有生成响应不能证明 Jev 已被调用。

Profile 拼接与 schema 校验可以在没有凭据时执行。真实验证需要覆盖两条路由：Fidoo Chat Completions 必须经 `fidoo/deepseek-v4-flash` 返回 assistant 响应；System3 shadow decision 必须返回配置的 Jev 模型并形成可重放 receipt。`jev-9b-integration-design.md` 中的接入设计 记录决策协议与隐私义务。

添加[显式 probe](system3-live-probe.patch.yml)，在同一次 dsh 启动中执行生成与一次 System3 shadow decision：

```sh
python3 docs/feat-system3-foundation/run-system3.py --patch docs/feat-system3-foundation/system3-live-probe.patch.yml -- "Reply with exactly the word READY."
```

已验证的源码启动从主 LLM 返回 `READY`，Jev receipt 包含 `outcome: ok`、模型 `APUS-OpenJev-v1-9B-5949`、advice `continue`、确定性 baseline `continue` 和 `replayable: true`；进程以 0 退出并清理 SSH tunnel。独立的同机 gateway probe 对 Choice、Score、Noul 均返回 HTTP 200，并包含 model 与 usage 字段。这些结果证明连通性与 receipt 重构，不代表 Jev 决策质量测量。

<a id="limitations"></a>
## 限制

- 此示例是源码 checkout overlay，不是已安装的插件组合包或默认 profile。
- Profile 挂载 Jev 能力与 System3 consumer API，但不为 AgentLoop 增加自动决策时机。
- 远程 tunnel 需要 controlled 准入，即使客户端 endpoint 是 loopback。
- Jev 的 `local-only` 策略不负责进程出网控制，也不会使 Fidoo 生成变成本地执行。

<a id="dev-note"></a>
### 开发说明

当前 checkout 使用源码 `dsh` 启动器，在隔离的临时 home 下通过了 `--dump-config` 与 `--dump-config-schema`。拼接得到的 96-row tunnel profile 使用 Ajv 按导出的 JSON Schema 校验通过。重复使用 `--from-default-profile` 按文档所述失败。真实任务验证记录在 worktree handoff 中，不从配置检查推断。
