import { expect, test } from 'claude-code/testing'
import { mayCut } from '../../hooks/ui/unfold'

test('mayCut: longer than the room left, or the width unknown', () => {
  expect(mayCut('abcdef', 10, 4)).toBe(false)
  expect(mayCut('abcdefg', 10, 4)).toBe(true)
  expect(mayCut('⎇ ab', 6, 2)).toBe(false) // counted in characters, not UTF-16 units
  expect(mayCut('a', 0, 0)).toBe(true)
})
