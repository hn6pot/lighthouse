// A tick: look at the session's repos, move their PRs forward, publish what we see.
import { checkCleanup } from './cleanup/checks'
import { remove } from './cleanup/remove'
import { deployManual } from './deploy/manual'
import { deployPlan } from './deploy/rules'
import { delayVerdict, workflowVerdict, type Verdict } from './deploy/tracking'
import { afterPoll, forget, isFinished, keyOf, loadTracked, moveTo, openTracked, reread, save } from './flow/state'
import { inferPlan, repoFacts } from './deploy/infer'
import { loadConfig, type Config } from './config'
import { cached } from './github/cache'
import { prFacts, reviewFacts } from './ui/lines'
import { ownerOf } from './sessions/owner'
import { desktopIndex, type DesktopSession } from './sessions/desktop'
import { liveSessions } from './sessions/registry'
import { commitRuns, myLogin, myOpenPrs, prDetail, summarizePr } from './github/prs'
import { reviewRequests } from './github/reviews'
import { collectReleases } from './release/collect'
import { docsOf, refreshDocs, type DocsContext } from './docs/refresh'
import type { Host } from './host'
import type { Texts } from './i18n'
import type { Owner, PrSummary, ReleaseRepo, Repo, ReviewRequest, TreeState, Tracked } from './model'
import { baseBranch, localBranches, originSlug, refresh, roots, treeState, isAncestor, lastRelease } from './repos/git'
import { acquireLock, releaseLock } from './sessions/lock'
import { sessionAlive } from './sessions/registry'

export type Context = {
  id: string
  cwd: string
  repos: Map<string, Repo>
  lastFetch: Map<string, number>
  /** My gh login, per account (gh config folder), for the session. */
  logins: Map<string, string>
  t: Texts
  /** How old a shared gh answer may be for this tick (0: ask and share); absent asks GitHub, no cache. */
  ghMaxAge?: number
  /** The Desktop's sessions (titles, links), reread at most every minute. */
  desktop?: { at: number; index: Map<string, DesktopSession> }
  /** Merged PRs seen as this session's: they stay so once their branch is cleaned up. */
  ownedHere?: Set<string>
  /** When this session last checked each cleanup doubt again on its own. */
  cleanupChecks?: Map<string, number>
  /** The person's config file (deploy rules, gh accounts), reread at most every minute. */
  config: Config
  configAt?: number
  /** How old the shared list of PRs to review may be for this tick (0: ask GitHub); absent asks GitHub, no cache. */
  reviewsMaxAge?: number
  /** The last list of PRs to review gh gave: kept while gh fails. */
  reviews?: ReviewRequest[]
  /** The branches' specs and plans; absent, they are not shown. */
  docs?: DocsContext
}
export type Actions = {
  notify: (key: string, text: string) => Promise<void>
  publish: (trees: TreeState[], events: Tracked[], reviews: ReviewRequest[], releases: ReleaseRepo[]) => Promise<void>
}

const FETCH_MS = 10 * 60_000
/** A cleaned PR reaches the pane this long, for its check to be drawn, then never again. */
const CLEANED_VISIBLE_MS = 60_000
/** A session that ran a deploy command handles the deploy this long after its last one. */
export const HANDLED_MS = 30 * 60_000
const DESKTOP_MS = 60_000
const CONFIG_MS = 60_000
/** A cleanup doubt is checked again this long after its last change or check: its cause may be gone (tree removed, session closed). */
export const CLEANUP_RETRY_MS = 5 * 60_000
const handledNow = (s: Tracked, now: number) => s.handledBy !== undefined && now - (s.handledAt ?? 0) < HANDLED_MS
const nameOf = (root: string) => root.split('/').filter(Boolean).pop() ?? root

/** Rereads the config file if the last read is a minute old or more. */
export async function refreshConfig(host: Host, ctx: Context): Promise<void> {
  const now = await host.now()
  if (ctx.configAt !== undefined && now - ctx.configAt < CONFIG_MS) return
  ctx.config = await loadConfig(host)
  ctx.configAt = now
}

