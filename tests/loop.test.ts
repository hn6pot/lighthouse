import { expect, test } from 'claude-code/testing'
import { loadTracked, save } from '../hooks/flow/state'
import { texts } from '../hooks/i18n'
import { addFolder, addPrLink, CLEANUP_RETRY_MS, cleanNow, forgetNow, refreshConfig, tick, type Context } from '../hooks/loop'
import type { ReleaseRepo, ReviewRequest, TreeState, Tracked } from '../hooks/model'
import { fakeHost, type Answer } from './helpers/fake-host'

const t = texts('fr')
// The person's config: how acme/web deploys, and the gh account of the acme repos.
const CONFIG: Context['config'] = {
  rules: {
    'acme/web': {
      kind: 'manual',
      commands: [
        { only_under: 'ec2/', command: 'make deploy' },
        { only_under: 'mac/', command: 'make install' },
      ],
    },
  },
  ghConfigDirs: { acme: '~/.config/gh-acme' },
}
const ctx = (): Context => ({ id: 'me', cwd: '/w', repos: new Map(), lastFetch: new Map(), logins: new Map(), t, config: CONFIG })

function actions() {
  const notifications: string[] = []
  const published: { trees: TreeState[]; events: Tracked[]; reviews: ReviewRequest[]; releases: ReleaseRepo[] }[] = []
  return {
    notifications, published,
    actions: {
      notify: async (_key: string, text: string) => void notifications.push(text),
      publish: async (trees: TreeState[], events: Tracked[], reviews: ReviewRequest[], releases: ReleaseRepo[]) =>
        void published.push({ trees, events, reviews, releases }),
    },
  }
}

const GIT_BASE: [RegExp, Answer][] = [
  [/rev-parse --show-toplevel/, { stdout: '/w/web\n' }],
  [/--git-common-dir/, { stdout: '/w/web/.git\n' }],
  [/remote get-url origin/, { stdout: 'https://github.com/acme/web.git\n' }],
  [/symbolic-ref/, { stdout: 'origin/main\n' }],
  [/fetch/, {}],
  [/branch --show-current/, { stdout: 'main\n' }],
  [/rev-list --count/, { stdout: '0\n' }],
  [/status --porcelain/, { stdout: '' }],
  [/^mkdir/, {}],
  [/^ls -1/, { stdout: '' }],
]

const PR_OPEN = { number: 4, title: 't', state: 'OPEN', headRefName: 'feat/x', headRefOid: 'tip', baseRefName: 'main', mergeCommit: null, mergedAt: null, reviewDecision: null, statusCheckRollup: [] }

test('a touched folder becomes a tracked repo, its open PRs tracked PRs', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: JSON.stringify([PR_OPEN]) }], [/^gh pr view 4/, { stdout: JSON.stringify({ ...PR_OPEN, files: [] }) }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web/ec2')
  const a = actions()
  await tick(h.host, c, a.actions)
  expect([...c.repos.keys()]).toEqual(['/w/web'])
  expect(a.published[0].trees[0]).toMatchObject({ name: 'web', branch: 'main', prs: [{ number: 4 }] })
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ key: 'acme/web#4', stage: 'open' })
})

test('PR merged on web, ec2 only, nothing in doubt: deploys then cleans up', async () => {
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a.py' }] }
  const h = fakeHost([
    ...GIT_BASE,
    [/^gh pr list/, { stdout: '[]' }],
    [/^gh pr view 4/, { stdout: JSON.stringify(merged) }],
    [/pull --ff-only/, {}],
    [/worktree list --porcelain/, { stdout: 'worktree /w/web\nHEAD a\nbranch refs/heads/main\n\nworktree /w/web/.worktrees/x\nHEAD tip\nbranch refs/heads/feat/x\n' }],
    [/status --short/, { stdout: '' }],
    [/rev-parse HEAD/, { stdout: 'tip\n' }],
    [/^test -d/, {}],
    [/worktree remove/, {}],
    [/branch -D/, {}],
    [/^rm -rf/, {}],
  ])
  h.state.launchReturns = { code: 0, output: 'ok' }
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'open', updatedAt: 0, prHead: 'tip' })
  const a = actions()
  await tick(h.host, c, a.actions) // open → merged → (manual deploy) deployed → cleaned
  expect(h.launched.map(l => l.line)).toEqual(['/bin/zsh -lc make deploy'])
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'cleaned' })
  expect(h.calls.some(x => x.line === 'git -C /w/web worktree remove /w/web/.worktrees/x')).toBe(true)
  expect(a.notifications).toEqual([])
})

