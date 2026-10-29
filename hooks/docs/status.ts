// Where a spec or plan stands, deduced (never written in the document).
import type { DocState } from '../model'

/** `citing`: plans citing the spec; `citingDone`: those implemented; `done`: the spec itself was marked implemented. */
export function specState(f: { citing: number; citingDone: number; done: boolean }): DocState {
  if (f.citing > 0) return f.citingDone === f.citing ? 'implemented' : 'approved'
  return f.done ? 'implemented' : 'draft'
}

export function planState(f: { codeAfter: boolean; done: boolean }): DocState {
  return f.done ? 'implemented' : f.codeAfter ? 'in-progress' : 'draft'
}
