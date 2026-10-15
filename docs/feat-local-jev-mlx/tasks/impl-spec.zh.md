# 本机决策引擎实现规格（给并行实现者）

[English](impl-spec.md) | 中文

权威设计：[../local-jev-mlx-design.zh.md](../local-jev-mlx-design.zh.md)。本文件只固定**包划分、文件归属、跨包接口与已实测的决定**。所有实现者先读仓库根 `AGENTS.md`（= `CLAUDE.md`）、`packages/AGENTS.md`、`docs/testing.md`，并遵守：逐文件 100% 覆盖、导出必须有 JSDoc、客户端文案走 locale 字典、`.ts` 本地相对导入、ESM、注册是 effect、空 catch 写明原因、禁止 `as unknown`。

## 包划分

| 包 | 路径 | 角色 |
| --- | --- | --- |
| `@deepseek-ai/dsh-experimental-reflex-local` | `packages/experimental/reflex-local` | Host：设备门控、权重下载（Range 续传）、llama-server 进程、契约渲染、Jev provider、准备状态机、`ctx.reflexLocal` 服务 |
| `@deepseek-ai/dsh-experimental-api-reflex-local` | `packages/experimental/api-reflex-local` | Typert Remote，命名空间 `reflexLocal`，照 `api-speech-to-text` |
| `@deepseek-ai/dsh-experimental-client-ui-reflex-local` | `packages/experimental/client-ui-reflex-local` | 客户端：插件详情页单主按钮卡片、激活提示、撤销 Toast，照 `client-ui-voice-input` |
| `@deepseek-ai/dsh-experimental-reflex-local-bundle` | `packages/experimental/reflex-local-bundle` | 可选 bundle：`cordis.patch.yml` + icon + locale，照 `voice-input-bundle` |
| runner 平台包 | 见打包调研结论 | llama.cpp `b11118` macOS arm64：`llama-server` + 10 个 dylib，按 soname 物化 |

共享类型已写好：`packages/experimental/reflex-local/src/types.ts`（`ReflexSnapshot`、`ReflexPreparation`、`ReflexLocalService` 等）。改它需要同步所有消费者。

## 已实测、不可改的决定

1. **noul 一律渲染为契约的 `noul` 原语 + 规范是非候选**（`yes`: "The stated proposition is true." / `no`: "The stated proposition is false."），调用方 `criteria.true/false` 文案**不进 prompt**。实测（M5，4B Q8_0，真实 task.frame 请求）：把 true/false 文案渲染成二选一 choice 时，`correction` 给 0.020，云端 9B 为 0.947，结论反转；规范 noul 给 0.759。
2. `choice`：`criteria` 按对象插入顺序映射 A–P；`score`：有序档位按下标映射 A–P 渲染为 `choice`，本机还原 `score = Σ i·pᵢ`。超过 16 个候选 → `JevProviderError({ code: 'invalid-response' })`。只有 1 个候选 → 不调模型，概率 1。
3. 缺 `instructions`：choice/score 用 `Choose the best candidate.`，noul 用 `Judge whether the proposition in the shared state is true.`（契约要求非空）。
4. `state`：字符串原样；其余 JSON 按 Python `json.dumps(state, ensure_ascii=False, sort_keys=True)` 渲染（键按 Unicode 码点排序、分隔符 `", "`/`": "`、浮点按 Python `repr`）。任务段同样用 Python 规则。黄金样例由 `tests/fixtures/generate-contract-golden.py`（复制模型仓库 `openjev_contracts.py` 的渲染）生成并入库，TS 逐字节比对。
5. chat 包装：`<|im_start|>user\n{prompt}<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n`。
6. 每问一次 `POST /completion`：`{ prompt, n_predict: 1, n_probs: 1024, temperature: 0, cache_prompt: true }`，读 `completion_probabilities[0].top_logprobs[].{token,logprob}`；任一候选字母缺失 → `invalid-response`；在候选上 softmax 归一。
7. `confidence = 1 − H(p)/ln(n)`（H 为自然对数熵；n 为候选数；n=1 时为 1）。由云端回执反算验证：`[0.9971, 0.0015, 0.00055, 0.0008]` → 0.9838。
8. 组装的 `JevResponse` 必须再过 `parseJevResponse(response, request)`。`model` = provider `info.model`；`usage = { input_tokens, cached_tokens, output_tokens }`（Σ prompt_n、Σ cache_n、问题数）。
9. runner 启动（key 经环境变量 `LLAMA_API_KEY` 传入，不出现在 argv；b11118 不认 `LLAMA_ARG_API_KEY`；启动时要求 `GET /props` 无 key 401、有 key 200）：`llama-server -m <gguf> --host 127.0.0.1 --port 0 -c 9216 -np 1 --no-webui --offline --log-colors off`；端口在 **stderr** 的 `listening on http://127.0.0.1:<port>` 行（此行出现时模型已加载）；之后 `GET /health` 200 才就绪；stderr 持续排空，只保留有界尾部做诊断。
10. 本机失败一律映射既有 `JevErrorCode`：未启用/未就绪/进程崩溃 → `transport`；超时 → `timeout`；候选问题 → `invalid-response`。

