// A card's specs and plans: folded, its spec's page and a toggle; unfolded, one line each, with their page, its local copy, or the Markdown.
import type { EngineInterface } from 'claude-code'
import type { Texts } from '../i18n'
import type { BranchDoc } from '../model'
import type { Buttons } from './band'
import { docColor, docOpener, docSummary, docTitle } from './doc-lines'

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
  // The folded line's dot: the state of the spec it leads with, else of the first document.
  const first = lead ?? docs[0]
  return (
    <Box key={`docs-${key}`} flexDirection="column">
      <Box key={`docs-line-${key}`} columnGap={1} flexWrap="wrap">
        {first ? <Text color={docColor(first.state)}>●</Text> : null}
        {lead?.page ? <Link href={lead.page} label={t.doc.specPage} /> : null}
        {lead?.stale ? <Text color="warning">⚠</Text> : null}
        <Button key={`docs-toggle-${key}`} plain dimColor label={t.doc.toggle(count, open)} onPress={() => buttons.toggle(`docs:${key}`, open)} />
      </Box>
      {open && docs.map(d => {
        const k = `${key}-doc-${d.id}`
        const opener = docOpener(d)
        return (
          <Box key={k} columnGap={1} flexWrap="wrap">
            <Text dimColor wrap="truncate-end">{docTitle(d, t)}</Text>
            <Text color={docColor(d.state)}>{t.doc.state(d.kind, d.state)}</Text>
            {opener?.kind === 'page' ? <Link href={opener.target} label={t.doc.page} /> : null}
            {opener && opener.kind !== 'page' ? (
              <Button key={`open-${k}`} plain label={busy(`open-${k}`, opener.kind === 'copy' ? t.doc.copy : t.doc.markdown)} onPress={() => buttons.run(`open-${k}`, () => buttons.openPath(opener.target))} />
            ) : null}
            {d.page && d.stale ? <Text color="warning">{t.doc.outOfDate}</Text> : null}
          </Box>
        )
      })}
    </Box>
  )
}
