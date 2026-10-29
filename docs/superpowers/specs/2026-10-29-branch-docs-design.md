# Branch docs: show each branch's spec, plan and published page

Date: 2026-10-29. Repo: `hn6pot/lighthouse`.

## Why

The person writes a spec and a plan for almost everything in progress, as Markdown in the repo (`docs/specs/`, `docs/plans/`, `docs/superpowers/specs/`…), and publishes each one as a claude.ai Artifact page, which is what they actually reread. Nothing links these documents to the branch or PR they belong to: the page links end up scattered in memory notes, and finding "the spec of this branch" means searching.

Two more worries:

- The pages live on a claude.ai account that the person may lose one day (a work account). The HTML file that was published often sits in a temporary scratchpad folder and disappears, so only the Markdown survives.
- After a spec changes, the page is sometimes not republished, and nothing says so.

Lighthouse already lists every branch and PR the person works on, knows which session works where, and sees every tool call of the session. It is the natural place to show, on each branch, the documents that go with it.

## Goals

- On each **PR card and each branch without a PR** that the main pane already shows (from the moment the branch exists, before any PR), list the **specs and plans linked to it**.
- Each document shows its **kind** (spec / plan), its **name**, its **state** (draft / approved / in progress / implemented), and up to three ways to open it:
  - **its page**, the claude.ai Artifact URL, when it has been published;
  - **its local copy** of that page, kept by Lighthouse;
  - **the Markdown**, when it has no page.
- A **"page out of date"** signal when the Markdown changed since its page was last published.
- At each publish of a page linked to a document, Lighthouse **keeps a local copy** of the published HTML (the latest one only), so the page survives the loss of the account or of the scratchpad.
- Nothing has to be written in the Markdown documents, and Lighthouse never writes into a repo.

## Non-goals

