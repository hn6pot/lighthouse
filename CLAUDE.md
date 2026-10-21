# lighthouse: contributor rules

A Claude Code mod: a plugin whose hooks module is `hooks/register.ts` (listed in `hooks/hooks.json`). Everything is in English: code, comments, test names, docs (`README.fr.md` is the French copy of `README.md`, kept in step).

## Code

- **One responsibility per file**, in folders named after what they do (`deploy/`, `github/`, `cleanup/`, `sessions/`, `ui/`…). No catch-all files.
- **Every use of `$` stays in `hooks/register.ts`.** The Claude Code bundled with the Desktop app refuses a module that passes `$` into an imported function. Other modules receive a `Host` (`hooks/host.ts`), built in `register.ts`.
- **Atoms are declared in the file that reads and writes them** (today `register.ts`); the validator asks for it. Their shapes are declared in `types/index.d.ts` under the `lighthouse` key, a self-contained copy of `hooks/model.ts`.
- **The `requestId` of the pane's `ui.render` matcher is a string literal** (`'lighthouse'`), never an imported constant: the validator refuses one. Keep it equal to `PANE` in `hooks/ui/pane.tsx`.
- Personal settings live in `~/.lighthouse/config.json` (`hooks/config.ts`), never in the code. No real repo, company or person names in code or tests: use fake ones (`acme/api`, `acme/web`).

## Tests

- **All tests live under `tests/`, mirroring `hooks/`** (`hooks/deploy/rules.ts` → `tests/deploy/rules.test.ts`); never next to the file under test. Shared helpers go in `tests/helpers/`.
- Before any commit, both must pass:

  ```bash
  claude plugin test .
  claude plugin validate .
  ```

  The suite is timing-sensitive on a loaded machine: rerun a timed-out test before concluding.

## Commits

[Conventional Commits](https://www.conventionalcommits.org/), in English, e.g. `feat(deploy): follow a named workflow`, `fix(cleanup): keep a branch with unpushed commits`.
