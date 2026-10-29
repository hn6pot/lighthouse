# Branch Docs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each PR card and branch line of the Lighthouse pane lists its specs and plans, with their state, their claude.ai page, a local copy of that page, and an "out of date" mark.

**Architecture:** A new `hooks/docs/` folder. The `tool.call` hook only notes raw events (a file written, a commit, an Artifact publish) in the tick's context; the tick turns them into records in a store of their own (`~/.lighthouse/docs/`), then computes each branch's documents from git and those records, at most every 30 s or right after an event. The pane draws one line per document under the card.

**Tech Stack:** TypeScript Claude Code mod (hooks module), `claude-code/testing`, git through `Host.run`.

**Spec:** `docs/superpowers/specs/2026-10-29-branch-docs-design.md` (page: https://claude.ai/artifact/Kd6JN1d1aEHHun4u7GzYZt). Read it before any task.

## Global Constraints

- Repo rules (`CLAUDE.md`): one responsibility per file; every use of `$` stays in `hooks/register.ts`; atoms only in `register.ts`, their shapes in `types/index.d.ts` (a self-contained copy of `hooks/model.ts`); tests under `tests/` mirroring `hooks/`; no real repo, company or person names in code or tests (`acme/api`, `acme/web`).
- Before each commit: `claude plugin test .` and `claude plugin validate .` both pass. A timed-out test is rerun before concluding.
- Commits: Conventional Commits in English (`feat(docs): …`).
- A failure of this feature never blocks a tool call nor a tick: every docs step is in its own `try/catch`, and a failure leaves the cards without documents.
- Lighthouse never writes into a repo and never publishes anything. It writes only under `~/.lighthouse/` (`docs/` for records, `pages/` for page copies).
- No extra GitHub call: only local git and files. Documents are recomputed at most every **30 s** (`DOCS_MS = 30_000`), or at the next tick after a doc event.
- A document: a `.md` under a folder named `specs` or `plans` (nearest such folder wins). Its identity: `owner/repo:path` in a repo with a GitHub origin, else its `~/…` path (absolute path when outside the home).
- The source tag: `<meta name="lighthouse-source" content="<identity>">`. A value starting with `~/` or `/` is a path; anything else must be `owner/repo:path`.
- States: spec `draft → approved → implemented`; plan `draft → in-progress → implemented`. Plan checkboxes are never read.
- A merged PR whose branch only touches `specs` / `plans` folders never marks anything implemented.
- Words follow the `language` option: every new text exists in `fr` and `en` in `hooks/i18n.ts`.
- `README.md` and `README.fr.md` change together.
- Work happens in a worktree on branch `feat/branch-docs` (in `.worktrees/`, or the session worktree the Desktop imposes). The spec and this plan, still uncommitted in the main checkout, are moved into it and committed first.

## Review Focus

- **A failed or asset-only Artifact call** (no URL in the result, `asset: true`, `action: "read"`): nothing recorded, nothing copied. Test in Task 2 and Task 5.
- **A tag naming a document of a repo the session does not know** (not in `ctx.repos`): URL and copy recorded, hash `null`, so no "out of date" mark ever. Test in Task 5.
- **A branch without a worktree**: hash read with `git rev-parse <branch>:<path>`; Markdown button only when the main checkout has the file. Test in Task 7.
- **A spec deleted by the branch**: not shown (`git diff --diff-filter=d`). Test in Task 6.
- **A docs-only PR merged** (spec branch merged before its code): the spec stays `approved`. Test in Task 7.

---

### Task 0: Worktree and commit of the spec and plan

- [ ] **Step 1:** Create the worktree `.worktrees/feat-branch-docs` on a new branch `feat/branch-docs` from `main` (or use the session worktree the Desktop imposes).
- [ ] **Step 2:** Move `docs/superpowers/specs/2026-10-29-branch-docs-design.md` and `docs/superpowers/plans/2026-10-29-branch-docs.md` from the main checkout into the worktree (same paths), so the main checkout is clean again.
- [ ] **Step 3:** Run `claude plugin test .` in the worktree. Expected: all pass (the baseline).
- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-10-29-branch-docs-design.md docs/superpowers/plans/2026-10-29-branch-docs.md
git commit -m "docs(docs): design and plan the branch docs"
```

---

### Task 1: Document identity and domain types

**Files:**
- Create: `hooks/docs/identity.ts`
- Modify: `hooks/model.ts` (add the doc types; add `docs?: BranchDoc[]` to `PrSummary`, `LocalBranch`, `Tracked`)
- Modify: `types/index.d.ts` (same shapes: `LighthouseDoc`, and `docs?: LighthouseDoc[]` on `LighthousePrSummary`, `LighthouseBranch`, `LighthouseTracked`)
- Test: `tests/docs/identity.test.ts`

**Interfaces:**
- Produces, in `hooks/model.ts`:
  ```ts
  export type DocKind = 'spec' | 'plan'
  export type DocState = 'draft' | 'approved' | 'in-progress' | 'implemented'
  /** A spec or plan as a card shows it. `file`: the Markdown in the branch's checkout, null when absent there. */
  export type BranchDoc = { id: string; kind: DocKind; name: string; state: DocState; file: string | null; page?: string; copy?: string; stale: boolean }
  ```
  `Tracked.docs` is set by the tick for the pane and never saved (like `owner`).
- Produces, in `hooks/docs/identity.ts`:
  ```ts
  export type DocId = string
  export function docKind(path: string): DocKind | null
  export function docName(path: string): string
  export function repoDocId(slug: string, rel: string): DocId
  export function localDocId(abs: string, home: string): DocId
  export function parseDocId(id: string): { slug: string; rel: string } | { path: string } | null
  export function copyPath(id: DocId, home: string): string
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('docKind: .md under specs or plans, nearest folder wins', () => {
  expect(docKind('docs/specs/2026-10-17-x-design.md')).toBe('spec')
  expect(docKind('/r/docs/superpowers/plans/y.md')).toBe('plan')
  expect(docKind('specs/old/plans/z.md')).toBe('plan')
  expect(docKind('docs/specs/notes.txt')).toBe(null)
  expect(docKind('docs/specs.md')).toBe(null)
  expect(docKind('src/plans.ts')).toBe(null)
})
test('docName drops the date, .md and a trailing -design or -plan', () => {
  expect(docName('docs/specs/2026-10-22-release-pane-design.md')).toBe('release-pane')
  expect(docName('docs/plans/2026-10-17-intent-plan.md')).toBe('intent')
  expect(docName('specs/rate-limiting.md')).toBe('rate-limiting')
})
test('identities: owner/repo:path in a repo, ~/… outside', () => {
  expect(repoDocId('acme/api', 'docs/specs/a.md')).toBe('acme/api:docs/specs/a.md')
  expect(localDocId('/Users/me/out/acme/docs/specs/b.md', '/Users/me')).toBe('~/out/acme/docs/specs/b.md')
  expect(localDocId('/srv/docs/specs/c.md', '/Users/me')).toBe('/srv/docs/specs/c.md')
})
test('parseDocId accepts the two forms, refuses the rest', () => {
  expect(parseDocId('acme/api:docs/specs/a.md')).toEqual({ slug: 'acme/api', rel: 'docs/specs/a.md' })
  expect(parseDocId('~/out/docs/plans/b.md')).toEqual({ path: '~/out/docs/plans/b.md' })
  expect(parseDocId('acme:docs/specs/a.md')).toBe(null)
  expect(parseDocId('acme/api:../etc/specs/a.md')).toBe(null)
  expect(parseDocId('acme/api:docs/a.md')).toBe(null) // not a doc path
})
test('copyPath: under ~/.lighthouse/pages, .md becomes .html', () => {
  expect(copyPath('acme/api:docs/specs/a.md', '/Users/me')).toBe('/Users/me/.lighthouse/pages/acme/api/docs/specs/a.html')
  expect(copyPath('~/out/docs/plans/b.md', '/Users/me')).toBe('/Users/me/.lighthouse/pages/local/out/docs/plans/b.html')
  expect(copyPath('/srv/docs/specs/c.md', '/Users/me')).toBe('/Users/me/.lighthouse/pages/local/srv/docs/specs/c.html')
})
```

- [ ] **Step 2:** Run `claude plugin test .` — Expected: FAIL, `hooks/docs/identity` not found.
- [ ] **Step 3:** Add the types to `hooks/model.ts` and `types/index.d.ts`; implement `hooks/docs/identity.ts`. `parseDocId` refuses a `..` segment, a slug that is not `owner/repo` (`[\w.-]+/[\w.-]+`), and any path where `docKind` is null.
- [ ] **Step 4:** Run `claude plugin test .` and `claude plugin validate .` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): identify specs and plans`

---

### Task 2: Reading an Artifact publish

**Files:**
- Create: `hooks/docs/artifact.ts`
- Test: `tests/docs/artifact.test.ts`

**Interfaces:**
- Consumes: `parseDocId`, `DocId` (Task 1); `join` from `hooks/paths.ts`.
- Produces:
  ```ts
  /** The HTML file a publish call sends, as an absolute path; null for any other Artifact call or tool. */
  export function publishedHtml(tool: string, input: Record<string, unknown>, cwd: string, home: string): string | null
  /** The first claude.ai artifact link in a tool result, whatever its shape. */
  export function artifactUrl(result: unknown): string | null
  /** The document a page names in its lighthouse-source tag, if valid. */
  export function sourceTag(html: string): DocId | null
  ```

- [ ] **Step 1: Write the failing tests**

```ts
test('publishedHtml: a publish (no action or "publish") of an .html file', () => {
  expect(publishedHtml('Artifact', { file_path: 'a/spec.html' }, '/w', '/h')).toBe('/w/a/spec.html')
  expect(publishedHtml('Artifact', { action: 'publish', file_path: '~/o/p.html' }, '/w', '/h')).toBe('/h/o/p.html')
})
test('publishedHtml: nothing for other actions, assets, Markdown or other tools', () => {
  expect(publishedHtml('Artifact', { action: 'read', url: 'https://claude.ai/artifact/x' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Artifact', { file_path: 'img.png', asset: true, url: 'u' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Artifact', { file_path: 'notes.md' }, '/w', '/h')).toBe(null)
  expect(publishedHtml('Write', { file_path: 'a.html' }, '/w', '/h')).toBe(null)
})
test('artifactUrl finds the link in a text or structured result', () => {
  expect(artifactUrl('Published x.html at https://claude.ai/artifact/Kd6JN1d1aEHHun4u7GzYZt (Version 1')).toBe('https://claude.ai/artifact/Kd6JN1d1aEHHun4u7GzYZt')
  expect(artifactUrl({ content: [{ type: 'text', text: 'at https://claude.ai/code/artifact/0b1c-22 ok' }] })).toBe('https://claude.ai/code/artifact/0b1c-22')
  expect(artifactUrl('Error: publish refused')).toBe(null)
})
test('sourceTag reads the meta in either attribute order and checks the value', () => {
  expect(sourceTag('<meta name="lighthouse-source" content="acme/api:docs/specs/a.md">')).toBe('acme/api:docs/specs/a.md')
  expect(sourceTag("<meta content='~/o/docs/plans/b.md' name='lighthouse-source'>")).toBe('~/o/docs/plans/b.md')
  expect(sourceTag('<meta name="lighthouse-source" content="acme/api:README.md">')).toBe(null)
  expect(sourceTag('<title>No tag</title>')).toBe(null)
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL, module not found.
- [ ] **Step 3:** Implement. `artifactUrl` matches `/https:\/\/claude\.ai\/(?:code\/)?artifact\/[\w-]+/` on the result if it is a string, else on `JSON.stringify(result)`. `publishedHtml` refuses `asset: true`, any `action` other than `publish`, and a `file_path` not ending in `.html`.
- [ ] **Step 4:** Run `claude plugin test .` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): read an Artifact publish and its source tag`

---

### Task 3: The conversation link

**Files:**
- Create: `hooks/docs/conversation.ts`
- Test: `tests/docs/conversation.test.ts`

**Interfaces:**
- Consumes: `DocId` (Task 1), `DocKind` (model).
- Produces:
  ```ts
  /** `root`: the main folder of the repo the code was written in (as `TreeState.root`). */
  export type ConversationLink = { doc: DocId; root: string; branch: string; at: number }
  /** `active`: the documents the next code goes to; `specs`: every spec this conversation touched. */
  export type Conversation = { active: DocId[]; specs: DocId[]; links: ConversationLink[] }
  export const EMPTY_CONVERSATION: Conversation
  export function noteDoc(c: Conversation, doc: DocId, kind: DocKind): Conversation
  export function noteCode(c: Conversation, root: string, branch: string, now: number): Conversation
  ```
  Rules: a spec not in `specs` replaces `active` (`[doc]`) and joins `specs`; a plan, or a spec already in `specs`, is added to `active` if absent. `noteCode` adds one link per active doc, unless the same `doc`/`root`/`branch` link exists.

- [ ] **Step 1: Write the failing tests**

```ts
test('spec A, plan A, code on feat/a: both linked to feat/a', () => {
  let c = noteDoc(noteDoc(EMPTY_CONVERSATION, 'acme/api:docs/specs/a.md', 'spec'), 'acme/api:docs/plans/a.md', 'plan')
  c = noteCode(c, '/r/api', 'feat/a', 1)
  expect(c.links.map(l => [l.doc, l.branch])).toEqual([['acme/api:docs/specs/a.md', 'feat/a'], ['acme/api:docs/plans/a.md', 'feat/a']])
})
test('a new spec stops the link: spec B never goes to feat/a, spec A never to feat/b', () => {
  let c = noteCode(noteDoc(EMPTY_CONVERSATION, 'S:a', 'spec'), '/r', 'feat/a', 1)
  c = noteCode(noteDoc(c, 'S:b', 'spec'), '/r', 'feat/b', 2)
  expect(c.links.filter(l => l.branch === 'feat/b').map(l => l.doc)).toEqual(['S:b'])
  expect(c.links.filter(l => l.branch === 'feat/a').map(l => l.doc)).toEqual(['S:a'])
})
test('code before any document links nothing; repeated code adds no duplicate', () => {
  expect(noteCode(EMPTY_CONVERSATION, '/r', 'feat/a', 1).links).toEqual([])
  const c = noteDoc(EMPTY_CONVERSATION, 'S:a', 'spec')
  expect(noteCode(noteCode(c, '/r', 'feat/a', 1), '/r', 'feat/a', 2).links).toHaveLength(1)
})
```

(`S:a` stands for any identity: the functions never parse it.)

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement as pure functions returning new objects.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): link a conversation's documents to the code it writes next`

