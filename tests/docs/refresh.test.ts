import { expect, test } from 'claude-code/testing'
import { DOCS_MS, docsOf, refreshDocs, type DocsContext } from '../../hooks/docs/refresh'
import { implementedBy, loadSnapshot, saveSnapshot } from '../../hooks/docs/records'
import type { LocalBranch, PrSummary, TreeState, Tracked } from '../../hooks/model'
import { fakeHost } from '../helpers/fake-host'

const branch = (name: string): LocalBranch => ({ name, path: `/r/.worktrees/${name}`, remote: 'none', unpushed: 0, ahead: 1 })
const tree = (o: Partial<TreeState> = {}): TreeState => ({ root: '/r', name: 'api', slug: 'acme/api', branch: 'main', base: 'main', behind: 0, uncommitted: 0, prs: [], branches: [branch('feat/a')], ...o })
const docsCtx = (): DocsContext => ({ store: fakeHost([]).store, events: [], byBranch: new Map() })
const world = () => fakeHost([[/diff --name-only --diff-filter=d origin\/main\.\.\.feat\/a/, { stdout: 'docs/specs/a.md\nsrc/x.ts\n' }]])

test('the first pass computes each branch’s documents', async () => {
  const { host } = world()
  const docs = docsCtx()
  await refreshDocs(host, docs, 's1', [], [tree()], [], 0)
  expect(docsOf(docs, '/r', 'feat/a').map(d => d.id)).toEqual(['acme/api:docs/specs/a.md'])
  expect(docsOf(docs, '/r', 'feat/z')).toEqual([])
  expect(docsOf(undefined, '/r', 'feat/a')).toEqual([])
})

test('no event and less than 30 s since the last pass: nothing recomputed', async () => {
  const { host, calls } = world()
  const docs = { ...docsCtx(), at: 0 }
  await refreshDocs(host, docs, 's1', [], [tree()], [], DOCS_MS - 1)
  expect(calls.some(c => c.line.includes('diff --name-only'))).toBe(false)
})

test('an event forces a pass at the next tick, and the events are drained', async () => {
  const { host, calls } = world()
  const docs: DocsContext = { ...docsCtx(), at: 0, events: [{ kind: 'write', path: '/tmp/x.txt', at: 1 }] }
  await refreshDocs(host, docs, 's1', [], [tree()], [], 1)
  expect(docs.events).toEqual([])
  expect(calls.some(c => c.line.includes('diff --name-only'))).toBe(true)
})

test('a PR pushed under another name: its snapshot is also kept under the PR’s branch', async () => {
  const { host } = world()
  const docs = docsCtx()
  const pr = { number: 4, branch: 'feat/a-remote', localBranch: 'feat/a', path: '/r/.worktrees/feat/a' } as PrSummary
  await refreshDocs(host, docs, 's1', [], [tree({ prs: [pr], branches: [branch('feat/a')] })], [], 0)
  expect((await loadSnapshot(docs.store, '/r', 'feat/a-remote'))?.docs).toEqual(['acme/api:docs/specs/a.md'])
})

test('a merged PR marks the documents of its branch implemented', async () => {
  const { host } = world()
  const docs = docsCtx()
  await saveSnapshot(docs.store, '/r', 'feat/m', { docs: ['acme/api:docs/specs/m.md'], code: true, at: 0 })
  const merged: Tracked = { key: 'acme/api#9', slug: 'acme/api', root: '/r', number: 9, branch: 'feat/m', base: 'main', stage: 'merged', updatedAt: 0 }
  await refreshDocs(host, docs, 's1', [], [tree({ branches: [] })], [merged], 0)
  expect(await implementedBy(docs.store, 'acme/api:docs/specs/m.md')).toEqual(['acme/api#9'])
})
