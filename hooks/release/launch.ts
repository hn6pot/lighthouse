// The Release button: a fresh look, the main checkout's guards, then the command, detached from the session.
import type { Host } from '../host'
import type { Context } from '../loop'
import { baseBranch, treeState } from '../repos/git'
import { DATA_DIR } from '../sessions/registry'
import { fetchBase, releaseRules } from './collect'
import { latestTag, waiting } from './read'
import { readRun, runFiles, startScript } from './run'
import { nextVersion } from './version'

/** `$0` is the script: nohup keeps it alive when the session that launched it ends. */
const DETACH = 'nohup /bin/zsh "$0" </dev/null >/dev/null 2>&1 & echo $!'

type Launch = { ok: true; version: string } | { ok: false; reason: string }

/** `shown` is the version the button showed: if it changed since, nothing is launched. */
export async function launchRelease(host: Host, ctx: Context, slug: string, shown: string): Promise<Launch> {
  const { t } = ctx
  const rule = releaseRules(host, ctx).find(r => r.slug === slug)
  if (!rule) return { ok: false, reason: t.releasePane.nothing }
  const { path, command } = rule
  const base = await baseBranch(host, path)
  if ((await readRun(host, slug, null)).kind === 'running') return { ok: false, reason: t.releasePane.alreadyRunning }

  await fetchBase(host, ctx, path, base, true)
  const tag = await latestTag(host, path, base)
  const entries = await waiting(host, path, base, tag)
  if (entries.length === 0) return { ok: false, reason: t.releasePane.nothing }
  const next = nextVersion(tag, entries)
  if (next !== shown) return { ok: false, reason: t.releasePane.versionChanged(next) }

  const main = await treeState(host, path, base, t)
  if (main.branch !== base) return { ok: false, reason: t.reason.mainOnOtherBranch(main.branch, base) }
  if (main.uncommitted > 0) return { ok: false, reason: t.reason.mainDirty }
  const pull = await host.run(['git', '-C', path, 'pull', '--ff-only', '--quiet'], { timeoutMs: 120_000 })
  if (pull.exitCode !== 0) return { ok: false, reason: t.reason.pullFailed(pull.stderr.trim()) }

  const now = await host.now()
  const files = runFiles(host.home, slug)
  const log = `${host.home}/${DATA_DIR}/logs/${slug.replace('/', '__')}-release-${now}.log`
  await host.run(['mkdir', '-p', `${host.home}/${DATA_DIR}/releases`, `${host.home}/${DATA_DIR}/logs`])
  // The last run's exit code goes first: it must never be read as this run's.
  await host.run(['rm', '-f', files.code])
  await host.write(files.script, startScript(path, command, log, files.code))
  const started = await host.run(['/bin/zsh', '-c', DETACH, files.script])
  const pid = Number(started.stdout.trim())
  if (started.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) return { ok: false, reason: t.reason.launchFailed(started.stderr.trim()) }
  await host.write(files.record, JSON.stringify({ pid, startedAt: now, tagAtLaunch: tag, expected: next, log }))
  return { ok: true, version: next }
}
