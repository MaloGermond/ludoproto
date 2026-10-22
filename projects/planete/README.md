# planete — simulateur d'évolution planétaire (issue #27)

Une planète au centre, un panneau d'édition à gauche, jauges et courbes en dessous.

```bash
npm run dev     # http://localhost:3002
npm run sim     # trajectoire des 7 archétypes en console
```

- **Variables fixes** (traits physiques immuables, modifiables en direct sans redémarrer) : métaux, distance à l'étoile, rotation, volcanisme.
- **État initial** (point de départ, remet la simulation à zéro quand on y touche) : taille/masse de la planète, H2O (réservoir d'eau total, qui se répartit en glace / océans liquides / vapeur selon la température), CO2, végétation.
- **Champ magnétique** : effet dynamo — a besoin à la fois de métaux (noyau conducteur), d'une rotation suffisante (pour le brasser) ET d'une activité volcanique suffisante (chaleur interne qui le fait convecter). Il manque n'importe lequel des trois et il n'y a aucun champ (ex. « Vénus » : métaux et volcanisme corrects, mais rotation nulle).
- **Dégazage volcanique, un seul flux réparti en proportions réalistes** (`volcanicOutput` × part de chaque gaz, cf. panaches volcaniques réels ~60-90 % H2O, ~10-25 % CO2, le reste cendres/aérosols) : H2O rejoint le réservoir de surface, CO2 et cendres montent dans l'atmosphère. H2O et CO2 ont besoin du champ magnétique pour être retenus (sinon ils s'échappent aussi vite que produits) ; les cendres, simple éjection physique, n'en ont pas besoin. Le gaz inerte (N2/O2) n'est **pas** produit par le volcanisme (réaliste : il vient de la formation de la planète) — avec le temps, l'atmosphère d'un monde volcaniquement actif tend donc à se faire dominer par H2O/CO2, même si elle a démarré surtout inerte.
- **Atmosphère = une jauge de place disponible** : sa capacité totale (`atmCapacity`) découle de la taille/masse de la planète (gravité). Le gaz inerte démarre à 40 % de cette capacité (le reste se remplit avec le temps par le dégazage) et ne se reconstitue jamais une fois perdu — seuls CO2 et H2O/cendres sont alimentés en continu. Le remplissage réel (`atmFill`, gaz inerte + CO2 + vapeur + cendres, rapporté à la capacité) limite combien de CO2 peut encore rentrer (« place disponible », `room`) : plus elle est pleine, plus le dégazage de CO2 ralentit.
- **Les cendres en altitude bloquent l'effet de serre** : au-delà d'un seuil d'opacité (`ashShieldStart`/`ashShieldRange`), le rayonnement est bloqué et l'effet de serre (gaz inerte + CO2 + vapeur) ne s'exerce plus du tout — il reprend dès que le nuage se dissipe, proportionnellement à ce qu'il reste de CO2/vapeur à ce moment. Signalé dans le panneau (☁️) quand actif.
- **Phases de l'eau** : liquide seulement si la température ET la pression atmosphérique le permettent (`minPressureLiquid`) — mais sous ce seuil, l'eau ne disparaît pas d'un coup : elle bascule progressivement en vapeur (ou reste gelée si elle l'était déjà), proportionnellement au manque de pression, en conservant la masse totale (glace + océans + vapeur = H2O). Seule une petite fraction de ce qui est exposé (pas la glace polaire, protégée comme sur Mars) s'échappe réellement et irréversiblement vers l'espace avec le temps (`waterEscape`) — elle redevient une vraie source d'eau si l'atmosphère se reconstitue avant. H2O = taux de couverture : 1 = planète entièrement recouverte (liquide/glace/vapeur selon la température), 0.5 = moitié.
- **Bandes climatiques** : la calotte polaire est calculée par bandes de latitude, pas sur la seule moyenne globale. Une rotation lente redistribue mal la chaleur (écart pôle-équateur marqué) → calotte potentiellement grande même si la moyenne globale est tempérée, ce qui pèse directement sur l'albédo global.
- **Végétation** : s'adapte lentement au climat (±amplitude limitée autour de la température naturelle de la planète), boostée par le CO2 qu'elle consomme (fertilisation) jusqu'à un seuil au-delà duquel il devient toxique. Vit sur terre comme en mer (les océans comptent pour sa capacité). Son plafond (`vegCap`) est aussi réduit par une atmosphère mince (pression totale, pas le seul gaz inerte) : pas seulement plus lente à s'installer, elle reste clairsemée tant que l'air reste rare.
- **Océans** : couvrent toute la planète si l'eau est liquide (1 = planète 100 % océan) ; leur présence réchauffe la planète (albédo plus faible que la roche/glace) et amortit les changements de température (inertie thermique) — plus fortement à la hausse qu'à la baisse (`oceanWarmBuffer`), comme dans la réalité où les océans captent l'essentiel du réchauffement.
- **Cendres volcaniques** : en plus de retomber seules, elles sont lessivées plus vite par la pluie (`ashRainout`) quand il y a des océans ou de la vapeur — ce sont des particules en suspension, pas un gaz, donc elles n'occupent pas la « place disponible » de l'atmosphère. Le nuage en suspension (`haze`) est rendu visuellement (texture nuageuse qui dérive avec le vent de la planète, pas sa rotation) et n'affecte l'albédo (le réchauffe en clair, comme les vraies cendres/aérosols volcaniques, pas noir) qu'au-delà de 50 % d'opacité (`albedoHaze`). Une partie de ce qui retombe se dépose au sol (`groundAsh`, équilibre plafonné bien avant 100 % par `ashWeathering`/`ashDeposit`) : assombrit légèrement la surface en gris clair (sauf sous la glace) et augmente aussi l'albédo (`albedoAsh`).
- **CO2** : capté chaque année par le vivant terrestre (`co2AbsorbVeg`) et par le phytoplancton océanique (`co2AbsorbOcean`). Les deux sont proportionnels à la végétation et retombent à 0 si elle s'effondre — dans ce modèle, c'est la biosphère qui régule le CO2, pas l'eau en elle-même.
- **Joueur** : nombre d'usines (émettent du CO2, limitées par la même place disponible).
- **Seuils et coefficients** : tous dans `COEFFS` (`sim.js`), éditables en direct dans le panneau.
- **Panneau de droite** : CO2 en ppm, océans/glace/eau totale en km³ réels, rotation en heures/jour, jauge de taille d'atmosphère = % de remplissage réel de la capacité, et une visualisation en 3 anneaux concentriques (niveau 1 au centre : composition de la surface — océans/glace/végétation/roche ; niveau 2 : atmosphère basse — CO2/H2O vapeur dans la place remplie, le reste en gris = place encore libre ; niveau 3 extérieur : atmosphère haute — cendres en suspension).
- **DA** : interface volontairement monochrome (noir/blanc/gris) — seul le rendu de la planète (océan, terre, glace, végétation, cendres, anneaux de composition) et le graphique d'historique gardent de la couleur, parce qu'elle y porte une information qu'un niveau de gris ne rendrait pas aussi vite.

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
| Morte | .8 / 1 / .5 / 0 | .83 / 0 / .02 / 0 | Métaux et rotation corrects, mais pas de volcanisme → pas de chaleur interne → pas d'effet dynamo malgré un noyau conducteur → l'atmosphère se dissipe quand même (ralenti par sa grande taille). Sans eau dès le départ. Montre que métaux et rotation seuls ne suffisent pas : il faut aussi de la chaleur interne. |
| Volcanique sombre | .7 / 1 / .3 / .95 | .67 / .4 / .05 / .02 | Volcanisme extrême → cendres abondantes (haze ≈ 0.53, juste au-dessus du seuil de 50 %) qui refroidissent la planète par l'albédo (`albedoHaze`) et freinent la végétation (`transparency`), tout en dégazant beaucoup de CO2 et d'atmosphère. |
| Glaciation | .8 / 1.6 / .5 / .1 | .5 / .6 / .02 / .05 | Loin de l'étoile → démarre gelé (eau sous forme de glace) : la végétation doit s'installer dans le froid avant que le CO2 (notamment industriel) ne réchauffe la planète. |
| Vénus (pas de rotation) | .8 / .72 / 0 / .6 | .67 / .3 / .05 / .02 | Métaux et volcanisme suffisants pour un champ magnétique, mais rotation nulle → pas d'effet dynamo → aucune reconstitution de l'atmosphère, qui s'effondre vers ~0 en quelques centaines d'années malgré un bon point de départ. |

