// How many people approved a PR, and how many reviewed it at all, from its reviews.

export type GhReview = { author: { login: string } | null; state: string }

/** States that say where a reviewer stands; a comment leaves an earlier approval standing. */
const OPINIONS = ['APPROVED', 'CHANGES_REQUESTED', 'DISMISSED']

/** Distinct people whose last say is an approval, and those who left any submitted review; the PR's author is left out. */
export function countReviews(reviews: readonly GhReview[], author: string | undefined): { approvals: number; reviewers: number } {
  const said = new Map<string, string>()
  const reviewers = new Set<string>()
  for (const r of reviews) {
    const login = r.author?.login
    if (login === undefined || login === author || r.state === 'PENDING') continue
    reviewers.add(login)
    if (OPINIONS.includes(r.state)) said.set(login, r.state) // reviews come oldest first
  }
  return { approvals: [...said.values()].filter(s => s === 'APPROVED').length, reviewers: reviewers.size }
}
