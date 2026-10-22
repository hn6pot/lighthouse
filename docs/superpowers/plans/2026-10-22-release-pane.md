# Release Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Release-mode repos stop releasing after each merge. Merged PRs wait in a `/release` pane (Fix / Features / Others) until the person presses Release. The release runs detached, and its outcome is notified.

**Architecture:** Two PRs. **Hermeneia** (tasks H1–H2): `pnpm release` picks its bump from the commits since the last tag and refuses when nothing is new. **lighthouse** (tasks L1–L6): a `release` rule kind. Waiting PRs and the history are read from git at each tick, never stored. A release runs as a detached `nohup` script, with a run record file that is also the cross-session lock. A second pane, `requestId: 'release'`, draws it all.

**Tech Stack:** TypeScript. lighthouse is a Claude Code mod (`claude plugin test .` / `claude plugin validate .`). Hermeneia is Node `--test` via pnpm.

**Spec:** `docs/superpowers/specs/2026-10-22-release-pane-design.md` (this branch). Executors read both.

## Global Constraints

- lighthouse: everything in English. One responsibility per file. Every `$` stays in `hooks/register.ts`. Atoms are declared in `register.ts`, their shapes copied into `types/index.d.ts` under `lighthouse`. The `requestId` is a string literal. Tests live under `tests/` mirroring `hooks/`, with fake names only (`acme/api`). Conventional Commits in English.
- lighthouse: before every commit, `claude plugin test .` and `claude plugin validate .` pass (rerun a timed-out test once before concluding).
- Hermeneia: English code. French user-facing strings and docs. Commit descriptions in French, Conventional Commits type and scope (`feat(release): …`). Tests under `tests/` mirroring `scripts/`. Follow its `CLAUDE.md` checks before committing (`pnpm lint`, `pnpm typecheck`, `pnpm test`, or what it lists).
- Bump rule (both repos, same cases): at least one commit whose Conventional type is `feat` since the highest `vX.Y.Z` tag → minor +1, patch 0. Otherwise → patch +1. No tag → `0.1.0`. A `!` is not read.
- Classification of a title: type `fix` → fix, `feat` → feat, anything else or no type → other. The type is the token before `(`, `!` or `:` at the start of the title, `^(\w+)(\([^)]*\))?!?:\s`.
- The config rule is `{ "kind": "release", "path": string, "command": string }`. `~` in `path` expands to home.
- History: the last 10 tags.
- Run files: `~/.lighthouse/releases/<owner>__<repo>.json` (record), `.code` (exit code), `.sh` (script). Logs go to `~/.lighthouse/logs/<owner>__<repo>-release-<startedAt>.log`.
- Hermeneia: work in a new worktree `.worktrees/release-bump`, branch `feat/release-bump`, from `origin/main`. The main checkout has an untracked `branding/` folder: do not touch it.

## Review Focus

1. **A merge-commit repo** (`Merge pull request #12 from acme/x` with the PR title in the body) must list "#12 <title>", not "Merge pull request…". → L2 test `parses a GitHub merge commit from its body`.
2. **A repo with no tag yet** must show everything on the base as waiting and the button "Release v0.1.0", with no crash on `git describe` failing. → L2 test `no tag: every first-parent commit waits`, L3 test `no tag gives 0.1.0`.
3. **The session that launched the release closes**: the pane in another session must still show "running", then the outcome, and notify once. → L4 tests `running while pid alive and no code`, `died when pid gone without code`, plus the manual check in L6.
4. **A press while the shown version is stale** (a `feat` merged since the last tick) launches nothing and redraws. → L5 test `refuses when the version changed since the press`.
5. **The main checkout is dirty, not on base, or pull fails**: no launch, the reason is shown in the block. → L5 tests `refuses on dirty checkout`, `refuses off base`.

---

## Hermeneia (PR 1, repo `hn6pot/hermeneia`)

### Task H1: bump from commits

**Files:**
- Modify: `scripts/release/version.ts` (add `latestVersionTag`, `bumpFromSubjects`; change `parseBump`)
- Modify: `scripts/release/repo-state.ts` (add `readSubjectsSince`)
- Modify: `scripts/release/index.ts` (use them)
- Test: `tests/scripts/release/version.test.ts`

