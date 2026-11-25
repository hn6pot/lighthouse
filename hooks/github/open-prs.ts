// My open PRs in one GraphQL call: what `gh pr list` gave, plus the approvals each base requires.
import type { Host } from '../host'
import type { GhReview } from './approvals'
import { ghEnv, type GhConfigDirs } from './gh'
import type { Check, GhPr } from './prs'

/** `required`: the approvals its base requires (rulesets and classic protection), null when the base is gone. */
export type OpenPr = GhPr & { required: number | null }

// Page sizes keep the call at 1 point of GitHub's 5,000 per hour.
const QUERY = `query($q: String!) {
  search(query: $q, type: ISSUE, first: 30) {
    nodes {
      ... on PullRequest {
        number title url state headRefName headRefOid baseRefName mergedAt reviewDecision isDraft mergeable mergeStateStatus
        createdAt updatedAt additions deletions changedFiles
        mergeCommit { oid }
        author { login }
        reviews(first: 30) { nodes { author { login } state } }
        commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes {
          ... on CheckRun { name status conclusion }
          ... on StatusContext { context state }
        } } } } } }
        baseRef {
          branchProtectionRule { requiredApprovingReviewCount }
          rules(first: 10) { nodes { type parameters { ... on PullRequestParameters { requiredApprovingReviewCount } } } }
        }
      }
    }
  }
}`

type Count = { requiredApprovingReviewCount?: number } | null
type BaseRef = { branchProtectionRule: Count; rules: { nodes: { type: string; parameters: Count }[] } } | null
type Node = Omit<GhPr, 'statusCheckRollup' | 'reviews'> & {
  reviews: { nodes: GhReview[] }
  commits: { nodes: { commit: { statusCheckRollup: { contexts: { nodes: Check[] } } | null } }[] }
  baseRef: BaseRef
}

/** The most any of the base's rules asks for. */
export function requiredOf(base: BaseRef): number | null {
  if (base === null) return null
  const rules = base.rules.nodes.filter(r => r.type === 'PULL_REQUEST').map(r => r.parameters?.requiredApprovingReviewCount ?? 0)
  return Math.max(base.branchProtectionRule?.requiredApprovingReviewCount ?? 0, ...rules)
}

export function toOpenPr({ reviews, commits, baseRef, ...pr }: Node): OpenPr {
  const rollup = commits.nodes[0]?.commit.statusCheckRollup?.contexts.nodes ?? []
  return { ...pr, reviews: reviews.nodes, statusCheckRollup: rollup, required: requiredOf(baseRef) }
}

export async function myOpenPrs(host: Host, dirs: GhConfigDirs, slug: string): Promise<OpenPr[]> {
  const argv = ['gh', 'api', 'graphql', '-f', `query=${QUERY}`, '-f', `q=repo:${slug} is:pr is:open author:@me`]
  const r = await host.run(argv, { env: ghEnv(slug, host.home, dirs), timeoutMs: 30_000 })
  if (r.exitCode !== 0) throw new Error(`gh api graphql on ${slug}: ${r.stderr.trim()}`)
  const nodes = (JSON.parse(r.stdout) as { data: { search: { nodes: (Node | Record<string, never>)[] } } }).data.search.nodes
  return nodes.filter((n): n is Node => 'number' in n).map(toOpenPr)
}
