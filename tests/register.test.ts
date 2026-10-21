import { expect, mock, test } from 'claude-code/testing'

test('/lighthouse opens the pane and answers nothing in the thread', { options: { language: 'fr' } }, async ($, on) => {
  // The kit answers neither session.start nor $ calls: we play the engine.
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.cwd', async () => ({ value: '/tmp' }))
  on('session.id', async () => ({ value: 'test' }))
  on('env.get', async () => ({ value: '/Users/me' }))
  on('process.run', async () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a git repository', isStdoutTruncated: false, isStderrTruncated: false } }))
  on('ui.open', async () => ({ value: { isPlaced: true } }))
  await $.session.start({ cwd: '/tmp', surface: null, isInteractive: false } as never)
  expect(await $.command.run({ command: 'lighthouse', args: '' } as never)).toEqual({})
})

test('no interface (claude -p): no git, no gh, nothing in the store', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const runs: string[] = []
  const writes: string[] = []
  // The store is on files: every write goes through fs.write.
  on('fs.exists', async () => ({ value: false }))
  on('fs.write', async (_$, e) => (writes.push(e.path), { value: undefined }))
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => ({ value: { command: e.name } }))
  on('session.cwd', async () => ({ value: '/tmp/lighthouse-x' }))
  on('session.id', async () => ({ value: 'test' }))
  on('session.surfaces', async () => ({ value: [] }))
  on('env.get', async () => ({ value: '/Users/me' }))
  on('process.run', async (_$, e) => {
    runs.push(JSON.stringify(e))
    return { value: { exitCode: 128, stdout: '', stderr: 'x', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('tool.call', async () => ({ result: 'ok' }) as never)
  await $.session.start({ cwd: '/tmp/lighthouse-x', surface: null, isInteractive: false } as never)
  await $.tool.call({ tool: 'Edit', tool_use_id: 't1', file_path: '/tmp/lighthouse-y/a.ts' } as never)
  await clock.advance(130_000)
  expect(runs).toEqual([])
  expect(writes).toEqual([])
})

// A minimal engine for a full tick: files in memory, git and gh simulated.
const TREE_X = 'worktree /w/web\nHEAD a\nbranch refs/heads/main\n\nworktree /w/web/.worktrees/x\nHEAD tip\nbranch refs/heads/feat/x\n'
const TRACKED_FILE_4 = '/Users/me/.lighthouse/state/tracked%3Aacme%2Fweb%234.json'

// The person's config file: how acme/web deploys, and the gh account of the acme repos.
const CONFIG_FILE = '/Users/me/.lighthouse/config.json'
const CONFIG = JSON.stringify({
  rules: { 'acme/web': { kind: 'manual', commands: [{ only_under: 'ec2/', command: 'make deploy' }, { only_under: 'mac/', command: 'make install' }] } },
  ghConfigDirs: { acme: '~/.config/gh-acme' },
})

function engine(on: Parameters<Parameters<typeof test>[1]>[1], files: Record<string, string>, session: { cwd: string }, hang?: RegExp, prs: unknown[] = [], extra: [RegExp, string][] = []) {
  const lines: string[] = []
  files[CONFIG_FILE] ??= CONFIG
  const move = (from: string, to: string) => {
    for (const f of Object.keys(files)) {
      if (f === from || f.startsWith(from + '/')) {
        files[to + f.slice(from.length)] = files[f]
        delete files[f]
      }
    }
  }
  const output = (stdout = '', exitCode = 0) => ({ value: { exitCode, stdout, stderr: '', isStdoutTruncated: false, isStderrTruncated: false } })
  on('session.start', async (_$, e) => ({ cwd: e.cwd }))
  on('command.register', async (_$, e) => (lines.push(`command ${e.name}: ${e.description}`), { value: { command: e.name } }))
  on('session.cwd', async () => ({ value: session.cwd }))
  on('session.id', async () => ({ value: 'me' }))
  on('session.surfaces', async () => ({ value: ['terminal'] }))
  on('env.get', async () => ({ value: '/Users/me' }))
  on('ui.notify', async () => ({ value: { isSent: true, channel: 'terminal' } }) as never)
  on('ui.open', async (_$, e) => (lines.push(`ui.open ${e.id} ${e.title}`), { value: { isPlaced: true } }))
  on('ui.close', async () => ({}) as never)
  on('fs.exists', async (_$, e) => ({ value: e.path in files }))
  on('fs.read', async (_$, e) => ({ value: files[e.path] }))
  on('fs.write', async (_$, e) => ((files[e.path] = e.text), { value: undefined }))
  on('process.run', async (_$, e) => {
    const argv = e.argv
    const line = argv.join(' ')
    lines.push(line)
    if (hang?.test(line)) return new Promise<never>(() => undefined) // a command that never returns
    for (const [pattern, text] of extra) if (pattern.test(line)) return output(text)
    if (/rev-parse --show-toplevel/.test(line)) return output(argv[2].startsWith('/w/web/.worktrees/x') ? '/w/web/.worktrees/x\n' : '/w/web\n')
    if (/--git-common-dir/.test(line)) return output('/w/web/.git\n')
    if (/remote get-url origin/.test(line)) return output('https://github.com/acme/web.git\n')
    if (/symbolic-ref/.test(line)) return output('origin/main\n')
    if (/branch --show-current/.test(line)) return output('main\n')
    if (/rev-list --count/.test(line)) return output('0\n')
    if (/worktree list --porcelain/.test(line)) return output(TREE_X)
    if (/rev-parse HEAD/.test(line)) return output('tip\n')
    if (/^gh pr list/.test(line)) return output(JSON.stringify(prs))
    if (/^gh api repos\//.test(line)) return output('{"allow_squash_merge":true}')
    if (/^ls -1 /.test(line)) {
      const d = argv[2] + '/'
      return output([...new Set(Object.keys(files).filter(f => f.startsWith(d)).map(f => f.slice(d.length).split('/')[0]))].join('\n'))
    }
    if (argv[0] === 'mv') return (move(argv[argv.length - 2], argv[argv.length - 1]), output())
    if (argv[0] === 'rm') return (move(argv[2], '/dev/null/x'), output())
    if (argv[0] === 'test' && argv[1] === '-e') return output('', 1)
    return output() // fetch, status, mkdir, test -d, worktree remove, branch -D, osascript…
  })
  return lines
}

test('the session folder follows the session: a worktree it went into is not cleaned up', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [TRACKED_FILE_4]: JSON.stringify({ key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'deployed', updatedAt: 0, prHead: 'tip' }),
  }
  const session = { cwd: '/w/web' }
  const lines = engine(on, files, session)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  session.cwd = '/w/web/.worktrees/x' // EnterWorktree
  await clock.advance(3_000)
  expect(lines.some(l => /worktree remove/.test(l))).toBe(false)
  expect(JSON.parse(files[TRACKED_FILE_4])).toMatchObject({ stage: 'cleanup-doubt', reason: 'cette conversation tourne dans ce worktree' })
})

test('heartbeat independent of ticks: recorded even during a blocked tick', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {}
  engine(on, files, { cwd: '/w/web' }, /fetch/) // the tick stays blocked on git fetch
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  await clock.advance(120_000)
  const entry = JSON.parse(files['/Users/me/.lighthouse/sessions/me.json'] ?? '{}')
  expect(entry.updatedAt).toBeGreaterThanOrEqual(120_000)
  expect(entry.cwd).toBe('/w/web')
})

test('the pane opens on its own once, not at every tick', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  expect(lines.filter(l => l === 'ui.open lighthouse Dépôts')).toHaveLength(1)
  await clock.advance(120_000)
  expect(lines.filter(l => l === 'ui.open lighthouse Dépôts')).toHaveLength(1)
  await $.command.run({ command: 'lighthouse', args: '' } as never)
  expect(lines.filter(l => l === 'ui.open lighthouse Dépôts')).toHaveLength(2)
})