export async function addFolder(host: Host, ctx: Context, folder: string): Promise<void> {
  const found = await roots(host, folder)
  if (found === null) return
  const repo = ctx.repos.get(found.root) ?? { root: found.root, slug: await originSlug(host, found.root), trees: [] }
  if (!repo.trees.includes(found.tree)) repo.trees.push(found.tree)
  ctx.repos.set(found.root, repo)
}

export async function addPrLink(host: Host, ctx: Context, slug: string, number: number): Promise<void> {
  const repo = [...ctx.repos.values()].find(d => d.slug === slug)
  if (!repo) return
  const existing = (await loadTracked(host.store)).find(s => s.key === keyOf(slug, number))
  if (existing) return
  let pr
  try {
    pr = await prDetail(host, ctx.config.ghConfigDirs, slug, number)
    if (pr.state !== 'OPEN') return // a PR already merged or closed does not restart its deploy
    // A colleague's PR must never lead to a deploy from this machine.
    if (pr.author?.login !== (await myLogin(host, ctx.config.ghConfigDirs, slug, ctx.logins))) return
  } catch {
    return // gh unavailable: the link is looked at again if pasted again
  }
  await save(host.store, openTracked(slug, repo.root, pr, await host.now()))
}

async function inspectRepo(host: Host, ctx: Context, repo: Repo, now: number): Promise<TreeState> {
  const base = await baseBranch(host, repo.root)
  if (now - (ctx.lastFetch.get(repo.root) ?? -Infinity) >= FETCH_MS) {
    await refresh(host, repo.root, base)
    ctx.lastFetch.set(repo.root, now)
  }
  const tree = repo.trees.find(a => ctx.cwd === a || ctx.cwd.startsWith(a + '/')) ?? repo.trees[0] ?? repo.root
  const state = await treeState(host, tree, base, ctx.t)
  const locals = await localBranches(host, repo.root, base)
  const summary: TreeState = { root: repo.root, name: nameOf(repo.root), slug: repo.slug, base, ...state, prs: [], branches: locals }
  const release = await lastRelease(host, repo.root, base)
  if (release) summary.release = release
  if (repo.slug === null) return summary

  try {
    const slug = repo.slug
    const open = await cached(host, `open:${slug}`, ctx.ghMaxAge, () => myOpenPrs(host, ctx.config.ghConfigDirs, slug))
    // A PR's local branch: same name, or tracking the PR's branch, or at the PR's head (pushed under another name).
    const localOf = (pr: (typeof open)[number]) =>
      locals.find(b => b.name === pr.headRefName) ??
      locals.find(b => b.upstream === `origin/${pr.headRefName}`) ??
      locals.find(b => b.tip === pr.headRefOid)
    const linked = new Set<string>()
    summary.prs = open.map(pr => {
      const local = localOf(pr)
      if (local) linked.add(local.name)
      const unpushed = !local ? 0 : local.name === pr.headRefName ? local.unpushed : local.upstream === `origin/${pr.headRefName}` ? (local.aheadOfUpstream ?? 0) : 0
      return { ...summarizePr(pr), path: local?.path ?? null, unpushed, ...(local ? { localBranch: local.name } : {}) }
    })
    summary.branches = locals.filter(b => !linked.has(b.name) && !open.some(pr => pr.headRefName === b.name))
    // A branch started from an open PR (it contains its head) belongs with that PR.
    for (const b of summary.branches) {
      for (const p of summary.prs) {
        if (p.head && (await isAncestor(host, repo.root, p.head, b.name))) {
          b.stackedOn = p.number
          break
        }
      }
    }
    const known = new Set((await loadTracked(host.store)).map(s => s.key))
    for (const pr of open) {
      if (!known.has(keyOf(slug, pr.number))) await save(host.store, openTracked(slug, repo.root, pr, now))
    }
  } catch {
    // gh unavailable: keep the git state, try again next tick
  }
  return summary
}

