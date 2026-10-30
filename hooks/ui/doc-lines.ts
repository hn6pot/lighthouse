// How a card names one of its specs or plans.
import type { Texts } from '../i18n'
import type { BranchDoc, DocState } from '../model'

/** « ▤ Spec rate-limiting »: its state follows, in its color. */
export const docTitle = (d: BranchDoc, t: Texts) => `▤ ${t.doc.kind(d.kind)} ${d.name}`

/** Waiting for the person's approval in yellow, approved in green, under way in Claude's color, done in green. */
export function docColor(state: DocState): 'warning' | 'claude' | 'success' {
  return state === 'draft' ? 'warning' : state === 'in-progress' ? 'claude' : 'success'
}

/** Folded, a card shows only its spec's page (the first spec that has one) and how many documents unfold. */
export function docSummary(docs: readonly BranchDoc[]): { lead: BranchDoc | null; count: number } {
  return { lead: docs.find(d => d.kind === 'spec' && d.page !== undefined) ?? null, count: docs.length }
}

/** A line's one button: the page online, else its local copy, else the Markdown; null when there is nothing to open. */
export function docOpener(d: BranchDoc): { kind: 'page' | 'copy' | 'markdown'; target: string } | null {
  if (d.page) return { kind: 'page', target: d.page }
  if (d.copy) return { kind: 'copy', target: d.copy }
  return d.file ? { kind: 'markdown', target: d.file } : null
}

/** The Copy and Markdown buttons only ever open an absolute `.md` or `.html` file, on one line. */
export const isOpenable = (path: string) => path.startsWith('/') && /\.(md|html)$/.test(path) && !/[\n\r]/.test(path)
