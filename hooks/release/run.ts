// A release runs detached from the session: a record says what was launched, an exit-code file says it ended.
// Any session reads them; the record is also the lock (a press while one runs does nothing).
import type { Host } from '../host'
import type { ReleaseRecord, ReleaseRun } from '../model'
import { DATA_DIR } from '../sessions/registry'

/** `claim`: a folder made atomically by the press that launches, from its first step until the record is written. */
export function runFiles(home: string, slug: string): { record: string; script: string; claim: string } {
  const base = `${home}/${DATA_DIR}/releases/${slug.replace('/', '__')}`
  return { record: `${base}.json`, script: `${base}.sh`, claim: `${base}.claim` }
}

/** Each run writes its exit code to a file of its own: one run's code is never read as another's. */
export const codeFile = (home: string, slug: string, startedAt: number) => `${home}/${DATA_DIR}/releases/${slug.replace('/', '__')}-${startedAt}.code`

/** Single quotes for the shell: a `'` inside becomes `'\''`. */
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

/** The detached script: in the repo, the command with its output to the log, then its exit code. */
export function startScript(path: string, command: string, log: string, codeFile: string): string {
  return [
    `cd ${quote(path)} || { echo 1 > ${quote(codeFile)}; exit 1; }`,
    `/bin/zsh -lc ${quote(command)} > ${quote(log)} 2>&1`,
    `echo $? > ${quote(codeFile)}`,
    '',
  ].join('\n')
}

function parseRecord(text: string | null): ReleaseRecord | null {
  if (text === null) return null
  try {
    const r = JSON.parse(text) as Partial<ReleaseRecord>
    if (typeof r.pid !== 'number' || typeof r.startedAt !== 'number' || typeof r.expected !== 'string' || typeof r.log !== 'string' || typeof r.code !== 'string') return null
    return { pid: r.pid, startedAt: r.startedAt, tagAtLaunch: typeof r.tagAtLaunch === 'string' ? r.tagAtLaunch : null, expected: r.expected, log: r.log, code: r.code }
  } catch {
    return null // written by another process, unreadable: as if there were none
  }
}

/** Where the last release of `slug` stands; `currentTag` is the highest version tag now. */
export async function readRun(host: Host, slug: string, currentTag: string | null): Promise<ReleaseRun> {
  const record = parseRecord(await host.read(runFiles(host.home, slug).record))
  if (record === null) return { kind: 'idle' }
  const codeText = await host.read(record.code)
  if (codeText === null && (await host.run(['kill', '-0', String(record.pid)])).exitCode === 0) {
    return { kind: 'running', startedAt: record.startedAt, expected: record.expected }
  }
  const lastLine = ((await host.read(record.log)) ?? '').split('\n').filter(l => l.trim() !== '').at(-1)?.trim() ?? ''
  const done = { kind: 'done' as const, startedAt: record.startedAt, lastLine, log: record.log }
  // Gone without an exit code: killed before the end.
  if (codeText === null) return { ...done, outcome: 'died', version: null }
  const released = currentTag !== null && currentTag !== record.tagAtLaunch
  if (!released) return { ...done, outcome: 'failed', version: null }
  return { ...done, outcome: Number(codeText.trim()) === 0 ? 'ok' : 'warning', version: currentTag }
}
