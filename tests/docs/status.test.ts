import { expect, test } from 'claude-code/testing'
import { planState, specState } from '../../hooks/docs/status'

test('spec: draft, approved once cited, implemented once every citing plan is', () => {
  expect(specState({ citing: 0, citingDone: 0, done: false })).toBe('draft')
  expect(specState({ citing: 2, citingDone: 1, done: false })).toBe('approved')
  expect(specState({ citing: 2, citingDone: 2, done: false })).toBe('implemented')
  expect(specState({ citing: 0, citingDone: 0, done: true })).toBe('implemented')
})

test('a spec with a plan still to do stays approved even if a PR marked it', () => {
  expect(specState({ citing: 1, citingDone: 0, done: true })).toBe('approved')
})

test('plan: draft, in progress after code, implemented once merged', () => {
  expect(planState({ codeAfter: false, done: false })).toBe('draft')
  expect(planState({ codeAfter: true, done: false })).toBe('in-progress')
  expect(planState({ codeAfter: true, done: true })).toBe('implemented')
})