test('manual repo in doubt: notification and deploy-doubt stage, nothing launched', async () => {
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a' }, { path: 'mac/b' }] }
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: '[]' }], [/^gh pr view 4/, { stdout: JSON.stringify(merged) }], [/^rm -rf/, {}]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'open', updatedAt: 0 })
  const a = actions()
  await tick(h.host, c, a.actions)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'deploy-doubt' })
  expect(a.notifications[0]).toContain('#4')
  expect(h.launched).toEqual([])
})

test('manual deploy failed: failed stage, notification, no cleanup', async () => {
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a' }] }
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: '[]' }], [/^gh pr view 4/, { stdout: JSON.stringify(merged) }], [/pull --ff-only/, {}], [/^rm -rf/, {}]])
  h.state.launchReturns = { code: 1, output: 'boom' }
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'open', updatedAt: 0 })
  const a = actions()
  await tick(h.host, c, a.actions)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'failed' })
  expect(a.notifications[0]).toContain('échec')
})

test('gh failing on a repo: the tick publishes anyway', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh/, { exitCode: 1, stderr: 'HTTP 401' }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  const before: Tracked = { key: 'acme/web#9', slug: 'acme/web', root: '/w/web', number: 9, branch: 'feat/y', base: 'main', stage: 'open', updatedAt: 0 }
  await save(h.host.store, before)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(await loadTracked(h.host.store)).toEqual([before])
  expect(a.published).toHaveLength(1)
  expect(a.published[0].trees[0].name).toBe('web')
})

test('local repo without a GitHub origin: shown, never queried', async () => {
  const h = fakeHost([...GIT_BASE.filter(([m]) => !String(m).includes('remote')), [/remote get-url origin/, { exitCode: 2 }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  const a = actions()
  await tick(h.host, c, a.actions)
  // Only the search for the PRs to review, which is about no repo.
  expect(h.calls.some(x => x.line.startsWith('gh ') && !x.line.startsWith('gh search prs'))).toBe(false)
  expect(a.published[0].trees).toHaveLength(1)
})

const MERGED_EC2 = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a.py' }] }
const TRACKED_4: Tracked = { key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'open', updatedAt: 0, prHead: 'tip' }
const TREE_X = 'worktree /w/web\nHEAD a\nbranch refs/heads/main\n\nworktree /w/web/.worktrees/x\nHEAD tip\nbranch refs/heads/feat/x\n'

test('deploy done then cleanup crashes: deployed saved, nothing relaunched at the next tick', async () => {
  const h = fakeHost([
    ...GIT_BASE,
    [/^gh pr list/, { stdout: '[]' }],
    [/^gh pr view 4/, { stdout: JSON.stringify(MERGED_EC2) }],
    [/pull --ff-only/, {}],
    [/worktree list/, () => { throw new Error('git crashed') }],
    [/^rm -rf/, {}],
  ])
  h.state.launchReturns = { code: 0, output: 'ok' }
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, TRACKED_4)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'deployed' })
  await tick(h.host, c, a.actions)
  expect(h.launched).toHaveLength(1)
})

test('Clean up refused outside the doubt or deployed stages', async () => {
  const h = fakeHost([...GIT_BASE, [/worktree list/, { stdout: TREE_X }], [/^test -d/, {}], [/status --short/, {}], [/rev-parse HEAD/, { stdout: 'tip\n' }], [/^rm -rf/, {}]])
  const c = ctx()
  for (const stage of ['failed', 'open'] as const) {
    await save(h.host.store, { ...TRACKED_4, stage })
    expect(await cleanNow(h.host, c, TRACKED_4.key)).toBe(`Nettoyage impossible : étape ${stage}.`)
  }
  expect(h.calls.some(x => /worktree remove|branch -D/.test(x.line))).toBe(false)
})

test('Clean up on cleanup-doubt with a clean tree: removed and cleaned', async () => {
  const h = fakeHost([...GIT_BASE, [/worktree list/, { stdout: TREE_X }], [/^test -d/, {}], [/status --short/, {}], [/rev-parse HEAD/, { stdout: 'tip\n' }], [/worktree remove/, {}], [/branch -D/, {}], [/^rm -rf/, {}]])
  await save(h.host.store, { ...TRACKED_4, stage: 'cleanup-doubt' })
  expect(await cleanNow(h.host, ctx(), TRACKED_4.key)).toBe('feat/x nettoyée.')
  expect(h.calls.some(x => x.line === 'git -C /w/web worktree remove /w/web/.worktrees/x')).toBe(true)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'cleaned' })
})

