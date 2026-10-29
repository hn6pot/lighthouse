// Wires Claude Code's events to the mod's modules. No logic here.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'
import { commandActivity, repoOf, type Activity, type Target } from './activity'
import { bashSucceeded, commandMatches, deployPrompt, finishesDeploy, isDeployCommand } from './deploy/manual'
import { loadTracked, moveTo, reread, save } from './flow/state'
import { GH_FRESH_MS } from './github/cache'
import { ghEnv } from './github/gh'
import { merge } from './github/merge'
import { fileStore, type Host } from './host'
import { langOf, texts, type Texts } from './i18n'
import { NO_CONFIG } from './config'
import { addFolder, addPrLink, cleanNow, forgetNow, refreshConfig, tick, type Context } from './loop'
import type { ReleaseRepo, TreeState } from './model'
import { prLinks, touchedFolders } from './repos/detect'
import { artifactUrl, publishedHtml } from './docs/artifact'
import type { DocEvent } from './docs/events'
import { docsStore } from './docs/records'
import { join } from './paths'
import { push } from './repos/git'
import { DATA_DIR, forgetSession, record } from './sessions/registry'
import { drawBand, type Buttons } from './ui/band'
import { actionPrompt, branchPrompt, CHECK_FRAMES, tidyPrompt } from './ui/lines'
import { notifyOnce, sendNotification } from './ui/notify'
import { isOpenable } from './ui/doc-lines'
import { drawPane, PANE } from './ui/pane'
import { drawReleasePane } from './ui/release-pane'
import { launchRelease } from './release/launch'

