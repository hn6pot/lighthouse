// The tool.call hook only notes what happened; the tick turns it into conversation links and page records here.
import type { Host, Store } from '../host'
import type { Repo } from '../model'
import { join, parent } from '../paths'
import { originSlug, roots } from '../repos/git'
import { DATA_DIR } from '../sessions/registry'
import { sourceTag } from './artifact'
import { noteCode, noteDoc, type Conversation } from './conversation'
import { fileHash } from './git-docs'
import { copyPath, docKind, localDocId, parseDocId, repoDocId, type DocId } from './identity'
import { loadConversation, saveConversation, savePublish } from './records'

/** Noted by the tool.call hook, applied at the tick (the hook runs no git). Paths are absolute. */
export type DocEvent =
  | { kind: 'write'; path: string; at: number }
  | { kind: 'commit'; folder: string; at: number }
  | { kind: 'publish'; html: string; url: string; at: number }

/** The document a path is, or null when it is not a spec or plan. */
export async function resolveDoc(host: Host, path: string): Promise<DocId | null> {
  if (docKind(path) === null) return null
  const found = await roots(host, parent(path))
  if (found && path.startsWith(found.tree + '/')) {
    const slug = await originSlug(host, found.root)
    if (slug !== null) return repoDocId(slug, path.slice(found.tree.length + 1))
  }
  return localDocId(path, host.home)
}

/** The repo and branch code written in `folder` belongs to; null outside a repo or on a detached HEAD. */
async function codeAt(host: Host, folder: string): Promise<{ root: string; branch: string } | null> {
  const found = await roots(host, folder)
  if (found === null) return null
  const r = await host.run(['git', '-C', found.tree, 'branch', '--show-current'])
  const branch = r.stdout.trim()
  return r.exitCode === 0 && branch !== '' ? { root: found.root, branch } : null
}

/** The Markdown a page was built from and its hash: in a known repo, its worktrees first, then its main folder. */
async function markdownHash(host: Host, id: DocId, repos: readonly Repo[]): Promise<string | null> {
  const parsed = parseDocId(id)
  if (parsed === null) return null
  if ('path' in parsed) return fileHash(host, join('/', parsed.path, host.home))
  const repo = repos.find(r => r.slug === parsed.slug)
  if (!repo) return null
  for (const tree of [...repo.trees.filter(t => t !== repo.root), repo.root]) {
    const hash = await fileHash(host, `${tree}/${parsed.rel}`)
    if (hash !== null) return hash
  }
  return null
}

const kindOf = (id: DocId) => {
  const parsed = parseDocId(id)
  return parsed === null ? null : docKind('path' in parsed ? parsed.path : parsed.rel)
}

/** Applies the events in order: conversation links, publish records, page copies. True when something was recorded. */
export async function applyDocEvents(host: Host, store: Store, session: string, repos: readonly Repo[], events: readonly DocEvent[]): Promise<boolean> {
  const before = await loadConversation(store, session)
  let c: Conversation = before
  let published = false
  const mine = `${host.home}/${DATA_DIR}/`
  for (const e of events) {
    try {
      if (e.kind === 'publish') {
        const html = await host.read(e.html)
        const id = html === null ? null : sourceTag(html)
        const kind = id === null ? null : kindOf(id)
        if (id === null || kind === null) continue
        c = noteDoc(c, id, kind)
        const hash = await markdownHash(host, id, repos)
        const copy = copyPath(id, host.home)
        await host.run(['mkdir', '-p', parent(copy)])
        await host.run(['cp', e.html, copy])
        await savePublish(store, id, { url: e.url, at: e.at, hash, session })
        published = true
        continue
      }
      const folder = e.kind === 'commit' ? e.folder : parent(e.path)
      if ((folder + '/').startsWith(mine)) continue
      if (e.kind === 'write') {
        const id = await resolveDoc(host, e.path)
        const kind = docKind(e.path)
        if (id !== null && kind !== null) {
          c = noteDoc(c, id, kind)
          continue
        }
      }
      const at = await codeAt(host, folder)
      if (at !== null) c = noteCode(c, at.root, at.branch, e.at)
    } catch {
      // one event that fails does not stop the others
    }
  }
  if (c !== before) await saveConversation(store, session, c)
  return published || c !== before
}
