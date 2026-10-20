# planete — simulateur d'évolution planétaire (issue #27)

Une planète au centre, un panneau d'édition à gauche, jauges et courbes en dessous.

```bash
npm run dev     # http://localhost:3002
npm run sim     # trajectoire des 7 archétypes en console
```

- **Variables fixes** (traits physiques immuables, modifiables en direct sans redémarrer) : métaux, distance à l'étoile, rotation, volcanisme.
- **État initial** (point de départ, remet la simulation à zéro quand on y touche) : taille/masse de la planète, H2O (réservoir d'eau total, qui se répartit en glace / océans liquides / vapeur selon la température), CO2, végétation.
- **Champ magnétique** : effet dynamo — a besoin à la fois de métaux (noyau conducteur), d'une rotation suffisante (pour le brasser) ET d'une activité volcanique suffisante (chaleur interne qui le fait convecter). Il manque n'importe lequel des trois et il n'y a aucun champ (ex. « Vénus » : métaux et volcanisme corrects, mais rotation nulle).
- **Atmosphère** : sa densité initiale n'est plus réglée à la main, elle découle de la taille/masse de la planète (gravité qui retient les gaz dès l'origine). Sans champ magnétique, aucune des deux sources de reconstitution (dégazage volcanique, vapeur d'eau) ne fonctionne — elle s'effondre franchement vers ~0, pas vers un palier résiduel artificiel ; une planète plus grande/massive la retient aussi mieux dans le temps, indépendamment du champ (`gravityRetention`). Sous un seuil de pression minimal, toutes les formes d'eau (océans, glace, vapeur) sont balayées, pas seulement l'océan liquide — ce qui prive aussitôt la végétation de son plafond.
- **Bandes climatiques** : la calotte polaire est calculée par bandes de latitude, pas sur la seule moyenne globale. Une rotation lente redistribue mal la chaleur (écart pôle-équateur marqué) → calotte potentiellement grande même si la moyenne globale est tempérée, ce qui pèse directement sur l'albédo global.
- **Végétation** : s'adapte lentement au climat (±amplitude limitée autour de la température naturelle de la planète), boostée par le CO2 qu'elle consomme (fertilisation) jusqu'à un seuil au-delà duquel il devient toxique. Vit sur terre comme en mer (les océans comptent pour sa capacité). Son plafond (`vegCap`) est aussi réduit par une atmosphère mince : pas seulement plus lente à s'installer, elle reste clairsemée tant que l'air reste rare.
- **Océans** : couvrent toute la planète si l'eau est liquide (1 = planète 100 % océan) ; leur présence réchauffe la planète (albédo plus faible que la roche/glace) et amortit les changements de température (inertie thermique) — plus fortement à la hausse qu'à la baisse (`oceanWarmBuffer`), comme dans la réalité où les océans captent l'essentiel du réchauffement. S'ils chauffent trop, ils s'évaporent (`vapor`) — et cette vapeur rejoint l'atmosphère (`vaporToAtm`), pas seulement l'effet de serre : boucle d'emballement réaliste type Vénus (plus chaud → plus de vapeur → atmosphère plus dense/humide → effet de serre renforcé → encore plus chaud).
- **Cendres volcaniques** : en plus de retomber seules, elles sont lessivées plus vite par la pluie (`ashRainout`) quand il y a des océans ou de la vapeur — une planète humide garde moins longtemps ses cendres en suspension qu'une planète sèche.
- **CO2** : capté chaque année par le vivant terrestre (`co2AbsorbVeg`) et par le phytoplancton océanique (`co2AbsorbOcean`). Les deux sont proportionnels à la végétation et retombent à 0 si elle s'effondre — dans ce modèle, c'est la biosphère qui régule le CO2, pas l'eau en elle-même.
- **Joueur** : nombre d'usines (émettent du CO2).
- **Seuils et coefficients** : tous dans `COEFFS` (`sim.js`), éditables en direct dans le panneau.
- **Unités du panneau de droite** : CO2 et vapeur d'eau en ppm (gaz traces), océans/glace en km³ réels (échelle calibrée sur l'hydrosphère terrestre via le H2O initial), rotation en heures/jour, et un camembert de composition atmosphérique (CO2 / H2O vapeur / autres gaz) dont la taille code la densité.

