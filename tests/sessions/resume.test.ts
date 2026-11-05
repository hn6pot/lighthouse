import { expect, test } from 'claude-code/testing'
import { NO_CONFIG } from '../../hooks/config'
import { texts } from '../../hooks/i18n'
import type { Context } from '../../hooks/loop'
import { resumeTrees } from '../../hooks/sessions/resume'
import { fakeHost } from '../helpers/fake-host'

const ctx = (): Context => ({ id: 'me', cwd: '/w/other', repos: new Map(), lastFetch: new Map(), logins: new Map(), t: texts('en'), config: NO_CONFIG })

test('a resumed session gets back the trees it saved; a folder gone is skipped', async () => {
  const saved = { cwd: '/w/other', trees: ['/w/web/.worktrees/x', '/w/gone'], updatedAt: 0 }
  const { host } = fakeHost(
    [
      [/-C \/w\/gone /, { exitCode: 128, stderr: 'cannot change to /w/gone' }],
      [/rev-parse --show-toplevel/, { stdout: '/w/web/.worktrees/x\n' }],
      [/--git-common-dir/, { stdout: '/w/web/.git\n' }],
      [/remote get-url origin/, { stdout: 'https://github.com/acme/web.git\n' }],
    ],
    { '/Users/me/.lighthouse/sessions/me.json': JSON.stringify(saved) },
  )
  const c = ctx()
  await resumeTrees(host, c)
  expect([...c.repos.values()]).toEqual([{ root: '/w/web', slug: 'acme/web', trees: ['/w/web/.worktrees/x'] }])
})

test('a new session has nothing to resume', async () => {
  const { host } = fakeHost([])
  const c = ctx()
  await resumeTrees(host, c)
  expect(c.repos.size).toBe(0)
})