async function deploy(
  host: Host,
  s: Tracked,
  now: number,
  mark: (command: string) => Promise<void>,
  t: Texts,
  config: Config,
): Promise<Verdict & { command?: string; note?: string }> {
  const dirs = config.ghConfigDirs
  const pr = await prDetail(host, dirs, s.slug, s.number)
  // Without a rule, the repo's own files say how it deploys; the card shows what was understood.
  const inferred = config.rules[s.slug] ? null : inferPlan(await repoFacts(host, s.root), t)
  const plan = inferred?.plan ?? deployPlan(config.rules, s.slug, pr.files.map(f => f.path), t)
  const note = inferred?.note
  const withNote = <V extends object>(v: V) => (note ? { ...v, note } : v)
  const since = now - (s.mergedAt ?? now)
  switch (plan.kind) {
    case 'immediate':
      return withNote({ state: 'ok' as const })
    case 'release':
      // Nothing to deploy now: the PR waits for the next release, and its worktree is cleaned at once.
      return { state: 'ok' as const, note: t.chip.waitingRelease }
    case 'delay':
      return delayVerdict(since, plan.ms)
    case 'workflow':
      return withNote(workflowVerdict(s.mergeCommit ? await commitRuns(host, dirs, s.slug, s.mergeCommit) : [], plan.workflow, since, t))
    case 'doubt':
      return withNote({ state: 'doubt' as const, reason: plan.reason, command: plan.command })
    case 'manual':
      return { ...(await deployManual(host, s, plan.command, () => mark(plan.command), t)), command: plan.command }
  }
}

// What this process is doing right now. The sessions' lock is reentrant for the same id
// (the tick and the Clean up button share theirs): these sets keep them from acting together.
/** Repos (slug) this process acts on. */
const busyRepos = new Set<string>()
/** PRs whose manual deploy, launched by this process, it is waiting on. */
const runningDeploys = new Set<string>()

type Claim<T> = { taken: true; value: T } | { taken: false; why: 'process' | 'lock' }

/** Acts on a repo under both locks: the process's, then the sessions'. */
async function withRepo<T>(host: Host, ctx: Context, slug: string, act: () => Promise<T>): Promise<Claim<T>> {
  if (busyRepos.has(slug)) return { taken: false, why: 'process' }
  busyRepos.add(slug) // before any await: nothing may slip between the test and the add
  try {
    if (!(await acquireLock(host, slug, ctx.id))) return { taken: false, why: 'lock' }
    try {
      return { taken: true, value: await act() }
    } finally {
      await releaseLock(host, slug, ctx.id)
    }
  } finally {
    busyRepos.delete(slug)
  }
}

/** Can the launcher of a manual deploy still report its outcome? */
async function launcherActive(host: Host, ctx: Context, s: Tracked): Promise<boolean> {
  if (s.launchedBy === undefined) return false
  if (s.launchedBy === ctx.id) return runningDeploys.has(s.key)
  return sessionAlive(host, s.launchedBy)
}

const canonical = (s: Tracked) =>
  JSON.stringify(Object.entries(s).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))

/** Writes only what changes (apart from `updatedAt`): an unchanged PR never overwrites another session's progress. */
async function saveIfChanged(host: Host, before: Tracked, after: Tracked): Promise<Tracked> {
  if (canonical({ ...after, updatedAt: before.updatedAt }) === canonical(before)) return before
  await save(host.store, after)
  return after
}

