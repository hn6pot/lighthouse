// What Lighthouse remembers about documents, in a store of its own (`~/.lighthouse/docs`), shared between sessions.
import { fileStore, type Host, type Store } from '../host'
import { DATA_DIR } from '../sessions/registry'
import { EMPTY_CONVERSATION, type Conversation, type ConversationLink } from './conversation'
import type { DocId } from './identity'

export type PublishRecord = { url: string; at: number; hash: string | null; session: string }
/** The documents last seen on a branch, and whether it touched code: read again once its PR is merged. */
export type BranchSnapshot = { docs: DocId[]; code: boolean; at: number }

const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === 'string')
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null

const isLink = (v: unknown): v is ConversationLink =>
  isRecord(v) && typeof v.doc === 'string' && typeof v.root === 'string' && typeof v.branch === 'string' && typeof v.at === 'number'

export function docsStore(host: Pick<Host, 'run' | 'read' | 'write' | 'home'>): Store {
  return fileStore(host, `${host.home}/${DATA_DIR}/docs`)
}

export async function loadPublish(store: Store, id: DocId): Promise<PublishRecord | null> {
  const v = await store.get(`pub:${id}`)
  const ok = isRecord(v) && typeof v.url === 'string' && typeof v.at === 'number' && (typeof v.hash === 'string' || v.hash === null) && typeof v.session === 'string'
  return ok ? (v as PublishRecord) : null
}

export const savePublish = (store: Store, id: DocId, r: PublishRecord) => store.set(`pub:${id}`, r)

export async function loadConversation(store: Store, session: string): Promise<Conversation> {
  const v = await store.get(`conv:${session}`)
  const ok = isRecord(v) && strings(v.active) && strings(v.specs) && Array.isArray(v.links) && v.links.every(isLink)
  return ok ? (v as Conversation) : EMPTY_CONVERSATION
}

export const saveConversation = (store: Store, session: string, c: Conversation) => store.set(`conv:${session}`, c)

export async function allLinks(store: Store): Promise<ConversationLink[]> {
  const sessions = (await store.keys()).filter(k => k.startsWith('conv:')).map(k => k.slice('conv:'.length))
  const links: ConversationLink[] = []
  for (const s of sessions) links.push(...(await loadConversation(store, s)).links)
  return links
}

export async function loadSnapshot(store: Store, root: string, branch: string): Promise<BranchSnapshot | null> {
  const v = await store.get(`snap:${root}@${branch}`)
  const ok = isRecord(v) && strings(v.docs) && typeof v.code === 'boolean' && typeof v.at === 'number'
  return ok ? (v as BranchSnapshot) : null
}

export const saveSnapshot = (store: Store, root: string, branch: string, s: BranchSnapshot) => store.set(`snap:${root}@${branch}`, s)

export async function implementedBy(store: Store, id: DocId): Promise<string[]> {
  const v = await store.get(`impl:${id}`)
  return strings(v) ? v : []
}

export async function markImplemented(store: Store, id: DocId, prKey: string): Promise<void> {
  const prs = await implementedBy(store, id)
  if (!prs.includes(prKey)) await store.set(`impl:${id}`, [...prs, prKey])
}
