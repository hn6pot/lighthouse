import { expect, test } from 'claude-code/testing'
import { ownerOf } from '../../hooks/sessions/owner'

const mine = { cwd: '/r/.worktrees/x/src', trees: ['/r', '/r/.worktrees/x'] }
const others = [
  { id: 'a', cwd: '/r/.worktrees/y', trees: ['/r/.worktrees/y'], label: 'Fix the CI' },
  { id: 'b', cwd: '/elsewhere', trees: ['/r/.worktrees/y', '/r/.worktrees/z'], label: 'Widget spec' },
]

test('ownerOf: this session, other sessions, or unknown', () => {
  expect(ownerOf('/r/.worktrees/x', mine, others)).toEqual({ kind: 'here' })
  expect(ownerOf('/r/.worktrees/y', mine, others)).toMatchObject({ kind: 'others', labels: ['Fix the CI', 'Widget spec'] })
  expect(ownerOf('/r/.worktrees/z', mine, others)).toMatchObject({ kind: 'others', labels: ['Widget spec'] })
  expect(ownerOf('/r/.worktrees/w', mine, others)).toEqual({ kind: 'unknown' })
  expect(ownerOf(null, mine, others)).toEqual({ kind: 'unknown' })
})

test('ownerOf keeps each other session’s desktop id, to open it from the pane', () => {
  expect(ownerOf('/r/.worktrees/z', mine, [{ id: 'b', cwd: '/x', trees: ['/r/.worktrees/z'], label: 'Widget spec', desktopId: 'local_b' }])).toEqual({
    kind: 'others', labels: ['Widget spec'], sessions: [{ label: 'Widget spec', desktopId: 'local_b' }],
  })
})
