import { expect, test } from 'claude-code/testing'
import { remove } from '../../hooks/cleanup/remove'
import type { Tracked } from '../../hooks/model'
import { fakeHost } from '../helpers/fake-host'

const S = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'production', stage: 'deployed', updatedAt: 0 } as Tracked

test('removes the tree then the branch with -D', async () => {
  const { host, calls } = fakeHost([[/worktree remove/, {}], [/branch -D/, {}]])
  expect(await remove(host, S, '/r/.worktrees/x')).toEqual({ ok: true })
  expect(calls.map(a => a.line)).toEqual(['git -C /r worktree remove /r/.worktrees/x', 'git -C /r branch -D feat/x'])
})

test('no tree: prune then delete the branch; branch already gone: ok anyway', async () => {
  const { host, calls } = fakeHost([[/branch -D/, { exitCode: 1, stderr: "branch 'feat/x' not found" }]])
  expect(await remove(host, S, null)).toEqual({ ok: true })
  expect(calls.map(a => a.line)).toEqual(['git -C /r worktree prune', 'git -C /r branch -D feat/x'])
})

test('worktree remove refused: failure with the reason, branch kept', async () => {
  const { host, calls } = fakeHost([[/worktree remove/, { exitCode: 128, stderr: 'contains modified files' }]])
  expect(await remove(host, S, '/r/.worktrees/x')).toEqual({ ok: false, reason: 'contains modified files' })
  expect(calls).toHaveLength(1)
})

test('the PR’s branch on GitHub goes too, but only while it is still at the merged PR’s head', async () => {
  const merged = { ...S, prHead: 'tip' }
  const gone = fakeHost([[/worktree remove/, {}], [/branch -D/, {}], [/ls-remote --heads origin feat\/x$/, { stdout: 'tip\trefs/heads/feat/x\n' }], [/push origin --delete feat\/x$/, {}]])
  expect(await remove(gone.host, merged, '/r/.worktrees/x')).toEqual({ ok: true })
  expect(gone.calls.map(a => a.line).slice(2)).toEqual(['git -C /r ls-remote --heads origin feat/x', 'git -C /r push origin --delete feat/x'])

  const moved = fakeHost([[/worktree remove/, {}], [/branch -D/, {}], [/ls-remote/, { stdout: 'newer\trefs/heads/feat/x\n' }]])
  expect(await remove(moved.host, merged, null)).toEqual({ ok: true })
  expect(moved.calls.some(a => /--delete/.test(a.line))).toBe(false) // commits pushed after the merge: kept

  const refused = fakeHost([[/worktree remove/, {}], [/branch -D/, {}], [/ls-remote/, { stdout: 'tip\trefs/heads/feat/x\n' }], [/--delete/, { exitCode: 1, stderr: 'protected' }]])
  expect(await remove(refused.host, merged, null)).toEqual({ ok: true }) // GitHub refuses: the local cleanup still counts
})
