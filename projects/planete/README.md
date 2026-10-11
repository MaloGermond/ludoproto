# planete — simulateur d'évolution planétaire (issue #27)

Une planète au centre, un panneau d'édition à gauche, jauges et courbes en dessous.

```bash
npm run dev     # http://localhost:3002
npm run sim     # trajectoire des 4 archétypes en console
```

- **Variables fixes** : métaux, eau/glace, distance à l'étoile.
- **Variables dynamiques** : atmosphère, CO2, végétation (+ température, champ magnétique et océans déduits).
- **Joueur** : nombre d'usines (émettent du CO2).
- **Seuils et coefficients** : tous dans `COEFFS` (`sim.js`), éditables en direct dans le panneau.
- Scénarios à essayer : « Désertique » + ~30 usines → emballement ; « Morte » → perte d'atmosphère.

Le modèle (`sim.js`) est pur : 1 pas = 1 an. L'UI (`ui.js`) ne fait que l'afficher.
