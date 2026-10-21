import { expect, test } from 'claude-code/testing'
import { join, parent } from '../hooks/paths'

test('join resolves relative, absolute, ~ and ..', () => {
  expect(join('/a/b', 'c/d', '/h')).toBe('/a/b/c/d')
  expect(join('/a/b', '/x', '/h')).toBe('/x')
  expect(join('/a/b', '~/w', '/h')).toBe('/h/w')
  expect(join('/a/b', '../c/./d/', '/h')).toBe('/a/c/d')
})

test('parent', () => {
  expect(parent('/a/b/c.ts')).toBe('/a/b')
  expect(parent('/a')).toBe('/')
})
