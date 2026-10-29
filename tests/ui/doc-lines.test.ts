import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { BranchDoc } from '../../hooks/model'
import { docLabel, isOpenable } from '../../hooks/ui/doc-lines'

test('docLabel names the kind, the name and the state, in both languages', () => {
  const d: BranchDoc = { id: 'acme/api:docs/specs/a.md', kind: 'spec', name: 'rate-limiting', state: 'approved', file: null, stale: false }
  expect(docLabel(d, texts('en'))).toBe('▤ Spec rate-limiting · approved')
  expect(docLabel({ ...d, kind: 'plan', state: 'in-progress' }, texts('fr'))).toBe('▤ Plan rate-limiting · en cours')
  expect(docLabel(d, texts('fr'))).toBe('▤ Spec rate-limiting · approuvée')
  expect(docLabel({ ...d, kind: 'plan', state: 'implemented' }, texts('fr'))).toBe('▤ Plan rate-limiting · implémenté')
  expect(docLabel({ ...d, state: 'in-progress' }, texts('en'))).toBe('▤ Spec rate-limiting · in progress')
})

test('only an absolute Markdown or HTML path is opened', () => {
  expect(isOpenable('/Users/me/.lighthouse/pages/acme/api/docs/specs/a.html')).toBe(true)
  expect(isOpenable('/r/docs/specs/a.md')).toBe(true)
  expect(isOpenable('docs/specs/a.md')).toBe(false)
  expect(isOpenable('/Applications/Calculator.app')).toBe(false)
  expect(isOpenable('/r/a.md\n/b.app')).toBe(false)
})