const PR_GH = {
  number: 4, title: 'feat: x', url: 'https://github.com/acme/web/pull/4', state: 'OPEN', headRefName: 'feat/x', headRefOid: 'tip',
  baseRefName: 'main', mergeCommit: null, mergedAt: null, reviewDecision: 'CHANGES_REQUESTED',
  statusCheckRollup: [{ name: 'lint', status: 'COMPLETED', conclusion: 'FAILURE' }], isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'BLOCKED',
}
const PR_READY = { ...PR_GH, number: 5, title: 'fix: y', url: 'https://github.com/acme/web/pull/5', headRefName: 'fix/y', headRefOid: 'five', reviewDecision: 'APPROVED', statusCheckRollup: [], mergeStateStatus: 'CLEAN' }
const PANE = { component: 'Pane', requestId: 'lighthouse', props: { title: 'Dépôts', isFocused: false, bodyColumns: 60, placement: 'dock' } } as never

test('pane: PRs in color and their actions, on the terminal and the Desktop', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' }, undefined, [PR_GH, PR_READY])
  const agents: { prompt: string; cwd?: string; description?: string }[] = []
  on('agent.spawn', async (_$, e) => (agents.push(e), { model: 'm', agentId: `ag${agents.length}` }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  on('turn.complete', async () => ({ text: '' }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'lighthouse', surface, ...(PANE as object) } as never)
    expect(await ui.find({ type: 'Text', text: '● Changements demandés' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● CI ✗ lint' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● Revue approuvée' })).toBeDefined()
    expect(await ui.find({ key: 'merge-acme/web#4' })).toBeUndefined() // blocked: no merge
    expect(await ui.find({ key: 'comments-acme/web#4' })).toBeDefined()
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  await ui.press({ key: 'ci-acme/web#4' })
  expect(agents[0]?.prompt).toContain('La CI de la PR #4 (acme/web, branche feat/x) est rouge : lint.')
  expect(agents[0]?.prompt).toContain('Ne fusionne rien et ne déploie rien.')
  expect(agents[0]?.description).toBe('corrige la CI #4')
  expect(agents[0]?.cwd).toBe('/w/web') // no known worktree for feat/x here: the repo's folder
  expect(await ui.find({ type: 'Text', text: '⟳ Claude corrige la CI…' })).toBeDefined()
  // The kit gives no agentId (only the engine does): we check the 30-minute limit.
  await clock.advance(30 * 60_000)
  expect(await ui.find({ type: 'Text', text: '⟳ Claude corrige la CI…' })).toBeUndefined()

  // Merge: a first press asks for confirmation, the second merges the commit seen.
  await ui.press({ key: 'merge-acme/web#5' })
  expect(lines.some(l => /gh pr merge/.test(l))).toBe(false)
  expect((await ui.find({ key: 'merge-acme/web#5' }))?.text).toBe('Confirmer la fusion')
  await ui.press({ key: 'merge-acme/web#5' })
  expect(lines).toContain('gh pr merge 5 --squash --match-head-commit five -R acme/web')

  // A project always folds, even alone in its group.
  expect((await ui.find({ key: 'toggle-repo:here:/w/web' }))?.text).toBe('▼ web')
})

test('pane: a branch never pushed, Push and Open a PR', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const refs = ['feat/y\torigin/main\t\t/w/web/.worktrees/y', 'main\torigin/main\t\t/w/web'].join('\n')
  const lines = engine(on, {}, { cwd: '/w/web' }, undefined, [], [
    [/for-each-ref/, refs],
    [/rev-list --count origin\/main\.\.feat\/y/, '2\n'],
  ])
  const agents: { prompt: string; cwd?: string }[] = []
  on('agent.spawn', async (_$, e) => (agents.push(e), { model: 'm', agentId: 'ag1' }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await ui.find({ type: 'Text', text: '● 2 commits jamais poussés' })).toBeDefined()
  await ui.press({ key: 'push-/w/web@feat/y' })
  expect(lines).toContain('git -C /w/web/.worktrees/y push -u origin feat/y')
  await ui.press({ key: 'openpr-/w/web@feat/y' })
  expect(agents[0]?.prompt).toContain('Ouvre une PR pour la branche feat/y de acme/web (base main)')
  expect(agents[0]?.cwd).toBe('/w/web/.worktrees/y')
  expect(await ui.find({ type: 'Text', text: '⟳ Claude ouvre la PR…' })).toBeDefined()
})

test('a git or gh command starts a tick within seconds, and the base fetch', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' })
  on('tool.call', async () => ({ result: 'ok' }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ticks = () => lines.filter(l => / for-each-ref /.test(l)).length
  const ghCalls = () => lines.filter(l => /^gh pr list/.test(l)).length
  const fetches = () => lines.filter(l => / fetch /.test(l)).length
  expect(ticks()).toBe(1)
  expect(ghCalls()).toBe(1)
  expect(fetches()).toBe(1)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'ls' } as never)
  await clock.advance(2_000)
  expect(ticks()).toBe(1) // neither git nor gh: we wait for the next tick
  await $.tool.call({ tool: 'Bash', tool_use_id: 't2', command: 'gh pr merge 4 --squash' } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't3', command: 'git -C /w/web pull' } as never)
  await clock.advance(2_000)
  expect(ticks()).toBe(2) // two close commands: a single tick
  expect(ghCalls()).toBe(2) // after a command, GitHub is asked again at once
  expect(fetches()).toBe(2) // a merge or a pull: the base is reread without waiting 10 minutes
  await clock.advance(10_000)
  expect(ticks()).toBe(3) // the regular tick, every 10 seconds
  expect(ghCalls()).toBe(2) // ...reading GitHub from the shared cache while it is fresh
  await clock.advance(30_000)
  expect(ticks()).toBe(6)
  expect(ghCalls()).toBe(3) // GitHub asked again once the cache is 30 seconds old
})