---

### Task 4: The docs store

**Files:**
- Create: `hooks/docs/records.ts`
- Test: `tests/docs/records.test.ts`

**Interfaces:**
- Consumes: `Store`, `fileStore` (`hooks/host.ts`); `DATA_DIR` (`hooks/sessions/registry.ts`); `Conversation`, `EMPTY_CONVERSATION`, `ConversationLink` (Task 3).
- Produces (every function takes the docs `Store`, never `host.store`, so tracked PRs and docs never mix):
  ```ts
  export function docsStore(host: Pick<Host, 'run' | 'read' | 'write' | 'home'>): Store   // fileStore(host, `${home}/.lighthouse/docs`)
  export type PublishRecord = { url: string; at: number; hash: string | null; session: string }
  export function loadPublish(store: Store, id: DocId): Promise<PublishRecord | null>        // key `pub:<id>`
  export function savePublish(store: Store, id: DocId, r: PublishRecord): Promise<void>
  export function loadConversation(store: Store, session: string): Promise<Conversation>     // key `conv:<session>`, EMPTY when missing
  export function saveConversation(store: Store, session: string, c: Conversation): Promise<void>
  export function allLinks(store: Store): Promise<ConversationLink[]>                        // every `conv:*` record's links
  /** The documents last seen on a branch, and whether it touched code: read again once its PR is merged. */
  export type BranchSnapshot = { docs: DocId[]; code: boolean; at: number }
  export function loadSnapshot(store: Store, root: string, branch: string): Promise<BranchSnapshot | null>  // key `snap:<root>@<branch>`
  export function saveSnapshot(store: Store, root: string, branch: string, s: BranchSnapshot): Promise<void>
  export function markImplemented(store: Store, id: DocId, prKey: string): Promise<void>   // key `impl:<id>`, a set of PR keys
  export function implementedBy(store: Store, id: DocId): Promise<string[]>
  ```
  Every load validates the shape it reads and returns null / EMPTY / `[]` for anything malformed (a file written by another process).