// Every write of a tracked PR beyond "open" happens here, under lock, on a reread version.
async function advance(host: Host, ctx: Context, actions: Actions, read: Tracked): Promise<Tracked | null> {
  const { t } = ctx
  const now = await host.now()
  let s = read

  if (s.stage === 'open') {
    const detail = await cached(host, `pr:${s.key}`, ctx.ghMaxAge, () => prDetail(host, ctx.config.ghConfigDirs, s.slug, s.number))
    const next = afterPoll(s, detail, now)
    if (next === null) return null
    if (next.stage === 'open') {
      // New PR head, written outside the lock: only if nobody moved the PR on meanwhile.
      if (canonical({ ...next, updatedAt: read.updatedAt }) === canonical(read)) return read
      const current = await reread(host.store, read.key)
      return current === null || current.stage !== 'open' ? current : saveIfChanged(host, current, { ...current, prHead: next.prHead, updatedAt: now })
    }
    await host.store.delete(`gh:open:${s.slug}`) // the shared open list is stale now
    s = next // merged: saved under lock, below
  }

  const lastCheck = Math.max(s.updatedAt, ctx.cleanupChecks?.get(s.key) ?? -Infinity)
  const recheck = s.stage === 'cleanup-doubt' && now - lastCheck >= CLEANUP_RETRY_MS
  if (s.stage !== 'merged' && s.stage !== 'deploying' && s.stage !== 'deployed' && !recheck) return s
  // Deploy launched whose launcher can still report the outcome: wait, take nothing.
  if (s.stage === 'deploying' && (await launcherActive(host, ctx, s))) return s

  const claim = await withRepo(host, ctx, s.slug, async (): Promise<Tracked | null> => {
    // Reread under lock: another session may have moved the PR on since our read.
    const current = await reread(host.store, s.key)
    if (current === null || current.stage !== read.stage) return current
    if (read.stage === 'open') await save(host.store, s)
    else s = current

    if (s.stage === 'deploying' && s.launchedBy !== undefined) {
      // Never an automatic relaunch: either the launcher is still there, or the outcome is unknown.
      if (await launcherActive(host, ctx, s)) return s
      s = moveTo(s, 'deploy-doubt', now, { reason: t.reason.launcherGone })
      await save(host.store, s)
      await actions.notify(`${s.key}:deploy-doubt`, t.notification.deployDoubt(s.number, s.slug, t.reason.launcherGone))
      return s
    }

    if (s.stage === 'merged' || s.stage === 'deploying') {
      // The "launched by" marker is saved before the launch: a launched deploy must never be relaunched.
      const mark = async (command: string) => {
        runningDeploys.add(s.key)
        s = moveTo(s, 'deploying', now, { command, launchedBy: ctx.id, launchedAt: now })
        await save(host.store, s)
      }
      let v: Verdict & { command?: string; note?: string }
      try {
        v = await deploy(host, s, now, mark, t, ctx.config)
      } finally {
        runningDeploys.delete(s.key)
      }
      const extra = { link: v.link, reason: v.reason, command: v.command ?? s.command, note: v.note ?? s.note }
      if (v.state === 'running') return saveIfChanged(host, s, moveTo(s, 'deploying', now, extra))
      if (v.state === 'doubt') {
        s = moveTo(s, 'deploy-doubt', now, extra)
        await save(host.store, s)
        // A session deploying it by hand needs no notification: it is already on it.
        if (!handledNow(s, now)) await actions.notify(`${s.key}:deploy-doubt`, t.notification.deployDoubt(s.number, s.slug, v.reason))
        return s
      }
      if (v.state === 'failed') {
        s = moveTo(s, 'failed', now, extra)
        await save(host.store, s)
        await actions.notify(`${s.key}:failed`, t.notification.deployFailed(s.number, s.slug))
        return s
      }
      s = moveTo(s, 'deployed', now, extra)
      await save(host.store, s)
    }

    if (s.stage === 'deployed' || s.stage === 'cleanup-doubt') {
      // A doubt stays one without notification; only a new reason is written.
      if (s.stage === 'cleanup-doubt') (ctx.cleanupChecks ?? (ctx.cleanupChecks = new Map())).set(s.key, now)
      const verdict = await checkCleanup(host, s, { id: ctx.id, cwd: ctx.cwd }, t)
      if (!verdict.ok) return saveIfChanged(host, s, moveTo(s, 'cleanup-doubt', now, { reason: verdict.reason }))
      const done = await remove(host, s, verdict.tree)
      const next = done.ok ? moveTo(s, 'cleaned', now) : moveTo(s, 'cleanup-doubt', now, { reason: done.reason })
      return saveIfChanged(host, s, next)
    }
    return s
  })
  // Repo busy (by this process or another session): nothing was done or written.
  return claim.taken ? claim.value : read
}

