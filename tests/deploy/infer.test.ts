import { expect, test } from 'claude-code/testing'
import { inferPlan, makeTargets, npmScripts, pushWorkflows, repoFacts } from '../../hooks/deploy/infer'
import { texts } from '../../hooks/i18n'
import { fakeHost } from '../helpers/fake-host'

const t = texts('fr')
const NONE = { workflows: [], makeTargets: [], npmScripts: [] }

test('workflows started by a push count, manual-only ones do not', () => {
  expect(pushWorkflows([
    { file: 'deploy.yml', text: 'name: Deploy\non:\n  push:\n    branches: [main]\njobs: {}' },
    { file: 'ci.yml', text: 'on: [push, pull_request]\n' },
    { file: 'manual.yml', text: 'on:\n  workflow_dispatch:\n' },
    { file: 'pr.yml', text: 'on: pull_request\n' },
  ])).toEqual(['deploy.yml', 'ci.yml'])
})

test('Makefile targets and npm scripts', () => {
  expect(makeTargets('.PHONY: test\ntest: lint\n\tgo test\ninstall: test app\nX := 1\n')).toEqual(['test', 'install'])
  expect(npmScripts('{"scripts":{"build":"tsc","install-app":"x"}}')).toEqual(['build', 'install-app'])
  expect(npmScripts('not json')).toEqual([])
})

test('a push workflow: the deploy is that workflow', () => {
  expect(inferPlan({ ...NONE, workflows: [{ file: 'deploy.yml', text: 'on:\n  push:\n' }] }, t)).toEqual({
    plan: { kind: 'workflow' }, note: 'Déploiement par workflow (deploy.yml)',
  })
})

test('no workflow but a deploy command: proposed, never run on a guess', () => {
  expect(inferPlan({ ...NONE, makeTargets: ['test', 'install'] }, t)).toEqual({
    plan: { kind: 'doubt', reason: 'pas de workflow : make install détecté, à confirmer', command: 'make install' },
    note: 'Projet local : déploiement par make install ?',
  })
  expect(inferPlan({ ...NONE, makeTargets: ['install', 'deploy'] }, t).plan).toMatchObject({ command: 'make deploy' })
  expect(inferPlan({ ...NONE, npmScripts: ['install-app'] }, t).plan).toMatchObject({ command: 'npm run install-app' })
})

test('nothing to deploy: a local project, deployed at once', () => {
  expect(inferPlan(NONE, t)).toEqual({ plan: { kind: 'immediate' }, note: 'Projet local : rien à déployer' })
  expect(inferPlan(NONE, texts('en')).note).toBe('Local project: nothing to deploy')
})

test('repoFacts reads the workflows, the Makefile and package.json of the main folder', async () => {
  const { host } = fakeHost([[/^ls -1 \/r\/.github\/workflows$/, { stdout: 'deploy.yml\nREADME.md\n' }]], {
    '/r/.github/workflows/deploy.yml': 'on: push\n',
    '/r/Makefile': 'install:\n\tx\n',
  })
  expect(await repoFacts(host, '/r')).toEqual({ workflows: [{ file: 'deploy.yml', text: 'on: push\n' }], makeTargets: ['install'], npmScripts: [] })
})
