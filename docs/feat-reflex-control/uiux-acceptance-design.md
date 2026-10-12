# UI/UX acceptance design

English | [中文](uiux-acceptance-design.zh.md)

## Goal and authorization

The user requested complete UI/UX acceptance. The approved scope includes correcting the shared Settings layout and inaccurate Reflex delivery status, preserving the approved page design and runtime APIs. Real server13 inspection found 59px-wide Reflex fields at a 375px viewport; the fixed navigation column also compresses General settings.

## Layout and state

At viewports up to 640px, Settings uses a full-width horizontal navigation strip above its content. Navigation scrolls horizontally; form content scrolls vertically; the title, actions and close control remain reachable. Wider layouts retain the existing columns, tokens and modal focus behavior. A 640×450 CSS viewport is a reflow proxy for a 1280×900 window at 200%; native browser/Electron zoom remains a separate acceptance check.

The supervision `unknown` event means delivery acknowledgement is unavailable. Its label must not imply that Reflex made no decision. Sending, accepted delivery, verified improvement and native recovery remain distinct states. No API, persistence format or model-routing change is required.

A combined settings/key save uses revision-fenced compensation, not a cross-service transaction. If the key is refused or its acknowledgement is unavailable, restore the fields written by this save only while its exact configuration revision remains current. Preserve staged input for retry. A concurrent configuration change or failed compensation preserves the newer configuration and reports partial persistence explicitly. Credential references are captured at Save; secrets never enter configuration patches. A lost credential acknowledgement does not establish that the credential store was unchanged; the page reports an unconfirmed save even after configuration restoration. An acknowledged credential write stays successful if its status refresh fails.

## Files

- `packages/client/ui-settings-general/src/client/SettingsRoot.module.css`, owner style regression and bilingual README: responsive settings layout.
- `packages/experimental/client-ui-system3/src/client/locales.ts`, feedback regression and bilingual README: accurate unconfirmed-delivery copy.
- This design and browser evidence in the worktree documentation directory.

## Acceptance

Use an isolated browse state against the actual server. Check first-entry navigation, invalid unsaved drafts, disabled save/test actions, Escape and focus restoration, keyboard traversal, 375/768/1280px widths in light/dark themes, and 200% reflow. Record screenshots and inspect them. Do not submit model requests or save provider changes while real native tests run. Rebuild Client through the root coordinator, restart the server, and repeat affected interactions on the built UI. Source regressions cannot substitute for that replay. Restore the original theme after inspection.

The [built UI replay](evidence/uiux/after.json) on Client12/Web12 passes 375/768/1280px light/dark layouts, keyboard focus containment, Escape focus restoration, invalid-draft descriptions and the persisted context-restoration label. At 375px the field width increased from 59px to 271px; the [earlier failure](evidence/uiux/before.json) remains recorded. The 640×450 case verifies reflow only; native Electron 200% zoom and packaged-desktop checks remain separate. No model request, provider save or connection probe was submitted during this replay.
