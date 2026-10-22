import { expect, test } from 'claude-code/testing'
import { texts } from '../../hooks/i18n'
import type { LocalBranch, Owner, PrSummary, TreeState, Tracked } from '../../hooks/model'
import { actionPrompt, branchActions, branchChips, branchPrompt, eventLine, layout, prActions, prChips, prFacts, prLocalLine, prProgress, reviewFacts, summaryLine, trackedProgress, repoColor, repoCounts, repoDetails, repoHeader, shorten, tidyPrompt, trackedChips } from '../../hooks/ui/lines'

const t = texts('fr')
const P: PrSummary = {
  number: 98, title: 'feat: x', url: 'https://github.com/w/api/pull/98', branch: 'feat/x', path: null, head: 'abc',
  ci: 'ok', failedChecks: [], review: 'approved', draft: false, conflict: false, behind: false, unpushed: 0,
}
const A: TreeState = { root: '/r', name: 'api', slug: 'w/api', branch: 'feat/x', base: 'production', behind: 0, uncommitted: 0, prs: [], branches: [] }

test('repo header: behind, uncommitted, number of PRs', () => {
  expect(repoHeader({ ...A, behind: 12, uncommitted: 2, prs: [P, P] }, t)).toBe('api · feat/x ↓12 · ⚠ 2 non commités · 2 PR')
  expect(repoHeader({ ...A, branch: 'main' }, t)).toBe('api · main · à jour')
  expect(repoHeader({ ...A, prs: [P] }, t)).toBe('api · feat/x · 1 PR')
})

test('chips: review, CI, draft, conflict, behind, in color', () => {
  expect(prChips(P, t)).toEqual([
    { text: 'Revue approuvée', color: 'success' },
    { text: 'CI ✓', color: 'success' },
  ])
  expect(prChips({ ...P, draft: true, review: 'pending', ci: 'pending' }, t)).toEqual([
    { text: 'Brouillon', color: 'subtle' },
    { text: 'Revue en attente', color: 'warning' },
    { text: 'CI en cours', color: 'warning' },
  ])
  expect(prChips({ ...P, review: 'changes', ci: 'failing', failedChecks: ['lint', 'tests'], conflict: true, behind: true }, t)).toEqual([
    { text: 'Changements demandés', color: 'error' },
    { text: 'CI ✗ lint, tests', color: 'error' },
    { text: 'Conflits', color: 'error' },
    { text: 'En retard sur la base', color: 'warning' },
  ])
  expect(prChips({ ...P, review: 'none', ci: 'none' }, t)).toEqual([
    { text: 'Sans revue requise', color: 'subtle' },
    { text: 'Sans CI', color: 'subtle' },
  ])
})

test('actions: merge only if nothing blocks', () => {
  expect(prActions(P)).toEqual(['merge'])
  expect(prActions({ ...P, review: 'none', ci: 'none' })).toEqual(['merge'])
  expect(prActions({ ...P, review: 'pending' })).toEqual([])
  expect(prActions({ ...P, draft: true })).toEqual([])
  expect(prActions({ ...P, ci: 'pending' })).toEqual([])
  expect(prActions({ ...P, ci: 'failing', review: 'changes' })).toEqual(['fix-ci', 'comments'])
  expect(prActions({ ...P, conflict: true })).toEqual(['update'])
  expect(prActions({ ...P, behind: true })).toEqual(['merge', 'update'])
})

test('repo color: the worst of its PRs', () => {
  expect(repoColor(A, t)).toBe('subtle')
  expect(repoColor({ ...A, prs: [P] }, t)).toBe('success')
  expect(repoColor({ ...A, prs: [P, { ...P, review: 'pending' }] }, t)).toBe('warning')
  expect(repoColor({ ...A, prs: [{ ...P, review: 'pending' }, { ...P, ci: 'failing' }] }, t)).toBe('error')
  expect(repoColor({ ...A, uncommitted: 1 }, t)).toBe('warning')
})

