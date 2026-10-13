/** Find npm's shell-free JavaScript launcher. */
export function npmEntry(environment?: NodeJS.ProcessEnv, executable?: string): string
/** Reject unsupported Node versions before preparation. */
export function checkNode(version?: string): void
/** Ordered preparation stages for a supported product action. */
export function productStages(action: string, platform?: string): string[]
/** Run one explicit action without publishing. */
export function main(args?: string[]): Promise<void>

/** Select the native desktop builder platform or reject an unsupported host. */
export function desktopBuilderFlag(platform: string): string

/** Resolve explicit edition and signing options before starting build stages. */
export function productOptions(action: string, args: string[], environment?: NodeJS.ProcessEnv): { edition: 'full' | 'lite', unsigned: boolean }
