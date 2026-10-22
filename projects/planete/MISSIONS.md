# Missions

Contrairement aux archétypes (observer un phénomène) et aux scénarios (vérifier une règle),
une mission pose un problème à résoudre en jouant sur les variables fixes (vivantes, pas
besoin de relancer) et le nombre d'usines pendant que la simulation tourne. Le panneau de
droite affiche la consigne et suit l'objectif en direct (✓ une fois atteint). Définies dans
`MISSIONS` (`sim.js`).

| Mission | Point de départ | Objectif | Piste |
|---|---|---|---|
| Sous un dôme de CO2 | 30 usines déjà actives, CO2 à 0.25 sur une grande planète (taille 1.6, effet de serre puissant) : la température grimpe au-dessus du seuil, aucune végétation. | Végétation > 20 %. | Le modèle ne s'en sort pas seul tant que les usines tournent (`co2`/`temp` montent sans fin). Couper les usines suffit : la température retombe sous le seuil et le CO2 se résorbe une fois la végétation installée. |
| Boule de glace | 1,16 UA, rotation rapide (0,9), volcanisme faible (0,15) : planète gelée, végétation plafonnée à la frange désertique, sans jamais progresser même après 300 ans. | Végétation > 50 %. | Point de bascule net plutôt qu'un dégradé : à 0 usine, rien ne change ; entre 8 et 15 usines, le réchauffement suffit à faire fondre assez de glace pour déclencher une boucle positive (plus d'océans → plus de vie → …) ; au-delà de ~20, ça surchauffe et la végétation retombe à 0. |
