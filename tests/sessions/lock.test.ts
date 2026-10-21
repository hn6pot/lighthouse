import { expect, test } from 'claude-code/testing'
import { acquireLock, releaseLock } from '../../hooks/sessions/lock'
import { fakeHost } from '../helpers/fake-host'

const DIR = '/Users/me/.lighthouse/locks/acme__x'

// mkdir of the folder: fails once (the lock is held), succeeds afterwards (the takeover).
const failOnceThenOk = () => {
  let n = 0
  return () => (++n === 1 ? { exitCode: 1, stderr: 'File exists' } : {})
}

test('first come takes the lock', async () => {
  const { host, files } = fakeHost([[/^mkdir -p/, {}], [new RegExp(`^mkdir ${DIR}$`), {}]], {}, 5)
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(true)
  expect(JSON.parse(files[`${DIR}/owner.json`])).toEqual({ id: 'a', since: 5 })
})

test('lock held by another recent session: refused; by oneself: accepted', async () => {
  const files = { [`${DIR}/owner.json`]: JSON.stringify({ id: 'b', since: 0 }) }
  const { host } = fakeHost([[/^mkdir -p/, {}], [/^mkdir /, { exitCode: 1, stderr: 'File exists' }]], files, 60_000)
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(false)
  expect(await acquireLock(host, 'acme/x', 'b')).toBe(true)
})

test('lock abandoned for more than 15 min: taken over by mv then mkdir', async () => {
  const files = {
    [`${DIR}/owner.json`]: JSON.stringify({ id: 'b', since: 0 }),
    // The mv carried the folder away with its owner.json: it is read again where it landed.
    [`${DIR}.stale.a/owner.json`]: JSON.stringify({ id: 'b', since: 0 }),
  }
  const { host, calls } = fakeHost(
    [[/^mkdir -p/, {}], [/^mkdir /, failOnceThenOk()], [/^mv /, {}], [/^rm -rf/, {}]],
    files,
    16 * 60_000,
  )
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(true)
  expect(calls.map(a => a.line)).toContain(`mv ${DIR} ${DIR}.stale.a`)
  expect(JSON.parse(files[`${DIR}/owner.json`]).id).toBe('a')
})

test('releasing the lock: mv then delete if the lock is ours, only if we hold it', async () => {
  const files = {
    [`${DIR}/owner.json`]: JSON.stringify({ id: 'a', since: 0 }),
    [`${DIR}.released.a/owner.json`]: JSON.stringify({ id: 'a', since: 0 }),
  }
  const { host, calls } = fakeHost([[/^rm -rf/, {}], [/^mv /, {}]], files)
  await releaseLock(host, 'acme/x', 'b')
  expect(calls).toEqual([])
  await releaseLock(host, 'acme/x', 'a')
  expect(calls.map(a => a.line)).toContain(`mv ${DIR} ${DIR}.released.a`)
  expect(calls.at(-1)?.line).toBe(`rm -rf ${DIR}.released.a`)
})

test('no owner.json, folder 1 min old: unknown, so refused', async () => {
  const { host, calls } = fakeHost(
    [[/^mkdir -p/, {}], [/^mkdir /, { exitCode: 1 }], [/^stat -f %m /, { stdout: '0' }]],
    {},
    60_000,
  )
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(false)
  expect(calls.some(a => a.line.startsWith('mv '))).toBe(false)
})

test('no owner.json, folder 16 min old: taken over by mv then mkdir', async () => {
  const { host, files, calls } = fakeHost(
    [[/^mkdir -p/, {}], [/^mkdir /, failOnceThenOk()], [/^stat -f %m /, { stdout: '0' }], [/^mv /, {}], [/^rm -rf/, {}]],
    {},
    16 * 60_000,
  )
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(true)
  expect(calls.map(a => a.line)).toContain(`mv ${DIR} ${DIR}.stale.a`)
  expect(JSON.parse(files[`${DIR}/owner.json`])).toEqual({ id: 'a', since: 16 * 60_000 })
})

test('stale holder but failed mv (someone else took it over): refused, owner.json intact', async () => {
  const files = { [`${DIR}/owner.json`]: JSON.stringify({ id: 'b', since: 0 }) }
  const { host } = fakeHost(
    [[/^mkdir -p/, {}], [/^mkdir /, { exitCode: 1 }], [/^mv /, { exitCode: 1, stderr: 'No such file' }]],
    files,
    16 * 60_000,
  )
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(false)
  expect(JSON.parse(files[`${DIR}/owner.json`]).id).toBe('b')
})

test('corrupt owner.json + recent folder: unknown, so refused', async () => {
  const files = { [`${DIR}/owner.json`]: 'not json' }
  const { host, calls } = fakeHost(
    [[/^mkdir -p/, {}], [/^mkdir /, { exitCode: 1 }], [/^stat -f %m /, { stdout: '0' }]],
    files,
    60_000,
  )
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(false)
  expect(calls.some(a => a.line.startsWith('mv '))).toBe(false)
})

test('takeover: the mv carried away someone else’s live lock, it is put back and we fail', async () => {
  const files = {
    [`${DIR}/owner.json`]: JSON.stringify({ id: 'b', since: 0 }),
    // Between our read and the mv, c took it over: that is what we moved.
    [`${DIR}.stale.a/owner.json`]: JSON.stringify({ id: 'c', since: 15 * 60_000 }),
  }
  const { host, calls } = fakeHost(
    [[/^mkdir -p/, {}], [/^mkdir /, { exitCode: 1 }], [/^test -e /, { exitCode: 1 }], [/^mv /, {}], [/^rm -rf/, {}]],
    files,
    16 * 60_000,
  )
  expect(await acquireLock(host, 'acme/x', 'a')).toBe(false)
  expect(calls.at(-1)?.line).toBe(`mv ${DIR}.stale.a ${DIR}`)
})

test('release: the moved lock belongs to someone else, it is put back without deleting it', async () => {
  const files = {
    [`${DIR}/owner.json`]: JSON.stringify({ id: 'a', since: 0 }),
    [`${DIR}.released.a/owner.json`]: JSON.stringify({ id: 'b', since: 0 }),
  }
  const { host, calls } = fakeHost(
    [[/^rm -rf/, {}], [/^mv /, {}], [/^test -e /, { exitCode: 1 }]],
    files,
  )
  await releaseLock(host, 'acme/x', 'a')
  expect(calls.at(-1)?.line).toBe(`mv ${DIR}.released.a ${DIR}`)
})