test('instructions handed to Claude', () => {
  expect(actionPrompt('fix-ci', A, { ...P, ci: 'failing', failedChecks: ['lint'] }, t)).toBe(
    'La CI de la PR #98 (w/api, branche feat/x) est rouge : lint. Trouve pourquoi et corrige-la dans le worktree de cette branche, puis pousse.',
  )
  expect(actionPrompt('comments', A, P, t)).toBe(
    'Des changements sont demandés sur la PR #98 (w/api, branche feat/x). Lis les commentaires de revue (gh pr view 98 -R w/api --comments), traite-les dans le worktree de cette branche, puis pousse.',
  )
  expect(actionPrompt('update', A, { ...P, conflict: true }, t)).toBe(
    'Mets à jour la branche feat/x de la PR #98 (w/api) avec origin/production et résous les conflits, dans le worktree de cette branche, puis pousse.',
  )
  expect(actionPrompt('update', A, { ...P, behind: true }, t)).toBe(
    'Mets à jour la branche feat/x de la PR #98 (w/api) avec origin/production, dans le worktree de cette branche, puis pousse.',
  )
})

const B: LocalBranch = { name: 'feat/y', path: '/r/.worktrees/y', remote: 'none', unpushed: 0, ahead: 3 }

test('header: branches without PR count', () => {
  expect(repoHeader({ ...A, prs: [P], branches: [B] }, t)).toBe('api · feat/x · 1 PR · 1 sans PR')
})

test('PR with unpushed local commits: chip and Push', () => {
  expect(prChips({ ...P, unpushed: 2 }, t)).toContainEqual({ text: '↑2 non poussés', color: 'warning' })
  expect(prActions({ ...P, unpushed: 2 })).toEqual(['push'])
})

test('branches without PR: chips, actions, instruction', () => {
  expect(branchChips(B, t)).toEqual([{ text: '3 commits jamais poussés', color: 'warning' }])
  expect(branchChips({ ...B, ahead: 1 }, t)).toEqual([{ text: '1 commit jamais poussé', color: 'warning' }])
  expect(branchChips({ ...B, remote: 'ok', unpushed: 1 }, t)).toEqual([{ text: '↑1 non poussé', color: 'warning' }])
  expect(branchChips({ ...B, remote: 'ok' }, t)).toEqual([{ text: 'Poussée, sans PR', color: 'subtle' }])
  expect(branchChips({ ...B, remote: 'deleted' }, t)).toEqual([{ text: 'Branche distante supprimée', color: 'subtle' }])
  expect(branchActions(A, B)).toEqual(['push', 'open-pr'])
  expect(branchActions(A, { ...B, remote: 'ok' })).toEqual(['open-pr'])
  expect(branchActions(A, { ...B, remote: 'deleted' })).toEqual([])
  expect(branchActions(A, { ...B, name: 'production', remote: 'ok', unpushed: 2 })).toEqual(['push']) // the base: no PR
  expect(repoColor({ ...A, branches: [B] }, t)).toBe('warning')
  expect(branchPrompt(A, B, t)).toBe(
    'Ouvre une PR pour la branche feat/y de w/api (base production), depuis son worktree /r/.worktrees/y : pousse-la si besoin, suis le modèle de PR et les conventions du dépôt, puis donne-moi le lien.',
  )
})

const S = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'main', updatedAt: 0 } as Omit<Tracked, 'stage'>

test('event lines and buttons', () => {
  expect(eventLine({ ...S, stage: 'deploying', link: 'u' }, t)).toEqual({ text: '#7 x fusionnée → déploiement en cours', buttons: [] })
  expect(eventLine({ ...S, stage: 'deploy-doubt', reason: '3 templates' }, t)).toEqual({ text: '#7 x : déploiement à confirmer (3 templates)', buttons: ['deploy', 'clean'] })
  expect(eventLine({ ...S, stage: 'cleanup-doubt', reason: 'non commité' }, t)).toEqual({ text: '#7 x : nettoyage en attente (non commité)', buttons: ['clean'] })
  expect(eventLine({ ...S, stage: 'cleaned' }, t)).toEqual({ text: '#7 x : déployée → worktree nettoyé ✓', buttons: [] })
  expect(eventLine({ ...S, stage: 'failed', link: 'u' }, t)).toEqual({ text: '#7 x : déploiement en échec (u)', buttons: ['deploy', 'forget'] })
})