test('during a git command of Claude’s, its ⟳ line; during its turn, « Claude y travaille »', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  engine(on, {}, { cwd: '/w/web' }, undefined, [PR_GH])
  on('turn.complete', async () => ({ text: '' }) as never)
  let seenDuring: unknown
  let ui: Awaited<ReturnType<typeof $.ui.mount>> | undefined
  on('tool.call', async () => {
    seenDuring = await ui?.find({ type: 'Text', text: '⟳ Claude fusionne #4…' })
    return { result: 'ok' } as never
  })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'gh pr merge 4 --squash' } as never)
  expect(seenDuring).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '⟳ Claude fusionne #4…' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '  ⟳ Claude y travaille' })).toBeDefined()
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't' } as never)
  expect(await ui.find({ type: 'Text', text: '  ⟳ Claude y travaille' })).toBeUndefined()
})

test('language en: the pane, its buttons and the agent’s instructions in English', { options: { language: 'en' } }, async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' }, undefined, [PR_GH, PR_READY])
  const agents: { prompt: string; description?: string }[] = []
  on('agent.spawn', async (_$, e) => (agents.push(e), { model: 'm', agentId: `ag${agents.length}` }) as never)
  on('ui.toast', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  expect(lines).toContain('command lighthouse: State of the session’s repos and their PRs')
  expect(lines).toContain('ui.open lighthouse Repos')
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'lighthouse', surface, ...(PANE as object) } as never)
    expect((await ui.find({ key: 'toggle-repo:here:/w/web' }))?.text).toBe('▼ web')
    expect(await ui.find({ type: 'Text', text: 'main · up to date' })).toBeDefined() // this session: no PR has its worktree here
    expect(await ui.find({ type: 'Text', text: '2 PRs' })).toBeDefined() // they are under « No known session »
    expect((await ui.find({ key: 'toggle-group:unknown' }))?.text).toBe('▼ No known session')
    expect(await ui.find({ type: 'Text', text: '● Changes requested' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '● Review approved' })).toBeDefined()
    expect((await ui.find({ key: 'comments-acme/web#4' }))?.text).toBe('Address comments')
    expect((await ui.find({ key: 'merge-acme/web#5' }))?.text).toBe('Merge')
    await ui.unmount()
  }
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  await ui.press({ key: 'ci-acme/web#4' })
  expect(agents[0]?.prompt).toContain('The CI of PR #4 (acme/web, branch feat/x) is red: lint.')
  expect(agents[0]?.prompt).toContain('Do not merge anything and do not deploy anything.')
  expect(agents[0]?.description).toBe('Fix the CI of #4')
  expect(await ui.find({ type: 'Text', text: '⟳ Claude is fixing the CI…' })).toBeDefined()
  await ui.press({ key: 'merge-acme/web#5' })
  expect((await ui.find({ key: 'merge-acme/web#5' }))?.text).toBe('Confirm merge')
})

