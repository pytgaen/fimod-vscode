# TODO — Auto-check update for embedded fimod binary

## Problème

L'extension peut télécharger un binaire fimod managé dans `<globalStorage>/bin/fimod`. Une fois posé, il n'est jamais mis à jour automatiquement → drift entre version managed et dernière release GitHub. Cas réel : EDH avait `0.3.1` (12 avril) alors que `0.4.0` était dispo sur PATH.

## Comportement cible

Au démarrage :

1. Si binary **managed** (pas `fimod.binaryPath` configuré, pas fallback PATH) :
   - Vérifier `lastCheckMs` dans `globalState` — skip si < 24 h
   - `resolveLatestVersion()` (déjà présente, `src/binary.ts:98`)
   - Comparer avec `getVersion()` local
   - Si plus récent ET version != `skippedVersion` :
     - Notification : `Fimod X.Y.Z available (you have A.B.C). Update?`
     - Boutons : `[Update]` `[Skip this version]` `[Later]`
   - Stocker `lastCheckMs = Date.now()` dans tous les cas (pour throttle)

2. Si binary **PATH** : ne rien faire (l'user gère son install via install.sh / cargo / etc.).

## Implémentation

**Fichier** : `src/binary.ts` — nouvelle fonction `checkForUpdates(ctx)`.

**Appel** : `src/extension.ts` après `ensureBinary().finally(...)`, en arrière-plan (`void checkForUpdates(ctx)`).

**Settings** :

- `fimod.binary.autoCheckUpdates` : boolean, default `true`. Pas d'intervalle configurable (24 h en dur).

**globalState keys** :

- `fimod.binary.lastCheckMs` (number)
- `fimod.binary.skippedVersion` (string)

**Comparaison versions** : semver simple via split `.` (ou dépendance `semver` si on en a besoin ailleurs).

**Erreurs** : silencieuses (logged au Output Channel). Pas de notification si la résolution GitHub échoue (offline, rate-limit) — on retentera dans 24 h.

## Hors scope v1

- Pas de check pour le binary PATH.
- Pas de planning configurable.
- Pas de canaux beta/stable.
- Pas de rollback.