test('in English: header, chips, event line, instruction', () => {
  const en = texts('en')
  expect(repoHeader({ ...A, behind: 12, uncommitted: 2, prs: [P, P], branches: [B] }, en)).toBe('api · feat/x ↓12 · ⚠ 2 uncommitted · 2 PRs · 1 without PR')
  expect(repoHeader({ ...A, branch: 'main' }, en)).toBe('api · main · up to date')
  expect(prChips({ ...P, review: 'changes', ci: 'failing', failedChecks: ['lint'], unpushed: 1 }, en)).toEqual([
    { text: 'Changes requested', color: 'error' },
    { text: 'CI ✗ lint', color: 'error' },
    { text: '↑1 unpushed', color: 'warning' },
  ])
  expect(branchChips(B, en)).toEqual([{ text: '3 commits never pushed', color: 'warning' }])
  expect(eventLine({ ...S, stage: 'deploy-doubt', reason: '3 templates' }, en)).toEqual({ text: '#7 x: deploy to confirm (3 templates)', buttons: ['deploy', 'clean'] })
  expect(actionPrompt('fix-ci', A, { ...P, ci: 'failing', failedChecks: ['lint'] }, en)).toBe(
    'The CI of PR #98 (w/api, branch feat/x) is red: lint. Find out why and fix it in this branch’s worktree, then push.',
  )
})

test('shorten: long names keep their start and end', () => {
  expect(shorten('feat/x', 20)).toBe('feat/x')
  expect(shorten('feature/pipedrive-approval-screens-v2', 20)).toBe('feature/pi…creens-v2')
  expect(shorten('feature/pipedrive-approval-screens-v2', 20)).toHaveLength(20)
})

test('repo details: the header without the name, long branch names shortened', () => {
  expect(repoDetails({ ...A, prs: [P] }, t)).toBe('feat/x · 1 PR')
  expect(repoDetails({ ...A, branch: 'feature/pipedrive-approval-screens-v2', behind: 3 }, t)).toBe('feature/pipedr…al-screens-v2 ↓3')
})

test('failing checks: two named, the rest counted', () => {
  expect(prChips({ ...P, ci: 'failing', failedChecks: ['lint', 'tests', 'build', 'e2e'] }, t)).toContainEqual({ text: 'CI ✗ lint, tests +2', color: 'error' })
})

test('a merged PR says it is merged into its base, then where its deploy stands', () => {
  const M = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'main', updatedAt: 0 } as Omit<Tracked, 'stage'>
  const merged = { text: 'Fusionnée dans main', color: 'merged' }
  expect(trackedChips({ ...M, stage: 'merged' }, t)).toEqual([merged, { text: 'Déploiement en cours', color: 'warning' }])
  expect(trackedChips({ ...M, stage: 'deploying' }, t)).toEqual([merged, { text: 'Déploiement en cours', color: 'warning' }])
  expect(trackedChips({ ...M, stage: 'deploy-doubt', reason: 'r' }, t)).toEqual([merged, { text: 'Déploiement à confirmer (r)', color: 'warning' }])
  expect(trackedChips({ ...M, stage: 'failed' }, t)).toEqual([merged, { text: 'Déploiement en échec', color: 'error' }])
  expect(trackedChips({ ...M, stage: 'deployed' }, t)).toEqual([merged, { text: 'Déployée', color: 'success' }, { text: 'Nettoyage en cours', color: 'subtle' }])
  expect(trackedChips({ ...M, stage: 'cleanup-doubt', reason: 'r' }, t)).toEqual([merged, { text: 'Déployée', color: 'success' }, { text: 'Nettoyage en attente (r)', color: 'warning' }])
  expect(trackedChips({ ...M, stage: 'cleaned' }, t)).toEqual([merged, { text: 'Déployée', color: 'success' }, { text: 'Worktree nettoyé ✓', color: 'success' }])
  expect(trackedChips({ ...M, stage: 'merged' }, texts('en'))[0]).toEqual({ text: 'Merged into main', color: 'merged' })
})

test('what was understood of the deploy shows right after "merged into"', () => {
  const M = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'main', updatedAt: 0, note: 'Projet local : rien à déployer' } as Omit<Tracked, 'stage'>
  expect(trackedChips({ ...M, stage: 'cleanup-doubt', reason: 'r' }, t).map(c => c.text)).toEqual([
    'Fusionnée dans main', 'Projet local : rien à déployer', 'Déployée', 'Nettoyage en attente (r)',
  ])
})

