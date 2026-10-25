// The pane's and the band's text and colors, computed without drawing anything.
import type { Texts } from '../i18n'
import type { LocalBranch, Owner, PrSummary, ReviewRequest, TreeState, Tracked } from '../model'

/** A Claude Code theme key: it follows the light or dark theme. */
export type Color = 'success' | 'warning' | 'error' | 'subtle' | 'merged'
export type Chip = { text: string; color: Color }
export type PrAction = 'merge' | 'push' | 'fix-ci' | 'comments' | 'update'
export type BranchAction = 'push' | 'open-pr'
export type AskAction = Exclude<PrAction, 'merge' | 'push'>

const short = (slug: string) => slug.split('/')[1] ?? slug
/** Branch names longer than this are cut in the middle in a repo's header. */
const HEADER_BRANCH_MAX = 28

/** Cuts a long name in the middle, keeping its start and its end. */
export function shorten(text: string, max: number): string {
  if (text.length <= max) return text
  const head = Math.ceil((max - 1) / 2)
  const tail = Math.floor((max - 1) / 2)
  return `${text.slice(0, head)}…${text.slice(text.length - tail)}`
}

export function repoHeader(a: TreeState, t: Texts): string {
  return `${a.name} · ${repoDetails(a, t, Infinity)}`
}

/** The header without the repo's name, the branch shortened so the line stays one line. */
export function repoDetails(a: TreeState, t: Texts, branchMax = HEADER_BRANCH_MAX): string {
  const branch = shorten(a.branch, branchMax)
  const parts = [a.behind > 0 ? `${branch} ↓${a.behind}` : branch]
  if (a.uncommitted > 0) parts.push(t.header.uncommitted(a.uncommitted))
  if (a.prs.length > 0) parts.push(t.header.prs(a.prs.length))
  if (a.branches.length > 0) parts.push(t.header.branches(a.branches.length))
  if (a.release) parts.push(t.release(a.release.tag, a.release.since))
  if (parts.length === 1 && a.behind === 0) parts.push(t.header.upToDate)
  return parts.join(' · ')
}

const REVIEW_COLOR: Record<PrSummary['review'], Color> = { approved: 'success', changes: 'error', pending: 'warning', none: 'subtle' }
const CI_COLOR: Record<PrSummary['ci'], Color> = { ok: 'success', failing: 'error', pending: 'warning', none: 'subtle' }

export function prChips(p: PrSummary, t: Texts): Chip[] {
  const named = p.failedChecks.slice(0, 2).join(', ') + (p.failedChecks.length > 2 ? ` +${p.failedChecks.length - 2}` : '')
  const ci = p.ci === 'failing' ? [t.chip.ci.failing, named].filter(Boolean).join(' ') : t.chip.ci[p.ci]
  return [
    ...(p.draft ? [{ text: t.chip.draft, color: 'subtle' } as const] : []),
    { text: t.chip.review[p.review], color: REVIEW_COLOR[p.review] },
    { text: ci, color: CI_COLOR[p.ci] },
    ...(p.conflict ? [{ text: t.chip.conflicts, color: 'error' } as const] : []),
    ...(p.behind ? [{ text: t.chip.behindBase, color: 'warning' } as const] : []),
    ...(p.unpushed > 0 ? [{ text: t.chip.unpushed(p.unpushed), color: 'warning' } as const] : []),
  ]
}

/** The PR's local branch, named on its card. */
export function prLocalLine(p: PrSummary, t: Texts): string | null {
  return p.localBranch ? `⎇ ${p.localBranch}${p.path ? t.worktree : ''}` : null
}

export function prActions(p: PrSummary): PrAction[] {
  const actions: PrAction[] = []
  const ready = !p.draft && !p.conflict && (p.ci === 'ok' || p.ci === 'none') && (p.review === 'approved' || p.review === 'none')
  if (ready && p.unpushed === 0) actions.push('merge')
  if (p.unpushed > 0) actions.push('push')
  if (p.ci === 'failing') actions.push('fix-ci')
  if (p.review === 'changes') actions.push('comments')
  if (p.conflict || p.behind) actions.push('update')
  return actions
}

/** The worst color among the repo's PRs; uncommitted files count as a warning. */
export function repoColor(a: TreeState, t: Texts): Color {
  const colors = [...a.prs.flatMap(p => prChips(p, t)), ...a.branches.flatMap(b => branchChips(b, t))].map(x => x.color)
  if (colors.includes('error')) return 'error'
  if (colors.includes('warning') || a.uncommitted > 0) return 'warning'
  return a.prs.length > 0 ? 'success' : 'subtle'
}

