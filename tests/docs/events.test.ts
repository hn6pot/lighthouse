import { expect, test } from 'claude-code/testing'
import { applyDocEvents, resolveDoc } from '../../hooks/docs/events'
import { loadConversation, loadPublish } from '../../hooks/docs/records'
import type { Repo } from '../../hooks/model'
import { fakeHost, type Answer } from '../helpers/fake-host'

const TAGGED = '<title>A</title><meta name="lighthouse-source" content="acme/api:docs/specs/a.md">'

// /r/api is acme/api, with a worktree /r/api/.worktrees/a on feat/a; /r/web is acme/web, unknown to the session.
const tree = (folder: string) =>
  folder.startsWith('/r/api/.worktrees/a') ? '/r/api/.worktrees/a' : folder.startsWith('/r/api') ? '/r/api' : folder.startsWith('/r/web') ? '/r/web' : null
const GIT: [RegExp, Answer][] = [
  [/rev-parse --show-toplevel/, argv => (tree(argv[2]) ? { stdout: `${tree(argv[2])}\n` } : { exitCode: 128 })],
  [/--git-common-dir/, argv => (tree(argv[2]) ? { stdout: `${tree(argv[2])?.startsWith('/r/web') ? '/r/web' : '/r/api'}/.git\n` } : { exitCode: 128 })],
  [/^git -C \/r\/api remote get-url origin/, { stdout: 'https://github.com/acme/api.git\n' }],
  [/^git -C \/r\/web remote get-url origin/, { stdout: 'git@github.com:acme/web.git\n' }],
  [/^git -C \/r\/api\/\.worktrees\/a branch --show-current/, { stdout: 'feat/a\n' }],
  [/^git -C \/r\/api branch --show-current/, { stdout: 'main\n' }],
  [/^git hash-object -- \/r\/api\/\.worktrees\/a\/docs\/specs\/a\.md/, { stdout: 'blob-wt\n' }],
  [/^git hash-object -- \/r\/api\/docs\/specs\/a\.md/, { stdout: 'blob-main\n' }],
  [/^mkdir -p/, {}],
  [/^cp /, {}],
]
const API: Repo = { root: '/r/api', slug: 'acme/api', trees: ['/r/api', '/r/api/.worktrees/a'] }

test('a spec written then code in a worktree: the spec is linked to that branch', async () => {
  const { host, store } = fakeHost(GIT)
  await applyDocEvents(host, store, 's1', [API], [
    { kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 },
    { kind: 'write', path: '/r/api/.worktrees/a/src/x.ts', at: 2 },
  ])
  expect((await loadConversation(store, 's1')).links).toEqual([{ doc: 'acme/api:docs/specs/a.md', root: '/r/api', branch: 'feat/a', at: 2 }])
})

test('a git commit links like a code write', async () => {
  const { host, store } = fakeHost(GIT)
  await applyDocEvents(host, store, 's1', [API], [
    { kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 },
    { kind: 'commit', folder: '/r/api/.worktrees/a', at: 2 },
  ])
  expect((await loadConversation(store, 's1')).links.map(l => l.branch)).toEqual(['feat/a'])
})

test('a write outside any repo or under ~/.lighthouse links nothing', async () => {
  const { host, store } = fakeHost(GIT)
  await applyDocEvents(host, store, 's1', [API], [
    { kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 },
    { kind: 'write', path: '/tmp/s/page.html', at: 2 },
    { kind: 'write', path: '/Users/me/.lighthouse/docs/x.json', at: 3 },
  ])
  expect((await loadConversation(store, 's1')).links).toEqual([])
})

test('a tagged publish: page recorded with the Markdown hash, page copied', async () => {
  const { host, store, calls } = fakeHost(GIT, { '/tmp/s/spec.html': TAGGED })
  await applyDocEvents(host, store, 's1', [API], [{ kind: 'publish', html: '/tmp/s/spec.html', url: 'https://claude.ai/artifact/x', at: 3 }])
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toEqual({ url: 'https://claude.ai/artifact/x', at: 3, hash: 'blob-wt', session: 's1' })
  expect(calls.map(c => c.line)).toContain('cp /tmp/s/spec.html /Users/me/.lighthouse/pages/acme/api/docs/specs/a.html')
  expect((await loadConversation(store, 's1')).active).toEqual(['acme/api:docs/specs/a.md'])
})

test('a publish naming a repo the session does not know: recorded and copied, hash null', async () => {
  const html = '<meta name="lighthouse-source" content="acme/web:docs/plans/b.md">'
  const { host, store, calls } = fakeHost(GIT, { '/tmp/s/b.html': html })
  await applyDocEvents(host, store, 's1', [API], [{ kind: 'publish', html: '/tmp/s/b.html', url: 'https://claude.ai/artifact/y', at: 3 }])
  expect((await loadPublish(store, 'acme/web:docs/plans/b.md'))?.hash).toBe(null)
  expect(calls.map(c => c.line)).toContain('cp /tmp/s/b.html /Users/me/.lighthouse/pages/acme/web/docs/plans/b.html')
})

test('a publish without the tag records and copies nothing', async () => {
  const { host, store, calls } = fakeHost(GIT, { '/tmp/s/spec.html': '<title>A</title>' })
  await applyDocEvents(host, store, 's1', [API], [{ kind: 'publish', html: '/tmp/s/spec.html', url: 'https://claude.ai/artifact/x', at: 3 }])
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toBe(null)
  expect(calls.some(c => c.line.startsWith('cp '))).toBe(false)
})

test('a document outside any repo is identified by its ~ path; a non-document is not one', async () => {
  const { host } = fakeHost(GIT)
  expect(await resolveDoc(host, '/Users/me/out/acme/docs/specs/z.md')).toBe('~/out/acme/docs/specs/z.md')
  expect(await resolveDoc(host, '/r/api/.worktrees/a/docs/plans/a.md')).toBe('acme/api:docs/plans/a.md')
  expect(await resolveDoc(host, '/r/api/src/x.ts')).toBe(null)
})