Le modèle (`sim.js`) est pur : 1 pas = 1 an. L'UI (`ui.js`) ne fait que l'afficher.

## Cas d'usage (archétypes)

Chaque archétype du panneau « Archétypes » fixe les variables fixes + l'état initial pour mettre
en avant un phénomène précis du modèle. Ce sont aussi des scénarios de non-régression manuels :
après une modification de `sim.js`, relancer `npm run sim` et vérifier que chaque archétype illustre
toujours le phénomène attendu (la trace ajoute 30 usines à partir de l'an 150 pour tous, donc tous
finissent par un emballement du CO2 à terme — ce qui doit varier d'un archétype à l'autre, c'est la
vitesse et le chemin, pas l'issue finale).

| Archétype | Paramètres fixes (métaux/distance/rotation/volcanisme) | État initial (taille-masse/H2O/CO2/vég) | Phénomène mis en avant |
|---|---|---|---|
| Océanique stable | .9 / 1 / .5 / .3 | .67 / .9 / .02 / .05 | Référence tempérée, océans abondants : sert de point de comparaison pour les autres cas. |
| Désertique | .8 / .85 / .6 / .2 | .58 / 0 / .02 / .05 | Sans eau liquide → pas d'océans → végétation plafonnée à `desertCap` (25 %), quels que soient l'atmosphère et le CO2. |
| Effet de serre | .8 / .55 / .4 / .5 | .75 / .3 / .1 / .02 | Proche de l'étoile + CO2 de départ élevé → déjà au-dessus du seuil de surchauffe à l'an 0 : la végétation n'a jamais la moindre chance de s'installer. |
| Morte | 0 / 1 / .5 / .1 | .83 / .5 / .02 / .1 | Pas de métaux → pas de champ magnétique → l'atmosphère se dissipe (ralenti par sa grande taille, mais ça finit quand même par arriver). Montre le couplage champ magnétique → atmosphère → plafond de végétation (qui s'effondre avec l'air) → captation du CO2 (qui s'effondre avec la végétation). |
| Volcanique sombre | .7 / 1 / .3 / .95 | .67 / .4 / .05 / .02 | Volcanisme extrême → cendres abondantes qui refroidissent la planète (`ashCooling`) et freinent la végétation (`transparency`), tout en dégazant beaucoup de CO2 et d'atmosphère. |
| Glaciation | .8 / 1.6 / .5 / .1 | .5 / .6 / .02 / .05 | Loin de l'étoile → démarre gelé (eau sous forme de glace) : la végétation doit s'installer dans le froid avant que le CO2 (notamment industriel) ne réchauffe la planète. |
| Vénus (pas de rotation) | .8 / .72 / 0 / .6 | .67 / .3 / .05 / .02 | Métaux et volcanisme suffisants pour un champ magnétique, mais rotation nulle → pas d'effet dynamo → aucune reconstitution de l'atmosphère, qui s'effondre vers ~0 en quelques centaines d'années malgré un bon point de départ. |

## Scénarios à tester (règles causales)

Contrairement aux archétypes ci-dessus (des points de départ figés), ce qui suit décrit comment le
modèle doit **réagir** à une modification donnée, quel que soit le point de départ. À vérifier après
toute modification de `sim.js` qui touche à la température, l'eau ou le cycle du carbone.

