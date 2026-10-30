# lighthouse

*[English version](README.md)*

Un mod Claude Code qui ajoute un panneau **Lighthouse** sur le côté de la conversation. Il montre les dépôts git que la conversation touche, tes PR ouvertes et tes branches locales, et ce qu'il reste à faire sur chacune. Après une fusion, il suit le déploiement, puis nettoie le worktree et la branche.

> **Accès anticipé.** Les mods Claude Code (des plugins avec un module de hooks) sont une API en accès anticipé. Elle peut changer, et ce mod peut casser quand elle change.

```
╭─ Lighthouse ────────────────────────────────────────── ↻ ─╮
│ 2 PR · 1 à déployer · 1 à pousser                         │
│ ╭─ Cette conversation ──────────────────────────────────╮ │
│ │ ▼ api                                    v1.4.0 +12   │ │
│ │   #42 feat: add rate limiting  ⎇ feat/rate (worktree) │ │
│ │   Revue ─ CI ─ Fusion ─ Déploiement ─ Nettoyage       │ │
│ │   Revue approuvée · CI ✓ · ouverte il y a 3 j         │ │
│ │   [Ouvrir sur GitHub] [Fusionner]                     │ │
│ │   feat/rate-docs · ↳ sur #42 · ↑2 non poussés         │ │
│ │   [Pousser]                                           │ │
│ │   #39 fix: login · Fusionnée dans main ⟳              │ │
│ │   [Ménage]                                            │ │
│ ╰───────────────────────────────────────────────────────╯ │
│ ▶ Autre conversation · « Fix the pipeline » ↗             │
╰───────────────────────────────────────────────────────────╯
```

## Ce qu'il fait

Le panneau s'ouvre dès que la conversation touche un dépôt git ; `/lighthouse` le rouvre. Une ligne de résumé est en haut (« 2 PR · 1 à déployer · 1 à pousser »), avec un petit bouton « ↻ » pour rafraîchir tout de suite. Dessous, un cadre arrondi par conversation (celle-ci d'abord), et dedans une ligne repliable par dépôt, colorée selon son pire état. Un dépôt se déplie sur :

- **sa dernière version**, quand la branche de base a un tag (« v1.4.0 +12 » : 12 commits depuis).
- **tes PR ouvertes.** Chacune a une ligne de progression (Revue ─ CI ─ Fusion ─ Déploiement ─ Nettoyage), son âge et sa taille (en jaune après 7 jours sans activité) et la branche locale qui lui est liée, même sous un autre nom. Une carte montre le titre, le lien, la revue, la CI (checks en échec nommés), le brouillon, les conflits, le retard sur la base et les commits non poussés. Ses boutons dépendent de son état : « Ouvrir sur GitHub », « Fusionner » (deux appuis, seulement si rien ne bloque), « Pousser », et « Corriger la CI », « Traiter les commentaires » et « Mettre à jour la branche », confiés à un agent en arrière-plan.
- **les branches empilées sur une PR** (elles contiennent sa tête), montrées sous cette PR avec « ↳ sur #N ». « Ouvrir une PR » prend alors la branche de cette PR comme base.
- **les branches sans PR** : jamais poussées, en avance sur leur distante, ou poussées sans PR. Elles ont « Pousser » et « Ouvrir une PR » (agent en arrière-plan).
- **les PR fusionnées** : « Fusionnée dans main », puis où en sont le déploiement et le nettoyage. Une fois la PR nettoyée, une coche se remplit, reste 4 secondes, et la carte s'en va.
- **un bouton « Ménage »** sur chaque dépôt de cette conversation (voir plus bas).
- **ce que fait Claude** (⟳) : sur la carte que vise une commande git ou gh, « Claude travaille ici » sur le dépôt pendant son tour, et la tâche d'un agent en arrière-plan jusqu'à sa fin.

Les PR et les branches sont groupées d'abord par conversation : **cette conversation**, **une autre conversation** (sous son titre dans le Desktop, avec un « ↗ » qui l'ouvre), et **sans conversation connue**. La conversation se déduit du worktree où vit chaque PR ou branche. Ensuite, elles sont groupées par dépôt.

### PR à relire