test('link to a merged PR: nothing tracked', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh pr view 4/, { stdout: JSON.stringify(MERGED_EC2) }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await addPrLink(h.host, c, 'acme/web', 4)
  expect(await loadTracked(h.host.store)).toEqual([])
})

test('link to a colleague’s open PR: nothing tracked (never a deploy for them)', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh pr view 4/, { stdout: JSON.stringify({ ...PR_OPEN, files: [], author: { login: 'colleague' } }) }], [/^gh api user/, { stdout: 'octocat\n' }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await addPrLink(h.host, c, 'acme/web', 4)
  expect(await loadTracked(h.host.store)).toEqual([])
})

test('link to my open PR: tracked; my login is asked once, with the repo’s account', async () => {
  const h = fakeHost([
    ...GIT_BASE,
    [/^gh pr view (4|5)/, argv => ({ stdout: JSON.stringify({ ...PR_OPEN, number: Number(argv[3]), files: [], author: { login: 'octocat' } }) })],
    [/^gh api user --jq \.login/, { stdout: 'octocat\n' }],
  ])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await addPrLink(h.host, c, 'acme/web', 4)
  await addPrLink(h.host, c, 'acme/web', 5)
  expect((await loadTracked(h.host.store)).map(s => s.key).sort()).toEqual(['acme/web#4', 'acme/web#5'])
  const api = h.calls.filter(a => a.line.startsWith('gh api user'))
  expect(api).toHaveLength(1)
  expect(api[0].options?.env).toEqual({ GH_CONFIG_DIR: '/Users/me/.config/gh-acme' })
  expect(h.calls.find(a => a.line.startsWith('gh pr view 4'))?.line).toContain(',author')
})

test('cleaned: reaches the pane for one minute (its check), then never again', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: '[]' }]], {}, 0)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { ...TRACKED_4, stage: 'cleaned', updatedAt: 1_000 })
  const a = actions()
  h.state.now = 1_000 + 50_000
  await tick(h.host, c, a.actions)
  expect(a.published[0].events.map(s => s.key)).toEqual(['acme/web#4'])
  h.state.now = 1_000 + 60_000
  await tick(h.host, c, a.actions)
  expect(a.published[1].events).toEqual([])
})

test('failed: Forget removes the PR from the store and the band', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: '[]' }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { ...TRACKED_4, stage: 'failed', reason: 'boom' })
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(a.published[0].events.map(s => s.stage)).toEqual(['failed'])
  expect(await forgetNow(h.host, TRACKED_4.key, t)).toEqual({ done: true, message: '#4 oubliée.' })
  await tick(h.host, c, a.actions)
  expect(a.published[1].events).toEqual([])
  expect(await loadTracked(h.host.store)).toEqual([])
})

test('Forget refused outside failed (the PR may have moved on meanwhile)', async () => {
  const h = fakeHost([])
  await save(h.host.store, { ...TRACKED_4, stage: 'deployed' })
  expect(await forgetNow(h.host, TRACKED_4.key, t)).toEqual({ done: false, message: 'Oubli impossible : étape deployed.' })
  expect(await loadTracked(h.host.store)).toHaveLength(1)
})

// --- A manual deploy is never launched twice ---

const DEPLOYS_AND_CLEANS: [RegExp, Answer][] = [
  [/^gh pr list/, { stdout: '[]' }],
  [/^gh pr view 4/, { stdout: JSON.stringify(MERGED_EC2) }],
  [/pull --ff-only/, {}],
  [/worktree list --porcelain/, { stdout: TREE_X }],
  [/status --short/, { stdout: '' }],
  [/rev-parse HEAD/, { stdout: 'tip\n' }],
  [/^test -d/, {}],
  [/worktree remove/, {}],
  [/branch -D/, {}],
  [/^rm -rf/, {}],
]
const MERGED_4: Tracked = { ...TRACKED_4, stage: 'merged', mergeCommit: 'm', mergedAt: 0 }
const LOCK = /^mkdir \/Users\/me\/\.lighthouse\/locks\/acme__web$/
const OTHER_SESSION = '/Users/me/.lighthouse/sessions/other.json'

