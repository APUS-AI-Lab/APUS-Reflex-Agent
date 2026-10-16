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
| `idleReleaseMs` | 不设置 | runner 空闲多久后停止并释放模型内存；不设置时，本机判断启用期间 runner 常驻 |
| `maxConsecutiveRunnerFailures` | `3` | runner 连续启动或请求失败多少次后停用本机判断，runner 报告 `failed` |
| `routingPollMs` | `2000` | 读取 `jev` 条目的间隔，使别处的修改得以发布并停止 runner |
| `minPrefillTokensPerSecond` | `150` | 自检吞吐低于此值时报告为慢机，且不会自动启用；Apple M5（Metal）在 118 token 的参考 prompt 上约为 400，纯 CPU 推理约为 100 |

`snapshot().options` 列出六个选项（4B、9B、35B-A3B 各有 Q4_K_M 与 Q8_0），含精确大小、内存档位，以及 `fits` 和第一个未满足的条件：先看 `memory`，再看可用空间能否容下尚缺的字节加 `diskMarginBytes`。`recommended` 是能装下的最大非实验选项；可用空间一个都装不下时，取内存够用的最小非实验选项。35B-A3B 为实验选项：在 Mac 上实测前从不推荐，但仍可准备。不指定变体的 `prepare()` 沿用当前或失败的变体，否则使用推荐。对超出本机内存档位的选项，`select()` 与 `prepare()` 以错误码 `unfit`、details 为 `{ variant, requiredBytes, deviceBytes }` 的 `ReflexLifecycleError` 拒绝，除非调用方在用户同意后传入 `allowUnfit: true`。此后该选项与其他选项一样下载、校验并自检；仍需足够的可用磁盘空间，runner 无法加载时准备失败，当前生效模型继续回答。选择当前生效模型不会再次询问。

`prepare()` 检查可用空间，把所选档下载到 `models/<file>.part`，用 HTTP Range 请求续传已保留的字节，校验固定的大小与 SHA-256，再重命名文件。随后启动 runner，在所选模型上运行模型卡的参考决策；答案正确且速度不低于下限时启用本机决策。每个模型在 `state.json` 中各自保留校验指纹与自检结果，切回已自检的模型无需重测。`pause()` 保留部分文件，尚未收到任何字节时创建一个空的部分文件，使该变体保持 `paused` 且可续传；`cancel()` 删除它，`remove()` 删除全部权重。`runtime/assets.json` 把每个文件固定到仓库修订，以及该修订 `SHA256SUMS` 中的 SHA-256：`apus-ailab/APUS-Reflex-4B-GGUF` 为 `191bfcb721ec6d44352c622a30d290ae6afbabc8`，`APUS-Reflex-9B-GGUF` 为 `d3691a7f15fe26ac8d6199505e03a30fdafcc563`，`APUS-Reflex-35B-A3B-GGUF` 为 `0103cd6bb0878c4229e5f7ac5f02e20a630d1ffd`。

`snapshot().localChosen` 在 `state.json` 中记录用户已选择本引擎作为 Reflex 接入方式。`chooseLocal()`、`select()`、`prepare()` 与启用会设置它。设置期间，`jev` 条目的 volatile 字段 `defaultProviderId` 指向 `providerId`，因此本机模式下 Jev 从不使用其内置 provider：`chooseLocal()` 写入该字段，在无法运行引擎的设备上会被拒绝，因此在那里选择本机模式不会让仍可用的云端 provider 失效；已选择本机模式却缺少该字段时，激活会恢复它，并把这种被删除的路由视为本机判断已停用。它在 `disable()`、删除、runner 失败、Reflex 总开关切换与重启后保留，只在 `jev` 条目的 `defaultProviderId` 指向其他 provider 时清除，客户端保存非本机接入方式时会写入该值。激活时路由已指向此 provider 也会设置它。`enable()` 先启动生效模型的 runner，再开启本机判断（以 `localEnabled` 保存在 `state.json`），并通过 config editor 把路由指向此处，不重载 Jev；runner 无法启动时报告 `failed` 并拒绝。`disable()` 关闭本机判断并保留路由。`snapshot().enabled` 报告路由是否指向此 provider 且本机判断已开启。provider 的同步 `ready()`（由 `jev.isReady()` 读取）仅在本机判断与 Reflex 都开启、有生效模型且 runner 未失败时为 true，因此 System3 会直接跳过前置判断且不留记录，而不是让它们失败，`snapshot().reflexEnabled` 报告 Jev 总开关 `jev.enabled`，为 false 时所有 provider（包括此 provider）都会停止。provider 声明 `local` 执行域，因此 System3 准入把它的决策视为本机。自检后的自动启用还会在 `state.json` 记录 `unacknowledgedAutoEnableAt`，使客户端在重启后仍能提供撤销；`acknowledge()`、`disable()` 与删除生效模型会清除它，手动 `enable()` 从不设置它。

