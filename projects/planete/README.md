# planete — simulateur d'évolution planétaire (issue #27)

Une planète au centre, un panneau d'édition à gauche, jauges et courbes en dessous.

```bash
npm run dev     # http://localhost:3002
npm run sim     # trajectoire des 4 archétypes en console
```

- **Variables fixes** : métaux, eau/glace, distance à l'étoile.
- **Variables dynamiques** : atmosphère, CO2, végétation (+ température, champ magnétique et océans déduits).
- **Végétation** : s'adapte lentement au climat (±amplitude limitée autour de la température naturelle de la planète), boostée par le CO2 qu'elle consomme (fertilisation) jusqu'à un seuil au-delà duquel il devient toxique. Vit sur terre comme en mer (les océans comptent pour sa capacité).
- **Océans** : couvrent toute la planète si l'eau est liquide (1 = planète 100 % océan) ; leur présence réchauffe la planète (albédo plus faible que la roche/glace).
- **Joueur** : nombre d'usines (émettent du CO2).
- **Seuils et coefficients** : tous dans `COEFFS` (`sim.js`), éditables en direct dans le panneau.
- Scénarios à essayer : « Désertique » + ~30 usines → emballement ; « Morte » → perte d'atmosphère.

Le modèle (`sim.js`) est pur : 1 pas = 1 an. L'UI (`ui.js`) ne fait que l'afficher.
