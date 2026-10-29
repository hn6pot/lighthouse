import { expect, test } from 'claude-code/testing'
import { EMPTY_CONVERSATION, noteCode, noteDoc } from '../../hooks/docs/conversation'

// `S:a` stands for any identity: these functions never parse it.

test('spec A, plan A, code on feat/a: both linked to feat/a', () => {
  let c = noteDoc(noteDoc(EMPTY_CONVERSATION, 'acme/api:docs/specs/a.md', 'spec'), 'acme/api:docs/plans/a.md', 'plan')
  c = noteCode(c, '/r/api', 'feat/a', 1)
  expect(c.links.map(l => [l.doc, l.branch])).toEqual([
    ['acme/api:docs/specs/a.md', 'feat/a'],
    ['acme/api:docs/plans/a.md', 'feat/a'],
  ])
})

test('a new spec stops the link: spec B never goes to feat/a, spec A never to feat/b', () => {
  let c = noteCode(noteDoc(EMPTY_CONVERSATION, 'S:a', 'spec'), '/r', 'feat/a', 1)
  c = noteCode(noteDoc(c, 'S:b', 'spec'), '/r', 'feat/b', 2)
  expect(c.links.filter(l => l.branch === 'feat/b').map(l => l.doc)).toEqual(['S:b'])
  expect(c.links.filter(l => l.branch === 'feat/a').map(l => l.doc)).toEqual(['S:a'])
})

test('code before any document links nothing; repeated code adds no duplicate', () => {
  expect(noteCode(EMPTY_CONVERSATION, '/r', 'feat/a', 1).links).toEqual([])
  const c = noteDoc(EMPTY_CONVERSATION, 'S:a', 'spec')
  expect(noteCode(noteCode(c, '/r', 'feat/a', 1), '/r', 'feat/a', 2).links).toHaveLength(1)
})

test('editing a spec already touched keeps the current work linked too', () => {
  let c = noteDoc(noteDoc(EMPTY_CONVERSATION, 'S:a', 'spec'), 'S:b', 'spec')
  c = noteCode(noteDoc(c, 'S:a', 'spec'), '/r', 'feat/b', 1)
  expect(c.links.map(l => l.doc)).toEqual(['S:b', 'S:a'])
})
