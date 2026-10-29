// How a card names one of its specs or plans.
import type { Texts } from '../i18n'
import type { BranchDoc } from '../model'

/** A card shows this many documents, then « +N more ». */
export const DOCS_SHOWN = 4

/** « ▤ Spec rate-limiting · approved » */
export const docLabel = (d: BranchDoc, t: Texts) => `▤ ${t.doc.kind(d.kind)} ${d.name} · ${t.doc.state(d.kind, d.state)}`

/** The Copy and Markdown buttons only ever open an absolute `.md` or `.html` file, on one line. */
export const isOpenable = (path: string) => path.startsWith('/') && /\.(md|html)$/.test(path) && !/[\n\r]/.test(path)
