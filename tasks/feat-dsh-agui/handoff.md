# feat-dsh-agui — M1 交接（AG-UI over HTTP 桥）

总方案：xDAN-System3-PersonalAgent-App 仓库 `docs/main/system3-dsh-muse/plan.html`。本分支只做 M1。

## 1. TL;DR
- 目标：让 OpenMuse（`AGENT_BACKEND=agui`）或任意 AG-UI `HttpAgent` 通过 HTTP 驱动 DSH agent；线程 id = Session id，DSH 日志是唯一事实源。
- 状态：**M1 完成**。新包 `packages/experimental/agui`，5/5 测试，oxlint / `tsc -b tsconfig.host.json` / doc-standard / 翻译配对全过。
- 分支基于 `feat-system3-foundation`（P0 已推送的 4 个提交之上）。
- 下一步：M1.5 在 App 仓库写 `DshThreadStore`，把 `/api/threads` 与回放代理到本桥。

## 2. 本轮交付物
| 文件 | 说明 |
|---|---|
| `packages/experimental/agui/src/index.ts` | 插件入口：Bearer 准入、按线程缓存 `AgentHandle`（live / resume / create）、路由分发、审批与提问的 pending 表、dispose。 |
| `src/run.ts` | `driveRun`：`followup` 用户消息，`agent/inbox/claimed` 关联 turn，`agent/assistant-stream` 帧 → TEXT/REASONING/TOOL_CALL 事件，`session/event` 的 `tool/result`、`turn/end` → RESULT / RUN_FINISHED / RUN_ERROR；`subagent/start|end` → SUBAGENT_*。 |
| `src/projection.ts` | 持久化事件 → AG-UI `user/assistant/tool` 消息（只取 `source.kind==='user'` 的用户消息）。 |
| `src/agui.ts` | 本地 AG-UI 类型子集 + `SseWriter`（`data: <json>` 帧）。不依赖 `@ag-ui/*`。 |
| `src/http.ts` | Bearer 常量时间比较、有界 JSON body、`HttpError`。 |
| `cordis.patch.yml` | `dsh --patch packages/experimental/agui/cordis.patch.yml --profile web --no-open` 即可挂载。 |
| `tests/harness.ts`, `tests/agui.spec.ts` | 真实 AgentLoop + JSONL 持久化 + 测试 sessionQuery + `WebServer(port 0)`，走 HTTP 调路由。 |
| `README.md/.zh.md/.i18n.yaml` | package-reference 文档；`packages/experimental/README*` 加了一行。 |
| `tsconfig.host.json` | 新增 reference。 |

## 3. 设计约束
- 路由：`POST /agui/run`、`GET|POST /agui/threads`、`PATCH /agui/threads/:id`、`GET /agui/threads/:id/messages`、`POST /agui/approvals/:id`、`POST /agui/questions/:id`。全部 Bearer。
- 事件：标准 AG-UI 0.0.59（含 `REASONING_MESSAGE_*`、`SUBAGENT_*`）；只有审批/提问用 `CUSTOM`（`dsh.approval` / `dsh.question`）。
- 一个线程同时只允许一个 run（409）；客户端断开即 `agent.cancel`。
- 可选服务（sessionQuery / sessionTitle / workspaceRegistry / sessionPersistence / loader）通过 `ctx.get` 按需读取，缺失时对应路由 501；`inject` 只声明 `agents, sessions, webServer`。
- DSH 不直接暴露公网；Muse Server 同机代理。

## 4. 已踩坑 / 真实行为
- **worktree 必须先 `pnpm run build:native-system`**，否则 JSONL 持久化 flush 时 `flock` 找不到 `native/system/packages/darwin-arm64/bin/system.node`（表现为 `POST /threads` 500）。`pnpm test` 会自动构建，单跑 `vitest` 不会。
- `tsc -p <package>` 单包会因 project references 未构建而报 TS6305，须用 `tsc -b tsconfig.host.json`。
- vendored cordis 的 `inject` 只用数组形式；`{required, optional}` 对象形式仓库内无先例，未采用。
- `agentEvents(ctx, agent).waterfall('approval/request', payload, next)` 的 payload **不含** `agent`（由 scope 注入）。
- `sessionQuery.readTitle()` 返回 `SessionTitleSnapshot | null | undefined`，取 `.title`。
- `Array.isArray()` 会把 `unknown` 收窄成 `any[]`，oxlint `no-unsafe-*` 会报；用类型守卫 `every(isMessage)`。
- 测试里对 SSE 用 `while (await next())` 轮询时，若流已结束会形成微任务饥饿、vitest 超时无法触发——`next()` 必须先消费已到达事件再等待，并对 `undefined` 退出。
- Agent 被 dispose 后 `res.on('close')` 里再 `cancel` 会抛 "projection registration is not active"，需先校验 `runs` / `ctx.agents.get` 再 try/catch。
- 翻译配对：新增/修改 README 后跑 `pnpm run verify-translation-pairing --write <README.md>`，再跑无参检查。
- **`--patch` 是全局启动参数，必须放在 `--profile` 之前**，否则 profile 子命令报 `unknown option '--patch'`。
- **Web profile 里的 plugin 只能从 `apps/cli/package.json` 的 `dependencies`/`peerDependencies` 解析**（`packages/boot/app-boot/src/profile.ts:profileDependencyNames`），根 `package.json` 或 apps/cli 的 `devDependencies` 都不算；否则 loader 只报一句 `failed to import`（真实错误只进 `ctx.logger.error`，终端看不到）。已把 `@deepseek-ai/dsh-experimental-agui` 加进 apps/cli `dependencies`（先例：agent-team-profile、voice-input-bundle），`verify-default-product-isolation` / `web-product-bundle-isolation` 99/99 通过。
- Web profile 启动前需 `pnpm run build`（客户端 bundle），源码模式也不例外。
- 已用真实 `dsh --patch … --profile web --no-open --port 3095` 验证：`GET /agui/threads` 200、无 token 401、`POST /agui/threads` 201、再次列表含新线程。