## 跨文件接口（reflex-local 内部）

```text
// src/runner.ts (runtime implementer)
export interface ReflexCompletion {
  readonly logprobs: ReadonlyMap<string, number> // first generated position token → logprob
  readonly promptTokens: number                  // timings.prompt_n
  readonly cachedTokens: number                  // timings.cache_n
  readonly promptMs: number                      // timings.prompt_ms
}
export interface ReflexRunnerClient { complete(prompt: string, signal: AbortSignal): Promise<ReflexCompletion> }

// src/contract.ts (contract implementer)
export function pythonJson(value: JsonValue): string
export function renderPrompt(state: JsonValue, primitive: 'choice' | 'noul', instructions: string, descriptions: readonly string[]): string

// src/provider.ts (contract implementer)
export interface ReflexProviderOptions {
  readonly id: string; readonly model: string; readonly endpoint: string
  /** Returns a ready runner; throws JevProviderError(transport) when not enabled or not ready. */
  acquire(signal: AbortSignal): Promise<ReflexRunnerClient>
  /** Warm-up: starts the process and loads the model. */
  warm?(signal?: AbortSignal): Promise<void>
}
export class ReflexJevProvider implements JevProvider { constructor(options: ReflexProviderOptions) }
// Within one provider, all questions of a request run serially, holding a provider-level mutex until the request ends.
```

## 启用 / 停用的语义

- 本机 provider 始终注册（`ctx.jev.register`），id 默认 `reflex-local`。
- 引擎 Config `cloudProviderId?: string`：
  - **设置时**（System3 桌面，云端 Jev 已存在）：`enable()` 用 `ctx.configEditor.edit()` 把 `jev` 条目的 **`defaultProviderId`** 改为本机 id（`providerId` 是内置 System One 的注册 id，不能改），并把 `system3` 条目的 `jevExecutionDomain` 改为 `'local'`；`disable()` 把 `defaultProviderId` 改回 `cloudProviderId` 与 `'network'`。需要 `configEditor`，缺失则加载时报错。
  - **未设置时**（独立 bundle，本机是唯一 provider）：`enabled` 持久化在 `${dataRoot}/state.json`；停用时 provider 抛 `transport`，System3 回落 baseline。
- 自检通过且不慢 → 自动 `enable()`；客户端收到 `enabled` 从 false→true 时弹带「撤销」的 Toast，撤销调用 `disable()`。

## runner 分发（定稿：随桌面 primary runtime）

- **不做 npm 平台包。** 可选 bundle 的依赖图会被每次 `dsh` 安装下载，仓库政策只接受语音的 sherpa 作为原生先例；asar 内的无扩展名可执行文件也无法 spawn。
- llama-server 随**桌面 primary runtime** 分发：`scripts/primary-runtime/lock.json` 的 `mac-arm64` 目标新增 `llamaServer { version: "b11118", url, sha256 }`；`prepare.ts` 下载、校验 sha256（`ca0ea3156257b21eeb11d0628f2baecd3928013a3d060e2e192042276e5b1f35`）、只取 `llama-server` 与其 `@rpath` dylib、把符号链接按 soname 物化为实体文件，放到 `dependencies/llama-server/`；冒烟 `llama-server --version`。primary runtime 在 extraResources（asar 外），已被 `sign:primary-native` 逐个签名，不需要新 entitlement。
- 桌面 Host 把 primary runtime 安装到 `$DSH_HOME/dsh-runtimes/dsh-primary-runtime`。引擎 Config `runnerPath?: string`（绝对路径）；bundle 用 `!!js dshHomePath('dsh-runtimes', 'dsh-primary-runtime', 'dependencies', 'llama-server', 'llama-server')` 设置。文件不存在或不可执行 → `device: { supported: false, reason: 'runner-missing' }`，UI 说明原因，不报错。

## 根配置

`tsconfig.base.json` 路径、`tsconfig.host.json`（reflex-local、api-reflex-local、reflex-local-bundle）与 `tsconfig.client.json`（client-ui-reflex-local）引用已由协调者加好，`pnpm install` 已跑过。**实现者不要改** 根 tsconfig、`apps/cli/package.json`、`OPTIONAL_BUNDLES`，需要时在报告里提出；修改 `package.json` 依赖后只在报告里列出，由协调者统一 `pnpm install`。不要提交 git。

## Jev 插件字段（2026-10-14 定稿）

- `providerId`：内置 System One 的注册 id，只在设置 `endpoint` 时使用，默认 `system-one`。
- `defaultProviderId`：请求未指定 provider 时选用的 id，默认等于 `providerId`。独立 bundle 写 `defaultProviderId: reflex-local`（不设 `endpoint`）；System3 桌面的启用/停用只改这个字段。
