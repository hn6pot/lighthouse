import { expect, test } from 'claude-code/testing'
import { afterPoll, forget, isFinished, loadTracked, moveTo, openTracked, save } from '../../hooks/flow/state'
import type { GhPr } from '../../hooks/github/prs'
import { fakeHost } from '../helpers/fake-host'

const pr = (fields: Partial<GhPr>): GhPr => ({
  number: 7, title: 't', state: 'OPEN', headRefName: 'feat/x', headRefOid: 'tip', baseRefName: 'production',
  mergeCommit: null, mergedAt: null, reviewDecision: null, statusCheckRollup: [],
  url: 'u', isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', ...fields,
})

test('an open PR becomes an "open" tracked PR', () => {
  expect(openTracked('acme/x', '/r', pr({}), 5)).toMatchObject({
    key: 'acme/x#7', stage: 'open', branch: 'feat/x', base: 'production', updatedAt: 5,
  })
})

test('merge: merged, with merge commit and PR head', () => {
  const s = openTracked('acme/x', '/r', pr({}), 0)
  const after = afterPoll(s, pr({ state: 'MERGED', mergeCommit: { oid: 'm' }, headRefOid: 't2' }), 10)
  expect(after).toMatchObject({ stage: 'merged', mergeCommit: 'm', prHead: 't2', mergedAt: 10 })
})

test('closed without merge: null, the PR is forgotten', () => {
  const s = openTracked('acme/x', '/r', pr({}), 0)
  expect(afterPoll(s, pr({ state: 'CLOSED' }), 10)).toBeNull()
})

test('still open: the PR head follows new commits', () => {
  const s = openTracked('acme/x', '/r', pr({}), 0)
  expect(afterPoll(s, pr({ headRefOid: 'new' }), 10)).toMatchObject({ stage: 'open', prHead: 'new' })
})

test('moveTo keeps the fields and sets the extras', () => {
  const s = openTracked('acme/x', '/r', pr({}), 0)
  expect(moveTo(s, 'deploy-doubt', 3, { reason: 'r' })).toMatchObject({ stage: 'deploy-doubt', reason: 'r', updatedAt: 3, number: 7 })
})

test('isFinished: cleaned and failed', () => {
  const s = openTracked('acme/x', '/r', pr({}), 0)
  expect(isFinished(moveTo(s, 'cleaned', 1))).toBe(true)
  expect(isFinished(moveTo(s, 'failed', 1))).toBe(true)
  expect(isFinished(s)).toBe(false)
})

test('persistence: one key per PR in the shared store', async () => {
  const { host } = fakeHost([])
  const s = openTracked('acme/x', '/r', pr({}), 0)
  await save(host.store, s)
  expect(await host.store.keys()).toEqual(['tracked:acme/x#7'])
  expect(await loadTracked(host.store)).toEqual([s])
  await forget(host.store, s.key)
  expect(await loadTracked(host.store)).toEqual([])
})
