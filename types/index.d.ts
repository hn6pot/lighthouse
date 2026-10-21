// Self-contained contract (the validator refuses any import): these shapes copy
// TreeState and Tracked from hooks/model.ts, which stays the reference.
export type LighthousePrSummary = {
  number: number
  title: string
  url: string
  branch: string
  path: string | null
  head: string
  ci: 'ok' | 'failing' | 'pending' | 'none'
  failedChecks: string[]
  review: 'approved' | 'changes' | 'pending' | 'none'
  draft: boolean
  conflict: boolean
  behind: boolean
  unpushed: number
  owner?: { kind: 'here' } | { kind: 'others'; labels: string[]; sessions?: { label: string; desktopId?: string }[] } | { kind: 'unknown' }
  localBranch?: string
  createdAt?: number
  updatedAt?: number
  additions?: number
  deletions?: number
  files?: number
  facts?: { text: string; stale: boolean }
}

export type LighthouseTree = {
  root: string
  name: string
  slug: string | null
  branch: string
  base: string
  behind: number
  uncommitted: number
  prs: LighthousePrSummary[]
  branches: LighthouseBranch[]
  release?: { tag: string; since: number }
}

export type LighthouseBranch = {
  name: string
  path: string | null
  remote: 'ok' | 'none' | 'deleted'
  unpushed: number
  ahead: number
  owner?: { kind: 'here' } | { kind: 'others'; labels: string[]; sessions?: { label: string; desktopId?: string }[] } | { kind: 'unknown' }
  stackedOn?: number
  upstream?: string
  tip?: string
  aheadOfUpstream?: number
}

export type LighthouseTracked = {
  key: string
  slug: string
  root: string
  number: number
  branch: string
  base: string
  stage:
    | 'open'
    | 'merged'
    | 'deploying'
    | 'deploy-doubt'
    | 'failed'
    | 'deployed'
    | 'cleanup-doubt'
    | 'cleaned'
  updatedAt: number
  mergedAt?: number
  mergeCommit?: string
  prHead?: string
  title?: string
  note?: string
  owner?: { kind: 'here' } | { kind: 'others'; labels: string[]; sessions?: { label: string; desktopId?: string }[] } | { kind: 'unknown' }
  command?: string
  reason?: string
  link?: string
  launchedBy?: string
  launchedAt?: number
  handledBy?: string
  handledAt?: number
  handled?: 'here' | 'other'
}

export type LighthouseReview = {
  slug: string
  number: number
  title: string
  url: string
  author: string
  draft: boolean
  updatedAt?: number
  facts?: string
}

export type LighthouseActivity = { id: string; root: string; text: string; number?: number; branch?: string; folder?: string }

declare module 'claude-code' {
  interface PluginState {
    lighthouse: {
      /** The session's repos, as the band shows them. */
      trees: LighthouseTree[]
      /** The PRs to show as event lines (merged and beyond). */
      events: LighthouseTracked[]
      /** Repos unfolded (true) or folded (false) by the person, by root. */
      expanded: Record<string, boolean>
      /** The PR (`owner/repo#12`) whose "Merge" waits for a second press, else null. */
      pendingMerge: string | null
      /** What Claude or the mod is doing right now, per repo. */
      activities: LighthouseActivity[]
      /** Cleaned PRs whose check is being drawn: key → frame. */
      celebrating: Record<string, number>
      /** True while a tick started by the Refresh button runs. */
      refreshing: boolean
      /** Buttons whose action is running, by key. */
      pressed: Record<string, boolean>
      /** The open PRs where my review is requested, in any repo. */
      reviews: LighthouseReview[]
      /** The intent mod's `/intent` command is there: the PRs get a "Review with intent" button. */
      intent: boolean
    }
  }
}
