// What a commit on the base says about the PR it brought: its number, its title, fix or feature.
import type { ReleaseEntry, ReleaseKind } from '../model'

/** `type(scope)!: ` at the start of a title, as Conventional Commits write it. */
const TYPE = /^(\w+)(\([^)]*\))?!?:\s+/
const SQUASH_NUMBER = /\s\(#(\d+)\)$/
const MERGE = /^Merge pull request #(\d+) from /

export function classify(title: string): ReleaseKind {
  const type = TYPE.exec(title)?.[1]
  return type === 'fix' ? 'fix' : type === 'feat' ? 'feat' : 'other'
}

function entry(sha: string, subject: string, body: string): ReleaseEntry {
  const merge = MERGE.exec(subject)
  // A GitHub merge commit carries the PR's title as the first line of its body.
  const raw = merge ? (body.split('\n').find(l => l.trim() !== '')?.trim() ?? subject) : subject
  const squash = merge ? null : SQUASH_NUMBER.exec(raw)
  const number = merge ? Number(merge[1]) : squash ? Number(squash[1]) : null
  const titled = squash ? raw.slice(0, squash.index) : raw
  return { sha, number, title: titled.replace(TYPE, ''), kind: classify(titled) }
}

/** Reads `git log --format=%H%x1f%s%x1f%b%x1e`. */
export function parseLog(text: string): ReleaseEntry[] {
  return text
    .split('\x1e')
    .map(r => r.replace(/^\n/, ''))
    .filter(r => r.trim() !== '')
    .map(r => {
      const [sha = '', subject = '', body = ''] = r.split('\x1f')
      return entry(sha, subject, body)
    })
}
