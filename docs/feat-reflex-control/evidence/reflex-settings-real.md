# F-01 Real Reflex model settings acceptance

English | [中文](reflex-settings-real.zh.md)

On 2026-10-10, the real “Reflex model settings” page completed a configuration flow. The page saved `low` effort, then the Web server was stopped and started again; the new process reloaded `low`, and a real task request used `low`. The value was then restored to the deployed default `high`; the save returned HTTP 200, the user override was removed, and the final profile patch retained only locale and theme settings.

The canonical model `APUS-OpenJev-v1-9B-5949` passed the real connection decision in 3808 ms. An intentionally invalid `jev-latest` candidate failed as expected in 3010 ms without exposing credentials. Network observation confirmed successful `settings/mutate`, post-restart `settings/describe`, and `modelCatalog` requests; the API key stayed masked in the UI.

This evidence covers the Web settings page, a real connection test, save, cross-process reload, and a real request consuming the saved effort. Independent-user-directory persistence, normal/safe mode, and window-level recovery in the final Electron package remain F-03 and are not replaced by this report.

The [sanitized JSON evidence](reflex-settings-real.json) contains no endpoint, token, or authorization header.