## 4.5 真实模型链路（2026-09-28 已验证）
- Overlay：`docs/feat-dsh-agui/fidoo-agui.patch.yml` → `llm-pi-ai` 的 `fidoo` provider（`https://proxy.fidoo.ai/v1`，key 取 `SYSTEM3_LITELLM_API_KEY`），默认模型与 agui 均为 `deepseek-v4-flash`。
- Fidoo registry 当前只有 `deepseek-v4-flash`（上游 `deepseek/deepseek-v4-flash`，1M in / 393k out），**没有 4.1 别名**；有了之后改 overlay 里两处 model id。
- 启动：`export DSH_AGUI_TOKEN=…; export SYSTEM3_LITELLM_API_KEY=…; pnpm dsh --patch packages/experimental/agui/cordis.patch.yml --patch docs/feat-dsh-agui/fidoo-agui.patch.yml --profile web --no-open`
- 结果：`/agui/run` 流 `RUN_STARTED → TEXT_MESSAGE_* → RUN_FINISHED(success)`，回复 `READY`；`/threads/:id/messages` 回读正确；Muse 侧 `@ag-ui/client` `HttpAgent` 直连同一端点通过 schema 校验并拿到回复。`reasoningEffort: low` 下未观察到 reasoning 流。

## 5. 下一里程碑
- [ ] M1.5（App 仓库）：`DshThreadStore` 代理本桥；`AGENT_URL=<dsh>/agui/run`；手机端渲染 `dsh.approval` / `dsh.question` 卡片。
- [ ] 线程 `updatedAt`（需读日志尾部或 persistence revision）。
- [ ] `SUBAGENT_*` 事件按线程后代过滤（需 subagent runtime 暴露父 agent）。
- [ ] M3：`subagent-codex/src/wire.ts:571-620` 审批/提问改为经 `ctx.approval.request` 上抛（用户硬性要求：不允许自动拒绝）。

## 6. 分支状态
- 分支 `feat-dsh-agui`，worktree `.Codex/worktrees/feat-dsh-agui`。未创建 PR。

## 7. 冷启动 checklist
1. 读本文件与 App 仓库的 `docs/main/system3-dsh-muse/plan.html`。
2. `pnpm install --offline && pnpm run build:native-system`。
3. `npx vitest run packages/experimental/agui`。
4. 手动联调：`export DSH_AGUI_TOKEN=...; pnpm dsh --patch packages/experimental/agui/cordis.patch.yml --profile web --no-open`，然后 `curl -N -H "Authorization: Bearer $DSH_AGUI_TOKEN" -d '{"threadId":"t1","runId":"r1","messages":[{"role":"user","content":"hi"}]}' http://127.0.0.1:3080/agui/run`。

## 4.6 Persona（2026-09-28）
- 客户端每次 run 在 `forwardedProps.persona = { name, tone }` 传人格；桥在 agent scope 内用同名空 section 遮蔽 `harness:identity`、`harness:source`、`app:web-surface`，并以 `deployment:persona-prefix` 注入 "You are <name>, the person's private agent in xDAN System3 Personal Agent…"。只影响桥驱动的会话，DSH Web/CLI 不变。
- 未传 persona 时默认 `{ name: 'Muse', tone: 'warm' }`。
- **Web profile 加载的是 `packages/experimental/agui/lib/index.js`，改 src 后必须重建**（`pnpm exec tsc -b tsconfig.host.json && pnpm exec tsdown`）再重启 DSH；vitest 读 src，测不出这类问题。
- 实测：Muse 设身份 Nova/concise → 新线程回答"我是 Nova，你在 xDAN System3 Personal Agent 里的私人智能体"，不再报 Web GUI 地址 / 沙箱 / 审批策略。
- 待办：部署时把 agui `defaultCwd` 设为用户专属工作区（现在默认是 DSH checkout，模型会提到 worktree 名）。

## 4.7 仓库与目录改名（2026-09-28）
- GitHub：本仓库为 `cryptoSUN2049/xDAN-System3-PersonalAgent-Harness`（旧名 `xDAN-System3-DSH` 自动重定向）；App 为 `xDAN-System3-PersonalAgent-App`。
- 本地：`~/Documents/Code/xDAN-System3-PersonalAgent-Harness`，旧路径 `~/Documents/Code/xDAN-System3-DSH` 为软链接；worktree 已 `git worktree repair`。
- 分支名不变：`feat-system3-foundation`、`feat-dsh-agui`。
- 待合并时处理：`docs/feat-system3-foundation/*` 与 System3 各包 `package.json` 中的旧仓库 URL（位于 Codex 在用的 foundation 分支，靠重定向工作）。
