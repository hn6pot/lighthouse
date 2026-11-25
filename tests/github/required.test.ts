import { expect, test } from 'claude-code/testing'
import { requiredApprovals } from '../../hooks/github/required'
import { fakeHost } from '../helpers/fake-host'

const RULES = /^gh api repos\/acme\/api\/rules\/branches\/main$/
const PROTECTION = /^gh api repos\/acme\/api\/branches\/main\/protection$/
const rule = (n: number) => JSON.stringify([{ type: 'deletion' }, { type: 'pull_request', parameters: { required_approving_review_count: n } }])
const refused = (status: number, message: string) => ({ exitCode: 1, stderr: `gh: ${message} (HTTP ${status})` })

test('a ruleset that requires approvals wins, without asking for the protection', async () => {
  const { host, calls } = fakeHost([[RULES, { stdout: rule(2) }]])
  expect(await requiredApprovals(host, {}, 'acme/api', 'main')).toBe(2)
  expect(calls).toHaveLength(1)
})

test('no ruleset: the classic protection says how many', async () => {
  const { host } = fakeHost([
    [RULES, { stdout: '[]' }],
    [PROTECTION, { stdout: JSON.stringify({ required_pull_request_reviews: { required_approving_review_count: 1 } }) }],
  ])
  expect(await requiredApprovals(host, {}, 'acme/api', 'main')).toBe(1)
})

test('neither a ruleset nor a protection: none required', async () => {
  const { host } = fakeHost([
    [RULES, { stdout: '[{"type":"deletion"}]' }],
    [PROTECTION, refused(404, 'Branch not protected')],
  ])
  expect(await requiredApprovals(host, {}, 'acme/api', 'main')).toBe(0)
})

test('a protection GitHub will not show: unknown', async () => {
  const { host } = fakeHost([
    [RULES, { stdout: '[]' }],
    [PROTECTION, refused(403, 'Resource not accessible by integration')],
  ])
  expect(await requiredApprovals(host, {}, 'acme/api', 'main')).toBeNull()
})

test('gh failing for another reason throws, so the answer is not kept', async () => {
  const { host } = fakeHost([[RULES, { exitCode: 1, stderr: 'error connecting to api.github.com' }]])
  await expect(requiredApprovals(host, {}, 'acme/api', 'main')).rejects.toThrow('error connecting')
})

test('the repo’s gh account, and a base with a slash', async () => {
  const { host, calls } = fakeHost([[/rules\/branches\/release%2F2/, { stdout: rule(1) }]])
  expect(await requiredApprovals(host, { acme: '~/.config/gh-acme' }, 'acme/api', 'release/2')).toBe(1)
  expect(calls[0].options?.env).toEqual({ GH_CONFIG_DIR: '/Users/me/.config/gh-acme' })
})