// A launch that only finishes when the test decides.
function suspendedLaunch(h: ReturnType<typeof fakeHost>) {
  let release: (r: { code: number | null; output: string }) => void = () => undefined
  let signal: () => void = () => undefined
  const started = new Promise<void>(r => (signal = r))
  h.host.launch = async (argv, { cwd }) => {
    h.launched.push({ line: argv.join(' '), cwd })
    signal()
    return new Promise(r => (release = r))
  }
  return { started, release: (code: number) => release({ code, output: '' }) }
}

const writesOf = (h: ReturnType<typeof fakeHost>) => {
  const keys: string[] = []
  const set = h.host.store.set
  h.host.store.set = async (key, value) => (keys.push(key), set(key, value))
  return keys
}

test('the "launched by" marker is saved before the launch', async () => {
  const h = fakeHost([...GIT_BASE, ...DEPLOYS_AND_CLEANS], {}, 7_000)
  let seenAtLaunch: Tracked | undefined
  h.host.launch = async () => {
    seenAtLaunch = (await loadTracked(h.host.store))[0]
    return { code: 0, output: '' }
  }
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, MERGED_4)
  await tick(h.host, c, actions().actions)
  expect(seenAtLaunch).toMatchObject({ stage: 'deploying', launchedBy: 'me', launchedAt: 7_000, command: 'make deploy' })
})

test('second tick during a deploy running in this process: no second launch', async () => {
  const h = fakeHost([...GIT_BASE, ...DEPLOYS_AND_CLEANS])
  const l = suspendedLaunch(h)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, MERGED_4)
  const a = actions()
  const first = tick(h.host, c, a.actions)
  await l.started
  await tick(h.host, c, a.actions)
  expect(h.launched).toHaveLength(1)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'deploying', launchedBy: 'me' })
  expect(a.notifications).toEqual([])
  l.release(0)
  await first
  expect(h.launched).toHaveLength(1)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'cleaned' })
})

test('launched by another session still alive: we wait, nothing is written', async () => {
  const h = fakeHost([...GIT_BASE, ...DEPLOYS_AND_CLEANS], { [OTHER_SESSION]: JSON.stringify({ cwd: '/w', trees: [], updatedAt: 9 * 60_000 }) }, 10 * 60_000)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  const launched: Tracked = { ...MERGED_4, stage: 'deploying', launchedBy: 'other', launchedAt: 9 * 60_000, command: 'make deploy' }
  await save(h.host.store, launched)
  const written = writesOf(h)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(h.launched).toEqual([])
  expect(a.notifications).toEqual([])
  expect(written).toEqual([])
  expect(await loadTracked(h.host.store)).toEqual([launched])
})

test('launcher gone (other session silent, or this process reloaded): doubt and notification, never a relaunch', async () => {
  const cases: [string, Record<string, string>][] = [
    ['other', {}], // session file deleted (session closed)
    ['other', { [OTHER_SESSION]: JSON.stringify({ cwd: '/w', trees: [], updatedAt: 4 * 60_000 }) }], // silent for 6 min
    ['me', {}], // launched by this session, but nothing running here any more (module reloaded)
  ]
  for (const [launcher, files] of cases) {
    const h = fakeHost([...GIT_BASE, ...DEPLOYS_AND_CLEANS], files, 10 * 60_000)
    const c = ctx()
    await addFolder(h.host, c, '/w/web')
    await save(h.host.store, { ...MERGED_4, stage: 'deploying', launchedBy: launcher, launchedAt: 0, command: 'make deploy' })
    const a = actions()
    await tick(h.host, c, a.actions)
    expect(h.launched).toEqual([])
    expect((await loadTracked(h.host.store))[0]).toMatchObject({
      stage: 'deploy-doubt',
      reason: 'déploiement lancé mais son issue est inconnue (lanceur disparu)',
    })
    expect(a.notifications).toHaveLength(1)
  }
})

test('tracked PR changed by another session between the read and the lock: nothing done or overwritten', async () => {
  const launchedBy: Tracked = { ...MERGED_4, stage: 'deploying', launchedBy: 'other', launchedAt: 0, command: 'make deploy' }
  const h = fakeHost([
    [LOCK, () => (h.store.set('tracked:acme/web#4', launchedBy), {})],
    ...GIT_BASE,
    ...DEPLOYS_AND_CLEANS,
  ])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, MERGED_4)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(h.launched).toEqual([])
  expect(await loadTracked(h.host.store)).toEqual([launchedBy])
})

