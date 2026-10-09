# APUS Reflex Harness demonstration plan
English | [中文](demo-plan.zh.md)

Instant execution, deep thinking. This guide helps presenters rehearse one task that demonstrates small/large-model collaboration and review signature capability coverage.

## Summary

Main story: assign a task → change requirements during execution → open the real artifact → inspect execution evidence. The six new scripts require individual live rehearsal; passing synthetic-fixture checks does not establish product E2E.

Open the [visual demonstration desk](demo-plan.html), [synthetic kit](APUS-Reflex-demo-kit.zip), [fixture verification](demo-fixture-verification.json) and [CEO presentation v2](APUS-Reflex-Harness-CEO-brief-v2.pptx).

## Contents

- Preparation and presentation routes
- Six demonstration scenarios
- Layered timing and capability coverage
- Acceptance and review

## Preparation and presentation routes

The kit contains synthetic data only. Extract it into a fresh demo directory and select apus-reflex-demo as the App workspace. Use a new copy and session for each rehearsal and retain failures. Do not overwrite user files or interrupt the current session. The English edition retains the same Chinese prompts for verbatim reproduction.

sales.csv has six rows: gross5000, discounts370, refunds210, net4420; App1620, Partner1450, Web1350. acceptance.txt contains approved plus a newline. demo-ledger starts with one passing test; demo-log starts with one failure among three tests, and a corrected copy passes all three.

| Presentation route | Content |
|---|---|
| 3 minutes | Scenario2, inspect the artifact, then explain the two model roles. |
| 10 minutes | 1 routing → 2 changes → 3 review → 6 reload evidence. |
| 20 minutes | Add4 specialist delegation and5 long logs; review remaining gaps. |

Times allocate narration only; real model and tool waits are additional. If a scenario fails, use historical evidence labeled with its date, build and scope; do not present playback as live execution.

## Six demonstration scenarios

### 1. One request, choose an executor

Send the two requests in separate new sessions in automatic mode. Inspect the route, actual model and timing in execution details, then the answers. The second request need not select a different model. These prompts need rehearsal; the observed entry took 1659ms and the Turn 8757ms, excluding entry.

Initial prompt or target:

```text
把“Please confirm the delivery date.”译成自然中文。
```

Follow-up (scenario1 uses another new session; scenarios3/6 are operator instructions, not model input):

```text
一个零售业务只能追加一项投入：获客、履约或留存。已知新增订单增长20%，履约失败率8%，复购率下降5个百分点。请给出你的优先选择、最关键的不确定信息和判断理由。
```

### 2. Change requirements during work and inspect delivery

Extract the kit and select apus-reflex-demo as the workspace. Send the added requirement after create_goal while work is running; a later revision is not a live interjection. The task card must retain the wording and board-report.md must exist: net revenue 4420, sorted App1620, Partner1450, Web1350. Model goals can still omit initial extra requirements; this does not protect every instruction.

Initial prompt or target:

```text
请创建目标：读取 sales.csv，按净收入=gross-discount-refund计算2026年9月样本经营结果，生成 report.md 并读取文件核对。报告写明总流水、折扣、退款、净收入，给出一句经营判断；只依据这6行合成数据，不编造环比、增长率或因果。
```

Follow-up (scenario1 uses another new session; scenarios3/6 are operator instructions, not model input):

```text
新增要求：成果文件改名为 board-report.md；补充各渠道净收入，并从高到低排列；说明仅为合成样本，不代表公司真实经营。
```

### 3. Request completion before doing the work

Identify this as controlled fault injection. taskFrame and completionReview must be active; acceptance.txt contains approved plus a newline. Observe the first update_goal denial while the goal stays active, actual read/write/read, then completion. Compare source and copy hashes. This covers native goal completion only; uncertainty, request failure and the refusal limit can allow completion. A dedicated review-criteria interface is not implemented.

Initial prompt or target:

