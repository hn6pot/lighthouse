// A repo without a rule: what its own files say about how it deploys.
import type { Host } from '../host'
import type { Texts } from '../i18n'
import type { Plan } from '../model'

export type RepoFacts = { workflows: { file: string; text: string }[]; makeTargets: string[]; npmScripts: string[] }
export type Inference = { plan: Plan; note: string }

/** Targets and scripts that deploy or install, in order of preference. */
const MAKE_DEPLOY = ['deploy', 'install']
const NPM_DEPLOY = ['deploy', 'install-app']

/** Workflows a push starts: `on: push`, `on: [push, …]` or a `push:` key under `on:`. */
export function pushWorkflows(workflows: readonly { file: string; text: string }[]): string[] {
  return workflows
    .filter(w => /^on:\s*(push\b|\[[^\]]*\bpush\b)/m.test(w.text) || /^on:\s*\n(?:[ \t]+.*\n)*?[ \t]+push\s*:/m.test(w.text))
    .map(w => w.file)
}

export const makeTargets = (makefile: string): string[] =>
  [...makefile.matchAll(/^([A-Za-z0-9_-]+)\s*:(?!=)/gm)].map(m => m[1] ?? '').filter(name => name !== '')

export function npmScripts(packageJson: string): string[] {
  try {
    return Object.keys((JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {})
  } catch {
    return []
  }
}

export function inferPlan(facts: RepoFacts, t: Texts): Inference {
  const pushed = pushWorkflows(facts.workflows)
  if (pushed.length > 0) return { plan: { kind: 'workflow' }, note: t.note.workflow(pushed.join(', ')) }
  const make = MAKE_DEPLOY.find(target => facts.makeTargets.includes(target))
  const npm = NPM_DEPLOY.find(script => facts.npmScripts.includes(script))
  const command = make ? `make ${make}` : npm ? `npm run ${npm}` : null
  // Found on a guess: proposed on the Deploy button, never run by the mod itself.
  if (command) return { plan: { kind: 'doubt', reason: t.reason.inferredCommand(command), command }, note: t.note.localCommand(command) }
  return { plan: { kind: 'immediate' }, note: t.note.localNothing }
}

/** Reads the facts from the repo's main folder. */
export async function repoFacts(host: Host, root: string): Promise<RepoFacts> {
  const dir = `${root}/.github/workflows`
  const listing = await host.run(['ls', '-1', dir])
  const files = listing.exitCode === 0 ? listing.stdout.split('\n').filter(f => /\.ya?ml$/.test(f)) : []
  const workflows: RepoFacts['workflows'] = []
  for (const file of files) workflows.push({ file, text: (await host.read(`${dir}/${file}`)) ?? '' })
  const makefile = await host.read(`${root}/Makefile`)
  const pkg = await host.read(`${root}/package.json`)
  return { workflows, makeTargets: makefile ? makeTargets(makefile) : [], npmScripts: pkg ? npmScripts(pkg) : [] }
}