test('an unchanged open PR is not rewritten', async () => {
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: JSON.stringify([PR_OPEN]) }], [/^gh pr view 4/, { stdout: JSON.stringify({ ...PR_OPEN, files: [] }) }]], {}, 60_000)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, TRACKED_4)
  const written = writesOf(h)
  await tick(h.host, c, actions().actions)
  expect(written).toEqual([])
})

test('Clean up button during a deploy of the same repo: refused', async () => {
  const h = fakeHost([...GIT_BASE, ...DEPLOYS_AND_CLEANS])
  const l = suspendedLaunch(h)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, MERGED_4)
  const first = tick(h.host, c, actions().actions)
  await l.started
  await save(h.host.store, { ...TRACKED_4, key: 'acme/web#3', number: 3, branch: 'feat/w', stage: 'cleanup-doubt' })
  expect(await cleanNow(h.host, c, 'acme/web#3')).toBe('Nettoyage impossible : une action est déjà en cours sur ce dépôt.')
  expect(h.calls.some(x => /worktree remove|branch -D/.test(x.line))).toBe(false)
  l.release(0)
  await first
})

test('Clean up button when another session holds the lock: refused', async () => {
  const h = fakeHost(
    [[LOCK, { exitCode: 1, stderr: 'File exists' }], ...GIT_BASE, ...DEPLOYS_AND_CLEANS],
    { '/Users/me/.lighthouse/locks/acme__web/owner.json': JSON.stringify({ id: 'other', since: 0 }) },
  )
  await save(h.host.store, { ...TRACKED_4, stage: 'cleanup-doubt' })
  expect(await cleanNow(h.host, ctx(), TRACKED_4.key)).toBe('Nettoyage impossible : une autre conversation agit sur ce dépôt.')
  expect(h.calls.some(x => /worktree remove|branch -D/.test(x.line))).toBe(false)
})

test('Clean up button: the PR changed stage between the read and the lock, nothing is done', async () => {
  const h = fakeHost([
    [LOCK, () => (h.store.set('tracked:acme/web#4', { ...TRACKED_4, stage: 'cleaned' }), {})],
    ...GIT_BASE,
    ...DEPLOYS_AND_CLEANS,
  ])
  await save(h.host.store, { ...TRACKED_4, stage: 'cleanup-doubt' })
  expect(await cleanNow(h.host, ctx(), TRACKED_4.key)).toBe('Nettoyage impossible : étape cleaned.')
  expect(h.calls.some(x => /worktree remove|branch -D/.test(x.line))).toBe(false)
})

test('new head of an open PR: noted, unless another session moved it on meanwhile', async () => {
  const pushed = { ...PR_OPEN, headRefOid: 'tip2', files: [] }
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: '[]' }], [/^gh pr view 4/, { stdout: JSON.stringify(pushed) }]])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, TRACKED_4)
  await tick(h.host, c, actions().actions)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'open', prHead: 'tip2' })

  const movedOn: Tracked = { ...MERGED_4, stage: 'deploying', launchedBy: 'other', launchedAt: 0 }
  const h2 = fakeHost([
    [/^gh pr view 4/, () => (h2.store.set('tracked:acme/web#4', movedOn), { stdout: JSON.stringify(pushed) })],
    ...GIT_BASE,
    [/^gh pr list/, { stdout: '[]' }],
  ])
  const c2 = ctx()
  await addFolder(h2.host, c2, '/w/web')
  await save(h2.host.store, TRACKED_4)
  await tick(h2.host, c2, actions().actions)
  expect(await loadTracked(h2.host.store)).toEqual([movedOn])
})

test('English: notifications, clean up and forget messages', async () => {
  const en = texts('en')
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a' }, { path: 'mac/b' }] }
  const h = fakeHost([...GIT_BASE, [/^gh pr list/, { stdout: '[]' }], [/^gh pr view 4/, { stdout: JSON.stringify(merged) }], [/^rm -rf/, {}]])
  const c = { ...ctx(), t: en }
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { ...TRACKED_4, stage: 'open' })
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(a.notifications).toEqual(['#4 acme/web merged: deploy to confirm (no deploy command matches the files touched)'])
  await save(h.host.store, { ...TRACKED_4, stage: 'open' })
  expect(await cleanNow(h.host, c, TRACKED_4.key)).toBe('Cannot clean up: stage open.')
  expect(await forgetNow(h.host, TRACKED_4.key, en)).toEqual({ done: false, message: 'Cannot forget: stage open.' })
})

