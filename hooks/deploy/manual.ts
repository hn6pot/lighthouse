// Deploying a manual repo ourselves, or writing the request to Claude when in doubt.
import type { Host } from '../host'
import type { Texts } from '../i18n'
import type { Tracked } from '../model'
import { treeState } from '../repos/git'
import { DATA_DIR } from '../sessions/registry'
import type { Verdict } from './tracking'

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error))

/** `mark` records "launched by": it is called right before the launch, and if it fails nothing is launched. */
export async function deployManual(host: Host, s: Tracked, command: string, mark: () => Promise<void>, t: Texts): Promise<Verdict> {
  const main = await treeState(host, s.root, s.base, t)
  if (main.branch !== s.base) return { state: 'doubt', reason: t.reason.mainOnOtherBranch(main.branch, s.base) }
  if (main.uncommitted > 0) return { state: 'doubt', reason: t.reason.mainDirty }

  const pull = await host.run(['git', '-C', s.root, 'pull', '--ff-only', '--quiet'], { timeoutMs: 120_000 })
  if (pull.exitCode !== 0) return { state: 'doubt', reason: t.reason.pullFailed(pull.stderr.trim()) }

  await mark()
  let code: number | null
  let output: string
  try {
    ;({ code, output } = await host.launch(['/bin/zsh', '-lc', command], { cwd: s.root }))
  } catch (error) {
    return { state: 'failed', reason: t.reason.launchFailed(messageOf(error)) }
  }

  const logDir = `${host.home}/${DATA_DIR}/logs`
  const log = `${logDir}/${s.slug.replace('/', '__')}-${s.number}.log`
  let link: string | undefined = log
  try {
    await host.run(['mkdir', '-p', logDir])
    await host.write(log, `$ ${command}\n${output}\n[code ${code}]\n`)
  } catch {
    link = undefined
  }

  const verdict: Verdict = code === 0 ? { state: 'ok' } : { state: 'failed', reason: t.reason.commandFailed(command, code) }
  return link ? { ...verdict, link } : verdict
}

export function deployPrompt(s: Tracked, t: Texts): string {
  return t.prompt.deploy({ slug: s.slug, number: s.number, branch: s.branch, base: s.base, root: s.root, command: s.command, reason: s.reason })
}

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim()
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
// Command start: start of text, or right after a shell separator.
const COMMAND_START = '(?:^|&&|\\|\\||;|\\|)\\s*'
// Command end: end of text, a space, or a shell separator.
const COMMAND_END = '(?=$|\\s|&&|\\|\\||;|\\|)'

/** True if `expected` appears as a whole command in `bash` (not as a substring). */
export function commandMatches(bash: string, expected: string): boolean {
  // A newline separates two commands as `;` would.
  const text = normalize(bash.replace(/\n/g, ' ; '))
  return new RegExp(COMMAND_START + escape(normalize(expected)) + COMMAND_END).test(text)
}

/**
 * True if a Bash result proves the command finished and succeeded: no error,
 * not interrupted, not sent to the background (it may still run, or fail later).
 */
export function bashSucceeded(result: { isError?: boolean; result?: unknown }): boolean {
  if (result.isError) return false
  const r = (result.result ?? {}) as Record<string, unknown>
  return r.interrupted !== true && r.backgroundTaskId === undefined && r.backgroundedByUser !== true && r.timedOutAfterMs === undefined
}

/** Commands that deploy or install, wherever they start in a shell line. */
const DEPLOY_COMMAND = new RegExp(
  COMMAND_START +
    '(?:' +
    [
      'make\\s+[\\w-]*(?:deploy|install|push|release|upgrade)[\\w-]*',
      'helm\\s+(?:upgrade|install)\\b',
      'kubectl\\s+(?:apply|rollout)\\b',
      'gh\\s+workflow\\s+run\\b',
      '(?:terraform|tofu|terragrunt)\\s+apply\\b',
      '(?:npm|pnpm|yarn)\\s+(?:run\\s+)?(?:deploy|install-app|release)\\b',
      '[\\w./-]*deploy[\\w.-]*\\.sh\\b',
    ].join('|') +
    ')',
)

/** True if Claude is deploying with this command: the session handles the deploy itself. */
export const isDeployCommand = (bash: string): boolean => DEPLOY_COMMAND.test(normalize(bash.replace(/\n/g, ' ; ')))

/** A deploy command whose success means deployed (a dispatched workflow is followed on GitHub instead). */
export const finishesDeploy = (bash: string): boolean => isDeployCommand(bash) && !/\bgh\s+workflow\s+run\b/.test(bash)
