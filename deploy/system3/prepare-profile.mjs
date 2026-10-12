/** Declare editable Reflex defaults below the user profile; dsh remains the application launcher. */
import { initProfile, PROFILE_TEMPLATES, readProfileManifest, resolveProfileDir, writeProfileBundles } from '../../packages/boot/app-boot/lib/index.js'

const home = process.env.DSH_HOME
if (!home) throw new Error('DSH_HOME is required to prepare the APUS Reflex profile')
const dir = resolveProfileDir('web', home)
const template = PROFILE_TEMPLATES.web
if (!template) throw new Error('Harness web profile template is unavailable')
initProfile(dir, template.bundles)
const manifest = readProfileManifest('APUS Reflex Harness', dir)
const bundles = manifest.dsh?.profile?.bundles ?? []
const reflex = '@deepseek-ai/dsh-experimental-apus-dsh-jev-plugin'
if (!bundles.includes(reflex)) writeProfileBundles(dir, manifest, [...bundles, reflex])
