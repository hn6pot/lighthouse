import { expect, test } from 'claude-code/testing'
import { accounts, reviewRequests } from '../../hooks/github/reviews'
import { fakeHost } from '../helpers/fake-host'

const found = (url: string, updatedAt: string, slug = 'acme/api') => ({
  number: Number(url.split('/').pop()), title: `PR ${url}`, url, isDraft: false, updatedAt, repository: { nameWithOwner: slug }, author: { login: 'alice' },
})

test('accounts: the active one, then each gh config folder once, with ~ as the home', () => {
  expect(accounts({}, '/Users/me')).toEqual([undefined])
  expect(accounts({ acme: '~/.config/gh-acme', 'acme-labs': '~/.config/gh-acme', beta: '/etc/gh' }, '/Users/me')).toEqual([undefined, '/Users/me/.config/gh-acme', '/etc/gh'])
})

test('reviewRequests asks each account for my open review requests, once per PR, newest first', async () => {
  const a = 'https://github.com/acme/api/pull/1'
  const b = 'https://github.com/beta/web/pull/2'
  const { host, calls } = fakeHost([
    [/^gh search prs/, (_argv, options) => ({ stdout: JSON.stringify(options?.env ? [found(a, '2026-01-01T00:00:00Z')] : [found(a, '2026-01-01T00:00:00Z'), found(b, '2026-02-01T00:00:00Z', 'beta/web')]) })],
  ])
  const list = await reviewRequests(host, { acme: '~/.config/gh-acme' })
  expect(list.map(r => r.url)).toEqual([b, a])
  expect(list[1]).toEqual({ slug: 'acme/api', number: 1, title: `PR ${a}`, url: a, author: 'alice', draft: false, updatedAt: Date.parse('2026-01-01T00:00:00Z') })
  expect(calls.map(c => c.line)).toEqual([
    'gh search prs --review-requested=@me --state=open --json number,title,url,isDraft,updatedAt,repository,author --limit 50',
    'gh search prs --review-requested=@me --state=open --json number,title,url,isDraft,updatedAt,repository,author --limit 50',
  ])
  expect(calls.map(c => c.options?.env)).toEqual([undefined, { GH_CONFIG_DIR: '/Users/me/.config/gh-acme' }])
})

test('reviewRequests leaves out an account gh refuses, and throws when none answers', async () => {
  const a = 'https://github.com/acme/api/pull/1'
  const one = fakeHost([[/^gh search prs/, (_argv, options) => (options?.env ? { exitCode: 1, stderr: 'not logged in' } : { stdout: JSON.stringify([found(a, '2026-01-01T00:00:00Z')]) })]])
  expect((await reviewRequests(one.host, { acme: '~/.config/gh-acme' })).map(r => r.url)).toEqual([a])
  const none = fakeHost([[/^gh search prs/, { stdout: 'not json' }]])
  await expect(reviewRequests(none.host, {})).rejects.toThrow('no account answered')
})
