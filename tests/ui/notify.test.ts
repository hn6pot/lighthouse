import { expect, test } from 'claude-code/testing'
import { notifyOnce, sendNotification } from '../../hooks/ui/notify'
import { fakeHost } from '../helpers/fake-host'

test('one notification per key, never two', async () => {
  const { host } = fakeHost([])
  const sent: string[] = []
  const send = async (t: string) => (sent.push(t), true)
  await notifyOnce(host.store, send, 'w/x#7:failed', 'a')
  await notifyOnce(host.store, send, 'w/x#7:failed', 'a')
  await notifyOnce(host.store, send, 'w/x#7:deploy-doubt', 'b')
  expect(sent).toEqual(['a', 'b'])
})

test('notify refused (Desktop): falls back on osascript, mark set', async () => {
  const h = fakeHost([[/^osascript/, {}]])
  const notify = async () => ({ isSent: false })
  const send = (t: string) => sendNotification(h.host, notify, t)
  await notifyOnce(h.host.store, send, 'w/x#7:failed', '#7 x : déploiement en échec')
  expect(h.calls.map(a => a.line)).toEqual(['osascript -e display notification "#7 x : déploiement en échec" with title "lighthouse"'])
  expect(await h.host.store.get('notified:w/x#7:failed')).toBe(true)
})

test('notify sent: no osascript', async () => {
  const h = fakeHost([])
  expect(await sendNotification(h.host, async () => ({ isSent: true }), 't')).toBe(true)
  expect(h.calls).toEqual([])
})

test('both fail: no mark, we will try again', async () => {
  const h = fakeHost([[/^osascript/, { exitCode: 1 }]])
  const send = (t: string) => sendNotification(h.host, async () => ({ isSent: false }), t)
  await notifyOnce(h.host.store, send, 'w/x#7:failed', 'a')
  expect(await h.host.store.get('notified:w/x#7:failed')).toBeUndefined()
  await notifyOnce(h.host.store, send, 'w/x#7:failed', 'a')
  expect(h.calls).toHaveLength(2)
})

test('osascript: quotes and backslashes escaped', async () => {
  const h = fakeHost([[/^osascript/, {}]])
  await sendNotification(h.host, async () => ({ isSent: false }), 'a "b" \\c')
  expect(h.calls[0].line).toBe('osascript -e display notification "a \\"b\\" \\\\c" with title "lighthouse"')
})
