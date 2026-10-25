// Every text the person or Claude reads, in English (the default) and French.

export type Lang = 'fr' | 'en'

/** The `language` option, English unless it says French. */
export const langOf = (value: unknown): Lang => (value === 'fr' ? 'fr' : 'en')

type ActionText = { 'fix-ci': string; comments: string; update: string }
type FixCiPrompt = { number: number; repo: string; branch: string; checks: string }
type CommentsPrompt = { number: number; repo: string; branch: string; gh: string }
type UpdatePrompt = { number: number; repo: string; branch: string; base: string; conflict: boolean }
type OpenPrPrompt = { branch: string; repo: string; base: string; path: string | null; stackedOn?: number }
type TidyPrompt = { repo: string; root: string; base: string; gh: string }
type DeployPrompt = { slug: string; number: number; branch: string; base: string; root: string; command?: string; reason?: string }

const s = (n: number) => (n > 1 ? 's' : '')

const FR_ACTION: ActionText = {
  'fix-ci': 'Claude corrige la CI',
  comments: 'Claude traite les commentaires',
  update: 'Claude met à jour la branche',
}

const fr = {
  lang: 'fr' as Lang,
  commandDescription: 'État des dépôts de la conversation et de leurs PR',
  paneTitle: 'Lighthouse',
  releaseCommandDescription: 'Les releases à sortir, et leur historique',
  releasePaneTitle: 'Releases',
  noRepo: "Aucun dépôt touché par cette conversation pour l'instant.",
  errorToast: (error: string) => `lighthouse : ${error}`,

  /** The steps of a PR's progress line. */
  step: { review: 'Revue', ci: 'CI', merge: 'Fusion', deploy: 'Déploiement', clean: 'Nettoyage' },
  /** A PR's age and size. */
  facts: {
    ago: (ms: number) => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} j`),
    opened: (ago: string) => `ouverte il y a ${ago}`,
    updated: (ago: string) => `active il y a ${ago}`,
    size: (additions: number, deletions: number, files: number) => `+${additions} −${deletions} · ${files} fichier${s(files)}`,
  },
  /** The pane's first line. */
  summary: {
    prs: (n: number) => `${n} PR`,
    toDeploy: (n: number) => `${n} à déployer`,
    toPush: (n: number) => `${n} à pousser`,
    toRelease: (n: number) => `${n} à sortir`,
    nothing: 'rien en attente',
  },
  release: (tag: string, since: number) => (since > 0 ? `${tag} +${since}` : tag),

  header: {
    uncommitted: (n: number) => `⚠ ${n} non commités`,
    prs: (n: number) => `${n} PR`,
    branches: (n: number) => `${n} sans PR`,
    upToDate: 'à jour',
  },
  detached: '(détachée)',
  worktree: ' (worktree)',

  chip: {
    review: { approved: 'Revue approuvée', changes: 'Changements demandés', pending: 'Revue en attente', none: 'Sans revue requise' },
    ci: { ok: 'CI ✓', failing: 'CI ✗', pending: 'CI en cours', none: 'Sans CI' },
    draft: 'Brouillon',
    waitingRelease: 'En attente de release',
    conflicts: 'Conflits',
    behindBase: 'En retard sur la base',
    unpushed: (n: number) => `↑${n} non poussé${s(n)}`,
    neverPushed: (n: number) => (n > 1 ? `${n} commits jamais poussés` : `${n} commit jamais poussé`),
    remoteDeleted: 'Branche distante supprimée',
    pushedNoPr: 'Poussée, sans PR',
    stackedOn: (n: number) => `↳ sur #${n}`,
    mergedInto: (base: string) => `Fusionnée dans ${base}`,
    deploying: 'Déploiement en cours',
    deployToConfirm: (why: string) => `Déploiement à confirmer (${why})`,
    deployFailed: 'Déploiement en échec',
    deployed: 'Déployée',
    cleaningUp: 'Nettoyage en cours',
    cleanupOnHold: (why: string) => `Nettoyage en attente (${why})`,
    cleaned: 'Worktree nettoyé ✓',
    doneCleaned: 'Déployée · worktree nettoyé',
    deployingInSession: { here: 'Déploiement en cours dans cette conversation', other: 'Déploiement en cours dans une autre conversation' },
  },

  button: {
    refresh: '↻',
    openOnGitHub: 'Ouvrir sur GitHub',
    merge: 'Fusionner',
    confirmMerge: 'Confirmer la fusion',
    push: 'Pousser',
    fixCi: 'Corriger la CI',
    comments: 'Traiter les commentaires',
    update: 'Mettre à jour la branche',
    openPr: 'Ouvrir une PR',
    deploy: 'Déployer',
    clean: 'Nettoyer',
    forget: 'Oublier',
    tidy: 'Ménage',
    intent: 'Relire avec intent',
  },

  /** The PRs where my review is requested. */
  review: {
    title: (n: number) => `À relire · ${n}`,
    by: (login: string) => `par ${login}`,
  },

  event: {
    deploying: (head: string) => `${head} fusionnée → déploiement en cours`,
    deployDoubt: (head: string, why: string) => `${head} : déploiement à confirmer (${why})`,
    failed: (head: string, why: string) => `${head} : déploiement en échec (${why})`,
    deployed: (head: string) => `${head} : déployée → nettoyage en cours`,
    cleanupDoubt: (head: string, why: string) => `${head} : nettoyage en attente (${why})`,
    cleaned: (head: string) => `${head} : déployée → worktree nettoyé ✓`,
    open: (head: string) => `${head} ouverte`,
  },

  notification: {
    deployDoubt: (number: number, slug: string, why: string | undefined) => `#${number} ${slug} fusionnée : déploiement à confirmer (${why})`,
    deployFailed: (number: number, slug: string) => `#${number} ${slug} : déploiement en échec`,
    releaseOk: (name: string, version: string) => `${name} ${version} installée`,
    releaseWarning: (name: string, version: string, line: string) => `${name} ${version} installée, mais la vérification d'après a échoué : ${line}`,
    releaseFailed: (name: string, line: string) => `Release ${name} échouée : ${line}`,
    releaseDied: (name: string) => `La release ${name} s'est arrêtée sans finir`,
  },

  releasePane: {
    alreadyRunning: 'Une release tourne déjà',
    unpushed: (n: number) => `le dossier principal a ${n} commit${n > 1 ? 's' : ''} pas poussé${n > 1 ? 's' : ''} : ils sortiraient sans être dans la liste`,
    versionChanged: (version: string) => `La version a changé : ${version}. Rappuie pour la sortir.`,
    nothing: 'Rien à sortir',
    launched: (version: string) => `Release ${version} lancée`,
    none: 'Aucun dépôt en mode release : ajoute une règle « release » dans ~/.lighthouse/config.json',
    last: (ago: string) => `dernière sortie il y a ${ago}`,
    noTag: 'pas encore de version',
    fix: (n: number) => `Fix (${n})`,
    feat: (n: number) => `Features (${n})`,
    others: (n: number) => `Autres (${n})`,
    history: 'Historique',
    button: (version: string) => `Release ${version}`,
    running: (version: string, min: number) => `Release ${version} en cours… (${min} min)`,
    log: (path: string) => `journal : ${path}`,
    tag: (tag: string, n: number, ago: string) => `${tag} · ${n} PR · il y a ${ago}`,
  },

  toast: {
    merged: (number: number, method: string) => `#${number} fusionnée (${method})`,
    notMerged: (number: number, error: string) => `#${number} non fusionnée : ${error}`,
    pushed: (branch: string) => `${branch} poussée`,
    notPushed: (branch: string, error: string) => `${branch} non poussée : ${error}`,
    unknownPr: 'PR inconnue.',
    cleanWrongStage: (stage: string) => `Nettoyage impossible : étape ${stage}.`,
    cleanRefused: (why: string | undefined) => `Nettoyage impossible : ${why}.`,
    cleaned: (branch: string) => `${branch} nettoyée.`,
    cleanBusyHere: 'Nettoyage impossible : une action est déjà en cours sur ce dépôt.',
    cleanBusyElsewhere: 'Nettoyage impossible : une autre conversation agit sur ce dépôt.',
    forgetWrongStage: (stage: string) => `Oubli impossible : étape ${stage}.`,
    forgotten: (number: number) => `#${number} oubliée.`,
  },

  /** Who works on a group of PRs and branches. */
  owner: {
    here: 'Cette conversation',
    others: (labels: readonly string[]) =>
      labels.length === 1 ? `Autre conversation · « ${labels[0]} »` : `${labels.length} autres conversations · ${labels.map(l => `« ${l} »`).join(', ')}`,
    unknown: 'Sans conversation connue',
  },

  /** How a repo without a rule deploys, as its files say: shown on the merged PR's card. */
  note: {
    workflow: (files: string) => `Déploiement par workflow (${files})`,
    localCommand: (command: string) => `Projet local : déploiement par ${command} ?`,
    localNothing: 'Projet local : rien à déployer',
  },

  reason: {
    launcherGone: 'déploiement lancé mais son issue est inconnue (lanceur disparu)',
    mainOnOtherBranch: (branch: string, base: string) => `le dossier principal est sur ${branch}, pas sur ${base}`,
    mainDirty: 'le dossier principal a des modifications en cours',
    pullFailed: (error: string) => `git pull a échoué : ${error}`,
    launchFailed: (error: string) => `lancement impossible : ${error}`,
    commandFailed: (command: string, code: number | null) => `${command} a échoué (code ${code})`,
    noMatchingCommand: 'aucune commande de déploiement ne correspond aux fichiers touchés',
    noWorkflow: 'aucun workflow de déploiement lancé par le commit de fusion',
    inferredCommand: (command: string) => `pas de workflow : ${command} détecté, à confirmer`,
    workflowUnsuccessful: (name: string, conclusion: string | null) => `workflow ${name} terminé sans succès (${conclusion ?? 'aucune'})`,
    notDeployed: (stage: string) => `déploiement pas confirmé (${stage})`,
    worktreesUnreadable: 'liste des worktrees illisible',
    currentInMain: (branch: string) => `${branch} est la branche courante du dossier principal`,
    unpushedCommitsOn: (branch: string) => `la branche ${branch} a des commits jamais poussés sur GitHub`,
    thisSessionInside: 'cette conversation tourne dans ce worktree',
    otherSessionInside: 'une autre conversation travaille dans ce worktree',
    statusFailed: (path: string) => `git status a échoué dans ${path}`,
    uncommittedIn: (n: number, path: string) => `${n} fichier(s) non commité(s) dans ${path}`,
    unpushedCommits: (head: string | undefined, pr: string | undefined) => `des commits locaux jamais poussés sur GitHub (HEAD ${head}, PR ${pr})`,
  },

  activity: {
    mergesNumber: (number: number | string) => `Claude fusionne #${number}`,
    mergesPr: 'Claude fusionne la PR',
    opensAPr: 'Claude ouvre une PR',
    updatesPr: 'Claude met à jour la PR',
    pushes: 'Claude pousse',
    rebases: 'Claude rebase',
    mergesBase: 'Claude fusionne la base',
    pulls: 'Claude récupère origin',
    commits: 'Claude commite',
    deploys: 'Claude déploie',
    working: 'Claude y travaille',
    merging: 'Fusion en cours',
    pushing: 'Push en cours',
    opensThePr: 'Claude ouvre la PR',
    action: FR_ACTION,
  },

  /** The background agent's short description, as its task list shows it. */
  task: {
    action: (action: keyof ActionText, number: number) => `${FR_ACTION[action].replace('Claude ', '')} #${number}`,
    openPr: (branch: string) => `Ouvrir la PR de ${branch}`,
  },

  prompt: {
    /** What the agent launched from the pane receives after its instruction. */
    agentBrief:
      '\n\nTu es lancé en arrière-plan par le mod lighthouse, depuis le panneau de la personne : elle ne suit pas ton travail pas à pas. ' +
      'Ne fusionne rien et ne déploie rien. Si la branche n’a pas de worktree, crée-en un dans .worktrees/ plutôt que de changer la branche du dossier principal. ' +
      'Termine par un résumé de trois lignes au plus : ce que tu as fait, ce qui reste à faire.',
    /** Added to an agent's instruction when the repo has its own gh account. */
    ghAccount: (gh: string) => `\n\nCe dépôt passe par un autre compte gh que le compte actif, qui ne le voit pas : lance chaque commande gh avec ${gh} (le compte actif reste tel quel).`,
    fixCi: (p: FixCiPrompt) =>
      `La CI de la PR #${p.number} (${p.repo}, branche ${p.branch}) est rouge : ${p.checks}. Trouve pourquoi et corrige-la dans le worktree de cette branche, puis pousse.`,
    comments: (p: CommentsPrompt) =>
      `Des changements sont demandés sur la PR #${p.number} (${p.repo}, branche ${p.branch}). Lis les commentaires de revue (${p.gh} pr view ${p.number} -R ${p.repo} --comments), traite-les dans le worktree de cette branche, puis pousse.`,
    update: (p: UpdatePrompt) =>
      `Mets à jour la branche ${p.branch} de la PR #${p.number} (${p.repo}) avec origin/${p.base}${p.conflict ? ' et résous les conflits' : ''}, dans le worktree de cette branche, puis pousse.`,
    tidy: (p: TidyPrompt) =>
      [
        `Fais le ménage dans le dépôt ${p.repo} (dossier ${p.root}, base ${p.base}) : supprime les worktrees et les branches locales dont le travail est terminé.`,
        `1. git -C ${p.root} fetch --prune origin, puis liste les worktrees (git worktree list) et les branches locales (git for-each-ref refs/heads).`,
        `2. Pour chaque branche autre que ${p.base}, cherche sa PR : ${p.gh} pr list -R ${p.repo} --head <branche> --state all --json number,state,headRefOid.`,
        `3. Supprime son worktree (git worktree remove, sans --force) puis la branche si : sa PR est fusionnée ou fermée et la branche n'a aucun commit après la tête de la PR (git branch -D est alors sûr, même après un squash) ; ou elle n'a aucun commit hors de origin/${p.base} (git branch -d).`,
        `Ne touche jamais : la branche ${p.base} ni le dossier principal ; une branche avec une PR ouverte ; une branche avec des commits qui ne sont dans aucune PR ; un worktree avec des modifications non commitées ; un worktree où une autre conversation travaille (~/.lighthouse/sessions/*.json, champs cwd et trees) ; les worktrees sous .claude/worktrees/ (le Desktop les gère).`,
        `4. Sur GitHub, supprime aussi la branche de chacune de tes PR fusionnées ou fermées (${p.gh} pr list -R ${p.repo} --author @me --state merged puis --state closed, champs headRefName et headRefOid) : git -C ${p.root} push origin --delete <branche>, seulement si git ls-remote --heads origin <branche> donne encore le headRefOid de la PR. Garde les branches distantes sans PR et celles des autres.`,
        `Ne pousse aucun commit et ne ferme aucune PR. Termine par la liste de ce que tu as supprimé (en local et sur GitHub) et de ce que tu as gardé, avec la raison.`,
      ].join('\n'),
    openPr: (p: OpenPrPrompt) =>
      `Ouvre une PR pour la branche ${p.branch} de ${p.repo} (base ${p.base}${p.stackedOn ? `, la branche de la PR #${p.stackedOn}` : ''})${p.path ? `, depuis son worktree ${p.path}` : ''} : pousse-la si besoin, suis le modèle de PR et les conventions du dépôt, puis donne-moi le lien.`,
    deploy: (p: DeployPrompt) =>
      [
        `Déploie ${p.slug} après la fusion de #${p.number} (branche ${p.branch}, base ${p.base}, dossier ${p.root}).`,
        `Commande proposée : ${p.command ?? 'à déterminer'}.`,
        `Raison du doute : ${p.reason ?? 'inconnue'}.`,
        'Vérifie avant de lancer, puis dis-moi ce que tu as fait.',
      ].join('\n'),
  },
}

