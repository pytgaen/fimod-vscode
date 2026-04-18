# Release Workflow

Ce document décrit le cycle de release de `fimod-vscode` : conventions, outils, invariants. Il s'adresse aux mainteneurs et contributeurs qui proposent des PR ou coupent des versions.

## TL;DR

1. Le travail se fait sur une branche, proposé via PR, mergé en **squash** sur `main`.
2. Le titre + body de la PR sont rédigés comme des commits conventionnels ; ils pilotent la génération automatique du CHANGELOG.
3. Une release est un commit `chore(release): X.Y.Z` **direct sur main** (pas de PR), accompagné d'un tag `vX.Y.Z`.
4. Une prerelease publique (`rc.N`) valide le pipeline de distribution (`release.yml` → `.vsix`) avant la release finale.

---

## Conventions de commits

`fimod-vscode` suit [Conventional Commits](https://www.conventionalcommits.org/) (norme Angular).

**Types reconnus** (impact sur CHANGELOG et bump semver) :

| Type                           | Section CHANGELOG | Bump  |
| ------------------------------ | ----------------- | ----- |
| `feat`                         | Features          | minor |
| `fix`                          | Bug Fixes         | patch |
| `perf`                         | Performance       | patch |
| `refactor`                     | Refactoring       | —     |
| `docs`                         | Documentation     | —     |
| `chore`                        | _(skippé)_        | —     |
| `ci`, `test`, `style`, `build` | _(skippé)_        | —     |

**BREAKING CHANGE** (via `!` dans le type ou footer `BREAKING CHANGE:`) :

- En 0.x.y (pré-1.0) : bump **minor** (0.1.x → 0.2.0). Convention projet, conforme à [semver §4](https://semver.org/#spec-item-4).
- À partir de 1.0.0 : bump **major**.

Exemples :

```
feat(playground): add inline expression input
fix(registry): handle missing catalog.toml gracefully
perf(webview): cache hljs setup across panels
docs(readme): document mold scan paths
chore(release): 0.2.0
```

---

## Fil conducteur — comment le CHANGELOG se construit

`fimod-vscode` utilise **squash & merge** sur GitHub (pas de merge commits). Le défi : garder un CHANGELOG riche malgré la perte de granularité du squash.

**Solution** : rédiger le body de PR comme une liste de commits conventionnels atomiques. `scripts/changelog.mjs` parse chaque ligne bullet comme un commit indépendant (équivalent de `split_commits = true` de git-cliff).

### 1 PR = 1 intention sémantique

- **Titre de PR** : subject conventionnel court et éditorial
  ```
  feat(playground): add inline expression input and live watch
  ```
- **Body de PR** : bullets conventionnels, un par changement atomique
  ```markdown
  - feat(playground): inline Python expression picker
  - feat(playground): live watch + debounced re-run on file save
  - fix(playground): release file watcher on panel dispose
  - refactor(args): centralize CLI argument construction in fimodArgs
  - docs: update README with playground section
  ```
- **Squash & merge** avec l'option GitHub _"Default to pull request title and description"_ → le commit sur `main` contient subject + body structuré.
- **`scripts/changelog.mjs`** regroupe automatiquement les entries par section lors de la génération du CHANGELOG.

Les bullets peuvent répéter/détailler le titre de PR — c'est voulu, l'un sert de titre éditorial court, l'autre de log détaillé pour le CHANGELOG.

### Highlights éditoriaux

Au fil du développement d'une version, un fichier `notes/release-vX.Y.Z.md` peut être rédigé pour capturer les **Highlights** (prose éditoriale, emojis autorisés). Exemple :

```markdown
- ✨ New Playground panel — pick any input + any mold, watch it refresh live.
- 🔧 Unified CLI args builder across Shape, Mold Detail, and Playground.
```

Lors de la release, ce contenu est injecté en tête de section dans le CHANGELOG, juste après la date. Le fichier `notes/release-vX.Y.Z.md` est supprimé dans le même commit (le contenu vit désormais dans `CHANGELOG.md`).

---

## Cycle de release

### Phase 1 — Travail (itératif, via PR)

1. Créer une branche (`feat/...`, `fix/...`, `release/X.Y.Z`).
2. Commiter normalement (les commits intra-branche sont squashés).
3. Ne **jamais** modifier `CHANGELOG.md` dans cette phase.
4. Ouvrir la PR avec titre + body conventionnels (voir fil conducteur).
5. Attendre CI verte.
6. Merger en **squash** (option _"pull request title and description"_).

### Phase 2 — Release (direct sur main)

1. Switch sur `main`, `git pull --ff-only` (garantit un historique linéaire).
2. Vérifier working tree clean.
3. Analyser les commits depuis le dernier tag : déterminer le bump (patch/minor/major, cf. règles ci-dessus).
4. Bump `package.json`, rebuild `package-lock.json` via `npm install --package-lock-only` (ou `npm version ... --no-git-tag-version`).
5. Smoke test : `npm run typecheck && npm run compile`.
6. Générer le CHANGELOG :
   ```bash
   node scripts/changelog.mjs X.Y.Z
   ```
7. Si `notes/release-vX.Y.Z.md` existe : injecter son contenu comme sous-section `### Highlights` en tête de la section `[X.Y.Z]`, puis supprimer le fichier.
8. Commit EXACTEMENT ces 3 fichiers (+ éventuelle suppression de `notes/release-vX.Y.Z.md`) :
   ```bash
   git add package.json package-lock.json CHANGELOG.md
   git add -u notes/release-vX.Y.Z.md   # si supprimé
   git commit -m "chore(release): X.Y.Z"
   git tag vX.Y.Z
   ```
9. Push avec confirmation :
   ```bash
   git push && git push --tags
   ```

Le push du tag déclenche `.github/workflows/release.yml` (build `.vsix`, GitHub Release).

---

## Prerelease publique (rc.N)

Utilisée **avant** une release `X.Y.0` (ou avant un changement de distribution notable) pour valider `release.yml` — que le `.vsix` se construit, que la GitHub Release s'écrit, que `prerelease: true` est bien positionné.

### Différences avec une release

|                    | Prerelease (`vX.Y.Z-rc.N`)                          | Release (`vX.Y.Z`)                  |
| ------------------ | --------------------------------------------------- | ----------------------------------- |
| **But**            | Valider le pipeline de distribution                 | Publication officielle              |
| **CHANGELOG.md**   | Non modifié                                         | Section générée par `changelog.mjs` |
| **Commit**         | `chore(prerelease): X.Y.Z-rc.N`                     | `chore(release): X.Y.Z`             |
| **Workflow**       | `.github/workflows/release.yml` (même trigger `v*`) | `.github/workflows/release.yml`     |
| **GitHub Release** | Marquée `prerelease: true` (tag contient `-`)       | Stable                              |
| **Branche**        | Quelconque (y compris non-main)                     | `main` uniquement                   |

### Cycle prerelease

1. `scripts/prerelease-github.sh X.Y.Z N` bump `package.json` → `X.Y.Z-rc.N`, commit `chore(prerelease): X.Y.Z-rc.N`, tag `vX.Y.Z-rc.N` (**ne push pas**).
2. Review du commit/tag.
3. Push explicite :
   ```bash
   git push && git push origin vX.Y.Z-rc.N
   ```
4. Déclenche `release.yml` → build `.vsix` → GitHub Prerelease.

**Important** : les commits `chore(prerelease):` sont **skippés** par `scripts/changelog.mjs` — ils n'apparaîtront jamais dans le `CHANGELOG.md` final.

### Convention numérotation rc

- `rc.N` avec séparateur **point**, jamais tiret (`rc.1`, `rc.2`, ...) — conforme [semver §9](https://semver.org/#spec-item-9).
- Numérotation indépendante par version cible : `0.2.0-rc.1`, `0.2.0-rc.2`, puis `0.2.0`.
- Une `rc.N` peut vivre sur une branche de feature (pas besoin de merger sur main avant de tagguer).

---

## Invariants critiques

À respecter absolument sous peine de corrompre le CHANGELOG ou l'historique :

1. `CHANGELOG.md` n'apparaît **JAMAIS** dans un commit non-`chore(release):`. Toute modif accidentelle doit être stashée jusqu'en Phase 2.
2. Le commit `chore(release):` contient **EXACTEMENT** 3 fichiers : `package.json`, `package-lock.json`, `CHANGELOG.md` (plus une éventuelle suppression de `notes/release-vX.Y.Z.md`). Tout autre fichier → STOP.
3. Aucun tag n'est créé avant que la PR de travail soit mergée sur `main`.
4. Aucun commit direct sur `main` en Phase 1 — tout passe par une PR.
5. Subject du commit release **EXACTEMENT** `chore(release): X.Y.Z` — jamais `fix:`, `feat:`, etc.
6. Squash uniquement — pas de merge commits (historique linéaire requis pour que `changelog.mjs` parse correctement).

---

## Outillage

- **`scripts/changelog.mjs`** — génération CHANGELOG depuis l'historique git. Zero deps, pur Node. Équivalent de `git-cliff` avec `split_commits=true`.
- **`scripts/prerelease-github.sh`** — bump + commit + tag pour une rc, sans push.
- **GitHub squash-merge** — activer l'option _"Default to pull request title and description"_ dans les settings du repo (sinon le body disparaît du commit squashé).
- **CI releases** — `.github/workflows/release.yml` (trigger `v*`). Le flag `prerelease` est positionné automatiquement si le tag contient `-`.

---

## Fichiers de référence

- `scripts/changelog.mjs` — générateur CHANGELOG (sections + split_commits).
- `scripts/prerelease-github.sh` — helper rc.
- `CHANGELOG.md` — historique public, maintenu automatiquement.
- `notes/release-vX.Y.Z.md` — Highlights éditoriaux (temporaire, supprimé à la release).
- `.github/workflows/release.yml` — pipeline release/prerelease unifié.