test('a merged PR keeps its card: merged into main, then its deploy', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [TRACKED_FILE_4]: JSON.stringify({ key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'deploy-doubt', reason: 'r', updatedAt: 0, title: 'feat: a long title' }),
  }
  engine(on, files, { cwd: '/w/web' })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await ui.find({ type: 'Text', text: 'feat: a long title' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● Fusionnée dans main' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● Déploiement à confirmer (r)' })).toBeDefined()
  expect(await ui.find({ key: 'p-deploy-acme/web#4' })).toBeDefined()
})

test('a cleaned PR: a check fills up, stays a moment, then the card goes', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = {
    [TRACKED_FILE_4]: JSON.stringify({ key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'cleaned', updatedAt: 0, title: 'feat: x' }),
  }
  engine(on, files, { cwd: '/w/web' })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await ui.find({ type: 'Text', text: '◌ Déployée · worktree nettoyé' })).toBeDefined()
  await clock.advance(150)
  expect(await ui.find({ type: 'Text', text: '◔ Déployée · worktree nettoyé' })).toBeDefined()
  await clock.advance(600)
  expect(await ui.find({ type: 'Text', text: '✓ Déployée · worktree nettoyé' })).toBeDefined()
  await clock.advance(4_000)
  expect(await ui.find({ type: 'Text', text: 'feat: x' })).toBeUndefined()
  await clock.advance(10_000) // the next ticks do not bring it back
  expect(await ui.find({ type: 'Text', text: 'feat: x' })).toBeUndefined()
})

