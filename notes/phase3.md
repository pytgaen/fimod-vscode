# Phase 3 — Notes

## Statut

- **Refacto DRY (fimodArgs + playgroundEngine)** : ✅ livré (commit `3e96de2`)
- **Playground panel v1** : ✅ livré — commande `fimod.playground`, triggers editor / explorer / tree views
- **Try It** : utilise `runPlayground` (moteur partagé), UI inline inchangée côté user
- **Data Preview** : remplacé par la fusion en "Playground unifié" (voir décision ci-dessous)
- **Test Integration** : sort de Phase 3, à replanifier

## Repositionnement : Playground unifié

Dans le PRODUCT vscode d'origine, trois features décrivaient presque la même UI :

|              | Try It (Phase 2)   | Data Preview (Phase 3)  | Playground (Phase 6) |
| ------------ | ------------------ | ----------------------- | -------------------- |
| Source input | Scratch            | Fichier bound + watcher | Scratch              |
| Source mold  | Fixé (mold detail) | Pickable                | Pickable ou `-e`     |
| Live         | Non                | Oui                     | Oui                  |
| Historique   | Non                | —                       | Oui                  |

Toolbar, layout 2 panneaux, exécution fimod, formats, args : identiques. Les variables réelles = **source de l'input** et **source du mold**.

### Décision

**Fusion en une seule feature "Playground"**, paramétrée par deux axes (`inputSource`, `moldSource`) :

- **Phase 3** = Playground v1 ✅ — mode `{input: file | scratchpad | clipboard, mold: pickable | expression}`, sélection dynamique via toolbar.
- **Phase 6** (futur) = historique.
- **Try It** = reste inline dans Mold Detail (même moteur via `runPlayground`).

Conséquences respectées :

- Pas de bouton Apply dans le Playground. Shape reste la voie pour appliquer.
- Shape inchangé côté user. Pas de chevauchement fonctionnel : Shape = consommateur (one-shot), Playground = auteur (itération).

## Archi livrée

Partage du **moteur** (logique fimod), pas la coquille UI. Try It garde sa webview propre, Playground a la sienne, les deux appellent `runPlayground`. Pas de webview-dans-webview.

### Modules

- `src/fimodArgs.ts` — `buildShapeArgs({mold, expression, inputFormat, outputFormat, moldArgs})`. Utilisé par `shape.ts`, `moldDetail.ts`, `playgroundEngine.ts`.
- `src/playgroundEngine.ts` — `runPlayground(req) → {kind: "ok" | "error", ...}`. Construit args, appelle `runFimod`, extrait les erreurs.
- `src/playgroundPanel.ts` — webview dédiée, state singleton, debounce live, triggers editor/explorer/tree.

## Décisions tranchées

- **Un seul Playground à la fois** : singleton `currentPanel`. Ouvrir à nouveau réutilise le panel existant (`reveal`).
- **Live ON par défaut** avec toggle dans la toolbar. Debounce 200 ms sur les édits.
- **Watch disque** : `onDidSaveTextDocument` sur le `fsPath` du mold courant. Pas de watcher sur les molds registry (`@source/name`) — refresh manuel via le bouton dédié.
- **Format output auto = format input** par défaut, override via toolbar.
- **Erreur exit≠0** : bandeau rouge, dernier output valide conservé en `state.lastOutput` pour affichage grisé.

## Hors Phase 3

- Historique des inputs/molds utilisés (Phase 6).
- Watcher buffer (vs disque) pour live sans save.
- Multi-playgrounds en onglets parallèles.