Un dernier cadre, **À relire**, liste les PR ouvertes où ta relecture est demandée, dans n'importe quel dépôt (pas seulement ceux de la conversation) : leur titre, leur dépôt, leur auteur et leur dernière activité. Elles viennent de `gh search prs --review-requested=@me`, sur ton compte gh actif et sur chaque compte de `ghConfigDirs`, au plus toutes les 2 minutes via le cache partagé (tout de suite avec « ↻ »).

Avec le mod [intent](https://github.com/hn6pot/intent) activé, chacune d'elles, et chacune de tes propres PR, a un bouton **Relire avec intent** : il lance `/intent <lien de la PR>`, qui ouvre la page de revue d'intent sur cette PR (le pourquoi de chaque changement). Un mod ne peut pas en importer un autre : la commande slash est le seul lien entre les deux ; sans intent, le bouton n'apparaît pas.

### Specs et plans

Chaque carte de PR et chaque ligne de branche liste ses **specs et plans** : les fichiers Markdown sous un dossier nommé `specs` ou `plans` (`docs/specs/x.md`, `docs/superpowers/plans/y.md`), dans le dépôt ou hors de tout dépôt (`~/claude-outputs/acme/docs/specs/z.md`). Repliés par défaut en une ligne courte, la page de la spec et un bouton qui déplie ; dépliés, une ligne par document, les specs d'abord :

```
● Spec ↗  ▼ Docs (2)
▤ Spec rate-limiting  approuvée  Page ↗
▤ Plan rate-limiting  en cours  Page ↗  ⚠ pas à jour
```

- **Lesquels.** Les documents que la branche ajoute ou modifie (par rapport à sa base, plus ceux non commités dans son worktree) ; ceux écrits ou publiés dans la conversation qui a ensuite écrit du code dans le worktree de la branche, jusqu'à ce que cette conversation commence une nouvelle spec ; et les specs que ces plans citent, par chemin ou nom de fichier.
- **Où ils en sont**, déduit, jamais écrit dans le document. Une spec est un *brouillon*, *approuvée* dès qu'un plan la cite, *implémentée* quand tous les plans qui la citent le sont (ou, sans plan, quand une PR qui touche du code est fusionnée). Un plan est un *brouillon*, *en cours* dès que du code le suit sur la branche, *implémenté* quand sa PR est fusionnée. Une PR fusionnée qui ne touche que des dossiers `specs` ou `plans` ne compte pas. Chaque état a sa couleur : un brouillon (qui attend ton accord) en jaune, approuvé en vert, en cours dans la couleur de Claude, implémenté en vert ; la ligne repliée commence par une pastille de la couleur de sa spec.
- **Page ↗** ouvre la page claude.ai du document. Lighthouse la connaît quand Claude publie, avec l'outil Artifact, une page HTML dont le `<head>` nomme son Markdown :

  ```html
  <meta name="lighthouse-source" content="acme/api:docs/specs/2026-10-29-rate-limiting-design.md">
  ```

  `owner/repo:chemin` pour un document dans un dépôt, `~/chemin` pour un document hors dépôt. Lighthouse n'ajoute jamais cette balise : demande-la dans tes propres règles de publication. Une page sans elle n'est reliée à rien.
- **⚠ pas à jour** : le Markdown a changé depuis la dernière publication de sa page.
- Un seul bouton par ligne : **Page ↗**, sinon **Copie** (la copie locale de la page), sinon **Markdown** (le fichier lui-même). Lighthouse garde une copie de la dernière publication de chaque page dans `~/.lighthouse/pages/`, au cas où la page serait perdue.

### Releases

Un dépôt avec une règle `release` (voir Configuration) ne se déploie pas après chaque fusion. Ses PR fusionnées attendent, et son worktree et sa branche sont nettoyés tout de suite. La ligne de résumé les compte (« 4 à sortir »). Le panneau **Releases** s'ouvre tout seul, une fois, dans une conversation qui travaille dans un dépôt en mode release avec quelque chose à sortir (plus jamais une fois que tu l'as fermé ; **`/release`** le rouvre, depuis n'importe quelle conversation). Un cadre par dépôt en mode release :

- sa version actuelle et quand elle est sortie ;
- ce qui attend depuis cette version, lu dans les commits de la base : **Fix** (titres `fix:`), **Features** (`feat:`), et le reste sous **Autres**, replié ;
- un bouton **Release vX.Y.Z**. La version monte le chiffre du milieu si une feature attend, le dernier sinon ; sans rien en attente, pas de bouton. Rien ne sort tant que tu n'appuies pas ;
- l'**historique** : les 10 derniers tags de version, chacun avec les PR qu'il a apportées.

À l'appui, le mod relit GitHub. Si la version a changé entre-temps (une feature fusionnée), il ne lance rien et montre la nouvelle. Ensuite viennent les mêmes gardes qu'un déploiement manuel : le dossier principal est sur sa base, propre, et `git pull --ff-only` passe. La commande tourne alors **détachée** de la conversation : la fermer ne l'arrête pas. Toutes les conversations la voient « en cours », et une notification dit comment elle a fini : installée, installée mais une étape d'après a échoué (le nouveau tag est là, le code de sortie n'est pas 0), ou échouée (pas de nouveau tag).

Le bandeau au-dessus du prompt ne montre que ce qui t'attend dans cette conversation : un déploiement à confirmer (avec une notification et un bouton « Déployer »), un déploiement en échec (notification, « Déployer » et « Oublier »), et un nettoyage en attente (« Nettoyer », sans notification).

Un nom de branche, ou un titre en attente dans le panneau Releases, que le panneau coupe à sa largeur se déplie en entier, en grisé, juste en dessous tant que le pointeur est dessus.

L'état git local est rafraîchi toutes les 10 secondes. GitHub est lu au plus toutes les 30 secondes par dépôt (2 minutes pour les PRs à relire), via un cache partagé par toutes les conversations, et tout de suite après chaque commande git ou gh ou chaque appui sur un bouton.

## Installation

Depuis GitHub :

```
/plugin marketplace add hn6pot/lighthouse
/plugin install lighthouse@lighthouse
```

Depuis un clone local :

```bash
git clone https://github.com/hn6pot/lighthouse.git
claude plugin marketplace add ./lighthouse
claude plugin install lighthouse@lighthouse
```

Puis lance `/reload-plugins` dans chaque conversation déjà ouverte.

### Prérequis

- `git`, et la CLI GitHub `gh`, connectée (`gh auth login`) avec accès à tes dépôts.
- Conçu et utilisé sur macOS. Les déploiements manuels passent par `/bin/zsh -lc`. « Ménage » et les liens « ↗ » vers les conversations ouvrent des liens `claude://` avec `open` : il faut donc l'application Claude Desktop. Les notifications passent par `osascript` quand Claude Code n'a pas de surface pour les montrer.

## Configuration

Tout marche sans fichier de configuration. Pour fixer des règles de déploiement ou des comptes gh, crée `~/.lighthouse/config.json`. Un exemple complet est dans [`docs/config.example.json`](docs/config.example.json) :

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

Le fichier est lu au premier rafraîchissement, puis au plus une fois par minute : un changement s'applique sans recharger le mod. Si le fichier manque, est illisible ou n'est pas du JSON valide, il n'y a aucune règle et aucun compte gh en plus. Une entrée mal formée est ignorée, et les autres sont gardées.

### `rules` : comment chaque dépôt se déploie

La clé est le dépôt sous la forme `owner/repo`, tel que le donne son remote `origin`. Le champ `kind` choisit un de ces types de règle :

| `kind` | Ce qui se passe après une fusion |
| --- | --- |
| `workflow` | Suit les exécutions GitHub Actions du commit de fusion. `workflow` nomme l'exécution à suivre, telle que `gh run list` la montre (pas le nom du fichier). Sans nom, toute exécution dont le nom contient « deploy » ou « merge » compte. |
| `delay` | La PR compte comme déployée `seconds` secondes après la fusion. |
| `immediate` | La PR compte comme déployée tout de suite. |
| `manual` | Une commande à lancer sur ta machine, choisie selon les fichiers touchés par la PR (voir dessous). |
| `release` | Rien tout de suite : la PR attend une release que tu lances depuis `/release` (voir [Releases](#releases)). `path` est le dossier principal du dépôt (`~` accepté), et `command` y tourne, via `/bin/zsh -lc`, quand tu appuies sur Release. |

Une règle `manual` liste des `commands`, essayées dans l'ordre. La première qui correspond l'emporte :

- `{ "always": true, "command": "…" }` correspond toujours.
- `{ "only_under": "laptop/", "command": "…" }` correspond quand tous les fichiers de la PR sont sous `laptop/`.
- `{ "only_under": "services/*/", "single": true, "command": "make deploy SERVICE={1}" }` : le `*` capture un nom de dossier, et `{1}` le met dans la commande. Avec `single`, tous les fichiers doivent tomber sous le même dossier. Seuls les noms simples (lettres, chiffres, `.`, `_`, `-`) sont capturés : un chemin ne peut jamais injecter quoi que ce soit dans la commande.

Si aucune commande ne correspond, la PR passe en déploiement à confirmer et le bandeau te demande. `always_doubt` met toujours la PR en déploiement à confirmer, avec cette raison. C'est une chaîne, ou `{ "en": "…", "fr": "…" }` pour suivre l'option de langue.

**Un dépôt sans règle** se lit dans ses propres fichiers, et la carte de la PR fusionnée montre ce qui a été compris :

- Si un workflow GitHub démarre sur un push, le mod le suit.
- Sinon, s'il y a une cible `make deploy` ou `make install`, ou un script npm `deploy` ou `install-app`, la PR passe en déploiement à confirmer et le bouton « Déployer » propose cette commande. Le mod l'a trouvée en devinant : il ne la lance donc jamais lui-même.
- Si rien de tout ça n'existe, c'est un projet local sans rien à déployer, et le nettoyage suit tout de suite.

### `ghConfigDirs` : un compte gh par propriétaire

Par défaut, `gh` tourne avec ton compte actif. Si certains dépôts demandent un autre compte, associe leur propriétaire au dossier de config gh de ce compte. Chaque appel `gh` pour ces dépôts tourne alors avec `GH_CONFIG_DIR` réglé sur ce dossier, sans toucher à ton compte actif. Les agents lancés depuis le panneau (corriger la CI, traiter les commentaires, mettre à jour la branche, ouvrir la PR, faire le ménage) reçoivent la consigne de lancer leurs commandes `gh` de la même façon. `~` désigne ton dossier personnel. Pour créer un tel dossier : `GH_CONFIG_DIR=~/.config/gh-acme gh auth login`.

### Langue

Tout ce que le mod montre ou envoie à Claude est en anglais par défaut, ou en français : le panneau, le bandeau, les boutons, les notifications, les toasts, et les demandes à Claude et aux agents en arrière-plan. Règle l'option `language` (`en` ou `fr`) dans le menu `/config` (la ligne `lighthouse`), ou dans tes réglages :

```json
{ "pluginConfigs": { "lighthouse@lighthouse": { "options": { "language": "fr" } } } }
```

Pour un plugin chargé avec `--plugin-dir`, la clé est `lighthouse@inline`. Changer l'option recharge le module.

## Ce qu'il fait seul, et ce qu'il te demande

- **Sans interface** (`claude -p`), le mod ne fait rien.
- **Déploiement.** Le mod ne lance une commande lui-même que si une règle `manual` correspond aux fichiers fusionnés. Même alors, le dossier principal du dépôt doit être sur la branche de base et propre : il lance `git pull --ff-only`, puis la commande. Sinon, tu reçois une notification et un bouton « Déployer », qui demande à Claude de le faire. `delay` et `workflow` ne lancent rien : le mod attend le délai ou l'exécution GitHub. Un déploiement lancé n'est jamais relancé automatiquement. Si la conversation qui l'a lancé disparaît avant la fin (module rechargé, conversation fermée), la PR passe en déploiement à confirmer.
- **Un déploiement que tu lances dans la conversation.** Claude peut lancer lui-même une commande de déploiement dans un dépôt qui a une PR fusionnée : `make deploy`, `make …-push`, `helm upgrade`, `kubectl apply`, `gh workflow run`, `terraform apply`, `npm run deploy`, `./…deploy….sh`, ou la commande que le mod a proposée. Cette PR est alors marquée comme prise en charge par cette conversation pendant 30 minutes. Il n'y a ni bouton « Déployer » ni notification de doute, et sa carte dit qu'elle se déploie ici (ou dans une autre conversation). Si la commande réussit, la PR est déployée et le nettoyage suit. Un workflow lancé à la main est suivi sur GitHub à la place.
- **Nettoyage.** Le mod lance `git worktree remove` puis `git branch -D`, seulement si tout ceci est vrai :
  - la PR est fusionnée ;
  - le worktree et la branche ne portent rien que GitHub n'ait jamais eu : ils sont à la tête de la PR, en retard sur elle (des sous-PR fusionnées dans la branche là-bas), ou sur une tête poussée avant que la branche y soit rebasée ;
  - il n'y a aucune modification non commitée ;
  - aucune autre conversation n'y travaille.

  Sinon, le bandeau montre un bouton « Nettoyer », sans notification. Les vérifications se refont seules toutes les 5 minutes, et le nettoyage suit dès qu'elles passent. `-D` est voulu : après une fusion en squash, git ne voit pas la branche comme fusionnée. Ensuite, la **branche de la PR sur GitHub est supprimée aussi** (`git push origin --delete`), mais seulement tant qu'elle pointe encore sur la tête de la PR. Si GitHub refuse (une branche protégée, par exemple), la branche reste.
- **Ménage.** Ce bouton ne supprime jamais rien lui-même. Il ouvre une nouvelle conversation Claude Desktop dans le dépôt, avec l'instruction déjà tapée, et tu choisis de l'envoyer et de la suivre là-bas. L'instruction demande de supprimer :
  - les worktrees et les branches locales dont le travail est fini : PR fusionnée ou fermée sans rien après sa tête, ou rien en dehors de la base ;
  - les branches GitHub de tes PR fusionnées ou fermées qui sont encore à leur tête.

  Elle dit aussi de ne jamais toucher à la branche d'une PR ouverte, à du travail non poussé, à des modifications non commitées, au worktree d'une autre conversation, ni aux `.claude/worktrees/` du Desktop.
- **Agents en arrière-plan.** « Corriger la CI », « Traiter les commentaires », « Mettre à jour la branche » et « Ouvrir une PR » confient la tâche à un agent en arrière-plan, dans le worktree de la branche. L'agent a pour consigne de ne jamais fusionner ni déployer.
- **Un seul acteur par dépôt.** Un verrou `mkdir` dans `~/.lighthouse/locks/` empêche deux conversations d'agir en même temps sur le même dépôt. Un verrou est périmé au bout de 15 minutes.

## Les fichiers qu'il écrit

Tout est sous `~/.lighthouse/` :

| Chemin | Quoi |
| --- | --- |
| `config.json` | Ta configuration (facultative, écrite par toi, jamais par le mod). |
| `state/` | L'état des PR suivies et les notifications déjà envoyées, un fichier JSON par clé, partagé entre les conversations. |
| `sessions/` | Une entrée par conversation active : son dossier et ses worktrees. |
| `locks/` | Les verrous des dépôts. |
| `logs/` | Les journaux des déploiements et des releases lancés par le mod. |
| `releases/` | La dernière release de chaque dépôt en mode release : ce qui a été lancé (un JSON, qui sert aussi de verrou), son script, et son code de sortie une fois finie. |
| `docs/` | Ce que le mod sait des specs et plans : chaque page publiée (lien, date, empreinte de son Markdown), les liens des conversations aux branches, les documents de chaque branche. |
| `pages/` | La copie locale de chaque page publiée, la dernière. |

À part `config.json`, supprimer ce dossier est sans danger, sauf pendant un déploiement ou une release. Il est recréé au besoin, mais les PR déjà fusionnées ne seront plus suivies, et les liens et copies des pages sont perdus (republier une page ramène son lien).

## Développer

```bash
claude plugin test .       # les tests, sous tests/
claude plugin validate .   # le plugin, son module de hooks et la marketplace
```

Pour essayer une copie locale sans l'installer : `claude --plugin-dir /chemin/vers/lighthouse`. Les règles pour contribuer sont dans [`CLAUDE.md`](CLAUDE.md).

## Licence

[MIT](LICENSE)