test('a PR the tracking knows is merged never shows as open, even from a stale open list', async () => {
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a.py' }] }
  const h = fakeHost([
    ...GIT_BASE,
    [/^gh pr list/, { stdout: JSON.stringify([PR_OPEN]) }], // GitHub or the shared cache still lists it as open
    [/^gh pr view 4/, { stdout: JSON.stringify(merged) }],
    [/^gh run list/, { stdout: '[]' }],
  ])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, TRACKED_4)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(a.published[0].events.map(s => s.key)).toEqual(['acme/web#4'])
  expect(a.published[0].trees[0].prs).toEqual([])
})

test('the local branch of a merged PR is not shown as a branch without PR', async () => {
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'ec2/a.py' }] }
  const h = fakeHost([
    ...GIT_BASE.filter(([re]) => !/for-each-ref/.test(String(re)) && !/rev-list/.test(String(re))),
    [/for-each-ref/, { stdout: 'feat/x\torigin/feat/x\t\t/w/web/.worktrees/x\nfeat/y\t\t\t\n' }],
    [/rev-list --count/, { stdout: '2\n' }],
    [/^gh pr list/, { stdout: '[]' }],
    [/^gh pr view 4/, { stdout: JSON.stringify(merged) }],
    [/^gh run list/, { stdout: '[]' }],
  ])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, TRACKED_4)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(a.published[0].trees[0].branches.map(b => b.name)).toEqual(['feat/y'])
})

test('a repo without a rule nor workflow: a local project, deployed at once, and the card says why', async () => {
  const merged = { ...PR_OPEN, state: 'MERGED', mergeCommit: { oid: 'm' }, files: [{ path: 'a.swift' }] }
  const h = fakeHost([
    ...GIT_BASE.map(([re, answer]): [RegExp, Answer] =>
      /remote get-url/.test(String(re)) ? [re, { stdout: 'https://github.com/acme/sandbox.git\n' }] : [re, answer]),
    [/^gh pr list/, { stdout: '[]' }],
    [/^gh pr view 4/, { stdout: JSON.stringify(merged) }],
    [/^ls -1 \/w\/web\/.github\/workflows/, { exitCode: 1 }],
  ])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, { ...TRACKED_4, key: 'acme/sandbox#4', slug: 'acme/sandbox' })
  const a = actions()
  await tick(h.host, c, a.actions)
  const s = (await loadTracked(h.host.store)).find(x => x.key === 'acme/sandbox#4')
  expect(s?.note).toBe('Projet local : rien à déployer')
  expect(['deployed', 'cleanup-doubt', 'cleaned']).toContain(s?.stage)
})

