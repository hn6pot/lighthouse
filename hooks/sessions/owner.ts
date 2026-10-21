// Which session works on a PR or a branch, through the worktree it lives in.
import type { Owner } from '../model'

export type SessionInfo = { id: string; cwd: string; trees: string[]; label?: string; desktopId?: string }

const inside = (path: string, tree: string) => path === tree || path.startsWith(tree + '/')
const worksIn = (s: { cwd: string; trees: string[] }, tree: string) => inside(s.cwd, tree) || s.trees.includes(tree)

/** This session first; else the other live sessions in that worktree; else unknown (no worktree, nobody in it). */
export function ownerOf(path: string | null, mine: { cwd: string; trees: string[] }, others: readonly SessionInfo[]): Owner {
  if (path === null) return { kind: 'unknown' }
  if (worksIn(mine, path)) return { kind: 'here' }
  const sessions = others
    .filter(s => worksIn(s, path))
    .map(s => ({ label: s.label ?? s.id.slice(0, 8), ...(s.desktopId ? { desktopId: s.desktopId } : {}) }))
  return sessions.length > 0 ? { kind: 'others', labels: sessions.map(s => s.label), sessions } : { kind: 'unknown' }
}