test('the Refresh button runs a tick at once, asking GitHub and rereading the base', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  const ghCalls = () => lines.filter(l => /^gh pr list/.test(l)).length
  const fetches = () => lines.filter(l => / fetch /.test(l)).length
  expect([ghCalls(), fetches()]).toEqual([1, 1])
  expect((await ui.find({ key: 'refresh' }))?.text).toBe('↻')
  await ui.press({ key: 'refresh' })
  expect([ghCalls(), fetches()]).toEqual([2, 2]) // at once, no wait
  expect((await ui.find({ key: 'refresh' }))?.text).toBe('↻') // back once the tick has drawn
})

test('PRs and branches are grouped by session: this one, another (named by its first prompt), unknown', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const refs = ['feat/y\torigin/main\t\t/w/web/.worktrees/y', 'feat/z\t\t\t', 'main\torigin/main\t\t/w/web'].join('\n')
  const files: Record<string, string> = {
    '/Users/me/.lighthouse/sessions/other.json': JSON.stringify({ cwd: '/w/web/.worktrees/y', trees: ['/w/web/.worktrees/y'], updatedAt: 0, label: 'Fix the CI' }),
  }
  engine(on, files, { cwd: '/w/web' }, undefined, [], [[/for-each-ref/, refs], [/rev-list --count origin\/main\.\.feat\//, '1\n']])
  on('session.messages', async () => ({ value: [{ role: 'user', text: 'Work on   web\nplease' }] }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await ui.find({ key: 'toggle-group:here' })).toBeUndefined() // this session stays first and open
  expect(await ui.find({ type: 'Text', text: 'Cette conversation' })).toBeDefined()
  expect((await ui.find({ key: 'toggle-group:others:Fix the CI' }))?.text).toBe('▼ Autre conversation · « Fix the CI »')
  expect((await ui.find({ key: 'toggle-group:unknown' }))?.text).toBe('▼ Sans conversation connue')
  // Folding another session's group hides its cards, the others stay.
  expect(await ui.find({ key: 'push-/w/web@feat/y' })).toBeDefined()
  await ui.press({ key: 'toggle-group:others:Fix the CI' })
  expect(await ui.find({ key: 'push-/w/web@feat/y' })).toBeUndefined()
  expect((await ui.find({ key: 'toggle-group:others:Fix the CI' }))?.text).toBe('▶ Autre conversation · « Fix the CI »')
  expect(await ui.find({ key: 'push-/w/web@feat/z' })).toBeDefined()
  expect(JSON.parse(files['/Users/me/.lighthouse/sessions/me.json'] ?? '{}').label).toBe('Work on web please')
})

const DOUBT_4 = JSON.stringify({ key: 'acme/web#4', slug: 'acme/web', root: '/w/web', number: 4, branch: 'feat/x', base: 'main', stage: 'deploy-doubt', reason: 'r', updatedAt: 0, title: 'feat: x' })

test('the session runs the deploy itself: no Deploy button, the card says it is deploying here', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TRACKED_FILE_4]: DOUBT_4 }
  engine(on, files, { cwd: '/w/web' })
  on('tool.call', async () => ({ result: 'boom', isError: true }) as never) // the deploy fails: still to do, but handled here
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await ui.find({ key: 'p-deploy-acme/web#4' })).toBeDefined()
  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'cd /w/web && make deploy' } as never)
  await clock.advance(2_000)
  expect(JSON.parse(files[TRACKED_FILE_4] ?? '{}')).toMatchObject({ stage: 'deploy-doubt', handledBy: 'me' })
  expect(await ui.find({ key: 'p-deploy-acme/web#4' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: '● Déploiement en cours dans cette conversation' })).toBeDefined()
})

