import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import { baseBranch, lastRelease, localBranches, originSlug, parseBranches, parseWorktrees, push, roots, slugFromUrl, treeState } from '../../hooks/repos/git'
import { fakeHost } from '../helpers/fake-host'

const t = texts('fr')

test('roots: a worktree goes back up to the main folder', async () => {
  const { host } = fakeHost([
    [/rev-parse --show-toplevel/, { stdout: '/r/api/.worktrees/x\n' }],
    [/rev-parse --path-format=absolute --git-common-dir/, { stdout: '/r/api/.git\n' }],
  ])
  expect(await roots(host, '/r/api/.worktrees/x/src')).toEqual({ root: '/r/api', tree: '/r/api/.worktrees/x' })
})

test('roots: outside a repo, null', async () => {
  const { host } = fakeHost([[/rev-parse/, { exitCode: 128, stderr: 'not a git repository' }]])
  expect(await roots(host, '/tmp')).toBeNull()
})

test('slugFromUrl: https, ssh, .git, and non-GitHub', () => {
  expect(slugFromUrl('https://github.com/acme/web.git')).toBe('acme/web')
  expect(slugFromUrl('git@github.com:acme/api.git')).toBe('acme/api')
  expect(slugFromUrl('https://gitlab.com/a/b')).toBeNull()
})

test('originSlug: without origin, null (local repo)', async () => {
  const { host } = fakeHost([[/remote get-url origin/, { exitCode: 2, stderr: 'No such remote' }]])
  expect(await originSlug(host, '/r/local')).toBeNull()
})

test('baseBranch reads origin/HEAD, else main', async () => {
  const withRef = fakeHost([[/symbolic-ref/, { stdout: 'origin/production\n' }]])
  expect(await baseBranch(withRef.host, '/r')).toBe('production')
  const without = fakeHost([[/symbolic-ref/, { exitCode: 1 }]])
  expect(await baseBranch(without.host, '/r')).toBe('main')
})

test('treeState: branch, behind, uncommitted', async () => {
  const { host } = fakeHost([
    [/branch --show-current/, { stdout: 'feat/x\n' }],
    [/rev-list --count HEAD\.\.origin\/production/, { stdout: '12\n' }],
    [/status --porcelain/, { stdout: ' M a.ts\n?? b.ts\n' }],
  ])
  expect(await treeState(host, '/r', 'production', t)).toEqual({ branch: 'feat/x', behind: 12, uncommitted: 2 })
})

test('treeState: detached HEAD, in each language', async () => {
  const { host } = fakeHost([[/branch --show-current/, { stdout: '' }]])
  expect((await treeState(host, '/r', 'main', t)).branch).toBe('(détachée)')
  expect((await treeState(host, '/r', 'main', texts('en'))).branch).toBe('(detached)')
})

test('treeState: git status without optional locks (does not get in the way of Claude’s commits)', async () => {
  const { host, calls } = fakeHost([[/status --porcelain/, { stdout: '' }]])
  await treeState(host, '/r', 'main', t)
  expect(calls.map(a => a.line)).toContain('git -C /r --no-optional-locks status --porcelain')
})

test('parseWorktrees: main, branch, detached', () => {
  const text = [
    'worktree /r', 'HEAD aaa', 'branch refs/heads/production', '',
    'worktree /r/.worktrees/x', 'HEAD bbb', 'branch refs/heads/feat/x', '',
    'worktree /r/.claude/worktrees/y', 'HEAD ccc', 'detached', '',
  ].join('\n')
  expect(parseWorktrees(text)).toEqual([
    { path: '/r', branch: 'production', head: 'aaa' },
    { path: '/r/.worktrees/x', branch: 'feat/x', head: 'bbb' },
    { path: '/r/.claude/worktrees/y', branch: null, head: 'ccc' },
  ])
})

