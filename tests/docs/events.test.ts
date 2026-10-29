import { expect, test } from 'claude-code/testing'
import { applyDocEvents, capturePublish, resolveDoc } from '../../hooks/docs/events'
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
  await applyDocEvents(host, store, 's1', [
    { kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 },
    { kind: 'write', path: '/r/api/.worktrees/a/src/x.ts', at: 2 },
  ])
  expect((await loadConversation(store, 's1')).links).toEqual([{ doc: 'acme/api:docs/specs/a.md', root: '/r/api', branch: 'feat/a', at: 2 }])
})

test('a git commit links like a code write', async () => {
  const { host, store } = fakeHost(GIT)
  await applyDocEvents(host, store, 's1', [
    { kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 },
    { kind: 'commit', folder: '/r/api/.worktrees/a', at: 2 },
  ])
  expect((await loadConversation(store, 's1')).links.map(l => l.branch)).toEqual(['feat/a'])
})

test('a write outside any repo or under ~/.lighthouse links nothing', async () => {
  const { host, store } = fakeHost(GIT)
  await applyDocEvents(host, store, 's1', [
    { kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 },
    { kind: 'write', path: '/tmp/s/page.html', at: 2 },
    { kind: 'write', path: '/Users/me/.lighthouse/docs/x.json', at: 3 },
  ])
  expect((await loadConversation(store, 's1')).links).toEqual([])
})

const PUB = 'https://claude.ai/artifact/x'
const COPY_A = '/Users/me/.lighthouse/pages/acme/api/docs/specs/a.html'

test('a tagged publish: the page and its Markdown hash are taken when it is published, then recorded and copied', async () => {
  const files: Record<string, string> = { '/tmp/s/spec.html': TAGGED, '/r/api/.worktrees/a/docs/specs/a.md': 'hello\n', '/r/api/docs/specs/a.md': 'older\n' }
  const { host, store } = fakeHost(GIT, files)
  const event = await capturePublish(host, '/tmp/s/spec.html', PUB, [API], 3)
  // Edited and rewritten right after the publish: the record keeps what was published.
  files['/r/api/.worktrees/a/docs/specs/a.md'] = 'changed\n'
  files['/tmp/s/spec.html'] = TAGGED + '<p>not published</p>'
  await applyDocEvents(host, store, 's1', event ? [event] : [])
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toEqual({ url: PUB, at: 3, hash: 'ce013625030ba8dba906f756967f9e9ca394464a', session: 's1' })
  expect(files[COPY_A]).toBe(TAGGED)
  expect((await loadConversation(store, 's1')).active).toEqual(['acme/api:docs/specs/a.md'])
})

test('a publish naming a repo the session does not know: recorded and copied, hash null', async () => {
  const html = '<meta name="lighthouse-source" content="acme/web:docs/plans/b.md">'
  const { host, store, files } = fakeHost(GIT, { '/tmp/s/b.html': html })
  const event = await capturePublish(host, '/tmp/s/b.html', 'https://claude.ai/artifact/y', [API], 3)
  await applyDocEvents(host, store, 's1', event ? [event] : [])
  expect((await loadPublish(store, 'acme/web:docs/plans/b.md'))?.hash).toBe(null)
  expect(files['/Users/me/.lighthouse/pages/acme/web/docs/plans/b.html']).toBe(html)
})

test('a publish without the tag gives no event', async () => {
  const { host } = fakeHost(GIT, { '/tmp/s/spec.html': '<title>A</title>' })
  expect(await capturePublish(host, '/tmp/s/spec.html', PUB, [API], 3)).toBe(null)
})

test('a document outside any repo is identified by its ~ path; a non-document is not one', async () => {
  const { host } = fakeHost(GIT)
  expect(await resolveDoc(host, '/Users/me/out/acme/docs/specs/z.md')).toBe('~/out/acme/docs/specs/z.md')
  expect(await resolveDoc(host, '/r/api/.worktrees/a/docs/plans/a.md')).toBe('acme/api:docs/plans/a.md')
  expect(await resolveDoc(host, '/r/api/src/x.ts')).toBe(null)
})
