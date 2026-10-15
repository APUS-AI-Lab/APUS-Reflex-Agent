---
description: "在 Host 上准备并运行 APUS Reflex 4B，作为本机 Jev 决策 provider。"
kind: "package-reference"
---

# @deepseek-ai/dsh-experimental-reflex-local

[English](README.md) | 中文

## 概述

此插件在 Apple Silicon Mac 上用随包分发的 `llama-server` 加载 APUS Reflex 4B、9B 或 35B-A3B GGUF 权重，回答类型化 Jev 决策。它向 [Jev 服务](../apus-dsh-jev-plugin/README.zh.md)注册 `reflex-local` provider，并通过 `ctx.reflexLocal` 提供设备检查、可续传下载、校验、自检、启用与删除。启用插件时不下载任何内容，除非要续上 Host 退出时仍在进行的准备。

## 目录

- [使用此包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用此包

在子进程 provider、config editor 与已启用的 `jev` 条目（由 Jev bundle 插入）旁挂载此插件；缺少 editor 或该条目时加载失败。`dataRoot` 必填且必须是绝对路径；`runnerPath` 指向随包的 `llama-server`。不是 macOS arm64、内存低于最小档或没有可执行 runner 的 Host 报告 `device.supported: false`，原因为 `platform`、`memory` 或 `runner-missing`；provider 仍保持注册，所有决策以 `transport` 失败，调用方回落到 baseline。

| 字段 | 默认值 | 含义 |
|---|---|---|
| `providerId` | `reflex-local` | 本机 provider 的 Jev 注册 id |
| `dataRoot` | 必填 | 存放 `models/`、部分下载文件与 `state.json` 的绝对目录 |
| `runnerPath` | 不设置 | `llama-server` 的绝对路径 |
| `minMemoryBytes` | 4B Q4_K_M 8 GiB、4B Q8_0 16、9B Q4_K_M 16、9B Q8_0 24、35B-A3B Q4_K_M 32、35B-A3B Q8_0 64 | 各选项所需总内存，键为 `<model>-<quant>` |
| `modelOrigins` / `modelOrigin` | Hugging Face 与 HF-Mirror / 不设置 | 下载源；显式 `modelOrigin` 关闭探测与回退 |
| `modelProbeTimeoutMs` | `3000` | 为下载源排序的 HEAD 探测时限 |
| `downloadStallTimeoutMs` | `60000` | 允许不收到响应字节的最长间隔 |
| `diskMarginBytes` | 1 GiB | 下载完成后需保留的可用空间 |
| `contextTokens` | `9216` | runner 上下文窗口 |
| `startupTimeoutMs` / `decisionTimeoutMs` | `120000` / `30000` | runner 就绪时限与每问时限 |
| `idleTimeoutMs` | `600000` | runner 空闲多久后停止；`0` 表示一直运行 |
| `minPrefillTokensPerSecond` | `150` | 自检吞吐低于此值时报告为慢机，且不会自动启用；Apple M5（Metal）在 118 token 的参考 prompt 上约为 400，纯 CPU 推理约为 100 |

`snapshot().options` 列出六个选项（4B、9B、35B-A3B 各有 Q4_K_M 与 Q8_0），含精确大小、内存档位，以及 `fits` 和第一个未满足的条件：先看 `memory`，再看可用空间能否容下尚缺的字节加 `diskMarginBytes`。`recommended` 是能装下的最大非实验选项；可用空间一个都装不下时，取内存够用的最小非实验选项。35B-A3B 为实验选项：在 Mac 上实测前从不推荐，但内存够时仍可准备。不指定变体的 `prepare()` 沿用当前或失败的变体，否则使用推荐；超出内存档位的选项会被拒绝。

`prepare()` 检查可用空间，把所选档下载到 `models/<file>.part`，用 HTTP Range 请求续传已保留的字节，校验固定的大小与 SHA-256，再重命名文件。随后启动 runner，在所选模型上运行模型卡的参考决策；答案正确且速度不低于下限时启用本机决策。每个模型在 `state.json` 中各自保留校验指纹与自检结果，切回已自检的模型无需重测。`pause()` 保留部分文件，`cancel()` 删除它，`remove()` 删除全部权重并停用。`runtime/assets.json` 把每个文件固定到仓库修订，以及该修订 `SHA256SUMS` 中的 SHA-256：`apus-ailab/APUS-Reflex-4B-GGUF` 为 `191bfcb721ec6d44352c622a30d290ae6afbabc8`，`APUS-Reflex-9B-GGUF` 为 `d3691a7f15fe26ac8d6199505e03a30fdafcc563`，`APUS-Reflex-35B-A3B-GGUF` 为 `0103cd6bb0878c4229e5f7ac5f02e20a630d1ffd`。

`enable()` 通过 config editor 把 `jev` 条目的 volatile 字段 `defaultProviderId` 设为 `providerId`，`disable()` 删除该字段，恢复 Jev 的内置默认；两者都不会重载 Jev。`snapshot().enabled` 报告该条目实际的默认 provider 是否为此 provider，`snapshot().reflexEnabled` 报告 Jev 总开关 `jev.enabled`，为 false 时所有 provider（包括此 provider）都会停止。provider 声明 `local` 执行域，因此 System3 准入把它的决策视为本机。自检后的自动启用还会在 `state.json` 记录 `unacknowledgedAutoEnableAt`，使客户端在重启后仍能提供撤销；`acknowledge()`、`disable()` 与 `remove()` 会清除它，手动 `enable()` 从不设置它。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节 — 点击展开</summary>

| 源文件 | 职责 |
|---|---|
| `src/index.ts` | `ReflexLocal` Service：开始检查、在嵌套的 `jev` 依赖中注册 provider、委托 `ReflexLocalService` |
| `src/engine.ts` | 准备状态机、`state.json`、自检、路由编辑、runner 归属 |
| `src/models.ts` | 固定的模型目录、选项适配判断与自动推荐 |
| `src/download.ts` | 下载源探测、可续传下载、校验、失败分类、可用空间检查 |
| `src/runner.ts` | `llama-server` 进程、就绪判定、`/completion` 客户端、崩溃重启、空闲停止 |
| `src/device.ts` | 平台、内存与 runner 门控 |
| `src/contract.ts` / `src/provider.ts` | 训练契约 prompt 渲染与 Jev provider |

启用时先读 `state.json`，再检查权重：大小与修改时间与上次哈希校验指纹一致的文件直接采信，其余完整文件重新计算哈希。已自检的权重恢复为 `ready`；未自检的权重报告满字节的 `paused`；部分文件报告带字节数的 `paused`。Host 停止时留下的 `preparing` 记录会立即续上。检查结束前拒绝 `prepare()`。

Service 只注入 `subprocess`；provider 注册放在嵌套的 `jev` 依赖中，因此 Jev 重载（例如修改非 volatile 的 Jev 设置引起的重载）只会重新注册 provider，引擎、runner 与下载都继续运行。

runner 在第一次决策或 `warm()` 时懒启动，参数为 `--host 127.0.0.1 --port 0`、`-np 1` 与 `--offline`；每次新生成的 32 字节 key 通过 `LLAMA_API_KEY` 传入（b11118 读取它，忽略 `LLAMA_ARG_API_KEY`），因此 key 不会出现在进程列表中。端口取自 stderr 的 `listening on` 行，之后 `GET /health` 必须返回 200，且 `GET /props` 不带 key 时返回 401、带 key 时返回 200；stderr 只保留有界尾部，仅写入 Host 日志。在 HTTP 层以下失败的请求会把进程标记为待替换，下一次获取时重启。自检在新进程上以 `cache_prompt: false` 运行参考 prompt 两次并测量第二次，因为第一次包含一次性的 GPU 初始化。

不发布运行时不变量配套：进程观测由 `dsh-subprocess` 负责，引擎没有需要对账的第二份投影。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

[Jev 决策服务](../apus-dsh-jev-plugin/README.zh.md)

-----

<a id="model-experience"></a>
## 模型体验

### 本机 Jev 决策 prompt

#### 模型看到的内容

主 LLM 请求不增加任何内容。对每个有两个及以上候选的 Jev 问题，本机 Reflex 模型收到一个带 chat 包装的训练契约 prompt：共享状态、包含 primitive、instructions 与字母编号候选描述的 JSON 任务，以及 `Answer:`。只读取第一个生成位置。

#### Token 影响

主 LLM 的 token 预算不变。每个问题消耗一次输出 1 个 token 的本机补全；Jev usage 报告 prompt token 总数、命中缓存的 prompt token 数与补全次数。

#### KV Cache 影响

与主生成路由相互独立。runner 只有一个 slot，同一请求的各问题复用共享状态前缀；状态不同或空闲停止都会使复用失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅支持 macOS arm64** — runner 随 macOS arm64 桌面 runtime 分发；其他 Host 报告 `platform`。
- **自检吞吐在短 prompt 上测量** — 参考 prompt 约 120 个 token，固定开销占主导；Apple M5 测得约每秒 400 token，长 prompt 约 1,000。默认值 150 仅在 M5 上校准。
- **外部路由变化不会推送** — `snapshot()` 每次调用都从 `jev` 条目读取 `enabled` 与 `reflexEnabled`，但 `follow()` 只发布引擎自身的变化；在 Reflex 设置页做的修改会在下一次发布或读取 snapshot 时出现。
- **35B-A3B 尚未在 Mac 上实测** — 在 Mac 实测确定档位与速度预期之前，这些选项保持实验状态。
- **契约输入缺口** — 训练契约拒绝空或仅含空白的 state 与 instructions，但 Jev 校验只要求 instructions 非空，这类请求仍会被渲染。形如整数的 choice key 在分配字母时遵循 JavaScript 键顺序，而不是插入顺序。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

设置 `REFLEX_LOCAL_RUNNER` 与 `REFLEX_LOCAL_WEIGHTS` 时，`tests/engine.e2e.ts` 使用真实 runner；单元测试使用 `tests/fake-llama-server.fixture.mjs`，它读取与真实 runner 相同的参数与 `LLAMA_API_KEY`，输出相同的 stderr 行，并以相同字段响应 `/health`、`/props` 与 `/completion`。

</details>
