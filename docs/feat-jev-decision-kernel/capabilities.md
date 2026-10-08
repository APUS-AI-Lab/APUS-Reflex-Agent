# System3 capabilities compared with stock DSH

English | [中文](capabilities.zh.md)

Stock DSH (0.1.7-rc.2) provides the agent base: the agent loop, model providers, tools, subagents, goals, todos, Skills, compaction, sandbox and approval, Session persistence, and the Web and desktop clients. System3 is a plugin layer on top of it that acts as the agent's steward and the manager of model routing; every capability uses a documented DSH extension point and the agent loop is unchanged. Plan: [steward-plan.html](steward-plan.html); task progress: [tasks/task.md](tasks/task.md).

"Acceptance" means a check done as a person in a browser on the public site system3.xdan.work; items marked `accept.py` are in the replayable [browser acceptance suite](../../deploy/system3/acceptance/README.md).

## Implemented

| Capability | Stock DSH | What System3 adds | Evidence and acceptance |
|---|---|---|---|
| Model choice | The person picks one model for the whole Session | Entry routing: for each message Jev chooses among DeepSeek Flash and Pro (official API), GPT-5.6 and GPT-6 (relay), and delegation to Codex; "交给 codex" delegates directly; an unsure decision keeps the previous route; images go only to models that accept them; degraded routes are avoided | prd sends translations to Flash and reasoning to a stronger model, deciding in 0.3–1 s; `accept.py routing` |
| Jev connection | None | Keep-warm, and a reopened connection pool after consecutive requests without a response | #23 |
| Skills | The person invokes `/name`, or the model reads the catalog | Automatic Skill selection: Jev picks the best one and its body is injected | Deployed |
| Codex delegation | Codex and Claude Code subagent providers and a steer API; the client shows process cards | The whole delegation: an injected instruction; a hand-off pack carrying earlier requirements verbatim; progress snapshots; startup, stall, and overtime alerts; steer and stop in the dock; steers restated to the main model; a "handed to codex" composer marker | Codex runs finished in 56–309 s on prd |
| Process supervision | `dsh-guard` prevents loops | Process notices: repeated errors, too many failures, no progress, changes without verification (one reminder), failing commands inside a delegated run; failures masked by `; echo $?` or pipes | Rule-based, deployed; the 10-06 false positives and the 10-07 miss are fixed |
| Long output | Oversized output spills to a file by size | Lossless folding of test and build logs: a repeated run becomes "identical to lines …, starting with …" and expands back byte for byte | #25; 57–65% saved on real failing logs; `accept.py folding` |
| Goal and requirements | `/goal` stores the objective and continues while idle; the model reports completion | Task frame: the person's requirements are kept verbatim, shown to the model as runtime context and in the dock; a DSH goal sets the task, and an open goal is not replaced by chat | #26, #27; 126 labelled messages against the real Jev; `accept.py task-frame` |
| Messages during a turn | The person chooses queue or steer; queue waits for the turn to end | Mid-run routing: a requirement, correction, or interruption of the current task moves into the running turn and reaches a running Codex; side questions and remarks stay queued | #28, #29; `accept.py goal-interrupt`, `accept.py codex-forward` |
| Auditable decisions | None | Decision kernel: every Jev judgement is a Session event with the exact request and response and replays without model calls; privacy admission before every Jev call or route | #26 |
| Client | Process cards, goal bar, todos, queue | The System3 dock: route line, task card, interjection line, process notices, Codex card, decision details; a route line at the start of each turn; the composer delegation marker | Acceptance screenshots |
| Deployment | Local | Public system3.xdan.work (TLS, launch token with a 30-day cookie); atomic release and rollback; the browser acceptance suite | `deploy/system3` |

## Planned

- [ ] Completion review: before the model marks a task complete, check each requirement and acceptance criterion in the task frame (mu `goal.met`, `turn.completion`, `turn.continue`)
- [ ] Constraint guard: check modifying tool calls against the person's words (mu `tool.constraint`, `tool.risk`, `tool.approval`, `swarm.patch`)
- [ ] Jev review of drift: a semantic check after a supervision rule fires (mu `turn.drift`)
- [ ] Injection protection for external content: instructions aimed at the AI in web and MCP content are held back (mu `tool.injection`)
- [ ] Mid-run route escalation: a stuck run moves to a stronger model or to Codex (mu `swarm.routing`)
- [ ] On-demand tools and Skill disclosure, and clarification hints (mu `capability.disclosure`, `skills.disclosure`, `input.preflight`)
- [ ] Lessons memory: rules the person set are remembered across Sessions (mu `memory.*`)
- [ ] "Back to queue" for a moved message, once the server offers an atomic operation

## Limits

- Process supervision is still rule-based and the model still reports completion; System3 now keeps track of the task, delivers what the person says while work runs, and manages delegation, while judging whether the work is right waits for completion review and the constraint guard.
- The only change to DSH core is one runtime-context position for the task frame (`SYSTEM3_TASK_FRAME`).
