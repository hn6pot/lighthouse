import { expect, test } from 'claude-code/testing'
import { deployPlan, type Rules } from '../../hooks/deploy/rules'
import { workflowVerdict } from '../../hooks/deploy/tracking'
import { texts } from '../../hooks/i18n'

const t = texts('fr')

const RULES: Rules = {
  'acme/api': { kind: 'workflow', workflow: 'Deploy Production' },
  'acme/jobs': { kind: 'delay', seconds: 120 },
  'acme/site': { kind: 'immediate' },
  'acme/templates': {
    kind: 'manual',
    commands: [{ only_under: 'templates/*/', single: true, command: 'make template-push T={1}' }],
  },
  'acme/infra': {
    kind: 'manual',
    commands: [
      { only_under: 'cloud/', command: 'make deploy' },
      { only_under: 'laptop/', command: 'make install' },
    ],
  },
  'acme/app': { kind: 'manual', commands: [{ always: true, command: 'make install' }] },
  'acme/docs': { kind: 'manual', commands: [{ always: true, command: 'pnpm install-app' }] },
  'acme/charts': { kind: 'manual', always_doubt: { fr: 'production : choisir la cible Helm à la main', en: 'production: pick the Helm target by hand' } },
}

test('unknown repo: workflow by default', () => {
  expect(deployPlan(RULES, 'acme/toolbox', ['a'], t)).toEqual({ kind: 'workflow' })
  expect(deployPlan({}, 'acme/api', ['a'], t)).toEqual({ kind: 'workflow' })
})

test('named workflow, delay, immediate', () => {
  expect(deployPlan(RULES, 'acme/api', [], t)).toMatchObject({ kind: 'workflow' })
  expect(deployPlan(RULES, 'acme/jobs', [], t)).toEqual({ kind: 'delay', ms: 120_000 })
  expect(deployPlan(RULES, 'acme/site', [], t)).toEqual({ kind: 'immediate' })
  expect(deployPlan(RULES, 'acme/app', ['app/Sources/x.swift'], t)).toEqual({ kind: 'manual', command: 'make install' })
})

test('named workflow: the name is the one gh run list returns (not the file name)', () => {
  expect(deployPlan(RULES, 'acme/api', ['src/a.py'], t)).toEqual({ kind: 'workflow', workflow: 'Deploy Production' })
  const runs = [{ name: 'Deploy Production', status: 'completed', conclusion: 'success', url: 'u' }]
  expect(workflowVerdict(runs, 'Deploy Production', 0, t)).toEqual({ state: 'ok', link: 'u' })
})

test('captured segment: a single template → command, several → doubt', () => {
  expect(deployPlan(RULES, 'acme/templates', ['templates/pr-reviewer/main.tf', 'templates/pr-reviewer/README.md'], t)).toEqual({
    kind: 'manual',
    command: 'make template-push T=pr-reviewer',
  })
  expect(deployPlan(RULES, 'acme/templates', ['templates/a/x', 'templates/b/y'], t)).toMatchObject({ kind: 'doubt' })
  expect(deployPlan(RULES, 'acme/templates', ['dispatcher/src/a.js'], t)).toMatchObject({ kind: 'doubt' })
})

test('only_under: one folder only, the other only, both', () => {
  expect(deployPlan(RULES, 'acme/infra', ['cloud/a', 'cloud/b'], t)).toEqual({ kind: 'manual', command: 'make deploy' })
  expect(deployPlan(RULES, 'acme/infra', ['laptop/a'], t)).toEqual({ kind: 'manual', command: 'make install' })
  expect(deployPlan(RULES, 'acme/infra', ['cloud/a', 'laptop/b'], t)).toMatchObject({ kind: 'doubt' })
})

test('always a command, always a doubt', () => {
  expect(deployPlan(RULES, 'acme/docs', ['x'], t)).toEqual({ kind: 'manual', command: 'pnpm install-app' })
  expect(deployPlan(RULES, 'acme/charts', ['x'], t)).toEqual({
    kind: 'doubt',
    reason: 'production : choisir la cible Helm à la main',
  })
  expect(deployPlan(RULES, 'acme/charts', ['x'], texts('en'))).toEqual({
    kind: 'doubt',
    reason: 'production: pick the Helm target by hand',
  })
})

test('PR without files on a manual repo with patterns: doubt', () => {
  expect(deployPlan(RULES, 'acme/infra', [], t)).toMatchObject({ kind: 'doubt' })
})

test('hostile segment in a path: never a command, doubt', () => {
  expect(deployPlan(RULES, 'acme/templates', ['templates/x;rm -rf ~/main.tf'], t)).toEqual({
    kind: 'doubt',
    reason: 'aucune commande de déploiement ne correspond aux fichiers touchés',
  })
})
