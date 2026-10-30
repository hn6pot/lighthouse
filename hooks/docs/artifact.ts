// What an Artifact tool call says: the page it publishes, its link, and the document the page names.
import { join } from '../paths'
import { parseDocId, type DocId } from './identity'

const URL = /https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/
const META = /<meta\b[^>]*>/gi
const ATTR = (name: string) => new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i')

/** The HTML file a publish call sends, as an absolute path; null for any other Artifact call or tool. */
export function publishedHtml(tool: string, input: Record<string, unknown>, cwd: string, home: string): string | null {
  if (tool !== 'Artifact' || input.asset === true) return null
  if (input.action !== undefined && input.action !== 'publish') return null
  const file = input.file_path
  return typeof file === 'string' && file.endsWith('.html') ? join(cwd, file, home) : null
}

/** The first claude.ai artifact link in a tool result, whatever its shape. */
export function artifactUrl(result: unknown): string | null {
  const text = typeof result === 'string' ? result : (JSON.stringify(result) ?? '')
  return text.match(URL)?.[0] ?? null
}

/** The document a page names in its lighthouse-source tag, if valid. */
export function sourceTag(html: string): DocId | null {
  for (const [tag] of html.matchAll(META)) {
    const name = tag.match(ATTR('name'))
    if ((name?.[1] ?? name?.[2]) !== 'lighthouse-source') continue
    const content = tag.match(ATTR('content'))
    const value = content?.[1] ?? content?.[2] ?? ''
    return parseDocId(value) === null ? null : value
  }
  return null
}
