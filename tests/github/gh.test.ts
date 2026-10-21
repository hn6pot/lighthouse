import { expect, test } from 'claude-code/testing'
import { ghEnv, ghJson } from '../../hooks/github/gh'
import { fakeHost } from '../helpers/fake-host'

const DIRS = { acme: '~/.config/gh-acme', globex: '/opt/gh/globex', home: '~' }

test('an owner listed in ghConfigDirs goes through its own config, the others do not', () => {
  expect(ghEnv('acme/web', '/h', DIRS)).toEqual({ GH_CONFIG_DIR: '/h/.config/gh-acme' })
  expect(ghEnv('globex/api', '/h', DIRS)).toEqual({ GH_CONFIG_DIR: '/opt/gh/globex' })
  expect(ghEnv('home/x', '/h', DIRS)).toEqual({ GH_CONFIG_DIR: '/h' })
  expect(ghEnv('initech/api', '/h', DIRS)).toBeUndefined()
  expect(ghEnv('acme/web', '/h', {})).toBeUndefined()
})

test('an owner named like an Object property is not mistaken for a configured one', () => {
  expect(ghEnv('constructor/x', '/h', DIRS)).toBeUndefined()
  expect(ghEnv('toString/x', '/h', DIRS)).toBeUndefined()
})

test('ghJson adds -R and the environment, and reads the JSON', async () => {
  const { host, calls } = fakeHost([[/^gh pr list/, { stdout: '[{"number":1}]' }]])
  expect(await ghJson(host, DIRS, 'acme/web', ['pr', 'list'])).toEqual([{ number: 1 }])
  expect(calls[0].line).toBe('gh pr list -R acme/web')
  expect(calls[0].options?.env).toEqual({ GH_CONFIG_DIR: '/Users/me/.config/gh-acme' })
})

test('ghJson throws a readable error if gh fails', async () => {
  const { host } = fakeHost([[/^gh/, { exitCode: 1, stderr: 'HTTP 401' }]])
  await expect(ghJson(host, {}, 'acme/x', ['pr', 'list'])).rejects.toThrow('HTTP 401')
})
