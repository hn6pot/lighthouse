// Calling gh with the account that goes with the repo, without touching the active account.
import type { Host } from '../host'

/** Repo owner → GH_CONFIG_DIR, from the config file; `~` stands for the home. */
export type GhConfigDirs = Record<string, string>

export function ghEnv(slug: string, home: string, dirs: GhConfigDirs): Record<string, string> | undefined {
  const owner = slug.split('/')[0] ?? ''
  if (!Object.hasOwn(dirs, owner)) return undefined
  const dir = dirs[owner]
  return { GH_CONFIG_DIR: dir === '~' || dir.startsWith('~/') ? home + dir.slice(1) : dir }
}

export async function ghJson<T>(host: Host, dirs: GhConfigDirs, slug: string, args: readonly string[]): Promise<T> {
  const r = await host.run(['gh', ...args, '-R', slug], { env: ghEnv(slug, host.home, dirs), timeoutMs: 30_000 })
  if (r.exitCode !== 0) throw new Error(`gh ${args.slice(0, 2).join(' ')} on ${slug}: ${r.stderr.trim()}`)
  return JSON.parse(r.stdout) as T
}
