import { expect, test } from 'claude-code/testing'
import { readRun, runFiles, startScript } from '../../hooks/release/run'
import { fakeHost } from '../helpers/fake-host'

const files = runFiles('/Users/me', 'acme/app')
const LOG = '/Users/me/.lighthouse/logs/acme__app-release-1000.log'
const record = JSON.stringify({ pid: 42, startedAt: 1000, tagAtLaunch: 'v0.2.40', expected: 'v0.3.0', log: LOG })

test('run files live in ~/.lighthouse/releases, one set per repo', () => {
  expect(files).toEqual({
    record: '/Users/me/.lighthouse/releases/acme__app.json',
    code: '/Users/me/.lighthouse/releases/acme__app.code',
    script: '/Users/me/.lighthouse/releases/acme__app.sh',
  })
})

test('idle without a record', async () => {
  expect(await readRun(fakeHost([]).host, 'acme/app', 'v0.2.40')).toEqual({ kind: 'idle' })
})

test('running while pid alive and no code', async () => {
  const { host } = fakeHost([[/^kill -0 42$/, { exitCode: 0 }]], { [files.record]: record })
  expect(await readRun(host, 'acme/app', 'v0.2.40')).toEqual({ kind: 'running', startedAt: 1000, expected: 'v0.3.0' })
})

test('died when pid gone without code', async () => {
  const { host } = fakeHost([[/^kill -0 42$/, { exitCode: 1 }]], { [files.record]: record, [LOG]: '→ Build…\n' })
  expect(await readRun(host, 'acme/app', 'v0.2.40')).toEqual({ kind: 'done', startedAt: 1000, outcome: 'died', version: null, lastLine: '→ Build…', log: LOG })
})

test('ok when a new tag and code 0', async () => {
  const { host } = fakeHost([], { [files.record]: record, [files.code]: '0\n', [LOG]: '✓ done\n' })
  expect(await readRun(host, 'acme/app', 'v0.3.0')).toMatchObject({ kind: 'done', outcome: 'ok', version: 'v0.3.0' })
})

test('warning when a new tag and code ≠ 0, with the last non-empty line', async () => {
  const { host } = fakeHost([], { [files.record]: record, [files.code]: '1\n', [LOG]: '✓ tag\n✗ check failed\n\n' })
  expect(await readRun(host, 'acme/app', 'v0.3.0')).toMatchObject({ kind: 'done', outcome: 'warning', version: 'v0.3.0', lastLine: '✗ check failed' })
})

test('failed when no new tag', async () => {
  const { host } = fakeHost([], { [files.record]: record, [files.code]: '0\n' })
  expect(await readRun(host, 'acme/app', 'v0.2.40')).toMatchObject({ kind: 'done', outcome: 'failed', version: null })
})

test('an unreadable record counts as idle', async () => {
  const { host } = fakeHost([], { [files.record]: '{ nope' })
  expect(await readRun(host, 'acme/app', 'v0.2.40')).toEqual({ kind: 'idle' })
})

test('startScript runs the command in the repo, logs it, then writes its exit code', () => {
  expect(startScript('/r/app', 'pnpm install-app', '/l/x.log', '/c/x.code')).toBe(
    ["cd '/r/app' || { echo 1 > '/c/x.code'; exit 1; }", "/bin/zsh -lc 'pnpm install-app' > '/l/x.log' 2>&1", "echo $? > '/c/x.code'", ''].join('\n'),
  )
})

test("startScript quotes a path with a quote", () => {
  expect(startScript("/tmp/a'b", 'x', '/l', '/c')).toContain(`cd '/tmp/a'\\''b'`)
})