export async function tick(host: Host, ctx: Context, actions: Actions): Promise<void> {
  const now = await host.now()
  const trees: TreeState[] = []
  for (const repo of ctx.repos.values()) {
    try {
      trees.push(await inspectRepo(host, ctx, repo, now))
    } catch {
      // one unreadable repo does not block the others
    }
  }

  const trackedRoots = new Set(ctx.repos.keys())
  for (const s of await loadTracked(host.store)) {
    if (!trackedRoots.has(s.root) || isFinished(s)) continue
    try {
      // `advance` saves what changes itself; an unchanged PR is never rewritten.
      if ((await advance(host, ctx, actions, s)) === null) await forget(host.store, s.key)
    } catch {
      // gh or git unavailable for this PR: try again next tick
    }
  }

  const visible = (s: Tracked) => s.stage !== 'open' && !(s.stage === 'cleaned' && now - s.updatedAt >= CLEANED_VISIBLE_MS)
  const all = await loadTracked(host.store)
  const events = all.filter(s => trackedRoots.has(s.root) && visible(s))
  // Right after a merge, GitHub or the shared cache may still list the PR as open: the tracking wins.
  // Its local branch, still there until the cleanup, is not "a branch without PR" either: the merged card stands for both.
  const pastOpen = all.filter(s => s.stage !== 'open')
  const merged = new Set(pastOpen.map(s => s.key))
  const mergedBranches = new Set(pastOpen.map(s => `${s.root}@${s.branch}`))
  // Whose each PR and branch is: this session, other live sessions, or nobody known.
  const mine = { cwd: ctx.cwd, trees: [...ctx.repos.values()].flatMap(r => r.trees) }
  if (!ctx.desktop || now - ctx.desktop.at >= DESKTOP_MS) ctx.desktop = { at: now, index: await desktopIndex(host).catch(() => new Map()) }
  const index = ctx.desktop.index
  // The other sessions under their Desktop title, with the id that opens them.
  const others = (await liveSessions(host, ctx.id).catch(() => [])).map(s => {
    const d = index.get(s.id)
    return { ...s, ...(d?.title ? { label: d.title } : {}), ...(d ? { desktopId: d.desktopId } : {}) }
  })
  const shown = trees.map(tree => {
    const branches = tree.branches
      .filter(b => !mergedBranches.has(`${tree.root}@${b.name}`))
      .map(b => ({ ...b, owner: ownerOf(b.path, mine, others) }))
    // A PR without a worktree of its own belongs to the session working on a branch stacked on it.
    const ownerOfPr = (p: PrSummary): Owner => {
      const own = ownerOf(p.path, mine, others)
      if (own.kind !== 'unknown') return own
      return branches.find(b => b.stackedOn === p.number && b.owner.kind !== 'unknown')?.owner ?? own
    }
    const prs = tree.prs.filter(p => tree.slug === null || !merged.has(keyOf(tree.slug, p.number))).map(p => ({ ...p, owner: ownerOfPr(p), facts: prFacts(p, now, ctx.t) }))
    return { ...tree, prs, branches }
  })
  // A merged PR belongs where its local branch's worktree is; once the branch is gone, to this session.
  const ownedEvents = events.map(s => {
    const local = trees.find(tree => tree.root === s.root)?.branches.find(b => b.name === s.branch)
    const handled = handledNow(s, now) ? (s.handledBy === ctx.id ? ('here' as const) : ('other' as const)) : undefined
    // Without a local branch: this session's if it ever was here, launched or handled its deploy; else nobody known.
    const ownedHere = ctx.ownedHere ?? (ctx.ownedHere = new Set())
    const owner: Owner = local?.path
      ? ownerOf(local.path, mine, others)
      : ownedHere.has(s.key) || s.launchedBy === ctx.id || s.handledBy === ctx.id
        ? { kind: 'here' }
        : { kind: 'unknown' }
    if (owner.kind === 'here') ownedHere.add(s.key)
    return { ...s, owner, ...(handled ? { handled } : {}) }
  })
  // The PRs waiting for my review, in any repo: gh's search API is rate-limited, hence a longer shared cache.
  try {
    ctx.reviews = await cached(host, 'reviews', ctx.reviewsMaxAge, () => reviewRequests(host, ctx.config.ghConfigDirs))
  } catch {
    // gh unavailable: the last list stays
  }
  const reviews = (ctx.reviews ?? []).map(r => ({ ...r, facts: reviewFacts(r, now, ctx.t) }))
  // The repos released on demand, from the config: shown in every session, whatever it touches.
  const releases = await collectReleases(host, ctx, actions.notify)
  // Each branch's specs and plans, on its card; a failure leaves the cards without them.
  if (ctx.docs) await refreshDocs(host, ctx.docs, ctx.id, trees, all, now).catch(() => undefined)
  const withDocs = <T extends object>(x: T, root: string, branch: string | undefined): T => {
    const docs = docsOf(ctx.docs, root, branch)
    return docs.length > 0 ? { ...x, docs } : x
  }
  const documented = shown.map(tree => ({
    ...tree,
    prs: tree.prs.map(p => withDocs(p, tree.root, p.localBranch)),
    branches: tree.branches.map(b => withDocs(b, tree.root, b.name)),
  }))
  await actions.publish(documented, ownedEvents.map(s => withDocs(s, s.root, s.branch)), reviews, releases)
}

