// What git says about documents: their blob hash, the ones a branch touches, the plans that cite a spec.
import type { Host } from '../host'

/** The git blob hash of a file, in or out of a repo; null when it cannot be read. */
export async function fileHash(host: Host, path: string): Promise<string | null> {
  const r = await host.run(['git', 'hash-object', '--', path])
  const hash = r.stdout.trim()
  return r.exitCode === 0 && hash !== '' ? hash : null
}
