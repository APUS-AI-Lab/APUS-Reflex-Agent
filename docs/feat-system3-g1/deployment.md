# APUS Reflex deployment reference

English | [中文](deployment.zh.md)

## Public deployment entry points

Use the [public provider configuration](../dev-continuum-reflex-integration/public-provider-configuration.md) and [System3 package guide](../../packages/experimental/system3/README.md) for current settings, explicit data classification and credential references. Deployment endpoints, domains, host aliases and private launch URLs belong in operator-managed configuration.

The earlier document described one maintainer deployment. Its original instructions, machine inventory, credential-file layout and historical test observations are privately archived with content hashes. They are not current public deployment instructions or evidence that a new deployment has passed acceptance.

## Source files

| File | Purpose |
| --- | --- |
| [runtime.patch.yml](../../deploy/system3/runtime.patch.yml) | Profile composition and explicit provider settings |
| [systemd service](../../deploy/system3/xdan-system3.service) | Existing service template; its filename and service identifiers remain compatibility names |
| [nginx template](../../deploy/system3/nginx/system3.xdan.work.conf) | Existing template filename; configure your own domain before deployment |
| [Codex configuration](../../deploy/system3/codex/config.toml) | Delegated runtime configuration |
| [release script](../../deploy/system3/release.sh) | Deployment implementation |
| [rollback script](../../deploy/system3/rollback.sh) | Recovery implementation |
| [release tests](../../deploy/system3/tests/release.spec.sh) | Release and rollback regression coverage |

## Acceptance scope

The historical [deployment result](deployment-final.json) and [preflight result](deployment-preflight.json) preserve recorded outcomes with private deployment metadata removed. They do not certify current availability, model quality, a new release, or compatibility with newer persisted Session data. Verify authentication, provider calls, task artifacts, cancellation, persistence and recovery for the actual deployment.