test('layout: sessions, then projects, then cards; this session lists every repo it touched', () => {
  const here = { kind: 'here' } as const
  const other: Owner = { kind: 'others', labels: ['Fix the CI'] }
  const r1: TreeState = { ...A, root: '/r1', name: 'one', prs: [{ ...P, number: 1, owner: here }, { ...P, number: 2, owner: other }], branches: [] }
  const r2: TreeState = { ...A, root: '/r2', name: 'two', prs: [], branches: [{ name: 'feat/z', path: null, remote: 'none', unpushed: 0, ahead: 1, owner: { kind: 'unknown' } }] }
  const merged = { key: 'w/x#9', slug: 'w/x', root: '/r1', number: 9, branch: 'feat/m', base: 'main', stage: 'merged', updatedAt: 0, owner: other } as Tracked
  const groups = layout([r1, r2], [merged], t)
  expect(groups.map(g => [g.key, g.title, g.repos.map(r => r.tree.name)])).toEqual([
    ['here', 'Cette conversation', ['one', 'two']],
    ['others:Fix the CI', 'Autre conversation · « Fix the CI »', ['one']],
    ['unknown', 'Sans conversation connue', ['two']],
  ])
  expect(groups[0]?.repos[0]?.prs.map(p => p.number)).toEqual([1])
  expect(groups[0]?.repos[1]?.branches).toEqual([])
  expect(groups[1]?.repos[0]?.prs.map(p => p.number)).toEqual([2])
  expect(groups[1]?.repos[0]?.merged.map(s => s.number)).toEqual([9])
  expect(groups[2]?.repos[0]?.branches.map(b => b.name)).toEqual(['feat/z'])
})

test('repo counts: only the cards of the group', () => {
  expect(repoCounts([P], [], t)).toBe('1 PR')
  expect(repoCounts([], [], t)).toBe('')
})

test('a deploy handled in a session: no Deploy button, and the card says where it happens', () => {
  const M = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'main', updatedAt: 0, reason: 'r' } as Omit<Tracked, 'stage'>
  expect(eventLine({ ...M, stage: 'deploy-doubt', handled: 'here' }, t).buttons).toEqual([])
  expect(eventLine({ ...M, stage: 'failed', handled: 'other' }, t).buttons).toEqual(['forget'])
  expect(trackedChips({ ...M, stage: 'deploy-doubt', handled: 'here' }, t)).toEqual([
    { text: 'Fusionnée dans main', color: 'merged' }, { text: 'Déploiement en cours dans cette conversation', color: 'warning' },
  ])
  expect(trackedChips({ ...M, stage: 'deploying', handled: 'other' }, t)[1]).toEqual({ text: 'Déploiement en cours dans une autre conversation', color: 'warning' })
})

test('a branch stacked on a PR says so, and its PR is opened on top of that PR', () => {
  const B2: LocalBranch = { name: 'feat/y', path: null, remote: 'none', unpushed: 0, ahead: 3, stackedOn: 98 }
  expect(branchChips(B2, t)[0]).toEqual({ text: '↳ sur #98', color: 'subtle' })
  expect(branchPrompt({ ...A, prs: [P] }, B2, t)).toContain('(base feat/x, la branche de la PR #98)')
})

test('a PR card names its local branch', () => {
  expect(prLocalLine({ ...P, localBranch: 'claude/abc', path: '/r/.claude/worktrees/abc' }, t)).toBe('⎇ claude/abc (worktree)')
  expect(prLocalLine({ ...P, localBranch: 'feat/x' }, t)).toBe('⎇ feat/x')
  expect(prLocalLine(P, t)).toBeNull()
})

const en = texts('en')
const DAY = 24 * 3_600_000

test('progress of an open PR: review, CI, merge, then deploy and clean up still to come', () => {
  expect(prProgress(P, en)).toEqual([
    { label: 'Review', state: 'done' }, { label: 'CI', state: 'done' }, { label: 'Merge', state: 'now' },
    { label: 'Deploy', state: 'todo' }, { label: 'Clean up', state: 'todo' },
  ])
  expect(prProgress({ ...P, review: 'changes', ci: 'pending' }, en).map(s => s.state)).toEqual(['bad', 'now', 'todo', 'todo', 'todo'])
  expect(prProgress({ ...P, ci: 'failing' }, en)[1]).toEqual({ label: 'CI', state: 'bad' })
})

