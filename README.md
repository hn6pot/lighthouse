# lighthouse

*[Version française](README.fr.md)*

A Claude Code mod that adds a **Lighthouse** pane on the side of your session. It shows the git repos the session touches, your open PRs and local branches, and what is left to do on each of them. After a merge it follows the deploy, then cleans up the worktree and the branch.

> **Early access.** Claude Code mods (plugins with a hooks module) are an early-access API. It may change, and this mod may break when it does.

```
╭─ Lighthouse ────────────────────────────────────────── ↻ ─╮
│ 2 PRs · 1 to deploy · 1 to push                           │
│ ╭─ This session ────────────────────────────────────────╮ │
│ │ ▼ api                                    v1.4.0 +12   │ │
│ │   #42 feat: add rate limiting  ⎇ feat/rate (worktree) │ │
│ │   Review ─ CI ─ Merge ─ Deploy ─ Clean up             │ │
│ │   Review approved · CI ✓ · opened 3 d ago · +120 −30  │ │
│ │   [Open on GitHub] [Merge]                            │ │
│ │   feat/rate-docs · ↳ on #42 · ↑2 unpushed  [Push]     │ │
│ │   #39 fix: login · Merged into main · Deploying ⟳     │ │
│ │   [Tidy up]                                           │ │
│ ╰───────────────────────────────────────────────────────╯ │
│ ▶ Another session · “Fix the pipeline” ↗                  │
╰───────────────────────────────────────────────────────────╯
```

## What it does

The pane opens as soon as the session touches a git repo; `/lighthouse` reopens it. A summary line sits on top ("2 PRs · 1 to deploy · 1 to push"), with a small "↻" button to refresh at once. Below it, one rounded frame per session (this one first), and inside it one foldable line per repo, colored by its worst state. A repo unfolds onto:

- **its last release**, when the base branch has a tag ("v1.4.0 +12": 12 commits since).
- **your open PRs.** Each has a progress line (Review ─ CI ─ Merge ─ Deploy ─ Clean up), its age and size (in yellow after 7 days without activity) and the local branch it is linked to, even under another name. A card shows the title, link, review, CI (failing checks named), draft, conflicts, behind the base and unpushed commits. Its buttons depend on its state: "Open on GitHub", "Merge" (two presses, only when nothing blocks), "Push", and "Fix the CI", "Address comments" and "Update the branch", which go to a background agent.
- **branches stacked on a PR** (they contain its head), shown under that PR with "↳ on #N". "Open a PR" then targets that PR's branch as its base.
- **branches without a PR**: never pushed, ahead of their remote, or pushed without a PR. They get "Push" and "Open a PR" (background agent).
- **merged PRs**: "Merged into main", then where the deploy and the cleanup stand. Once a PR is cleaned up, a check fills up, stays 4 seconds, and the card goes.
- **a "Tidy up" button** on each repo of this session (see below).
- **what Claude is doing** (⟳): on the card a git or gh command targets, "Claude is working here" on the repo during its turn, and a background agent's task until it ends.

PRs and branches are grouped by session first: **this session**, **another session** (under its Desktop title, with a "↗" that opens it), and **no known session**. The session is found from the worktree each PR or branch lives in. Then they are grouped by repo.

### PRs to review

