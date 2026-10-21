import { expect, test } from 'claude-code/testing'
import { prLinks, touchedFolders } from '../../hooks/repos/detect'

const CWD = '/w'
const H = '/h'

test('Edit, Write and NotebookEdit give the file’s folder', () => {
  expect(touchedFolders('Edit', { file_path: 'src/a.ts' }, CWD, H)).toEqual(['/w/src'])
  expect(touchedFolders('Write', { file_path: '/r/x/b.md' }, CWD, H)).toEqual(['/r/x'])
  expect(touchedFolders('NotebookEdit', { notebook_path: '~/n/c.ipynb' }, CWD, H)).toEqual(['/h/n'])
})

test('Bash: cd and git -C, quoted or not', () => {
  const command = 'cd ~/code/web && git status; git -C "/r/my api" log -1'
  expect(touchedFolders('Bash', { command }, CWD, H)).toEqual(['/h/code/web', '/r/my api'])
})

test('Bash without cd or git -C: nothing', () => {
  expect(touchedFolders('Bash', { command: 'ls -la' }, CWD, H)).toEqual([])
})

test('an unknown tool: nothing', () => {
  expect(touchedFolders('Read', { file_path: '/r/a' }, CWD, H)).toEqual([])
})

test('prLinks finds PR links, without duplicates', () => {
  const text = 'see https://github.com/acme/api/pull/98 and github.com/acme/docs/pull/17, again https://github.com/acme/api/pull/98'
  expect(prLinks(text)).toEqual([
    { slug: 'acme/api', number: 98 },
    { slug: 'acme/docs', number: 17 },
  ])
})