test('progress of a merged PR follows its deploy and its cleanup', () => {
  const M = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'main', updatedAt: 0 } as Omit<Tracked, 'stage'>
  const states = (stage: Tracked['stage']) => trackedProgress({ ...M, stage }, en).map(s => s.state)
  expect(states('deploying')).toEqual(['done', 'done', 'done', 'now', 'todo'])
  expect(states('deploy-doubt')).toEqual(['done', 'done', 'done', 'now', 'todo'])
  expect(states('failed')).toEqual(['done', 'done', 'done', 'bad', 'todo'])
  expect(states('deployed')).toEqual(['done', 'done', 'done', 'done', 'now'])
  expect(states('cleanup-doubt')).toEqual(['done', 'done', 'done', 'done', 'now'])
})

test('a PR’s age and size, and stale after 7 days without activity', () => {
  const now = 10 * DAY
  const p = { ...P, createdAt: now - 3 * DAY, updatedAt: now - 2 * 3_600_000, additions: 120, deletions: 30, files: 8 }
  expect(prFacts(p, now, en)).toEqual({ text: 'opened 3 d ago · updated 2 h ago · +120 −30 · 8 files', stale: false })
  expect(prFacts({ ...p, updatedAt: now - 8 * DAY }, now, en).stale).toBe(true)
  expect(prFacts(p, now, t).text).toBe('ouverte il y a 3 j · active il y a 2 h · +120 −30 · 8 fichiers')
  expect(prFacts(P, now, en)).toEqual({ text: '', stale: false }) // no dates known
})

test('summary line: PRs, what waits to be deployed, what waits to be pushed', () => {
  const B2: LocalBranch = { name: 'feat/y', path: null, remote: 'none', unpushed: 0, ahead: 3 }
  const trees = [{ ...A, prs: [P, { ...P, number: 2, unpushed: 1 }], branches: [B2] }]
  const doubt = { key: 'w/x#7', slug: 'w/x', root: '/r', number: 7, branch: 'feat/x', base: 'main', updatedAt: 0, stage: 'deploy-doubt' } as Tracked
  expect(summaryLine(trees, [doubt], en)).toBe('2 PRs · 1 to deploy · 2 to push')
  expect(summaryLine([{ ...A }], [], en)).toBe('nothing waiting')
})

test('summary line: what waits for a release', () => {
  expect(summaryLine([{ ...A }], [], t, 4)).toBe('4 à sortir')
  expect(summaryLine([{ ...A }], [], t, 0)).toBe('rien en attente')
})

test('the repo line shows the last release and how much came since', () => {
  expect(repoDetails({ ...A, release: { tag: 'v1.4.0', since: 12 } }, en)).toBe('feat/x · v1.4.0 +12')
  expect(repoDetails({ ...A, release: { tag: 'v1.4.0', since: 0 } }, en)).toBe('feat/x · v1.4.0')
})

test('tidy-up prompt: gh with the repo’s own account when it has one, quoted if needed', () => {
  const en = texts('en')
  expect(tidyPrompt(A, en, undefined)).toContain('2. For each branch other than production, find its PR: gh pr list -R w/api')
  expect(tidyPrompt(A, en, '/Users/me/.config/gh-acme')).toContain('find its PR: GH_CONFIG_DIR=/Users/me/.config/gh-acme gh pr list -R w/api')
  expect(tidyPrompt(A, en, "/Users/me/gh dirs/it's")).toContain(`GH_CONFIG_DIR='/Users/me/gh dirs/it'\\''s' gh pr list`)
})

test('a PR to review: its repo, its author, its last activity, and draft', () => {
  const r = { slug: 'acme/api', number: 9, title: 'x', url: 'u', author: 'alice', draft: true, updatedAt: 0 }
  expect(reviewFacts(r, 2 * 3_600_000, texts('en'))).toBe('acme/api · by alice · updated 2 h ago · Draft')
  expect(reviewFacts({ ...r, draft: false, updatedAt: undefined }, 0, t)).toBe('acme/api · par alice')
})
