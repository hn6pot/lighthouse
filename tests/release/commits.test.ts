import { expect, test } from 'claude-code/testing'
import { classify, parseLog } from '../../hooks/release/commits'

const record = (sha: string, subject: string, body = '') => `${sha}\x1f${subject}\x1f${body}\x1e\n`

test('parses a squash commit', () => {
  expect(parseLog(record('a1', "feat(desktop): le Halo s'ouvre (#59)"))).toEqual([{ sha: 'a1', number: 59, title: "le Halo s'ouvre", kind: 'feat' }])
})

test('parses a GitHub merge commit from its body', () => {
  expect(parseLog(record('b2', 'Merge pull request #12 from acme/fix-x', 'fix(api): handle empty list\n\nmore'))).toEqual([
    { sha: 'b2', number: 12, title: 'handle empty list', kind: 'fix' },
  ])
})

test('a commit without PR', () => {
  expect(parseLog(record('c3', 'chore: bump deps'))).toEqual([{ sha: 'c3', number: null, title: 'bump deps', kind: 'other' }])
})

test('several records, in the order git gives them', () => {
  const entries = parseLog(record('a1', 'fix: one (#2)') + record('b2', 'feat: two (#3)'))
  expect(entries.map(e => e.sha)).toEqual(['a1', 'b2'])
})

test('an empty log has no entries', () => {
  expect(parseLog('')).toEqual([])
})

test('classify reads the Conventional Commit type, case-sensitive', () => {
  expect(classify('fix!: x')).toBe('fix')
  expect(classify('feat(ui): x')).toBe('feat')
  expect(classify('Feat: x')).toBe('other')
  expect(classify('refactor(ui): x')).toBe('other')
  expect(classify('feature: not a type')).toBe('other')
  expect(classify('no type at all')).toBe('other')
})
