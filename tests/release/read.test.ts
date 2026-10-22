import { expect, test } from 'claude-code/testing'
import { history, latestTag, waiting } from '../../hooks/release/read'
import { fakeHost } from '../helpers/fake-host'

const record = (sha: string, subject: string) => `${sha}\x1f${subject}\x1f\x1e\n`

test('latestTag: the highest version merged into the base, not the newest name', async () => {
  const { host } = fakeHost([[/tag --merged origin\/main --list v\*/, { stdout: 'v0.2.40\nv0.2.9\nnightly\nv0.10.0-rc\n' }]])
  expect(await latestTag(host, '/r/app', 'main')).toBe('v0.2.40')
})

test('latestTag: no tag, null', async () => {
  const { host } = fakeHost([[/tag --merged/, { stdout: '' }]])
  expect(await latestTag(host, '/r/app', 'main')).toBeNull()
})

test('waits since the latest tag', async () => {
  const { host, calls } = fakeHost([[/ log --first-parent/, { stdout: record('a1', 'fix: one (#2)') }]])
  expect(await waiting(host, '/r/app', 'main', 'v0.2.40')).toEqual([{ sha: 'a1', number: 2, title: 'one', kind: 'fix' }])
  expect(calls[0].line).toMatch(/^git -C \/r\/app log --first-parent --format=\S+ v0\.2\.40\.\.origin\/main$/)
})

test('no tag: every first-parent commit waits', async () => {
  const { host, calls } = fakeHost([[/ log --first-parent/, { stdout: record('a1', 'feat: one') }]])
  expect((await waiting(host, '/r/app', 'main', null)).length).toBe(1)
  expect(calls[0].line).toMatch(/ origin\/main$/)
})

test('history pairs each tag with the previous one, newest first, cut at the limit', async () => {
  const { host } = fakeHost([
    [/tag --merged origin\/main/, { stdout: 'v0.1.0\nv0.2.0\nv0.2.1\n' }],
    [/log --first-parent --format=\S+ v0\.2\.0\.\.v0\.2\.1$/, { stdout: record('c3', 'fix: c (#3)') }],
    [/log --first-parent --format=\S+ v0\.1\.0\.\.v0\.2\.0$/, { stdout: record('b2', 'feat: b (#2)') + record('b1', 'chore: b') }],
    [/log --first-parent --format=\S+ v0\.1\.0$/, { stdout: record('a1', 'feat: a (#1)') }],
    [/log -1 --format=%ct v0\.2\.1/, { stdout: '300\n' }],
    [/log -1 --format=%ct v0\.2\.0/, { stdout: '200\n' }],
    [/log -1 --format=%ct v0\.1\.0/, { stdout: '100\n' }],
  ])
  const all = await history(host, '/r/app', 'main')
  expect(all.map(h => [h.tag, h.date, h.entries.length])).toEqual([
    ['v0.2.1', 300_000, 1],
    ['v0.2.0', 200_000, 2],
    ['v0.1.0', 100_000, 1],
  ])
  const two = await history(host, '/r/app', 'main', 2)
  expect(two.map(h => [h.tag, h.entries.length])).toEqual([
    ['v0.2.1', 1],
    ['v0.2.0', 2],
  ])
})
