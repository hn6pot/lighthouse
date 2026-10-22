import { expect, test } from 'claude-code/testing'
import { history, latestTag, versionTags, waiting } from '../../hooks/release/read'
import { fakeHost } from '../helpers/fake-host'

const record = (sha: string, subject: string) => `${sha}\x1f${subject}\x1f\x1e\n`
const TAGS = /for-each-ref --merged origin\/main --format=%\(refname:short\) %\(creatordate:unix\) refs\/tags\/v\*/

test('versionTags: the version tags merged into the base, by version, with their tag dates', async () => {
  const { host } = fakeHost([[TAGS, { stdout: 'v0.2.40 400\nv0.2.9 90\nnightly 1\nv0.10.0-rc 5\n' }]])
  expect(await versionTags(host, '/r/app', 'main')).toEqual([
    { tag: 'v0.2.9', date: 90_000 },
    { tag: 'v0.2.40', date: 400_000 },
  ])
})

test('latestTag: the highest version, not the newest name; null without one', async () => {
  expect(await latestTag([{ tag: 'v0.2.9', date: 2 }, { tag: 'v0.2.40', date: 1 }])).toBe('v0.2.40')
  expect(await latestTag([])).toBeNull()
})

test('versionTags: git failing gives no tags', async () => {
  const { host } = fakeHost([[TAGS, { exitCode: 128, stderr: 'not a git repository' }]])
  expect(await versionTags(host, '/r/app', 'main')).toEqual([])
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

test('history pairs each tag with the previous one, newest first, cut at the limit, dated by the tag', async () => {
  const tags = [{ tag: 'v0.1.0', date: 100_000 }, { tag: 'v0.2.0', date: 200_000 }, { tag: 'v0.2.1', date: 300_000 }]
  const { host, calls } = fakeHost([
    [/log --first-parent --format=\S+ v0\.2\.0\.\.v0\.2\.1$/, { stdout: record('c3', 'fix: c (#3)') }],
    [/log --first-parent --format=\S+ v0\.1\.0\.\.v0\.2\.0$/, { stdout: record('b2', 'feat: b (#2)') + record('b1', 'chore: b') }],
    [/log --first-parent --format=\S+ v0\.1\.0$/, { stdout: record('a1', 'feat: a (#1)') }],
  ])
  const all = await history(host, '/r/app', tags)
  expect(all.map(h => [h.tag, h.date, h.entries.length])).toEqual([
    ['v0.2.1', 300_000, 1],
    ['v0.2.0', 200_000, 2],
    ['v0.1.0', 100_000, 1],
  ])
  expect(calls.some(c => /log -1/.test(c.line))).toBe(false) // the date comes with the tag list
  const two = await history(host, '/r/app', tags, 2)
  expect(two.map(h => [h.tag, h.entries.length])).toEqual([
    ['v0.2.1', 1],
    ['v0.2.0', 2],
  ])
})
