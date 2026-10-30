import { expect, test } from 'claude-code/testing'
import { branchDocs, markMerged, type BranchRef } from '../../hooks/docs/collect'
import { implementedBy, loadSnapshot, markImplemented, savePublish, saveSnapshot } from '../../hooks/docs/records'
import type { Tracked } from '../../hooks/model'
import { fakeHost, type Answer } from '../helpers/fake-host'

const WT = '/r/.worktrees/a'
const SPEC = 'docs/specs/2026-10-01-a-design.md'
const PLAN = 'docs/plans/2026-10-01-a.md'
const SPEC_ID = `acme/api:${SPEC}`
const PLAN_ID = `acme/api:${PLAN}`
const COPY = '/Users/me/.lighthouse/pages/acme/api/docs/specs/2026-10-01-a-design.html'
const REF: BranchRef = { root: '/r', slug: 'acme/api', base: 'main', branch: 'feat/a', path: WT }

/** A repo /r (acme/api) with a worktree on feat/a; `diff` is what the branch changed against main. */
function world(o: { diff?: string; status?: string; hashes?: Record<string, string>; files?: Record<string, string>; extra?: [RegExp, Answer][] } = {}) {
  const hashes = o.hashes ?? {}
  return fakeHost(
    [
      ...(o.extra ?? []),
      [/diff --name-only --diff-filter=d origin\/main\.\.\./, { stdout: o.diff ?? '' }],
      [/status --porcelain/, { stdout: o.status ?? '' }],
      [/ls-tree -r --name-only/, { stdout: '' }],
      [/grep -l -F/, { exitCode: 1 }],
      [/^git hash-object -- /, argv => (hashes[argv[3]] ? { stdout: `${hashes[argv[3]]}\n` } : { exitCode: 128 })],
    ],
    o.files ?? {},
  )
}

const BOTH = {
  diff: `${SPEC}\n${PLAN}\nsrc/x.ts\n`,
  hashes: { [`${WT}/${SPEC}`]: 'h-spec', [`${WT}/${PLAN}`]: 'h-plan' },
  files: { [`${WT}/${SPEC}`]: '# A', [`${WT}/${PLAN}`]: `**Spec:** \`${SPEC}\``, [COPY]: '<html>' },
  extra: [
    [/log -1 --format=%H feat\/a -- docs\/plans/, { stdout: 'c1\n' }],
    [/diff --name-only c1 feat\/a/, { stdout: 'src/x.ts\n' }],
  ] as [RegExp, Answer][],
}

test('a branch with its spec and plan: approved spec, plan in progress, page and copy, not stale', async () => {
  const { host, store } = world(BOTH)
  await savePublish(store, SPEC_ID, { url: 'https://claude.ai/artifact/x', at: 1, hash: 'h-spec', session: 's1' })
  expect(await branchDocs(host, store, REF, [])).toEqual([
    { id: SPEC_ID, kind: 'spec', name: 'a', state: 'approved', file: `${WT}/${SPEC}`, page: 'https://claude.ai/artifact/x', copy: COPY, stale: false },
    { id: PLAN_ID, kind: 'plan', name: 'a', state: 'in-progress', file: `${WT}/${PLAN}`, stale: false },
  ])
  expect(await loadSnapshot(store, '/r', 'feat/a')).toEqual({ docs: [SPEC_ID, PLAN_ID], code: true, at: 0 })
})

test('the Markdown changed since the publish: stale', async () => {
  const { host, store } = world(BOTH)
  await savePublish(store, SPEC_ID, { url: 'https://claude.ai/artifact/x', at: 1, hash: 'h-old', session: 's1' })
  expect((await branchDocs(host, store, REF, [])).find(d => d.id === SPEC_ID)?.stale).toBe(true)
})

test('a publish recorded without a hash never says stale; its copy is offered without reading it', async () => {
  const { [COPY]: _gone, ...files } = BOTH.files
  const { host, store } = world({ ...BOTH, files })
  const read = host.read
  const reads: string[] = []
  host.read = async path => (reads.push(path), read(path))
  await savePublish(store, SPEC_ID, { url: 'https://claude.ai/artifact/x', at: 1, hash: null, session: 's1' })
  const spec = (await branchDocs(host, store, REF, [])).find(d => d.id === SPEC_ID)
  expect(spec?.stale).toBe(false)
  expect(spec?.copy).toBe(COPY)
  expect(reads).not.toContain(COPY) // a page copy may weigh megabytes: never read each pass
})

test('a spec only linked by the conversation (written on main before the worktree) shows on the branch', async () => {
  const B = 'docs/specs/2026-10-02-b-design.md'
  const { host, store } = world({ files: { [`/r/${B}`]: '# B' }, hashes: { [`/r/${B}`]: 'h-b' } })
  const links = [
    { doc: `acme/api:${B}`, root: '/r', branch: 'feat/a', at: 1 },
    { doc: 'acme/api:docs/specs/other.md', root: '/r', branch: 'feat/z', at: 1 },
    { doc: 'acme/web:docs/specs/w.md', root: '/r', branch: 'feat/a', at: 1 },
  ]
  expect(await branchDocs(host, store, REF, links)).toEqual([{ id: `acme/api:${B}`, kind: 'spec', name: 'b', state: 'draft', file: `/r/${B}`, stale: false }])
})

