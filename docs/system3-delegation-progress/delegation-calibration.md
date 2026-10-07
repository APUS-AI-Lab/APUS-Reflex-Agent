# System3 delegation threshold calibration · 2026-10-03

English | [中文](delegation-calibration.zh.md)

Sources: tasks and scripts in `packages/experimental/system3/tests/fixtures/delegation-calibration/`, entry decisions from `packages/experimental/system3/tests/delegation-calibration-decisions.e2e.ts`. Raw output: [delegation-calibration-report.json](delegation-calibration-report.json).

## Setup

- 10 Python tasks graded by size (2 trivial, 2 small, 3 medium, 3 large; the largest touches four files of a small package), each with hidden acceptance tests the agent never sees; `verify.py` proves every hidden test fails on the starting workspace and passes on the reference solution.
- 3 decision-only probes at repository scale (a 40-package build migration, a flaky-test investigation, a 12-endpoint API version).
- Arms, each task run twice through `dsh headless` in a fresh workspace: self (DeepSeek V4 Flash, low, with native tools), delegate (the same main model with `subagent_codex` and a prompt asking to use it), and Jev. Delegation in the product injects an instruction instead of changing the prompt.
- Jev decisions are deterministic for a fixed input: two runs of the four-tier evaluation produced identical decisions. The Jev arm therefore takes, for each task, the runs of the arm its recorded decision selects; tasks Jev sent to Pro or GPT-5.6 Sol ran in their own arms.
- Codex 0.153.4 used gpt-5.5 over a ChatGPT login on a development Mac; Codex token usage is not reported and is not counted as zero.

## Result

| Arm | Hidden tests passed | Median time | Total time for 20 runs |
| --- | --- | --- | --- |
| Self (Flash) | 20 / 20 | 36 s | 865 s |
| Always delegate | 20 / 20 | 203 s | 4515 s |
| Jev, Codex wording before | 20 / 20 | 176 s | 3819 s |
| Jev, adopted Codex wording | 20 / 20 | 41 s | 2430 s |

- 10 runs that never started because a concurrent build replaced the CLI were rerun and excluded; 52 runs are counted.
- Delegation added no accepted result on any size: by size, self took a median of 8, 26, 37 and 68 s for trivial, small, medium and large tasks; delegation took 102, 130, 342 and 263 s.
- With the earlier wording Jev delegated 8 of 10 tasks at confidence 0.92 to 0.98, including a one-line off-by-one fix; only two fell to the baseline below the 0.8 threshold.
- With the adopted wording Jev delegated none of the 10 tasks and still delegated 2 of 3 repository-scale probes (0.87, 0.97); the API probe fell to the baseline at 0.69.
- The adopted wording's remaining cost comes from model tiers: Jev sent two large tasks to GPT-5.6 Sol, which took 321 to 581 s against Flash's 68 to 117 s, and four small and medium tasks to Pro, which took 12 to 81 s against Flash's 7 to 33 s.

## Adopted change

The deployed Codex candidate now reads: 超出一次对话能完成的大型工程任务：在大型代码库里长时间探索、跨十个以上文件改造、反复构建和测试直到通过，通常要十分钟以上。几分钟内能直接改完的修复、函数实现或单个功能都不属于此类，交给模型直接完成。 The four-tier entry evaluation does not include this candidate and stays at 29 / 30.

Two rewordings of the expert tier that excluded hands-on coding lowered the four-tier evaluation to 26 / 30 and 28 / 30 and still sent one large task to GPT-5.6 Sol, so the expert wording is unchanged.

## Limits

- The task set is small and its rule wording was tuned on it, so the adopted wording's result is an optimistic bound; the repository-scale probes check only the decision, not an executed outcome.
- No task here needed delegation, so the threshold above which delegation pays off is still unmeasured; it needs tasks Flash fails.
- Tier routing for coding tasks (Pro, GPT-5.6 Sol) costs time without a measured quality gain on these tasks and needs its own calibration.
