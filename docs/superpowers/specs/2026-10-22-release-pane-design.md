# Release pane: batch merged PRs into one release, on demand

Date: 2026-10-22. Repos: `hn6pot/lighthouse` (most of the work) and `hn6pot/hermeneia` (two small guards in `pnpm release`).

## Why

Today a `manual` rule runs its command after **every** merged PR. For Hermeneia that command is `pnpm install-app`, a full release: checks, build, signature, install into `/Applications`, tag. Development goes fast and PRs are often merged a few seconds apart, so:

- two PRs merged 5 s apart made two full releases of the same commit (`v0.2.35` and `v0.2.36` both on `83ae373`);
- the person often wants to merge several PRs, then ship them together, and cannot;
- a Claude session that ran `pnpm install-app` itself after a merge collided with lighthouse's run.

The person wants to decide when a release goes out, seeing what is waiting.

## Goals

- A repo can opt into **release mode** in `~/.lighthouse/config.json`. Other repos keep their current deploy rules, unchanged.
- In release mode, a merge triggers nothing. Merged PRs pile up as **waiting for release**.
- A separate **Releases pane**, opened by `/release`, shows each release-mode repo: its current version, the waiting PRs split into **Fix** and **Features**, a **Release** button labelled with the version that will come out, and the **history** of past releases.
- The release runs only when the person presses the button. Never on its own, whatever the count.
- When a release ends, a **notification** says whether it worked.
- Version numbering: a release containing at least one feature bumps the minor (`0.2.40 → 0.3.0`). A release with fixes (or other changes) only bumps the patch (`0.2.40 → 0.2.41`).
- Nothing in this flow needs a commit: the version comes from tags, and the history is read from git.

## Non-goals

- No automatic release on a threshold, a timer or a schedule.
- No GitHub Release, no `CHANGELOG` file, no release notes written anywhere but the pane's history.
- No change to how non-release repos deploy (`workflow`, `delay`, `immediate`, `manual`).
- No major bumps decided by lighthouse (a breaking `!` is not read). `pnpm release --major` stays available by hand.

## Anti-goals (a failure even if it works)

- Two releases of the same commit, or two releases running at once.
- A release that starts without the person pressing the button.
- A Release button that shows one version while the release then makes another.
- The main Lighthouse pane getting busier: it only gains a counter.

## Decided with the person

- **Layout C**: a pane of its own, next to Lighthouse, opened by `/release`. The main pane only shows "N à sortir" in its summary line.
- The pane **shows the list with a Release button**; the person presses it.
- **Fix and Features are separate lists.** Fixes wait too: they do not go out on their own.
- The "log" of a release = the **history in the pane plus a small notification**. Nothing that needs a commit.
- Bump: features → minor, fixes only → patch.

## Design

### Config

A new rule kind, `release`:

```json
"hn6pot/hermeneia": { "kind": "release", "path": "~/WorkingLab/personal/hermeneia", "command": "pnpm install-app" }
```

- `path` is the repo's main checkout, where the release runs and where git is read. It is needed because the pane lists release repos from any session, not only from the sessions that touch the repo. `~` expands to the home folder.
- `command` runs there through `/bin/zsh -lc`, as `manual` commands do today.
- `config.ts` validates it like the other kinds: a malformed entry is dropped and the others are kept.
- `docs/config.example.json`, `README.md` and `README.fr.md` document it.

### After a merge (main pane)

- For a release-mode repo, a merged PR does not deploy. For the PR flow it counts as deployed at once, as `immediate` does, so the **worktree and branch are cleaned right after the merge**: a release groups several PRs and must not hold their cleanup.
- While its card is still shown (before the cleanup), it reads "En attente de release" / "Waiting for release" instead of the deploy step.
- The summary line gains "N à sortir" / "N to release" when release-mode repos have waiting PRs. *Builder's call:* whether pressing it opens the Releases pane, if the pane API allows a clickable summary.

### What "waiting" means

Waiting PRs are read from git, never stored:

