// The only boundary with Claude Code: modules receive a Host, never `$`.
// The Host is built in register.ts: Claude Code refuses `$` crossing an import.

export type RunResult = { exitCode: number; stdout: string; stderr: string }
export type RunOptions = { cwd?: string; env?: Record<string, string>; timeoutMs?: number }

export type Store = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

export type Host = {
  run: (argv: readonly string[], options?: RunOptions) => Promise<RunResult>
  /** Launches a long command; resolves its exit code and everything it wrote. */
  launch: (argv: readonly string[], options: { cwd: string }) => Promise<{ code: number | null; output: string }>
  read: (path: string) => Promise<string | null>
  write: (path: string, text: string) => Promise<void>
  now: () => Promise<number>
  store: Store
  home: string
}

/**
 * A store shared between the processes of every session: one JSON file per key.
 * Nothing guarantees `$.store` is, hence these files. Name = encoded key (no `/` or `#`).
 * Written to a temporary file then `mv` (atomic); unreadable JSON counts as a missing key.
 */
export function fileStore(host: Pick<Host, 'run' | 'read' | 'write'>, dir: string): Store {
  const file = (key: string) => `${dir}/${encodeURIComponent(key)}.json`
  let ready = false
  return {
    get: async key => {
      const text = await host.read(file(key))
      if (text === null) return undefined
      try {
        return JSON.parse(text) as unknown
      } catch {
        return undefined // file written by another process, unreadable
      }
    },
    set: async (key, value) => {
      if (!ready) {
        await host.run(['mkdir', '-p', dir])
        ready = true
      }
      const temporary = `${file(key)}.tmp-${crypto.randomUUID()}`
      await host.write(temporary, JSON.stringify(value))
      const mv = await host.run(['mv', '-f', temporary, file(key)])
      if (mv.exitCode !== 0) throw new Error(`store: cannot write ${key} (${mv.stderr.trim()})`)
    },
    delete: async key => void (await host.run(['rm', '-f', file(key)])),
    keys: async () => {
      const list = await host.run(['ls', '-1', dir])
      if (list.exitCode !== 0) return []
      return list.stdout
        .split('\n')
        .filter(name => name.endsWith('.json'))
        .map(name => decodeURIComponent(name.slice(0, -'.json'.length)))
    },
  }
}
