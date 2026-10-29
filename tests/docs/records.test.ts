import { expect, test } from 'claude-code/testing'
import { allLinks, docsStore, implementedBy, loadConversation, loadPublish, loadSnapshot, markImplemented, saveConversation, savePublish, saveSnapshot } from '../../hooks/docs/records'
import { EMPTY_CONVERSATION } from '../../hooks/docs/conversation'
import { fakeHost } from '../helpers/fake-host'

test('a publish record round-trips; a malformed one reads as null', async () => {
  const { store } = fakeHost([])
  await savePublish(store, 'acme/api:docs/specs/a.md', { url: 'https://claude.ai/artifact/x', at: 5, hash: 'abc', session: 's1' })
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toEqual({ url: 'https://claude.ai/artifact/x', at: 5, hash: 'abc', session: 's1' })
  await store.set('pub:acme/api:docs/specs/b.md', { url: 3 })
  expect(await loadPublish(store, 'acme/api:docs/specs/b.md')).toBe(null)
})

test('a missing or malformed conversation reads as empty', async () => {
  const { store } = fakeHost([])
  expect(await loadConversation(store, 's1')).toEqual(EMPTY_CONVERSATION)
  await store.set('conv:s2', { active: 'x' })
  expect(await loadConversation(store, 's2')).toEqual(EMPTY_CONVERSATION)
})

test('allLinks gathers the links of every conversation', async () => {
  const { store } = fakeHost([])
  await saveConversation(store, 's1', { active: [], specs: [], links: [{ doc: 'S:a', root: '/r', branch: 'feat/a', at: 1 }] })
  await saveConversation(store, 's2', { active: [], specs: [], links: [{ doc: 'S:b', root: '/r', branch: 'feat/b', at: 2 }] })
  await savePublish(store, 'S:c', { url: 'u', at: 1, hash: null, session: 's1' })
  expect((await allLinks(store)).map(l => l.doc).sort()).toEqual(['S:a', 'S:b'])
})

test('a branch snapshot round-trips', async () => {
  const { store } = fakeHost([])
  expect(await loadSnapshot(store, '/r', 'feat/a')).toBe(null)
  await saveSnapshot(store, '/r', 'feat/a', { docs: ['S:a'], code: true, at: 3 })
  expect(await loadSnapshot(store, '/r', 'feat/a')).toEqual({ docs: ['S:a'], code: true, at: 3 })
})

test('markImplemented keeps each PR once', async () => {
  const { store } = fakeHost([])
  await markImplemented(store, 'S:a', 'acme/api#4')
  await markImplemented(store, 'S:a', 'acme/api#4')
  expect(await implementedBy(store, 'S:a')).toEqual(['acme/api#4'])
  expect(await implementedBy(store, 'S:b')).toEqual([])
})

test('docsStore keeps its files in ~/.lighthouse/docs', async () => {
  const { host, calls } = fakeHost([[/^mkdir/, {}], [/^mv/, {}]])
  await docsStore(host).set('pub:x', 1)
  expect(calls[0].line).toBe('mkdir -p /Users/me/.lighthouse/docs')
})
