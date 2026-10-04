# system3-delegation-progress lessons

- Progress summaries cover the Harness and Jev integration only. The verl training line and its CUDA issue belong to another session; do not report on them or recommend actions for them.

## Do not rebuild while product runs depend on `lib/` (2026-10-03)

- `pnpm run typecheck` (and `build`, `build:lib`) cleans and re-emits `lib/`; a calibration batch running `apps/cli/lib/bin.js` lost 10 runs to "Cannot find module" in that window, and runs that survived it were timed under build CPU load.
- Rule: while a background product run or eval uses this worktree's `lib/`, run only source-plane checks (vitest on `src`, oxlint, `tsc --noEmit` on one package); schedule typecheck/build after the batch, or run evals from a copied build.

## Verify a UI claim in the running product before reporting it

- I reported "the composer chip still shows Flash after routing" from one delegation screenshot; the projection already shows the routed model during the turn (verified in Web: `gpt-5.6-sol-relay Medium` during, `deepseek-v4-flash Low` after). The delegation case shows the main model, which is correct.
- Rule: before naming a UI inconsistency, reproduce it in the product for each route kind (model route, delegation, fallback).

## Never let credentials reach tool output during verification (2026-10-04)

- Basic Auth for `system3.xdan.work` leaked twice into tool output: curl's `%{redirect_url}` echoes `user:password@` from `-u`, and a URL with embedded credentials propagated into page script URLs that console stack traces printed. Both times the password was rotated.
- Embedding credentials in a URL also breaks the page: browsers refuse `fetch` from such a document ("Request cannot be constructed from a URL that includes credentials").
- Rule: print only status codes or booleans when a request carries credentials; never print redirect URLs, request URLs, console output or network logs unredacted; never put credentials in URLs. Rotate immediately if a secret appears in output.

## 2026-10-04 — Pilot top three

- **Exit codes lie through pipes.** A check like `pytest -v 2>&1 | tail` exits with `tail`'s status. Any rule that treats a successful command as evidence must refuse piped commands (or require `pipefail`). Found only by online acceptance with a real model, not by unit tests: test against how models actually write commands.
- **Commit hashes in docs fail `verify-repository-references` — again.** Before writing todo/acceptance docs, refer to commits by subject, never by hash. Grep new doc text for `[0-9a-f]{7,}` before running doc-sync.
- **Real-model wording beats intuition for Jev questions.** "Is this a requirement for this task?" missed standing project rules (recall 0.38); quoting the message in its own question and asking for "a working requirement still in force" reached 1.0. Always run the deployed Jev on labelled cases before choosing a threshold.
- **Verify login claims before stating them.** I told the user every restart invalidated their login because the launch token changes; the signed cookie actually uses a persistent secret and survived a restart (checked with curl: 200 after restart). Read the auth code or test with a cookie jar before explaining login behavior.
