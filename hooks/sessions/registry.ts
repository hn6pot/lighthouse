// Who works where: each active session records its folder and its worktrees.
import type { Host } from '../host'
import type { SessionInfo } from './owner'

/** The mod's own folder in the home: state, sessions, locks, logs and the config file. */
export const DATA_DIR = '.lighthouse'
const STALE_MS = 30 * 60_000
/** A session whose heartbeat (60 s) is younger than this is alive. */
const ALIVE_MS = 5 * 60_000

/** `label`: the start of the session's first prompt, to name it to the other sessions. */
type Entry = { cwd: string; trees: string[]; updatedAt: number; label?: string }

function parseEntry(text: string): Entry | null {
  try {
    const entry = JSON.parse(text) as Partial<Entry>
    if (
      typeof entry.cwd === 'string' &&
      Array.isArray(entry.trees) &&
      entry.trees.every(a => typeof a === 'string') &&
      typeof entry.updatedAt === 'number'
    ) {
      return entry as Entry
    }
  } catch {
    // file written by another process, unreadable
  }
  return null
}

const dir = (host: Host) => `${host.home}/${DATA_DIR}/sessions`

export async function record(host: Host, id: string, info: { cwd: string; trees: string[]; label?: string }): Promise<void> {
  await host.run(['mkdir', '-p', dir(host)])
  const entry: Entry = { ...info, updatedAt: await host.now() }
  await host.write(`${dir(host)}/${id}.json`, JSON.stringify(entry))
}

export async function otherSessionIn(host: Host, id: string, tree: string): Promise<boolean> {
  const list = await host.run(['ls', '-1', dir(host)])
  if (list.exitCode !== 0) return false
  const now = await host.now()
  for (const name of list.stdout.split('\n').filter(n => n.endsWith('.json'))) {
    if (name === `${id}.json`) continue
    const text = await host.read(`${dir(host)}/${name}`)
    if (text === null) continue
    // Unreadable: we do not know who holds the tree, so it counts as taken.
    const entry = parseEntry(text)
    if (entry === null) return true
    if (now - entry.updatedAt > STALE_MS) continue
    const inside = (path: string) => path === tree || path.startsWith(tree + '/')
    if (inside(entry.cwd) || entry.trees.some(inside)) return true
  }
  return false
}

/** The other sessions still beating, to tell whose PRs and branches are whose. */
export async function liveSessions(host: Host, id: string): Promise<SessionInfo[]> {
  const list = await host.run(['ls', '-1', dir(host)])
  if (list.exitCode !== 0) return []
  const now = await host.now()
  const sessions: SessionInfo[] = []
  for (const name of list.stdout.split('\n').filter(n => n.endsWith('.json'))) {
    if (name === `${id}.json`) continue
    const text = await host.read(`${dir(host)}/${name}`)
    const entry = text === null ? null : parseEntry(text)
    if (entry === null || now - entry.updatedAt >= ALIVE_MS) continue
    sessions.push({ id: name.slice(0, -'.json'.length), cwd: entry.cwd, trees: entry.trees, ...(entry.label ? { label: entry.label } : {}) })
  }
  return sessions
}

/** True if session `id` still beats. An unreadable file (write in progress) counts as alive. */
export async function sessionAlive(host: Host, id: string): Promise<boolean> {
  const text = await host.read(`${dir(host)}/${id}.json`)
  if (text === null) return false
  const entry = parseEntry(text)
  return entry === null || (await host.now()) - entry.updatedAt < ALIVE_MS
}

export async function forgetSession(host: Host, id: string): Promise<void> {
  await host.run(['rm', '-f', `${dir(host)}/${id}.json`])
}
