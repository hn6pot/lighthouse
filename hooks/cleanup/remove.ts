// Remove the worktree, the local branch (-D: a branch merged by squash is not "merged" for git), then the PR's branch on GitHub.
import type { Host } from '../host'
import type { Tracked } from '../model'

export async function remove(host: Host, s: Tracked, tree: string | null): Promise<{ ok: boolean; reason?: string }> {
  if (tree !== null) {
    const r = await host.run(['git', '-C', s.root, 'worktree', 'remove', tree])
    if (r.exitCode !== 0) return { ok: false, reason: r.stderr.trim() }
  } else {
    // Tree deleted by hand: prune stale entries (no effect if there are none).
    await host.run(['git', '-C', s.root, 'worktree', 'prune'])
  }
  const b = await host.run(['git', '-C', s.root, 'branch', '-D', s.branch])
  if (b.exitCode !== 0 && !/not found/.test(b.stderr)) return { ok: false, reason: b.stderr.trim() }
  await removeRemote(host, s)
  return { ok: true }
}

/**
 * The PR's branch on GitHub, when GitHub did not delete it on merge: only while it is still at the PR's head
 * (nothing pushed after the merge). Best effort: a refusal (protected branch, no rights) leaves it there.
 */
async function removeRemote(host: Host, s: Tracked): Promise<void> {
  if (!s.prHead) return
  const remote = await host.run(['git', '-C', s.root, 'ls-remote', '--heads', 'origin', s.branch], { timeoutMs: 30_000 })
  const sha = remote.exitCode === 0 ? remote.stdout.split('\t')[0]?.trim() : undefined
  if (sha !== s.prHead) return
  await host.run(['git', '-C', s.root, 'push', 'origin', '--delete', s.branch], { timeoutMs: 60_000 })
}
