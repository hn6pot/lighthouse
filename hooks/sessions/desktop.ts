// The Desktop's own record of its sessions: which desktop session runs each CLI session, and its title.
// Read-only and best effort: a format change only loses the titles and the links.
import type { Host } from '../host'

export type DesktopSession = { desktopId: string; title?: string }

const sessionsDir = (host: Host) => `${host.home}/Library/Application Support/Claude/claude-code-sessions`

/** `grep -o -H` lines (`file:"key":"value"`) into CLI session id → desktop id and title (the file's first title). */
export function parseDesktopIndex(output: string): Map<string, DesktopSession> {
  const byFile = new Map<string, { desktopId?: string; cli?: string; title?: string }>()
  for (const line of output.split('\n')) {
    const m = line.match(/^(.*?\.json):"(sessionId|cliSessionId|title)":"(.*)"$/)
    if (!m) continue
    const [, file = '', key, value = ''] = m
    const entry = byFile.get(file) ?? {}
    if (key === 'sessionId') entry.desktopId ??= value
    else if (key === 'cliSessionId') entry.cli ??= value
    else entry.title ??= value
    byFile.set(file, entry)
  }
  const index = new Map<string, DesktopSession>()
  for (const e of byFile.values()) {
    if (e.cli && e.desktopId?.startsWith('local_')) index.set(e.cli, { desktopId: e.desktopId, ...(e.title ? { title: e.title } : {}) })
  }
  return index
}

/** Each file is large: only the three fields are read, by one grep. */
export async function desktopIndex(host: Host): Promise<Map<string, DesktopSession>> {
  const found = await host.run(['find', sessionsDir(host), '-maxdepth', '3', '-name', 'local_*.json'])
  const files = found.exitCode === 0 ? found.stdout.split('\n').filter(f => f.endsWith('.json')) : []
  if (files.length === 0) return new Map()
  const grep = await host.run(['grep', '-o', '-H', '-E', '"(sessionId|cliSessionId|title)":"[^"]*"', ...files])
  return parseDesktopIndex(grep.stdout)
}
