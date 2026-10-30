import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { BranchDoc } from '../../hooks/model'
import { docLabel, docOpener, docSummary, isOpenable } from '../../hooks/ui/doc-lines'

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

const doc = (o: Partial<BranchDoc>): BranchDoc => ({ id: 'acme/api:docs/specs/a.md', kind: 'spec', name: 'a', state: 'approved', file: null, stale: false, ...o })

test('docSummary: the first spec that has a page leads, the rest only counts', () => {
  const spec = doc({ page: 'https://claude.ai/artifact/s' })
  const plan = doc({ id: 'acme/api:docs/plans/a.md', kind: 'plan', page: 'https://claude.ai/artifact/p' })
  expect(docSummary([doc({ id: 'acme/api:docs/specs/z.md' }), spec, plan])).toEqual({ lead: spec, count: 3 })
  expect(docSummary([plan])).toEqual({ lead: null, count: 1 })
})

test('the folded line names the spec page and the count, in both languages', () => {
  expect(texts('en').doc.specPage).toBe('Spec ↗')
  expect(texts('en').doc.toggle(3, false)).toBe('▶ Docs (3)')
  expect(texts('fr').doc.toggle(2, true)).toBe('▼ Docs (2)')
})

test('docOpener: one button per line, the page first, else the local copy, else the Markdown', () => {
  expect(docOpener(doc({ page: 'https://claude.ai/artifact/s', copy: '/c/a.html', file: '/r/a.md' }))).toEqual({ kind: 'page', target: 'https://claude.ai/artifact/s' })
  expect(docOpener(doc({ copy: '/c/a.html', file: '/r/a.md' }))).toEqual({ kind: 'copy', target: '/c/a.html' })
  expect(docOpener(doc({ file: '/r/a.md' }))).toEqual({ kind: 'markdown', target: '/r/a.md' })
  expect(docOpener(doc({}))).toBe(null)
})