provider 用来回答的模型是 `snapshot().active`，准备过程在成功前不会改变它。对已下载、且该文件自检通过或测得较慢的模型，`select(variant)` 会立即让它生效：已接受的决策在旧 runner 上完成后旧 runner 停止；本机判断已启用时立即为新模型启动 runner，否则在下一次决策时启动。选择其他模型时在后台准备，当前生效模型继续回答；自检在独立进程中运行，通过且速度达标时该进程成为新的 runner，并在 `unacknowledgedSwitch` 中记录 `{ from, to, at }`，直到 `acknowledgeSwitch()`；撤销即选择 `from`。较慢的结果保留当前生效模型，并把该选项的 `inventory.selfTest` 标为 `slow`；再次选择它即切换。第一个通过且速度达标的模型还会启用尚未启用的本机判断。正在准备某个变体时选择另一个，会抛出错误码为 `preparing-other` 的 `ReflexLifecycleError`。`snapshot().options[].inventory` 报告 `absent`、带字节数的 `partial`，或带该文件最近一次自检结果的 `downloaded`；没有匹配记录的满尺寸文件（例如状态丢失后）为不带 `selfTest` 的 `downloaded`，选择它会计算哈希并自检，不重新下载；`snapshot().runner` 报告 `stopped`、`starting`、带权重大小（即约占内存）以及设置 `idleReleaseMs` 时空闲释放时间的 `running`，或 `failed`。

本机判断与 Reflex 总开关都开启时，生效模型的 runner 常驻，约占其权重文件大小的内存：它在 Host 激活、`enable()`、切换之后以及总开关在别处开启时启动。权重文件在页缓存中时，Apple M5 加载 4B Q8_0 约需 0.75 s；runner 加载期间到达的决策会等待加载，模型越大或缓存越冷等待越久。`disable()` 以及在别处关闭的 Reflex 总开关，会在进行中的决策完成后停止 runner；模型保留在磁盘上。设置 `idleReleaseMs` 时，空闲的 runner 也会停止，下一次决策再重启它。`deleteModel(variant)` 删除一个模型；删除生效模型会停止其 runner，清除 `active` 及相关提示，并关闭本机判断。删除从不改变路由与本机模式，因此客户端仍显示本机模式，下一个自检通过的模型会再次开启本机判断并给出提示。`remove()` 与 `deleteModel()` 删除全部模型。决策连续 `maxConsecutiveRunnerFailures` 次启动或传输失败后，引擎关闭本机判断（保留路由），并把 runner 报告为 `failed`，直到 `enable()` 或新的选择。预热从不计数；决策等待期间被切换、停止或删除退役的 runner 也不计数。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>维护者细节 — 点击展开</summary>

| 源文件 | 职责 |
|---|---|
| `src/index.ts` | `ReflexLocal` Service：开始检查、在嵌套的 `jev` 依赖中注册 provider、委托 `ReflexLocalService` |
| `src/engine.ts` | 准备状态机、生效模型与切换、`state.json`、自检、路由编辑、runner 归属与失败计数 |
| `src/models.ts` | 固定的模型目录、选项适配判断与自动推荐 |
| `src/download.ts` | 下载源探测、可续传下载、校验、失败分类、可用空间检查 |
| `src/runner.ts` | `llama-server` 进程、就绪判定、`/completion` 客户端、崩溃重启、空闲停止 |
| `src/device.ts` | 平台、内存与 runner 门控 |
| `src/contract.ts` / `src/provider.ts` | 训练契约 prompt 渲染与 Jev provider |

启用时先读 `state.json`，再检查权重：大小与修改时间与上次哈希校验指纹一致的文件直接采信，其余完整文件重新计算哈希，直到第一个通过校验为止。仍是已校验、已自检文件的生效模型恢复为 `ready`；否则清除 `active`。启动时不会让其他文件生效，因此作为生效模型被删除的模型保持未生效；唯一的例外是 0.1.3 写出的状态：它既没有 `active` 也没有 `localEnabled`，此时第一个仍能通过校验的已自检文件（即该版本使用的模型）成为生效模型。没有生效模型时，未自检的权重报告满字节的 `paused`，部分文件报告带字节数的 `paused`。Host 停止时留下的 `preparing` 记录会立即续上。检查结束前拒绝 `select()` 与 `prepare()`。

