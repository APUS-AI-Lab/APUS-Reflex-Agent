# Supervision acceptance audit, 2026-10-11

English | [中文](supervision-audit-20261011.zh.md)

All four trials in the [sanitized audit](supervision-audit-20261011.json) failed their full acceptance criteria. The first accidentally selected the repeated-failure test and ended without `improved`, with an unhandled cancellation error. It is not semantic-drift evidence and does not erase the earlier successful controlled fault run.

Semantic v5 disabled native-silence recovery while retaining the deployed semantic thresholds and the production parser. Two successful marketing reads triggered an accepted `realign`; native start/completed input events confirmed receipt. Marketing edits still occurred afterwards. Finance completed and passed independent verification with protected files unchanged, but the verification command was rejected as `control-character`; no structured target or `improved` was recorded. This proves drift detection and advice receipt, not that the advice caused the subsequent finance work: the injected prompt already requested finance after marketing.

Semantic v6 and v7 tested temporary newline-stripping hypotheses. Neither produced a structured verification target or `improved`; v7 also timed out during cleanup. The exact command syntax is not established by a rejection category. All temporary parser and test-configuration changes were reverted; no wider shell grammar or rewritten literal argument is part of the implementation. The three semantic trials disabled native recovery, so none satisfies S-09 deployment-default acceptance. Resolve cancellation cleanup and collect bounded syntax metadata before another trial.