export type Texts = typeof fr

const EN_ACTION: ActionText = {
  'fix-ci': 'Claude is fixing the CI',
  comments: 'Claude is addressing the comments',
  update: 'Claude is updating the branch',
}

const EN_TASK: ActionText = { 'fix-ci': 'Fix the CI of', comments: 'Address the comments on', update: 'Update the branch of' }

const en: Texts = {
  lang: 'en',
  commandDescription: 'State of the session’s repos and their PRs',
  paneTitle: 'Lighthouse',
  releaseCommandDescription: 'Releases to ship, and their history',
  releasePaneTitle: 'Releases',
  noRepo: 'No repo touched by this session yet.',
  errorToast: error => `lighthouse: ${error}`,

  step: { review: 'Review', ci: 'CI', merge: 'Merge', deploy: 'Deploy', clean: 'Clean up' },
  facts: {
    ago: ms => (ms < 3_600_000 ? `${Math.max(1, Math.round(ms / 60_000))} min` : ms < 86_400_000 ? `${Math.round(ms / 3_600_000)} h` : `${Math.round(ms / 86_400_000)} d`),
    opened: ago => `opened ${ago} ago`,
    updated: ago => `updated ${ago} ago`,
    size: (additions, deletions, files) => `+${additions} −${deletions} · ${files} file${s(files)}`,
  },
  summary: {
    prs: n => `${n} PR${s(n)}`,
    toDeploy: n => `${n} to deploy`,
    toPush: n => `${n} to push`,
    toRelease: n => `${n} to release`,
    nothing: 'nothing waiting',
  },
  release: (tag, since) => (since > 0 ? `${tag} +${since}` : tag),

  header: {
    uncommitted: n => `⚠ ${n} uncommitted`,
    prs: n => `${n} PR${s(n)}`,
    branches: n => `${n} without PR`,
    upToDate: 'up to date',
  },
  detached: '(detached)',
  worktree: ' (worktree)',

  chip: {
    review: { approved: 'Review approved', changes: 'Changes requested', pending: 'Review pending', none: 'No review required' },
    ci: { ok: 'CI ✓', failing: 'CI ✗', pending: 'CI running', none: 'No CI' },
    draft: 'Draft',
    waitingRelease: 'Waiting for release',
    conflicts: 'Conflicts',
    behindBase: 'Behind the base',
    unpushed: n => `↑${n} unpushed`,
    neverPushed: n => `${n} commit${s(n)} never pushed`,
    remoteDeleted: 'Remote branch deleted',
    pushedNoPr: 'Pushed, no PR',
    stackedOn: n => `↳ on #${n}`,
    mergedInto: base => `Merged into ${base}`,
    deploying: 'Deploying',
    deployToConfirm: why => `Deploy to confirm (${why})`,
    deployFailed: 'Deploy failed',
    deployed: 'Deployed',
    cleaningUp: 'Cleaning up',
    cleanupOnHold: why => `Cleanup on hold (${why})`,
    cleaned: 'Worktree cleaned ✓',
    doneCleaned: 'Deployed · worktree cleaned',
    deployingInSession: { here: 'Deploying in this session', other: 'Deploying in another session' },
  },

  button: {
    refresh: '↻',
    openOnGitHub: 'Open on GitHub',
    merge: 'Merge',
    confirmMerge: 'Confirm merge',
    push: 'Push',
    fixCi: 'Fix the CI',
    comments: 'Address comments',
    update: 'Update branch',
    openPr: 'Open a PR',
    deploy: 'Deploy',
    clean: 'Clean up',
    forget: 'Forget',
    tidy: 'Tidy up',
    intent: 'Review with intent',
  },

  review: {
    title: n => `To review · ${n}`,
    by: login => `by ${login}`,
  },

  event: {
    deploying: head => `${head} merged → deploying`,
    deployDoubt: (head, why) => `${head}: deploy to confirm (${why})`,
    failed: (head, why) => `${head}: deploy failed (${why})`,
    deployed: head => `${head}: deployed → cleaning up`,
    cleanupDoubt: (head, why) => `${head}: cleanup on hold (${why})`,
    cleaned: head => `${head}: deployed → worktree cleaned ✓`,
    open: head => `${head} open`,
  },

  notification: {
    deployDoubt: (number, slug, why) => `#${number} ${slug} merged: deploy to confirm (${why})`,
    deployFailed: (number, slug) => `#${number} ${slug}: deploy failed`,
    releaseOk: (name, version) => `${name} ${version} installed`,
    releaseWarning: (name, version, line) => `${name} ${version} installed, but the check after it failed: ${line}`,
    releaseFailed: (name, line) => `${name} release failed: ${line}`,
    releaseDied: name => `The ${name} release stopped before finishing`,
  },

  releasePane: {
    alreadyRunning: 'A release is already running',
    unpushed: n => `the main folder has ${n} commit${n > 1 ? 's' : ''} not pushed: they would ship without being in the list`,
    versionChanged: version => `The version changed: ${version}. Press again to ship it.`,
    nothing: 'Nothing to release',
    launched: version => `Release ${version} started`,
    none: 'No repo in release mode: add a "release" rule to ~/.lighthouse/config.json',
    last: ago => `last release ${ago} ago`,
    noTag: 'no version yet',
    fix: n => `Fix (${n})`,
    feat: n => `Features (${n})`,
    others: n => `Others (${n})`,
    history: 'History',
    button: version => `Release ${version}`,
    running: (version, min) => `Release ${version} running… (${min} min)`,
    log: path => `log: ${path}`,
    tag: (tag, n, ago) => `${tag} · ${n} PR${n > 1 ? 's' : ''} · ${ago} ago`,
  },

  toast: {
    merged: (number, method) => `#${number} merged (${method})`,
    notMerged: (number, error) => `#${number} not merged: ${error}`,
    pushed: branch => `${branch} pushed`,
    notPushed: (branch, error) => `${branch} not pushed: ${error}`,
    unknownPr: 'Unknown PR.',
    cleanWrongStage: stage => `Cannot clean up: stage ${stage}.`,
    cleanRefused: why => `Cannot clean up: ${why}.`,
    cleaned: branch => `${branch} cleaned up.`,
    cleanBusyHere: 'Cannot clean up: an action is already running on this repo.',
    cleanBusyElsewhere: 'Cannot clean up: another session is acting on this repo.',
    forgetWrongStage: stage => `Cannot forget: stage ${stage}.`,
    forgotten: number => `#${number} forgotten.`,
  },

  owner: {
    here: 'This session',
    others: labels => (labels.length === 1 ? `Another session · “${labels[0]}”` : `${labels.length} other sessions · ${labels.map(l => `“${l}”`).join(', ')}`),
    unknown: 'No known session',
  },

  note: {
    workflow: files => `Deployed by workflow (${files})`,
    localCommand: command => `Local project: deploy with ${command}?`,
    localNothing: 'Local project: nothing to deploy',
  },

  reason: {
    launcherGone: 'deploy launched but its outcome is unknown (launcher gone)',
    mainOnOtherBranch: (branch, base) => `the main folder is on ${branch}, not on ${base}`,
    mainDirty: 'the main folder has changes in progress',
    pullFailed: error => `git pull failed: ${error}`,
    launchFailed: error => `cannot launch: ${error}`,
    commandFailed: (command, code) => `${command} failed (code ${code})`,
    noMatchingCommand: 'no deploy command matches the files touched',
    noWorkflow: 'no deploy workflow started by the merge commit',
    inferredCommand: command => `no workflow: ${command} found, to confirm`,
    workflowUnsuccessful: (name, conclusion) => `workflow ${name} finished without success (${conclusion ?? 'none'})`,
    notDeployed: stage => `deploy not confirmed (${stage})`,
    worktreesUnreadable: 'worktree list unreadable',
    currentInMain: branch => `${branch} is the current branch of the main folder`,
    unpushedCommitsOn: branch => `branch ${branch} has commits never pushed to GitHub`,
    thisSessionInside: 'this session runs in that worktree',
    otherSessionInside: 'another session is working in that worktree',
    statusFailed: path => `git status failed in ${path}`,
    uncommittedIn: (n, path) => `${n} uncommitted file(s) in ${path}`,
    unpushedCommits: (head, pr) => `local commits never pushed to GitHub (HEAD ${head}, PR ${pr})`,
  },

  activity: {
    mergesNumber: number => `Claude is merging #${number}`,
    mergesPr: 'Claude is merging the PR',
    opensAPr: 'Claude is opening a PR',
    updatesPr: 'Claude is updating the PR',
    pushes: 'Claude is pushing',
    rebases: 'Claude is rebasing',
    mergesBase: 'Claude is merging the base',
    pulls: 'Claude is pulling origin',
    commits: 'Claude is committing',
    deploys: 'Claude is deploying',
    working: 'Claude is working here',
    merging: 'Merging',
    pushing: 'Pushing',
    opensThePr: 'Claude is opening the PR',
    action: EN_ACTION,
  },

  task: {
    action: (action, number) => `${EN_TASK[action]} #${number}`,
    openPr: branch => `Open the PR for ${branch}`,
  },

  prompt: {
    agentBrief:
      '\n\nYou were launched in the background by the lighthouse mod, from the person’s pane: they are not following your work step by step. ' +
      'Do not merge anything and do not deploy anything. If the branch has no worktree, create one in .worktrees/ rather than switching the branch of the main folder. ' +
      'End with a summary of three lines at most: what you did, what is left to do.',
    ghAccount: gh => `\n\nThis repo goes through another gh account than the active one, which cannot see it: run every gh command as ${gh} (the active account stays as it is).`,
    fixCi: p =>
      `The CI of PR #${p.number} (${p.repo}, branch ${p.branch}) is red: ${p.checks}. Find out why and fix it in this branch’s worktree, then push.`,
    comments: p =>
      `Changes were requested on PR #${p.number} (${p.repo}, branch ${p.branch}). Read the review comments (${p.gh} pr view ${p.number} -R ${p.repo} --comments), address them in this branch’s worktree, then push.`,
    update: p =>
      `Update branch ${p.branch} of PR #${p.number} (${p.repo}) with origin/${p.base}${p.conflict ? ' and resolve the conflicts' : ''}, in this branch’s worktree, then push.`,
    tidy: p =>
      [
        `Tidy up the repo ${p.repo} (folder ${p.root}, base ${p.base}): remove the worktrees and local branches whose work is done.`,
        `1. git -C ${p.root} fetch --prune origin, then list the worktrees (git worktree list) and local branches (git for-each-ref refs/heads).`,
        `2. For each branch other than ${p.base}, find its PR: ${p.gh} pr list -R ${p.repo} --head <branch> --state all --json number,state,headRefOid.`,
        `3. Remove its worktree (git worktree remove, without --force) then the branch if: its PR is merged or closed and the branch has no commit after the PR's head (git branch -D is then safe, even after a squash); or it has no commit outside origin/${p.base} (git branch -d).`,
        `Never touch: the ${p.base} branch nor the main folder; a branch with an open PR; a branch with commits in no PR; a worktree with uncommitted changes; a worktree another session works in (~/.lighthouse/sessions/*.json, fields cwd and trees); worktrees under .claude/worktrees/ (the Desktop manages them).`,
        `4. On GitHub, also delete the branch of each of your merged or closed PRs (${p.gh} pr list -R ${p.repo} --author @me --state merged then --state closed, fields headRefName and headRefOid): git -C ${p.root} push origin --delete <branch>, only if git ls-remote --heads origin <branch> still gives the PR's headRefOid. Keep remote branches without a PR and other people's.`,
        `Push no commit and close no PR. End with the list of what you removed (locally and on GitHub) and what you kept, with the reason.`,
      ].join('\n'),
    openPr: p =>
      `Open a PR for branch ${p.branch} of ${p.repo} (base ${p.base}${p.stackedOn ? `, the branch of PR #${p.stackedOn}` : ''})${p.path ? `, from its worktree ${p.path}` : ''}: push it if needed, follow the repo’s PR template and conventions, then give me the link.`,
    deploy: p =>
      [
        `Deploy ${p.slug} after the merge of #${p.number} (branch ${p.branch}, base ${p.base}, folder ${p.root}).`,
        `Proposed command: ${p.command ?? 'to be determined'}.`,
        `Reason for the doubt: ${p.reason ?? 'unknown'}.`,
        'Check before launching, then tell me what you did.',
      ].join('\n'),
  },
}

export function texts(lang: Lang): Texts {
  return lang === 'en' ? en : fr
}
