import { expect, test } from 'claude-code/testing'
import type { ReleaseEntry, ReleaseKind } from '../../hooks/model'
import { nextVersion, sortVersionTags } from '../../hooks/release/version'

const of = (...kinds: ReleaseKind[]): ReleaseEntry[] => kinds.map((kind, i) => ({ sha: `s${i}`, number: i, title: 't', kind }))

test('a feature bumps the minor', () => {
  expect(nextVersion('v0.2.40', of('fix', 'feat'))).toBe('v0.3.0')
})

test('fixes and others only bump the patch', () => {
  expect(nextVersion('v0.2.40', of('fix', 'other'))).toBe('v0.2.41')
  expect(nextVersion('v0.2.40', [])).toBe('v0.2.41')
})

test('no tag gives 0.1.0', () => {
  expect(nextVersion(null, of('feat'))).toBe('v0.1.0')
})

test('version tags sort by number, others are left out', () => {
  expect(sortVersionTags(['v0.10.0', 'v0.2.9', 'nightly', 'v0.2.40'])).toEqual(['v0.2.9', 'v0.2.40', 'v0.10.0'])
})
