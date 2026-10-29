// The repos pane, on the side: one line per repo that unfolds onto its PRs, in color, with their actions.
import type { EngineInterface } from 'claude-code'
import { distribute, type Activity } from '../activity'
import type { Texts } from '../i18n'
import type { LocalBranch, PrSummary, ReviewRequest, TreeState, Tracked } from '../model'
import type { Buttons } from './band'
import { drawDocs } from './docs'
import { mayCut, unfold } from './unfold'
import { branchActions, branchChips, CHECK_FRAMES, prLocalLine, prProgress, summaryLine, trackedProgress, type Step, eventLine, layout, prActions, prChips, repoColor, repoCounts, repoDetails, shorten, trackedChips, type RepoInGroup, type SessionGroup } from './lines'

export const PANE = 'lighthouse'

/** Cells a card's line loses to its session frame (border and padding, both sides) and its own indent. */
const CARD_INDENT = 6

/** Components, read atoms and `$` stay in register.ts: Claude Code refuses `$` crossing an import. */
export function drawPane(
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  /** The pane's width in cells (0 when unknown): a branch name longer than its room unfolds on hover. */
  columns: number,
  trees: readonly TreeState[],
  events: readonly Tracked[],
  expanded: Readonly<Record<string, boolean>>,
  pendingMerge: string | null,
  activities: readonly Activity[],
  celebrating: Readonly<Record<string, number>>,
  refreshing: boolean,
  pressed: Readonly<Record<string, boolean>>,
  reviews: readonly ReviewRequest[],
  intent: boolean,
  /** Merged PRs waiting in the release repos: counted in the summary line. */
  toRelease: number,
  buttons: Buttons,
  t: Texts,
) {
  const { Box, Button, Link, Text } = ui
  // A pressed button says it is working until its action is done.
  const busy = (key: string, label: string) => (pressed[key] ? `${label} …` : label)
  // A small icon at the end of the first line: a mod cannot add to the pane's own title bar.
  const refresh = <Button key="refresh" plain dimColor label={refreshing ? '⋯' : t.button.refresh} onPress={() => buttons.refresh()} />
  /** "Review with intent", when the intent mod is there: it opens its review page on the PR. */
  const intentButton = (key: string, url: string) =>
    intent ? <Button key={key} label={busy(key, t.button.intent)} onPress={() => buttons.run(key, () => buttons.intent(url))} /> : null

  /** The PRs where my review is requested, in any repo: a frame of their own, last, that folds. */
  const reviewsFrame = () => {
    if (reviews.length === 0) return null
    const key = 'group:reviews'
    const open = expanded[key] ?? true
    return (
      <Box key={key} flexDirection="column" gap={1} borderStyle="round" borderColor="subtle" paddingX={1}>
        <Button key={`toggle-${key}`} plain label={`${open ? '▼' : '▶'} ${t.review.title(reviews.length)}`} onPress={() => buttons.toggle(key, open)} />
        {open &&
          reviews.map(r => {
            const id = `${r.slug}#${r.number}`
            return (
              <Box key={`review-${id}`} flexDirection="column" paddingLeft={2}>
                <Box gap={1}>
                  <Link href={r.url} label={`#${r.number}`} />
                  <Text wrap="truncate-end">{r.title}</Text>
                </Box>
                {r.facts ? <Text dimColor wrap="truncate-end">{r.facts}</Text> : null}
                <Box gap={1} flexWrap="wrap">
                  <Link href={r.url} label={t.button.openOnGitHub} />
                  {intentButton(`review-intent-${id}`, r.url)}
                </Box>
              </Box>
            )
          })}
      </Box>
    )
  }

  if (trees.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Box gap={1}>
          <Box flexGrow={1}>
            <Text dimColor>{t.noRepo}</Text>
          </Box>
          {refresh}
        </Box>
        {reviewsFrame()}
      </Box>
    )
  }

  const STEP_COLOR = { done: 'success', now: 'warning', bad: 'error', todo: 'subtle' } as const
  /** « ● Review ─ ● CI ─ ○ Merge ─ ○ Deploy ─ ○ Clean up », each step in its color. */
  const progress = (steps: readonly Step[], key: string) => (
    <Box key={`${key}-progress`} flexWrap="wrap">
      {steps.map((s, i) => (
        <Text key={`${key}-step-${s.label}`} color={STEP_COLOR[s.state]}>{`${i > 0 ? ' ─ ' : ''}${s.state === 'todo' ? '○' : '●'} ${s.label}`}</Text>
      ))}
    </Box>
  )

  const inProgress = (texts: readonly string[] | undefined, key: string) =>
    (texts ?? []).map(x => (
      <Text key={`${key}-act-${x}`} color="claude" wrap="truncate-end">⟳ {x}…</Text>
    ))

  const prCard = (a: TreeState, p: PrSummary, texts: readonly string[] | undefined) => {
    const key = `${a.slug ?? a.root}#${p.number}`
    const actions = prActions(p)
    return (
      <Box key={key} flexDirection="column" paddingLeft={2} marginTop={1}>
        <Box gap={1}>
          <Link href={p.url} label={`#${p.number}`} />
          <Text wrap="truncate-end">{p.title}</Text>
        </Box>
        {prLocalLine(p, t) && (
          <Box key={`local-${key}`} flexDirection="column">
            <Text dimColor wrap="truncate-middle">{prLocalLine(p, t)}</Text>
            {unfold(ui, prLocalLine(p, t) ?? '', mayCut(prLocalLine(p, t) ?? '', columns, CARD_INDENT))}
          </Box>
        )}
        {progress(prProgress(p, t), key)}
        {drawDocs(ui, p.docs, key, buttons, busy, t)}
        {p.facts?.text ? <Text dimColor={!p.facts.stale} color={p.facts.stale ? 'warning' : undefined} wrap="truncate-end">{`${p.facts.stale ? '⚠ ' : ''}${p.facts.text}`}</Text> : null}
        <Box columnGap={2} flexWrap="wrap">
          {prChips(p, t).map(x => (
            <Text key={`${key}-${x.text}`} color={x.color}>● {x.text}</Text>
          ))}
        </Box>
        {inProgress(texts, key)}
        <Box gap={1} flexWrap="wrap">
          <Link href={p.url} label={t.button.openOnGitHub} />
          {intentButton(`intent-${key}`, p.url)}
          {actions.includes('merge') && (
            <Button
              key={`merge-${key}`}
              label={pendingMerge === key ? t.button.confirmMerge : busy(`merge-${key}`, t.button.merge)}
              variant={pendingMerge === key ? 'primary' : undefined}
              onPress={() => buttons.run(`merge-${key}`, () => buttons.merge(a.root, p.number))}
            />
          )}
          {actions.includes('push') && <Button key={`push-${key}`} label={busy(`push-${key}`, t.button.push)} onPress={() => buttons.run(`push-${key}`, () => buttons.push(a.root, p.localBranch ?? p.branch, p.branch))} />}
          {actions.includes('fix-ci') && <Button key={`ci-${key}`} label={busy(`ci-${key}`, t.button.fixCi)} onPress={() => buttons.run(`ci-${key}`, () => buttons.ask(a.root, p.number, 'fix-ci'))} />}
          {actions.includes('comments') && <Button key={`comments-${key}`} label={busy(`comments-${key}`, t.button.comments)} onPress={() => buttons.run(`comments-${key}`, () => buttons.ask(a.root, p.number, 'comments'))} />}
          {actions.includes('update') && <Button key={`update-${key}`} label={busy(`update-${key}`, t.button.update)} onPress={() => buttons.run(`update-${key}`, () => buttons.ask(a.root, p.number, 'update'))} />}
        </Box>
      </Box>
    )
  }

  const branchCard = (a: TreeState, b: LocalBranch, texts: readonly string[] | undefined, indent = 0) => {
    const key = `${a.root}@${b.name}`
    const actions = branchActions(a, b)
    return (
      <Box key={key} flexDirection="column" paddingLeft={2 + indent} marginTop={1}>
        <Box key={`name-${key}`} flexDirection="column">
          <Box gap={1}>
            <Text wrap="truncate-middle">{`⎇ ${b.name}`}</Text>
            {b.path && <Text dimColor>{t.worktree.trim()}</Text>}
          </Box>
          {unfold(ui, `⎇ ${b.name}`, mayCut(`⎇ ${b.name}${b.path ? t.worktree : ''}`, columns, CARD_INDENT + indent))}
        </Box>
        <Box columnGap={2} flexWrap="wrap">
          {branchChips(b, t).map(x => (
            <Text key={`${key}-${x.text}`} color={x.color}>● {x.text}</Text>
          ))}
        </Box>
        {drawDocs(ui, b.docs, key, buttons, busy, t)}
        {inProgress(texts, key)}
        {actions.length > 0 && (
          <Box gap={1}>
            {actions.includes('push') && <Button key={`push-${key}`} label={busy(`push-${key}`, t.button.push)} onPress={() => buttons.run(`push-${key}`, () => buttons.push(a.root, b.name))} />}
            {actions.includes('open-pr') && <Button key={`openpr-${key}`} label={busy(`openpr-${key}`, t.button.openPr)} onPress={() => buttons.run(`openpr-${key}`, () => buttons.openPr(a.root, b.name))} />}
          </Box>
        )}
      </Box>
    )
  }

  /** A merged PR: its title, merged into its base, then where its deploy and cleanup stand. */
  const mergedCard = (s: Tracked) => {
    const { buttons: which } = eventLine(s, t)
    const url = `https://github.com/${s.slug}/pull/${s.number}`
    if (s.stage === 'cleaned') {
      // Cleaned: only while its check is drawn, then the card goes.
      const frame = celebrating[s.key]
      if (frame === undefined) return null
      return (
        <Box key={`ev-${s.key}`} flexDirection="column" paddingLeft={2} marginTop={1}>
          <Box gap={1}>
            <Link href={url} label={`#${s.number}`} />
            <Text wrap="truncate-end">{s.title ?? s.branch}</Text>
          </Box>
          <Text color="success" bold>{`${CHECK_FRAMES[frame] ?? '✓'} ${t.chip.doneCleaned}`}</Text>
        </Box>
      )
    }
    return (
      <Box key={`ev-${s.key}`} flexDirection="column" paddingLeft={2} marginTop={1}>
        <Box gap={1}>
          <Link href={url} label={`#${s.number}`} />
          <Text wrap="truncate-end">{s.title ?? s.branch}</Text>
        </Box>
        <Box columnGap={2} flexWrap="wrap">
          {trackedChips(s, t).map(x => (
            <Text key={`${s.key}-${x.text}`} color={x.color}>● {x.text}</Text>
          ))}
        </Box>
        {progress(trackedProgress(s, t), `ev-${s.key}`)}
        {drawDocs(ui, s.docs, `ev-${s.key}`, buttons, busy, t)}
        {which.length > 0 && (
          <Box gap={1}>
            {which.includes('deploy') && <Button key={`p-deploy-${s.key}`} label={busy(`p-deploy-${s.key}`, t.button.deploy)} onPress={() => buttons.run(`p-deploy-${s.key}`, () => buttons.deploy(s.key))} />}
            {which.includes('clean') && <Button key={`p-clean-${s.key}`} label={busy(`p-clean-${s.key}`, t.button.clean)} onPress={() => buttons.run(`p-clean-${s.key}`, () => buttons.clean(s.key))} />}
            {which.includes('forget') && <Button key={`p-forget-${s.key}`} label={busy(`p-forget-${s.key}`, t.button.forget)} onPress={() => buttons.run(`p-forget-${s.key}`, () => buttons.forget(s.key))} />}
          </Box>
        )}
      </Box>
    )
  }

  const groups = layout(trees, events, t)

  /** A repo inside a group: its line, always foldable, then its cards. */
  const repoBlock = (g: SessionGroup, r: RepoInGroup) => {
    const key = `repo:${g.key}:${r.tree.root}`
    const open = expanded[key] ?? true
    const isHere = g.key === 'here'
    const view: TreeState = { ...r.tree, prs: r.prs, branches: r.branches, uncommitted: isHere ? r.tree.uncommitted : 0 }
    const acts = distribute(view, activities)
    return (
      <Box key={key} flexDirection="column">
        <Box gap={1}>
          <Text color={repoColor(view, t)}>●</Text>
          {/* The label alone: the desktop draws a Button's label, never its children. */}
          <Button key={`toggle-${key}`} plain label={`${open ? '▼' : '▶'} ${r.tree.name}`} onPress={() => buttons.toggle(key, open)} />
          <Box flexGrow={1} flexShrink={1}>
            <Text dimColor wrap="truncate-end">{isHere ? repoDetails(view, t) : repoCounts(r.prs, r.branches, t)}</Text>
          </Box>
          {isHere && <Button key={`tidy-${r.tree.root}`} plain dimColor label={busy(`tidy-${r.tree.root}`, t.button.tidy)} onPress={() => buttons.run(`tidy-${r.tree.root}`, () => buttons.tidy(r.tree.root))} />}
        </Box>
        {isHere && acts.header.length > 0 && <Text color="claude" wrap="truncate-end">{`  ⟳ ${acts.header.join(' · ')}`}</Text>}
        {/* Each PR, then the branches stacked on it, then the other branches. */}
        {open &&
          r.prs.map(p => [
            prCard(r.tree, p, acts.byPr.get(p.number)),
            ...r.branches.filter(b => b.stackedOn === p.number).map(b => branchCard(r.tree, b, acts.byBranch.get(b.name), 2)),
          ])}
        {open && r.branches.filter(b => !r.prs.some(p => p.number === b.stackedOn)).map(b => branchCard(r.tree, b, acts.byBranch.get(b.name)))}
        {open && r.merged.map(mergedCard)}
      </Box>
    )
  }

  return (
    <Box flexDirection="column" gap={1}>
      {/* The essentials, even with everything folded; refresh at the end of the line. */}
      <Box gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">{summaryLine(trees, events, t, toRelease)}</Text>
        </Box>
        {refresh}
      </Box>
      {groups.map(g => {
        const key = `group:${g.key}`
        // One frame per session: this one first, in Claude's color and always open; the others fold.
        const isHere = g.key === 'here'
        const open = isHere || (expanded[key] ?? true)
        return (
          <Box key={key} flexDirection="column" gap={1} borderStyle="round" borderColor={isHere ? 'claude' : 'subtle'} paddingX={1}>
            <Box gap={1}>
              {isHere ? (
                <Text bold color="claude">{g.title}</Text>
              ) : (
                <Button key={`toggle-${key}`} plain label={`${open ? '▼' : '▶'} ${shorten(g.title, 60)}`} onPress={() => buttons.toggle(key, open)} />
              )}
              {g.sessions.map(s =>
                s.desktopId ? <Button key={`open-${s.desktopId}`} plain dimColor label={busy(`open-${s.desktopId}`, '↗')} onPress={() => buttons.run(`open-${s.desktopId}`, () => buttons.openSession(s.desktopId ?? ''))} /> : null,
              )}
            </Box>
            {open && g.repos.map(r => repoBlock(g, r))}
          </Box>
        )
      })}
      {reviewsFrame()}
    </Box>
  )
}
