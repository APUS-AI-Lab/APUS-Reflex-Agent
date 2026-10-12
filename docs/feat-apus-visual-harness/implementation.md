# APUS brand implementation reference

English | [中文](implementation.zh.md)

## Artwork

The supplied `apps/web/public/brand-logo.webp` is the single artwork input. Run `pnpm exec tsx apps/desktop/scripts/generate-brand-assets.ts` after changing it. The generated `BRAND_LOGO_DATA_URI` supplies `FishLogo`, `BrandWordmark`, and composed SVG consumers without a network image request. SVG wrappers embed PNG pixels for native renderer compatibility. The original image remains 140 × 140; resizing does not add detail.

## Theme

The existing `--dsw-*` styling API maps to APUS semantic tokens in `design-platform.css`. Light mode uses `#4058c8` accents and dark mode uses `#9daeff`; cyan and purple identify the bird artwork. Canvas, sidebar, elevated surfaces, text, selection, primary actions, and focus indicators share the palette. Error, warning, and success colours retain their meanings. The first-paint background in `boot-theme.ts` matches the loaded dark palette.

## Product copy

Model as Harness remains the product positioning. Credit copy identifies the connected DeepSeek account and explains that providers own usage and billing. The DeepSeek credential form keeps its actual provider name and explains how to configure another provider in model settings. These text changes do not modify credentials, billing, requests, or provider activation.

## Verification records

[Contrast measurements](contrast.json) record sixteen foreground/background checks. Test commands, limitations, file inventory, and the current integration status live in the [worktree handoff](../../tasks/feat-apus-visual-harness/handoff.md). Package and browser checks do not establish that the user’s installed application has been replaced.