Service 只注入 `subprocess`；provider 注册放在嵌套的 `jev` 依赖中，因此 Jev 重载（例如修改非 volatile 的 Jev 设置引起的重载）只会重新注册 provider，引擎、runner 与下载都继续运行。

runner 在 `warm()`、`enable()` 或第一次决策时启动，参数为 `--host 127.0.0.1 --port 0`、`-np 1` 与 `--offline`；每次新生成的 32 字节 key 通过 `LLAMA_API_KEY` 传入（b11118 读取它，忽略 `LLAMA_ARG_API_KEY`），因此 key 不会出现在进程列表中。端口取自 stderr 的 `listening on` 行，之后 `GET /health` 必须返回 200，且 `GET /props` 不带 key 时返回 401、带 key 时返回 200；stderr 只保留有界尾部，仅写入 Host 日志。在 HTTP 层以下失败的请求会把进程标记为待替换，下一次获取时重启。自检在新进程上以 `cache_prompt: false` 运行参考 prompt 两次并测量第二次，因为第一次包含一次性的 GPU 初始化。

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

与主生成路由相互独立。runner 只有一个 slot，同一请求的各问题复用共享状态前缀；状态不同或 runner 停止都会使复用失效。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

- **仅支持 macOS arm64** — runner 随 macOS arm64 桌面 runtime 分发；其他 Host 报告 `platform`。
- **只有下载后才发现 Metal 不可用** — `inspectDevice` 检查平台、总内存与可执行的 runner，但不检查 Metal 设备是否可用。虚拟机或 Metal 初始化失败的 Mac 会被报告为受支持；准备阶段先下载权重，之后若 runner 启动超过 `startupTimeoutMs`，自检失败；若 ggml 回退到 CPU（约每秒 100 token，低于 `minPrefillTokensPerSecond`），自检报告 `slow`。待办：在下载前用有时限的 `--list-devices` 探测，要求存在 `MTL0` 设备，并报告专门的不支持原因。
- **自检吞吐在短 prompt 上测量** — 参考 prompt 约 120 个 token，固定开销占主导；Apple M5 测得约每秒 400 token，长 prompt 约 1,000。默认值 150 仅在 M5 上校准。
- **外部路由变化靠轮询发现** — `snapshot()` 每次调用都读取 `enabled` 与 `reflexEnabled`，Reflex 总开关的变化通过 Jev 的 `jev/enabled` 事件立即到达 `follow()` 与 runner；在 Reflex 设置页修改的 `defaultProviderId` 要到下一个 `routingPollMs` 周期才被看到。
- **模型加载会延迟启动与切换后的决策** — Host 启动时以及 `select()` 切换模型后，Jev 已路由到此 provider 而 runner 仍在加载，这期间的决策会等待加载；只有 `enable()` 先加载再改路由。
- **后台切换会短暂运行两个进程** — 候选模型在独立进程中自检，同时当前生效模型继续服务，因此切换完成前内存峰值是两个权重文件之和。
- **超出内存档位的模型加载时可能拖慢整台 Mac** — `allowUnfit` 允许大于内存档位的权重；runner 进程可能大量换页，直到失败或超过 `startupTimeoutMs`。失败只发生在该进程中，不计入 `maxConsecutiveRunnerFailures`。
- **35B-A3B 尚未在 Mac 上实测** — 在 Mac 实测确定档位与速度预期之前，这些选项保持实验状态。
- **契约输入缺口** — 训练契约拒绝空或仅含空白的 state 与 instructions，但 Jev 校验只要求 instructions 非空，这类请求仍会被渲染。形如整数的 choice key 在分配字母时遵循 JavaScript 键顺序，而不是插入顺序。

-----

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者细节 — 点击展开</summary>

设置 `REFLEX_LOCAL_RUNNER` 与 `REFLEX_LOCAL_WEIGHTS` 时，`tests/engine.e2e.ts` 使用真实 runner，再设置 `REFLEX_LOCAL_SWITCH_WEIGHTS` 时还会验证真实的 4B→9B 切换；单元测试使用 `tests/fake-llama-server.fixture.mjs`，它读取与真实 runner 相同的参数与 `LLAMA_API_KEY`，输出相同的 stderr 行，并以相同字段响应 `/health`、`/props` 与 `/completion`。

</details>
