import { expect, test } from 'claude-code/testing'
import { checkCleanup } from '../../hooks/cleanup/checks'
import { texts } from '../../hooks/i18n'
import type { Tracked } from '../../hooks/model'
import { fakeHost, type Answer } from '../helpers/fake-host'

const t = texts('fr')
const S: Tracked = {
  key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'production',
  stage: 'deployed', updatedAt: 0, prHead: 'tip',
}
const LIST_WITH_TREE = 'worktree /r\nHEAD a\nbranch refs/heads/production\n\nworktree /r/.worktrees/x\nHEAD tip\nbranch refs/heads/feat/x\n'

function host(extra: [RegExp, Answer][] = []) {
  return fakeHost([
    ...extra,
    [/worktree list --porcelain/, { stdout: LIST_WITH_TREE }],
    [/^ls -1/, { stdout: '' }],
    [/status --short/, { stdout: '' }],
    [/^test -d/, {}],
    [/rev-parse HEAD/, { stdout: 'tip\n' }],
  ]).host
}
const CTX = { id: 'me', cwd: '/w' }

test('everything in order (squash): ok, with the tree', async () => {
  expect(await checkCleanup(host(), S, CTX, t)).toEqual({ ok: true, tree: '/r/.worktrees/x' })
})

test('git status without optional locks (does not get in the way of Claude’s commits)', async () => {
  const h = fakeHost([
    [/worktree list --porcelain/, { stdout: LIST_WITH_TREE }],
    [/^ls -1/, { stdout: '' }],
    [/status --short/, { stdout: '' }],
    [/^test -d/, {}],
    [/rev-parse HEAD/, { stdout: 'tip\n' }],
  ])
  await checkCleanup(h.host, S, CTX, t)
  expect(h.calls.map(a => a.line)).toContain('git -C /r/.worktrees/x --no-optional-locks status --short')
})

test('not deployed yet: doubt', async () => {
  expect(await checkCleanup(host(), { ...S, stage: 'deploy-doubt' }, CTX, t)).toMatchObject({ ok: false })
})

test('uncommitted changes: doubt', async () => {
  const v = await checkCleanup(host([[/status --short/, { stdout: ' M a.ts\n' }]]), S, CTX, t)
  expect(v).toEqual({ ok: false, reason: '1 fichier(s) non commité(s) dans /r/.worktrees/x' })
})

test('commit never pushed to GitHub: doubt', async () => {
  const v = await checkCleanup(host([[/rev-parse HEAD/, { stdout: 'other\n' }]]), S, CTX, t)
  expect(v).toMatchObject({ ok: false, reason: expect.stringContaining('jamais poussés') })
})

test('tree behind the PR (sub-PRs merged into it on GitHub): ok, with the tree', async () => {
  const v = await checkCleanup(host([[/rev-parse HEAD/, { stdout: 'old\n' }], [/merge-base --is-ancestor old tip/, {}]]), S, CTX, t)
  expect(v).toEqual({ ok: true, tree: '/r/.worktrees/x' })
})

test('tree on a tip that was pushed, then rewritten on GitHub (rebase): ok, with the tree', async () => {
  const reflog: [RegExp, Answer] = [/reflog show --format=%H refs\/remotes\/origin\/feat\/x/, { stdout: 'tip\nmid\nold\nfirst\n' }]
  const v = await checkCleanup(host([[/rev-parse HEAD/, { stdout: 'old\n' }], reflog]), S, CTX, t)
  expect(v).toEqual({ ok: true, tree: '/r/.worktrees/x' })
})

test('tree on a commit absent from the remote reflog: doubt', async () => {
  const reflog: [RegExp, Answer] = [/reflog show/, { stdout: 'tip\nmid\n' }]
  const v = await checkCleanup(host([[/rev-parse HEAD/, { stdout: 'old\n' }], reflog]), S, CTX, t)
  expect(v).toMatchObject({ ok: false, reason: expect.stringContaining('jamais poussés') })
})

test('the session itself runs in the tree: doubt', async () => {
  const v = await checkCleanup(host(), S, { id: 'me', cwd: '/r/.worktrees/x/src' }, t)
  expect(v).toMatchObject({ ok: false, reason: expect.stringContaining('cette conversation') })
})

