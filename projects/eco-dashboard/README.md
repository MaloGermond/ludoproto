# eco-dashboard — POC mécaniques socio-économiques (issue #12)

Dashboard pour tester si l'échange, le prêt, la dépendance, le conflit
opportuniste et la coopération face à une menace commune créent de vraies
décisions entre joueurs. Aucune simulation spatiale : on joue sur des
chiffres et des relations.

Game design de référence : [`docs/materiaux-chaine.md`](docs/materiaux-chaine.md)
(chaîne de matériaux et d'énergie) et [`docs/foret-sombre-cooperation.md`](docs/foret-sombre-cooperation.md)
(forêt sombre, coopération, trahison). Les arbitrages sur leurs questions
ouvertes sont listés plus bas.

```bash
npm run dev          # http://localhost:3001 (ou ouvrir index.html directement)
node sim.js 300      # 300 parties automatiques, bilan par stratégie
node sim.js 100 equilibre,specialiste,preteur,specialiste   # composition imposée (ici : table coopérative)
npm run check        # vérifie qu'aucune techno n'exige une rare inaccessible sans elle
```

## Utilisation

- Chaque joueur est **Humain** (joué à la main) ou piloté par une **stratégie**
  automatique (sélecteur sur sa carte). On peut mélanger, et changer en cours de partie.
- « Agir en tant que » (ou clic sur une carte) choisit qui agit : c'est du hot-seat.
- **Fin du tour** : les stratégies jouent, puis production, recherche, jalons et âges,
  incidents, échéances des prêts, pollution, forêt sombre, envahisseurs, faillites, fins.
- La graine rend une partie reproductible : même graine + mêmes actions = même partie.

## Trois âges

| Âge | Déclencheur | Où l'on exploite | Énergie / carburant | Menace principale |
| --- | --- | --- | --- | --- |
| **Early** | début | Terre | Ergols d'hydrocarbures (raffinerie, très polluante) | Pollution : défaite collective |
| **Mid** | jalon « Première orbite » | Orbite basse, Lune, Mars, Mercure, Ceinture | Ergols de glace (usine d'ergols), fission | Forêt sombre |
| **Late** | fusion (PRO-8) ou extraction sur une planète extérieure | Géante gazeuse, Comète | Fusion (hélium-3) | Envahisseurs, armadas, tensions |

## Règles (chiffres approximatifs, cf. `CONFIG` dans `game.js`)

| Mécanique | Implémentation |
| --- | --- |
| Ressources | Argent, **métaux** (fer, aluminium, titane implicites, y compris le régolithe lunaire, matériau de construction local), 4 rares : Hélium-3, Platinoïdes, Glace d'eau, Ergols. Tout le monde démarre sur Terre avec les mêmes ressources. Le carbone n'est pas une ressource : il est partout, sa maîtrise passe par les technos. |
| Zones | Terre, Orbite basse, Lune (métaux ×1,5 grâce au régolithe, glace), Mars (glace, ergols sans glace par Sabatier), Mercure (métaux ×2, glace), Ceinture (platinoïdes, glace), Géante gazeuse (hélium-3), Comète (glace). Les planètes **extérieures** (Géante, Comète) survivent à l'explosion du Soleil. Accès : technos de la branche Extraction pour l'espace proche, de la Propulsion (PRO-5, PRO-6) pour l'extérieur. |
| Construction | Coût × éloignement (×1 sur Terre → ×3 sur la Comète) + 1 ergol par niveau d'éloignement. Structures **lourdes** (réacteurs, chantier) : ×3 si lancées depuis la Terre, prix normal « sur place » avec CON-9 et une mine dans la zone. Chaque lancement depuis la Terre pollue une fois. |
| Stations de ravitaillement | CON-5. Leur propriétaire construit dans la zone sans ergols ; les autres y achètent les ergols qui leur manquent au tarif qu'il fixe (dépendance, étranglement possible). |
| Pollution | Seules les installations **sur Terre** polluent en continu ; régénération 12/tour. Démanteler est le seul moyen de faire baisser la pollution une fois l'industrie installée. Santé à 0 = défaite collective. |
| Recherche | 87 technos, 10 branches. Coût = **outillage** payé une fois par techno (argent + métaux) + **chercheurs** : embauche 20 ₵, salaire 3 ₵/tour (même inactifs), 4 par laboratoire. **Expérience** : paliers à 2 et 4 tours sur la même recherche (contribution ×1,3 puis ×1,6), gardée d'une techno achevée à la suivante, perdue si on retire le chercheur d'une recherche en cours. **Licenciement** : 10 ₵ × (1 + palier). Chance par tour = 1 − (1 − p)^N (N pondéré par l'expérience), plafonnée à 95 %. Certaines technos exigent un équipement en plus : des métaux (Structure, stations, impression 3D) ou une ressource rare. |
| Carbone | STR-4 composites → STR-8 nanomatériaux (−50 % sur les équipements de recherche en métaux et platinoïdes) → STR-9 matière à interaction forte (science-fiction : plus besoin de ces équipements, armadas +50 %). Les mines lointaines perdent de leur valeur en fin de partie. |
| Marché, troc, prêts, parts, rachat | Comme avant : prix fixés par chaque vendeur (rares, métaux, ravitaillement), troc avec licences et parts, prêts avec ou sans échéance, 100 parts par entreprise, rachat en faillite ou à 51 parts. |
| Conflit opportuniste | Une infra placée après celle d'un autre dans la même zone risque de l'abîmer : 5 % prudent, 20 % agressif (÷2 avec STR-6). Pas de conflit sur Terre. |
| Forêt sombre | Après « Première orbite ». Risque de lancement d'un **projectile** proportionnel à la **visibilité cumulée de toute la table** (seules les installations hors Terre se voient, d'autant plus qu'elles sont loin) ; ÷2 si une armada défend. Impact 32 tours après le lancement : Terre, Orbite, Lune, Mars, Mercure et Ceinture détruites. |
| Parade | **PRO-10, recherche collective** : les chercheurs de toute la table s'additionnent (chance de base 0,5 %/chercheur). Détenir un prérequis (PRO-7, OBS-5, REC-7) suffit pour participer, mais les participants doivent les réunir tous, et un **chantier de distorsion** (outillage commun) doit être achevé. Personne ne peut y arriver seul. Autre option : se **replier** sur les planètes extérieures (dilemme du prisonnier). COM-7 + OBS-8 = camouflage, plus aucune menace. |
| Envahisseurs | Late game, seulement si la forêt sombre a repéré l'humanité : une vague tous les 16 tours, de plus en plus forte, rase une zone sauf chez les joueurs protégés par une armada en défense. |
| Projets communs | Armada (nécessite un chantier orbital, CON-6), chantier de distorsion, méga-extracteur (EXT-6). Chacun verse ce qu'il veut ; **promesses** visibles mais non engageantes (trahison journalisée à l'achèvement) ; propriété au prorata des apports, **contrôle** au plus gros contributeur. Armada : **défense** (envahisseurs, forêt sombre), **conquête** (une attaque par tour sur un non-copropriétaire) ou **exploration** (avec PRO-10 chez un copropriétaire : fin galactique). |

### Fins de partie

- **Galactique** : un joueur maîtrise les 87 technos, ou une armada en exploration part avec la distorsion (gagnants : ses copropriétaires).
- **Économique** / **Guerrière** : un seul joueur reste, les autres surtout rachetés / détruits par un joueur.
- **Narrative** : survivre jusqu'au tour 400, ou être le seul survivant après le Soleil ou les envahisseurs.
- **Défaite collective** : planète polluée, ou personne n'a survécu.

## Arbitrages sur les questions ouvertes des documents

| Question | Choix dans le POC | Où le changer |
| --- | --- | --- |
| Mars et Mercure | Zones distinctes (Mars : ergols sans glace ; Mercure : métaux ×2) | `ZONES` |
| Matières modélisées | Une ressource « Métaux » (fer, alu, titane implicites, régolithe lunaire compris) ; carbone via les technos | `RARES`, `MATERIAL`, `ZONES` |
| Cristaux | Deviennent les **Platinoïdes** de la Ceinture | `RARES` |
| Fission | Surtout des constructions : réacteur lourd, bloqué par le coût de lancement plus que par le combustible | `INFRA.fission` |
| Twist du carbone | Partiel (−50 %) avec STR-8, total avec STR-9 | `CONFIG.carbonDiscount` |
| Stations de ravitaillement | Bâtiments à part entière, avec droit de ravitaillement | `INFRA.station` |
| Envahisseurs | Seulement si la forêt sombre a repéré l'humanité | `invaders()` |
| Qui déclenche la forêt sombre | Le cumul de la table (visibilité hors Terre) | `CONFIG.darkForestPerVis` |
| Calibrer PRO-10 / hiérarchie | Hiérarchie revue : prérequis intermédiaires (PRO-7, OBS-5, REC-7) réunis à plusieurs, outillage commun | `TECHS["PRO-10"]`, `PROJECTS.distorsion` |
| Matière à interaction forte | Menace **et** techno (STR-9) | `TECHS["STR-9"]` |
| Propriété des constructions communes | Au prorata des apports, contrôle au plus gros contributeur, production partagée | `completeProject()` |
| Licences | Accès immédiat (au choix : `"bonus"` = outillage offert et chercheurs ×2) | `CONFIG.licenceMode` |
| Expérience des chercheurs | Par chercheur, remplace le bonus d'ancienneté global | `CONFIG.xpLevels`, `CONFIG.xpMult` |

## Premiers constats (sims automatiques, avant tout playtest humain)

Sur 300 parties à stratégies tirées au hasard :

- **Fins** : 38 % de défaites écologiques, 17 % d'explosions du Soleil sans survivant, 26 % de fins narratives, 13 % économiques, 6 % galactiques.
- **Âges** : mid game vers le tour 32 ; late game dans 56 % des parties, vers le tour 150.
- **Forêt sombre** : 176 projectiles lancés en 300 parties, 29 % déviés ; le Soleil explose dans 37 % des parties, et dans la moitié des cas au moins un joueur survit en s'étant replié.
- **Coopération** : une table 100 % coopérative dévie bien plus souvent et ne perd presque jamais la planète par pollution. Une table mélangée échoue souvent parce que le savoir nécessaire est éparpillé chez des joueurs qui se replient.
- **Ressource rare introuvable** : les platinoïdes ne viennent que de la Ceinture ; tant que personne n'y va, l'électronique avancée reste bloquée. Cette dépendance est intéressante à observer en partie humaine.
- **Régolithe fondu dans les métaux** : les technos de Structure coûtent désormais des métaux en plus ; sur une table coopérative, la part de projectiles déviés passe d'environ 33 % à 24 % (course à PRO-7 un peu plus lente).
- **Prêts** : le mauvais payeur reste rentable, faute de mémoire des défauts chez les prêteurs.

## Fichiers

- `game.js` — modèle de jeu pur (sans DOM), utilisable en Node.
- `strategies.js` — stratégies automatiques (avec leur posture face au projectile : coopération, repli, trahison).
- `ui.js`, `index.html`, `style.css` — dashboard.
- `sim.js` — simulations en masse en ligne de commande.
- `check-tree.js` — vérification de l'arbre technologique.
- `docs/` — documents de game design.