const TICK_MS = 10_000
/** After a git or gh command, the tick starts this much later: a burst of commands makes only one. */
const AFTER_COMMAND_MS = 1_500
/** These commands change the repos' state: a tick follows. */
const GIT_COMMAND = /(^|[\s;&|(])(git|gh)\s/
/** These also move the base: it is reread without waiting for the fetch interval. */
const MOVES_BASE = /\b(merge|pull|push|fetch|rebase)\b/
/** A commit, in the session's folder or another (`git -C <folder> commit`). */
const GIT_COMMIT = /\bgit\s+(?:-C\s+\S+\s+)?commit\b/
/** The tools that write a file at `file_path`. */
const WRITE_TOOLS = new Set(['Write', 'Edit', 'MultiEdit'])
/** Heartbeat in the registry: other sessions read there that this one is still alive. */
const HEARTBEAT_MS = 60_000

// Declared here, the only file that reads and writes them (the validator asks for it).
const TREES = atom({ plugin: 'lighthouse', key: 'trees' } as const, [])
const EVENTS = atom({ plugin: 'lighthouse', key: 'events' } as const, [])
const EXPANDED = atom({ plugin: 'lighthouse', key: 'expanded' } as const, {})
const PENDING_MERGE = atom({ plugin: 'lighthouse', key: 'pendingMerge' } as const, null)
const ACTIVITIES = atom({ plugin: 'lighthouse', key: 'activities' } as const, [])
const AGENT_LIMIT_MS = 30 * 60_000
const CELEBRATING = atom({ plugin: 'lighthouse', key: 'celebrating' } as const, {})
/** Buttons whose action is running: their label says « … ». */
const PRESSED = atom({ plugin: 'lighthouse', key: 'pressed' } as const, {})
/** A pressed button shows « … » at least this long, so the press is seen. */
const PRESS_FEEDBACK_MS = 700
/** True from a press on Refresh until the tick it starts has drawn. */
const REFRESHING = atom({ plugin: 'lighthouse', key: 'refreshing' } as const, false)
/** The PRs where my review is requested, and whether the intent mod can review them. */
const REVIEWS = atom({ plugin: 'lighthouse', key: 'reviews' } as const, [])
const INTENT = atom({ plugin: 'lighthouse', key: 'intent' } as const, false)
/** The repos with a release rule, for the Releases pane (and the main pane's counter). */
const RELEASES = atom({ plugin: 'lighthouse', key: 'releases' } as const, [])
/** The PRs to review are asked to GitHub at most this often (its search API is rate-limited), unless Refresh is pressed. */
const REVIEWS_FRESH_MS = 2 * 60_000
/** Only a GitHub PR link goes to `/intent`. */
const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/
/** The check of a cleaned PR: one frame this long, then the tick stays this long before the card goes. */
const FRAME_MS = 150
const CHECK_HOLD_MS = 4_000
/** Other sessions are named by the start of their first prompt, this long at most. */
const LABEL_MAX = 40

/** A first press on "Merge" waits this long for the second. */
const CONFIRM_MS = 10_000

type State = {
  t: Texts
  host: Host | null
  ctx: Context | null
  /** Deploy commands entrusted to Claude: PR key → expected command. */
  entrusted: Map<string, string>
  /** Raw entries noted by the hooks, handled at the tick only (never git or gh without an interface). */
  folders: Set<string>
  links: Map<string, { slug: string; number: number }>
  /** PR keys whose request is on its way to Claude: a second press is ignored. */
  sending: Set<string>
  /** The repos as published at the last tick: the buttons find their PR there. */
  trees: TreeState[]
  /** The PR whose "Merge" waits for the second press. */
  pendingMerge: string | null
  /** The pane: opened by the mod, or closed by the person (never reopened on its own then). */
  pane: 'open' | 'closed' | null
  /** The Releases pane, the same way: opened once on its own, never again once the person closed it. */
  releasePane: 'open' | 'closed' | null
  /** Asks for a tick soon (grouped), or right after the running one. */
  rerun: () => void
  /** Runs a tick now (the Refresh button), or right after the one running. */
  tickNow: () => Promise<void>
  /** A git or gh command or a button just changed things: the next tick asks GitHub instead of the shared cache. */
  forceGh: boolean
  /** Refresh was pressed: the next tick asks GitHub for the PRs to review too. */
  forceReviews: boolean
  /** The intent mod's command was there at the last tick. */
  intent: boolean
  /** What was last drawn, to redraw only on change. */
  drawn: string
  /** Release repos (slug) whose last press launched nothing, and why: shown in their block until the next press. */
  releaseRefusals: Map<string, string>
  /** The release repos as published at the last tick. */
  releases: ReleaseRepo[]
  /** Cleaned PRs whose check was already drawn in this session: never again. */
  celebrated: Set<string>
  /** The start of this session's first prompt: how the other sessions name it. */
  label: string | null
  /** What is being done right now, published in ACTIVITIES. */
  activities: Map<string, Activity>
  /** The agents launched from the pane: their activity and their folder. */
  agents: Map<string, { activity: string; cwd: string }>
}

const noteLinks = (state: State, text: string) => {
  for (const l of prLinks(text)) state.links.set(`${l.slug}#${l.number}`, l)
}

// Here and not in host.ts: Claude Code refuses `$` crossing an import.
async function hostFrom($: EngineInterface): Promise<Host> {
  const home = (await $.env.get('HOME')) ?? ''

  const base: Pick<Host, 'run' | 'read' | 'write'> = {
    run: (argv, options) => $.process.run(argv, options),
    read: async path => ((await $.fs.exists(path)) ? String(await $.fs.read(path)) : null),
    write: (path, text) => $.fs.write(path, text),
  }

  return {
    ...base,
    launch: async (argv, { cwd }) => {
      let output = ''
      const stream = $.process.spawn({ argv, cwd })
      for (;;) {
        const chunk = await stream.next()
        if (chunk.done) return { code: chunk.value.code, output }
        output += chunk.value.text
      }
    },
    now: () => $.clock.now(),
    store: fileStore(base, `${home}/${DATA_DIR}/state`),
    home,
  }
}

const publishActivities = ($: EngineInterface, state: State) => update($, ACTIVITIES, () => [...state.activities.values()])
const begin = async ($: EngineInterface, state: State, activity: Activity) => {
  state.activities.set(activity.id, activity)
  await publishActivities($, state)
}
const end = async ($: EngineInterface, state: State, id: string) => {
  if (state.activities.delete(id)) await publishActivities($, state)
}
/** While the mod acts, its "⟳" line; removed whatever happens. */
const during = async <T>($: EngineInterface, state: State, activity: Activity, action: () => Promise<T>): Promise<T> => {
  await begin($, state, activity)
  try {
    return await action()
  } finally {
    await end($, state, activity.id)
  }
}

/** The GH_CONFIG_DIR of the repo's gh account, when the config gives it one. */
const ghConfigDir = (state: State, a: TreeState) =>
  a.slug === null || !state.host || !state.ctx ? undefined : ghEnv(a.slug, state.host.home, state.ctx.config.ghConfigDirs)?.GH_CONFIG_DIR

/** Hands a task to a background agent, in the branch's folder; its line stays until its turn ends. */
async function delegate($: EngineInterface, state: State, target: Target, description: string, instruction: string, cwd: string) {
  const id = `agent:${crypto.randomUUID()}`
  await begin($, state, { id, ...target })
  try {
    const launched = await $.agent.spawn({ prompt: instruction + state.t.prompt.agentBrief, description, cwd, subagentType: 'general-purpose' })
    if (launched.agentId) state.agents.set(launched.agentId, { activity: id, cwd })
    // Its end comes through turn.complete; if it never does, the line does not stay forever.
    $.clock.after(AGENT_LIMIT_MS, () => void end($, state, id))
  } catch (err) {
    await end($, state, id)
    throw err
  }
}

/** The stages where a deploy is still to be done or redone. */
const DEPLOY_STAGES: readonly string[] = ['merged', 'deploying', 'deploy-doubt', 'failed']

/** Marks the merged PRs of a repo as handled by this session when it runs their deploy; returns their keys. */
async function markHandled(host: Host, id: string, root: string, command: string): Promise<string[]> {
  const now = await host.now()
  const keys: string[] = []
  for (const s of await loadTracked(host.store)) {
    if (s.root !== root || !DEPLOY_STAGES.includes(s.stage)) continue
    if (!isDeployCommand(command) && !(s.command && commandMatches(command, s.command))) continue
    await save(host.store, { ...s, handledBy: id, handledAt: now })
    keys.push(s.key)
  }
  return keys
}

const findPr = (state: State, root: string, number: number) => {
  const a = state.trees.find(x => x.root === root)
  const p = a?.prs.find(x => x.number === number)
  return a && p ? { a, p } : null
}

const buttons = ($: EngineInterface, state: State): Buttons => {
  const { t } = state
  const fail = (err: unknown) => $.ui.toast(t.errorToast(String(err)))
  return {
    run: (key, action) =>
      void (async () => {
        // Its label says « … » from the press until the action is done, and long enough to be seen.
        await update($, PRESSED, p => ({ ...p, [key]: true }))
        const started = await $.clock.now()
        try {
          await action()
        } finally {
          const clear = () => void update($, PRESSED, ({ [key]: _, ...rest }) => rest)
          const left = PRESS_FEEDBACK_MS - ((await $.clock.now()) - started)
          if (left > 0) $.clock.after(left, clear)
          else clear()
        }
      })().catch(fail),
    toggle: (root, open) => void update($, EXPANDED, d => ({ ...d, [root]: !open })).catch(fail),
    tidy: root => {
      // A new Desktop session in the repo, the instruction already typed: the person sends it and follows it there.
      const a = state.trees.find(x => x.root === root)
      if (!state.host || !state.ctx || !a) return
      const link = `claude://code/new?${new URLSearchParams({ q: tidyPrompt(a, t, ghConfigDir(state, a)), folder: root }).toString()}`
      return state.host.run(['open', link]).then(() => undefined, fail)
    },
    openSession: desktopId => {
      // A desktop session id only: it goes into a claude:// link the Mac hands to the Desktop.
      if (!state.host || !/^local_[\w-]+$/.test(desktopId)) return
      return state.host.run(['open', `claude://claude.ai/epitaxy/${desktopId}`]).then(() => undefined, fail)
    },
    openPath: path => {
      // A page copy or a Markdown the tick found: never anything else.
      if (!state.host || !isOpenable(path)) return
      return state.host.run(['open', path]).then(() => undefined, fail)
    },
    refresh: () =>
      void (async () => {
        // At once, asking GitHub and rereading the base; the icon says it is on it until the tick has drawn.
        state.ctx?.lastFetch.clear()
        state.forceGh = true
        state.forceReviews = true
        await update($, REFRESHING, () => true)
        await state.tickNow()
      })().catch(fail),
    merge: (root, number) =>
      (async () => {
        const found = findPr(state, root, number)
        if (!state.host || !state.ctx || !found?.a.slug) return
        const key = `${found.a.slug}#${number}`
        if (state.pendingMerge !== key) {
          state.pendingMerge = key
          await update($, PENDING_MERGE, () => key)
          $.clock.after(CONFIRM_MS, () => {
            if (state.pendingMerge !== key) return
            state.pendingMerge = null
            void update($, PENDING_MERGE, () => null)
          })
          return
        }
        state.pendingMerge = null
        await update($, PENDING_MERGE, () => null)
        if (state.sending.has(key)) return
        state.sending.add(key)
        try {
          const host = state.host
          const dirs = state.ctx.config.ghConfigDirs
          const slug = found.a.slug
          const message = await during($, state, { id: `merge:${key}`, root, number, text: t.activity.merging }, () => merge(host, dirs, slug, number, found.p.head, t))
          $.ui.toast(message)
          state.rerun() // deploy tracking takes over without waiting for the next tick
        } finally {
          state.sending.delete(key)
        }
      })().catch(fail),
    ask: (root, number, action) =>
      (async () => {
        const found = findPr(state, root, number)
        if (!found) return
        const { a, p } = found
        await delegate($, state, { root, number, text: t.activity.action[action] }, t.task.action(action, p.number), actionPrompt(action, a, p, t, ghConfigDir(state, a)), p.path ?? root)
      })().catch(fail),
    push: (root, branch, to) =>
      (async () => {
        const a = state.trees.find(x => x.root === root)
        if (!state.host || !a) return
        const key = `push:${root}@${branch}`
        if (state.sending.has(key)) return
        state.sending.add(key)
        try {
          const host = state.host
          const path = a.branches.find(b => b.name === branch)?.path ?? a.prs.find(p => p.localBranch === branch)?.path ?? null
          $.ui.toast(await during($, state, { id: key, root, branch, text: t.activity.pushing }, () => push(host, root, path, branch, t, to)))
          state.rerun()
        } finally {
          state.sending.delete(key)
        }
      })().catch(fail),
    intent: url => {
      // `/intent <link>` of the intent mod (a mod cannot import another one): it opens its review page on that PR.
      if (!PR_URL.test(url)) return
      return $.command.run({ command: 'intent', args: url }).then(() => undefined, fail)
    },
    openPr: (root, branch) =>
      (async () => {
        const a = state.trees.find(x => x.root === root)
        const b = a?.branches.find(x => x.name === branch)
        if (!a || !b) return
        await delegate($, state, { root, branch, text: t.activity.opensThePr }, t.task.openPr(branch), branchPrompt(a, b, t, ghConfigDir(state, a)), b.path ?? root)
      })().catch(fail),
    deploy: key =>
      (async () => {
        if (!state.host || state.sending.has(key)) return
        state.sending.add(key)
        try {
          const s = (await loadTracked(state.host.store)).find(x => x.key === key)
          if (!s) return
          if (s.command) state.entrusted.set(key, s.command)
          await $.prompt.submit({ text: deployPrompt(s, t) })
        } finally {
          state.sending.delete(key)
        }
      })().catch(fail),
    clean: key =>
      (async () => {
        if (!state.host || !state.ctx) return
        state.ctx.cwd = await $.session.cwd()
        $.ui.toast(await cleanNow(state.host, state.ctx, key))
      })().catch(fail),
    release: (slug, shown) =>
      (async () => {
        if (!state.host || !state.ctx) return
        const launched = await launchRelease(state.host, state.ctx, slug, shown)
        if (launched.ok) state.releaseRefusals.delete(slug)
        else state.releaseRefusals.set(slug, launched.reason)
        $.ui.toast(launched.ok ? t.releasePane.launched(launched.version) : launched.reason)
        await state.tickNow()
      })().catch(fail),
    forget: key =>
      (async () => {
        if (!state.host) return
        const { done, message } = await forgetNow(state.host, key, t)
        if (done) await update($, EVENTS, ev => ev.filter(s => s.key !== key)) // without waiting for the next tick
        $.ui.toast(message)
      })().catch(fail),
  }
}

export const register: Register = (on, options) => {
  const t = texts(langOf(options.language))
  const state: State = {
    t, host: null, ctx: null, entrusted: new Map(), folders: new Set(), links: new Map(), sending: new Set(),
    trees: [], pendingMerge: null, pane: null, releasePane: null, rerun: () => undefined, tickNow: async () => undefined, activities: new Map(), agents: new Map(), forceGh: false, forceReviews: false, intent: false, drawn: '', celebrated: new Set(), label: null, releaseRefusals: new Map(), releases: [],
  }
  let running = false
  let replay = false
  let scheduled = false

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: 'lighthouse', description: t.commandDescription })
    await $.command.register({ name: 'release', description: t.releaseCommandDescription })
    const host = (state.host = await hostFrom($))
    const cwd = await $.session.cwd()
    const ctx = (state.ctx = { id: await $.session.id(), cwd, repos: new Map(), lastFetch: new Map(), logins: new Map(), t, config: NO_CONFIG, docs: { store: docsStore(host), events: [], byBranch: new Map() } } as Context)
    state.folders.add(cwd) // resolved at the first tick, if there is an interface

    /** The first prompt, on one line and cut short, once there is one. */
    const labelOf = async () => {
      if (state.label !== null) return state.label
      const messages = await $.session.messages().catch(() => [])
      const first = Array.isArray(messages) ? messages.find(m => m.role === 'user' && m.text.trim() !== '') : undefined
      if (!first) return undefined
      const line = first.text.replace(/\s+/g, ' ').trim()
      state.label = line.length > LABEL_MAX ? `${line.slice(0, LABEL_MAX - 1)}…` : line
      return state.label
    }
    const recordHere = async () => {
      const label = await labelOf()
      await record(host, ctx.id, { cwd: ctx.cwd, trees: [...ctx.repos.values()].flatMap(d => d.trees), ...(label ? { label } : {}) })
    }
    // On its own timer: a tick may stay blocked for a whole manual deploy.
    const heartbeat = async () => {
      if ((await $.session.surfaces()).length === 0) return // claude -p: nothing
      await recordHere()
    }

    /** A check that fills up frame by frame, stays, then lets the card go. */
    const celebrate = (key: string) => {
      state.celebrated.add(key)
      const frame = (n: number) => {
        void update($, CELEBRATING, c => ({ ...c, [key]: n }))
        if (n < CHECK_FRAMES.length - 1) $.clock.after(FRAME_MS, () => frame(n + 1))
        else $.clock.after(CHECK_HOLD_MS, () => void update($, CELEBRATING, ({ [key]: _, ...rest }) => rest))
      }
      frame(0)
    }

    const runTick = async () => {
      if (running) {
        replay = true // asked for during a tick: one more is needed after, on the fresh state
        return
      }
      if ((await $.session.surfaces()).length === 0) return // claude -p: nothing
      running = true
      try {
        // The session may have changed folder (EnterWorktree): the cleanup guard must know.
        ctx.cwd = await $.session.cwd()
        state.folders.add(ctx.cwd)
        // Before the PR links: telling my PRs apart needs the right gh account.
        await refreshConfig(host, ctx)
        const folders = [...state.folders]
        const links = [...state.links.values()]
        state.folders.clear()
        state.links.clear()
        for (const d of folders) await addFolder(host, ctx, d).catch(() => undefined)
        for (const l of links) await addPrLink(host, ctx, l.slug, l.number).catch(() => undefined)
        // Registry up to date before any cleanup decision of the tick; after that, the heartbeat keeps it.
        await recordHere()
        ctx.ghMaxAge = state.forceGh ? 0 : GH_FRESH_MS
        state.forceGh = false
        ctx.reviewsMaxAge = state.forceReviews ? 0 : REVIEWS_FRESH_MS
        state.forceReviews = false
        // The intent mod may be enabled or disabled at any time: its command says whether it is there.
        const intent = await $.command.list().then(list => list.some(c => c.name === 'intent'), () => false)
        if (intent !== state.intent) {
          state.intent = intent
          await update($, INTENT, () => intent)
        }
        await tick(host, ctx, {
          notify: (key, text) =>
            notifyOnce(host.store, x => sendNotification(host, y => $.ui.notify(y, { title: 'lighthouse' }), x), key, text),
          publish: async (trees, events, reviews, found) => {
            state.trees = trees
            for (const s of events) if (s.stage === 'cleaned' && !state.celebrated.has(s.key)) celebrate(s.key)
            const releases = found.map(r => {
              const refusal = state.releaseRefusals.get(r.slug)
              return refusal ? { ...r, refusal } : r
            })
            state.releases = releases
            const drawn = JSON.stringify([trees, events, reviews, releases])
            if (drawn === state.drawn) return // nothing changed: no redraw
            state.drawn = drawn
            await update($, TREES, () => trees)
            await update($, EVENTS, () => events)
            await update($, REVIEWS, () => reviews)
            await update($, RELEASES, () => releases)
          },
        })
        // On the side as soon as there is a repo to show; never reopened on its own once closed by hand.
        if (state.trees.length > 0 && state.pane === null) {
          state.pane = 'open'
          await $.ui.open({ id: PANE, title: t.paneTitle }).catch(() => undefined) // without a pane, the band stays
        }
        // The Releases pane, once, in a session on a release repo that has something to ship.
        const shipping = state.releases.some(r => r.waiting.length > 0 && state.trees.some(tr => tr.root === r.path))
        if (shipping && state.releasePane === null) {
          state.releasePane = 'open'
          await $.ui.open({ id: 'release', title: t.releasePaneTitle }).catch(() => undefined)
        }
      } finally {
        running = false
        if (replay) {
          replay = false
          void runTick().catch(() => undefined)
        } else {
          await update($, REFRESHING, () => false)
        }
      }
    }
    state.tickNow = runTick
    state.rerun = () => {
      state.forceGh = true
      if (scheduled) return
      scheduled = true
      $.clock.after(AFTER_COMMAND_MS, () => {
        scheduled = false
        void runTick().catch(() => undefined)
      })
    }
    $.clock.after(3_000, () => void runTick().catch(() => undefined))
    $.clock.every(TICK_MS, () => void runTick().catch(() => undefined))
    $.clock.every(HEARTBEAT_MS, () => void heartbeat().catch(() => undefined))
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (state.host && state.ctx) await forgetSession(state.host, state.ctx.id)
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const { host, ctx, entrusted } = state
    if (!host || !ctx) return next(e)
    const input = e as unknown as Record<string, unknown>
    // An agent launched from the pane works in its own folder, not the session's.
    const agent = e.agentId === undefined ? undefined : state.agents.get(e.agentId)
    const here = agent?.cwd ?? ctx.cwd
    const touched = touchedFolders(String(e.tool), input, here, host.home)
    for (const folder of touched) state.folders.add(folder)

    // During the command, what Claude is doing; during its whole turn, the repo it works in.
    const repos = [...ctx.repos.values()]
    const command = e.tool === 'Bash' && typeof input.command === 'string' ? input.command : null
    const target = command === null ? null : commandActivity(command, touched[0] ?? here, repos, t)
    if (e.agentId === undefined && (command === null ? touched.length > 0 : target !== null)) {
      const repo = repoOf(target?.folder ?? touched[0] ?? here, repos)
      if (repo && !state.activities.has(`turn:${repo.root}`)) await begin($, state, { id: `turn:${repo.root}`, root: repo.root, text: t.activity.working })
    }
    // A deploy command in a repo with a merged PR: this session handles that deploy (no Deploy button, no doubt notification).
    const deployRepo = command !== null ? repoOf(touched[0] ?? here, repos) : undefined
    const handling = deployRepo && command !== null ? await markHandled(host, ctx.id, deployRepo.root, command) : []
    if (handling.length > 0) state.rerun()
    const result = target ? await during($, state, { id: `cmd:${e.tool_use_id}`, ...target }, () => next(e)) : await next(e)
    // ...and once it succeeded, the PR is deployed.
    if (handling.length > 0 && command !== null && finishesDeploy(command) && 'result' in result && bashSucceeded(result)) {
      const now = await host.now()
      for (const key of handling) {
        const s = await reread(host.store, key)
        if (s && DEPLOY_STAGES.includes(s.stage)) await save(host.store, moveTo(s, 'deployed', now))
      }
      state.rerun()
    }

    // What touches the specs and plans: noted here, applied at the next tick (no git in this hook).
    try {
      const docs = ctx.docs
      const tool = String(e.tool)
      const events: DocEvent[] = []
      const at = await host.now()
      if (WRITE_TOOLS.has(tool) && typeof input.file_path === 'string') events.push({ kind: 'write', path: join(here, input.file_path, host.home), at })
      if (command !== null && GIT_COMMIT.test(command)) events.push({ kind: 'commit', folder: touched[0] ?? here, at })
      const html = publishedHtml(tool, input, here, host.home)
      const url = html !== null && 'result' in result ? artifactUrl(result.result) : null
      if (html !== null && url !== null) events.push({ kind: 'publish', html, url, at })
      if (docs && events.length > 0) {
        docs.events.push(...events)
        state.rerun()
      }
    } catch {
      // never block the tool: the documents are only shown
    }

    if (command !== null) {
      const text = 'result' in result ? JSON.stringify(result.result ?? '') : ''
      noteLinks(state, `${command}\n${text}`)
      if (GIT_COMMAND.test(command)) {
        if (MOVES_BASE.test(command)) ctx.lastFetch.clear()
        state.rerun()
      }

      // a command entrusted to Claude succeeded (finished, not in the background): the PR is deployed
      const succeeded = 'result' in result && bashSucceeded(result)
      for (const [key, expected] of entrusted) {
        if (succeeded && commandMatches(command, expected)) {
          const s = (await loadTracked(host.store)).find(x => x.key === key)
          if (s) await save(host.store, moveTo(s, 'deployed', await host.now()))
          entrusted.delete(key)
        }
      }
    }
    return result
  }).catch(($, e, next) => next(e)) // a failure of the mod must never block the tool or the prompt

  on('prompt.submit', async ($, e, next) => {
    noteLinks(state, e.text)
    return next(e)
  }).catch(($, e, next) => next(e)) // a failure of the mod must never block the tool or the prompt

  // The end of a turn: a pane agent's removes its line; the session's, "Claude is working here".
  on('turn.complete', async ($, e, next) => {
    const agent = e.agentId === undefined ? undefined : state.agents.get(e.agentId)
    if (agent && e.agentId !== undefined) {
      state.agents.delete(e.agentId)
      await end($, state, agent.activity)
      state.rerun()
    } else if (e.agentId === undefined) {
      for (const id of [...state.activities.keys()]) if (id.startsWith('turn:')) state.activities.delete(id)
      await publishActivities($, state)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE && e.origin.kind === 'person') state.pane = 'closed'
    if (e.id === 'release' && e.origin.kind === 'person') state.releasePane = 'closed'
    return next(e)
  })

  on('command.run', { command: 'lighthouse' }, async $ => {
    state.pane = 'open'
    await $.ui.open({ id: PANE, title: t.paneTitle, focus: true })
    return {}
  })

  // Literal: the validator refuses an imported constant; same value as RELEASE_PANE (ui/release-pane.tsx).
  on('command.run', { command: 'release' }, async $ => {
    state.releasePane = 'open'
    await $.ui.open({ id: 'release', title: t.releasePaneTitle, focus: true })
    return {}
  })
  on('ui.render', { component: 'Pane', requestId: 'release' }, async ($, e) =>
    drawReleasePane($.ui.resolve(e), e.props.bodyColumns ?? 0, await read($, RELEASES), await read($, EXPANDED), await read($, REFRESHING), await read($, PRESSED), buttons($, state), t),
  )

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) =>
    drawBand($.ui.resolve(e), await read($, EVENTS), await read($, PRESSED), buttons($, state), t) ?? next(e),
  )
  // Literal: the validator refuses an imported constant; same value as PANE (ui/pane.tsx).
  on('ui.render', { component: 'Pane', requestId: 'lighthouse' }, async ($, e) =>
    drawPane($.ui.resolve(e), e.props.bodyColumns ?? 0, await read($, TREES), await read($, EVENTS), await read($, EXPANDED), await read($, PENDING_MERGE), await read($, ACTIVITIES), await read($, CELEBRATING), await read($, REFRESHING), await read($, PRESSED), await read($, REVIEWS), await read($, INTENT), (await read($, RELEASES)).reduce((n, r) => n + r.waiting.length, 0), buttons($, state), t),
  )
}
