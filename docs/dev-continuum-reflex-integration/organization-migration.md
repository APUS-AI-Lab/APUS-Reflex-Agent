# Organization migration review

English | [中文](organization-migration.zh.md)

## Current ownership and access

The two independent repositories are now [APUS-AI-Lab/APUS-Reflex-Harness](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness) and [APUS-AI-Lab/APUS-Reflex-Frontend](https://github.com/APUS-AI-Lab/APUS-Reflex-Frontend). Both remain private. The authenticated account has pull and push access but no repository administration permission; settings that require administration need an organization administrator.

The transfers are complete and preserve the history already pushed to GitHub; local uncommitted changes are not uploaded by a transfer. Check each remote main to establish which source content has been published. Repository ownership, merged source content and public-release readiness are separate states.

## Historical material before public release

The current-tree cleanup archives deployment screenshots, raw Session/request dumps, private source inventories and internal management presentations outside the repository. Their earlier committed versions remain in history, which moved with the private repositories. A successful secret-pattern scan does not approve internal business content for public release.

Before making either repository public, review and execute a history strategy: remove the listed sensitive paths/values from every published historical ref, or publish a sanitized source snapshot while retaining the original repository privately. Preserve licenses, published Session file generations and current source content; history rewriting is not an incidental documentation edit.

## Compatibility impact

History rewriting changes commit identifiers. Frontend workflows pin a Harness revision, and release manifests record revisions, so a rewrite requires an explicit old-to-new mapping, updated pins and acceptance of the resulting artifacts. Snapshot publication likewise needs a resolvable runtime input. Do not silently force-push shared refs or discard the private original.

## Completion and remaining checks

- [x] Transfer the two repositories independently to APUS-AI-Lab, retaining private visibility.
- [x] Verify the new owner, private visibility and current account's pull/push access; administration access is absent.
- [ ] Resolve the private-material inventory across published refs and attachments; secret-pattern scanning alone is insufficient.
- [ ] Review and execute the history strategy and its runtime-pin consequences before public release.
- [ ] Verify default branches, refs, redirects, collaborators, Actions secrets, branch protections, workflow repository references and runtime pin with the required administrator access.
- [ ] Complete canonical repository links and package metadata updates, then run affected checks.
- [ ] Decide public visibility separately after reviewing remaining CI, E2E and signed-package disclosures.
