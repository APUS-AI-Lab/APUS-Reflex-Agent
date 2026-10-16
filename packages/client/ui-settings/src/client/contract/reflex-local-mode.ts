/** Connection-mode facts a local Jev provider plugin reports to the Reflex settings section. */

/** Observable value with a synchronous read, as client stores expose it. */
export interface ReflexLocalChoice {
  /** @returns whether the user chose the local engine as the Reflex connection mode, or null before its first report. */
  getSnapshot(): boolean | null
  /**
   * Observe changes.
   * @param listener - called after each change.
   * @returns the unsubscriber.
   */
  subscribe(listener: () => void): () => void
}

/**
 * The local connection mode as its provider plugin persists it. The Reflex section shows This Mac when Jev routes to a
 * non-built-in provider, or when Jev names no provider and `chosen` is true; picking This Mac commits through `choose()`,
 * because the local mode has no Save.
 */
export interface ReflexLocalMode {
  readonly chosen: ReflexLocalChoice
  /**
   * Record the local engine as the chosen connection mode without routing decisions to it.
   * @returns after the choice is persisted; rejects with the provider's failure.
   */
  choose(): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Provided by the plugin that runs a local Jev provider; absent when none is composed. */
    reflexLocalMode: ReflexLocalMode
  }
}