- [ ] **Step 1: Write the failing tests** (with `fakeHost().store` as the `Store`)

```ts
test('a publish record round-trips; a malformed one reads as null', async () => {
  const { store } = fakeHost([])
  await savePublish(store, 'acme/api:docs/specs/a.md', { url: 'https://claude.ai/artifact/x', at: 5, hash: 'abc', session: 's1' })
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toEqual({ url: 'https://claude.ai/artifact/x', at: 5, hash: 'abc', session: 's1' })
  await store.set('pub:acme/api:docs/specs/b.md', { url: 3 })
  expect(await loadPublish(store, 'acme/api:docs/specs/b.md')).toBe(null)
})
test('allLinks gathers the links of every conversation', async () => {
  const { store } = fakeHost([])
  await saveConversation(store, 's1', { active: [], specs: [], links: [{ doc: 'S:a', root: '/r', branch: 'feat/a', at: 1 }] })
  await saveConversation(store, 's2', { active: [], specs: [], links: [{ doc: 'S:b', root: '/r', branch: 'feat/b', at: 2 }] })
  expect((await allLinks(store)).map(l => l.doc).sort()).toEqual(['S:a', 'S:b'])
})
test('markImplemented keeps each PR once', async () => {
  const { store } = fakeHost([])
  await markImplemented(store, 'S:a', 'acme/api#4')
  await markImplemented(store, 'S:a', 'acme/api#4')
  expect(await implementedBy(store, 'S:a')).toEqual(['acme/api#4'])
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): keep publishes, conversation links and merged branches in ~/.lighthouse/docs`

