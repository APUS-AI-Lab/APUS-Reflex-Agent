export interface SuspendedGenerationProjection {
  plugins: string[]
  restore: () => Promise<void>
}

export function suspendGenerationProjectionForPnpm(
  profileDirectory: string
): Promise<SuspendedGenerationProjection>