test('a spec merged earlier on main, cited by the branch plan by file name, shows on the branch', async () => {
  const C = 'docs/specs/2026-09-01-c-design.md'
  const { host, store } = world({
    diff: `${PLAN}\n`,
    files: { [`${WT}/${PLAN}`]: 'Implements 2026-09-01-c-design.md.', [`${WT}/${C}`]: '# C' },
    extra: [[/ls-tree -r --name-only/, { stdout: `${C}\nREADME.md\n` }]],
  })
  const docs = await branchDocs(host, store, REF, [])
  expect(docs.map(d => [d.id, d.state])).toEqual([
    [`acme/api:${C}`, 'approved'],
    [PLAN_ID, 'draft'],
  ])
})

test('a spec cited by a plan on main that is implemented, and by none left: implemented', async () => {
  const { host, store } = world({
    diff: `${SPEC}\n`,
    files: { [`${WT}/${SPEC}`]: '# A' },
    extra: [[/grep -l -F 2026-10-01-a-design\.md origin\/main/, { stdout: `origin/main:${PLAN}\n` }]],
  })
  await markImplemented(store, PLAN_ID, 'acme/api#3')
  expect((await branchDocs(host, store, REF, []))[0]?.state).toBe('implemented')
})

test('a branch without a worktree: hash from the branch, no file when main lacks it', async () => {
  const { host, store } = world({ diff: `${SPEC}\n`, extra: [[/rev-parse feat\/a:docs\/specs/, { stdout: 'blob-b\n' }]] })
  await savePublish(store, SPEC_ID, { url: 'https://claude.ai/artifact/x', at: 1, hash: 'blob-b', session: 's1' })
  expect(await branchDocs(host, store, { ...REF, path: null }, [])).toEqual([
    { id: SPEC_ID, kind: 'spec', name: 'a', state: 'draft', file: null, page: 'https://claude.ai/artifact/x', copy: COPY, stale: false },
  ])
})

test('a document outside any repo, linked by the conversation, uses its own path', async () => {
  const LOCAL = '~/out/acme/docs/plans/2026-10-01-z.md'
  const { host, store } = world({ files: { '/Users/me/out/acme/docs/plans/2026-10-01-z.md': 'plan' }, hashes: { '/Users/me/out/acme/docs/plans/2026-10-01-z.md': 'h-z' } })
  const docs = await branchDocs(host, store, REF, [{ doc: LOCAL, root: '/r', branch: 'feat/a', at: 1 }])
  expect(docs).toEqual([{ id: LOCAL, kind: 'plan', name: 'z', state: 'in-progress', file: '/Users/me/out/acme/docs/plans/2026-10-01-z.md', stale: false }])
})

const merged = (branch: string): Tracked => ({ key: 'acme/api#4', slug: 'acme/api', root: '/r', number: 4, branch, base: 'main', stage: 'deployed', updatedAt: 1 })

test('markMerged: a code PR marks its docs implemented; a docs-only PR marks nothing', async () => {
  const { store } = fakeHost([])
  await saveSnapshot(store, '/r', 'feat/a', { docs: [SPEC_ID], code: true, at: 1 })
  await saveSnapshot(store, '/r', 'docs/a', { docs: ['acme/api:docs/specs/b.md'], code: false, at: 1 })
  await markMerged(store, merged('feat/a'))
  await markMerged(store, merged('docs/a'))
  expect(await implementedBy(store, SPEC_ID)).toEqual(['acme/api#4'])
  expect(await implementedBy(store, 'acme/api:docs/specs/b.md')).toEqual([])
})

test('markMerged: an open PR marks nothing', async () => {
  const { store } = fakeHost([])
  await saveSnapshot(store, '/r', 'feat/a', { docs: [SPEC_ID], code: true, at: 1 })
  await markMerged(store, { ...merged('feat/a'), stage: 'open' })
  expect(await implementedBy(store, SPEC_ID)).toEqual([])
})

test('a snapshot only grows: once merged, an empty diff does not erase what the branch had', async () => {
  const { host, store } = world({ diff: '' })
  await saveSnapshot(store, '/r', 'feat/a', { docs: [SPEC_ID], code: true, at: 1 })
  await branchDocs(host, store, REF, [])
  expect(await loadSnapshot(store, '/r', 'feat/a')).toEqual({ docs: [SPEC_ID], code: true, at: 1 })
})

test('the snapshot is written only when what the branch holds changes', async () => {
  const { host, store } = world(BOTH)
  const writes: string[] = []
  const counted = { get: (k: string) => store.get(k), delete: (k: string) => store.delete(k), keys: () => store.keys(), set: async (k: string, v: unknown) => (writes.push(k), store.set(k, v)) }
  await branchDocs(host, counted, REF, [])
  await branchDocs(host, counted, REF, [])
  expect(writes.filter(k => k.startsWith('snap:'))).toHaveLength(1)
})

test('specs on the base given by the caller: no listing of the base tree', async () => {
  const { host, store, calls } = world(BOTH)
  await branchDocs(host, store, { ...REF, specsOnBase: [] }, [])
  expect(calls.some(c => c.line.includes('ls-tree'))).toBe(false)
})