A last frame, **To review**, lists the open PRs where your review is requested, in any repo (not only the session's): their title, repo, author and last activity. They come from `gh search prs --review-requested=@me`, on your active gh account and on each account of `ghConfigDirs`, at most every 2 minutes through the shared cache (at once with "↻").

With the [intent](https://github.com/hn6pot/intent) mod enabled, each of them, and each of your own PRs, gets a **Review with intent** button: it runs `/intent <PR link>`, which opens intent's review page on that PR (the why behind each change). A mod cannot import another one, so the slash command is the only link between the two; without intent, the button is not shown.

### Specs and plans

Each PR card and each branch line lists its **specs and plans**: Markdown files under a folder named `specs` or `plans` (`docs/specs/x.md`, `docs/superpowers/plans/y.md`), in the repo or outside any repo (`~/claude-outputs/acme/docs/specs/z.md`). Folded by default to one short line, the spec's page and a toggle; unfolded, one line per document, specs first:

```
Spec ↗  ▼ Docs (2)
▤ Spec rate-limiting · approved   Page ↗
▤ Plan rate-limiting · in progress   Page ↗  ⚠ out of date
```

- **Which ones.** The documents the branch adds or modifies (against its base, plus uncommitted ones in its worktree); the ones written or published in the session that then wrote code in the branch's worktree, until that session starts a new spec; and the specs those plans cite, by path or file name.
- **Where they stand**, deduced, never written in the document. A spec is a *draft*, *approved* once a plan cites it, *implemented* once every plan citing it is (or, with no plan, once a PR touching code is merged). A plan is a *draft*, *in progress* once code follows it on the branch, *implemented* once its PR is merged. A merged PR that only touches `specs` or `plans` folders counts for nothing.
- **Page ↗** opens the document's claude.ai page. Lighthouse knows it when Claude publishes, with the Artifact tool, an HTML page whose `<head>` names its Markdown:

  ```html
  <meta name="lighthouse-source" content="acme/api:docs/specs/2026-10-29-rate-limiting-design.md">
  ```

  `owner/repo:path` for a document in a repo, `~/path` for one outside any repo. Lighthouse never adds the tag: ask for it in your own publishing rules. A page without it is not linked.
- **⚠ out of date**: the Markdown changed since its page was last published.
- One button per line: **Page ↗**, else **Copy** (the local copy of the page), else **Markdown** (the file itself). Lighthouse keeps a copy of each page's latest publish in `~/.lighthouse/pages/`, in case the page is lost.

### Releases

A repo with a `release` rule (see Configuration) does not deploy after each merge. Its merged PRs wait, and its worktree and branch are cleaned at once. The summary line counts them ("4 to release"). The **Releases** pane opens on its own, once, in a session that works in a release repo with something to ship (never again once you close it; **`/release`** reopens it, from any session). One frame per release repo:

- its current version and how long ago it came out;
- what waits since that version, from the base's commits: **Fix** (`fix:` titles), **Features** (`feat:`), and the rest under **Others**, folded;
- a **Release vX.Y.Z** button. The version is a minor bump if a feature waits, and a patch bump otherwise; nothing waiting, no button. Nothing is released until you press it;
- the **history**: the last 10 version tags, each with the PRs it brought.

On a press, the mod fetches again. If the version changed in the meantime (a feature was merged), it launches nothing and shows the new one. Then the same guards as a manual deploy: the main folder is on its base, clean, and `git pull --ff-only` passes. The command then runs **detached** from the session, so closing the session does not stop it. Every session sees it "running", and one notification tells how it ended: installed, installed but a later step failed (the new tag is there, the command's exit code is not 0), or failed (no new tag).

The band above the prompt only shows what waits for you in this session: a deploy doubt (with a notification and a "Deploy" button), a failed deploy (notification, "Deploy" and "Forget"), and a cleanup doubt ("Clean up", no notification).

A branch name, or a title waiting in the Releases pane, that the pane cuts to its width unfolds whole, dimmed, just below while the pointer is on it.

The local git state is refreshed every 10 seconds. GitHub is read at most every 30 seconds per repo (2 minutes for the PRs to review), through a cache shared by all sessions, and at once after any git or gh command or a button press.

## Install

From GitHub:

```
/plugin marketplace add hn6pot/lighthouse
/plugin install lighthouse@lighthouse
```

From a local clone:

```bash
git clone https://github.com/hn6pot/lighthouse.git
claude plugin marketplace add ./lighthouse
claude plugin install lighthouse@lighthouse
```

Then run `/reload-plugins` in any session that is already open.

### Requirements

- `git`, and the GitHub CLI `gh`, logged in (`gh auth login`) with access to your repos.
- Built and used on macOS. Manual deploys run through `/bin/zsh -lc`. "Tidy up" and the "↗" session links open `claude://` links with `open`, so they need the Claude Desktop app. Notifications fall back on `osascript` when Claude Code has no surface to show them.

## Configuration

Everything works without a config file. To set deploy rules or gh accounts, create `~/.lighthouse/config.json`. A full example is in [`docs/config.example.json`](docs/config.example.json):

```json
{
  "rules": {
    "acme/api": { "kind": "workflow", "workflow": "Deploy Production" },
    "acme/worker": { "kind": "delay", "seconds": 120 },
    "acme/website": { "kind": "immediate" },
    "acme/infra": {
      "kind": "manual",
      "commands": [
        { "only_under": "services/*/", "single": true, "command": "make deploy SERVICE={1}" },
        { "only_under": "laptop/", "command": "make install" }
      ]
    },
    "acme/charts": {
      "kind": "manual",
      "always_doubt": { "en": "production: pick the Helm target by hand", "fr": "production : choisir la cible Helm à la main" }
    }
  },
  "ghConfigDirs": {
    "acme": "~/.config/gh-acme"
  }
}
```

The file is read when the first refresh runs, then again at most once a minute, so changes apply without a reload. If the file is missing, unreadable or not valid JSON, there are no rules and no extra gh accounts. A malformed entry is left out and the others are kept.

### `rules`: how each repo deploys

The key is the repo as `owner/repo`, as its `origin` remote says. The `kind` field picks one of these rule types:

| `kind` | What happens after a merge |
| --- | --- |
| `workflow` | Follows the GitHub Actions runs of the merge commit. `workflow` names the run to follow, as `gh run list` shows it (not the file name). Without a name, any run whose name contains "deploy" or "merge" counts. |
| `delay` | The PR counts as deployed `seconds` after the merge. |
| `immediate` | The PR counts as deployed at once. |
| `manual` | A command to run on your machine, picked from the files the PR touched (see below). |
| `release` | Nothing at once: the PR waits for a release you start from `/release` (see [Releases](#releases)). `path` is the repo's main folder (`~` allowed), and `command` runs there, through `/bin/zsh -lc`, when you press Release. |

A `manual` rule lists `commands`, tried in order. The first one that matches wins:

- `{ "always": true, "command": "…" }` always matches.
- `{ "only_under": "laptop/", "command": "…" }` matches when every file of the PR is under `laptop/`.
- `{ "only_under": "services/*/", "single": true, "command": "make deploy SERVICE={1}" }`: the `*` captures one folder name, and `{1}` puts it into the command. With `single`, all the files must fall under the same folder. Only plain names (letters, digits, `.`, `_`, `-`) are captured, so a path can never inject into the command.

If no command matches, the PR goes into doubt and the band asks you. `always_doubt` always puts the PR into doubt, with this reason. It is a string, or `{ "en": "…", "fr": "…" }` to follow the language option.

**A repo without a rule** is read from its own files, and the merged PR's card shows what was understood:

- If a GitHub workflow starts on push, the mod follows it.
- Otherwise, if there is a `make deploy` or `make install` target, or an npm `deploy` or `install-app` script, the PR goes into doubt and the "Deploy" button proposes that command. The mod found it by guessing, so it never runs it on its own.
- If neither is found, it is a local project with nothing to deploy, and the cleanup follows at once.

### `ghConfigDirs`: one gh account per owner

By default `gh` runs with your active account. If some repos need another account, map their owner to that account's gh config folder. Every `gh` call for those repos then runs with `GH_CONFIG_DIR` set to it, and your active account is left alone. The agents launched from the pane (fix the CI, address the comments, update the branch, open the PR, tidy up) are told to run their `gh` commands the same way. `~` stands for your home folder. To create such a folder: `GH_CONFIG_DIR=~/.config/gh-acme gh auth login`.

### Language

Everything the mod shows or sends to Claude is in English by default, or in French: the pane, the band, buttons, notifications, toasts, and the requests to Claude and to background agents. Set the `language` option (`en` or `fr`) in the `/config` menu (the `lighthouse` row), or in your settings:

```json
{ "pluginConfigs": { "lighthouse@lighthouse": { "options": { "language": "fr" } } } }
```

For a plugin loaded with `--plugin-dir`, the key is `lighthouse@inline`. Changing the option reloads the module.

## What it does on its own, and what it asks you

- **Without an interface** (`claude -p`), the mod does nothing.
- **Deploy.** The mod only launches a command by itself when a `manual` rule matches the merged files. Even then, the repo's main folder must be on the base branch and clean: it runs `git pull --ff-only`, then the command. Otherwise you get a notification and a "Deploy" button, which asks Claude to do it. `delay` and `workflow` launch nothing: the mod waits for the delay or the GitHub run. A launched deploy is never relaunched automatically. If the session that launched it goes away before the end (module reloaded, session closed), the PR goes into doubt.
- **A deploy you run in the session.** Claude may run a deploy command itself in a repo with a merged PR: `make deploy`, `make …-push`, `helm upgrade`, `kubectl apply`, `gh workflow run`, `terraform apply`, `npm run deploy`, `./…deploy….sh`, or the command the mod proposed. That PR is then marked as handled by this session for 30 minutes. There is no "Deploy" button and no doubt notification, and its card says it is deploying here (or in another session). If the command succeeds, the PR is deployed and the cleanup follows. A dispatched workflow is followed on GitHub instead.
- **Cleanup.** The mod runs `git worktree remove` then `git branch -D`, only when all of these hold:
  - the PR is merged;
  - the worktree and the branch hold nothing GitHub never had: they are at the PR's head, behind it (sub-PRs merged into the branch there), or on a tip that was pushed before the branch was rebased there;
  - there is no uncommitted change;
  - no other session works there.

  Otherwise the band shows a "Clean up" button, without a notification. The checks run again on their own every 5 minutes, and the cleanup follows once they pass. `-D` is deliberate, because after a squash merge git does not see the branch as merged. Then the **PR's branch on GitHub is deleted too** (`git push origin --delete`), but only while it still points at the PR's head. If GitHub refuses (a protected branch, for example), the branch stays.
- **Tidy up.** This button never deletes anything itself. It opens a new Claude Desktop session in the repo with the instruction already typed, and you choose to send it and follow it there. The instruction says to remove:
  - the worktrees and local branches whose work is done: PR merged or closed with nothing after its head, or nothing outside the base;
  - the GitHub branches of your merged or closed PRs that are still at their head.

  It also says never to touch an open PR's branch, unpushed work, uncommitted changes, another session's worktree, or the Desktop's `.claude/worktrees/`.
- **Background agents.** "Fix the CI", "Address comments", "Update the branch" and "Open a PR" hand the task to a background agent in the branch's worktree. The agent is told never to merge or deploy.
- **One actor per repo.** A `mkdir` lock in `~/.lighthouse/locks/` keeps two sessions from acting on the same repo at once. A lock goes stale after 15 minutes.

## Files it writes

Everything lives under `~/.lighthouse/`:

| Path | What |
| --- | --- |
| `config.json` | Your config (optional, written by you, never by the mod). |
| `state/` | The state of tracked PRs and the notifications already sent, one JSON file per key, shared between sessions. |
| `sessions/` | One entry per active session: its folder and worktrees. |
| `locks/` | Repo locks. |
| `logs/` | Logs of the deploys and releases the mod launched. |
| `releases/` | The last release of each release repo: what was launched (a JSON record, also the lock), its script, and its exit code once done. |
| `docs/` | What the mod knows of specs and plans: each page published (link, date, hash of its Markdown), the conversations' links to branches, the documents of each branch. |
| `pages/` | The local copy of each published page, the latest one. |

Apart from `config.json`, deleting this folder is safe, unless a deploy or a release is running. It is recreated when needed, but PRs that were already merged will no longer be tracked, and the page links and copies are lost (republishing a page brings its link back).

## Develop

```bash
claude plugin test .       # the test suite, under tests/
claude plugin validate .   # the plugin, its hooks module and the marketplace
```

To try a local copy without installing it: `claude --plugin-dir /path/to/lighthouse`. Contributor rules are in [`CLAUDE.md`](CLAUDE.md).

## License

[MIT](LICENSE)
