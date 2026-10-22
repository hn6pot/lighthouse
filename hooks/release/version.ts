// Version tags `vX.Y.Z`: reading them, ordering them.

type Triple = [number, number, number]

const VERSION_TAG = /^v(\d+)\.(\d+)\.(\d+)$/

export function parseTag(tag: string): Triple | null {
  const m = VERSION_TAG.exec(tag)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** The version tags among `tags`, lowest first. */
export function sortVersionTags(tags: readonly string[]): string[] {
  return tags
    .map(tag => ({ tag, v: parseTag(tag) }))
    .filter((x): x is { tag: string; v: Triple } => x.v !== null)
    .sort((a, b) => a.v[0] - b.v[0] || a.v[1] - b.v[1] || a.v[2] - b.v[2])
    .map(x => x.tag)
}

/** The version the next release gets: minor +1 with a feature among `entries`, patch +1 otherwise; `v0.1.0` without a tag. */
export function nextVersion(tag: string | null, entries: readonly { kind: string }[]): string {
  const v = tag === null ? null : parseTag(tag)
  if (v === null) return 'v0.1.0'
  const [major, minor, patch] = v
  return entries.some(e => e.kind === 'feat') ? `v${major}.${minor + 1}.0` : `v${major}.${minor}.${patch + 1}`
}
