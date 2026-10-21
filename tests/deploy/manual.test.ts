import { expect, test } from 'claude-code/testing'
import { bashSucceeded, commandMatches, deployManual, deployPrompt, finishesDeploy, isDeployCommand } from '../../hooks/deploy/manual'
import { texts } from '../../hooks/i18n'
import type { Tracked } from '../../hooks/model'
import { fakeHost } from '../helpers/fake-host'

const t = texts('fr')
const S = { key: 'acme/web#4', slug: 'acme/web', root: '/r', number: 4, branch: 'feat/x', base: 'main', stage: 'merged', updatedAt: 0 } as Tracked
const CLEAN: [RegExp, object][] = [
  [/branch --show-current/, { stdout: 'main\n' }],
  [/rev-list --count/, { stdout: '0\n' }],
  [/status --porcelain/, { stdout: '' }],
  [/pull --ff-only/, {}],
  [/^mkdir -p/, {}],
]

const NOTHING = async () => undefined

test('mark is called after the pull and before the launch; if it fails, nothing is launched', async () => {
  const h = fakeHost(CLEAN)
  const order: string[] = []
  h.host.launch = async () => (order.push('launch'), { code: 0, output: '' })
  await deployManual(h.host, S, 'make deploy', async () => void order.push(`mark after ${h.calls.at(-1)?.line}`), t)
  expect(order).toEqual(['mark after git -C /r pull --ff-only --quiet', 'launch'])

  const h2 = fakeHost(CLEAN)
  const brokenMark = async () => {
    throw new Error('disk full')
  }
  await expect(deployManual(h2.host, S, 'make deploy', brokenMark, t)).rejects.toThrow('disk full')
  expect(h2.launched).toEqual([])
})

test('clean main folder: pull, launch the command, write the log', async () => {
  const h = fakeHost(CLEAN, {}, 0)
  h.state.launchReturns = { code: 0, output: 'deployed\n' }
  const verdict = await deployManual(h.host, S, 'make deploy', NOTHING, t)
  expect(verdict).toEqual({ state: 'ok', link: '/Users/me/.lighthouse/logs/acme__web-4.log' })
  expect(h.launched).toEqual([{ line: '/bin/zsh -lc make deploy', cwd: '/r' }])
  expect(h.files['/Users/me/.lighthouse/logs/acme__web-4.log']).toContain('deployed')
})

test('the command fails: failed', async () => {
  const h = fakeHost(CLEAN)
  h.state.launchReturns = { code: 2, output: 'error\n' }
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toMatchObject({ state: 'failed' })
})

test('no exit code (signal): failed', async () => {
  const h = fakeHost(CLEAN)
  h.state.launchReturns = { code: null, output: '' }
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toMatchObject({ state: 'failed' })
})

test('cannot launch: failed, without throwing', async () => {
  const h = fakeHost(CLEAN)
  h.host.launch = async () => {
    throw new Error('zsh not found')
  }
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toEqual({ state: 'failed', reason: 'lancement impossible : zsh not found' })
})

test('log cannot be written after a success: ok, without link', async () => {
  const h = fakeHost(CLEAN)
  h.state.launchReturns = { code: 0, output: 'deployed\n' }
  h.host.write = async () => {
    throw new Error('disk full')
  }
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toEqual({ state: 'ok' })
})

test('main folder not on the base or modified: doubt, nothing launched', async () => {
  const h = fakeHost([[/branch --show-current/, { stdout: 'feat/y\n' }], [/rev-list/, { stdout: '0' }], [/status --porcelain/, { stdout: '' }]])
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toMatchObject({ state: 'doubt' })
  expect(h.launched).toEqual([])
})

test('main folder with changes in progress: doubt, neither pull nor launch', async () => {
  const h = fakeHost([
    [/branch --show-current/, { stdout: 'main\n' }],
    [/rev-list --count/, { stdout: '0\n' }],
    [/status --porcelain/, { stdout: ' M package.json\n' }],
  ])
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toMatchObject({ state: 'doubt' })
  expect(h.calls.some(a => a.line.includes('pull'))).toBe(false)
  expect(h.launched).toEqual([])
})

test('git pull fails: doubt, nothing launched', async () => {
  const h = fakeHost([
    [/branch --show-current/, { stdout: 'main\n' }],
    [/rev-list --count/, { stdout: '0\n' }],
    [/status --porcelain/, { stdout: '' }],
    [/pull --ff-only/, { exitCode: 1, stderr: 'fatal: not fast-forward\n' }],
  ])
  expect(await deployManual(h.host, S, 'make deploy', NOTHING, t)).toEqual({ state: 'doubt', reason: 'git pull a échoué : fatal: not fast-forward' })
  expect(h.launched).toEqual([])
})

test('prompt for Claude: repo, PR, command, reason', () => {
  const text = deployPrompt({ ...S, command: 'make deploy', reason: 'ec2 and mac touched' }, t)
  expect(text).toContain('acme/web')
  expect(text).toContain('#4')
  expect(text).toContain('make deploy')
  expect(text).toContain('ec2 and mac touched')
})

test('commandMatches tolerates cd, prefixes and spaces', () => {
  expect(commandMatches('cd ~/code/web && make  deploy', 'make deploy')).toBe(true)
  expect(commandMatches('make deploy; echo ok', 'make deploy')).toBe(true)
  expect(commandMatches('make install', 'make deploy')).toBe(false)
})

test('commandMatches refuses a substring, not a whole command', () => {
  expect(commandMatches('make deploy-staging', 'make deploy')).toBe(false)
  expect(commandMatches('echo make deploy', 'make deploy')).toBe(false)
  expect(commandMatches('git commit -m "make deploy"', 'make deploy')).toBe(false)
  expect(commandMatches('make deployed', 'make deploy')).toBe(false)
})

test('bashSucceeded: only a finished and successful Bash counts', () => {
  const ok = { interrupted: false, stdout: '', stderr: '' }
  expect(bashSucceeded({ result: ok })).toBe(true)
  expect(bashSucceeded({ isError: true, result: ok })).toBe(false)
  expect(bashSucceeded({ result: { ...ok, backgroundTaskId: 'b1' } })).toBe(false)
  expect(bashSucceeded({ result: { ...ok, backgroundedByUser: true } })).toBe(false)
  expect(bashSucceeded({ result: { ...ok, timedOutAfterMs: 120000 } })).toBe(false)
  expect(bashSucceeded({ result: { ...ok, interrupted: true } })).toBe(false)
})

test('deploy commands Claude may run in the session', () => {
  for (const c of [
    'make deploy', 'make install', 'make coder-template-push T=pr-reviewer', 'make helm_upgrade_metabase_internal',
    'cd /w/x && make release', 'helm upgrade web ./chart', 'kubectl rollout restart deploy/x', 'kubectl apply -f k8s.yaml',
    'gh workflow run deploy-test.yml', 'terraform apply', 'tofu apply -auto-approve', 'pnpm install-app', 'npm run deploy', './scripts/deploy.sh prod',
  ]) expect([c, isDeployCommand(c)]).toEqual([c, true])
  for (const c of ['make test', 'make build', 'git push', 'helm template x', 'kubectl get pods', 'npm install', 'terraform plan', 'cat deploy.md']) {
    expect([c, isDeployCommand(c)]).toEqual([c, false])
  }
})

test('only a command that deploys by itself finishes the deploy (a dispatched workflow is followed on GitHub)', () => {
  expect(finishesDeploy('make deploy')).toBe(true)
  expect(finishesDeploy('gh workflow run deploy.yml')).toBe(false)
  expect(finishesDeploy('make test')).toBe(false)
})
