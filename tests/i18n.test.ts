import { expect, test } from 'claude-code/testing'
import { langOf, texts } from '../hooks/i18n'

test('langOf: French only when asked, English otherwise', () => {
  expect(langOf('en')).toBe('en')
  expect(langOf('fr')).toBe('fr')
  expect(langOf(undefined)).toBe('en')
  expect(langOf('de')).toBe('en')
})

test('English texts: pane, toasts, reasons, deploy request', () => {
  const en = texts('en')
  expect(en.paneTitle).toBe('Lighthouse')
  expect(en.noRepo).toBe('No repo touched by this session yet.')
  expect(en.toast.merged(3, 'squash')).toBe('#3 merged (squash)')
  expect(en.toast.notPushed('feat/x', 'rejected')).toBe('feat/x not pushed: rejected')
  expect(en.reason.uncommittedIn(2, '/r/x')).toBe('2 uncommitted file(s) in /r/x')
  expect(en.chip.neverPushed(1)).toBe('1 commit never pushed')
  expect(en.prompt.deploy({ slug: 'w/x', number: 4, branch: 'feat/x', base: 'main', root: '/r' })).toBe(
    [
      'Deploy w/x after the merge of #4 (branch feat/x, base main, folder /r).',
      'Proposed command: to be determined.',
      'Reason for the doubt: unknown.',
      'Check before launching, then tell me what you did.',
    ].join('\n'),
  )
})

test('French stays the default wording', () => {
  const fr = texts('fr')
  expect(fr.paneTitle).toBe('Lighthouse')
  expect(fr.task.action('fix-ci', 4)).toBe('corrige la CI #4')
  expect(fr.prompt.deploy({ slug: 'w/x', number: 4, branch: 'feat/x', base: 'main', root: '/r', command: 'make deploy', reason: 'r' })).toBe(
    [
      'Déploie w/x après la fusion de #4 (branche feat/x, base main, dossier /r).',
      'Commande proposée : make deploy.',
      'Raison du doute : r.',
      'Vérifie avant de lancer, puis dis-moi ce que tu as fait.',
    ].join('\n'),
  )
})

test('document texts, in both languages', () => {
  expect(texts('en').doc.outOfDate).toBe('⚠ out of date')
  expect(texts('fr').doc.outOfDate).toBe('⚠ pas à jour')
  expect([texts('en').doc.page, texts('en').doc.copy, texts('fr').doc.copy, texts('fr').doc.markdown]).toEqual(['Page ↗', 'Copy', 'Copie', 'Markdown'])
})
