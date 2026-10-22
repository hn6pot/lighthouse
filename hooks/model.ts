// Domain types: a repo, the state of a working tree, a tracked PR.

/** A tracked repo: its root (the main folder) and `owner/repo`, null without a GitHub origin. */
export type Repo = { root: string; slug: string | null; trees: string[] }

/** What the band shows of a repo. */
export type TreeState = {
  root: string
  name: string
  /** `owner/repo`, null without a GitHub origin. */
  slug: string | null
  branch: string
  base: string
  behind: number
  uncommitted: number
  prs: PrSummary[]
  /** Work in progress without an open PR. */
  branches: LocalBranch[]
  /** The last tag on the base, and how many commits came after it. */
  release?: { tag: string; since: number }
}

/** A local branch where work moves on. Pushed = tracks `origin/<its name>`. */
/** Who works on a PR or a branch: this session, other live sessions (named by their first prompt), or nobody known. */
/** `sessions`: each other session with its desktop id when known, to open it from the pane. */
export type Owner =
  | { kind: 'here' }
  | { kind: 'others'; labels: string[]; sessions?: { label: string; desktopId?: string }[] }
  | { kind: 'unknown' }

export type LocalBranch = {
  name: string
  /** Its worktree, if it has one. */
  path: string | null
  remote: 'ok' | 'none' | 'deleted'
  /** Local commits ahead of its remote branch. */
  unpushed: number
  /** Commits ahead of the base. */
  ahead: number
  /** What it tracks (`origin/x`), its tip commit, and how far ahead of what it tracks. */
  upstream?: string
  tip?: string
  aheadOfUpstream?: number
  /** The open PR this branch was started from (it contains that PR's head). */
  stackedOn?: number
  /** Set by the tick, from the sessions' registry. */
  owner?: Owner
}

/** An open PR where my review is requested, in any repo. */
export type ReviewRequest = {
  slug: string
  number: number
  title: string
  url: string
  /** Its author's login. */
  author: string
  draft: boolean
  updatedAt?: number
  /** Repo, author and age, worded at the tick (so the pane redraws when they change). */
  facts?: string
}

export type CiState = 'ok' | 'failing' | 'pending' | 'none'

export type ReviewState = 'approved' | 'changes' | 'pending' | 'none'

/** An open PR as the pane shows it. */
export type PrSummary = {
  number: number
  title: string
  url: string
  branch: string
  /** The worktree of its branch, if there is one. */
  path: string | null
  /** The head commit seen at the last tick: "Merge" merges only that one. */
  head: string
  ci: CiState
  /** Failing checks, by name. */
  failedChecks: string[]
  review: ReviewState
  draft: boolean
  conflict: boolean
  /** The base moved on since the branch (GitHub: BEHIND). */
  behind: boolean
  /** Commits of the local branch not pushed yet. */
  unpushed: number
  /** Set by the tick, from the sessions' registry. */
  owner?: Owner
  /** The local branch of this PR, whatever its name. */
  localBranch?: string
  /** When it was opened and last active (ms), and its size: for the card's age and size line. */
  createdAt?: number
  updatedAt?: number
  additions?: number
  deletions?: number
  files?: number
  /** Age and size, worded at the tick (so the pane redraws when they change). */
  facts?: { text: string; stale: boolean }
}

export type Stage =
  | 'open'
  | 'merged'
  | 'deploying'
  | 'deploy-doubt'
  | 'failed'
  | 'deployed'
  | 'cleanup-doubt'
  | 'cleaned'

/** A tracked PR, kept in the store shared between sessions. */
export type Tracked = {
  key: string // "owner/repo#12"
  slug: string
  root: string
  number: number
  branch: string
  base: string
  stage: Stage
  updatedAt: number
  mergedAt?: number
  mergeCommit?: string
  prHead?: string
  /** The session that ran a deploy command in this repo, and when: it handles the deploy itself. */
  handledBy?: string
  handledAt?: number
  /** Set by the tick for the pane (never saved): the deploy is handled here or in another session. */
  handled?: 'here' | 'other'
  /** Whose it is, set by the tick for the pane (never saved). */
  owner?: Owner
  /** How a repo without a rule deploys, as inferred from its files. */
  note?: string
  /** The PR's title, to show it once merged. */
  title?: string
  command?: string // deploy command proposed or launched
  reason?: string // why it is in doubt or failed
  link?: string // GitHub run or log
  launchedBy?: string // id of the session that launched the manual deploy
  launchedAt?: number // when it launched it
}

/** What the rules say to do after a merge. */
export type Plan =
  | { kind: 'workflow'; workflow?: string }
  | { kind: 'delay'; ms: number }
  | { kind: 'immediate' }
  | { kind: 'release' }
  | { kind: 'manual'; command: string }
  | { kind: 'doubt'; reason: string; command?: string }

/** A GitHub Actions run. */
export type Run = { name: string; status: string; conclusion: string | null; url: string }

/** What a commit on the base brought, for the Releases pane. */
export type ReleaseKind = 'fix' | 'feat' | 'other'

/** `title` without its `type(scope): ` prefix nor its ` (#N)` suffix; `number` null without a PR. */
export type ReleaseEntry = { sha: string; number: number | null; title: string; kind: ReleaseKind }

/** A past release: its tag, its date (ms), and the commits since the release before it. */
export type ReleaseTag = { tag: string; date: number; entries: ReleaseEntry[] }

/** What a detached release left in `~/.lighthouse/releases/<owner>__<repo>.json`. */
export type ReleaseRecord = { pid: number; startedAt: number; tagAtLaunch: string | null; expected: string; log: string }

/** Where a repo's last release stands. `warning`: a new tag, but the command failed after it. */
export type ReleaseRun =
  | { kind: 'idle' }
  | { kind: 'running'; startedAt: number; expected: string }
  | { kind: 'done'; startedAt: number; outcome: 'ok' | 'warning' | 'failed' | 'died'; version: string | null; lastLine: string; log: string }
