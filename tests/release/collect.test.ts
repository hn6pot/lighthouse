import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { Context } from '../../hooks/loop'
import { collectReleases, RELEASE_FETCH_MS } from '../../hooks/release/collect'
import { runFiles } from '../../hooks/release/run'
import { fakeHost, type Answer } from '../helpers/fake-host'

const t = texts('fr')
const ctx = (): Context => ({
  id: 'me', cwd: '/w', repos: new Map(), lastFetch: new Map(), logins: new Map(), t,
  config: {
    rules: { 'acme/app': { kind: 'release', path: '~/r/app', command: 'make release' }, 'acme/site': { kind: 'immediate' } },
    ghConfigDirs: {},
  },
})
const record = (sha: string, subject: string) => `${sha}\x1f${subject}\x1f\x1e\n`
const GIT: [RegExp, Answer][] = [
  [/symbolic-ref/, { stdout: 'origin/main\n' }],
  [/fetch --quiet origin main/, {}],
  [/for-each-ref --merged origin\/main/, { stdout: 'v0.2.40 100\n' }],
  [/log --first-parent --format=\S+ v0\.2\.40\.\.origin\/main/, { stdout: record('a1', 'fix: one (#2)') }],
  [/log --first-parent/, { stdout: '' }],
]
const notifier = () => {
  const sent: [string, string][] = []
  return { sent, notify: async (key: string, text: string) => void sent.push([key, text]) }
}

test('one repo per release rule, other kinds are ignored', async () => {
  const { host } = fakeHost(GIT)
  const repos = await collectReleases(host, ctx(), notifier().notify)
  expect(repos).toHaveLength(1)
  expect(repos[0]).toMatchObject({ slug: 'acme/app', name: 'app', path: '/Users/me/r/app', base: 'main', tag: 'v0.2.40', next: 'v0.2.41', run: { kind: 'idle' } })
  expect(repos[0].waiting.map(e => e.number)).toEqual([2])
  expect(repos[0].history.map(h => h.tag)).toEqual(['v0.2.40'])
})

test('notifies a done run, keyed by its start', async () => {
  const files = runFiles('/Users/me', 'acme/app')
  const done = JSON.stringify({ pid: 7, startedAt: 900, tagAtLaunch: 'v0.2.39', expected: 'v0.2.40', log: '/l', code: '/c' })
  const { host } = fakeHost(GIT, { [files.record]: done, '/c': '0\n' })
  const n = notifier()
  await collectReleases(host, ctx(), n.notify)
  expect(n.sent).toEqual([['release:acme/app:900', t.notification.releaseOk('App', 'v0.2.40')]])
})

test('fetches at most every RELEASE_FETCH_MS', async () => {
  const { host, calls, state } = fakeHost(GIT)
  const c = ctx()
  await collectReleases(host, c, notifier().notify)
  state.now = RELEASE_FETCH_MS - 1
  await collectReleases(host, c, notifier().notify)
  expect(calls.filter(x => /fetch --quiet/.test(x.line))).toHaveLength(1)
  state.now = RELEASE_FETCH_MS
  await collectReleases(host, c, notifier().notify)
  expect(calls.filter(x => /fetch --quiet/.test(x.line))).toHaveLength(2)
})

test('an unreadable release repo is left out, the others kept', async () => {
  const { host } = fakeHost([[/symbolic-ref/, () => { throw new Error('boom') }]])
  expect(await collectReleases(host, ctx(), notifier().notify)).toEqual([])
})

test('the history is read again only when the tag list changes', async () => {
  let tags = 'v0.2.40 100\n'
  const { host, calls } = fakeHost([[/for-each-ref --merged/, () => ({ stdout: tags })], ...GIT])
  const c = ctx()
  const historyReads = () => calls.filter(x => /log --first-parent --format=\S+ v0\.2\.40$/.test(x.line)).length
  await collectReleases(host, c, notifier().notify)
  await collectReleases(host, c, notifier().notify)
  expect(historyReads()).toBe(1)
  tags = 'v0.2.40 100\nv0.2.41 200\n'
  await collectReleases(host, c, notifier().notify)
  expect(historyReads()).toBe(2)
})

test('the history is dated by the tag, not by its commit', async () => {
  const { host } = fakeHost(GIT)
  const [repo] = await collectReleases(host, ctx(), notifier().notify)
  expect(repo?.history[0]?.date).toBe(100_000)
})
