// The Release button: a fresh look, the main checkout's guards, then the command, detached from the session.
import type { Host } from '../host'
import type { Context } from '../loop'
import { baseBranch, treeState } from '../repos/git'
import { DATA_DIR } from '../sessions/registry'
import { fetchBase, releaseRules } from './collect'
import { latestTag, waiting } from './read'
import { readRun, runFiles, startScript } from './run'
import { nextVersion } from './version'

/**
 * Starts argv in a session of its own (setsid), its input and output off our pipe, and prints its pid.
 * nohup alone is not enough: the child stays in the session's process group and dies with it.
 * The parent waits for the child's setsid (the pipe closes) before it answers, so no kill can come in between.
 */
const DETACH = [
  'pipe(my $r, my $w); my $pid = fork; die "fork: $!" unless defined $pid;',
  'if ($pid) { close $w; <$r>; print "$pid\\n"; exit 0 }',
  'close $r; POSIX::setsid(); open STDIN, "<", "/dev/null"; open STDOUT, ">", "/dev/null"; open STDERR, ">&", \\*STDOUT;',
  'close $w; exec @ARGV or exit 127',
].join(' ')

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
  const started = await host.run(['/usr/bin/perl', '-MPOSIX', '-e', DETACH, '/bin/zsh', files.script])
  const pid = Number(started.stdout.trim())
  if (started.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) return { ok: false, reason: t.reason.launchFailed(started.stderr.trim()) }
  await host.write(files.record, JSON.stringify({ pid, startedAt: now, tagAtLaunch: tag, expected: next, log }))
  return { ok: true, version: next }
}
