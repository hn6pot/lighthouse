// The answer of GitHub's GraphQL search for my open PRs, built from PRs shaped like `gh pr list` gave them.

/** The command that lists my open PRs. */
export const OPEN_PRS = /^gh api graphql/

/** `required`: the approvals the base's ruleset asks for, none when absent. */
export function searchAnswer(prs: readonly object[]): string {
  const nodes = prs.map(p => {
    const { statusCheckRollup = [], reviews = [], required, ...pr } = p as { statusCheckRollup?: unknown[]; reviews?: unknown[]; required?: number }
    return {
      ...pr,
      reviews: { nodes: reviews },
      commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: statusCheckRollup } } } }] },
      baseRef: {
        branchProtectionRule: null,
        rules: { nodes: required === undefined ? [] : [{ type: 'PULL_REQUEST', parameters: { requiredApprovingReviewCount: required } }] },
      },
    }
  })
  return JSON.stringify({ data: { search: { nodes } } })
}
