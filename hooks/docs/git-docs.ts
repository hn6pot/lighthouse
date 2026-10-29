// What git says about documents: their blob hash, the ones a branch touches, the plans that cite a spec.
import type { Host } from '../host'
import { docKind } from './identity'

/** The git blob hash of a file, in or out of a repo; null when it cannot be read. */
export async function fileHash(host: Host, path: string): Promise<string | null> {
  const r = await host.run(['git', 'hash-object', '--', path])
  const hash = r.stdout.trim()
  return r.exitCode === 0 && hash !== '' ? hash : null
}

const git = (host: Host, folder: string, ...args: string[]) => host.run(['git', '-C', folder, ...args])
const lines = (text: string) => text.split('\n').map(l => l.trim()).filter(l => l !== '')
const isDoc = (rel: string) => docKind(rel) !== null

/** Documents the branch adds or modifies against `origin/<base>` (deletions excluded), plus uncommitted ones in its worktree; `code`: its commits touch a file outside specs/plans. Paths relative to the repo. */
export async function touchedDocs(host: Host, root: string, base: string, branch: string, path: string | null): Promise<{ docs: string[]; code: boolean }> {
  const diff = await git(host, root, 'diff', '--name-only', '--diff-filter=d', `origin/${base}...${branch}`)
  const committed = diff.exitCode === 0 ? lines(diff.stdout) : []
  const docs = committed.filter(isDoc)
  if (path !== null) {
    const status = await git(host, path, '--no-optional-locks', 'status', '--porcelain', '--untracked-files=all')
    // `XY path`, or `XY old -> new` for a rename; a deleted file is not a document to show.
    if (status.exitCode === 0) for (const l of status.stdout.split('\n').filter(x => x.length > 3 && !x.slice(0, 2).includes('D'))) docs.push(l.slice(3).split(' -> ').pop() ?? '')
  }
  // Code is what the branch can merge: committed only, so a stray file never makes a docs-only PR count as code.
  return { docs: [...new Set(docs.filter(isDoc))], code: committed.some(f => !isDoc(f)) }
}

/** Spec paths on `origin/<base>` (candidates for a citation by file name). */
export async function baseSpecs(host: Host, root: string, base: string): Promise<string[]> {
  const r = await git(host, root, 'ls-tree', '-r', '--name-only', `origin/${base}`)
  return r.exitCode === 0 ? lines(r.stdout).filter(f => docKind(f) === 'spec') : []
}

/** Plan paths on `origin/<base>` that mention `needle` (a spec's file name). */
export async function plansCitingOnBase(host: Host, root: string, base: string, needle: string): Promise<string[]> {
  const ref = `origin/${base}`
  const r = await git(host, root, 'grep', '-l', '-F', needle, ref, '--', '*plans/*.md')
  if (r.exitCode !== 0) return []
  return lines(r.stdout)
    .map(l => (l.startsWith(`${ref}:`) ? l.slice(ref.length + 1) : l))
    .filter(f => docKind(f) === 'plan')
}

/** True when the branch has a commit after the plan's last commit that touches code; null when the plan is not committed on the branch. */
export async function codeAfterPlan(host: Host, root: string, branch: string, rel: string): Promise<boolean | null> {
  const last = await git(host, root, 'log', '-1', '--format=%H', branch, '--', rel)
  const commit = lines(last.stdout)[0]
  if (last.exitCode !== 0 || commit === undefined) return null
  const after = await git(host, root, 'diff', '--name-only', commit, branch)
  return after.exitCode === 0 && lines(after.stdout).some(f => !isDoc(f))
}

/** The blob hash of a document as the branch has it: the worktree file, else the branch's committed version. */
export async function docHash(host: Host, root: string, branch: string, path: string | null, rel: string): Promise<string | null> {
  if (path !== null) return fileHash(host, `${path}/${rel}`)
  const r = await git(host, root, 'rev-parse', `${branch}:${rel}`)
  const hash = r.stdout.trim()
  return r.exitCode === 0 && hash !== '' ? hash : null
}

/** Git's blob hash of a text (SHA-1 of `blob <bytes>\0` then its bytes), computed without git: the hook runs none. */
export async function blobHash(text: string): Promise<string> {
  const body = new TextEncoder().encode(text)
  const head = new TextEncoder().encode(`blob ${body.length}\0`)
  const all = new Uint8Array(head.length + body.length)
  all.set(head)
  all.set(body, head.length)
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', all))
  return [...digest].map(b => b.toString(16).padStart(2, '0')).join('')
}
