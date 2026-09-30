# eco-dashboard — POC mécaniques socio-économiques (issue #12)

Dashboard pour tester si l'échange, le prêt, la dépendance et le conflit
opportuniste créent de vraies décisions entre joueurs. Aucune simulation
spatiale : on joue sur des chiffres et des relations.

```bash
npm run dev          # http://localhost:3001 (ou ouvrir index.html directement)
node sim.js 300      # 300 parties automatiques, bilan par stratégie
node sim.js 100 etrangleur,preteur,pirate,equilibre   # composition imposée
```

## Utilisation

- Chaque joueur est **Humain** (joué à la main) ou piloté par une **stratégie**
  automatique (sélecteur sur sa carte). On peut mélanger, et changer en cours de partie.
- « Agir en tant que » (ou clic sur une carte) choisit qui agit : c'est du hot-seat.
- **Fin du tour** : les stratégies jouent, puis production, incidents, échéances
  des prêts, pollution, forêt sombre, faillites, conditions de fin.
- La graine rend une partie reproductible : même graine + mêmes actions = même partie.

## Règles (chiffres approximatifs, cf. `CONFIG` dans `game.js`)

| Mécanique | Implémentation |
| --- | --- |
| Ressources | Argent, matière, 5 ressources rares (Pierre lunaire, Hélium-3, Cristaux, Glace, **Ergols**). Tous les joueurs démarrent sur Terre, avec les mêmes ressources (aucune rare de départ). Les planètes (Orbite basse, Lune, Ceinture, Géante gazeuse, Comète, dans l'ordre d'éloignement) ne sont attribuées à personne : chacun peut y construire une fois la technologie d'accès de la zone débloquée (`reachTech`, ex. Lune : Sonde d'atterrissage) ; l'extraction de la rare elle-même demande en plus la techno de l'infrastructure (Extracteur : EXT-6), au bout d'une longue chaîne de prérequis. Les Ergols sont raffinés depuis la Glace (bâtiment Raffinerie) — carburant de propulsion. |
| Distance | Construire coûte plus cher en argent/matière selon l'éloignement de la zone (×1 sur Terre jusqu'à ×3 sur la Comète). Au-delà de la Ceinture, construire demande aussi des Ergols (sauf sur la Comète elle-même, qui produit la Glace nécessaire à leur raffinage — sinon impossible d'y accéder). |
| Recherche | Arbre technologique complet (86 technos, 10 branches : Propulsion, Structure, Guidage, Communications, Support de vie, Entraînement, Recherche, Extraction, Construction, Observation — cf. `TECHS`/`TECH_CATEGORIES` dans `game.js`). Il faut un **Laboratoire** construit avant d'affecter le moindre chercheur. Chance de découverte par tour = 1-(1-p)^N (p = chance de base, N = chercheurs), plafonnée à 95 %, plus un **bonus d'ancienneté** (+3 %/5 tours sur la même techno sans interruption, plafonné à +10 %) qui découvre le fait de garder son équipe en place. Coût en argent par chercheur et par tour, plein tarif le premier tour puis 30 % ensuite ; un tour raté ne rembourse rien. Certaines technos avancées exigent en plus un **équipement spécialisé** (une rare, consommée une fois, à l'engagement) — le coût grandit avec la profondeur de la branche : ex. Moteur à fusion (PRO-8) demande Ergols + Hélium-3, Nanomatériaux (STR-8) demande 4 Pierre lunaire. Des jalons narratifs (première orbite, premier satellite...) sont journalisés en cours de route. |
| Dépendance | Une fois l'extracteur construit (EXT-6), les autres constructions consomment une rare (comptoir : He-3, labo : cristaux, réacteur : glace) ; le réacteur consomme de l'He-3 chaque tour, la raffinerie de la glace. |
| Marché | Chaque joueur fixe son prix de vente par rare **ou par matière première** ; achat immédiat. Les hausses de prix sont journalisées (étranglement). |
| Troc | Argent, matière, rares, licences de techno, parts d'entreprise. Une offre qui ne donne rien = demande (compensation, aide). |
| Prêts | Proposés ou demandés, avec échéance ou sans condition. Défaut constaté à l'échéance, remboursement en retard possible, dette effaçable. |
| Parts | 100 parts par entreprise. Valeur = valeur nette / 100 (chute avec la dette). 20 % de l'argent produit est versé en dividendes. |
| Rachat | Possible si la cible est en faillite (2 tours dans le rouge) ou si l'on détient ≥ 51 parts. Le racheteur absorbe actifs et dettes. |
| Conflit | Pas de bouton guerre. Une infra placée après celle d'un autre dans la même zone risque de l'abîmer chaque tour : 5 % en prudent, 20 % en agressif (÷2 avec la techno STR-6, Blindage anti-radiations). Base détruite = joueur éliminé. La Terre est un foyer commun sans risque de conflit. |
| Planète | Chaque infra pollue ; régénération 12/tour (÷2 avec SUP-4, Recyclage eau/nourriture). Santé à 0 = défaite collective. |
| Forêt sombre | Ne guette qu'une fois le jalon "Première orbite" atteint par un joueur (voir Recherche) — pas à une date fixe, pour laisser le temps de se développer. Risque croissant ensuite sur le joueur le plus visible. |

Une partie dure 400 tours (100 ans, 4 tours par an) — de quoi laisser une chance aux technos les plus profondes de l'arbre spatial (cf. section Recherche ci-dessous), même si les atteindre reste un pari sur la durée.

### Fins de partie (exclusives)

- **Galactique** : un joueur maîtrise les 86 technologies de l'arbre et part vers d'autres galaxies à bord d'un vaisseau ultime — condition vérifiée en priorité, met fin à la partie immédiatement.
- **Économique** : un seul joueur reste, les autres ont surtout été rachetés.
- **Guerrière** : un seul joueur reste, les autres ont surtout été détruits.
- **Narrative** : au tour 400, tous les survivants gagnent (le texte mentionne en plus le camouflage galactique s'il a été atteint, voir ci-dessous).
- **Défaite collective** : planète détruite (ou aucun survivant).

**Camouflage galactique** : une fois qu'un joueur possède à la fois COM-7 (Communication quantique) et OBS-8 (Réseau de télescopes géants), la forêt sombre est définitivement neutralisée (risque à 0) — l'humanité a appris à se cacher du reste de la galaxie.

## Stratégies automatiques

Équilibré, Spécialiste, Étrangleur, Prêteur, Agressif, Furtif, Mauvais payeur :
voir `strategies.js`. Elles servent de sparring-partners pour voir **qui une
stratégie lèse ou avantage** (matrice « Qui lèse / avantage qui »).

## Lire le dashboard face aux questions ouvertes

- **Rareté → négociation ?** matrice acheteur/vendeur, taux d'acceptation des trocs, évolution des prix.
- **Prêts respectés ou abusés ?** statuts des prêts et fiabilité par emprunteur.
- **Conflit : dynamique ou frustration ?** incidents volontaires/accidentels, demandes de compensation, ce qui se passe ensuite dans le journal.
- **Spécialisation choisie ou subie ?** grille technos × joueurs, rares achetées.
- **Monopole lisible ?** table des parts, valeur des parts, prix qui montent.

## Premiers constats (sims automatiques, avant tout playtest humain)

- Sans joueur attentif à l'écologie, la planète s'effondre souvent (~40 % de défaites collectives).
- Aucune victoire économique entre bots : ils gardent trop de réserves pour tomber en faillite. Le chemin
  faillite → rachat fonctionne, mais il faudra peut-être plus de pression (entretien, prix) pour qu'il émerge.
- Le mauvais payeur s'en sort bien tant que les prêteurs ne gardent pas la mémoire des défauts.

## Fichiers

- `game.js` — modèle de jeu pur (sans DOM), utilisable en Node.
- `strategies.js` — stratégies automatiques.
- `ui.js`, `index.html`, `style.css` — dashboard.
- `sim.js` — simulations en masse en ligne de commande.
