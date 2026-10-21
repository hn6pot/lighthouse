// One actor per repo: `mkdir` is atomic, whoever creates it first acts.
// A lock whose holder is unknown (owner.json missing or unreadable) is only taken over
// if the folder itself is older than 15 min. Takeover and release go through
// a `mv` to a name of the session's own, then check what was moved:
// if it is not the expected lock, it is put back.
import type { Host } from '../host'
import { DATA_DIR } from './registry'

const STALE_MS = 15 * 60_000

type Holder = { id: string; since: number }

const dir = (host: Host, slug: string) => `${host.home}/${DATA_DIR}/locks/${slug.replaceAll('/', '__')}`

// Null if owner.json is missing or unreadable: the holder is then unknown.
async function readOwner(host: Host, path: string): Promise<Holder | null> {
  const text = await host.read(`${path}/owner.json`)
  if (text === null) return null
  try {
    const owner = JSON.parse(text) as Partial<Holder>
    if (typeof owner.id === 'string' && typeof owner.since === 'number') return { id: owner.id, since: owner.since }
  } catch {
    // file written by another process, unreadable: treated as unknown
  }
  return null
}

const sameHolder = (a: Holder | null, b: Holder | null) =>
  a === null || b === null ? a === b : a.id === b.id && a.since === b.since

// Folder age in ms (macOS mtime in seconds). Unknown if stat fails: we do not take it over.
async function dirIsStale(host: Host, path: string, now: number): Promise<boolean> {
  const st = await host.run(['stat', '-f', '%m', path])
  const output = st.stdout.trim()
  if (st.exitCode !== 0 || !/^\d+$/.test(output)) return false
  return now - Number(output) * 1000 > STALE_MS
}

// Puts `from` back in place of `to`, only if `to` is free.
// Accepted leftover: another process may recreate `to` between the test and the mv (microseconds).
// If `to` already exists, the folder stays under its moved name, not deleted.
async function putBack(host: Host, from: string, to: string): Promise<void> {
  if ((await host.run(['test', '-e', to])).exitCode === 0) return
  await host.run(['mv', from, to])
}

async function writeOwner(host: Host, slug: string, id: string, since: number): Promise<void> {
  await host.write(`${dir(host, slug)}/owner.json`, JSON.stringify({ id, since }))
}

export async function acquireLock(host: Host, slug: string, id: string): Promise<boolean> {
  await host.run(['mkdir', '-p', `${host.home}/${DATA_DIR}/locks`])
  const path = dir(host, slug)
  const created = await host.run(['mkdir', path])
  const now = await host.now()
  if (created.exitCode === 0) {
    await writeOwner(host, slug, id, now)
    return true
  }

  const owner = await readOwner(host, path)
  if (owner?.id === id) {
    await writeOwner(host, slug, id, now)
    return true
  }
  const stale = owner === null ? await dirIsStale(host, path, now) : now - owner.since > STALE_MS
  if (!stale) return false

  // Takeover: move it, check it is indeed the lock judged stale, then recreate it.
  const abandoned = `${path}.stale.${id}`
  await host.run(['rm', '-rf', abandoned]) // leftover of a crash: must not capture the lock
  const moved = await host.run(['mv', path, abandoned])
  if (moved.exitCode !== 0) return false
  if (!sameHolder(owner, await readOwner(host, abandoned))) {
    // Someone else took it over meanwhile: what we moved is their live lock.
    await putBack(host, abandoned, path)
    return false
  }
  await host.run(['rm', '-rf', abandoned])
  const recreated = await host.run(['mkdir', path])
  if (recreated.exitCode !== 0) return false
  await writeOwner(host, slug, id, now)
  return true
}

export async function releaseLock(host: Host, slug: string, id: string): Promise<void> {
  const path = dir(host, slug)
  if ((await readOwner(host, path))?.id !== id) return
  // Move then check: between the read and the mv, the lock may have changed hands.
  const released = `${path}.released.${id}`
  await host.run(['rm', '-rf', released])
  const moved = await host.run(['mv', path, released])
  if (moved.exitCode !== 0) return
  if ((await readOwner(host, released))?.id === id) {
    await host.run(['rm', '-rf', released])
    return
  }
  await putBack(host, released, path)
}
