// Each tick: every repo with a release rule, read from git, with where its last release stands.
import type { Host } from '../host'
import type { Context } from '../loop'
import type { Texts } from '../i18n'
import type { ReleaseRepo, ReleaseRun, ReleaseTag } from '../model'
import type { VersionTag } from './read'
import { expandHome } from '../github/gh'
import { baseBranch, refresh } from '../repos/git'
import { history, latestTag, versionTags, waiting } from './read'
import { readRun } from './run'
import { nextVersion } from './version'

/** As often as the main pane fetches a repo's base. */
export const RELEASE_FETCH_MS = 10 * 60_000

const nameOf = (path: string) => path.split('/').filter(Boolean).pop() ?? path
const titled = (name: string) => name.charAt(0).toUpperCase() + name.slice(1)

/** The release rules of the config, with their folder. */
export function releaseRules(host: Pick<Host, 'home'>, ctx: Context): { slug: string; path: string; command: string }[] {
  return Object.entries(ctx.config.rules).flatMap(([slug, rule]) =>
    rule.kind === 'release' ? [{ slug, path: expandHome(rule.path, host.home), command: rule.command }] : [],
  )
}

/** Fetches the base at most every RELEASE_FETCH_MS (always with `force`). */
export async function fetchBase(host: Host, ctx: Context, path: string, base: string, force = false): Promise<void> {
  const now = await host.now()
  if (!force && now - (ctx.lastFetch.get(path) ?? -Infinity) < RELEASE_FETCH_MS) return
  await refresh(host, path, base)
  ctx.lastFetch.set(path, now)
}

/** The history of each release repo (by folder), read again only when its tag list changes. */
const histories = new WeakMap<Context, Map<string, { key: string; history: ReleaseTag[] }>>()

async function pastReleases(host: Host, ctx: Context, path: string, tags: readonly VersionTag[]): Promise<ReleaseTag[]> {
  const byPath = histories.get(ctx) ?? new Map<string, { key: string; history: ReleaseTag[] }>()
  histories.set(ctx, byPath)
  const key = tags.map(t => `${t.tag}@${t.date}`).join(' ')
  const known = byPath.get(path)
  if (known?.key === key) return known.history
  const past = await history(host, path, tags)
  byPath.set(path, { key, history: past })
  return past
}

async function readRepo(host: Host, ctx: Context, slug: string, path: string): Promise<ReleaseRepo> {
  const base = await baseBranch(host, path)
  await fetchBase(host, ctx, path, base)
  const tags = await versionTags(host, path, base)
  const tag = latestTag(tags)
  const entries = await waiting(host, path, base, tag)
  const now = await host.now()
  const run = await readRun(host, slug, tag)
  const past = (await pastReleases(host, ctx, path, tags)).map(h => ({ ...h, ago: ctx.t.facts.ago(now - h.date) }))
  const repo: ReleaseRepo = { slug, name: nameOf(path), path, base, tag, waiting: entries, next: nextVersion(tag, entries), history: past, run }
  if (run.kind === 'running') repo.runningMin = Math.max(0, Math.floor((now - run.startedAt) / 60_000))
  return repo
}

export function outcomeText(name: string, run: Extract<ReleaseRun, { kind: 'done' }>, t: Texts): string {
  const n = titled(name)
  switch (run.outcome) {
    case 'ok':
      return t.notification.releaseOk(n, run.version ?? '?')
    case 'warning':
      return t.notification.releaseWarning(n, run.version ?? '?', run.lastLine)
    case 'failed':
      return t.notification.releaseFailed(n, run.lastLine)
    case 'died':
      return t.notification.releaseDied(n)
  }
}

export async function collectReleases(host: Host, ctx: Context, notify: (key: string, text: string) => Promise<void>): Promise<ReleaseRepo[]> {
  const repos: ReleaseRepo[] = []
  for (const { slug, path } of releaseRules(host, ctx)) {
    try {
      const repo = await readRepo(host, ctx, slug, path)
      // Whichever session sees the end first notifies; the key makes it once per run.
      if (repo.run.kind === 'done') await notify(`release:${slug}:${repo.run.startedAt}`, outcomeText(repo.name, repo.run, ctx.t))
      repos.push(repo)
    } catch {
      // git unreadable for this repo: the others are still shown
    }
  }
  return repos
}
