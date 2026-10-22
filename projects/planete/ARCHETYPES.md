# Cas d'usage (archétypes)

Chaque archétype du panneau « Archétypes » fixe les variables fixes + l'état initial pour mettre
en avant un phénomène précis du modèle. Ce sont aussi des scénarios de non-régression manuels :
après une modification de `sim.js`, relancer `npm run sim` et vérifier que chaque archétype illustre
toujours le phénomène attendu (la trace ajoute 30 usines à partir de l'an 150 pour tous, donc tous
finissent par un emballement du CO2 à terme — ce qui doit varier d'un archétype à l'autre, c'est la
vitesse et le chemin, pas l'issue finale).

| Archétype | Paramètres fixes (métaux/distance/rotation/volcanisme) | État initial (taille-masse/H2O/CO2/vég) | Phénomène mis en avant |
|---|---|---|---|
| Terre | .8 / 1 / .5 / .3 | .67 / .7 / .02 / .1 | Référence réaliste (~18-19 °C, ~70 % d'océans à l'équilibre) pour comparer les autres cas. |
| Océanique stable | .9 / 1 / .5 / .3 | .67 / .9 / .02 / .05 | Référence tempérée, océans abondants : sert de point de comparaison pour les autres cas. |
| Désertique | .8 / .85 / .6 / .2 | .58 / 0 / .02 / .05 | Sans eau liquide → pas d'océans → végétation plafonnée à `desertCap` (25 %), quels que soient l'atmosphère et le CO2. |
| Effet de serre | .8 / .55 / .4 / .5 | .75 / .3 / .1 / .02 | Proche de l'étoile + CO2 de départ élevé → déjà au-dessus du seuil de surchauffe à l'an 0 : la végétation n'a jamais la moindre chance de s'installer. |
| Morte | .8 / 1 / .5 / 0 | .83 / 0 / .02 / 0 | Métaux et rotation corrects, mais pas de volcanisme → pas de chaleur interne → pas d'effet dynamo malgré un noyau conducteur → l'atmosphère se dissipe quand même (ralenti par sa grande taille). Sans eau dès le départ. Montre que métaux et rotation seuls ne suffisent pas : il faut aussi de la chaleur interne. |
| Volcanique sombre | .7 / 1 / .3 / 3 | .67 / .4 / .05 / .02 | Volcanisme à 3× Terre + peu d'eau pour lessiver → cendres stables autour de 0,37 (bien dans la plage de blocage `ashShieldStart`-`ashShieldRange`) : même quand le CO2 sature à 100 % plus tard (végétation effondrée), la température reste basse (~10 °C) au lieu de s'envoler comme dans les autres archétypes — l'effet de serre reste bloqué par les cendres. |
| Glaciation | .8 / 1.6 / .5 / .1 | .5 / .6 / .02 / .05 | Loin de l'étoile → démarre gelé (eau sous forme de glace) : la végétation doit s'installer dans le froid avant que le CO2 (notamment industriel) ne réchauffe la planète. |
| Vénus (pas de rotation) | .8 / .72 / 0 / .6 | .67 / .3 / .05 / .02 | Métaux et volcanisme suffisants pour un champ magnétique, mais rotation nulle → pas d'effet dynamo → aucune reconstitution de l'atmosphère, qui s'effondre vers ~0 en quelques centaines d'années malgré un bon point de départ. |

Définis dans `PRESETS` (`sim.js`).
