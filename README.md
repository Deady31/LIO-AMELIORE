# Assistant horaires – concept (non officiel)

Web-app mobile-first (Next.js App Router + Tailwind) : un assistant intelligent d'horaires et d'itinéraires pour le réseau régional de cars de Haute-Garonne, présenté comme un **concept d'intégration** dans l'appli de transport. Aucun logo, nom de marque ni icône de l'appli officielle.

- **Prochains passages** : « prochain 362 à Grésille » → « Prochain 362 vers Toulouse – Arènes : 17h49 (dans 14 min) ».
- **Trajet direct** : « comment aller de Aussonne à Arènes ? » → départ, arrivée, durée. Sans correspondance : « Pas de trajet direct sur les lignes de la démo ».
- Boutons de choix si l'arrêt ou le sens est ambigu, mention « Horaires théoriques » partout.
- **Recherche d'arrêt tolérante** : abréviations (« Saint » = « St », « Avenue » = « Av. »…), accents, tirets, mots collés (« stcyprien »), ordre des mots, fautes et phonétique (« ciprien », « grezille »), début de mot (« cypr »), surnoms (`data/aliases.json`). Si rien n'est sûr : « Vouliez-vous dire… ? » avec les arrêts les plus proches.
- **Arrêts hors démo** : tous les arrêts du réseau sont reconnus. Un arrêt desservi par d'autres lignes reçoit une réponse claire (« Saint-Cyprien n'est pas desservi par les lignes de la démo, mais par la ligne… »).

## ⚠️ Données : jeu factice actuellement

Le script `scripts/build-gtfs.mjs` cherche le GTFS liO sur transport.data.gouv.fr. Il garde la ligne 362 et jusqu'à 2 lignes qui partagent le plus d'arrêts avec elle, puis écrit `data/network.json`.
**Dans l'environnement où ce projet a été développé, transport.data.gouv.fr n'était pas accessible.** Le JSON versionné vient donc du **jeu factice** `data/demo-gtfs/` :

- lignes **362** (Merville – Aussonne – Grésille – Cornebarrieu – Blagnac Odyssud – Toulouse Arènes) et **330** (Aussonne – Seilh – Toulouse Borderouge) ;
- 8 arrêts, service semaine / samedi / dimanche, jours fériés ;
- une ligne 345 (St Cyprien République – Tournefeuille) non retenue, pour tester les arrêts hors démo ;
- horaires inventés mais réalistes (pointes renforcées, une course après minuit).

L'interface affiche « Données factices » tant que ce jeu est utilisé. Au build (`npm run build`, donc aussi sur Vercel), le script retente le vrai GTFS et se rabat sur la démo en cas d'échec. Vérifiez le log `[gtfs]` du build. Les exemples cliquables s'adaptent aux données chargées.

Options : `LIO_GTFS_URL=…zip`, `LIO_GTFS_FILE=chemin.zip`, `LIO_LINES=362,330`, `npm run data:demo` (forcer la démo).

## Architecture

| Fichier | Rôle |
| --- | --- |
| `scripts/build-gtfs.mjs` | GTFS (zip ou dossier, lu en flux) → `data/network.json` |
| `lib/schedule.ts` | Calendriers, prochains passages, trajets directs (arrêt de départ avant l'arrêt d'arrivée sur la même course, courses après minuit) |
| `lib/text.ts` | Normalisation : abréviations, phonétique, distance d'édition |
| `lib/resolve.ts` | Arrêts (mot à mot, alias, arrêts hors démo, fuse.js en dernier recours), lignes et sens |
| `data/aliases.json` | Surnoms d'arrêts, à compléter librement |
| `lib/understand.ts` | Compréhension de la phrase : repère les arrêts cités, puis leur rôle (départ, arrivée, sens) d'après les mots voisins |
| `lib/intent.ts` | Ancienne analyse par tournures fixes, utilisée en secours quand aucun arrêt n'est repéré |
| `lib/answer.ts` | Orchestration et textes de réponse en français |
| `app/api/ask/route.ts` | `POST {question}` ou `{request}` (bouton de choix) |

Aucun modèle de langage n'est utilisé. La phrase est analysée par règles, les arrêts sont retrouvés par le code (normalisation, phonétique, fuse.js en dernier recours) et **tous les horaires sont calculés en code**.
Le temps réel n'est pas branché (`lib/config.ts` → `REALTIME_ENABLED = false`).

## En local

```bash
npm install
npm run data                 # (re)génère data/network.json
npm run dev                  # http://localhost:3000
npm test                     # tests unitaires (sur le jeu factice)
npm run build && npm start   # production
```

Test rapide de l'API : `http://localhost:3000/api/ask?q=prochain 362 à Grésille`

## Déploiement Vercel

1. Pousser le dépôt sur GitHub, puis « Add New Project » sur Vercel et importer le dépôt (framework Next.js détecté, aucun réglage requis).
2. Déployer. `npm run build` lance d'abord `prebuild`, qui tente le GTFS réel puis se rabat sur la démo.

Ou en ligne de commande : `npx vercel` puis `npx vercel --prod`.

## Mesure de la compréhension (sans modèle de langage)

Phrases écrites par l'équipe, sur le jeu de démo. **Ce ne sont pas des phrases de vrais utilisateurs.**

| Jeu | Rôle | Résultat |
| --- | --- | --- |
| `tests/benchmark.test.ts` (42 phrases : tapées, parlées, fautes, hors sujet) | Réglage du code | 27/42 avant, 42/42 après (jeu utilisé pour régler : score optimiste) |
| `holdout/holdout.test.ts` (18 phrases écrites après le code) | Contrôle | 16/18 au premier passage ; 17/18 après un correctif général (jeu plus vierge) |

Commandes : `npm run bench` et `npm run bench:holdout`.
Temps de compréhension mesuré en local : 38 à 96 ms par phrase avec 4 800 arrêts synthétiques.