test('parseBranches: tracking its own name only, ahead, remote deleted', () => {
  const T = '\t'
  expect(parseBranches([
    ['main', 'origin/main', '[ahead 2]', '/r'].join(T),
    ['feat/x', 'origin/main', '', '/r/.worktrees/x'].join(T), // created from origin/main: never pushed
    ['feat/y', 'origin/feat/y', '[ahead 1, behind 3]', ''].join(T),
    ['feat/z', 'origin/feat/z', '[gone]', ''].join(T),
    ['feat/w', '', '', ''].join(T),
    ['feat/v', 'origin/feat/v', '', ''].join(T),
  ].join('\n'))).toMatchObject([
    { name: 'main', path: '/r', remote: 'ok', unpushed: 2 },
    { name: 'feat/x', path: '/r/.worktrees/x', remote: 'none', unpushed: 0 },
    { name: 'feat/y', path: null, remote: 'ok', unpushed: 1 },
    { name: 'feat/z', path: null, remote: 'deleted', unpushed: 0 },
    { name: 'feat/w', path: null, remote: 'none', unpushed: 0 },
    { name: 'feat/v', path: null, remote: 'ok', unpushed: 0 },
  ])
})

test('localBranches: work ahead of the base, and the base only if it has unpushed commits', async () => {
  const T = '\t'
  const { host } = fakeHost([
    [/for-each-ref/, { stdout: [
      ['main', 'origin/main', '', '/r'].join(T),
      ['feat/x', 'origin/main', '', '/r/.worktrees/x'].join(T),
      ['feat/old', 'origin/feat/old', '', ''].join(T),
    ].join('\n') + '\n' }],
    [/rev-list --count origin\/main\.\.feat\/x/, { stdout: '3\n' }],
    [/rev-list --count origin\/main\.\.feat\/old/, { stdout: '0\n' }],
  ])
  expect(await localBranches(host, '/r', 'main')).toMatchObject([
    { name: 'feat/x', path: '/r/.worktrees/x', remote: 'none', unpushed: 0, ahead: 3 },
  ])
})

test('push: from its worktree, with tracking', async () => {
  const { host, calls } = fakeHost([[/push/, { stdout: '' }]])
  expect(await push(host, '/r', '/r/.worktrees/x', 'feat/x', t)).toBe('feat/x poussée')
  expect(calls[0].line).toBe('git -C /r/.worktrees/x push -u origin feat/x')
  const refused = fakeHost([[/push/, { exitCode: 1, stderr: 'rejected\n' }]])
  expect(await push(refused.host, '/r', null, 'feat/x', t)).toBe('feat/x non poussée : rejected')
  expect(refused.calls[0].line).toBe('git -C /r push -u origin feat/x')
})

test('parseBranches keeps each branch’s upstream, its tip, and how far ahead of its upstream it is', () => {
  const T = '\t'
  expect(parseBranches(['claude/abc', 'origin/feat/x', '[ahead 2]', '/r/.claude/worktrees/abc', 'tip1'].join(T))).toEqual([
    { name: 'claude/abc', path: '/r/.claude/worktrees/abc', remote: 'none', unpushed: 0, upstream: 'origin/feat/x', tip: 'tip1', aheadOfUpstream: 2 },
  ])
})

test('push: a local branch under another name goes to the PR’s branch', async () => {
  const { host, calls } = fakeHost([[/push/, { stdout: '' }]])
  await push(host, '/r', '/r/.claude/worktrees/abc', 'claude/abc', texts('en'), 'feat/x')
  expect(calls[0]?.line).toBe('git -C /r/.claude/worktrees/abc push -u origin claude/abc:feat/x')
})

test('lastRelease: the last tag on the base and how many commits came since', async () => {
  const { host } = fakeHost([
    [/describe --tags --abbrev=0 origin\/main$/, { stdout: 'v1.4.0\n' }],
    [/rev-list --count v1\.4\.0\.\.origin\/main$/, { stdout: '12\n' }],
  ])
  expect(await lastRelease(host, '/r', 'main')).toEqual({ tag: 'v1.4.0', since: 12 })
  expect(await lastRelease(fakeHost([]).host, '/r', 'main')).toBeUndefined() // no tag yet
})
