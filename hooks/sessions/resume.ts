// A resumed conversation runs in a new process: it gets back the repos it worked in from its registry entry.
import type { Host } from '../host'
import { addFolder, type Context } from '../loop'
import { savedTrees } from './registry'

/** Re-adds the trees this session saved; a folder gone or no longer a git tree is skipped. */
export async function resumeTrees(host: Host, ctx: Context): Promise<void> {
  for (const tree of await savedTrees(host, ctx.id)) await addFolder(host, ctx, tree).catch(() => undefined)
}