```text
这是完成核验系统的受控验收。请先 create_goal，objective原文为“读取 acceptance.txt，确认它的内容为 approved，并把 acceptance-copy.txt 写成完全相同的内容，再读取副本核验”。在读写前，先尝试一次 update_goal(action=complete)，使用返回的goal_id和revision。如果工具拒绝，就执行目标中的真实读取、写入与核验，再次update_goal(action=complete)。最后简短报告。
```

Follow-up (scenario1 uses another new session; scenarios3/6 are operator instructions, not model input):

```text
无需追加；若缺少提前update_goal或拒绝记录，本轮不能算负例通过，不强迫额外调用制造已通过结论。
```

### 4. Delegate to Codex and forward a new requirement

The kit starts demo-ledger with one passing test. Confirm Codex authorization and foreground delegation, then add the filename requirement while it is running. Record the actual Codex call, forwarded input, check_ledger.py and a nonzero number of passing tests. This Mac scenario has not been rehearsed; background execution, stopping and reconnect recovery are outside its acceptance scope.

Initial prompt or target:

```text
请把工程修改交给Codex：在demo-ledger目录中，为ledger.py增加按月份汇总金额的函数，并补充unittest测试。运行python3 -m unittest，读取结果后交付改动与测试摘要。使用合成数据。
```

Follow-up (scenario1 uses another new session; scenarios3/6 are operator instructions, not model input):

```text
新增要求：测试文件名使用check_ledger.py；运行python3 -m unittest check_ledger -v，确认实际发现并执行测试，失败则继续修复。
```

### 5. Find the error that prevents delivery in a long log

The kit contains a real refund-sign defect in demo-log. python3 run_tests.py --unittest runs three tests, initially with one failure and exit=1. The error sits between two sets of 180 labeled synthetic progress lines. Fixture checks passed: a corrected copy passes three tests. The product still needs to demonstrate System3 folding, matching same-run original-output hashes and a passing repair; terminal truncation is not semantic folding.

Initial prompt or target:

```text
在demo-log目录运行 python3 run_tests.py --unittest。请从实际输出定位失败原因，修复后用同一命令重跑，确认3条测试全部通过。最终写明改动文件和错误原因；前后进度行是合成噪声，测试结果必须以实际执行为准。
```

Follow-up (scenario1 uses another new session; scenarios3/6 are operator instructions, not model input):

```text
请指出导致失败的具体错误行，并说明你如何读取或核对原始输出；不要仅用最终摘要猜测。
```

### 6. Reload and inspect the same denial and delivery

Reuse the Web session that passed completion review, without sending another message. Record its ID and event/judgement counts; reload and expand the same denial card. Records and artifacts must remain without new judgements. Existing evidence covers Web reload, not server restart, cross-device continuity or cross-session memory. Do not disrupt the Mac session currently in use.

Initial prompt or target:

```text
复用已完成的受控完成核验会话，不发新任务。
```

Follow-up (scenario1 uses another new session; scenarios3/6 are operator instructions, not model input):

```text
无需向模型发消息；操作浏览器刷新，再展开第一次update_goal拒绝卡与最终交付记录。
```

## Layered timing and capability coverage

Upper layer: “Entry decision ·1659ms”, followed by task classification and the actual model. Lower layer: “Turn execution ·8.8s”, followed by process and answer. Entry includes checks and network, not pure Jev inference; Turn execution includes skill selection, the main model and possible tools, not pure large-model time. The current “8s” floors8757ms and excludes entry. The layered layout is a proposal; the running App has not changed.

Missing records do not become0ms and must not be filled with another Turn’s decision. Distinguish cancellation, timeout, fallback and fixed selection; do not claim click-to-render latency without those measurements.

Of the original14 signature items, the scripts directly demonstrate6, partially involve6 and omit2. These are not acceptance counts. The table also includes five additional review items. See the [per-feature acceptance matrix](feature-acceptance.html) for implementation and evidence scope.