export async function cleanNow(host: Host, ctx: Context, key: string): Promise<string> {
  const { t } = ctx
  const s = (await loadTracked(host.store)).find(x => x.key === key)
  if (!s) return t.toast.unknownPr
  const cleanable = (stage: Tracked['stage']) => stage === 'deploy-doubt' || stage === 'cleanup-doubt' || stage === 'deployed'
  if (!cleanable(s.stage)) return t.toast.cleanWrongStage(s.stage)
  const claim = await withRepo(host, ctx, s.slug, async () => {
    const current = await reread(host.store, key)
    if (current === null) return t.toast.unknownPr
    if (current.stage !== s.stage) return t.toast.cleanWrongStage(current.stage)
    const verdict = await checkCleanup(host, { ...current, stage: 'cleanup-doubt' }, { id: ctx.id, cwd: ctx.cwd }, t)
    if (!verdict.ok) return t.toast.cleanRefused(verdict.reason)
    const done = await remove(host, current, verdict.tree)
    if (!done.ok) return t.toast.cleanRefused(done.reason)
    await save(host.store, moveTo(current, 'cleaned', await host.now()))
    return t.toast.cleaned(current.branch)
  })
  if (claim.taken) return claim.value
  return claim.why === 'process' ? t.toast.cleanBusyHere : t.toast.cleanBusyElsewhere
}

/** "Forget" button of a failed PR: stop tracking it. Refused if it moved on meanwhile. */
export async function forgetNow(host: Host, key: string, t: Texts): Promise<{ done: boolean; message: string }> {
  const s = (await loadTracked(host.store)).find(x => x.key === key)
  if (!s) return { done: false, message: t.toast.unknownPr }
  if (s.stage !== 'failed') return { done: false, message: t.toast.forgetWrongStage(s.stage) }
  await forget(host.store, key)
  return { done: true, message: t.toast.forgotten(s.number) }
}
