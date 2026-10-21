// "Merge": the PR as we showed it, with the method the repo allows.
import type { Host } from '../host'
import type { Texts } from '../i18n'
import { ghEnv, type GhConfigDirs } from './gh'

type RepoSettings = { allow_squash_merge?: boolean; allow_merge_commit?: boolean; allow_rebase_merge?: boolean }

/** Returns the message to show; `head` prevents merging a commit pushed since the last tick. */
export async function merge(host: Host, dirs: GhConfigDirs, slug: string, number: number, head: string, t: Texts): Promise<string> {
  const env = ghEnv(slug, host.home, dirs)
  const repo = await host.run(['gh', 'api', `repos/${slug}`], { env, timeoutMs: 30_000 })
  if (repo.exitCode !== 0) return t.toast.notMerged(number, repo.stderr.trim())
  const r = JSON.parse(repo.stdout) as RepoSettings
  const method = r.allow_squash_merge ? 'squash' : r.allow_merge_commit ? 'merge' : 'rebase'
  const merged = await host.run(['gh', 'pr', 'merge', String(number), `--${method}`, '--match-head-commit', head, '-R', slug], { env, timeoutMs: 60_000 })
  return merged.exitCode === 0 ? t.toast.merged(number, method) : t.toast.notMerged(number, merged.stderr.trim())
}