| Si… | …alors | Comment vérifier |
|---|---|---|
| Température au-dessus de `oceanBoil` (+ `boilRange`) | Les océans s'assèchent (`oceans → 0`), la vapeur (`vapor`) monte. | Pousser `temp` au-delà de 100 °C (ex. forte dose de CO2/usines) → `Océans` dans le panneau de droite doit tendre vers 0 %. |
| Océans/glace qui se vaporisent (vapor élevé) | La vapeur rejoint l'atmosphère (`vaporToAtm`), qui s'épaissit — ce qui renforce l'effet de serre et accélère encore le réchauffement (boucle d'emballement type Vénus). | Comparer un monde riche en H2O à un monde sec recevant le même CO2/usines : celui avec de l'eau doit chauffer plus vite et plus fort une fois la vapeur partie dans l'atmosphère. |
| Atmosphère mince (< ~0.5), même au-dessus du seuil vital `atmMinVeg` | Le plafond de végétation (`vegCap`) est réduit en proportion — pas seulement la vitesse pour l'atteindre. | Stabiliser une atmosphère autour de 0.2 avec des océans abondants, laisser tourner longtemps : la végétation doit plafonner nettement sous 1, pas y tendre. |
| Végétation effondrée (≈ 0) | Plus aucune captation de CO2, ni par le vivant (`co2AbsorbVeg`) ni par les océans (`co2AbsorbOcean`) : la biosphère est le seul puits de carbone du modèle. | Sur « Morte » (ou tout monde où la végétation retombe à 0), vérifier que les deux lignes « Captation CO2 » du panneau de droite passent à 0 %/an au même moment que la végétation s'effondre. |
| Volcanisme élevé | Les cendres (`haze`) montent, ce qui refroidit le climat (`ashCooling`) **et** ralentit directement la végétation via la lumière bloquée (`transparency`), en plus de l'effet indirect par la température. | Comparer deux mondes identiques avec volcanisme fort vs nul : celui à fort volcanisme doit être plus froid et sa végétation plus lente à démarrer tant que `haze` reste haut. |
| Cendres en suspension + présence d'eau (océans ou vapeur) | Les cendres sont lessivées plus vite (`ashRainout`) : une planète humide retrouve un ciel clair plus vite qu'une planète sèche à volcanisme égal. | Comparer deux mondes à volcanisme identique, l'un avec beaucoup d'H2O, l'autre sans : `haze` à l'équilibre doit être plus bas chez celui avec de l'eau. |
| Pas de métaux OU pas de rotation OU pas de volcanisme | Aucun effet dynamo → champ magnétique nul → aucune reconstitution de l'atmosphère (ni dégazage, ni vapeur) → elle s'effondre vers ~0.01, pas vers un palier résiduel. | Mettre métaux, rotation ou volcanisme à 0 (toutes choses égales par ailleurs) et laisser tourner 500+ ans : `atmosphère` doit tomber proche de 0, pas se stabiliser à 20-30 %. Archétype dédié : « Vénus ». |
| Taille/masse de la planète plus grande | Atmosphère initiale plus dense (`sizeToAtm`) ET fuite ralentie dans le temps (`gravityRetention`), indépendamment du champ magnétique. | Comparer deux mondes identiques sauf la taille : celui qui est plus grand doit démarrer avec plus d'atmosphère et la perdre plus lentement même sans champ magnétique. |
| Atmosphère sous `minPressureLiquid` | Toutes les formes d'eau (océans, glace, vapeur) sont balayées, pas seulement l'océan liquide — et la végétation perd son plafond en même temps. | Reprendre le scénario précédent (atmosphère → ~0) : `Océans`, `Glace` et `Vapeur d'eau` dans le panneau de droite doivent tomber à 0 au même moment, pas seulement les océans. |
| Rotation lente (écart pôle-équateur marqué) | La calotte polaire peut être grande même si la température globale reste tempérée — ce qui augmente l'albédo global (glace réfléchissante) indépendamment de la moyenne. | Comparer deux mondes à température moyenne identique, rotation différente : celui à rotation lente doit afficher plus de `Glace` et un albédo plus élevé. |
| Écart à l'équilibre climatique, sens du changement | Les océans amortissent davantage une hausse de température qu'une baisse (`oceanWarmBuffer`) : le réchauffement est plus lent à s'installer que le refroidissement, à écart égal. | Comparer, sur un même monde très océanique, la vitesse pour combler un déficit de +10 °C vs -10 °C par rapport à l'équilibre : la hausse doit prendre plus d'années. |
