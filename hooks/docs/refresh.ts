// At the tick: apply what the hook noted, then work out every shown branch's documents, at most every 30 s.
import type { Host, Store } from '../host'
import type { BranchDoc, TreeState, Tracked } from '../model'
import { branchDocs, markMerged, type BranchRef } from './collect'
import { baseSpecs } from './git-docs'
import { applyDocEvents, type DocEvent } from './events'
import { allLinks, forgetBranches, loadSnapshot, saveSnapshot } from './records'

export const DOCS_MS = 30_000

/** Absent from the tick's context: the feature is off. */
export type DocsContext = { store: Store; events: DocEvent[]; at?: number; byBranch: Map<string, BranchDoc[]> }

const keyOf = (root: string, branch: string) => `${root}@${branch}`

/** Applies the noted events, then recomputes every shown branch's documents when an event came or DOCS_MS passed; marks merged PRs. */
export async function refreshDocs(host: Host, docs: DocsContext, session: string, trees: readonly TreeState[], tracked: readonly Tracked[], now: number): Promise<void> {
  const events = docs.events.splice(0)
  // Only an event that recorded something skips the wait: code writes mostly link nothing new.
  const changed = events.length > 0 && (await applyDocEvents(host, docs.store, session, events))
  if (!changed && docs.at !== undefined && now - docs.at < DOCS_MS) return
  docs.at = now

  // Before the branches are read again: once merged, a branch's diff may go empty.
  for (const s of tracked) {
    try {
      await markMerged(docs.store, s)
    } catch {
      // the next pass tries again
    }
  }

  // A cleaned-up PR's branch name may be reused: what it had until then goes.
  await forgetBranches(docs.store, tracked.filter(s => s.stage === 'cleaned').map(s => ({ root: s.root, branch: s.branch, at: s.updatedAt }))).catch(() => undefined)

  const links = await allLinks(docs.store)
  const byBranch = new Map<string, BranchDoc[]>()
  const specsOf = new Map<string, readonly string[]>()
  for (const tree of trees) {
    // Listed once per repo: the same for all its branches.
    const specsOnBase = tree.slug === null ? [] : await baseSpecs(host, tree.root, tree.base)
    specsOf.set(tree.root, specsOnBase)
    const ref = (branch: string, path: string | null): BranchRef => ({ root: tree.root, slug: tree.slug, base: tree.base, branch, path, specsOnBase })
    const refs = [...tree.branches.map(b => ref(b.name, b.path)), ...tree.prs.flatMap(p => (p.localBranch && !tree.branches.some(b => b.name === p.localBranch) ? [ref(p.localBranch, p.path)] : []))]
    for (const r of refs) {
      try {
        byBranch.set(keyOf(r.root, r.branch), await branchDocs(host, docs.store, r, links))
      } catch {
        // one unreadable branch does not block the others
      }
    }
    // A PR pushed under another name: its merged card reads the snapshot under the PR's branch.
    for (const p of tree.prs) {
      if (!p.localBranch || p.localBranch === p.branch) continue
      try {
        const snap = await loadSnapshot(docs.store, tree.root, p.localBranch)
        if (snap) await saveSnapshot(docs.store, tree.root, p.branch, snap)
      } catch {
        // kept under its local name only
      }
    }
  }
  // A merged card keeps its documents until it goes: from its snapshot, once its diff is empty or its branch gone.
  for (const s of tracked) {
    const tree = trees.find(x => x.root === s.root)
    if (!tree || s.stage === 'open' || s.stage === 'cleaned') continue
    try {
      const snap = await loadSnapshot(docs.store, s.root, s.branch)
      const path = tree.branches.find(b => b.name === s.branch)?.path ?? null
      const ref: BranchRef = { root: s.root, slug: tree.slug, base: s.base, branch: s.branch, path, ...(s.base === tree.base ? { specsOnBase: specsOf.get(tree.root) } : {}) }
      byBranch.set(keyOf(s.root, s.branch), await branchDocs(host, docs.store, ref, links, snap?.docs ?? []))
    } catch {
      // the card shows no documents
    }
  }
  docs.byBranch = byBranch
}

/** The documents of `root@branch` as last computed (empty when unknown). */
export function docsOf(docs: DocsContext | undefined, root: string, branch: string | undefined): BranchDoc[] {
  return docs === undefined || branch === undefined ? [] : (docs.byBranch.get(keyOf(root, branch)) ?? [])
}
