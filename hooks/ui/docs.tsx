// A card's specs and plans: folded, its spec's page and a toggle; unfolded, one line each, with their page, its local copy, or the Markdown.
import type { EngineInterface } from 'claude-code'
import type { Texts } from '../i18n'
import type { BranchDoc } from '../model'
import type { Buttons } from './band'
import { docLabel, docSummary } from './doc-lines'

/** Components and `$` stay in register.ts: this draws with the resolved `ui` it is given. */
export function drawDocs(
  ui: ReturnType<EngineInterface['ui']['resolve']>,
  docs: readonly BranchDoc[] | undefined,
  key: string,
  /** Unfolded by the person (folded by default). */
  open: boolean,
  buttons: Buttons,
  busy: (key: string, label: string) => string,
  t: Texts,
) {
  const { Box, Button, Link, Text } = ui
  if (!docs || docs.length === 0) return null
  const { lead, count } = docSummary(docs)
  return (
    <Box key={`docs-${key}`} flexDirection="column">
      <Box key={`docs-line-${key}`} columnGap={1} flexWrap="wrap">
        {lead?.page ? <Link href={lead.page} label={t.doc.specPage} /> : null}
        {lead?.stale ? <Text color="warning">⚠</Text> : null}
        <Button key={`docs-toggle-${key}`} plain dimColor label={t.doc.toggle(count, open)} onPress={() => buttons.toggle(`docs:${key}`, open)} />
      </Box>
      {open && docs.map(d => {
        const k = `${key}-doc-${d.id}`
        return (
          <Box key={k} columnGap={1} flexWrap="wrap">
            <Text dimColor wrap="truncate-end">{docLabel(d, t)}</Text>
            {d.page ? <Link href={d.page} label={t.doc.page} /> : null}
            {d.page && d.stale ? <Text color="warning">{t.doc.outOfDate}</Text> : null}
            {d.copy ? <Button key={`copy-${k}`} plain label={busy(`copy-${k}`, t.doc.copy)} onPress={() => buttons.run(`copy-${k}`, () => buttons.openPath(d.copy ?? ''))} /> : null}
            {!d.page && d.file ? <Button key={`md-${k}`} plain label={busy(`md-${k}`, t.doc.markdown)} onPress={() => buttons.run(`md-${k}`, () => buttons.openPath(d.file ?? ''))} /> : null}
          </Box>
        )
      })}
    </Box>
  )
}
