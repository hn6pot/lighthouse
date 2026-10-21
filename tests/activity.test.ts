import { expect, test } from 'claude-code/testing'
import { commandActivity, distribute, repoOf } from '../hooks/activity'
import { texts } from '../hooks/i18n'
import type { PrSummary, Repo, TreeState } from '../hooks/model'

const t = texts('fr')
const D: Repo[] = [
  { root: '/w/web', slug: 'acme/web', trees: ['/w/web', '/w/web/.worktrees/x'] },
  { root: '/w/other', slug: 'w/other', trees: ['/w/other'] },
]

test('repoOf: the repo one of whose trees holds the folder', () => {
  expect(repoOf('/w/web/.worktrees/x/src', D)?.root).toBe('/w/web')
  expect(repoOf('/w/elsewhere', D)).toBeUndefined()
})

test('commandActivity: what Claude is doing, and on what', () => {
  const here = '/w/web/.worktrees/x'
  expect(commandActivity('gh pr merge 4 --squash', here, D, t)).toEqual({ root: '/w/web', folder: here, number: 4, text: 'Claude fusionne #4' })
  expect(commandActivity('gh pr create --title t --head feat/x', here, D, t)).toEqual({ root: '/w/web', folder: here, branch: 'feat/x', text: 'Claude ouvre une PR' })
  expect(commandActivity('gh pr create --fill', here, D, t)).toEqual({ root: '/w/web', folder: here, text: 'Claude ouvre une PR' })
  expect(commandActivity('git push -u origin feat/x', here, D, t)).toEqual({ root: '/w/web', folder: here, branch: 'feat/x', text: 'Claude pousse' })
  expect(commandActivity('git rebase origin/main', here, D, t)?.text).toBe('Claude rebase')
  expect(commandActivity('git merge origin/main', here, D, t)?.text).toBe('Claude fusionne la base')
  expect(commandActivity('git commit -m x', here, D, t)?.text).toBe('Claude commite')
  expect(commandActivity('gh pr comment 9 -R w/other --body x', here, D, t)).toEqual({ root: '/w/other', folder: here, number: 9, text: 'Claude met à jour la PR' })
  expect(commandActivity('ls -la', here, D, t)).toBeNull()
  expect(commandActivity('git push', '/w/elsewhere', D, t)).toBeNull()
})

test('commandActivity in English', () => {
  const here = '/w/web/.worktrees/x'
  expect(commandActivity('gh pr merge 4 --squash', here, D, texts('en'))?.text).toBe('Claude is merging #4')
  expect(commandActivity('git commit -m x', here, D, texts('en'))?.text).toBe('Claude is committing')
})

const P: PrSummary = {
  number: 4, title: 't', url: 'u', branch: 'feat/x', path: '/w/web/.worktrees/x', head: 'a', ci: 'ok', failedChecks: [],
  review: 'none', draft: false, conflict: false, behind: false, unpushed: 0,
}
const A: TreeState = {
  root: '/w/web', name: 'web', slug: 'acme/web', branch: 'main', base: 'main', behind: 0, uncommitted: 0, prs: [P],
  branches: [{ name: 'feat/y', path: '/w/web/.worktrees/y', remote: 'none', unpushed: 0, ahead: 1 }],
}

test('distribute: on the PR, on the branch, else on the repo header', () => {
  const r = distribute(A, [
    { id: '1', root: '/w/web', number: 4, text: 'Claude fusionne #4' },
    { id: '2', root: '/w/web', folder: '/w/web/.worktrees/x/src', text: 'Claude commite' },
    { id: '3', root: '/w/web', branch: 'feat/y', text: 'Claude pousse' },
    { id: '4', root: '/w/web', folder: '/w/web', text: 'Claude récupère origin' },
    { id: '5', root: '/w/web', text: 'Claude y travaille' },
    { id: '6', root: '/w/other', text: 'elsewhere' },
  ])
  expect(r.byPr.get(4)).toEqual(['Claude fusionne #4', 'Claude commite'])
  expect(r.byBranch.get('feat/y')).toEqual(['Claude pousse'])
  expect(r.header).toEqual(['Claude récupère origin', 'Claude y travaille'])
})

test('a deploy command of Claude’s shows as « Claude déploie »', () => {
  const repos: Repo[] = [{ root: '/w/web', slug: 'acme/web', trees: ['/w/web'] }]
  expect(commandActivity('git pull && make deploy', '/w/web', repos, texts('fr'))).toEqual({ root: '/w/web', folder: '/w/web', text: 'Claude déploie' })
})
