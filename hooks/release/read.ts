// What git says about a release repo: its version tags, what waits since the last one, what each one brought.
import type { Host } from '../host'
import type { ReleaseEntry, ReleaseTag } from '../model'
import { parseLog } from './commits'
import { sortVersionTags } from './version'

const FORMAT = '--format=%H%x1f%s%x1f%b%x1e'

const git = (host: Host, path: string, ...args: string[]) => host.run(['git', '-C', path, ...args])

/** A version tag and when it was made (ms): the tagger's date for an annotated tag, its commit's for a light one. */
export type VersionTag = { tag: string; date: number }

/** The `vX.Y.Z` tags merged into the base, lowest version first: one git call, dates included. */
export async function versionTags(host: Host, path: string, base: string): Promise<VersionTag[]> {
  const list = await git(host, path, 'for-each-ref', '--merged', `origin/${base}`, '--format=%(refname:short) %(creatordate:unix)', 'refs/tags/v*')
  if (list.exitCode !== 0) return []
  const dates = new Map<string, number>()
  for (const line of list.stdout.split('\n')) {
    const [tag = '', date = ''] = line.trim().split(' ')
    if (tag !== '') dates.set(tag, Number(date) * 1000 || 0)
  }
  return sortVersionTags([...dates.keys()]).map(tag => ({ tag, date: dates.get(tag) ?? 0 }))
}

const entries = async (host: Host, path: string, range: string) => parseLog((await git(host, path, 'log', '--first-parent', FORMAT, range)).stdout)

/** The highest version among `tags` (sorted by versionTags); null without one. */
export const latestTag = (tags: readonly VersionTag[]): string | null => tags.at(-1)?.tag ?? null

/** The base's commits since `tag` (all of them without a tag), newest first. */
export function waiting(host: Host, path: string, base: string, tag: string | null): Promise<ReleaseEntry[]> {
  return entries(host, path, tag ? `${tag}..origin/${base}` : `origin/${base}`)
}

/** The last `limit` releases among `tags`, newest first, each with the commits since the one before it. */
export async function history(host: Host, path: string, tags: readonly VersionTag[], limit = 10): Promise<ReleaseTag[]> {
  const out: ReleaseTag[] = []
  for (let i = tags.length - 1; i >= 0 && out.length < limit; i--) {
    const { tag, date } = tags[i]!
    const previous = tags[i - 1]?.tag
    out.push({ tag, date, entries: await entries(host, path, previous ? `${previous}..${tag}` : tag) })
  }
  return out
}
