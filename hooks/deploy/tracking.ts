// Where the automatic deploy of a merged PR stands.
import type { Texts } from '../i18n'
import type { Run } from '../model'

export type Verdict = { state: 'running' | 'ok' | 'failed' | 'doubt'; link?: string; reason?: string }

const NOT_FOUND_MS = 5 * 60_000
const FAILURES = ['failure', 'cancelled', 'timed_out', 'startup_failure']

export function workflowVerdict(runs: readonly Run[], expected: string | undefined, sinceMergeMs: number, t: Texts): Verdict {
  const candidates = runs.filter(r => (expected ? r.name === expected : /deploy|merge/i.test(r.name)))
  if (candidates.length === 0) {
    return sinceMergeMs >= NOT_FOUND_MS ? { state: 'doubt', reason: t.reason.noWorkflow } : { state: 'running' }
  }
  const running = candidates.find(r => r.status !== 'completed')
  if (running) return { state: 'running', link: running.url }
  const failed = candidates.find(r => FAILURES.includes(r.conclusion ?? ''))
  if (failed) return { state: 'failed', link: failed.url }
  const unsuccessful = candidates.find(r => r.conclusion !== 'success')
  if (unsuccessful) {
    return { state: 'doubt', link: unsuccessful.url, reason: t.reason.workflowUnsuccessful(unsuccessful.name, unsuccessful.conclusion) }
  }
  return { state: 'ok', link: candidates[0].url }
}

export function delayVerdict(sinceMergeMs: number, ms: number): Verdict {
  return sinceMergeMs >= ms ? { state: 'ok' } : { state: 'running' }
}
