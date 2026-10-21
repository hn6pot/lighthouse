// What Claude or the mod is doing on a repo right now: a text, and the PR or branch it targets.
import { isDeployCommand } from './deploy/manual'
import type { Texts } from './i18n'
import type { Repo, TreeState } from './model'

export type Activity = {
  id: string
  root: string
  text: string
  number?: number
  branch?: string
  /** The folder where it happens: a PR or a branch recognises it by its worktree. */
  folder?: string
}
export type Target = Omit<Activity, 'id'>

const within = (path: string | null | undefined, folder: string | undefined) =>
  !!path && !!folder && (folder === path || folder.startsWith(path + '/'))

/** The repo one of whose trees holds the folder; the most precise one if they are nested. */
export function repoOf(folder: string, repos: readonly Repo[]): Repo | undefined {
  let best: { repo: Repo; length: number } | undefined
  for (const repo of repos) {
    for (const tree of [repo.root, ...repo.trees]) {
      if (within(tree, folder) && tree.length > (best?.length ?? -1)) best = { repo, length: tree.length }
    }
  }
  return best?.repo
}

/** A git or gh command of Claude's that changes a repo's state, else null. */
export function commandActivity(command: string, folder: string, repos: readonly Repo[], t: Texts): Target | null {
  const r = command.match(/\s-R\s+([\w.-]+\/[\w.-]+)/)
  const repo = r ? repos.find(d => d.slug === r[1]) : repoOf(folder, repos)
  if (!repo) return null
  const base = { root: repo.root, folder }
  const git = (verb: string) => new RegExp(`\\bgit\\b[^;&|]*\\b${verb}\\b`).test(command)
  let m: RegExpMatchArray | null
  if (isDeployCommand(command)) return { ...base, text: t.activity.deploys }
  if ((m = command.match(/\bgh\s+pr\s+merge\s+(\d+)/))) return { ...base, number: Number(m[1]), text: t.activity.mergesNumber(m[1]) }
  if (/\bgh\s+pr\s+merge\b/.test(command)) return { ...base, text: t.activity.mergesPr }
  if (/\bgh\s+pr\s+create\b/.test(command)) {
    const head = command.match(/--head\s+([^\s;&|]+)/)
    return { ...base, ...(head ? { branch: head[1] } : {}), text: t.activity.opensAPr }
  }
  if ((m = command.match(/\bgh\s+pr\s+(?:edit|ready|comment|review)\s+(\d+)/))) return { ...base, number: Number(m[1]), text: t.activity.updatesPr }
  if (git('push')) {
    const b = command.match(/\bpush\b(?:\s+-\S+)*\s+origin\s+([^\s;&|]+)/)
    return { ...base, ...(b ? { branch: (b[1] ?? '').replace(/^HEAD:/, '') } : {}), text: t.activity.pushes }
  }
  if (git('rebase')) return { ...base, text: t.activity.rebases }
  if (git('merge')) return { ...base, text: t.activity.mergesBase }
  if (git('pull')) return { ...base, text: t.activity.pulls }
  if (git('commit')) return { ...base, text: t.activity.commits }
  return null
}

const add = <K>(map: Map<K, string[]>, key: K, text: string) => {
  const list = map.get(key) ?? []
  if (!list.includes(text)) list.push(text)
  map.set(key, list)
}

/** Where to show each activity of a repo: on its PR, on its branch, else on the header. */
export function distribute(a: TreeState, activities: readonly Activity[]) {
  const byPr = new Map<number, string[]>()
  const byBranch = new Map<string, string[]>()
  const header: string[] = []
  for (const x of activities.filter(y => y.root === a.root)) {
    const pr = a.prs.find(p =>
      x.number !== undefined ? p.number === x.number : x.branch !== undefined ? p.branch === x.branch : within(p.path, x.folder),
    )
    if (pr) {
      add(byPr, pr.number, x.text)
      continue
    }
    const b = x.number === undefined ? a.branches.find(y => (x.branch !== undefined ? y.name === x.branch : within(y.path, x.folder))) : undefined
    if (b) add(byBranch, b.name, x.text)
    else if (!header.includes(x.text)) header.push(x.text)
  }
  return { header, byPr, byBranch }
}