- `git -C <path> fetch` (at most as often as the main pane fetches the base), then the first-parent log of `origin/<base>` since the highest `vX.Y.Z` tag.
- Each commit's PR title is its subject (squash merge, `feat(desktop): … (#59)`). For a GitHub merge commit (`Merge pull request #N from …`), it is the first line of its body.
- Classification by the Conventional Commit type of that title: `fix` → **Fix**; `feat` → **Features**; anything else (`refactor`, `chore`, `docs`, `test`, …, or no type) → **Others**, folded by default. *Decided by Claude:* Others are shown so nothing waiting is hidden, but folded because they rarely matter.
- No tag yet: everything on the base is waiting, and the next version is Hermeneia's `FIRST_VERSION` rule (`0.1.0`). Lighthouse only previews it.

### The next version

- Lighthouse computes the preview: highest `vX.Y.Z` tag, minor +1 (patch reset to 0) if at least one waiting commit is `feat`, else patch +1.
- **The repo decides for real** (see the Hermeneia section): `pnpm release` applies the same rule by itself. So `pnpm install-app` run by hand, or by a Claude session, gives the same number as the button.
- The rule is "Conventional Commits since the last tag". Lighthouse's copy and Hermeneia's copy must agree. Each has tests with the same cases.

### The Releases pane

A second pane of the mod, `requestId: 'release'` (a string literal, like `'lighthouse'`), opened by the `/release` command. It is not opened on its own. One block per release-mode repo:

```
╭─ Releases ───────────────────────────────────── ↻ ─╮
│ hermeneia · v0.2.40 · dernière sortie il y a 2 h   │
│                                                    │
│ Fix (1)                                            │
│   #56 la fin d'un appel se voit 2 s après…         │
│ Features (3)                                       │
│   #54 couper la dictée depuis Réglages             │
│   #58 revenir dans le même Meet reprend…           │
│   #59 le Halo s'ouvre sur l'écran actif            │
│ ▶ Autres (1)                                       │
│                                                    │
│ [Release v0.3.0]                                   │
│                                                    │
│ Historique                                         │
│   v0.2.40 · 3 PR · il y a 2 h  ✓                   │
│   v0.2.39 · 1 PR · hier        ✓                   │
╰────────────────────────────────────────────────────╯
```

- Each PR line shows `#N` and its title without the type prefix. Opening it on GitHub is a nice-to-have, left to the builder.
- **Release button** states:
  - enabled, "Release vX.Y.Z", when something is waiting and no release is running;
  - disabled when nothing is waiting ("Rien à sortir" / "Nothing to release");
  - "Release vX.Y.Z en cours… (3 min)" while one runs, from any session;
  - after a failure, the block shows the failure reason and the log path, and the button is enabled again.
  - *Decided by Claude:* a single press starts it (no double press like Merge). The press is deliberate, the pane is separate, and the repo refuses a duplicate anyway.
- **History**: the last 10 `vX.Y.Z` tags, newest first. Each shows its number of PRs (commits between it and the previous tag), its age (tag date), and ✓. Expanding one lists its PRs, with the same Fix/Features/Others split. *Decided by Claude:* 10, folded beyond that; everything is computed from tags, nothing is saved.
- The pane is redrawn at the main tick. It reads the git of release repos every tick, like the main pane reads its repos, and right after a release ends.
- Refresh (↻) works as in the main pane.

### Running a release

On a press:

1. **Fresh look first.** *Decided by Claude:* fetch the base and recompute the waiting list and the next version. If the version changed since what the button showed (a `feat` merged in between), launch nothing and redraw: the person sees the new version and presses again. A small window remains, between this check and the repo's own pull. The notification always names the version actually tagged.
2. **Same guards as `deployManual`:** the checkout is on its base branch, has no uncommitted change, and `git pull --ff-only` passes. Otherwise there is no release, and the block shows why.
3. **The release outlives the session.** *Decided by Claude:* a release replaces `/Applications/Hermeneia.app`. If it were killed halfway because the session that launched it closed, the installed app could be left broken. So the command runs **detached** (`nohup /bin/zsh -lc '<command>; echo $? > <status file>'`, or an equivalent), with output to the log file. The mod does not wait on a stream.
   - Run record, in `~/.lighthouse/releases/<owner>__<repo>.json`: pid, start time, the tag that was highest at launch, the log path, the expected version. After the run, an exit-code file sits next to it.
   - **"Running"** = the record exists, has no exit code yet, and its pid is alive (`kill -0`). This file is the cross-session lock: a press while one is running does nothing, and the button already shows "en cours". *Decided by Claude:* this is a separate lock, not `sessions/lock.ts`. That lock takes over after 15 min whatever the holder, and a release can last longer. Manual deploys keep their current lock, unchanged.
   - A pid that is gone without an exit code means the run died: shown as a failure ("la release s'est arrêtée sans finir"), with the log.
