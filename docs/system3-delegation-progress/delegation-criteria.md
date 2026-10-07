# System3 delegation criteria: what besides time decides delegation

English | [中文](delegation-criteria.zh.md)

## Summary

Codex and Claude Code take only the highest-value, most complex, longest-running work. Time is one cost among four groups of factors: benefit, cost, risk, and control. Delegation pays when the success gain times the task's value exceeds time, money, attention, and risk. Measured data so far covers only time; the [delegation calibration](delegation-calibration.md) found no task where delegation raised the success rate. The decision rules follow [the decision method](decision-method.md#entry-decisions).

## Contents

- [Benefit](#benefit)
- [Cost](#cost)
- [Risk](#risk)
- [Control](#control)
- [Decision layers](#decision-layers)
- [Open questions](#open-questions)

<a id="benefit"></a>
## Benefit

| Factor | Delegation fits when | Signal |
| --- | --- | --- |
| Success gain | An owned model likely fails and Codex likely succeeds; this is the core reason to delegate | Only an evaluation shows it; none of the calibration tasks needed delegation |
| Engineering loop | The work needs repeated edit, run, read the error, and fix cycles, dependency installs, builds, or migrations | The request asks to keep going until tests or builds pass; the workspace has test or build commands |
| Exploration | The root cause is unknown and must be found in the repository, such as intermittent failures, performance problems, or an unfamiliar codebase | The request asks why something happens or where it comes from, not to change X into Y |
| Context isolation | Reading many files would fill the main session's context and degrade later turns | Codebase size and the number of modules involved, measurable from the workspace |
| Parallel work | The person can do other things and return to accept the result | The task is independent, specified, and needs little interaction while it runs |

<a id="cost"></a>
## Cost

| Factor | Notes |
| --- | --- |
| Time | Delegation took 4 to 13 times longer in the calibration; Codex needs more than 20 s before its first step |
| Money and tokens | Codex usage is not reported yet and is recorded as unknown, not zero |
| Attention | Watching progress, handling alerts, and accepting the result cost the person's attention; the shorter the task, the worse this trade |
| Hand-off loss | Only the task text crosses over; constraints and preferences agreed earlier in the main session can be lost |

<a id="risk"></a>
## Risk

| Factor | Notes |
| --- | --- |
| Blast radius | Production code, database migrations, and deletions need a sandbox, approval, and verification before delivery |
| Privacy | Codex calls an external model; data classes that may not leave the machine forbid delegation, as a hard rule |
| Permissions | Workspace writes, network access, or credentials must be allowed by the deployment policy |
| Recoverability | Changes under version control are low risk; irreversible external actions are high risk |

<a id="control"></a>
## Control

| Factor | Notes |
| --- | --- |
| Verifiability | Long autonomous runs need explicit acceptance checks such as tests, builds, or reproducible checks; vague goals do not fit |
| Specification | Tasks that need repeated clarification should be clarified in the main session first, with acceptance criteria written down, before delegation |
| Mid-run correction | An executor that accepts mid-run input and can be stopped fits long tasks better; only Codex accepts mid-run input today |

<a id="decision-layers"></a>
## Decision layers

| Layer | Decides | Owner |
| --- | --- | --- |
| Hard rules | Data classes that may not leave the machine, missing permissions, and workspace facts (codebase size, presence of test or build commands) as preconditions | Deterministic System3 admission, not a model |
| Semantic judgment | Engineering loop, exploration, and cross-module scale visible in the request, as the candidate description states them | Jev |
| Explicit intent | Value and risk preference, which the request text does not show: "hand it to Codex" delegates, "change it yourself" does not | The person |

<a id="open-questions"></a>
## Open questions

- The success gain is unmeasured; it needs long-running tasks that Flash fails.
- Context isolation can be measured as main-session token growth and later-turn quality, and belongs in the next comparison.
- Privacy and workspace size should move from Jev's judgment to hard rules.
- For complex but vague requests, clarifying and writing acceptance criteria in the main session before delegation also reduces hand-off loss.
