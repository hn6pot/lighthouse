// The Release button: a fresh look, the main checkout's guards, then the command, detached from the session.
import type { Host } from '../host'
import type { Context } from '../loop'
import { baseBranch, treeState } from '../repos/git'
import { DATA_DIR } from '../sessions/registry'
import { fetchBase, releaseRules } from './collect'
import { latestTag, versionTags, waiting } from './read'
import { codeFile, readRun, runFiles, startScript } from './run'
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

/** A claim older than this is a press that died before writing its record (fetch and pull stay well under it). */
const CLAIM_STALE_MS = 5 * 60_000

/** Takes the claim atomically (mkdir); one left by a dead press is taken over. False: another press is launching. */
async function claim(host: Host, path: string): Promise<boolean> {
  if ((await host.run(['mkdir', path])).exitCode === 0) return true
  const st = await host.run(['stat', '-f', '%m', path])
  const stale = st.exitCode === 0 && /^\d+$/.test(st.stdout.trim()) && (await host.now()) - Number(st.stdout.trim()) * 1000 > CLAIM_STALE_MS
  if (!stale) return false
  await host.run(['rm', '-rf', path])
  return (await host.run(['mkdir', path])).exitCode === 0
}

/** `shown` is the version the button showed: if it changed since, nothing is launched. */
export async function launchRelease(host: Host, ctx: Context, slug: string, shown: string): Promise<Launch> {
  const { t } = ctx
  const rule = releaseRules(host, ctx).find(r => r.slug === slug)
  if (!rule) return { ok: false, reason: t.releasePane.nothing }
  const files = runFiles(host.home, slug)
  await host.run(['mkdir', '-p', `${host.home}/${DATA_DIR}/releases`, `${host.home}/${DATA_DIR}/logs`])
  // From the first step to the record: two presses (here or in another session) never both launch.
  if (!(await claim(host, files.claim))) return { ok: false, reason: t.releasePane.alreadyRunning }
  try {
    return await launchClaimed(host, ctx, slug, rule, shown)
  } finally {
    await host.run(['rm', '-rf', files.claim])
  }
}

async function launchClaimed(host: Host, ctx: Context, slug: string, rule: { path: string; command: string }, shown: string): Promise<Launch> {
  const { t } = ctx
  const { path, command } = rule
  const base = await baseBranch(host, path)
  if ((await readRun(host, slug, null)).kind === 'running') return { ok: false, reason: t.releasePane.alreadyRunning }

  await fetchBase(host, ctx, path, base, true)
  const tag = latestTag(await versionTags(host, path, base))
  const entries = await waiting(host, path, base, tag)
  if (entries.length === 0) return { ok: false, reason: t.releasePane.nothing }
  const next = nextVersion(tag, entries)
  if (next !== shown) return { ok: false, reason: t.releasePane.versionChanged(next) }

  const main = await treeState(host, path, base, t)
  if (main.branch !== base) return { ok: false, reason: t.reason.mainOnOtherBranch(main.branch, base) }
  if (main.uncommitted > 0) return { ok: false, reason: t.reason.mainDirty }
  // Local commits would go out without being in the list, and could change the version.
  const ahead = Number((await host.run(['git', '-C', path, 'rev-list', '--count', `origin/${base}..HEAD`])).stdout.trim()) || 0
  if (ahead > 0) return { ok: false, reason: t.releasePane.unpushed(ahead) }
  const pull = await host.run(['git', '-C', path, 'pull', '--ff-only', '--quiet'], { timeoutMs: 120_000 })
  if (pull.exitCode !== 0) return { ok: false, reason: t.reason.pullFailed(pull.stderr.trim()) }

  const now = await host.now()
  const files = runFiles(host.home, slug)
  const code = codeFile(host.home, slug, now)
  const log = `${host.home}/${DATA_DIR}/logs/${slug.replace('/', '__')}-release-${now}.log`
  await host.write(files.script, startScript(path, command, log, code))
  const started = await host.run(['/usr/bin/perl', '-MPOSIX', '-e', DETACH, '/bin/zsh', files.script])
  const pid = Number(started.stdout.trim())
  if (started.exitCode !== 0 || !Number.isInteger(pid) || pid <= 0) return { ok: false, reason: t.reason.launchFailed(started.stderr.trim()) }
  // Whole or not at all: another session never reads half a record (it would see no release).
  const temporary = `${files.record}.tmp-${now}`
  await host.write(temporary, JSON.stringify({ pid, startedAt: now, tagAtLaunch: tag, expected: next, log, code }))
  await host.run(['mv', '-f', temporary, files.record])
  return { ok: true, version: next }
}
