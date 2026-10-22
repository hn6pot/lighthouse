import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { Context } from '../../hooks/loop'
import { launchRelease } from '../../hooks/release/launch'
import { runFiles } from '../../hooks/release/run'
import { fakeHost, type Answer } from '../helpers/fake-host'

const t = texts('fr')
const ctx = (): Context => ({
  id: 'me', cwd: '/w', repos: new Map(), lastFetch: new Map(), logins: new Map(), t,
  config: { rules: { 'acme/app': { kind: 'release', path: '~/r/app', command: 'make release' } }, ghConfigDirs: {} },
})
const files = runFiles('/Users/me', 'acme/app')
const record = (sha: string, subject: string) => `${sha}\x1f${subject}\x1f\x1e\n`

/** A clean main checkout at v0.2.40, with a fix and a feature waiting. */
const repo = (over: [RegExp, Answer][] = []): [RegExp, Answer][] => [
  ...over,
  [/symbolic-ref/, { stdout: 'origin/main\n' }],
  [/fetch --quiet origin main/, {}],
  [/for-each-ref --merged origin\/main/, { stdout: 'v0.2.40 100\n' }],
  [/log --first-parent/, { stdout: record('a1', 'fix: one (#2)') + record('b2', 'feat: two (#3)') }],
  [/branch --show-current/, { stdout: 'main\n' }],
  [/rev-list --count/, { stdout: '0\n' }],
  [/status --porcelain/, { stdout: '' }],
  [/pull --ff-only/, {}],
  [/^mkdir -p/, {}],
  [/^mkdir \//, {}],
  [/^rm -/, {}],
  [/^mv -f/, {}],
  [/^\/usr\/bin\/perl -MPOSIX -e /, { stdout: '4242\n' }],
]

test('refuses when the version changed since the press', async () => {
  const { host, calls } = fakeHost(repo())
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.2.41')).toEqual({ ok: false, reason: t.releasePane.versionChanged('v0.3.0') })
  expect(calls.some(c => /perl|pull/.test(c.line))).toBe(false)
})

test('refuses on dirty checkout', async () => {
  const { host, calls } = fakeHost(repo([[/status --porcelain/, { stdout: '?? branding/\n' }]]))
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: false, reason: t.reason.mainDirty })
  expect(calls.some(c => /perl/.test(c.line))).toBe(false)
})

test('refuses off base', async () => {
  const { host } = fakeHost(repo([[/branch --show-current/, { stdout: 'feat/x\n' }]]))
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: false, reason: t.reason.mainOnOtherBranch('feat/x', 'main') })
})

test('refuses when the pull fails', async () => {
  const { host } = fakeHost(repo([[/pull --ff-only/, { exitCode: 1, stderr: 'not possible to fast-forward\n' }]]))
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: false, reason: t.reason.pullFailed('not possible to fast-forward') })
})

test('refuses while running', async () => {
  const running = JSON.stringify({ pid: 7, startedAt: 1, tagAtLaunch: 'v0.2.40', expected: 'v0.3.0', log: '/l', code: '/c' })
  const { host } = fakeHost(repo([[/^kill -0 7$/, { exitCode: 0 }]]), { [files.record]: running })
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: false, reason: t.releasePane.alreadyRunning })
})

test('refuses with nothing waiting', async () => {
  const { host } = fakeHost(repo([[/log --first-parent/, { stdout: '' }]]))
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.2.41')).toEqual({ ok: false, reason: t.releasePane.nothing })
})

test('launches detached and writes the record', async () => {
  const written: Record<string, string> = {}
  // mv -f moves a file of the fake disk, as the record's atomic write needs.
  const mv: Answer = argv => {
    written[argv[3]!] = written[argv[2]!]!
    delete written[argv[2]!]
    return {}
  }
  const { host, calls, state } = fakeHost(repo([[/^mv -f/, mv]]), written)
  state.now = 5000
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: true, version: 'v0.3.0' })
  // In a session of its own (setsid), its output off the pipe: killing the session's process group leaves it running.
  const launch = calls.find(c => /^\/usr\/bin\/perl/.test(c.line))
  expect(launch?.line).toContain('POSIX::setsid()')
  expect(launch?.line).toMatch(new RegExp(` /bin/zsh ${files.script}$`))
  expect(written[files.script]).toContain("cd '/Users/me/r/app'")
  expect(written[files.script]).toContain("/bin/zsh -lc 'make release'")
  // Each run has its own exit-code file: another run's can never be read as this one's.
  expect(JSON.parse(written[files.record]!)).toEqual({
    pid: 4242, startedAt: 5000, tagAtLaunch: 'v0.2.40', expected: 'v0.3.0', log: '/Users/me/.lighthouse/logs/acme__app-release-5000.log',
    code: '/Users/me/.lighthouse/releases/acme__app-5000.code',
  })
  expect(written[files.script]).toContain("echo $? > '/Users/me/.lighthouse/releases/acme__app-5000.code'")
  // Written whole (temporary file, then mv): another session never reads half a record.
  expect(calls.some(c => c.line.startsWith('mv -f ') && c.line.endsWith(` ${files.record}`))).toBe(true)
  expect(calls.some(c => c.line === `rm -rf ${files.claim}`)).toBe(true) // the record is the lock now
})

test('a press while another one is launching does nothing, and leaves its claim', async () => {
  const { host, calls, state } = fakeHost(repo([
    [/^mkdir \/Users\/me\/\.lighthouse\/releases\/acme__app\.claim$/, { exitCode: 1, stderr: 'File exists' }],
    [/^stat -f %m /, { stdout: '100\n' }],
  ]))
  state.now = 100_000 + 60_000
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: false, reason: t.releasePane.alreadyRunning })
  expect(calls.some(c => /perl|fetch|pull/.test(c.line))).toBe(false)
  expect(calls.some(c => c.line === `rm -rf ${files.claim}`)).toBe(false)
})

test('a claim older than 5 min is taken over', async () => {
  let claimed = true
  const { host, calls, state } = fakeHost(repo([
    [/^mkdir \/Users\/me\/\.lighthouse\/releases\/acme__app\.claim$/, () => (claimed ? { exitCode: 1 } : {})],
    [/^stat -f %m /, { stdout: '100\n' }],
    [/^rm -rf .*\.claim$/, () => ((claimed = false), {})],
  ]))
  state.now = 100_000 + 5 * 60_000 + 1
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: true, version: 'v0.3.0' })
  expect(calls.some(c => /^\/usr\/bin\/perl/.test(c.line))).toBe(true)
})

test('the claim is freed after a refusal', async () => {
  const { host, calls } = fakeHost(repo([[/status --porcelain/, { stdout: ' M x\n' }]]))
  expect((await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).ok).toBe(false)
  expect(calls.some(c => c.line === `rm -rf ${files.claim}`)).toBe(true)
})

test('refuses with commits of the main folder not pushed', async () => {
  const { host, calls } = fakeHost(repo([[/rev-list --count origin\/main\.\.HEAD/, { stdout: '2\n' }]]))
  expect(await launchRelease(host, ctx(), 'acme/app', 'v0.3.0')).toEqual({ ok: false, reason: t.releasePane.unpushed(2) })
  expect(calls.some(c => /perl|pull/.test(c.line))).toBe(false)
})
