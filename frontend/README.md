# APUS Reflex Harness desktop

![APUS Reflex Harness](../apps/web/public/brand-source.webp)

English | [中文](README.zh.md)

**瞬策 · 瞬时执行，深度思考 · Model-as-a-Harness**

APUS Reflex Harness is a Personal Agent desktop app for working with models on local projects: choose a workspace, configure a model, and carry out tasks in a persistent conversation. The optional Reflex/Jev decision service is configured in Settings → Reflex model configuration. Connecting the service does not automatically enable routing, supervision or memory. The desktop client and Harness runtime ship from this repository. See the [product README](../README.md) for the architecture and current capability limits.

This integration brings the desktop client into `frontend/` of the existing Harness repository, merging frontend and backend configuration, builds and packaging. The installer bundles the backend; no separate backend installation or startup is needed.

## Download and configure

The repository is currently private: Release downloads require repository access until an administrator makes it public.

Published installers and platform validation appear on [Releases](https://github.com/APUS-AI-Lab/APUS-Reflex-Harness/releases). Version `0.1.0` uses the same reviewed source commit across its desktop and Web targets; macOS Apple Silicon and Intel passed automated copying, direct process startup and restart checks, but Finder/Gatekeeper installation acceptance remains incomplete and an invalid bundle seal was found in a checked `0.1.0` DMG. Windows and Ubuntu desktop downloads are experimental: installation acceptance is incomplete. The [platform status](../docs/feat-integrated-product/installation.md) records failures and the qualified Web package. These unsigned preview installers bundle the backend and need no Git or Node.js; macOS is not notarized. Model configuration is required, and the first real-model task has not been validated. Source archives are not installers. The complete Linux x64 Web package includes its own runtime; platform requirements and first-use steps belong to the installation guide. Follow [installation](../docs/feat-integrated-product/installation.md) and [model configuration](../docs/feat-integrated-product/configuration.md).

Full and Lite builds differ only in the bundled Office engine. `0.1.1` is not released or installation-qualified yet. See [edition selection](../docs/feat-office-editions/README.md) for capabilities and upgrade behavior.

## Develop

Run the setup and desktop commands from the repository root. The [development guide](../docs/feat-integrated-product/development.md) covers this single-checkout workflow. See the [release procedure](../docs/feat-integrated-product/releases.md) for packaging and validation.

## License

The original DataElement MIT notice remains in [LICENSE](LICENSE); dependency licenses remain in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Product acknowledgments are in the [root README](../README.md).

## Other languages

[日本語](README.ja.md) · [Русский](README.ru.md) · [Español](README.es.md) · [Português](README.pt.md)