## Missions

Contrairement aux archétypes (observer un phénomène) et aux scénarios (vérifier une règle),
une mission pose un problème à résoudre en jouant sur les variables fixes (vivantes, pas
besoin de relancer) et le nombre d'usines pendant que la simulation tourne. Le panneau de
droite affiche la consigne et suit l'objectif en direct (✓ une fois atteint). Définies dans
`MISSIONS` (`sim.js`).

| Mission | Point de départ | Objectif | Piste |
|---|---|---|---|
| Sous un dôme de CO2 | 30 usines déjà actives, CO2 à 0.25 sur une grande planète (taille 1.6, effet de serre puissant) : la température grimpe au-dessus du seuil, aucune végétation. | Végétation > 20 %. | Le modèle ne s'en sort pas seul tant que les usines tournent (`co2`/`temp` montent sans fin). Couper les usines suffit : la température retombe sous le seuil et le CO2 se résorbe une fois la végétation installée. |
| Boule de glace | 1,11 UA, rotation rapide : planète gelée, végétation plafonnée à la frange désertique (~22 %) sans jamais progresser, même après 300 ans. | Végétation > 50 %. | Point de bascule net plutôt qu'un dégradé : sous ~8-9 usines, rien ne change ; à partir de 10, le réchauffement suffit à faire fondre assez de glace pour déclencher une boucle positive (plus d'océans → plus de vie → …). |