test('a local branch stacked on an open PR is linked to it, and the PR takes its session', async () => {
  const refs = ['feat/x\torigin/feat/x\t\t', 'feat/y\t\t\t/w/web/.worktrees/y', 'feat/z\t\t\t'].join('\n')
  const h = fakeHost([
    [/for-each-ref/, { stdout: refs + '\n' }],
    [/rev-list --count origin\/main\.\.feat\//, { stdout: '3\n' }],
    [/merge-base --is-ancestor tip feat\/y$/, {}], // feat/y contains the PR's head
    ...GIT_BASE,
    [/^gh pr list/, { stdout: JSON.stringify([PR_OPEN]) }],
    [/^gh pr view 4/, { stdout: JSON.stringify({ ...PR_OPEN, files: [] }) }],
  ])
  const c = { ...ctx(), cwd: '/w/web/.worktrees/y' }
  await addFolder(h.host, c, '/w/web')
  await addFolder(h.host, c, '/w/web/.worktrees/y')
  const a = actions()
  await tick(h.host, c, a.actions)
  const tree = a.published[0]?.trees[0]
  expect(tree?.branches.map(b => [b.name, b.stackedOn])).toEqual([['feat/y', 4], ['feat/z', undefined]])
  expect(tree?.prs[0]?.owner).toEqual({ kind: 'here' }) // through feat/y's worktree, where this session works
})

test('a PR is linked to its local branch even under another name: same tip, or tracking the PR’s branch', async () => {
  const refs = [
    'claude/abc\t\t\t/w/web/.claude/worktrees/abc\ttip', // pushed as feat/x: same tip as the PR
    'wip\torigin/feat/q\t[ahead 2]\t\tother', // tracks the PR's branch, 2 commits not pushed yet
    'feat/z\t\t\t\tzzz',
  ].join('\n')
  const prQ = { ...PR_OPEN, number: 5, headRefName: 'feat/q', headRefOid: 'q-head' }
  const h = fakeHost([
    [/for-each-ref/, { stdout: refs + '\n' }],
    [/rev-list --count origin\/main\.\./, { stdout: '1\n' }],
    ...GIT_BASE,
    [/^gh pr list/, { stdout: JSON.stringify([PR_OPEN, prQ]) }],
    [/^gh pr view/, { stdout: JSON.stringify({ ...PR_OPEN, files: [] }) }],
  ])
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  const a = actions()
  await tick(h.host, c, a.actions)
  const tree = a.published[0]?.trees[0]
  expect(tree?.prs.map(p => [p.number, p.localBranch, p.path, p.unpushed])).toEqual([
    [4, 'claude/abc', '/w/web/.claude/worktrees/abc', 0],
    [5, 'wip', null, 2],
  ])
  expect(tree?.branches.map(b => b.name)).toEqual(['feat/z'])
})

// A cleanup doubt is checked again on its own: PRs #27…#36 of a repo stayed "cleanup pending" after their trees were removed by hand.
const DOUBT_4: Tracked = { ...TRACKED_4, stage: 'cleanup-doubt', reason: t.reason.thisSessionInside, updatedAt: 0 }
const MAIN_ONLY = 'worktree /w/web\nHEAD a\nbranch refs/heads/main\n'

test('cleanup doubt whose tree and branch are gone: cleaned after the delay, not before', async () => {
  const h = fakeHost([
    ...GIT_BASE,
    [/^gh pr list/, { stdout: '[]' }],
    [/worktree list --porcelain/, { stdout: MAIN_ONLY }],
    [/worktree prune/, {}],
    [/branch -D/, { exitCode: 1, stderr: "error: branch 'feat/x' not found." }],
  ], {}, CLEANUP_RETRY_MS - 1)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, DOUBT_4)
  const a = actions()
  await tick(h.host, c, a.actions)
  expect((await loadTracked(h.host.store))[0]).toEqual(DOUBT_4)
  expect(h.calls.some(x => /branch -D|worktree prune/.test(x.line))).toBe(false)

  h.state.now = CLEANUP_RETRY_MS
  await tick(h.host, c, a.actions)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'cleaned', updatedAt: CLEANUP_RETRY_MS })
  expect(a.notifications).toEqual([])
})

test('cleanup doubt with uncommitted files: stays a doubt, its new reason written once, no notification', async () => {
  const h = fakeHost([
    ...GIT_BASE,
    [/^gh pr list/, { stdout: '[]' }],
    [/worktree list --porcelain/, { stdout: TREE_X }],
    [/^test -d/, {}],
    [/status --short/, { stdout: ' M a.py\n' }],
    [/rev-parse HEAD/, { stdout: 'tip\n' }],
  ], {}, CLEANUP_RETRY_MS)
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, DOUBT_4)
  const a = actions()
  await tick(h.host, c, a.actions)
  const reason = t.reason.uncommittedIn(1, '/w/web/.worktrees/x')
  expect((await loadTracked(h.host.store))[0]).toEqual({ ...DOUBT_4, reason, updatedAt: CLEANUP_RETRY_MS })

  // Checked again after the delay, same reason: nothing rewritten.
  const written = writesOf(h)
  h.state.now = 2 * CLEANUP_RETRY_MS
  await tick(h.host, c, a.actions)
  expect(h.calls.filter(x => /status --short/.test(x.line))).toHaveLength(2)
  expect(written).toEqual([])
  expect(h.calls.some(x => /worktree remove|branch -D/.test(x.line))).toBe(false)
  expect(a.notifications).toEqual([])
})