- No list of every document of the past (a catalog of all specs and pages): only the documents of the branches and PRs the pane already shows. Maybe later.
- No documents on the **To review** frame (other people's PRs).
- No history of page versions: one copy, the latest.
- No publishing, republishing or editing of a page or a document by Lighthouse. It only reads and copies.
- No `Status:` line or any other header in the Markdown: the state is deduced.

## Anti-goals (a failure even if it works)

- A branch showing a document that belongs to another piece of work, when the link was a guess.
- The pane getting busy: a branch with documents gains a line or two, not a block.
- A page shown as up to date when its Markdown changed after the publish.
- Lighthouse writing anything into a repo, or publishing anything.

## Decided with the person

- **Main gesture: click to open** the document's page. Plus the "out of date" signal and the document's state.
- **Page ↔ Markdown link: a tag in the published HTML** that names its Markdown source. Not a line in the Markdown, not a guess.
- **A document without a page is shown too**; the click opens the Markdown.
- **Local copy of the page: yes, the latest one**, replaced at each republish.
- **State: deduced**, never written in the document.
- **Branch ↔ document link**: the documents the branch touches, **plus the ones written or published in the same conversation as the branch** (the person: "often it's the same conversation, we write a spec and implement it").
- **The conversation link is bounded**: a document goes to the branches where the conversation writes code *after* it, until the conversation starts a new spec. Merely visiting a folder does not count.
- **Documents outside any repo are covered too** (some projects keep their specs in `~/claude-outputs/<project>/docs/`, not in git). They can only be linked through the conversation.

## Design

### What counts as a document

A Markdown file (`.md`) under a folder named `specs` or `plans` at any depth (`docs/specs/x.md`, `docs/superpowers/plans/y.md`), either in a git repo or outside any repo (`~/claude-outputs/acme/docs/specs/z.md`). A file under `specs` is a **spec**, under `plans` a **plan**. Its **name** is the file name without the date prefix (`YYYY-MM-DD-`) and the `.md`, and without a trailing `-design` / `-plan` (`2026-10-22-release-pane-design.md` → `release-pane`).

A document is identified by:

- in a repo: **repo (`owner/repo`, from `origin`) + path relative to the repo root**, so the same document is recognised in the main checkout and in every worktree;
- outside any repo: **its absolute path, with the home folder written `~`**.

### The source tag in the published page

The HTML file given to the Artifact tool carries, in its `<head>`:

```html
<meta name="lighthouse-source" content="hn6pot/lighthouse:docs/superpowers/specs/2026-10-29-branch-docs-design.md">
```

- Value: the document's identity above. In a repo, `owner/repo:path`, never an absolute path: the page is often built from a worktree that is later deleted. Outside a repo, the `~/…` path (`content="~/claude-outputs/acme/docs/specs/z.md"`). A value starting with `~/` or `/` is a path; anything else is `owner/repo:path`.
- Lighthouse does not add this tag. The person's own rule for publishing specs and plans (in their `CLAUDE.md` and `artifact-style` skill) asks Claude to add it. The README documents the tag so anyone can use it.
- A page without the tag is not linked to anything. Pages published before this feature are linked at their next republish.

### Watching publishes

In the `tool.call` hook (which already sees every tool of the session), on a call to the **Artifact** tool whose action is a publish (no `action`, or `action: "publish"`) and that succeeded:

1. Read the HTML file at `file_path` and look for the `lighthouse-source` tag. None: stop.
2. Take the page URL from the tool result (a `https://claude.ai/…artifact/…` link).
3. Find the Markdown the page was built from: for a repo document, its path in the checkout of that repo the session works in (its worktree, else the main checkout; if both have it, the worktree); for a document outside a repo, the path itself. Compute its **content hash**.
4. **Copy the HTML file** into `~/.lighthouse/pages/`, under `<owner>/<repo>/<path>.html` for a repo document and `local/<path under ~>.html` for the others (`.md` replaced), overwriting the previous copy.
5. Record, for the document's identity: page URL, publish time, content hash at publish, the session id. Stored in `~/.lighthouse/` like the rest of the state, shared between sessions.

Publishes made outside Claude Code, or in a session without Lighthouse, are not seen; the next publish in a session with Lighthouse catches up.

### Linking documents to a branch

A document is shown on a branch (or its PR) when any of these holds:

- **Touched by the branch**: the branch adds or modifies it, compared with its base (`git diff --name-only <merge-base>…<branch>`), plus uncommitted documents in the branch's worktree.
- **Same conversation, next code**: the session **wrote, edited or published** the document (Write / Edit on the Markdown, or an Artifact publish whose tag names it), and *afterwards* **wrote code in the branch's worktree** (a Write / Edit there on a file outside `specs` / `plans` folders, or a `git commit` there). Visiting a worktree (`cd`, `git -C`, reading) does not count. The link stops when the session writes or publishes **a spec it had not touched before**: from then on, the code it writes goes to that new spec (and the plans written after it). A plan written after a spec continues the same piece of work. So in a session that does spec A → branch A → merge → spec B → branch B, branch B never shows spec A and A's card never shows spec B.

  These links are recorded in `~/.lighthouse/` as they are seen (document, session, branch, time), so they survive the end of the session. This rule is what links a spec written in the main checkout before the worktree existed, and the only rule that applies to documents outside a repo; for a repo document it only links branches of the same repo.
- **Cited by a linked plan**: a plan linked to the branch by one of the two rules above contains the spec's path or file name. Covers a spec merged earlier on the base and implemented later on another branch.

On a PR card the documents come from the PR's local branch, when the pane knows it (it already links each PR to its local branch). A merged PR keeps its documents on its card until the card goes.

### State (deduced)

- **Spec**: *draft* → *approved* once a plan cites it (by path or file name; plans read in any checkout of the repo the pane reads, or, for documents outside a repo, the plans linked to the same branches) → *implemented* once every plan citing it is implemented, or, with no plan, once a linked PR that touches code is merged.
- **Plan**: *draft* → *in progress* once the branch has a commit, after the plan's last commit (or after the plan was written, for an uncommitted or outside-repo plan), that touches files outside `specs` / `plans` folders → *implemented* once a linked PR that touches code is merged.
- *Claude's call (from the builder check):* a merged PR that only touches `specs` / `plans` folders (a docs-only branch, like a spec merged before its code) never counts, so a spec is not "implemented" before any code exists; and a spec with a multi-PR plan waits for all its plans. The PRs linked to a document are recorded with the other links, so the state survives the branch's cleanup.

Plan checkboxes are **not** used: in the person's plans they are never ticked, even when implemented.

### Out of date

A document with a recorded publish is **out of date** when the hash of its Markdown (in the checkout of the branch being shown, or the file itself outside a repo) differs from the hash recorded at its last publish. Documents without a recorded publish show no signal.

*Claude's call:* the hash is of the whole file. The person's rule never writes the page link into the Markdown, so nothing changes the Markdown just because of a publish.

### In the pane

Under the PR card's progress line (or under a branch line without a PR), one line per document, specs first:

```
│ #42 feat: add rate limiting  ⎇ feat/rate (worktree)          │
│ Review ─ CI ─ Merge ─ Deploy ─ Clean up                      │
│ ▤ Spec rate-limiting · approved   [Page ↗] [Copy]            │
│ ▤ Plan rate-limiting · in progress [Page ↗ ⚠ out of date] [Copy] │
│ feat/rate-docs · ↳ on #42 · ↑2 unpushed  [Push]              │
│ ▤ Spec rate-docs · draft   [Markdown]                        │
```

- **Page ↗** opens the Artifact URL; **Copy** opens the local copy; **Markdown** opens the document's file (the branch's checkout, or the file itself outside a repo). All three open with the system's `open`, like the other links of the mod.
- The "out of date" mark sits on the Page button, in yellow.
- The words follow the `language` option (`en` / `fr`), through `i18n.ts`, like the rest of the pane.

### Files it writes

Two additions to the README's table: `pages/` (the local copies, one per document) and the document records (links to sessions, publishes, hashes) in the existing state folder or a `docs/` folder next to it. Deleting `~/.lighthouse/` loses the copies; the README says so.

## Constraints

- The repo's rules (`CLAUDE.md`): one responsibility per file, in a folder named after what it does (likely `hooks/docs/`); every use of `$` stays in `hooks/register.ts`; atoms declared in `register.ts` with their shapes in `types/index.d.ts`; tests under `tests/` mirroring `hooks/`; `claude plugin test .` and `claude plugin validate .` pass; no real repo or person names in code or tests.
- A failure of this feature must never block a tool call (the existing `.catch` on `tool.call` stays).
- Reads happen at the pane's existing local cadence (10 s) or less often; no extra GitHub calls (everything here is local git and files).
- `README.md` and `README.fr.md` are updated together.

## Outside this repo (for the person, not the builder)

The tag only appears if Claude adds it. The person's rule for publishing specs and plans (WorkingLab `CLAUDE.md`, `artifact-style` skill) gains one line: "the published HTML of a spec or plan carries `<meta name="lighthouse-source" content="owner/repo:path">` (or `content="~/path"` for a document outside a repo)".

## Left to the builder

- The exact shape of the stored records and how they are split into files.
- How the Artifact tool's result is parsed for the URL (check the real result shape in a test session first).
- When a session writes code in several worktrees after the same document, the document goes to each of them.
- Whether supporting files of a multi-file page are copied too. *Claude's call:* the main HTML only; mark it as a known shortcut.
- How many document lines a branch shows before folding the rest.
