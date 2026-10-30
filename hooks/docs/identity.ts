// What a spec or plan is, and how it is named wherever it is checked out.
import { DATA_DIR } from '../sessions/registry'
import type { DocKind } from '../model'

/** `owner/repo:path` for a document in a repo with a GitHub origin, else its `~/…` (or absolute) path. */
export type DocId = string

const SLUG = /^[\w.-]+\/[\w.-]+$/

/** A `.md` under a folder named `specs` or `plans`; the nearest such folder decides. */
export function docKind(path: string): DocKind | null {
  if (!path.endsWith('.md')) return null
  const folders = path.split('/').slice(0, -1)
  for (let i = folders.length - 1; i >= 0; i--) {
    if (folders[i] === 'specs') return 'spec'
    if (folders[i] === 'plans') return 'plan'
  }
  return null
}

/** The file name without its date prefix, `.md`, and a trailing `-design` or `-plan`. */
export function docName(path: string): string {
  const file = path.split('/').pop() ?? path
  return file
    .replace(/\.md$/, '')
    .replace(/^\d{4}-\d{2}-\d{2}-/, '')
    .replace(/-(design|plan)$/, '')
}

export const repoDocId = (slug: string, rel: string): DocId => `${slug}:${rel}`

export function localDocId(abs: string, home: string): DocId {
  return abs.startsWith(home + '/') ? `~${abs.slice(home.length)}` : abs
}

/** The two forms of an identity; null for anything else, a `..` segment, or a path that is not a document. */
export function parseDocId(id: string): { slug: string; rel: string } | { path: string } | null {
  const path = id.startsWith('~/') || id.startsWith('/') ? id : null
  const colon = id.indexOf(':')
  const rel = path ?? (colon > 0 ? id.slice(colon + 1) : '')
  if (rel === '' || rel.split('/').includes('..') || docKind(rel) === null) return null
  if (path !== null) return { path }
  const slug = id.slice(0, colon)
  return SLUG.test(slug) && !rel.startsWith('/') ? { slug, rel } : null
}

/** Where Lighthouse keeps the latest copy of a document's published page. */
export function copyPath(id: DocId, home: string): string {
  const parsed = parseDocId(id)
  const under = parsed === null ? id : 'slug' in parsed ? `${parsed.slug}/${parsed.rel}` : `local/${parsed.path.replace(/^~?\//, '')}`
  return `${home}/${DATA_DIR}/pages/${under.replace(/\.md$/, '.html')}`
}