4. **Verdict, read by any session's tick** once the exit code is there. It compares the highest tag now with the one at launch:
   - new tag, code 0 → **success**: notify "Hermeneia v0.3.0 installée" / "Hermeneia v0.3.0 installed";
   - new tag, code ≠ 0 → **installed with a warning**: the version is out (and in the history), but a step after it failed (for Hermeneia, `pnpm transcription:check`). Notify "Hermeneia v0.3.0 installée, mais la vérification d'après a échoué" plus the last non-empty output line;
   - no new tag → **failed**: notify "Release Hermeneia échouée" plus the last non-empty output line. The block shows the log path, and the button is enabled again.
   - The notification goes through `ui/notify.ts`'s `notifyOnce`, keyed by the run's start time, so a single session sends it even when several are open. The record stays until the next press, so the pane can show the last outcome.

PRs merged while a release runs are not in it if the pull came before their merge: they stay waiting for the next one, which the history makes obvious.

A Claude session that runs the release command itself is not blocked. Hermeneia's own lock refuses a second concurrent release, and its tag guard refuses a duplicate.

### Texts

New texts in `i18n.ts`, in English and French, following the existing `t.*` structure: pane title "Releases", the section names, the button states, the card chip "Waiting for release", the summary counter, the notifications, the refusal reasons.

### Model and types

- `Rule` gains `{ kind: 'release'; path: string; command: string }`.
- A new shape for the pane (for example `ReleaseRepo`: slug, name, path, current tag, waiting entries by kind, next version, running state, last failure, history). It goes in `hooks/model.ts` and its copy in `types/index.d.ts` under the `lighthouse` key, as the atoms require.
- New atoms (the release data, the pane's expanded state) are declared in `register.ts`, the file that reads and writes them.

### Files (one responsibility each)

- `hooks/release/` (new folder): reading waiting commits and history from git; classifying a title; computing the next version; launching a detached release (guards, run record); reading a run's state and verdict.
- `Host` gains what a detached launch and a pid check need, built in `register.ts` like the rest (no `$` elsewhere).
- `hooks/ui/release-pane.tsx`: drawing the pane. Shared line helpers go in `hooks/ui/lines.ts` only if they really are shared.
- `hooks/config.ts`, `hooks/deploy/rules.ts`, `hooks/loop.ts`, `hooks/register.ts`, `hooks/i18n.ts`, `hooks/model.ts`, `types/index.d.ts`: wiring.
- Tests under `tests/release/` and `tests/ui/`, mirroring `hooks/`. `claude plugin test .` and `claude plugin validate .` pass.

## Hermeneia (`hn6pot/hermeneia`)

Two guards in `scripts/release/`, with tests under `tests/`:

1. **Nothing new, no release.** If the base's HEAD is already the commit of the highest `vX.Y.Z` tag, `pnpm release` refuses before building: "Rien de nouveau depuis v0.2.40". It is a new refusal in `refusals.ts`, so it is listed with the others. This alone prevents another `v0.2.35`/`v0.2.36`.
2. **Bump from commits.** With no `--minor`/`--major`, the bump is read from the commit subjects since the highest tag: at least one `feat` → minor, else patch. `--minor` and `--major` still override. It goes in `version.ts`, next to `nextVersion`, as a pure function of the subjects. `repo-state.ts` (or a sibling) reads the subjects.

`pnpm install-app` needs no change: it calls `pnpm release` without options, which now picks the bump itself.

`CLAUDE.md` (in French, as that repo's docs are): the release line says the bump follows the commits, and that a release is started from lighthouse's Releases pane, not after each merge. Commit descriptions in French, per that repo's rules.

## The person's local config (after both PRs are merged)

`~/.lighthouse/config.json`: replace the `hn6pot/hermeneia` `manual` rule with the `release` rule above. It is a local file, not part of either PR. Claude does it once the person says so.

## Left to the builder

- How the pane API handles a second pane and a clickable summary. Fall back to the plainest working option, and say which one was used.
- The exact layout of the history's expanded lines, and the truncation of long titles (reuse `shorten`).
- How often the release repos' git is fetched, within the main pane's existing fetch interval.
