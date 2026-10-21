// The open PRs where my review is requested, on the active gh account and on each account of the config.
import type { Host } from '../host'
import type { ReviewRequest } from '../model'
import { expandHome, type GhConfigDirs } from './gh'

type Found = {
  number: number
  title: string
  url: string
  isDraft: boolean
  updatedAt?: string
  repository: { nameWithOwner: string }
  author: { login: string } | null
}

const FIELDS = 'number,title,url,isDraft,updatedAt,repository,author'

/** The active account (undefined), then each gh config folder of the config, once each. */
export const accounts = (dirs: GhConfigDirs, home: string): (string | undefined)[] => [undefined, ...new Set(Object.values(dirs).map(d => expandHome(d, home)))]

/** One entry per PR even when two accounts see it, newest activity first; an account gh refuses is left out, all of them throws. */
export async function reviewRequests(host: Host, dirs: GhConfigDirs): Promise<ReviewRequest[]> {
  const seen = new Map<string, ReviewRequest>()
  const list = accounts(dirs, host.home)
  let failed = 0
  for (const dir of list) {
    const r = await host.run(['gh', 'search', 'prs', '--review-requested=@me', '--state=open', '--json', FIELDS, '--limit', '50'], {
      env: dir === undefined ? undefined : { GH_CONFIG_DIR: dir },
      timeoutMs: 30_000,
    })
    let found: Found[]
    try {
      if (r.exitCode !== 0) throw new Error(r.stderr.trim())
      found = JSON.parse(r.stdout) as Found[]
    } catch {
      failed++
      continue
    }
    for (const pr of found) {
      if (seen.has(pr.url)) continue
      seen.set(pr.url, {
        slug: pr.repository.nameWithOwner,
        number: pr.number,
        title: pr.title,
        url: pr.url,
        author: pr.author?.login ?? '?',
        draft: pr.isDraft,
        ...(pr.updatedAt ? { updatedAt: Date.parse(pr.updatedAt) } : {}),
      })
    }
  }
  if (failed === list.length) throw new Error('gh search prs: no account answered')
  return [...seen.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
}
