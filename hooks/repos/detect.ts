// What a tool call or a text says about the repos the session works in.
import { join, parent } from '../paths'

const FILE_TOOLS: Record<string, string> = { Edit: 'file_path', Write: 'file_path', MultiEdit: 'file_path', NotebookEdit: 'notebook_path' }
const ARG = `("[^"]+"|'[^']+'|[^\\s;&|]+)`
const CD = new RegExp(`(?:^|&&|;|\\|\\||\\()\\s*cd\\s+${ARG}`, 'g')
const GIT_C = new RegExp(`\\bgit\\s+-C\\s+${ARG}`, 'g')

const unquote = (text: string) => text.replace(/^["']|["']$/g, '')

export function touchedFolders(tool: string, input: Record<string, unknown>, cwd: string, home: string): string[] {
  const key = FILE_TOOLS[tool]
  if (key !== undefined && typeof input[key] === 'string') {
    return [parent(join(cwd, input[key] as string, home))]
  }
  if (tool !== 'Bash' || typeof input.command !== 'string') return []

  const found: string[] = []
  for (const pattern of [CD, GIT_C]) {
    for (const match of input.command.matchAll(pattern)) {
      found.push(join(cwd, unquote(match[1]), home))
    }
  }
  return [...new Set(found)]
}

export function prLinks(text: string): { slug: string; number: number }[] {
  const seen = new Map<string, { slug: string; number: number }>()
  for (const match of text.matchAll(/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/g)) {
    seen.set(`${match[1]}#${match[2]}`, { slug: match[1], number: Number(match[2]) })
  }
  return [...seen.values()]
}