## Scénarios à tester (règles causales)

Contrairement aux archétypes ci-dessus (des points de départ figés), ce qui suit décrit comment le
modèle doit **réagir** à une modification donnée, quel que soit le point de départ. À vérifier après
toute modification de `sim.js` qui touche à la température, l'eau ou le cycle du carbone.

| Si… | …alors | Comment vérifier |
|---|---|---|
| Température au-dessus de `vaporStart` (+ `vaporRange`) | Les océans s'assèchent (`oceans → 0`), la vapeur (`vapor`) monte d'autant — la masse se conserve (glace + océans + vapeur = H2O). | Pousser `temp` bien au-delà de 50 °C (ex. forte dose de CO2/usines) → `Océans` dans le panneau de droite doit tendre vers 0 % pendant que la part « H2O (vapeur) » de la barre de composition grimpe. |
| Pression sous `minPressureLiquid` | L'eau qui ne peut pas rester liquide bascule en vapeur progressivement (pas un interrupteur), proportionnellement au manque de pression — pas de disparition instantanée. | Faire chuter l'atmosphère lentement (ex. pas de dynamo) : `Océans` doit baisser graduellement sur plusieurs dizaines d'années à mesure que la pression manque, pas basculer à 0 % du jour au lendemain. |
| Cendres en altitude au-delà du seuil | L'effet de serre (gaz inerte + CO2 + vapeur) se bloque entièrement — même avec du CO2 élevé, la température ne peut plus en profiter. Le panneau affiche ☁️ « effet de serre bloqué ». | Monter `haze` au-delà de `ashShieldStart` (ex. volcanisme fort + peu d'eau pour limiter le lessivage) : la température d'équilibre doit décrocher de sa trajectoire liée au CO2 pendant que le flag est actif, et la reprendre dès que `haze` redescend sous le seuil. |
| Place disponible dans l'atmosphère pleine | Le dégazage de CO2 (volcanique ou usines) ralentit — la « jauge de remplissage » (`atmFill`) approche 100 %. | Laisser une planète volcanique tourner longtemps : la jauge « Taille de l'atmosphère » dans le panneau doit plafonner, et le CO2 doit croître de plus en plus lentement même si le volcanisme reste constant. |
| Atmosphère mince (< ~0.5), même au-dessus du seuil vital `atmMinVeg` | Le plafond de végétation (`vegCap`) est réduit en proportion — pas seulement la vitesse pour l'atteindre. | Stabiliser une atmosphère autour de 0.2 avec des océans abondants, laisser tourner longtemps : la végétation doit plafonner nettement sous 1, pas y tendre. |
| Végétation effondrée (≈ 0) | Plus aucune captation de CO2, ni par le vivant (`co2AbsorbVeg`) ni par les océans (`co2AbsorbOcean`) : la biosphère est le seul puits de carbone du modèle. | Sur « Morte » (ou tout monde où la végétation retombe à 0), vérifier que les deux lignes « Captation CO2 » du panneau de droite passent à 0 %/an au même moment que la végétation s'effondre. |
| Volcanisme élevé | Les cendres (`haze`) montent ; au-delà de 50 % d'opacité seulement, elles refroidissent le climat via l'albédo (`albedoHaze`) **et** ralentissent directement la végétation via la lumière bloquée (`transparency`), en plus de l'effet indirect par la température. | Comparer un monde à haze < 0.5 et un autre > 0.5 (volcanisme fort vs nul) : seul le second doit montrer un refroidissement net par l'albédo. |
| Cendres en suspension + présence d'eau (océans ou vapeur) | Les cendres sont lessivées plus vite (`ashRainout`) : une planète humide retrouve un ciel clair plus vite qu'une planète sèche à volcanisme égal. | Comparer deux mondes à volcanisme identique, l'un avec beaucoup d'H2O, l'autre sans : `haze` à l'équilibre doit être plus bas chez celui avec de l'eau. |
| Pas de métaux OU pas de rotation OU pas de volcanisme | Aucun effet dynamo → champ magnétique nul → aucune reconstitution de l'atmosphère (ni dégazage, ni vapeur) → elle s'effondre vers ~0.01, pas vers un palier résiduel. | Mettre métaux, rotation ou volcanisme à 0 (toutes choses égales par ailleurs) et laisser tourner 500+ ans : `atmosphère` doit tomber proche de 0, pas se stabiliser à 20-30 %. Archétype dédié : « Vénus ». |
| Taille/masse de la planète plus grande | Atmosphère initiale plus dense (`sizeToAtm`) ET fuite ralentie dans le temps (`gravityRetention`), indépendamment du champ magnétique. | Comparer deux mondes identiques sauf la taille : celui qui est plus grand doit démarrer avec plus d'atmosphère et la perdre plus lentement même sans champ magnétique. |
| Atmosphère sous `minPressureLiquid` | L'océan liquide bout/sublime tout de suite (`Océans` → 0 instantanément), mais le stock total d'H2O ne s'évapore vers l'espace que progressivement (`waterEscape`, quelques siècles pour s'épuiser) — et surtout irréversiblement : il ne revient jamais à son niveau d'origine, même si l'atmosphère se reconstitue plus tard. | Laisser un monde sans pression suffisante tourner plusieurs centaines d'années, puis forcer une atmosphère saine : `Océans`/`Glace` réapparaissent, mais seulement proportionnellement à ce qui restait d'H2O — pas au niveau de départ. |
| Rotation lente (écart pôle-équateur marqué) | La calotte polaire peut être grande même si la température globale reste tempérée — ce qui augmente l'albédo global (glace réfléchissante) indépendamment de la moyenne. | Comparer deux mondes à température moyenne identique, rotation différente : celui à rotation lente doit afficher plus de `Glace` et un albédo plus élevé. |
| Écart à l'équilibre climatique, sens du changement | Les océans amortissent davantage une hausse de température qu'une baisse (`oceanWarmBuffer`) : le réchauffement est plus lent à s'installer que le refroidissement, à écart égal. | Comparer, sur un même monde très océanique, la vitesse pour combler un déficit de +10 °C vs -10 °C par rapport à l'équilibre : la hausse doit prendre plus d'années. |
