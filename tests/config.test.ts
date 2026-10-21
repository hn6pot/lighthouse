import { expect, test } from 'claude-code/testing'
import { configPath, loadConfig, NO_CONFIG, parseConfig } from '../hooks/config'
import { ghEnv } from '../hooks/github/gh'
import { fakeHost } from './helpers/fake-host'

const FILE = '/Users/me/.lighthouse/config.json'

test('the config file lives in ~/.lighthouse', () => {
  expect(configPath('/Users/me')).toBe(FILE)
})

test('a valid file: every rule kind and the gh config dirs', async () => {
  const config = {
    rules: {
      'acme/api': { kind: 'workflow', workflow: 'Deploy Production' },
      'acme/web': { kind: 'workflow' },
      'acme/jobs': { kind: 'delay', seconds: 120 },
      'acme/site': { kind: 'immediate' },
      'acme/infra': { kind: 'manual', commands: [{ only_under: 'terraform/*/', single: true, command: 'make apply ENV={1}' }, { always: true, command: 'make plan' }] },
      'acme/charts': { kind: 'manual', always_doubt: { en: 'pick the target by hand', fr: 'choisir la cible à la main' } },
      'acme/legacy': { kind: 'manual', always_doubt: 'deployed by another team' },
    },
    ghConfigDirs: { acme: '~/.config/gh-acme' },
  }
  const { host } = fakeHost([], { [FILE]: JSON.stringify(config) })
  expect(await loadConfig(host)).toEqual(config)
})

test('no file, unreadable file or invalid JSON: no rules, no gh config dirs', async () => {
  expect(await loadConfig(fakeHost([]).host)).toEqual(NO_CONFIG)
  const { host } = fakeHost([])
  expect(await loadConfig({ ...host, read: async () => Promise.reject(new Error('EACCES')) })).toEqual(NO_CONFIG)
  expect(parseConfig('{ not json')).toEqual(NO_CONFIG)
  expect(parseConfig('[1, 2]')).toEqual(NO_CONFIG)
  expect(parseConfig('null')).toEqual(NO_CONFIG)
  expect(parseConfig('{"rules": [], "ghConfigDirs": "x"}')).toEqual(NO_CONFIG)
})

test('bad entries are left out, the good ones kept', () => {
  const config = parseConfig(
    JSON.stringify({
      rules: {
        'acme/ok': { kind: 'immediate' },
        'acme/unknown-kind': { kind: 'rocket' },
        'acme/no-kind': {},
        'acme/not-an-object': 'immediate',
        'acme/bad-workflow': { kind: 'workflow', workflow: 3 },
        'acme/bad-delay': { kind: 'delay', seconds: '120' },
        'acme/negative-delay': { kind: 'delay', seconds: -1 },
        'acme/bad-commands': { kind: 'manual', commands: 'make deploy' },
        'acme/bad-command': { kind: 'manual', commands: [{ command: 'make deploy' }, { only_under: 'x/' }] },
        'acme/bad-flag': { kind: 'manual', commands: [{ always: 'yes', command: 'make deploy' }] },
        'acme/half-doubt': { kind: 'manual', always_doubt: { en: 'only English' } },
        'no-slash': { kind: 'immediate' },
      },
      ghConfigDirs: { acme: '~/.config/gh-acme', empty: '', number: 3, list: ['x'] },
    }),
  )
  expect(config).toEqual({ rules: { 'acme/ok': { kind: 'immediate' } }, ghConfigDirs: { acme: '~/.config/gh-acme' } })
})

test('only one of the two sections: the other is empty', () => {
  expect(parseConfig('{"ghConfigDirs": {"acme": "/gh/acme"}}')).toEqual({ rules: {}, ghConfigDirs: { acme: '/gh/acme' } })
  expect(parseConfig('{"rules": {"acme/site": {"kind": "immediate"}}}')).toEqual({ rules: { 'acme/site': { kind: 'immediate' } }, ghConfigDirs: {} })
})

test('ghConfigDirs from the file maps the owner of a repo to its gh account', async () => {
  const { host } = fakeHost([], { [FILE]: JSON.stringify({ ghConfigDirs: { acme: '~/.config/gh-acme', globex: '/opt/gh-globex' } }) })
  const { ghConfigDirs } = await loadConfig(host)
  expect(ghEnv('acme/api', host.home, ghConfigDirs)).toEqual({ GH_CONFIG_DIR: '/Users/me/.config/gh-acme' })
  expect(ghEnv('globex/web', host.home, ghConfigDirs)).toEqual({ GH_CONFIG_DIR: '/opt/gh-globex' })
  expect(ghEnv('initech/api', host.home, ghConfigDirs)).toBeUndefined()
})
