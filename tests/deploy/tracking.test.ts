import { expect, test } from 'claude-code/testing'
import { delayVerdict, workflowVerdict } from '../../hooks/deploy/tracking'
import { texts } from '../../hooks/i18n'

const t = texts('fr')
const run = (name: string, status: string, conclusion: string | null) => ({ name, status, conclusion, url: `u/${name}` })

test('named workflow succeeded: ok', () => {
  expect(workflowVerdict([run('deploy-production', 'completed', 'success'), run('trivy', 'completed', 'failure')], 'deploy-production', 0, t))
    .toEqual({ state: 'ok', link: 'u/deploy-production' })
})

test('no name: runs containing deploy or merge count', () => {
  expect(workflowVerdict([run('Deploy', 'in_progress', null)], undefined, 0, t)).toEqual({ state: 'running', link: 'u/Deploy' })
  expect(workflowVerdict([run('merge', 'completed', 'failure')], undefined, 0, t)).toEqual({ state: 'failed', link: 'u/merge' })
})

test('no name: an unrelated green run does not hide a running deploy', () => {
  expect(workflowVerdict([run('Deploy', 'in_progress', null), run('merge-lint', 'completed', 'success')], undefined, 0, t))
    .toEqual({ state: 'running', link: 'u/Deploy' })
})

test('workflow finished without success (skipped, neutral): doubt', () => {
  expect(workflowVerdict([run('deploy-production', 'completed', 'skipped')], 'deploy-production', 0, t))
    .toMatchObject({ state: 'doubt', reason: 'workflow deploy-production terminé sans succès (skipped)' })
  expect(workflowVerdict([run('Deploy', 'completed', 'neutral')], undefined, 0, t)).toMatchObject({ state: 'doubt' })
})

test('success mixed with a skipped run: doubt, not ok', () => {
  expect(workflowVerdict([run('deploy-a', 'completed', 'success'), run('deploy-b', 'completed', 'skipped')], undefined, 0, t))
    .toMatchObject({ state: 'doubt', link: 'u/deploy-b' })
})

test('no run: running, then doubt after 5 min', () => {
  expect(workflowVerdict([], undefined, 4 * 60_000, t)).toEqual({ state: 'running' })
  expect(workflowVerdict([], undefined, 5 * 60_000, t)).toMatchObject({ state: 'doubt' })
})

test('delay', () => {
  expect(delayVerdict(60_000, 120_000)).toEqual({ state: 'running' })
  expect(delayVerdict(120_000, 120_000)).toEqual({ state: 'ok' })
})