**Interfaces:**
- Produces: `latestVersionTag(tags: readonly string[]): string | null`, the highest `vX.Y.Z` (reuse `parseTag` and `compare`). `bumpFromSubjects(subjects: readonly string[]): Bump`. `parseBump(args): Bump | null`, null when no option (it was `"patch"`). `readSubjectsSince(tag: string | null): string[]`, the first-parent subjects of `HEAD` since `tag`, or all of them when null.

- [ ] **Step 1: Write the failing tests** in `version.test.ts`:
  - `bumpFromSubjects(["fix(capture): a (#56)", "feat(desktop): b (#59)"])` → `"minor"`.
  - `bumpFromSubjects(["fix(capture): a (#56)", "chore: c"])` → `"patch"`.
  - `bumpFromSubjects([])` → `"patch"`.
  - `bumpFromSubjects(["feature: not a type"])` → `"patch"`.
  - `latestVersionTag(["v0.2.9", "v0.2.40", "nightly"])` → `"v0.2.40"`, and `latestVersionTag([])` → `null`.
  - `parseBump([])` → `null`, `parseBump(["--minor"])` → `"minor"`. Update the existing test that expected `"patch"`.
- [ ] **Step 2: Run** `pnpm test`. Expected: the new tests fail.
- [ ] **Step 3: Implement.** In `index.ts`, the bump becomes `parseBump(args) ?? bumpFromSubjects(readSubjectsSince(latestVersionTag(readVersionTags())))`. `readSubjectsSince` runs `git log --first-parent --format=%s <tag>..HEAD`, or `HEAD` when there is no tag.
- [ ] **Step 4: Run** `pnpm test`. Expected: pass. Then the repo's lint and typecheck.
- [ ] **Step 5: Commit** `feat(release): la version monte selon les commits depuis le dernier tag`.

### Task H2: nothing new, no release

**Files:**
- Modify: `scripts/release/refusals.ts` (`RepoState.newCommits`, refusal `nothing_new`)
- Modify: `scripts/release/repo-state.ts` (fill `newCommits`)
- Modify: `CLAUDE.md` (release lines)
- Test: `tests/scripts/release/refusals.test.ts`

**Interfaces:**
- Consumes: `latestVersionTag` (H1).
- Produces: `RepoState.newCommits: { readonly tag: string; readonly count: number } | null` (null = no tag). `Refusal` gains `{ kind: "nothing_new"; tag: string }`.

- [ ] **Step 1: Failing tests.**
  - `findRefusals({ ...clean, newCommits: { tag: "v0.2.40", count: 0 } })` contains `{ kind: "nothing_new", tag: "v0.2.40" }`.
  - With `count: 2` or `newCommits: null`, there is no such refusal.
  - `describeRefusal({ kind: "nothing_new", tag: "v0.2.40" })` → `"Rien de nouveau depuis v0.2.40 : pas de release."`.
  - Update the existing `RepoState` fixtures with `newCommits`.
- [ ] **Step 2: Run** `pnpm test`. Expected: fail.
- [ ] **Step 3: Implement.** Push the refusal after `diverged`. `readRepoState` counts with `git rev-list --count <tag>..HEAD`.
- [ ] **Step 4: Update `CLAUDE.md`.** The `pnpm release` line says the version follows the commits since the last tag (`feat` → minor, otherwise patch; `--minor`/`--major` force it), and that it refuses when nothing is new. Add one line: releases are started from lighthouse's Releases pane (`/release`), not after each merge. A session never runs `pnpm install-app` after a merge on its own.
- [ ] **Step 5: Run** `pnpm test`, lint, typecheck. Expected: pass.
- [ ] **Step 6: Commit** `feat(release): pas de release quand rien n'a changé depuis le dernier tag`. Push, then open the PR with `GH_CONFIG_DIR=~/.config/gh-hn6pot`, title and description in French.

---

## lighthouse (PR 2, this branch `feat/release-pane`)

### Task L1: the `release` rule

