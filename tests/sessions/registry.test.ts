import { expect, test } from 'claude-code/testing'
import { forgetSession, liveSessions, otherSessionIn, record } from '../../hooks/sessions/registry'
import { fakeHost } from '../helpers/fake-host'

const LIST = /^ls -1 \/Users\/me\/\.lighthouse\/sessions/

test('record writes the session file', async () => {
  const { host, files } = fakeHost([[/^mkdir -p/, {}]], {}, 1000)
  await record(host, 'a', { cwd: '/w', trees: ['/r/.worktrees/x'] })
  expect(JSON.parse(files['/Users/me/.lighthouse/sessions/a.json'])).toEqual({ cwd: '/w', trees: ['/r/.worktrees/x'], updatedAt: 1000 })
})

test('another recent session in the tree counts, not oneself nor an old one', async () => {
  const files = {
    '/Users/me/.lighthouse/sessions/me.json': JSON.stringify({ cwd: '/r/.worktrees/x', trees: [], updatedAt: 0 }),
    '/Users/me/.lighthouse/sessions/b.json': JSON.stringify({ cwd: '/w', trees: ['/r/.worktrees/x'], updatedAt: 30 * 60_000 }),
    '/Users/me/.lighthouse/sessions/old.json': JSON.stringify({ cwd: '/r/.worktrees/y', trees: [], updatedAt: 0 }),
  }
  const { host, state } = fakeHost([[LIST, { stdout: 'me.json\nb.json\nold.json\n' }]], files, 31 * 60_000)
  expect(await otherSessionIn(host, 'me', '/r/.worktrees/x')).toBe(true)
  expect(await otherSessionIn(host, 'me', '/r/.worktrees/y')).toBe(false)
  state.now = 61 * 60_000
  expect(await otherSessionIn(host, 'me', '/r/.worktrees/x')).toBe(false)
})

test('forgetSession deletes the file', async () => {
  const { host, calls } = fakeHost([[/^rm -f/, {}]])
  await forgetSession(host, 'a')
  expect(calls[0].line).toBe('rm -f /Users/me/.lighthouse/sessions/a.json')
})

test('an unreadable entry holds the tree: it is not considered free', async () => {
  const files = {
    '/Users/me/.lighthouse/sessions/broken.json': 'not json',
  }
  const { host } = fakeHost([[LIST, { stdout: 'me.json\nbroken.json\n' }]], files, 0)
  expect(await otherSessionIn(host, 'me', '/r/.worktrees/x')).toBe(true)
})

test('liveSessions: the other sessions still beating, with their label', async () => {
  const dir = '/Users/me/.lighthouse/sessions'
  const { host, state } = fakeHost([[/^ls -1 /, { stdout: 'me.json\na.json\nold.json\nbad.json\n' }]], {
    [`${dir}/me.json`]: JSON.stringify({ cwd: '/m', trees: [], updatedAt: 1_000_000 }),
    [`${dir}/a.json`]: JSON.stringify({ cwd: '/a', trees: ['/r/y'], updatedAt: 1_000_000, label: 'Fix the CI' }),
    [`${dir}/old.json`]: JSON.stringify({ cwd: '/o', trees: [], updatedAt: 0 }),
    [`${dir}/bad.json`]: '{',
  })
  state.now = 1_000_000 + 60_000
  expect(await liveSessions(host, 'me')).toEqual([{ id: 'a', cwd: '/a', trees: ['/r/y'], label: 'Fix the CI' }])
})
