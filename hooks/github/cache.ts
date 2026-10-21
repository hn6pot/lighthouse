// gh answers shared by every conversation through the store: one GitHub call per key while it is fresh.
import type { Host } from '../host'

/** How long a gh answer is reused, unless a git or gh command just ran. */
export const GH_FRESH_MS = 30_000

type Entry = { at: number; value: unknown }

/** `maxAgeMs` 0 asks GitHub and shares the answer; undefined leaves the store alone. */
export async function cached<T>(host: Host, key: string, maxAgeMs: number | undefined, ask: () => Promise<T>): Promise<T> {
  if (maxAgeMs === undefined) return ask()
  const now = await host.now()
  const hit = (await host.store.get(`gh:${key}`)) as Entry | undefined
  if (maxAgeMs > 0 && hit && typeof hit.at === 'number' && now - hit.at < maxAgeMs) return hit.value as T
  const value = await ask()
  await host.store.set(`gh:${key}`, { at: now, value } satisfies Entry)
  return value
}
