// A conversation's documents go to the code it writes next, until it starts a new spec.
import type { DocKind } from '../model'
import type { DocId } from './identity'

/** `root`: the main folder of the repo the code was written in (as `TreeState.root`). */
export type ConversationLink = { doc: DocId; root: string; branch: string; at: number }
/** `active`: the documents the next code goes to; `specs`: every spec this conversation touched. */
export type Conversation = { active: DocId[]; specs: DocId[]; links: ConversationLink[] }

export const EMPTY_CONVERSATION: Conversation = { active: [], specs: [], links: [] }

export function noteDoc(c: Conversation, doc: DocId, kind: DocKind): Conversation {
  if (kind === 'spec' && !c.specs.includes(doc)) return { ...c, active: [doc], specs: [...c.specs, doc] }
  return c.active.includes(doc) ? c : { ...c, active: [...c.active, doc] }
}

export function noteCode(c: Conversation, root: string, branch: string, now: number): Conversation {
  const known = (doc: DocId) => c.links.some(l => l.doc === doc && l.root === root && l.branch === branch)
  const added = c.active.filter(doc => !known(doc)).map(doc => ({ doc, root, branch, at: now }))
  return added.length === 0 ? c : { ...c, links: [...c.links, ...added] }
}