---

### Task 5: Applying the hook's events

**Files:**
- Create: `hooks/docs/events.ts`
- Test: `tests/docs/events.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; `roots`, `originSlug` (`hooks/repos/git.ts`); `parent` (`hooks/paths.ts`); `Repo` (model).
- Produces:
  ```ts
  /** Noted by the tool.call hook, applied at the tick (the hook runs no git). Paths are absolute. */
  export type DocEvent =
    | { kind: 'write'; path: string; at: number }      // Write, Edit or MultiEdit on any file
    | { kind: 'commit'; folder: string; at: number }   // a `git commit` run in that folder
    | { kind: 'publish'; html: string; url: string; at: number }
  /** The document a path is, or null when it is not a spec or plan. */
  export function resolveDoc(host: Host, path: string): Promise<DocId | null>
  /** Applies the events in order: conversation links, publish records, page copies. */
  export function applyDocEvents(host: Host, store: Store, session: string, repos: readonly Repo[], events: readonly DocEvent[]): Promise<void>
  ```
  - `resolveDoc`: `docKind(path)` null → null. `roots(host, parent(path))` found and `originSlug(root)` not null → `repoDocId(slug, path relative to the tree)`; otherwise `localDocId(path, host.home)`.
  - `write` on a document → `noteDoc`. `write` on any other file, or `commit` → find its tree (`roots`), its branch (`git -C <tree> branch --show-current`, skipped when empty), then `noteCode(c, root, branch, at)`. Files under `~/.lighthouse/` are ignored.
  - `publish` → `host.read(html)`; `sourceTag` null → nothing. Otherwise `noteDoc` for that document, then: find the Markdown (repo document: the repo in `repos` whose `slug` matches; its trees other than `root` first, then `root`; the first where `git hash-object <tree>/<rel>` exits 0; outside a repo: the path, `~` expanded). `hash` = that output, trimmed, or `null` when not found. Copy with `mkdir -p <parent of copyPath>` then `cp <html> <copyPath>`. `savePublish(store, id, { url, at, hash, session })`.
  - One event that throws does not stop the others.

- [ ] **Step 1: Write the failing tests** (fake host answering `rev-parse --show-toplevel`, `--git-common-dir`, `remote get-url origin`, `branch --show-current`, `hash-object`, `mkdir`, `cp`)

```ts
test('a spec written then code in a worktree: the spec is linked to that branch', async () => {
  // spec under /r/api/docs/specs/a.md (main checkout), code under /r/api/.worktrees/a/src/x.ts on feat/a
  await applyDocEvents(host, store, 's1', [], [{ kind: 'write', path: '/r/api/docs/specs/a.md', at: 1 }, { kind: 'write', path: '/r/api/.worktrees/a/src/x.ts', at: 2 }])
  expect((await loadConversation(store, 's1')).links).toEqual([{ doc: 'acme/api:docs/specs/a.md', root: '/r/api', branch: 'feat/a', at: 2 }])
})
test('a git commit links like a code write', async () => { /* commit event in the worktree folder → same link */ })
test('a tagged publish: page recorded with the Markdown hash, page copied', async () => {
  // html at /tmp/s/spec.html carries acme/api:docs/specs/a.md; repo acme/api known with trees ['/r/api', '/r/api/.worktrees/a']
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toEqual({ url: 'https://claude.ai/artifact/x', at: 3, hash: 'blob-wt', session: 's1' })
  expect(calls.map(c => c.line)).toContain('cp /tmp/s/spec.html /Users/me/.lighthouse/pages/acme/api/docs/specs/a.html')
})
test('a publish naming a repo the session does not know: recorded and copied, hash null', async () => {
  expect((await loadPublish(store, 'acme/web:docs/plans/b.md'))?.hash).toBe(null)
})
test('a publish without the tag records and copies nothing', async () => {
  expect(await loadPublish(store, 'acme/api:docs/specs/a.md')).toBe(null)
  expect(calls.some(c => c.line.startsWith('cp '))).toBe(false)
})
test('a document outside any repo is identified by its ~ path', async () => {
  expect(await resolveDoc(host, '/Users/me/out/acme/docs/specs/z.md')).toBe('~/out/acme/docs/specs/z.md')
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): record conversation links and page publishes`

---

### Task 6: What git says about a branch's documents

**Files:**
- Create: `hooks/docs/git-docs.ts`
- Test: `tests/docs/git-docs.test.ts`

**Interfaces:**
- Consumes: `docKind` (Task 1); `Host`.
- Produces:
  ```ts
  /** Documents the branch adds or modifies against `origin/<base>` (deletions excluded), plus uncommitted ones in its worktree; `code`: it touches a file outside specs/plans. Paths relative to the repo. */
  export function touchedDocs(host: Host, root: string, base: string, branch: string, path: string | null): Promise<{ docs: string[]; code: boolean }>
  /** Spec paths on `origin/<base>` (candidates for a citation by file name). */
  export function baseSpecs(host: Host, root: string, base: string): Promise<string[]>
  /** Plan paths on `origin/<base>` that mention `needle` (a spec's file name). */
  export function plansCitingOnBase(host: Host, root: string, base: string, needle: string): Promise<string[]>
  /** True when the branch has a commit after the plan's last commit that touches code; null when the plan is not committed on the branch. */
  export function codeAfterPlan(host: Host, root: string, branch: string, rel: string): Promise<boolean | null>
  /** The blob hash of a document as the branch has it: the worktree file, else the branch's committed version. */
  export function docHash(host: Host, root: string, branch: string, path: string | null, rel: string): Promise<string | null>
  ```
  Commands: `git -C <root> diff --name-only --diff-filter=d origin/<base>...<branch>`; `git -C <path> --no-optional-locks status --porcelain --untracked-files=all`; `git -C <root> ls-tree -r --name-only origin/<base>`; `git -C <root> grep -l -F <needle> origin/<base> -- '*plans/*.md'` (output lines `origin/<base>:<rel>`); `git -C <root> log -1 --format=%H <branch> -- <rel>` then `git -C <root> diff --name-only <commit> <branch>`; `git -C <path> hash-object <rel>` or `git -C <root> rev-parse <branch>:<rel>`. Any non-zero exit gives the empty answer (`[]`, `false`, `null`).

- [ ] **Step 1: Write the failing tests**

```ts
test('touchedDocs: added or modified docs, uncommitted ones, and whether code moved', async () => {
  // diff → 'docs/specs/a.md\nsrc/x.ts\n', status → '?? docs/plans/a.md\n'
  expect(await touchedDocs(host, '/r', 'main', 'feat/a', '/r/.worktrees/a')).toEqual({ docs: ['docs/specs/a.md', 'docs/plans/a.md'], code: true })
})
test('touchedDocs: a docs-only branch has no code; a deleted spec is not listed', async () => {
  // the diff command carries --diff-filter=d; answer 'docs/specs/a.md\n'
  expect(await touchedDocs(host, '/r', 'main', 'docs/a', null)).toEqual({ docs: ['docs/specs/a.md'], code: false })
  expect(calls[0].line).toContain('--diff-filter=d')
})
test('plansCitingOnBase strips the ref prefix', async () => {
  // grep → 'origin/main:docs/plans/a.md\n'
  expect(await plansCitingOnBase(host, '/r', 'main', '2026-10-01-a-design.md')).toEqual(['docs/plans/a.md'])
})
test('codeAfterPlan: true with a code commit after the plan, null when the plan is not committed', async () => {})
test('docHash: worktree file first, committed blob without a worktree', async () => {
  expect(await docHash(host, '/r', 'feat/a', null, 'docs/specs/a.md')).toBe('blob-committed') // via rev-parse feat/a:docs/specs/a.md
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): read a branch's documents from git`

---

### Task 7: A branch's documents, with their state

**Files:**
- Create: `hooks/docs/status.ts` (pure state rules)
- Create: `hooks/docs/collect.ts`
- Test: `tests/docs/status.test.ts`, `tests/docs/collect.test.ts`

**Interfaces:**
- Consumes: Tasks 1, 4, 6; `ConversationLink` (Task 3); `Tracked`, `BranchDoc` (model).
- Produces:
  ```ts
  // status.ts
  /** `citing`: plans citing the spec; `citingDone`: those implemented; `done`: the spec itself was marked implemented. */
  export function specState(f: { citing: number; citingDone: number; done: boolean }): DocState
  export function planState(f: { codeAfter: boolean; done: boolean }): DocState
  // collect.ts
  export type BranchRef = { root: string; slug: string | null; base: string; branch: string; path: string | null }
  export function branchDocs(host: Host, store: Store, b: BranchRef, links: readonly ConversationLink[]): Promise<BranchDoc[]>
  /** Once a PR is merged: every document of its branch's last snapshot is implemented by it, if that branch touched code. */
  export function markMerged(store: Store, s: Tracked): Promise<void>
  ```
  - `specState`: `citing > 0 && citingDone === citing` → implemented; `citing === 0 && done` → implemented; `citing > 0` → approved; else draft.
  - `planState`: `done` → implemented; `codeAfter` → in-progress; else draft.
  - `branchDocs` gathers the ids: touched docs (only when `slug` is not null, as `repoDocId`), conversation links matching `root` + `branch`, then the specs cited by those plans (plan text read from its `file`; a citation is a spec path from `baseSpecs` or among the ids, whose path or file name appears in the text; outside a repo, `~/…specs/….md` paths in the text). Then for each id: `file` (worktree file, else main checkout file, else null; outside a repo the expanded path if readable), `page` and `copy` from `loadPublish` (copy only if `host.read(copyPath)` is not null), `stale` = record hash and current `docHash` both non-null and different, and the state (plan: `done` = `implementedBy` non-empty, `codeAfter` = `codeAfterPlan`, or, when that is null, a conversation link for this branch exists; spec: `citing` = plans among the ids citing it ∪ `plansCitingOnBase`, `citingDone` = those with `implementedBy` non-empty, `done` = its own `implementedBy`). Saves `saveSnapshot(root, branch, { docs: ids, code, at })`. Sorted specs first, then by name.
  - `markMerged`: stage `open` → nothing; else `loadSnapshot(s.root, s.branch)`; `code` true → `markImplemented(id, s.key)` for each doc.

- [ ] **Step 1: Write the failing tests**

```ts
// status.test.ts
test('spec: draft, approved once cited, implemented once every citing plan is', () => {
  expect(specState({ citing: 0, citingDone: 0, done: false })).toBe('draft')
  expect(specState({ citing: 2, citingDone: 1, done: false })).toBe('approved')
  expect(specState({ citing: 2, citingDone: 2, done: false })).toBe('implemented')
  expect(specState({ citing: 0, citingDone: 0, done: true })).toBe('implemented')
})
test('plan: draft, in progress after code, implemented once merged', () => {
  expect(planState({ codeAfter: false, done: false })).toBe('draft')
  expect(planState({ codeAfter: true, done: false })).toBe('in-progress')
  expect(planState({ codeAfter: true, done: true })).toBe('implemented')
})
// collect.test.ts
test('a branch with its spec and plan: approved spec, plan in progress, page and copy, not stale', async () => {
  expect(await branchDocs(host, store, REF, [])).toEqual([
    { id: 'acme/api:docs/specs/2026-10-01-a-design.md', kind: 'spec', name: 'a', state: 'approved', file: '/r/.worktrees/a/docs/specs/2026-10-01-a-design.md', page: 'https://claude.ai/artifact/x', copy: '/Users/me/.lighthouse/pages/acme/api/docs/specs/2026-10-01-a-design.html', stale: false },
    { id: 'acme/api:docs/plans/2026-10-01-a.md', kind: 'plan', name: 'a', state: 'in-progress', file: '/r/.worktrees/a/docs/plans/2026-10-01-a.md', stale: false },
  ])
})
test('the Markdown changed since the publish: stale', async () => {})
test('a spec only linked by the conversation (written on main before the worktree) shows on the branch', async () => {})
test('a spec merged earlier on main, cited by the branch plan, shows on the branch', async () => {})
test('a branch without a worktree: hash from the branch, no file when main lacks it', async () => {})
test('markMerged: a code PR marks its docs implemented; a docs-only PR marks nothing', async () => {
  await saveSnapshot(store, '/r', 'docs/a', { docs: ['acme/api:docs/specs/a.md'], code: false, at: 1 })
  await markMerged(store, merged('docs/a'))
  expect(await implementedBy(store, 'acme/api:docs/specs/a.md')).toEqual([])
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement `status.ts`, then `collect.ts`.
- [ ] **Step 4:** Run tests — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(docs): work out a branch's documents and where they stand`

---

### Task 8: The tick puts the documents on the cards

**Files:**
- Create: `hooks/docs/refresh.ts`
- Modify: `hooks/loop.ts` (`Context.docs`, one call in `tick` before `actions.publish`)
- Test: `tests/docs/refresh.test.ts`, one new test in `tests/loop.test.ts`

**Interfaces:**
- Consumes: Tasks 4, 5, 7; `TreeState`, `Tracked` (model).
- Produces:
  ```ts
  export const DOCS_MS = 30_000
  /** Absent: the feature is off (the existing loop tests build no docs context). */
  export type DocsContext = { store: Store; events: DocEvent[]; at?: number; byBranch: Map<string, BranchDoc[]> }
  /** Applies the noted events, then recomputes every shown branch's documents when an event came or DOCS_MS passed; marks merged PRs. */
  export function refreshDocs(host: Host, docs: DocsContext, session: string, repos: readonly Repo[], trees: readonly TreeState[], tracked: readonly Tracked[], now: number): Promise<void>
  /** The documents of `root@branch` as last computed (empty when unknown). */
  export function docsOf(docs: DocsContext | undefined, root: string, branch: string | undefined): BranchDoc[]
  ```
  In `Context` (`hooks/loop.ts`): `docs?: DocsContext`. In `tick`: after building `shown` and `ownedEvents`, `if (ctx.docs) try { await refreshDocs(host, ctx.docs, ctx.id, [...ctx.repos.values()], trees, all, now) } catch {}`, then attach `docs` (only when non-empty) to each PR (`docsOf(ctx.docs, tree.root, p.localBranch)`), each branch (`b.name`) and each merged event (`s.branch`). `refreshDocs` drains `events` (`splice(0)`) before applying them, computes branches of PRs that have a `localBranch` and of every branch line, and calls `markMerged` for every tracked PR past `open`.

- [ ] **Step 1: Write the failing tests**

```ts
// refresh.test.ts
test('no event and less than 30 s since the last pass: nothing recomputed', async () => {})
test('an event forces a pass at the next tick, and the events are drained', async () => {
  expect(docs.events).toEqual([])
})
// loop.test.ts
test('with a docs context, a branch that adds a spec shows it on its card', async () => {
  // ctx() + docs: { store: fakeHost([]).store, events: [], byBranch: new Map() }; branch feat/a ahead with docs/specs/a.md in its diff
  expect(published.at(-1)?.trees[0].branches[0].docs?.[0]).toMatchObject({ kind: 'spec', name: 'a', state: 'draft' })
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement `refresh.ts` and the loop change. The existing loop tests must still pass unchanged.
- [ ] **Step 4:** Run `claude plugin test .` — Expected: PASS (all).
- [ ] **Step 5: Commit** — `feat(docs): show each branch's documents at the tick`

---

### Task 9: The document lines in the pane

**Files:**
- Create: `hooks/ui/doc-lines.ts` (pure text), `hooks/ui/docs.tsx` (drawing)
- Modify: `hooks/ui/pane.tsx` (call it in `prCard`, `branchCard`, `mergedCard`), `hooks/ui/band.tsx` (`Buttons.openPath`), `hooks/i18n.ts` (`doc` texts in `fr` and `en`)
- Test: `tests/ui/doc-lines.test.ts`, one case in `tests/i18n.test.ts`

**Interfaces:**
- Consumes: `BranchDoc` (model), `Buttons`, `Texts`.
- Produces:
  ```ts
  // band.tsx, in Buttons
  /** Opens a local file (a page copy or a Markdown) with the system's `open`. */
  openPath: (path: string) => Promise<void> | void
  // i18n.ts, in both languages
  doc: { kind: (k: DocKind) => string; state: (k: DocKind, s: DocState) => string; page: string; copy: string; markdown: string; outOfDate: string; more: (n: number) => string }
  // doc-lines.ts
  export const DOCS_SHOWN = 4
  export function docLabel(d: BranchDoc, t: Texts): string           // "▤ Spec rate-limiting · approved"
  // docs.tsx
  export function drawDocs(ui: ReturnType<EngineInterface['ui']['resolve']>, docs: readonly BranchDoc[] | undefined, key: string, buttons: Buttons, busy: (key: string, label: string) => string, t: Texts): JSX.Element[]
  ```
  Texts — en: `Spec`, `Plan`; states `draft`, `approved`, `in progress`, `implemented`; `Page ↗`, `Copy`, `Markdown`, `⚠ out of date`, `+N more`. fr: `Spec`, `Plan`; spec `brouillon`, `approuvée`, `en cours`, `implémentée`; plan `brouillon`, `approuvé`, `en cours`, `implémenté`; `Page ↗`, `Copie`, `Markdown`, `⚠ pas à jour`, `+N autres`.
  Each document is one wrapping row: the label (dim), a `Link` to `page` labelled `t.doc.page` when there is a page, then `t.doc.outOfDate` in `warning` color when `stale`, a `Copy` button when `copy`, a `Markdown` button when there is no page and `file` is set. At most `DOCS_SHOWN` rows, then a dim `t.doc.more(n)`. Placed right after the progress line in `prCard` and `mergedCard`, after the chips in `branchCard`. Nothing drawn when `docs` is empty or absent.

- [ ] **Step 1: Write the failing tests**

```ts
test('docLabel names the kind, the name and the state, in both languages', () => {
  const d: BranchDoc = { id: 'acme/api:docs/specs/a.md', kind: 'spec', name: 'rate-limiting', state: 'approved', file: null, stale: false }
  expect(docLabel(d, texts('en'))).toBe('▤ Spec rate-limiting · approved')
  expect(docLabel({ ...d, kind: 'plan', state: 'in-progress' }, texts('fr'))).toBe('▤ Plan rate-limiting · en cours')
  expect(docLabel(d, texts('fr'))).toBe('▤ Spec rate-limiting · approuvée')
})
```

- [ ] **Step 2:** Run tests — Expected: FAIL.
- [ ] **Step 3:** Implement the texts, `docLabel`, `drawDocs`, and the three calls in `pane.tsx`.
- [ ] **Step 4:** Run `claude plugin test .` and `claude plugin validate .` — Expected: PASS.
- [ ] **Step 5: Commit** — `feat(ui): draw each card's specs and plans`

---

### Task 10: Wiring in register.ts, README, and a real try

**Files:**
- Modify: `hooks/register.ts`, `README.md`, `README.fr.md`
- Test: one new test in `tests/register.test.ts` if the kit lets a `tool.call` be played (as the existing tests play `session.start`); otherwise the manual check below is the test.

**Interfaces:**
- Consumes: `docsStore` (Task 4), `DocEvent` (Task 5), `publishedHtml`, `artifactUrl` (Task 2), `DocsContext` (Task 8), `Buttons.openPath` (Task 9).
- Changes:
  - Where `ctx` is built: `docs: { store: docsStore(host), events: [], byBranch: new Map() }`.
  - In `tool.call`, after `next(e)`, each wrapped so it never throws: `Write` / `Edit` / `MultiEdit` with a string `file_path` → push `{ kind: 'write', path: join(here, file_path, host.home), at }`; a `Bash` command matching `/\bgit\s+(?:-C\s+\S+\s+)?commit\b/` → `{ kind: 'commit', folder: touched[0] ?? here, at }`; `publishedHtml(...)` non-null and `artifactUrl(result.result)` non-null → `{ kind: 'publish', html, url, at }`. Any push calls `state.rerun()`.
  - `buttons.openPath`: only an absolute path (`/^\//`), never containing a newline; `host.run(['open', path])`.
  - README (both languages): a "Specs and plans" section under "What it does" (the document lines, the three linking rules, the states, the tag with its two forms, the local copy), and two rows in "Files it writes": `docs/` and `pages/` (deleting them loses the links and the copies).

- [ ] **Step 1:** Write the register test if the kit allows it: an `Artifact` `tool.call` whose input has a tagged `file_path` and whose result has a link leaves one `publish` event (observed through a `cp` in `process.run`) — Expected first: FAIL.
- [ ] **Step 2:** Implement the wiring.
- [ ] **Step 3:** Run `claude plugin test .` and `claude plugin validate .` — Expected: PASS.
- [ ] **Step 4:** Update both READMEs.
- [ ] **Step 5: Manual check in the Desktop** (`claude --plugin-dir <worktree>`, or the dev-mods link), in a scratch repo `acme/try` with a worktree on `feat/try`:
  1. Write `docs/specs/2026-10-29-try-design.md` in the main checkout, then a code file in the worktree → within 30 s the `feat/try` line shows `▤ Spec try · draft · [Markdown]`.
  2. Publish an HTML page carrying `<meta name="lighthouse-source" content="acme/try:docs/specs/2026-10-29-try-design.md">` → `Page ↗` and `Copy` appear; `~/.lighthouse/pages/acme/try/docs/specs/2026-10-29-try-design.html` exists; check in `~/.lighthouse/docs/` that the recorded URL is the page's.
  3. Edit the spec → `⚠ out of date` appears; republish → it goes.
  4. Write a plan citing the spec → spec `approved`, plan `in progress` after a code commit.
  Expected: each step as described. Report any difference instead of patching around it.
- [ ] **Step 6: Commit** — `feat(docs): wire branch docs into the session and document them`

---

## Outside this repo (for the person, after the merge)

Add to the WorkingLab `CLAUDE.md` rule on specs and plans, and to the `artifact-style` skill: "the published HTML of a spec or plan carries `<meta name="lighthouse-source" content="owner/repo:path">` (or `content="~/path"` for a document outside a repo)". Without it, pages are never linked.
