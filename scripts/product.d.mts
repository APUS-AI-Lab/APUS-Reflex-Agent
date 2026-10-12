/** Find npm's shell-free JavaScript launcher. */
export function npmEntry(environment?: NodeJS.ProcessEnv, executable?: string): string
/** Reject unsupported Node versions before preparation. */
export function checkNode(version?: string): void
/** Ordered preparation stages for a supported product action. */
export function productStages(action: string): string[]
/** Run one explicit action without publishing. */
export function main(args?: string[]): Promise<void>
