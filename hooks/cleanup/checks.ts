// Can we clean up safely? The CLAUDE.md checks, adapted to squash merges.
// Rule: a git failure must never look like "nothing to keep": we doubt.
import type { Host } from '../host'
import type { Texts } from '../i18n'
import type { Tracked } from '../model'
import { head, parseWorktrees } from '../repos/git'
import { otherSessionIn } from '../sessions/registry'

export type Verdict = { ok: true; tree: string | null } | { ok: false; reason: string }

const no = (reason: string): Verdict => ({ ok: false, reason })
const inside = (path: string, tree: string) => path === tree || path.startsWith(tree + '/')

// No tree left: only the local branch will be deleted with -D, so it must carry nothing beyond the PR.
async function checkLoneBranch(host: Host, s: Tracked, t: Texts): Promise<Verdict> {
  const r = await host.run(['git', '-C', s.root, 'rev-parse', '--verify', '--quiet', `refs/heads/${s.branch}`])
  if (r.exitCode !== 0) return { ok: true, tree: null } // branch gone: nothing to delete
  const tip = r.stdout.trim()
  if (tip !== s.prHead) return no(t.reason.commitsAfterPrOn(s.branch))
  return { ok: true, tree: null }
}

export async function checkCleanup(host: Host, s: Tracked, ctx: { id: string; cwd: string }, t: Texts): Promise<Verdict> {
  if (s.stage !== 'deployed' && s.stage !== 'cleanup-doubt') return no(t.reason.notDeployed(s.stage))

  // We run the list ourselves: `worktrees()` ignores the exit code (and git.ts stays unchanged for its other callers).
  const list = await host.run(['git', '-C', s.root, 'worktree', 'list', '--porcelain'])
  const trees = list.exitCode === 0 ? parseWorktrees(list.stdout) : []
  if (trees.length === 0) return no(t.reason.worktreesUnreadable)
  const main = trees[0]
  const tree = trees.slice(1).find(a => a.branch === s.branch) ?? null

  if (tree === null) {
    if (main?.branch === s.branch) return no(t.reason.currentInMain(s.branch))
    return checkLoneBranch(host, s, t)
  }

  // Folder deleted by hand but not pruned by git yet: the tree is gone, the branch remains.
  const exists = await host.run(['test', '-d', tree.path])
  if (exists.exitCode !== 0) return checkLoneBranch(host, s, t)

  if (inside(ctx.cwd, tree.path)) return no(t.reason.thisSessionInside)
  if (await otherSessionIn(host, ctx.id, tree.path)) return no(t.reason.otherSessionInside)

  const status = await host.run(['git', '-C', tree.path, '--no-optional-locks', 'status', '--short'])
  if (status.exitCode !== 0) return no(t.reason.statusFailed(tree.path))
  const modified = status.stdout.split('\n').filter(l => l.trim() !== '').length
  if (modified > 0) return no(t.reason.uncommittedIn(modified, tree.path))

  const current = await head(host, tree.path)
  if (current !== s.prHead) return no(t.reason.commitsAfterPr(current?.slice(0, 7), s.prHead?.slice(0, 7)))

  return { ok: true, tree: tree.path }
}
