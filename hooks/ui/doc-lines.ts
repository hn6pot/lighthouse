// How a card names one of its specs or plans.
import type { Texts } from '../i18n'
import type { BranchDoc } from '../model'

/** « ▤ Spec rate-limiting · approved » */
export const docLabel = (d: BranchDoc, t: Texts) => `▤ ${t.doc.kind(d.kind)} ${d.name} · ${t.doc.state(d.kind, d.state)}`

/** Folded, a card shows only its spec's page (the first spec that has one) and how many documents unfold. */
export function docSummary(docs: readonly BranchDoc[]): { lead: BranchDoc | null; count: number } {
  return { lead: docs.find(d => d.kind === 'spec' && d.page !== undefined) ?? null, count: docs.length }
}

/** The Copy and Markdown buttons only ever open an absolute `.md` or `.html` file, on one line. */
export const isOpenable = (path: string) => path.startsWith('/') && /\.(md|html)$/.test(path) && !/[\n\r]/.test(path)
