// The band above the prompt: only what waits on the person (a doubt, a failure), with its buttons.
import type { EngineInterface } from 'claude-code'
import type { Texts } from '../i18n'
import type { Tracked } from '../model'
import { eventLine, type AskAction } from './lines'

/** Each action resolves once done, so its button can say it is working until then. */
export type Buttons = {
  /** Runs a button's action, its label saying « … » meanwhile. */
  run: (key: string, action: () => Promise<void> | void) => void
  deploy: (key: string) => Promise<void> | void
  clean: (key: string) => Promise<void> | void
  forget: (key: string) => Promise<void> | void
  /** Folds or unfolds a repo of the pane; `open` is its displayed state. */
  toggle: (root: string, open: boolean) => void
  /** Hands the repo's leftover worktrees and branches to a tidy-up agent. */
  tidy: (root: string) => Promise<void> | void
  /** Opens another session in the Desktop. */
  openSession: (desktopId: string) => Promise<void> | void
  /** Opens a local file (a page copy or a Markdown) with the system's `open`. */
  openPath: (path: string) => Promise<void> | void
  /** Runs a tick now, asking GitHub and rereading the base. */
  refresh: () => void
  merge: (root: string, number: number) => Promise<void> | void
  ask: (root: string, number: number, action: AskAction) => Promise<void> | void
  /** Pushes a local branch (a PR's or a branch without PR). */
  push: (root: string, branch: string, to?: string) => Promise<void> | void
  openPr: (root: string, branch: string) => Promise<void> | void
  /** Opens the PR's review in the intent mod (`/intent <link>`). */
  intent: (url: string) => Promise<void> | void
  /** Launches the release of a release repo; `shown` is the version its button showed. */
  release: (slug: string, shown: string) => Promise<void> | void
}

/** Components and `$` stay in register.ts: Claude Code refuses `$` crossing an import. */
export function drawBand(
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  events: readonly Tracked[],
  pressed: Readonly<Record<string, boolean>>,
  buttons: Buttons,
  t: Texts,
) {
  const busy = (key: string, label: string) => (pressed[key] ? `${label} …` : label)
  // Only what waits in this session: the other sessions' PRs stay in the pane, under their session.
  const waiting = events.filter(s => s.owner?.kind === 'here' && eventLine(s, t).buttons.length > 0)
  if (waiting.length === 0) return null
  const { Box, Button, Text } = ui

  return (
    <Box flexDirection="column">
      {waiting.map(s => {
        const { text, buttons: which } = eventLine(s, t)
        return (
          <Box key={s.key} gap={1}>
            <Text color={s.stage === 'failed' ? 'error' : 'warning'} wrap="truncate-end">● {text}</Text>
            {which.includes('deploy') && <Button key={`deploy-${s.key}`} label={busy(`deploy-${s.key}`, t.button.deploy)} onPress={() => buttons.run(`deploy-${s.key}`, () => buttons.deploy(s.key))} />}
            {which.includes('clean') && <Button key={`clean-${s.key}`} label={busy(`clean-${s.key}`, t.button.clean)} onPress={() => buttons.run(`clean-${s.key}`, () => buttons.clean(s.key))} />}
            {which.includes('forget') && <Button key={`forget-${s.key}`} label={busy(`forget-${s.key}`, t.button.forget)} onPress={() => buttons.run(`forget-${s.key}`, () => buttons.forget(s.key))} />}
          </Box>
        )
      })}
    </Box>
  )
}