test('another session works in the tree: doubt', async () => {
  const h = fakeHost([
    [/worktree list --porcelain/, { stdout: LIST_WITH_TREE }],
    [/^test -d/, {}],
    [/^ls -1/, { stdout: 'b.json\n' }],
  ], { '/Users/me/.lighthouse/sessions/b.json': JSON.stringify({ cwd: '/r/.worktrees/x', trees: [], updatedAt: 0 }) }).host
  expect(await checkCleanup(h, S, CTX, t)).toMatchObject({ ok: false, reason: expect.stringContaining('autre conversation') })
})

test('tree already deleted by hand: ok without tree', async () => {
  const h = fakeHost([
    [/worktree list --porcelain/, { stdout: 'worktree /r\nHEAD a\nbranch refs/heads/production\n' }],
  ]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: true, tree: null })
})

test('branch without tree but current in the main folder: doubt', async () => {
  const h = fakeHost([
    [/worktree list --porcelain/, { stdout: 'worktree /r\nHEAD a\nbranch refs/heads/feat/x\n' }],
  ]).host
  expect(await checkCleanup(h, S, CTX, t)).toMatchObject({ ok: false, reason: expect.stringContaining('courante') })
})

test('git worktree list fails: doubt, never "nothing to keep"', async () => {
  const h = fakeHost([[/worktree list --porcelain/, { exitCode: 1, stderr: 'fatal' }]]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: false, reason: 'liste des worktrees illisible' })
})

test('git worktree list returns an empty output: doubt', async () => {
  const h = fakeHost([[/worktree list --porcelain/, { stdout: '' }]]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: false, reason: 'liste des worktrees illisible' })
})

test('git status --short fails: doubt', async () => {
  const v = await checkCleanup(host([[/status --short/, { exitCode: 128, stderr: 'fatal' }]]), S, CTX, t)
  expect(v).toEqual({ ok: false, reason: 'git status a échoué dans /r/.worktrees/x' })
})

test('unreadable HEAD (rev-parse fails): doubt', async () => {
  const v = await checkCleanup(host([[/rev-parse HEAD/, { exitCode: 128 }]]), S, CTX, t)
  expect(v).toMatchObject({ ok: false, reason: expect.stringContaining('jamais poussés') })
})

const NO_TREE = 'worktree /r\nHEAD a\nbranch refs/heads/production\n'

test('lone branch, gone: ok (nothing to delete)', async () => {
  const h = fakeHost([[/worktree list --porcelain/, { stdout: NO_TREE }], [/rev-parse --verify/, { exitCode: 1 }]]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: true, tree: null })
})

test('lone branch with commits never pushed: doubt', async () => {
  const h = fakeHost([[/worktree list --porcelain/, { stdout: NO_TREE }], [/rev-parse --verify/, { stdout: 'other\n' }]]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: false, reason: 'la branche feat/x a des commits jamais poussés sur GitHub' })
})

test('lone branch on a tip rewritten on GitHub after the push: ok', async () => {
  const h = fakeHost([
    [/worktree list --porcelain/, { stdout: NO_TREE }],
    [/rev-parse --verify/, { stdout: 'old\n' }],
    [/reflog show --format=%H refs\/remotes\/origin\/feat\/x/, { stdout: 'tip\nold\n' }],
  ]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: true, tree: null })
})

test('lone branch at the PR tip: ok', async () => {
  const h = fakeHost([[/worktree list --porcelain/, { stdout: NO_TREE }], [/rev-parse --verify/, { stdout: 'tip\n' }]]).host
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: true, tree: null })
})

test('tree listed but folder deleted by hand: ok without tree if the branch is at the PR', async () => {
  const h = host([[/^test -d/, { exitCode: 1 }], [/rev-parse --verify/, { stdout: 'tip\n' }]])
  expect(await checkCleanup(h, S, CTX, t)).toEqual({ ok: true, tree: null })
})

test('tree listed but folder gone, branch moved on: doubt', async () => {
  const h = host([[/^test -d/, { exitCode: 1 }], [/rev-parse --verify/, { stdout: 'other\n' }]])
  expect(await checkCleanup(h, S, CTX, t)).toMatchObject({ ok: false, reason: expect.stringContaining('la branche feat/x') })
})
