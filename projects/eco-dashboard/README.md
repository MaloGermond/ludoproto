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
| Ressources | Argent, matière, 4 ressources rares. Chaque base produit la rare de sa zone ; le 5ᵉ joueur (Orbite basse) n'en a pas mais a plus d'argent : le financeur. |
| Recherche | Investir argent/matière est **irréversible** (converti en points). Les technos exigent une rare précise, et chaque techno possédée renchérit les suivantes de 50 % → spécialisation. |
| Dépendance | Les constructions consomment une rare (comptoir : He-3, labo : cristaux, extracteur : pierre lunaire, réacteur : glace) ; le réacteur consomme de l'He-3 chaque tour. |
| Marché | Chaque joueur fixe son prix de vente par rare ; achat immédiat. Les hausses de prix sont journalisées (étranglement). |
| Troc | Argent, matière, rares, licences de techno, parts d'entreprise. Une offre qui ne donne rien = demande (compensation, aide). |
| Prêts | Proposés ou demandés, avec échéance ou sans condition. Défaut constaté à l'échéance, remboursement en retard possible, dette effaçable. |
| Parts | 100 parts par entreprise. Valeur = valeur nette / 100 (chute avec la dette). 20 % de l'argent produit est versé en dividendes. |
| Rachat | Possible si la cible est en faillite (2 tours dans le rouge) ou si l'on détient ≥ 51 parts. Le racheteur absorbe actifs et dettes. |
| Conflit | Pas de bouton guerre. Une infra placée après celle d'un autre dans la même zone risque de l'abîmer chaque tour : 5 % en prudent, 20 % en agressif (×2 avec Armement, ÷2 contre Blindage). Base détruite = joueur éliminé. |
| Planète | Chaque infra pollue ; régénération 12/tour. Santé à 0 = défaite collective. |
| Forêt sombre | À partir du tour 8, risque croissant de frappe sur le joueur le plus visible (Furtivité divise la visibilité par 2). |

### Fins de partie (exclusives)

- **Économique** : un seul joueur reste, les autres ont surtout été rachetés.
- **Guerrière** : un seul joueur reste, les autres ont surtout été détruits.
- **Narrative** : au tour 20, tous les survivants gagnent.
- **Défaite collective** : planète détruite (ou aucun survivant).

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