**Files:**
- Modify: `hooks/deploy/rules.ts` (`Rule` and `Plan` union, `deployPlan`)
- Modify: `hooks/model.ts` (`Plan` gains `{ kind: 'release' }`)
- Modify: `hooks/config.ts` (`isRule`)
- Modify: `hooks/loop.ts` (`deploy()` case)
- Modify: `hooks/i18n.ts` (`chip.waitingRelease`)
- Test: `tests/config.test.ts`, `tests/deploy/rules.test.ts`

**Interfaces:**
- Produces: `Rule` gains `{ kind: 'release'; path: string; command: string }`. `deployPlan(...)` returns `{ kind: 'release' }` for it. In `loop.ts`, `deploy()` returns `{ state: 'ok', note: t.chip.waitingRelease }` for that plan, so the PR goes deployed → cleaned at once and its card shows the note.

- [ ] **Step 1: Failing tests.**
  - `parseConfig` keeps `{"rules":{"acme/app":{"kind":"release","path":"~/acme/app","command":"make release"}}}` as given.
  - It drops the entry when `path` or `command` is missing or not a string.
  - `deployPlan(rules, 'acme/app', [], t)` → `{ kind: 'release' }`.
- [ ] **Step 2: Run** `claude plugin test .`. Expected: fail.
- [ ] **Step 3: Implement.**
  - The `chip.waitingRelease` texts are `'En attente de release'` and `'Waiting for release'`.
  - `path` stays raw in the config. `~` is expanded where it is used (L2's `releasePath(rule, home)`).
- [ ] **Step 4: Run** test + validate. Expected: pass.
- [ ] **Step 5: Commit** `feat(deploy): a release rule kind that waits instead of deploying`.

### Task L2: waiting PRs and history from git

**Files:**
- Create: `hooks/release/commits.ts` (parse and classify)
- Create: `hooks/release/read.ts` (git reads)
- Modify: `hooks/model.ts` (`ReleaseEntry`, `ReleaseTag`)
- Test: `tests/release/commits.test.ts`, `tests/release/read.test.ts`

**Interfaces:**
- Produces:
  - `type ReleaseKind = 'fix' | 'feat' | 'other'`
  - `type ReleaseEntry = { sha: string; number: number | null; title: string; kind: ReleaseKind }`. `title` has the `type(scope): ` prefix and the ` (#N)` suffix stripped.
  - `type ReleaseTag = { tag: string; date: number; entries: ReleaseEntry[] }`
  - `parseLog(text: string): ReleaseEntry[]`: input from `git log --first-parent --format=%H%x1f%s%x1f%b%x1e`.
  - `classify(title: string): ReleaseKind`
  - `releasePath(rule: { path: string }, home: string): string`
  - `latestTag(host, path, base): Promise<string | null>`: the highest `vX.Y.Z` merged into `origin/<base>`, by version and not by date (`git tag --merged origin/<base> --list 'v*'`, then sort).
  - `waiting(host, path, base, tag: string | null): Promise<ReleaseEntry[]>`
  - `history(host, path, base, limit = 10): Promise<ReleaseTag[]>`: newest first, each tag's entries from the previous tag to it, and its date from `git log -1 --format=%ct <tag>` × 1000.

- [ ] **Step 1: Failing tests** (`commits.test.ts`):
  - `parses a squash commit`: subject `feat(desktop): le Halo s'ouvre (#59)` → `{ number: 59, title: "le Halo s'ouvre", kind: 'feat' }`.
  - `parses a GitHub merge commit from its body`: subject `Merge pull request #12 from acme/fix-x`, body `fix(api): handle empty list\n\nmore` → `{ number: 12, title: 'handle empty list', kind: 'fix' }`.
  - `a commit without PR`: subject `chore: bump deps` → `{ number: null, title: 'bump deps', kind: 'other' }`.
  - `classify`: `'fix!: x'` → `'fix'`, `'Feat: x'` → `'other'` (case-sensitive, as Conventional Commits), `'refactor(ui): x'` → `'other'`.
- [ ] **Step 2: Failing tests** (`read.test.ts`, with `fakeHost`):
  - `waits since the latest tag`: when the tags are `v0.2.9` and `v0.2.40`, `waiting` asks `git log … v0.2.40..origin/main`.
  - `no tag: every first-parent commit waits`: `latestTag` → `null`, and `waiting(…, null)` asks `origin/main` with no range.
  - `history pairs each tag with the previous one`: with three tags, it yields two ranges plus the first tag from the root, newest first, cut at `limit`.
- [ ] **Step 3: Run** `claude plugin test .`. Expected: fail.
- [ ] **Step 4: Implement** both files. The git calls go through `host.run(['git', '-C', path, …])`, like `repos/git.ts`.
- [ ] **Step 5: Run** test + validate. Expected: pass.
- [ ] **Step 6: Commit** `feat(release): read waiting PRs and release history from git`.

### Task L3: next version

**Files:**
- Create: `hooks/release/version.ts`
- Test: `tests/release/version.test.ts`

**Interfaces:**
- Produces: `nextVersion(tag: string | null, entries: readonly ReleaseEntry[]): string`. It returns `vX.Y.Z`, with the `v`.

- [ ] **Step 1: Failing tests**, the same cases as Hermeneia H1:
  - `v0.2.40` + `[fix, feat]` → `v0.3.0`;
  - `v0.2.40` + `[fix, other]` → `v0.2.41`;
  - `v0.2.40` + `[]` → `v0.2.41` (the button is disabled anyway);
  - `no tag gives 0.1.0`: `null` + anything → `v0.1.0`.
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `feat(release): compute the next version like the repo does`.

### Task L4: run record and verdict

**Files:**
- Create: `hooks/release/run.ts`
- Modify: `hooks/model.ts` (`ReleaseRun`, `ReleaseOutcome`)
- Test: `tests/release/run.test.ts`

**Interfaces:**
- Produces:
  - `type ReleaseRecord = { pid: number; startedAt: number; tagAtLaunch: string | null; expected: string; log: string }`. This is the JSON in `~/.lighthouse/releases/<owner>__<repo>.json`.
  - `type ReleaseRun = { kind: 'idle' } | { kind: 'running'; startedAt: number; expected: string } | { kind: 'done'; startedAt: number; outcome: 'ok' | 'warning' | 'failed' | 'died'; version: string | null; lastLine: string; log: string }`
  - `runFiles(home: string, slug: string): { record: string; code: string; script: string }`
  - `readRun(host, slug: string, currentTag: string | null): Promise<ReleaseRun>`
  - `startScript(path: string, command: string, log: string, codeFile: string): string`: the script text. It `cd`s, runs `/bin/zsh -lc <command>` with output to `log`, then writes `$?` to `codeFile`. Each value is single-quoted, with `'` escaped as `'\''`.

- [ ] **Step 1: Failing tests.**
  - `idle without a record`.
  - `running while pid alive and no code`: the record exists, `kill -0 <pid>` exits 0, no code file → `running`.
  - `died when pid gone without code`: `kill -0` exits 1, no code file → `done` / `died`.
  - `ok when a new tag and code 0`: `tagAtLaunch: 'v0.2.40'`, `currentTag: 'v0.3.0'`, code `0` → `ok`, `version: 'v0.3.0'`.
  - `warning when a new tag and code ≠ 0`: code `1` and a new tag → `warning`, and `lastLine` is the last non-empty line of the log.
  - `failed when no new tag`: code `0` with `currentTag` equal to `tagAtLaunch` → `failed`.
  - `startScript quotes a path with a quote`: `/tmp/a'b` gives `'/tmp/a'\''b'`.
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement.** The pid check is `host.run(['kill', '-0', String(pid)])`. Files are read with `host.read`.
- [ ] **Step 4: Run.** Expected: pass.
- [ ] **Step 5: Commit** `feat(release): read a detached release's state and verdict`.

### Task L5: launching a release, and the per-tick collect

**Files:**
- Create: `hooks/release/launch.ts`
- Create: `hooks/release/collect.ts`
- Modify: `hooks/model.ts` (`ReleaseRepo`)
- Modify: `hooks/loop.ts` (call `collectReleases` in `tick`, hand the result to `publish`)
- Modify: `hooks/i18n.ts` (`release.*` texts, `notification.release*`)
- Test: `tests/release/launch.test.ts`, `tests/release/collect.test.ts`

**Interfaces:**
- Consumes: L2 `latestTag`, `waiting`, `history`, `releasePath`. L3 `nextVersion`. L4 `readRun`, `runFiles`, `startScript`. `treeState` from `repos/git.ts` for the guards. `refresh` for the fetch, like `inspectRepo`.
- Produces:
  - `type ReleaseRepo = { slug: string; name: string; path: string; base: string; tag: string | null; waiting: ReleaseEntry[]; next: string; history: ReleaseTag[]; run: ReleaseRun; refusal?: string }`
  - `collectReleases(host, ctx: Context, notify: (key: string, text: string) => Promise<void>): Promise<ReleaseRepo[]>`. One entry per `release` rule in `ctx.config.rules`. It fetches at most every `FETCH_MS` per path, with `ctx.lastFetch` keyed by path. When `run.kind === 'done'`, it notifies with the key `release:<slug>:<startedAt>`.
  - `launchRelease(host, ctx: Context, slug: string, shown: string): Promise<{ ok: true; version: string } | { ok: false; reason: string }>`.
  - `Actions.publish` gains a fourth argument `releases: ReleaseRepo[]`. Update `register.ts` and the `tick` tests that call it.
- `launchRelease` order:
  1. Already `running` → `{ ok: false, reason: t.release.alreadyRunning }`.
  2. Fetch, then recompute `nextVersion`. If it differs from `shown` → `{ ok: false, reason: t.release.versionChanged(next) }`.
  3. Guards: on base, no uncommitted change, `git pull --ff-only` passes. The reasons reuse `t.reason.mainOnOtherBranch`, `mainDirty` and `pullFailed`.
  4. Write the script, then launch it detached: `host.run(['/bin/zsh', '-c', 'nohup /bin/zsh "$0" </dev/null >/dev/null 2>&1 & echo $!', script])`. The pid is the stdout.
  5. Write the record, delete an old `.code`, return `{ ok: true, version: next }`.
- Texts (fr / en):
  - `release.alreadyRunning`: `'Une release tourne déjà'` / `'A release is already running'`;
  - `release.versionChanged(v)`: `` `La version a changé : ${v}. Rappuie pour la sortir.` `` / `` `The version changed: ${v}. Press again to ship it.` ``;
  - `notification.releaseOk(name, v)`: `` `${name} ${v} installée` `` / `` `${name} ${v} installed` ``;
  - `notification.releaseWarning(name, v, line)`: `` `${name} ${v} installée, mais la vérification d'après a échoué : ${line}` `` / `` `${name} ${v} installed, but the check after it failed: ${line}` ``;
  - `notification.releaseFailed(name, line)`: `` `Release ${name} échouée : ${line}` `` / `` `${name} release failed: ${line}` ``;
  - `notification.releaseDied(name)`: `` `La release ${name} s'est arrêtée sans finir` `` / `` `The ${name} release stopped before finishing` ``.

  `name` is the repo name with its first letter capitalized (`hermeneia` → `Hermeneia`).

- [ ] **Step 1: Failing tests** (`launch.test.ts`):
  - `refuses when the version changed since the press`: `shown: 'v0.2.41'`, a waiting `feat` → `versionChanged('v0.3.0')`, and nothing is launched.
  - `refuses on dirty checkout`.
  - `refuses off base`.
  - `refuses while running`.
  - `launches detached and writes the record`: the call matches `nohup`, the record JSON has `pid` from stdout, `expected`, and `tagAtLaunch`.
- [ ] **Step 2: Failing tests** (`collect.test.ts`):
  - `one repo per release rule`: other kinds are ignored.
  - `notifies a done run once per key`.
  - `fetches at most every FETCH_MS`.
- [ ] **Step 3: Run.** Expected: fail.
- [ ] **Step 4: Implement.**
- [ ] **Step 5: Run** test + validate. Expected: pass.
- [ ] **Step 6: Commit** `feat(release): launch a detached release and collect release repos each tick`.

### Task L6: the Releases pane, `/release`, summary counter, docs

**Files:**
- Create: `hooks/ui/release-pane.tsx` (`RELEASE_PANE = 'release'`, `drawReleasePane`)
- Modify: `hooks/ui/lines.ts` (`summaryLine` gains `toRelease: number`)
- Modify: `hooks/register.ts`:
  - atoms `RELEASES` (`ReleaseRepo[]`) and `RELEASE_EXPANDED` (`Record<string, boolean>`);
  - `/release` command, `command.run`, `ui.render` `{ component: 'Pane', requestId: 'release' }`;
  - a `release(slug, shown)` button that calls `launchRelease`, toasts the reason or "Release vX lancée", then `tickNow()`.
- Modify: `hooks/ui/band.tsx` (`Buttons` type gains `release` and `toggleRelease`)
- Modify: `types/index.d.ts` (`LighthouseReleaseRepo` and its parts, the two atoms)
- Modify: `hooks/i18n.ts`:
  - `releasePaneTitle: 'Releases'`, `releaseCommandDescription`;
  - `summary.toRelease(n)`: `` `${n} à sortir` `` / `` `${n} to release` ``;
  - sections `Fix`, `Features`, `Autres`/`Others`, `Historique`/`History`;
  - button states `Release ${v}`, `Rien à sortir`/`Nothing to release`, `Release ${v} en cours… (${min} min)` / `` `Release ${v} running… (${min} min)` ``;
  - `lastRelease(ago)`: `dernière sortie ${ago}` / `last release ${ago}`.
- Modify: `README.md`, `README.fr.md` (the `release` kind row and a "Releases pane" section), `docs/config.example.json` (an `acme/app` release rule)
- Test: `tests/ui/lines.test.ts` (summary), `tests/ui/release-pane.test.ts` if `tests/ui` already tests a `.tsx` drawing (it does not today: then only `lines.ts` helpers get tests, and the pane is checked by hand), `tests/register.test.ts` (the `/release` command is registered)

**Interfaces:**
- Consumes: `ReleaseRepo` (L5), `launchRelease` (L5).
- Produces: `drawReleasePane(ui, repos: readonly ReleaseRepo[], expanded, pressed, buttons: Buttons, t: Texts)`.

- [ ] **Step 1: Failing tests.**
  - `summaryLine` with `toRelease: 4` contains `4 à sortir`. With `0`, it does not.
  - `register` registers a `release` command.
- [ ] **Step 2: Run.** Expected: fail.
- [ ] **Step 3: Implement** the pane after the spec's sketch:
  - header `name · tag · dernière sortie <ago>` (reuse the age wording the pane already uses);
  - Fix, then Features, then a folded Others;
  - the button, then the history (each tag folded, expandable, with the same three sections inside);
  - a refusal or a failure shows on a line in `error` color, with the log path.

  The button is disabled when `waiting` is empty or `run.kind === 'running'`. Use the plugin-authoring skill for the `Button` disabled prop and for a second pane. If a second pane cannot be opened, fall back to a `Releases` frame at the end of the main pane and say so in the PR.
- [ ] **Step 4: Run** test + validate. Expected: pass.
- [ ] **Step 5: Manual check in a real session** (`/reload-plugins`):
  1. Write a temporary `~/.lighthouse/config.json` copy with an extra test rule on a scratch repo (a local repo with an `origin`, two tags and a few `feat:`/`fix:` commits). Its `command` is `sleep 90 && git tag v0.3.0`.
  2. `/release` shows the lists and "Release v0.3.0".
  3. Press it, then close that session while it is running. In another session, the pane shows "en cours", then ✓ and one notification.
  4. Restore the config.

  Report what was seen. If the detached process dies with the session, say so and stop before opening the PR.
- [ ] **Step 6: Commit** `feat(release): a Releases pane opened by /release`, and `docs: document release mode`.
- [ ] **Step 7: Push, then open the PR** with `GH_CONFIG_DIR=~/.config/gh-hn6pot`, in English. Link the Hermeneia PR.

## After both PRs merge (only on the person's word)

Replace the `hn6pot/hermeneia` rule in `~/.lighthouse/config.json` with:

```json
"hn6pot/hermeneia": { "kind": "release", "path": "~/WorkingLab/personal/hermeneia", "command": "pnpm install-app" }
```
