/** Bundled primary-runtime location shared by the Desktop Office composition and profile configuration expressions. */

import { join } from 'node:path'

/** Host environment variable naming the bundled primary-runtime payload directory. */
export const PRIMARY_RUNTIME_SOURCE_ENV = 'DSH_DESKTOP_PRIMARY_RUNTIME_SOURCE'

/**
 * Resolve the bundled payload directory and publish it before the profile evaluates `!!js` configuration.
 * The variable overrides inherited and `.env` values because layered environment loading only fills unset names.
 * @param runtimeDir - Prepared or ASAR-contained application dependency directory.
 * @param argument - Payload directory supplied by the Electron shell, when given.
 * @param environment - Host process environment that receives the variable.
 * @returns The published payload directory.
 */
export function publishPrimaryRuntimeSource(runtimeDir: string, argument: string | undefined, environment: NodeJS.ProcessEnv): string {
  const source = argument ?? join(runtimeDir, '..', 'runtime', 'primary-runtime')
  environment[PRIMARY_RUNTIME_SOURCE_ENV] = source
  return source
}
