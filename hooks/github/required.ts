// How many approvals a base branch requires: its rulesets, else its classic protection.
import type { Host } from '../host'
import { ghEnv, type GhConfigDirs } from './gh'

/** Branch rules hardly change: they are asked to GitHub at most this often per repo and base. */
export const REQUIRED_FRESH_MS = 60 * 60_000

type Rule = { type: string; parameters?: { required_approving_review_count?: number } }
type Protection = { required_pull_request_reviews?: { required_approving_review_count?: number } }
type Answer = { ok: true; body: unknown } | { ok: false; status: number; message: string }

async function api(host: Host, env: Record<string, string> | undefined, path: string): Promise<Answer> {
  const r = await host.run(['gh', 'api', path], { env, timeoutMs: 30_000 })
  if (r.exitCode === 0) return { ok: true, body: JSON.parse(r.stdout) }
  const status = Number(/\(HTTP (\d{3})\)/.exec(r.stderr)?.[1] ?? 0)
  // Only GitHub's refusals are answers worth keeping; anything else (network, gh missing) is tried again next tick.
  if (status !== 403 && status !== 404) throw new Error(`gh api ${path}: ${r.stderr.trim()}`)
  return { ok: false, status, message: r.stderr }
}

/** The required approvals, 0 when nothing requires any, null when GitHub will not tell (no right to read the protection). */
export async function requiredApprovals(host: Host, dirs: GhConfigDirs, slug: string, base: string): Promise<number | null> {
  const env = ghEnv(slug, host.home, dirs)
  const branch = encodeURIComponent(base)
  const rules = await api(host, env, `repos/${slug}/rules/branches/${branch}`)
  const fromRules = rules.ok
    ? Math.max(0, ...(rules.body as Rule[]).filter(r => r.type === 'pull_request').map(r => r.parameters?.required_approving_review_count ?? 0))
    : null
  if (fromRules !== null && fromRules > 0) return fromRules
  const protection = await api(host, env, `repos/${slug}/branches/${branch}/protection`)
  const fromProtection = protection.ok
    ? ((protection.body as Protection).required_pull_request_reviews?.required_approving_review_count ?? 0)
    : /Branch not (protected|found)/.test(protection.message)
      ? 0
      : null
  if (fromProtection !== null && fromProtection > 0) return fromProtection
  // Nothing requires any approval: certain only when both sources answered.
  return fromRules === 0 && fromProtection === 0 ? 0 : null
}
