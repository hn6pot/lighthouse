import { expect, test } from 'claude-code/testing'
import { ciState, commitRuns, myOpenPrs, prDetail, summarizePr, type GhPr } from '../../hooks/github/prs'
import { fakeHost } from '../helpers/fake-host'

test('ciState', () => {
  expect(ciState([])).toBe('none')
  expect(ciState([{ status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('ok')
  expect(ciState([{ status: 'IN_PROGRESS', conclusion: null }, { status: 'COMPLETED', conclusion: 'SUCCESS' }])).toBe('pending')
  expect(ciState([{ status: 'COMPLETED', conclusion: 'FAILURE' }, { status: 'IN_PROGRESS', conclusion: null }])).toBe('failing')
  expect(ciState([{ state: 'SUCCESS' }])).toBe('ok')
})

test('myOpenPrs asks for my open PRs with the useful fields', async () => {
  const { host, calls } = fakeHost([[/^gh pr list/, { stdout: '[]' }]])
  await myOpenPrs(host, {}, 'acme/x')
  expect(calls[0].line).toContain('--author @me --state open')
  expect(calls[0].line).toContain('--json number,title,url,state,headRefName,headRefOid,baseRefName,mergeCommit,mergedAt,reviewDecision,statusCheckRollup,isDraft,mergeable,mergeStateStatus')
})

test('prDetail includes the files', async () => {
  const pr = { number: 3, state: 'MERGED', files: [{ path: 'ec2/a' }] }
  const { host } = fakeHost([[/^gh pr view 3/, { stdout: JSON.stringify(pr) }]])
  expect((await prDetail(host, {}, 'acme/web', 3)).files).toEqual([{ path: 'ec2/a' }])
})

test('commitRuns', async () => {
  const runs = [{ name: 'deploy-production', status: 'completed', conclusion: 'success', url: 'u' }]
  const { host, calls } = fakeHost([[/^gh run list/, { stdout: JSON.stringify(runs) }]])
  expect(await commitRuns(host, {}, 'acme/api', 'abc')).toEqual(runs)
  expect(calls[0].line).toContain('--commit abc')
})

const PR: GhPr = {
  number: 3, title: 'feat: x', url: 'https://github.com/o/r/pull/3', state: 'OPEN', headRefName: 'feat/x', headRefOid: 'abc',
  baseRefName: 'main', mergeCommit: null, mergedAt: null, reviewDecision: '', statusCheckRollup: [],
  isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN',
}

test('summarizePr: review, draft, conflict, behind, failing checks', () => {
  expect(summarizePr(PR)).toEqual({
    number: 3, title: 'feat: x', url: 'https://github.com/o/r/pull/3', branch: 'feat/x', path: null, head: 'abc',
    ci: 'none', failedChecks: [], review: 'none', draft: false, conflict: false, behind: false, unpushed: 0,
  })
  expect(summarizePr({ ...PR, reviewDecision: 'APPROVED' }).review).toBe('approved')
  expect(summarizePr({ ...PR, reviewDecision: 'CHANGES_REQUESTED' }).review).toBe('changes')
  expect(summarizePr({ ...PR, reviewDecision: 'REVIEW_REQUIRED' }).review).toBe('pending')
  expect(summarizePr({ ...PR, reviewDecision: null, isDraft: true }).draft).toBe(true)
  expect(summarizePr({ ...PR, mergeable: 'CONFLICTING', mergeStateStatus: 'DIRTY' }).conflict).toBe(true)
  expect(summarizePr({ ...PR, mergeStateStatus: 'BEHIND' }).behind).toBe(true)
  const r = summarizePr({ ...PR, statusCheckRollup: [
    { name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' },
    { context: 'ci/deploy', state: 'ERROR' },
    { name: 'tests', status: 'COMPLETED', conclusion: 'SUCCESS' },
  ] })
  expect(r.ci).toBe('failing')
  expect(r.failedChecks).toEqual(['lint', 'ci/deploy'])
})
