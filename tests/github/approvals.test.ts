import { expect, test } from 'claude-code/testing'
import { countReviews } from '../../hooks/github/approvals'

const r = (login: string | null, state: string) => ({ author: login === null ? null : { login }, state })

test('countReviews: nobody looked', () => {
  expect(countReviews([], 'me')).toEqual({ approvals: 0, reviewers: 0 })
})

test('countReviews: each person once, by their last say; a comment leaves an approval standing', () => {
  const reviews = [
    r('bob', 'APPROVED'),
    r('bob', 'COMMENTED'),
    r('carol', 'CHANGES_REQUESTED'),
    r('carol', 'APPROVED'),
    r('dave', 'APPROVED'),
    r('dave', 'CHANGES_REQUESTED'),
    r('erin', 'COMMENTED'),
  ]
  expect(countReviews(reviews, 'me')).toEqual({ approvals: 2, reviewers: 4 })
})

test('countReviews: a dismissed approval, a pending draft, the author and a deleted account do not count', () => {
  const reviews = [r('bob', 'APPROVED'), r('bob', 'DISMISSED'), r('carol', 'PENDING'), r('me', 'COMMENTED'), r(null, 'APPROVED')]
  expect(countReviews(reviews, 'me')).toEqual({ approvals: 0, reviewers: 1 })
})
