import { expect, test } from 'claude-code/testing'
import { fileStore } from '../hooks/host'
import { fakeHost, type Answer } from './helpers/fake-host'

const DIR = '/Users/me/.lighthouse/state'

// An in-memory file system: ls, rm, mv and mkdir act on `files`.
function host() {
  const files: Record<string, string> = {}
  const shell: [RegExp, Answer][] = [
    [/^mkdir -p/, {}],
    [/^ls -1 /, argv => ({ stdout: Object.keys(files).filter(f => f.startsWith(argv[2] + '/')).map(f => f.slice(argv[2].length + 1)).join('\n') })],
    [/^rm -f /, argv => (delete files[argv[2]], {})],
    [/^mv -f /, argv => ((files[argv[3]] = files[argv[2]]), delete files[argv[2]], {})],
  ]
  return fakeHost(shell, files)
}

test('file store: set, get, keys, delete', async () => {
  const h = host()
  const m = fileStore(h.host, DIR)
  expect(await m.get('tracked:acme/web#4')).toBeUndefined()
  expect(await m.keys()).toEqual([])
  await m.set('tracked:acme/web#4', { key: 'acme/web#4', stage: 'open' })
  await m.set('notified:w/x#7:failed', true)
  expect(await m.get('tracked:acme/web#4')).toEqual({ key: 'acme/web#4', stage: 'open' })
  expect((await m.keys()).sort()).toEqual(['notified:w/x#7:failed', 'tracked:acme/web#4'])
  await m.delete('notified:w/x#7:failed')
  expect(await m.keys()).toEqual(['tracked:acme/web#4'])
})

test('one file per key, no / or # in the name, written by a mv', async () => {
  const h = host()
  await fileStore(h.host, DIR).set('tracked:acme/web#4', 1)
  expect(Object.keys(h.files)).toEqual([`${DIR}/tracked%3Aacme%2Fweb%234.json`])
  expect(h.calls.some(a => a.line.startsWith('mv '))).toBe(true)
})

test('unreadable JSON: missing key; missing folder: no keys', async () => {
  const h = host()
  h.files[`${DIR}/tracked%3Aw%2Fx%237.json`] = '{"key":'
  const m = fileStore(h.host, DIR)
  expect(await m.get('tracked:w/x#7')).toBeUndefined()
  const empty = fakeHost([[/^ls -1/, { exitCode: 1, stderr: 'No such file or directory' }]])
  expect(await fileStore(empty.host, DIR).keys()).toEqual([])
})

test('a temporary file being written is not a key', async () => {
  const h = host()
  h.files[`${DIR}/a.json.tmp-1`] = '{'
  h.files[`${DIR}/b.json`] = '2'
  expect(await fileStore(h.host, DIR).keys()).toEqual(['b'])
})
