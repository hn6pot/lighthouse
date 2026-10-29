// A branch's specs and plans: which ones, where their file and page are, and where they stand.
import type { Host, Store } from '../host'
import type { BranchDoc, Tracked } from '../model'
import { join } from '../paths'
import type { ConversationLink } from './conversation'
import { baseSpecs, codeAfterPlan, docHash, fileHash, plansCitingOnBase, touchedDocs } from './git-docs'
import { copyPath, docKind, docName, parseDocId, repoDocId, type DocId } from './identity'
import { implementedBy, loadPublish, loadSnapshot, markImplemented, saveSnapshot } from './records'
import { planState, specState } from './status'

export type BranchRef = { root: string; slug: string | null; base: string; branch: string; path: string | null }

/** A spec outside any repo, cited by its `~/…` path in a plan. */
const LOCAL_SPEC = /~\/[^\s`'"()<>[\]]*\/specs\/[^\s`'"()<>[\]]+\.md/g

const baseName = (ref: string) => ref.split('/').pop() ?? ref
const cites = (text: string, ref: string) => text.includes(ref) || text.includes(baseName(ref))

type Located = { ref: string; inRepo: boolean; file: string | null; text: string | null }

export async function branchDocs(host: Host, store: Store, b: BranchRef, links: readonly ConversationLink[]): Promise<BranchDoc[]> {
  const { slug } = b
  const touched = slug === null ? { docs: [], code: false } : await touchedDocs(host, b.root, b.base, b.branch, b.path)
  const ids: DocId[] = []
  const add = (id: DocId) => void (ids.includes(id) ? undefined : ids.push(id))
  if (slug !== null) for (const rel of touched.docs) add(repoDocId(slug, rel))
  // The conversation's links: documents outside a repo, or of this same repo.
  const mine = links.filter(l => l.root === b.root && l.branch === b.branch)
  for (const l of mine) {
    const p = parseDocId(l.doc)
    if (p !== null && ('path' in p || p.slug === slug)) add(l.doc)
  }

  const located = new Map<DocId, Located>()
  const locate = async (id: DocId): Promise<Located> => {
    const known = located.get(id)
    if (known) return known
    const p = parseDocId(id)
    const ref = p === null ? id : 'path' in p ? p.path : p.rel
    const files = p === null ? [] : 'path' in p ? [join('/', p.path, host.home)] : [...(b.path ? [`${b.path}/${p.rel}`] : []), `${b.root}/${p.rel}`]
    let found: Located = { ref, inRepo: p !== null && 'slug' in p, file: null, text: null }
    for (const file of files) {
      const text = await host.read(file)
      if (text !== null) {
        found = { ...found, file, text }
        break
      }
    }
    located.set(id, found)
    return found
  }

  // The specs the plans cite: on the base or already here (by path or file name), or outside a repo (by `~/…` path).
  const plans = ids.filter(id => docKind(id) === 'plan')
  const candidates = slug === null ? [] : [...new Set([...(await baseSpecs(host, b.root, b.base)), ...ids.flatMap(id => (docKind(id) === 'spec' && id.startsWith(`${slug}:`) ? [id.slice(slug.length + 1)] : []))])]
  for (const plan of plans) {
    const { text } = await locate(plan)
    if (text === null) continue
    if (slug !== null) for (const rel of candidates) if (cites(text, rel)) add(repoDocId(slug, rel))
    for (const [path] of text.matchAll(LOCAL_SPEC)) if (parseDocId(path) !== null) add(path)
  }

  const done = async (id: DocId) => (await implementedBy(store, id)).length > 0
  const docs: BranchDoc[] = []
  for (const id of ids) {
    const kind = docKind(id)
    if (kind === null) continue
    const at = await locate(id)
    const hash = at.inRepo && b.path === null ? await docHash(host, b.root, b.branch, null, at.ref) : at.file !== null ? await fileHash(host, at.file) : null
    const publish = await loadPublish(store, id)
    const copy = publish ? copyPath(id, host.home) : null
    let state
    if (kind === 'plan') {
      const linked = mine.some(l => l.doc === id)
      const after = at.inRepo ? await codeAfterPlan(host, b.root, b.branch, at.ref) : null
      state = planState({ codeAfter: after ?? linked, done: await done(id) })
    } else {
      const citing = new Set<DocId>()
      for (const plan of plans) {
        const { text } = await locate(plan)
        if (text !== null && cites(text, at.ref)) citing.add(plan)
      }
      if (slug !== null && at.inRepo) for (const rel of await plansCitingOnBase(host, b.root, b.base, baseName(at.ref))) citing.add(repoDocId(slug, rel))
      let citingDone = 0
      for (const plan of citing) if (await done(plan)) citingDone++
      state = specState({ citing: citing.size, citingDone, done: await done(id) })
    }
    docs.push({
      id,
      kind,
      name: docName(at.ref),
      state,
      file: at.file,
      ...(publish ? { page: publish.url } : {}),
      ...(copy !== null && (await host.read(copy)) !== null ? { copy } : {}),
      stale: publish !== null && publish.hash !== null && hash !== null && publish.hash !== hash,
    })
  }
  await saveSnapshot(store, b.root, b.branch, { docs: ids, code: touched.code, at: await host.now() })
  return docs.sort((x, y) => (x.kind === y.kind ? x.name.localeCompare(y.name) : x.kind === 'spec' ? -1 : 1))
}

/** Once a PR is merged: every document of its branch's last snapshot is implemented by it, if that branch touched code. */
export async function markMerged(store: Store, s: Tracked): Promise<void> {
  if (s.stage === 'open') return
  const snap = await loadSnapshot(store, s.root, s.branch)
  if (!snap?.code) return
  for (const id of snap.docs) await markImplemented(store, id, s.key)
}
