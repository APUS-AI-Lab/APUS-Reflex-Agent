# Provider endpoint and credential changes

English | [中文](credential-switch-design.zh.md)

The Models editor currently saves the provider configuration before replacing its credential. A local reproduction using the rendered editor and the real PiAiAdapter confirmed that a refused credential write leaves the new endpoint active with the old credential reference, and a subsequent HTTP request sends the old key to that endpoint.

## Change

When an existing provider editor changes its endpoint or protocol and supplies a new key, allocate a new random credential reference. Save the new key under that reference first, then submit one revision-checked settings mutation containing the edited connection and the new reference. Never overwrite the old reference. Reuse the new reference when retrying the same key draft; changing that key allocates another reference.

Credential-only edits and environment-owned read-only keys retain their current behavior. A blank key continues to retain the configured credential. No credential API or persistence format changes.

## Failures

A refused credential write leaves settings untouched. A refused settings mutation leaves the old configuration and credential intact. The new reference may remain unused. Do not automatically remove it after a transport failure because an unconfirmed settings write may already reference it. Report unconfirmed saves without discarding the draft.

## Files and checks

`ProviderEditor.tsx` owns the staged reference and save sequence. Its locale dictionaries own the unconfirmed-save message. Existing provider-form tests cover credential refusal, settings conflict, successful switching without overwriting the old key, retries, and uncertain acknowledgements. Repeat the local HTTP reproduction against the repaired editor. The owning Models README documents these save and failure semantics.