/** What a pane agent receives for a PR. `ghConfigDir`: the repo's gh account, if not the default one. */
export function actionPrompt(action: AskAction, a: TreeState, p: PrSummary, t: Texts, ghConfigDir: string | undefined): string {
  const gh = ghCommand(ghConfigDir)
  return withAccount(prInstruction(action, a, p, t, gh), gh, t)
}

function prInstruction(action: AskAction, a: TreeState, p: PrSummary, t: Texts, gh: string): string {
  const repo = a.slug ?? a.name
  switch (action) {
    case 'fix-ci':
      return t.prompt.fixCi({ number: p.number, repo, branch: p.branch, checks: p.failedChecks.join(', ') || '?' })
    case 'comments':
      return t.prompt.comments({ number: p.number, repo, branch: p.branch, gh })
    case 'update':
      return t.prompt.update({ number: p.number, repo, branch: p.branch, base: a.base, conflict: p.conflict })
  }
}

export function branchChips(b: LocalBranch, t: Texts): Chip[] {
  const stacked: Chip[] = b.stackedOn ? [{ text: t.chip.stackedOn(b.stackedOn), color: 'subtle' }] : []
  return [...stacked, ...remoteChips(b, t)]
}

function remoteChips(b: LocalBranch, t: Texts): Chip[] {
  switch (b.remote) {
    case 'none':
      return [{ text: t.chip.neverPushed(b.ahead), color: 'warning' }]
    case 'deleted':
      return [{ text: t.chip.remoteDeleted, color: 'subtle' }]
    case 'ok':
      return b.unpushed > 0 ? [{ text: t.chip.unpushed(b.unpushed), color: 'warning' }] : [{ text: t.chip.pushedNoPr, color: 'subtle' }]
  }
}

export function branchActions(a: TreeState, b: LocalBranch): BranchAction[] {
  if (b.remote === 'deleted') return []
  const actions: BranchAction[] = []
  if (b.remote === 'none' || b.unpushed > 0) actions.push('push')
  if (b.name !== a.base) actions.push('open-pr')
  return actions
}

export function branchPrompt(a: TreeState, b: LocalBranch, t: Texts, ghConfigDir: string | undefined): string {
  // Stacked on a PR: its own PR goes on top of that PR's branch.
  const under = b.stackedOn === undefined ? undefined : a.prs.find(p => p.number === b.stackedOn)
  const instruction = t.prompt.openPr({ branch: b.name, repo: a.slug ?? a.name, base: under?.branch ?? a.base, path: b.path, ...(under ? { stackedOn: under.number } : {}) })
  return withAccount(instruction, ghCommand(ghConfigDir), t)
}

/** What the tidy-up agent receives: what to remove, and what never to touch. `ghConfigDir`: the repo's gh account, if not the default one. */
export function tidyPrompt(a: TreeState, t: Texts, ghConfigDir: string | undefined): string {
  const repo = a.slug ?? a.name
  return t.prompt.tidy({ repo, root: a.root, base: a.base, gh: ghCommand(ghConfigDir) })
}

