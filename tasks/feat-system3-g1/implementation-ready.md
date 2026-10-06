# Implementation review checkpoint

Product implementation owns Harness `feat-system3-g1` and Frontend `feat-system3-integration`; Jev operations owns its separate review worktree. The duplicate preflight artifacts were preserved outside the product tree and removed from this checkout.

## Fixed foundation

`system3-g1-foundation` identifies the accepted rc.2 merge and TypeSafe SDK 0.6.0 transport. SDK retries and logging are disabled; credential resolution and delivery share a deadline. Actual product configuration explicitly uses Jev high, while the generic plugin default remains unchanged.

## Product source checkpoint

The product checkpoint includes total entry deadlines, permitted baseline fallback, fixed/automatic model control, native Skill instruction injection, replayable facts and the localized Conversation dock. It also includes the Linux release and rollback scripts and Desktop runtime dependency carrier. A source checkpoint is not a deployment acceptance certificate.

## Verified source behavior

- SessionController, Jev and System3 regression: 51 files, 966 tests passed before the final focused edge-case additions.
- Final entry/Skill/projection regression: 107 tests passed; entry-routing, skill-selection and runtime-projection each reached 100% statement, branch, function and line coverage.
- Conversation feedback: 10 tests passed with all coverage metrics at 100%; advice, adoption, actual response and durable instruction injection remain distinct.
- TypeScript SDK entry-route and shadow replays passed. Python SDK entry-route and shadow replays passed, including exact native Skill message correlation. Current format-four fixtures were refreshed; historical generations were retained.
- Host TypeScript and bundles passed. Client TypeScript and bundles passed. All 42 documentation gates passed. Ruff check and format check passed. All package hygiene gates passed, including the separately rerun vendor-rescope check after synchronizing its exact edit. Desktop public CSV delivery passed its external oracle after cancellation and Node recovery; final clean installation and server acceptance remain pending.

## Review and deployment status

The second independent review identified three release blockers: synthetic failure records could confirm model response, failed activation could replace the earlier rollback target, and repeated rollback could mismatch application and unit. The correction requires content evidence, updates the previous pointer only after health succeeds, and restores each release with its saved unit while consuming a successful rollback target. The baseline Linux preflight completed real Jev high and Fidoo read-only CSV execution, plus a tool-process check confirming both model credential variables were absent. This evidence lives in `docs/feat-system3-g1/deployment-preflight.json` and does not substitute for final release acceptance.

Clean Desktop normal/safe startup, public CSV artifacts, cancellation, fixed-to-automatic reset, reload, server restart and compatible rollback have passed. Exact immutable implementation pins and task evidence are recorded in `docs/feat-system3-g1/desktop-acceptance.json` and `docs/feat-system3-g1/deployment-final.json`. The server task initially included an extra JSON field; a native follow-up corrected the strict schema and the unchanged external oracle passed. Product browser state is isolated from the operations session. Model calls and deployment have one owner.

## Review correction verification

Release scripts passed eight isolated container cases, including failed third activation preserving the earlier target, repeated rollback refusing without service mutation, and failed rollback restoring the current application and unit. Projection regression passed 28 tests with all coverage metrics at 100%; Conversation feedback passed 11 tests with all metrics at 100%. Host and Client builds and persistence checks passed. Exact focused commands and logs are in `review-regression.json`; all 42 documentation checks passed, including the focused repository-reference rerun after replacing a commit literal with its fixed tag. Independent fixed-source review closed all three findings before activation; the reviewed implementation now runs as the verified stable release.
