import { expect, test } from 'claude-code/testing'
import { cached } from '../../hooks/github/cache'
import { fakeHost } from '../helpers/fake-host'

test('cached: reuses a fresh answer from the shared store, asks again once it is old or forced', async () => {
  const { host, state } = fakeHost([])
  let calls = 0
  const ask = async () => ++calls
  expect(await cached(host, 'open:o/r', 30_000, ask)).toBe(1)
  state.now = 20_000
  expect(await cached(host, 'open:o/r', 30_000, ask)).toBe(1) // fresh: no new call
  expect(await cached(host, 'open:o/r', 0, ask)).toBe(2) // forced
  state.now = 60_000
  expect(await cached(host, 'open:o/r', 30_000, ask)).toBe(3) // old
  expect(await cached(host, 'open:o/other', 30_000, ask)).toBe(4) // one entry per key
})