/** The gh command an agent types for a repo: with its gh account's folder when it is not the active account. */
function ghCommand(ghConfigDir: string | undefined): string {
  if (ghConfigDir === undefined) return 'gh'
  const dir = /^[\w./~-]+$/.test(ghConfigDir) ? ghConfigDir : `'${ghConfigDir.replaceAll("'", `'\\''`)}'`
  return `GH_CONFIG_DIR=${dir} gh`
}

/** The active gh account cannot see every repo: the agent is told which command to use for this one. */
const withAccount = (instruction: string, gh: string, t: Texts) => (gh === 'gh' ? instruction : instruction + t.prompt.ghAccount(gh))

/** A merged PR: merged into its base, then where its deploy and cleanup stand. */
export function trackedChips(s: Tracked, t: Texts): Chip[] {
  const merged: Chip = { text: t.chip.mergedInto(s.base), color: 'merged' }
  const how: Chip[] = s.note ? [{ text: s.note, color: 'subtle' }] : []
  const deployed: Chip = { text: t.chip.deployed, color: 'success' }
  // A session runs the deploy itself: say where, and offer nothing.
  if (s.handled && (s.stage === 'merged' || s.stage === 'deploying' || s.stage === 'deploy-doubt' || s.stage === 'failed')) {
    return [merged, ...how, { text: t.chip.deployingInSession[s.handled], color: 'warning' }]
  }
  switch (s.stage) {
    case 'open':
      return []
    case 'merged':
    case 'deploying':
      return [merged, ...how, { text: t.chip.deploying, color: 'warning' }]
    case 'deploy-doubt':
      return [merged, ...how, { text: t.chip.deployToConfirm(s.reason ?? '?'), color: 'warning' }]
    case 'failed':
      return [merged, ...how, { text: t.chip.deployFailed, color: 'error' }]
    case 'deployed':
      return [merged, ...how, deployed, { text: t.chip.cleaningUp, color: 'subtle' }]
    case 'cleanup-doubt':
      return [merged, ...how, deployed, { text: t.chip.cleanupOnHold(s.reason ?? '?'), color: 'warning' }]
    case 'cleaned':
      return [merged, ...how, deployed, { text: t.chip.cleaned, color: 'success' }]
  }
}

/** The check drawn when a PR is cleaned: it fills up, then ticks. */
export const CHECK_FRAMES = ['◌', '◔', '◑', '◕', '●', '✓'] as const

/** One repo inside a session group, with only the cards of that group. */
export type RepoInGroup = { tree: TreeState; prs: PrSummary[]; branches: LocalBranch[]; merged: Tracked[] }
/** `sessions`: the other sessions of the group, with the desktop id that opens each. */
export type SessionGroup = { key: string; title: string; repos: RepoInGroup[]; sessions: { label: string; desktopId?: string }[] }

const ownerKey = (owner: Owner) => (owner.kind === 'others' ? `others:${owner.labels.join(', ')}` : owner.kind)

/**
 * The pane's tree: session groups (this one, then the others, then unknown), their repos, then the cards.
 * This session lists every repo it touched, even without a card; the other groups only the repos they have cards in.
 */
export function layout(trees: readonly TreeState[], events: readonly Tracked[], t: Texts): SessionGroup[] {
  const groups = new Map<string, { rank: number; group: SessionGroup }>()
  const groupOf = (owner: Owner) => {
    const key = ownerKey(owner)
    const found = groups.get(key)
    if (found) return found.group
    const title = owner.kind === 'here' ? t.owner.here : owner.kind === 'others' ? t.owner.others(owner.labels) : t.owner.unknown
    const group: SessionGroup = { key, title, repos: [], sessions: owner.kind === 'others' ? (owner.sessions ?? []) : [] }
    groups.set(key, { rank: owner.kind === 'here' ? 0 : owner.kind === 'others' ? 1 : 2, group })
    return group
  }
  const repoIn = (group: SessionGroup, tree: TreeState) => {
    const found = group.repos.find(r => r.tree.root === tree.root)
    if (found) return found
    const repo: RepoInGroup = { tree, prs: [], branches: [], merged: [] }
    group.repos.push(repo)
    return repo
  }
  const here = groupOf({ kind: 'here' })
  for (const tree of trees) repoIn(here, tree)
  for (const tree of trees) {
    for (const p of tree.prs) repoIn(groupOf(p.owner ?? { kind: 'unknown' }), tree).prs.push(p)
    for (const b of tree.branches) repoIn(groupOf(b.owner ?? { kind: 'unknown' }), tree).branches.push(b)
    for (const s of events.filter(e => e.root === tree.root)) repoIn(groupOf(s.owner ?? { kind: 'here' }), tree).merged.push(s)
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank).map(g => g.group)
}

/** A repo line outside this session's group: just how many cards it has there. */
export function repoCounts(prs: readonly PrSummary[], branches: readonly LocalBranch[], t: Texts): string {
  const parts: string[] = []
  if (prs.length > 0) parts.push(t.header.prs(prs.length))
  if (branches.length > 0) parts.push(t.header.branches(branches.length))
  return parts.join(' · ')
}

export type StepState = 'done' | 'now' | 'bad' | 'todo'
export type Step = { label: string; state: StepState }

const steps = (t: Texts, states: [StepState, StepState, StepState, StepState, StepState]): Step[] =>
  [t.step.review, t.step.ci, t.step.merge, t.step.deploy, t.step.clean].map((label, i) => ({ label, state: states[i] ?? 'todo' }))

/** Where an open PR stands: review, CI, then the merge it waits for. */
export function prProgress(p: PrSummary, t: Texts): Step[] {
  const review: StepState = p.review === 'changes' ? 'bad' : p.review === 'pending' ? 'now' : 'done'
  const ci: StepState = p.ci === 'failing' ? 'bad' : p.ci === 'pending' ? 'now' : 'done'
  const merge: StepState = prActions(p).includes('merge') ? 'now' : 'todo'
  return steps(t, [review, ci, merge, 'todo', 'todo'])
}

/** Where a merged PR stands: its deploy, then its cleanup. */
export function trackedProgress(s: Tracked, t: Texts): Step[] {
  const deploy: StepState = s.stage === 'failed' ? 'bad' : s.stage === 'deployed' || s.stage === 'cleanup-doubt' || s.stage === 'cleaned' ? 'done' : 'now'
  const clean: StepState = s.stage === 'cleaned' ? 'done' : deploy === 'done' ? 'now' : 'todo'
  return steps(t, ['done', 'done', 'done', deploy, clean])
}

const STALE_MS = 7 * 86_400_000

/** « opened 3 d ago · updated 2 h ago · +120 −30 · 8 files », and stale after 7 days without activity. */
export function prFacts(p: PrSummary, now: number, t: Texts): { text: string; stale: boolean } {
  const parts: string[] = []
  if (p.createdAt !== undefined) parts.push(t.facts.opened(t.facts.ago(now - p.createdAt)))
  if (p.updatedAt !== undefined) parts.push(t.facts.updated(t.facts.ago(now - p.updatedAt)))
  if (p.additions !== undefined) parts.push(t.facts.size(p.additions, p.deletions ?? 0, p.files ?? 0))
  return { text: parts.join(' · '), stale: p.updatedAt !== undefined && now - p.updatedAt > STALE_MS }
}

/** A PR to review: its repo, its author, its last activity, and whether it is a draft. */
export function reviewFacts(r: ReviewRequest, now: number, t: Texts): string {
  const parts = [r.slug, t.review.by(r.author)]
  if (r.updatedAt !== undefined) parts.push(t.facts.updated(t.facts.ago(now - r.updatedAt)))
  if (r.draft) parts.push(t.chip.draft)
  return parts.join(' · ')
}

/** The pane's first line: open PRs, merged PRs waiting for their deploy, work waiting to be pushed. */
/** `toRelease`: merged PRs waiting for a release, in the release repos of the config. */
export function summaryLine(trees: readonly TreeState[], events: readonly Tracked[], t: Texts, toRelease = 0): string {
  const prs = trees.reduce((n, a) => n + a.prs.length, 0)
  const toDeploy = events.filter(s => s.stage === 'merged' || s.stage === 'deploying' || s.stage === 'deploy-doubt' || s.stage === 'failed').length
  const toPush =
    trees.reduce((n, a) => n + a.prs.filter(p => p.unpushed > 0).length + a.branches.filter(b => b.remote === 'none' || b.unpushed > 0).length, 0)
  const parts = [prs > 0 ? t.summary.prs(prs) : '', toDeploy > 0 ? t.summary.toDeploy(toDeploy) : '', toPush > 0 ? t.summary.toPush(toPush) : '', toRelease > 0 ? t.summary.toRelease(toRelease) : ''].filter(Boolean)
  return parts.length > 0 ? parts.join(' · ') : t.summary.nothing
}

export function eventLine(s: Tracked, t: Texts): { text: string; buttons: ('deploy' | 'clean' | 'forget')[] } {
  const head = `#${s.number} ${short(s.slug)}`
  // A session deploys it: no Deploy button, nothing to clean yet.
  if (s.handled && s.stage === 'deploy-doubt') return { text: t.event.deployDoubt(head, s.reason ?? '?'), buttons: [] }
  if (s.handled && s.stage === 'failed') return { text: t.event.failed(head, s.link ?? s.reason ?? '?'), buttons: ['forget'] }
  switch (s.stage) {
    case 'merged':
    case 'deploying':
      return { text: t.event.deploying(head), buttons: [] }
    case 'deploy-doubt':
      return { text: t.event.deployDoubt(head, s.reason ?? '?'), buttons: ['deploy', 'clean'] }
    case 'failed':
      return { text: t.event.failed(head, s.link ?? s.reason ?? '?'), buttons: ['deploy', 'forget'] }
    case 'deployed':
      return { text: t.event.deployed(head), buttons: [] }
    case 'cleanup-doubt':
      return { text: t.event.cleanupDoubt(head, s.reason ?? '?'), buttons: ['clean'] }
    case 'cleaned':
      return { text: t.event.cleaned(head), buttons: [] }
    case 'open':
      return { text: t.event.open(head), buttons: [] }
  }
}
