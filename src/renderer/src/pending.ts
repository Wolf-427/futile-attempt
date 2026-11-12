/**
 * Editors keep the newest content for a moment before handing it to the main
 * process. Anything that ends a session (closing the project, the window or
 * the app) first asks every open editor to hand over what it holds.
 */
type Flusher = () => Promise<void>

const flushers = new Set<Flusher>()

export function registerFlusher(flusher: Flusher): () => void {
  flushers.add(flusher)
  return () => {
    flushers.delete(flusher)
  }
}

export async function flushPending(): Promise<void> {
  await Promise.all([...flushers].map((f) => f().catch(() => undefined)))
}