test('cleanup doubt in a tree another session works in: stays a doubt', async () => {
  const h = fakeHost(
    [
      [/^ls -1/, { stdout: 'other.json\n' }],
      ...GIT_BASE,
      [/^gh pr list/, { stdout: '[]' }],
      [/worktree list --porcelain/, { stdout: TREE_X }],
      [/^test -d/, {}],
      [/status --short/, { stdout: '' }],
      [/rev-parse HEAD/, { stdout: 'tip\n' }],
    ],
    { [OTHER_SESSION]: JSON.stringify({ cwd: '/w/web/.worktrees/x', trees: [], updatedAt: CLEANUP_RETRY_MS }) },
    CLEANUP_RETRY_MS,
  )
  const c = ctx()
  await addFolder(h.host, c, '/w/web')
  await save(h.host.store, DOUBT_4)
  await tick(h.host, c, actions().actions)
  expect((await loadTracked(h.host.store))[0]).toMatchObject({ stage: 'cleanup-doubt', reason: t.reason.otherSessionInside })
  expect(h.calls.some(x => /worktree remove|branch -D/.test(x.line))).toBe(false)
})

test('the config file is read at the first tick, then again at most once a minute', async () => {
  const FILE = '/Users/me/.lighthouse/config.json'
  const h = fakeHost([], { [FILE]: JSON.stringify({ rules: { 'acme/site': { kind: 'immediate' } } }) }, 1_000)
  const c = { ...ctx(), config: { rules: {}, ghConfigDirs: {} } }
  await refreshConfig(h.host, c)
  expect(c.config.rules).toEqual({ 'acme/site': { kind: 'immediate' } })
  h.files[FILE] = JSON.stringify({ ghConfigDirs: { acme: '/gh/acme' } })
  h.state.now = 60_999
  await refreshConfig(h.host, c)
  expect(c.config.ghConfigDirs).toEqual({}) // read less than a minute ago: kept
  h.state.now = 61_000
  await refreshConfig(h.host, c)
  expect(c.config).toEqual({ rules: {}, ghConfigDirs: { acme: '/gh/acme' } })
  delete h.files[FILE]
  h.state.now = 121_000
  await refreshConfig(h.host, c)
  expect(c.config).toEqual({ rules: {}, ghConfigDirs: {} }) // file removed: back to no rules
})

const TO_REVIEW = [{ number: 9, title: 'Add search', url: 'https://github.com/acme/api/pull/9', isDraft: false, updatedAt: new Date(0).toISOString(), repository: { nameWithOwner: 'acme/api' }, author: { login: 'alice' } }]

test('the PRs to review are published with their facts, and the last list stays while gh fails', async () => {
  let fails = false
  const h = fakeHost([[/^gh search prs/, () => (fails ? { exitCode: 1, stderr: 'offline' } : { stdout: JSON.stringify(TO_REVIEW) })]], {}, 3_600_000)
  const c = ctx()
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(a.published[0].reviews).toEqual([
    { slug: 'acme/api', number: 9, title: 'Add search', url: 'https://github.com/acme/api/pull/9', author: 'alice', draft: false, updatedAt: 0, facts: 'acme/api · par alice · active il y a 1 h' },
  ])
  fails = true
  await tick(h.host, c, a.actions)
  expect(a.published[1].reviews).toEqual(a.published[0].reviews)
})

test('the PRs to review are shared through the store while fresh', async () => {
  const h = fakeHost([[/^gh search prs/, { stdout: JSON.stringify(TO_REVIEW) }]])
  const c = { ...ctx(), reviewsMaxAge: 120_000 }
  await tick(h.host, c, actions().actions)
  await tick(h.host, { ...ctx(), reviewsMaxAge: 120_000 }, actions().actions) // another session, same store
  // Two accounts (the active one and acme's), asked once.
  expect(h.calls.filter(x => x.line.startsWith('gh search prs'))).toHaveLength(2)
})

test('the tick publishes the release repos of the config, even without a session repo', async () => {
  const h = fakeHost([
    [/symbolic-ref/, { stdout: 'origin/main\n' }],
    [/fetch --quiet origin main/, {}],
    [/tag --merged origin\/main/, { stdout: 'v0.2.40\n' }],
    [/log -1 --format=%ct/, { stdout: '100\n' }],
    [/log --first-parent/, { stdout: '' }],
    [/^gh/, { stdout: '[]' }],
  ])
  const c: Context = { ...ctx(), config: { rules: { 'acme/app': { kind: 'release', path: '~/r/app', command: 'make release' } }, ghConfigDirs: {} } }
  const a = actions()
  await tick(h.host, c, a.actions)
  expect(a.published[0].releases.map(r => [r.slug, r.tag])).toEqual([['acme/app', 'v0.2.40']])
})
