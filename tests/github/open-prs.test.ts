import { expect, test } from 'claude-code/testing'
import { myOpenPrs, requiredOf } from '../../hooks/github/open-prs'
import { fakeHost } from '../helpers/fake-host'

const NODE = {
  number: 3, title: 'feat: x', url: 'https://github.com/acme/api/pull/3', state: 'OPEN', headRefName: 'feat/x', headRefOid: 'abc',
  baseRefName: 'main', mergeCommit: null, mergedAt: null, reviewDecision: 'REVIEW_REQUIRED', isDraft: false, mergeable: 'MERGEABLE',
  mergeStateStatus: 'BLOCKED', author: { login: 'me' },
  reviews: { nodes: [{ author: { login: 'bob' }, state: 'APPROVED' }] },
  commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }] } } } }] },
  baseRef: { branchProtectionRule: null, rules: { nodes: [{ type: 'DELETION', parameters: null }, { type: 'PULL_REQUEST', parameters: { requiredApprovingReviewCount: 2 } }] } },
}
const answer = (nodes: object[]) => ({ stdout: JSON.stringify({ data: { search: { nodes } } }) })

test('myOpenPrs: one GraphQL search of my open PRs in the repo, with the repo’s gh account', async () => {
  const { host, calls } = fakeHost([[/^gh api graphql/, answer([NODE, {}])]])
  const prs = await myOpenPrs(host, { acme: '~/.config/gh-acme' }, 'acme/api')
  expect(calls).toHaveLength(1)
  expect(calls[0].line).toContain('-f q=repo:acme/api is:pr is:open author:@me')
  expect(calls[0].options?.env).toEqual({ GH_CONFIG_DIR: '/Users/me/.config/gh-acme' })
  // A search hit that is not a PR comes back empty: left out.
  expect(prs).toHaveLength(1)
  expect(prs[0]).toMatchObject({
    number: 3, author: { login: 'me' }, required: 2,
    reviews: [{ author: { login: 'bob' }, state: 'APPROVED' }],
    statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  })
})

test('myOpenPrs: a commit without checks, and gh refusing', async () => {
  const bare = { ...NODE, commits: { nodes: [{ commit: { statusCheckRollup: null } }] } }
  const { host } = fakeHost([[/^gh api graphql/, answer([bare])]])
  expect((await myOpenPrs(host, {}, 'acme/api'))[0].statusCheckRollup).toEqual([])
  const down = fakeHost([[/^gh api graphql/, { exitCode: 1, stderr: 'HTTP 502' }]])
  await expect(myOpenPrs(down.host, {}, 'acme/api')).rejects.toThrow('gh api graphql on acme/api: HTTP 502')
})

test('requiredOf: the most any rule asks for, classic protection included', () => {
  const rules = (...n: number[]) => ({ nodes: n.map(c => ({ type: 'PULL_REQUEST', parameters: { requiredApprovingReviewCount: c } })) })
  expect(requiredOf({ branchProtectionRule: null, rules: rules() })).toBe(0)
  expect(requiredOf({ branchProtectionRule: null, rules: rules(1, 2) })).toBe(2)
  expect(requiredOf({ branchProtectionRule: { requiredApprovingReviewCount: 3 }, rules: rules(1) })).toBe(3)
  expect(requiredOf(null)).toBeNull() // the base branch is gone
})
