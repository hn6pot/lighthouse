// PRs, their files, a commit's runs, and the summary of their CI.
import type { Host } from '../host'
import type { CiState, PrSummary, ReviewState, Run } from '../model'
import { ghEnv, ghJson, type GhConfigDirs } from './gh'

type Check = { name?: string; context?: string; status?: string; conclusion?: string | null; state?: string }

export type GhPr = {
  number: number
  title: string
  url: string
  state: 'OPEN' | 'MERGED' | 'CLOSED'
  headRefName: string
  headRefOid: string
  baseRefName: string
  mergeCommit: { oid: string } | null
  mergedAt: string | null
  reviewDecision: string | null
  statusCheckRollup: Check[]
  isDraft: boolean
  mergeable: string
  mergeStateStatus: string
  createdAt?: string
  updatedAt?: string
  additions?: number
  deletions?: number
  changedFiles?: number
}

const FIELDS =
  'number,title,url,state,headRefName,headRefOid,baseRefName,mergeCommit,mergedAt,reviewDecision,statusCheckRollup,isDraft,mergeable,mergeStateStatus,createdAt,updatedAt,additions,deletions,changedFiles'

const FAILURES = ['FAILURE', 'ERROR', 'TIMED_OUT', 'CANCELLED']

export function ciState(rollup: readonly Check[]): CiState {
  if (rollup.length === 0) return 'none'
  const outcomes = rollup.map(v => (v.conclusion ?? v.state ?? '').toUpperCase())
  if (outcomes.some(i => FAILURES.includes(i))) return 'failing'
  if (rollup.some(v => (v.status ?? '').toUpperCase() !== 'COMPLETED' && v.state === undefined)) return 'pending'
  if (outcomes.some(i => i === 'PENDING')) return 'pending'
  return 'ok'
}

const REVIEWS: Record<string, ReviewState> = { APPROVED: 'approved', CHANGES_REQUESTED: 'changes', REVIEW_REQUIRED: 'pending' }

export function summarizePr(pr: GhPr): PrSummary {
  return {
    number: pr.number,
    title: pr.title,
    url: pr.url,
    branch: pr.headRefName,
    path: null, // filled in by the tick, which knows the worktrees
    head: pr.headRefOid,
    ci: ciState(pr.statusCheckRollup),
    failedChecks: pr.statusCheckRollup
      .filter(v => FAILURES.includes((v.conclusion ?? v.state ?? '').toUpperCase()))
      .map(v => v.name ?? v.context ?? '?'),
    review: REVIEWS[pr.reviewDecision ?? ''] ?? 'none',
    draft: pr.isDraft,
    conflict: pr.mergeable === 'CONFLICTING',
    behind: pr.mergeStateStatus === 'BEHIND',
    unpushed: 0, // filled in by the tick, which knows the local branches
    ...(pr.createdAt ? { createdAt: Date.parse(pr.createdAt) } : {}),
    ...(pr.updatedAt ? { updatedAt: Date.parse(pr.updatedAt) } : {}),
    ...(pr.additions !== undefined ? { additions: pr.additions, deletions: pr.deletions ?? 0, files: pr.changedFiles ?? 0 } : {}),
  }
}

export const myOpenPrs = (host: Host, dirs: GhConfigDirs, slug: string) =>
  ghJson<GhPr[]>(host, dirs, slug, ['pr', 'list', '--author', '@me', '--state', 'open', '--json', FIELDS])

export const prDetail = (host: Host, dirs: GhConfigDirs, slug: string, number: number) =>
  ghJson<GhPr & { files: { path: string }[]; author?: { login: string } }>(host, dirs, slug, ['pr', 'view', String(number), '--json', `${FIELDS},files,author`])

/** My login on the gh account that goes with the repo; `cache` keeps the answer per account for the session. */
export async function myLogin(host: Host, dirs: GhConfigDirs, slug: string, cache: Map<string, string>): Promise<string> {
  const env = ghEnv(slug, host.home, dirs)
  const account = env?.GH_CONFIG_DIR ?? ''
  const known = cache.get(account)
  if (known !== undefined) return known
  const r = await host.run(['gh', 'api', 'user', '--jq', '.login'], { env, timeoutMs: 30_000 })
  const login = r.stdout.trim()
  if (r.exitCode !== 0 || login === '') throw new Error(`gh api user: ${r.stderr.trim()}`)
  cache.set(account, login)
  return login
}

export const commitRuns = (host: Host, dirs: GhConfigDirs, slug: string, sha: string) =>
  ghJson<Run[]>(host, dirs, slug, ['run', 'list', '--commit', sha, '--json', 'name,status,conclusion,url'])
