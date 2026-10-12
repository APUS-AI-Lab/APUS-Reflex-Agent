# Public documentation and evidence review

English | [中文](open-source-docs-audit.zh.md)

## Scope

The initial tracked inventory covers 749 text files under `docs/` and `tasks/`: 542 Markdown, 43 HTML, 158 JSON, one Session JSONL and five logs. It also includes 72 PNG/JPEG images and six PDF/PPTX/ZIP attachments. README, configuration and source files additionally belong to the tracked-checkout secret scan. This is a review inventory, not proof that every artifact is approved.

## Publication policy

Keep architecture, API documentation, reproducible synthetic fixtures, source references and bounded acceptance summaries. Exclude raw operational conversations, private deployment configuration, private source inventories and internal management presentations. Retain original evidence privately with checksums; public summaries must say when raw payloads have been omitted.

## Current cleanup

- Replace the completion-browser Session dump and its operational result with explicit public metadata; remove full request/turn payloads from two cache diagnostics and private source paths from the foundation evidence.
- Archive eight internal management assets: two presentations, three PDFs, two previews and the management HTML. Preserve the synthetic demo ZIP after reviewing its eight members.
- Replace personal machine paths and deployment-specific RunPod endpoints with examples. Repair links to removed artifacts and use the Frontend `main` for public cross-repository references.
- Correct README and casebook claims: retained originals do not guarantee lossless recall, no-Jev compatibility does not enable Continuum, and source labels alone do not prove resistance to malicious recalled instructions.

## Acceptance still required

- Image review executed: 72 of 74 OCR inputs were read successfully; two archived internal previews were no longer present. Ten images were manually inspected. Thirteen settings screenshots exposing deployment addresses were privately archived. This coverage is not a pixel-by-pixel manual guarantee.
- The tracked-checkout Gitleaks scan passed over 124.24 MB without findings. Frontend history passed over 424 commits. Harness history scanned 12,223 commits / 320.52 MB and returned 470 pattern matches: 455 pairing digests, two document digests, nine synthetic credential fixtures, two prose matches, one environment-variable name and one storage identifier. Reviewed matches contain no identified live credential; this is triage of a nonzero scanner result, not a clean scanner exit. Final changed-file scanning, documentation checks and independent diff review remain pending.
- Account for removed files in prior commits, branches, tags and release attachments before public access. Removing files at HEAD does not remove historical copies.
- Validate the Frontend's pinned Runtime and release package separately. Documentation cleanup does not complete provider, platform or signing acceptance.

## Repository ownership

The intended organization is APUS AI Lab; the two repositories remain independent. Ownership transfer and public visibility are separate actions. Keep repositories private until historical material and release disclosures have a reviewed disposition; do not silently rewrite shared history or describe an unrun CI job as passed.
