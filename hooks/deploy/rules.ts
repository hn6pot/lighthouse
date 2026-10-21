// What the rules say to do after a PR is merged, depending on the files it touches.
import type { Lang, Texts } from '../i18n'
import type { Plan } from '../model'

export type CommandRule = { only_under?: string; single?: boolean; always?: boolean; command: string }
export type Rule =
  | { kind: 'workflow'; workflow?: string }
  | { kind: 'delay'; seconds: number }
  | { kind: 'immediate' }
  | { kind: 'manual'; commands?: CommandRule[]; always_doubt?: string | Record<Lang, string> }
/** Rules per repo (`owner/repo`), from the config file (config.ts). */
export type Rules = Record<string, Rule>

// A path segment goes into a shell command: only safe characters pass.
const SAFE_SEGMENT = /^[\w.-]+$/

/** The segment `*` captures for each file, or null if a file falls outside the pattern. */
function captures(pattern: string, files: readonly string[]): string[] | null {
  const [before, after] = pattern.split('*')
  const found: string[] = []
  for (const file of files) {
    if (!file.startsWith(before)) return null
    if (after === undefined) continue
    const rest = file.slice(before.length)
    const segment = rest.split('/')[0]
    if (!rest.startsWith(segment + after)) return null
    if (!SAFE_SEGMENT.test(segment)) return null
    found.push(segment)
  }
  return found
}

function manualCommand(commands: readonly CommandRule[], files: readonly string[]): string | null {
  for (const c of commands) {
    if (c.always) return c.command
    if (c.only_under === undefined || files.length === 0) continue
    const taken = captures(c.only_under, files)
    if (taken === null) continue
    const distinct = [...new Set(taken)]
    if (c.single && distinct.length !== 1) continue
    return c.command.replace('{1}', distinct[0] ?? '')
  }
  return null
}

export function deployPlan(rules: Rules, slug: string, files: readonly string[], t: Texts): Plan {
  const rule = rules[slug] ?? { kind: 'workflow' }
  switch (rule.kind) {
    case 'workflow':
      return rule.workflow ? { kind: 'workflow', workflow: rule.workflow } : { kind: 'workflow' }
    case 'delay':
      return { kind: 'delay', ms: rule.seconds * 1000 }
    case 'immediate':
      return { kind: 'immediate' }
    case 'manual': {
      if (rule.always_doubt) {
        return { kind: 'doubt', reason: typeof rule.always_doubt === 'string' ? rule.always_doubt : rule.always_doubt[t.lang] }
      }
      const command = manualCommand(rule.commands ?? [], files)
      return command ? { kind: 'manual', command } : { kind: 'doubt', reason: t.reason.noMatchingCommand }
    }
  }
}
