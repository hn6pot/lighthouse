// The person's settings, read from ~/.lighthouse/config.json: deploy rules per repo and gh accounts per owner.
// The file is optional; whatever is missing, unreadable or malformed is simply left out.
import type { CommandRule, Rule, Rules } from './deploy/rules'
import type { Host } from './host'
import { DATA_DIR } from './sessions/registry'

/** `ghConfigDirs`: repo owner → the GH_CONFIG_DIR of the gh account that goes with it (`~` allowed). */
export type Config = { rules: Rules; ghConfigDirs: Record<string, string> }

export const NO_CONFIG: Config = { rules: {}, ghConfigDirs: {} }

export const configPath = (home: string) => `${home}/${DATA_DIR}/config.json`

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const optional = (value: unknown, type: 'string' | 'boolean') => value === undefined || typeof value === type

const isCommandRule = (value: unknown): value is CommandRule =>
  isRecord(value) &&
  typeof value.command === 'string' &&
  optional(value.only_under, 'string') &&
  optional(value.single, 'boolean') &&
  optional(value.always, 'boolean')

const isDoubt = (value: unknown) =>
  value === undefined || typeof value === 'string' || (isRecord(value) && typeof value.en === 'string' && typeof value.fr === 'string')

/** True if the rule is well formed in every part; otherwise it is left out and the repo falls back on inference. */
function isRule(value: unknown): value is Rule {
  if (!isRecord(value)) return false
  switch (value.kind) {
    case 'workflow':
      return optional(value.workflow, 'string')
    case 'delay':
      return typeof value.seconds === 'number' && Number.isFinite(value.seconds) && value.seconds >= 0
    case 'immediate':
      return true
    case 'release':
      return typeof value.path === 'string' && value.path !== '' && typeof value.command === 'string' && value.command !== ''
    case 'manual':
      return isDoubt(value.always_doubt) && (value.commands === undefined || (Array.isArray(value.commands) && value.commands.every(isCommandRule)))
    default:
      return false
  }
}

export function parseConfig(text: string): Config {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return NO_CONFIG
  }
  if (!isRecord(raw)) return NO_CONFIG
  const rules: Rules = {}
  for (const [slug, value] of Object.entries(isRecord(raw.rules) ? raw.rules : {})) {
    if (slug.includes('/') && isRule(value)) rules[slug] = value
  }
  const ghConfigDirs: Record<string, string> = {}
  for (const [owner, dir] of Object.entries(isRecord(raw.ghConfigDirs) ? raw.ghConfigDirs : {})) {
    if (typeof dir === 'string' && dir !== '') ghConfigDirs[owner] = dir
  }
  return { rules, ghConfigDirs }
}

export async function loadConfig(host: Pick<Host, 'read' | 'home'>): Promise<Config> {
  try {
    const text = await host.read(configPath(host.home))
    return text === null ? NO_CONFIG : parseConfig(text)
  } catch {
    return NO_CONFIG // unreadable: as if there were none
  }
}