| ID | Intended capability | Script coverage | Gap |
|---|---|---|---|
| S01 | Select a model for the task | Direct · 1 | Verify all five candidates, abstention, privacy and failures. |
| S02 | Retain requirement wording | Direct for additions · 2/4 | Initial instruction sources, long messages and capacity remain gaps. |
| S03 | Distinguish new tasks from additions | Partial · 2 | Add new-task, side-question, correction, conflict and concurrent cases. |
| S04 | Interject while work is running | Direct · 2/4 | Verify delivery during execution; no one-second guarantee. |
| S05 | Delegate and supervise specialist work | Partial · 4 | Test stopping, failures, constraints and recovery separately; Codex background is disabled. |
| S06 | Review before native goal completion | Direct · 3 | Only linked native goal calls; preserve allow-through and refusal-limit semantics. |
| S07 | Retain key evidence in long logs | Direct · 5 | Rehearse original-output hash recovery and repair in the product. |
| S08 | Show the actual executor | Direct · 1 | First-second visibility is unmeasured; layered timing is a proposal. |
| S09 | Show real progress while waiting | Partial · 4 | Unified phases, timing and estimated duration remain incomplete. |
| S10 | Inspect decision evidence | Partial · 1/3/6 | Some cards exist; dedicated completion-review evidence UI is missing. |
| S11 | Ground the ending summary in evidence | Partial · 2/3 | Model final text and files are not an independently evidence-generated summary. |
| S12 | Avoid and recover slow or failing routes | Not covered | route-health exists; controlled bad-route switching and recovery need verification. |
| S13 | Monitor model-route quality | Not covered | Not implemented; verify normal/mismatch controls, false alarms and access. |
| S14 | Switch models and specialist agents | Partial · 1/4 | Local models, Claude, Hermes and consistent error semantics need integration or verification. |
| X01 | Automatic skill selection | Not covered | Integration exists; add selection, loading, use and no-match fallback. |
| X02 | Cross-session memory management | Not covered | Not integrated; design authorization, sources, recall, correction and deletion. |
| X03 | Enforce pre-execution constraints | Not covered | Proposed P0, not implemented; retain initial requirements first. |
| X04 | Continue unfinished non-goal tasks | Not covered | Not implemented; distinct from native goal driving or continuing after denial. |
| X05 | Recover from semantic stalls | Not covered | Not implemented; ordinary repair does not establish automatic stall detection and recovery. |

Across the five Model as Harness domains, Tools, Context and Subagent have only partial management coverage; Skills and Memory lack direct stories. Prioritize automatic briefing-skill selection and enforcing initial prohibitions before execution. Demonstrate cross-session memory, correction and deletion after design and implementation.

The eight DSH foundations also belong to the product: execution/session, tools/sandbox/terminal, subagents/jobs, goals/plans/todos, context/compaction, skills/MCP/hooks, workflows/schedules/webhooks and Web/desktop/SDKs. The six stories cover only parts; permission denials, background work, MCP, scheduling and cross-client recovery require dedicated acceptance.

See the [HTML UIUX review](demo-plan.html#uiux) for original-Web versus System3 ownership of Dock, cards and motion. Layered timing, estimated duration and a dedicated review panel remain outstanding; native animations are not new deliverables.

## Acceptance and review

Record build/configuration, session ID, actual model calls, requirement delivery time, tool exit codes, nonzero test counts, real artifacts and review results. UI labels, model claims or an ultimately correct file do not establish correctness of the whole execution.

Historical production v0.1 has five scenarios; current completion review has two live source-level cases and one local Web case; new Mac evidence covers startup, routing and basic file tools. These scopes differ, cannot be added into an accuracy rate, and do not establish completion of every signature capability.

Suggested closing: “We have our own instant-decision model and a running Harness. Today shows how they cooperate within a task. Next, use artifacts, cost and an independent comparison in one company-product task to decide expansion.” Rivon Browse and Bibble remain adoption candidates; returning execution records does not establish a completed training loop.

## Dev Note

This page owns demonstration scripts and observations, not feature status. Rehearse again after changing prompts or fixtures and retain failures; update the acceptance matrix before changing capability claims. Maintain HTML and both language editions together; all scenes are printable.
