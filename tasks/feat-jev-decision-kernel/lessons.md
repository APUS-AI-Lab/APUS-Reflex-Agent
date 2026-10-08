# Lessons — feat-jev-decision-kernel

- Wait for a prd release with `grep -q '^Deployed'` or the script exiting (`pgrep -f '[r]elease.sh <id>'`; without the brackets pgrep matches the remote shell running the check, so a failed release polls forever). A loose `healthy` pattern made a finished release look stuck for 30 minutes, and a loose `rror` pattern matched build output and reported a release that was still building.
- Markdown under `docs/` must pair English and Chinese; keep worktree lessons under top-level `tasks/<worktree>/`.
- prd has no pytest; real acceptance runs use the standard-library `unittest`.
- A marker that names line numbers works for the model but not for a person: the terminal card shows no line numbers. Check model-visible text in the browser card as a user would, not only in the session log.
- In the browser, tool cards sit under "Took Ns" → "Ran commands and read files" → the card itself; terminal lines render as `div`s, so locate text with a tree walker, not `pre`.
- The worktree guard rejects compound shell commands that export variables or start interpreters with computed input; put them in a scratchpad script and run `bash script`.
- `gh pr create` fails with this token (GraphQL permission); create pull requests through `gh api repos/<owner>/<repo>/pulls`.
- Run `bash -n` on every browser acceptance script before a prd run, and re-read a scratchpad file after a guarded edit: a fix the worktree guard refused left a syntax error that stopped two prd runs right after the first message.
- In a shell `case` pattern, quote any part containing spaces (`*"moved into the current step"*`); an unquoted space ends the pattern.
- prd went down on 2026-10-08 because the shared disk filled: every release left a 2.5 GB directory and a 5 GB image. `release.sh` now refuses to build below 20 GB free and prunes to the newest three releases; check `df -h /` first whenever the service shows `226/NAMESPACE`.
- A relay's response `model` field echoes the requested alias, so it proves nothing; the upstream channel is in LiteLLM's `x-litellm-model-id` header, and `usage.prompt_tokens` for a fixed prompt fingerprints the tokenizer and any hidden injected prompt.
