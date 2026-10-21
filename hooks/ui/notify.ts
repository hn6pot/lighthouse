// One macOS notification per PR and per stage, no more — and only once it really went out.
import type { Host, Store } from '../host'

/** Sends through `$.ui.notify`; with no surface to show it (Desktop), falls back on osascript. True if it went out. */
export async function sendNotification(
  host: Pick<Host, 'run'>,
  notify: (text: string) => Promise<{ isSent: boolean }>,
  text: string,
): Promise<boolean> {
  try {
    if ((await notify(text)).isSent) return true
  } catch {
    // no channel: try osascript
  }
  const escaped = text.replace(/[\\"]/g, c => `\\${c}`)
  const r = await host.run(['osascript', '-e', `display notification "${escaped}" with title "lighthouse"`])
  return r.exitCode === 0
}

export async function notifyOnce(store: Store, send: (text: string) => Promise<boolean>, key: string, text: string): Promise<void> {
  const mark = `notified:${key}`
  if ((await store.get(mark)) !== undefined) return
  // The mark follows the send: without a mark, the next call for the same key sends it again.
  if (await send(text)) await store.set(mark, true)
}
