// A PR's flow: open → merged → deploying → deployed → cleaned, and its persistence.
import type { GhPr } from '../github/prs'
import type { Store } from '../host'
import type { Stage, Tracked } from '../model'

const PREFIX = 'tracked:'

export const keyOf = (slug: string, number: number) => `${slug}#${number}`

export function openTracked(slug: string, root: string, pr: GhPr, now: number): Tracked {
  return {
    key: keyOf(slug, pr.number), slug, root, number: pr.number, branch: pr.headRefName,
    base: pr.baseRefName, stage: 'open', updatedAt: now, prHead: pr.headRefOid, title: pr.title,
  }
}

export function afterPoll(s: Tracked, pr: GhPr, now: number): Tracked | null {
  if (s.stage !== 'open') return s
  if (pr.state === 'CLOSED') return null
  if (pr.state === 'MERGED') {
    return moveTo(s, 'merged', now, { mergeCommit: pr.mergeCommit?.oid, prHead: pr.headRefOid, mergedAt: now })
  }
  return { ...s, prHead: pr.headRefOid, updatedAt: now }
}

export function moveTo(s: Tracked, stage: Stage, now: number, extra: Partial<Tracked> = {}): Tracked {
  return { ...s, ...extra, stage, updatedAt: now }
}

export const isFinished = (s: Tracked) => s.stage === 'cleaned' || s.stage === 'failed'

export async function loadTracked(store: Store): Promise<Tracked[]> {
  const keys = (await store.keys()).filter(key => key.startsWith(PREFIX))
  const all = await Promise.all(keys.map(key => store.get(key)))
  return all.filter((s): s is Tracked => typeof s === 'object' && s !== null && 'key' in s)
}

/** Rereads a tracked PR from the store (other sessions may have moved it on). */
export async function reread(store: Store, key: string): Promise<Tracked | null> {
  const s = await store.get(PREFIX + key)
  return typeof s === 'object' && s !== null && 'key' in s ? (s as Tracked) : null
}

export const save = (store: Store, s: Tracked) => store.set(PREFIX + s.key, s)
export const forget = (store: Store, key: string) => store.delete(PREFIX + key)