test('the session’s deploy command succeeds: the PR is deployed', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const files: Record<string, string> = { [TRACKED_FILE_4]: DOUBT_4 }
  engine(on, files, { cwd: '/w/web' })
  on('tool.call', async () => ({ result: { stdout: 'done' } }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  await $.tool.call({ tool: 'Bash', tool_use_id: 't1', command: 'cd /w/web && make deploy' } as never)
  expect(['deployed', 'cleanup-doubt', 'cleaned']).toContain(JSON.parse(files[TRACKED_FILE_4] ?? '{}').stage)
})

test('another session shows under its Desktop title, and ↗ opens it in the Desktop', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const refs = ['feat/y\torigin/main\t\t/w/web/.worktrees/y', 'main\torigin/main\t\t/w/web'].join('\n')
  const files: Record<string, string> = {
    '/Users/me/.lighthouse/sessions/other.json': JSON.stringify({ cwd: '/w/web/.worktrees/y', trees: ['/w/web/.worktrees/y'], updatedAt: 0, label: 'first prompt' }),
  }
  const D = '/Users/me/Library/Application Support/Claude/claude-code-sessions/o/p/local_abc.json'
  const lines = engine(on, files, { cwd: '/w/web' }, undefined, [], [
    [/for-each-ref/, refs],
    [/rev-list --count origin\/main\.\.feat\//, '1\n'],
    [/^find .*claude-code-sessions/, `${D}\n`],
    [/^grep -o -H/, `${D}:"sessionId":"local_abc"\n${D}:"cliSessionId":"other"\n${D}:"title":"Fix the pipeline"\n`],
  ])
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect((await ui.find({ key: 'toggle-group:others:Fix the pipeline' }))?.text).toBe('▼ Autre conversation · « Fix the pipeline »')
  await ui.press({ key: 'open-local_abc' })
  expect(lines).toContain('open claude://claude.ai/epitaxy/local_abc')
})

test('the tidy-up button opens a new Desktop session in the repo, its instruction typed', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect((await ui.find({ key: 'tidy-/w/web' }))?.text).toBe('Ménage')
  await ui.press({ key: 'tidy-/w/web' })
  const open = lines.find(l => l.startsWith('open claude://code/new?'))
  const params = new URL(open?.slice('open '.length) ?? 'x:').searchParams
  expect(params.get('folder')).toBe('/w/web')
  expect(params.get('q')).toContain('Fais le ménage dans le dépôt acme/web')
  expect(params.get('q')).toContain('Ne touche jamais')
  expect(params.get('q')).toContain('GH_CONFIG_DIR=/Users/me/.config/gh-acme gh pr list')
  expect(params.get('q')).toContain('push origin --delete <branche>')
})

