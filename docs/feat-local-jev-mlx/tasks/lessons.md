# feat-local-jev-mlx lessons

English | [中文](lessons.zh.md)

## 2026-10-14 · Ask for the evaluation criteria before comparing runtime options

- **What happened**: I rejected Ollama using "distribution precision" as an implicit criterion and wrote it as "not a product path" for several rounds in a row. I reversed the decision only after the user asked "wouldn't integrating Ollama give better compatibility" and stated "convenience and ease of use are key".
- **Root cause**: I started comparing without confirming the evaluation criteria first; I treated a quantifiable cost that can be handled within bounds (top-20 truncation) as a hard failure, and I did not look for the Ollama evaluation files the model author had already published.
- **Rules**:
  1. Before choosing between options, write down the evaluation criteria and their weights; when the criteria are unclear, ask directly.
  2. Before declaring an option a "hard failure", find first-party measurements (the model repository's `evaluation/`) and compute the actual size of the failure.
  3. Distinguish "affects the choice" from "affects the probability values"; only the former can be a hard failure.
  4. Every capability I write into a document (such as resume) must have evidence; mark anything not measured as "pending P0 confirmation".

## 2026-10-14 · Confirm a worktree is really a linked worktree before batch processing it

- **What happened**: during disk cleanup, the main checkout `xDAN-MultiModal-Mediation-Agent-Expert` appeared in the `git worktree list` of three other repositories, and the script treated it as a linked worktree and made a WIP commit. git refused to delete the main checkout, and the commit was then reverted with `reset --mixed HEAD~1`.
- **Rule**: before committing to or deleting any path, compare `git rev-parse --absolute-git-dir` with `--git-common-dir`; if they are equal it is a main checkout and must always be skipped. A path that appears in the lists of several repositories must also be skipped and reported.

## 2026-10-14 · Before designing, confirm the consumer really exists in the target product

- **What happened**: the design used "unstable cloud decisions → switch to local" and "privacy block → decide locally" as desktop guidance moments, but only after work began did it turn out that standard DSH desktop does not load System3/Jev at all; only the separate System3 desktop frontend does. The delivery form therefore changed during implementation into two paths: "optional bundle + runtime switching".
- **Rule**: before designing any "integrate capability Y into product X", confirm in X's profile/packaging closure (`packages/bundle/*`, `OPTIONAL_BUNDLES`, `apps/*/package.json` dependencies, `deploy/*` patches) that Y's upstream and downstream plugins are actually loaded, and record the evidence in the design's "current state" table.

## 2026-10-14 · Check the repository's documentation gates before following the global convention

- **What happened**: following the global convention, the handoff documents were written as Chinese-only `docs/<worktree>/tasks/*.md`; at integration `test:docs` failed on pairing, wrapping, and a commit identifier, which required English translations and re-flowed paragraphs.
- **Rule**: in this repository every Markdown file under `docs/**` must be a bilingual pair (`X.md` English, `X.zh.md` Chinese, `X.i18n.yaml` record), one physical line per paragraph, and no commit identifiers. Create new documents as pairs from the start, update both languages on every edit, and run `pnpm run verify-translation-pairing --write <X.md>`.

## 2026-10-15 · Model settings pages on the product's functional modules, not on how the data is displayed

- **What happened**: the Reflex settings capability list was treated as a read-only diagnostic and proposed for removal; the user pointed out that it is the decision front-loading module (Reflex selects Skills, tools, routes, and prefetch before the main model) and needs its own module switch.
- **Rule**: before restructuring a settings page, map each section to the provider/consumer it controls (Jev provider → System3 front-loaded decisions, Continuum memory). Every independently useful consumer gets a module with its own switch under the master switch; status rows inside a module are not diagnostics to fold away.
