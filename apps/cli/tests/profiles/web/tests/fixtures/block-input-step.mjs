/** Hold model processing while the real Web controller acknowledges input persistence. */
export const inject = ['sessionController']
export function apply(ctx) {
  ctx.on('agent/pre-step', async ({ signal }, next) => {
    if (!signal.aborted) await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }))
    signal.throwIfAborted()
    return next()
  })
}
