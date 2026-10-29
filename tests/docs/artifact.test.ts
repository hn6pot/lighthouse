import { expect, test } from 'claude-code/testing'
import { artifactUrl, publishedHtml, sourceTag } from '../../hooks/docs/artifact'

test('publishedHtml: a publish (no action or "publish") of an .html file', () => {
  expect(publishedHtml('Artifact', { file_path: 'a/spec.html' }, '/w', '/h')).toBe('/w/a/spec.html')
  expect(publishedHtml('Artifact', { action: 'publish', file_path: '~/o/p.html' }, '/w', '/h')).toBe('/h/o/p.html')
})

test('publishedHtml: nothing for other actions, assets, Markdown or other tools', () => {
  expect(publishedHtml('Artifact', { action: 'read', url: 'https://claude.ai/artifact/x' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Artifact', { file_path: 'img.png', asset: true, url: 'u' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Artifact', { file_path: 'page.html', asset: true, url: 'u' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Artifact', { file_path: 'notes.md' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Write', { file_path: 'a.html' }, '/w', '/h')).toBe(null)
})

test('artifactUrl finds the link in a text or structured result', () => {
  expect(artifactUrl('Published x.html at https://claude.ai/artifact/Kd6JN1d1aEHHun4u7GzYZt (Version 1')).toBe('https://claude.ai/artifact/Kd6JN1d1aEHHun4u7GzYZt')
  expect(artifactUrl({ content: [{ type: 'text', text: 'at https://claude.ai/code/artifact/0b1c-22 ok' }] })).toBe('https://claude.ai/code/artifact/0b1c-22')
  expect(artifactUrl('Error: publish refused')).toBe(null)
  expect(artifactUrl(undefined)).toBe(null)
})

test('sourceTag reads the meta in either attribute order and checks the value', () => {
  expect(sourceTag('<meta name="lighthouse-source" content="acme/api:docs/specs/a.md">')).toBe('acme/api:docs/specs/a.md')
  expect(sourceTag("<meta content='~/o/docs/plans/b.md' name='lighthouse-source'>")).toBe('~/o/docs/plans/b.md')
  expect(sourceTag('<meta name="lighthouse-source" content="acme/api:README.md">')).toBe(null)
  expect(sourceTag('<title>No tag</title>')).toBe(null)
})
