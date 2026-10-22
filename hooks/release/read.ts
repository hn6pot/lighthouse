// What git says about a release repo: its version tags, what waits since the last one, what each one brought.
import type { Host } from '../host'
import type { ReleaseEntry, ReleaseTag } from '../model'
import { parseLog } from './commits'
import { sortVersionTags } from './version'

const FORMAT = '--format=%H%x1f%s%x1f%b%x1e'

const git = (host: Host, path: string, ...args: string[]) => host.run(['git', '-C', path, ...args])

async function versionTags(host: Host, path: string, base: string): Promise<string[]> {
  const list = await git(host, path, 'tag', '--merged', `origin/${base}`, '--list', 'v*')
  return list.exitCode === 0 ? sortVersionTags(list.stdout.split('\n').map(l => l.trim())) : []
}

const entries = async (host: Host, path: string, range: string) => parseLog((await git(host, path, 'log', '--first-parent', FORMAT, range)).stdout)

/** The highest `vX.Y.Z` merged into the base, by version; null without one. */
export async function latestTag(host: Host, path: string, base: string): Promise<string | null> {
  return (await versionTags(host, path, base)).at(-1) ?? null
}

/** The base's commits since `tag` (all of them without a tag), newest first. */
export function waiting(host: Host, path: string, base: string, tag: string | null): Promise<ReleaseEntry[]> {
  return entries(host, path, tag ? `${tag}..origin/${base}` : `origin/${base}`)
}

/** The last `limit` releases, newest first, each with the commits since the one before it. */
export async function history(host: Host, path: string, base: string, limit = 10): Promise<ReleaseTag[]> {
  const tags = await versionTags(host, path, base)
  const out: ReleaseTag[] = []
  for (let i = tags.length - 1; i >= 0 && out.length < limit; i--) {
    const tag = tags[i]
    const previous = tags[i - 1]
    const date = Number((await git(host, path, 'log', '-1', '--format=%ct', tag)).stdout.trim()) * 1000 || 0
    out.push({ tag, date, entries: await entries(host, path, previous ? `${previous}..${tag}` : tag) })
  }
  return out
}
