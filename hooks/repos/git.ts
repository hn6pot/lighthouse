// What git says about a folder: its repo, its origin, its base, the state of its trees.
import type { Host } from '../host'
import type { Texts } from '../i18n'
import type { LocalBranch } from '../model'
import { parent } from '../paths'

const git = (host: Host, folder: string, ...args: string[]) => host.run(['git', '-C', folder, ...args])
const line = (text: string) => text.trim().split('\n')[0] ?? ''

export async function roots(host: Host, folder: string): Promise<{ root: string; tree: string } | null> {
  const tree = await git(host, folder, 'rev-parse', '--show-toplevel')
  if (tree.exitCode !== 0) return null
  const common = await git(host, folder, 'rev-parse', '--path-format=absolute', '--git-common-dir')
  const gitDir = line(common.stdout)
  const root = gitDir.endsWith('/.git') ? parent(gitDir) : line(tree.stdout)
  return { root, tree: line(tree.stdout) }
}

export function slugFromUrl(url: string): string | null {
  const match = url.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : null
}

export async function originSlug(host: Host, root: string): Promise<string | null> {
  const url = await git(host, root, 'remote', 'get-url', 'origin')
  return url.exitCode === 0 ? slugFromUrl(url.stdout) : null
}

export async function baseBranch(host: Host, root: string): Promise<string> {
  const ref = await git(host, root, 'symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
  return ref.exitCode === 0 ? line(ref.stdout).replace(/^origin\//, '') : 'main'
}

export async function treeState(host: Host, tree: string, base: string, t: Texts) {
  const branch = line((await git(host, tree, 'branch', '--show-current')).stdout) || t.detached
  const behind = Number(line((await git(host, tree, 'rev-list', '--count', `HEAD..origin/${base}`)).stdout)) || 0
  // No optional locks: a status must not take index.lock during a commit of Claude's.
  const status = (await git(host, tree, '--no-optional-locks', 'status', '--porcelain')).stdout
  const uncommitted = status.split('\n').filter(l => l.trim() !== '').length
  return { branch, behind, uncommitted }
}

export async function refresh(host: Host, root: string, base: string): Promise<void> {
  await host.run(['git', '-C', root, 'fetch', '--quiet', 'origin', base], { timeoutMs: 60_000 })
}

export function parseWorktrees(text: string): { path: string; branch: string | null; head: string }[] {
  return text
    .split('\n\n')
    .map(block => block.trim())
    .filter(block => block.startsWith('worktree '))
    .map(block => {
      const fields = Object.fromEntries(block.split('\n').map(l => [l.split(' ')[0], l.slice(l.indexOf(' ') + 1)]))
      return {
        path: fields.worktree,
        branch: fields.branch ? fields.branch.replace('refs/heads/', '') : null,
        head: fields.HEAD ?? '',
      }
    })
}

export async function worktrees(host: Host, root: string) {
  return parseWorktrees((await git(host, root, 'worktree', 'list', '--porcelain')).stdout)
}

export async function head(host: Host, tree: string): Promise<string | null> {
  const r = await git(host, tree, 'rev-parse', 'HEAD')
  return r.exitCode === 0 ? line(r.stdout) : null
}

/** `git for-each-ref` as `name⇥upstream⇥track⇥worktree` lines. Pushed = tracks `origin/<its name>`. */
/** `git for-each-ref` as `name⇥upstream⇥track⇥worktree⇥tip` lines. */
export function parseBranches(text: string): Omit<LocalBranch, 'ahead'>[] {
  return text
    .split('\n')
    .filter(l => l.trim() !== '')
    .map(l => {
      const [name = '', upstream = '', track = '', path = '', tip = ''] = l.split('\t')
      const own = upstream === `origin/${name}`
      const remote = !own ? 'none' : track.includes('gone') ? 'deleted' : 'ok'
      const unpushed = remote === 'ok' ? Number(track.match(/ahead (\d+)/)?.[1] ?? 0) : 0
      // How far ahead of whatever it tracks: a branch pushed under another name still counts its unpushed commits.
      const aheadOfUpstream = upstream && !track.includes('gone') ? Number(track.match(/ahead (\d+)/)?.[1] ?? 0) : 0
      return { name, path: path || null, remote, unpushed, ...(upstream ? { upstream } : {}), ...(tip ? { tip } : {}), ...(upstream ? { aheadOfUpstream } : {}) } as const
    })
}

/** Branches where work is in progress: ahead of the base, or the base itself with unpushed commits. */
export async function localBranches(host: Host, root: string, base: string): Promise<LocalBranch[]> {
  const refs = await git(host, root, 'for-each-ref', 'refs/heads', '--format=%(refname:short)%09%(upstream:short)%09%(upstream:track)%09%(worktreepath)%09%(objectname)')
  if (refs.exitCode !== 0) return []
  const result: LocalBranch[] = []
  for (const b of parseBranches(refs.stdout)) {
    if (b.name === base) {
      if (b.unpushed > 0) result.push({ ...b, ahead: b.unpushed })
      continue
    }
    const ahead = Number(line((await git(host, root, 'rev-list', '--count', `origin/${base}..${b.name}`)).stdout)) || 0
    if (ahead > 0) result.push({ ...b, ahead })
  }
  return result
}

/** Pushes `branch`; `to` names the remote branch when it differs (a local branch pushed as a PR's branch). */
export async function push(host: Host, root: string, path: string | null, branch: string, t: Texts, to?: string): Promise<string> {
  const refspec = to && to !== branch ? `${branch}:${to}` : branch
  const r = await host.run(['git', '-C', path ?? root, 'push', '-u', 'origin', refspec], { timeoutMs: 120_000 })
  return r.exitCode === 0 ? t.toast.pushed(branch) : t.toast.notPushed(branch, line(r.stderr))
}

/** True if commit `a` is in the history of `b`. */
export async function isAncestor(host: Host, root: string, a: string, b: string): Promise<boolean> {
  return (await git(host, root, 'merge-base', '--is-ancestor', a, b)).exitCode === 0
}

/** The last tag reachable from the base, and how many commits came after it; none without a tag. */
export async function lastRelease(host: Host, root: string, base: string): Promise<{ tag: string; since: number } | undefined> {
  const tag = line((await git(host, root, 'describe', '--tags', '--abbrev=0', `origin/${base}`)).stdout)
  if (!tag) return undefined
  const since = Number(line((await git(host, root, 'rev-list', '--count', `${tag}..origin/${base}`)).stdout)) || 0
  return { tag, since }
}