test('a pressed button says it is working: « … » until its action is done, long enough to be seen', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const refs = ['feat/y\torigin/main\t\t/w/web/.worktrees/y', 'main\torigin/main\t\t/w/web'].join('\n')
  engine(on, {}, { cwd: '/w/web' }, undefined, [], [[/for-each-ref/, refs], [/rev-list --count origin\/main\.\.feat\/y/, '2\n']])
  on('ui.toast', async () => ({ value: undefined }) as never)
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  await ui.press({ key: 'push-/w/web@feat/y' })
  expect((await ui.find({ key: 'push-/w/web@feat/y' }))?.text).toBe('Pousser …')
  await clock.advance(1_000)
  expect((await ui.find({ key: 'push-/w/web@feat/y' }))?.text).toBe('Pousser')
})

test('without the language option, everything is in English', async ($, on) => {
  const clock = mock.clock(on)
  const lines = engine(on, {}, { cwd: '/w/web' })
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  expect(lines).toContain('ui.open lighthouse Repos')
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect((await ui.find({ key: 'tidy-/w/web' }))?.text).toBe('Tidy up')
})

test('the band above the prompt only shows what waits in this session', { options: { language: 'fr' } }, async ($, on) => {
  const clock = mock.clock(on)
  const doubt = (n: number, branch: string) =>
    JSON.stringify({ key: `acme/web#${n}`, slug: 'acme/web', root: '/w/web', number: n, branch, base: 'main', stage: 'deploy-doubt', reason: 'r', updatedAt: 0 })
  const files: Record<string, string> = {
    [TRACKED_FILE_4]: doubt(4, 'feat/x'), // its worktree is where this session works
    [TRACKED_FILE_4.replace('%234', '%235')]: doubt(5, 'feat/q'), // no local branch, launched by nobody here
  }
  const refs = ['feat/x\torigin/feat/x\t\t/w/web/.worktrees/x', 'main\torigin/main\t\t/w/web'].join('\n')
  engine(on, files, { cwd: '/w/web/.worktrees/x' }, undefined, [], [[/for-each-ref/, refs], [/rev-list --count origin\/main\.\.feat\/x/, '1\n']])
  await $.session.start({ cwd: '/w/web/.worktrees/x', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const band = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', component: 'AbovePrompt', props: {} } as never)
  expect(await band.find({ key: 'deploy-acme/web#4' })).toBeDefined()
  expect(await band.find({ key: 'deploy-acme/web#5' })).toBeUndefined()
  const pane = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await pane.find({ key: 'p-deploy-acme/web#5' })).toBeDefined() // still in the pane, under its session
})

test('the pane: a summary line, a frame per session, each PR with its progress, age, size, and the last release', async ($, on) => {
  const clock = mock.clock(on)
  const pr = { ...PR_GH, createdAt: new Date(0).toISOString(), updatedAt: new Date(0).toISOString(), additions: 120, deletions: 30, changedFiles: 8 }
  engine(on, {}, { cwd: '/w/web' }, undefined, [pr], [
    [/describe --tags --abbrev=0 origin\/main$/, 'v1.4.0\n'],
    [/rev-list --count v1\.4\.0\.\.origin\/main$/, '12\n'],
  ])
  await $.session.start({ cwd: '/w/web', surface: null, isInteractive: true } as never)
  await clock.advance(3_000)
  const ui = await $.ui.mount({ plugin: 'lighthouse', surface: 'desktop', ...(PANE as object) } as never)
  expect(await ui.find({ type: 'Text', text: '1 PR' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'This session' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'main · v1.4.0 +12' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '● Review' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' ─ ● CI' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'opened 1 min ago · updated 1 min ago · +120 −30 · 8 files' })).toBeDefined()
})
