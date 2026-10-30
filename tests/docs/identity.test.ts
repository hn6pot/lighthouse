import { expect, test } from 'claude-code/testing'
import { copyPath, docKind, docName, localDocId, parseDocId, repoDocId } from '../../hooks/docs/identity'

test('docKind: .md under specs or plans, nearest folder wins', () => {
  expect(docKind('docs/specs/2026-10-17-x-design.md')).toBe('spec')
  expect(docKind('/r/docs/superpowers/plans/y.md')).toBe('plan')
  expect(docKind('specs/old/plans/z.md')).toBe('plan')
  expect(docKind('docs/specs/notes.txt')).toBe(null)
  expect(docKind('docs/specs.md')).toBe(null)
  expect(docKind('src/plans.ts')).toBe(null)
})

test('docName drops the date, .md and a trailing -design or -plan', () => {
  expect(docName('docs/specs/2026-10-22-release-pane-design.md')).toBe('release-pane')
  expect(docName('docs/plans/2026-10-17-intent-plan.md')).toBe('intent')
  expect(docName('specs/rate-limiting.md')).toBe('rate-limiting')
})

test('identities: owner/repo:path in a repo, ~/… outside', () => {
  expect(repoDocId('acme/api', 'docs/specs/a.md')).toBe('acme/api:docs/specs/a.md')
  expect(localDocId('/Users/me/out/acme/docs/specs/b.md', '/Users/me')).toBe('~/out/acme/docs/specs/b.md')
  expect(localDocId('/srv/docs/specs/c.md', '/Users/me')).toBe('/srv/docs/specs/c.md')
})

test('parseDocId accepts the two forms, refuses the rest', () => {
  expect(parseDocId('acme/api:docs/specs/a.md')).toEqual({ slug: 'acme/api', rel: 'docs/specs/a.md' })
  expect(parseDocId('~/out/docs/plans/b.md')).toEqual({ path: '~/out/docs/plans/b.md' })
  expect(parseDocId('acme:docs/specs/a.md')).toBe(null)
  expect(parseDocId('acme/api:../etc/specs/a.md')).toBe(null)
  expect(parseDocId('acme/api:docs/a.md')).toBe(null) // not a doc path
})

test('copyPath: under ~/.lighthouse/pages, .md becomes .html', () => {
  expect(copyPath('acme/api:docs/specs/a.md', '/Users/me')).toBe('/Users/me/.lighthouse/pages/acme/api/docs/specs/a.html')
  expect(copyPath('~/out/docs/plans/b.md', '/Users/me')).toBe('/Users/me/.lighthouse/pages/local/out/docs/plans/b.html')
  expect(copyPath('/srv/docs/specs/c.md', '/Users/me')).toBe('/Users/me/.lighthouse/pages/local/srv/docs/specs/c.html')
})
