import { expect, test } from 'claude-code/testing'
import { merge } from '../../hooks/github/merge'
import { texts } from '../../hooks/i18n'
import { fakeHost } from '../helpers/fake-host'

const t = texts('fr')
const DIRS = { acme: '~/.config/gh-acme' }

test('merges by squash if the repo allows it, and only the commit seen', async () => {
  const { host, calls } = fakeHost([
    [/^gh api repos\/acme\/x$/, { stdout: '{"allow_squash_merge":true,"allow_merge_commit":true,"allow_rebase_merge":true}' }],
    [/^gh pr merge/, { stdout: '' }],
  ])
  expect(await merge(host, DIRS, 'acme/x', 3, 'abc', t)).toBe('#3 fusionnée (squash)')
  expect(calls[1].line).toBe('gh pr merge 3 --squash --match-head-commit abc -R acme/x')
  expect(calls[1].options?.env).toEqual({ GH_CONFIG_DIR: '/Users/me/.config/gh-acme' })
})

test('otherwise the method the repo allows', async () => {
  const { host, calls } = fakeHost([
    [/^gh api/, { stdout: '{"allow_squash_merge":false,"allow_merge_commit":true,"allow_rebase_merge":true}' }],
    [/^gh pr merge/, { stdout: '' }],
  ])
  expect(await merge(host, DIRS, 'w/x', 3, 'abc', t)).toBe('#3 fusionnée (merge)')
  expect(calls[1].line).toContain('--merge')
})

test('a refusal from GitHub comes back as a message', async () => {
  const { host } = fakeHost([
    [/^gh api/, { stdout: '{"allow_squash_merge":true}' }],
    [/^gh pr merge/, { exitCode: 1, stderr: 'Head branch was modified.' }],
  ])
  expect(await merge(host, DIRS, 'w/x', 3, 'abc', t)).toBe('#3 non fusionnée : Head branch was modified.')
  expect(await merge(host, DIRS, 'w/x', 3, 'abc', texts('en'))).toBe('#3 not merged: Head branch was modified.')
})
