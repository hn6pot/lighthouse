import { expect, test } from 'claude-code/testing'
import { baseSpecs, blobHash, codeAfterPlan, docHash, fileHash, plansCitingOnBase, touchedDocs } from '../../hooks/docs/git-docs'
import { fakeHost } from '../helpers/fake-host'

test('touchedDocs: added or modified docs, uncommitted ones, and whether code moved', async () => {
  const { host } = fakeHost([
    [/diff --name-only --diff-filter=d origin\/main\.\.\.feat\/a/, { stdout: 'docs/specs/a.md\nsrc/x.ts\n' }],
    [/status --porcelain --untracked-files=all/, { stdout: '?? docs/plans/a.md\n M docs/specs/a.md\n' }],
  ])
  expect(await touchedDocs(host, '/r', 'main', 'feat/a', '/r/.worktrees/a')).toEqual({ docs: ['docs/specs/a.md', 'docs/plans/a.md'], code: true })
})

test('touchedDocs: a docs-only branch has no code; deletions are left out of the diff', async () => {
  const { host, calls } = fakeHost([[/diff --name-only/, { stdout: 'docs/specs/a.md\n' }]])
  expect(await touchedDocs(host, '/r', 'main', 'docs/a', null)).toEqual({ docs: ['docs/specs/a.md'], code: false })
  expect(calls[0].line).toBe('git -C /r diff --name-only --diff-filter=d origin/main...docs/a')
})

test('touchedDocs: uncommitted code in the worktree counts as code; a renamed doc keeps its new path', async () => {
  const { host } = fakeHost([
    [/diff --name-only/, { stdout: '' }],
    [/status --porcelain/, { stdout: 'R  docs/specs/old.md -> docs/specs/new.md\n M src/y.ts\n' }],
  ])
  expect(await touchedDocs(host, '/r', 'main', 'feat/a', '/r/.worktrees/a')).toEqual({ docs: ['docs/specs/new.md'], code: true })
})

test('touchedDocs: git failing gives nothing', async () => {
  const { host } = fakeHost([])
  expect(await touchedDocs(host, '/r', 'main', 'feat/a', '/r/.worktrees/a')).toEqual({ docs: [], code: false })
})

test('baseSpecs lists the specs on the base', async () => {
  const { host } = fakeHost([[/ls-tree -r --name-only origin\/main/, { stdout: 'README.md\ndocs/specs/a.md\ndocs/plans/a.md\n' }]])
  expect(await baseSpecs(host, '/r', 'main')).toEqual(['docs/specs/a.md'])
})

test('plansCitingOnBase strips the ref prefix and keeps plans only', async () => {
  const { host, calls } = fakeHost([[/grep -l -F/, { stdout: 'origin/main:docs/plans/a.md\norigin/main:docs/plans/b.md\n' }]])
  expect(await plansCitingOnBase(host, '/r', 'main', '2026-10-01-a-design.md')).toEqual(['docs/plans/a.md', 'docs/plans/b.md'])
  expect(calls[0].line).toBe("git -C /r grep -l -F 2026-10-01-a-design.md origin/main -- *plans/*.md")
})

test('codeAfterPlan: true with a code commit after the plan, false with only docs, null when the plan is not committed', async () => {
  const committed = (after: string) =>
    fakeHost([
      [/log -1 --format=%H feat\/a -- docs\/plans\/a\.md/, { stdout: 'c1\n' }],
      [/diff --name-only c1 feat\/a/, { stdout: after }],
    ]).host
  expect(await codeAfterPlan(committed('src/x.ts\n'), '/r', 'feat/a', 'docs/plans/a.md')).toBe(true)
  expect(await codeAfterPlan(committed('docs/specs/a.md\n'), '/r', 'feat/a', 'docs/plans/a.md')).toBe(false)
  const { host } = fakeHost([[/log -1/, { stdout: '' }]])
  expect(await codeAfterPlan(host, '/r', 'feat/a', 'docs/plans/a.md')).toBe(null)
})

test('docHash: worktree file first, committed blob without a worktree', async () => {
  const { host } = fakeHost([
    [/^git hash-object -- \/r\/\.worktrees\/a\/docs\/specs\/a\.md/, { stdout: 'blob-wt\n' }],
    [/rev-parse feat\/a:docs\/specs\/a\.md/, { stdout: 'blob-committed\n' }],
  ])
  expect(await docHash(host, '/r', 'feat/a', '/r/.worktrees/a', 'docs/specs/a.md')).toBe('blob-wt')
  expect(await docHash(host, '/r', 'feat/a', null, 'docs/specs/a.md')).toBe('blob-committed')
})

test('fileHash: null when git cannot read the file', async () => {
  const { host } = fakeHost([])
  expect(await fileHash(host, '/nowhere/docs/specs/a.md')).toBe(null)
})

test('blobHash gives git’s blob hash of a text, without git', async () => {
  expect(await blobHash('hello\n')).toBe('ce013625030ba8dba906f756967f9e9ca394464a')
  expect(await blobHash('é\n')).toBe('c6003325155f475bd7c87731607525dce73be9cf') // counted in bytes, not characters
})
