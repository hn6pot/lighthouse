// The Releases pane, opened by /release: per release repo, what waits (Fix, Features, Others), the Release button, the history.
import type { EngineInterface } from 'claude-code'
import type { Texts } from '../i18n'
import type { ReleaseEntry, ReleaseKind, ReleaseRepo } from '../model'
import { outcomeText } from '../release/collect'
import type { Buttons } from './band'

export const RELEASE_PANE = 'release'

/** Components, read atoms and `$` stay in register.ts: Claude Code refuses `$` crossing an import. */
export function drawReleasePane(
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  repos: readonly ReleaseRepo[],
  expanded: Readonly<Record<string, boolean>>,
  refreshing: boolean,
  pressed: Readonly<Record<string, boolean>>,
  buttons: Buttons,
  t: Texts,
) {
  const { Box, Button, Link, Text } = ui
  const busy = (key: string, label: string) => (pressed[key] ? `${label} …` : label)
  const refresh = <Button key="refresh" plain dimColor label={refreshing ? '⋯' : t.button.refresh} onPress={() => buttons.refresh()} />
  const S = t.releasePane

  const entryLine = (r: ReleaseRepo, e: ReleaseEntry, key: string) => (
    <Box key={`${key}-${e.sha}`} gap={1} paddingLeft={2}>
      {e.number !== null ? <Link href={`https://github.com/${r.slug}/pull/${e.number}`} label={`#${e.number}`} /> : null}
      <Text wrap="truncate-end">{e.title}</Text>
    </Box>
  )

  /** Fix and Features open; Others folded unless unfolded by the person. */
  const sections = (r: ReleaseRepo, entries: readonly ReleaseEntry[], key: string) => {
    const of = (kind: ReleaseKind) => entries.filter(e => e.kind === kind)
    const others = of('other')
    const othersKey = `${key}:others`
    const othersOpen = expanded[othersKey] ?? false
    return [
      ...(['fix', 'feat'] as const).flatMap(kind =>
        of(kind).length === 0
          ? []
          : [
              <Box key={`${key}:${kind}`} flexDirection="column">
                <Text bold color={kind === 'fix' ? 'error' : 'claude'}>{kind === 'fix' ? S.fix(of(kind).length) : S.feat(of(kind).length)}</Text>
                {of(kind).map(e => entryLine(r, e, `${key}:${kind}`))}
              </Box>,
            ],
      ),
      others.length === 0 ? null : (
        <Box key={othersKey} flexDirection="column">
          <Button key={`toggle-${othersKey}`} plain dimColor label={`${othersOpen ? '▼' : '▶'} ${S.others(others.length)}`} onPress={() => buttons.toggle(othersKey, othersOpen)} />
          {othersOpen && others.map(e => entryLine(r, e, othersKey))}
        </Box>
      ),
    ]
  }

  const action = (r: ReleaseRepo) => {
    const key = `release-${r.slug}`
    if (r.run.kind === 'running') return <Text key={key} color="warning">{`⟳ ${S.running(r.run.expected, r.runningMin ?? 0)}`}</Text>
    if (r.waiting.length === 0) return <Text key={key} dimColor>{S.nothing}</Text>
    return <Button key={key} label={busy(key, S.button(r.next))} onPress={() => buttons.run(key, () => buttons.release(r.slug, r.next))} />
  }

  /** Why the last press did nothing, or how the last release ended when it did not go well. */
  const problem = (r: ReleaseRepo) => {
    const lines: { text: string; color: 'error' | 'warning' }[] = []
    if (r.refusal) lines.push({ text: `✗ ${r.refusal}`, color: 'error' })
    if (r.run.kind === 'done' && r.run.outcome !== 'ok') {
      lines.push({ text: outcomeText(r.name, r.run, t), color: r.run.outcome === 'warning' ? 'warning' : 'error' })
      lines.push({ text: S.log(r.run.log), color: r.run.outcome === 'warning' ? 'warning' : 'error' })
    }
    return lines.map(l => <Text key={`problem-${r.slug}-${l.text}`} color={l.color} wrap="truncate-middle">{l.text}</Text>)
  }

  const historyBlock = (r: ReleaseRepo) =>
    r.history.length === 0 ? null : (
      <Box key={`history-${r.slug}`} flexDirection="column">
        <Text dimColor>{S.history}</Text>
        {r.history.map(past => {
          const key = `release:${r.slug}:${past.tag}`
          const open = expanded[key] ?? false
          return (
            <Box key={key} flexDirection="column" paddingLeft={2}>
              <Button key={`toggle-${key}`} plain label={`${open ? '▼' : '▶'} ${S.tag(past.tag, past.entries.length, past.ago ?? '?')} ✓`} onPress={() => buttons.toggle(key, open)} />
              {open && sections(r, past.entries, key)}
            </Box>
          )
        })}
      </Box>
    )

  const header = (r: ReleaseRepo) => {
    const last = r.history[0]?.ago
    return [r.name, r.tag ?? S.noTag, ...(last ? [S.last(last)] : [])].join(' · ')
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={1}>
        <Box flexGrow={1} flexShrink={1}>
          <Text dimColor wrap="truncate-end">{repos.length === 0 ? S.none : t.summary.toRelease(repos.reduce((n, r) => n + r.waiting.length, 0))}</Text>
        </Box>
        {refresh}
      </Box>
      {repos.map(r => (
        <Box key={`release:${r.slug}`} flexDirection="column" gap={1} borderStyle="round" borderColor="subtle" paddingX={1}>
          <Text bold wrap="truncate-end">{header(r)}</Text>
          {sections(r, r.waiting, `release:${r.slug}`)}
          {action(r)}
          {problem(r)}
          {historyBlock(r)}
        </Box>
      ))}
    </Box>
  )
}
