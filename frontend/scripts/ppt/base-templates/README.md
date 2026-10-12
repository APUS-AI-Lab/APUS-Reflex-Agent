# Maintained baseline inputs

These six Chinese PPTD sources and their metadata/design files preserve the authored baseline of the three original industry packs and the three DSH packs, including their existing layout corrections and provenance. No withdrawn template is included.

`localize-ppt-templates.mjs` restores these inputs and creates their English counterparts. `enrich-ppt-templates.mjs` then adds the expanded bilingual compositions. Keeping baseline inputs separate makes consecutive `npm run ppt:build` runs reproducible: the translator never reads a previously enriched output as its input.

The ten Zara adaptations are generated independently by `generate-zara-ppt-templates.mjs`. The earlier `generate-ppt-templates.mjs` is the initial authoring script for the three DSH baseline packs; it is no longer in the rebuild pipeline. To revise those baselines, edit the maintained inputs here and rebuild. Preserve the provenance and licensing in each pack.
