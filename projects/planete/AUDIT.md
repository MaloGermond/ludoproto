# Audit — simulateur planétaire (`projects/planete`)

État des lieux après la session de refonte (volcanisme par gaz, atmosphère comme jauge
de capacité, cendres bloquant l'effet de serre, missions, DA monochrome). Trois parties :
boucles de rétroaction (telles qu'elles sont réellement dans le code, pas supposées),
axes de gameplay, axes de réalisme — puis des propositions classées par effort.

## Boucles de rétroaction

### Ce qui existe déjà

| Boucle | Sens | Mécanisme |
|---|---|---|
| **Glace ↔ albédo** | 🔺 positive (fuite) | Froid → plus de glace → albédo plus haut → moins d'absorption solaire → plus froid. C'est la boucle d'emballement la plus agressive du modèle (voir « Glaciation » qui ne décroche jamais). |
| **Végétation qui s'effondre ↔ CO2** | 🔺 positive (fuite) | Surchauffe ou CO2 toxique → végétation meurt → plus personne pour absorber le CO2 (`co2AbsorbVeg`/`co2AbsorbOcean` tombent à 0, la captation océanique a aussi besoin de vie) → CO2 reste haut ou continue de monter (volcanisme/usines) → encore plus chaud/toxique. **C'est la vraie boucle derrière ce que tu appelais « l'effet de serre avec le CO2 »** : le CO2 seul ne boucle pas sur lui-même, c'est son effet sur la vie qui coupe le seul puits de carbone du modèle. |
| **Vapeur d'eau ↔ température** | 🔺 positive (fuite), plus faible qu'avant | Chaud → plus d'évaporation (`vaporByTemp`) → plus de vapeur → effet de serre de la vapeur → plus chaud. Affaibli cette session : la vapeur ne gonfle plus l'atmosphère elle-même (j'ai retiré `vaporToAtm`), donc la boucle ne joue plus que sur son propre terme de serre, pas sur la taille totale de l'atmosphère. |
| **Fertilisation CO2 ↔ végétation** | 🔻 négative (stabilisante) | Plus de CO2 (jusqu'à `co2Optimal`) → végétation pousse plus vite → absorbe plus de CO2 → CO2 redescend. Le vrai régulateur à court terme du modèle, tant que la végétation est vivante. |
| **Océans ↔ inertie thermique** | 🔻 négative (ralentit, ne stabilise pas la valeur finale) | Plus d'océans → le climat met plus longtemps à atteindre l'équilibre (`oceanDamping`/`oceanWarmBuffer`) — ralentit le réchauffement plus qu'un refroidissement, mais ne change pas où le système finit. |
| **Place disponible dans l'atmosphère** | 🔻 négative (autolimitante) | Plus l'atmosphère est pleine (`atmFill`), plus le dégazage de CO2 (volcanique + usines) ralentit (`room`). Empêche un monde volcanique de remplir son atmosphère de CO2 à l'infini en un clin d'œil — mais comme la végétation morte ne consomme plus rien, ça ne suffit pas à éviter l'emballement une fois la vie éteinte. |
| **Cendres ↔ pluie** | 🔻 négative (autolimitante), *localement* 🔺 positive | Plus d'eau liquide/vapeur → lessivage plus rapide des cendres (`ashRainout`) → ciel plus clair. Corollaire piégeux : sur un monde qui *se refroidit* (moins d'eau liquide, plus de glace), le lessivage baisse → les cendres s'accumulent → l'albédo du nuage monte (passé 50 %) → ça refroidit encore plus → encore moins d'eau liquide. Boucle positive rare mais réelle, typiquement sur une planète déjà froide et volcanique. |

### Ce qui n'est *pas* une boucle (contrairement à l'intuition)

- **Volcanisme → cendres** : c'est un forçage à sens unique (le volcanisme alimente les
  cendres), pas une boucle — rien ne fait boucler les cendres vers *plus* de volcanisme.
  Les cendres ont leur propre stabilisation interne (ashDecay/rainout), mais ça n'implique
  pas le volcanisme en retour.
- **Champ magnétique → rétention** : le champ dépend de métaux/rotation/volcanisme, jamais
  de l'atmosphère elle-même — encore un forçage à sens unique, pas de boucle.

### Boucles proposées (réalistes, absentes du modèle actuel)

1. **Thermostat silicate-carbonate** (le vrai régulateur long terme de la Terre) : plus
   chaud + plus de pluie → l'érosion des roches consomme du CO2 (relargué ensuite par la
   subduction/volcanisme sur des millions d'années) → CO2 baisse → refroidit. **Résoudrait
   directement le point mort qu'on a rencontré en retunant la mission CO2** (un monde sans
   vie n'a aujourd'hui *aucun* puits de CO2, donc aucune échappatoire). `erosion` est déjà
   suivie dans le code mais n'a aucun effet en aval — c'est le crochet tout trouvé.
2. **Dégazage océanique par la chaleur** : un océan chaud retient moins de CO2 dissous
   (vrai en chimie) — au lieu de n'absorber que (`co2AbsorbOcean`), les océans pourraient
   *relâcher* du CO2 au-delà d'un certain seuil de température, amplifiant un emballement
   déjà chaud (boucle positive supplémentaire, réaliste).
3. **Albédo des nuages d'eau** (pas les cendres) : aujourd'hui la vapeur ne fait que
   réchauffer (`vaporGreenhouse`). En réalité les nuages bas réfléchissent aussi la lumière.
   Ajouter un terme d'albédo lié à la vapeur introduirait une boucle négative qui
   contrebalancerait un peu l'emballement actuel — et c'est une des plus grosses
   incertitudes de la vraie climatologie, donc thématiquement pertinent.
4. **Dégel du pergélisol / clathrates** : au-delà d'un seuil de réchauffement, libération
   rapide d'un stock de CO2/méthane piégé dans la glace — une boucle positive à seuil,
   different de la boucle glace-albédo (qui est continue).
5. **Érosion → albédo** : `erosion` existe déjà et n'a toujours aucun effet en aval. Un sol
   érodé par le vent/l'eau pourrait exposer de la roche plus sombre (baisse l'albédo) là où
   la végétation ne tient pas.

## Axes de gameplay

- **Lisibilité des boucles** : le joueur voit les variables (temp, CO2, glace…) mais pas
  *pourquoi* elles bougent. Le flag ☁️ ajouté cette session (cendres bloquent la serre) est
  un bon modèle à généraliser : un flag courl par boucle active (« glace-albédo en
  emballement », « boucle CO2-végétation en cours ») aiderait à comprendre sans lire le code.
- **Vitesse par défaut et seuils de bascule** : la mission « Boule de glace » a un vrai
  point de bascule net (8 usines → rien, 10 → tout change). C'est un bon pattern de puzzle
  (seuil net plutôt que gradient flou), mais le joueur ne peut pas le *sentir* venir sans
  essayer plusieurs valeurs — un historique visible de tentatives, ou un indicateur de
  tendance (« ça empire » / « ça s'améliore »), aiderait.
- **Missions** : avec seulement 2, le pattern est encore timide. Candidats évidents compte
  tenu des mécaniques déjà en place : une mission « cendres éternelles » (volcanisme
  extrême + peu d'eau, l'effet de serre reste bloqué indéfiniment, il faut réduire le
  volcanisme ou attendre le lessivage), une mission « dette d'eau » (jouer sur la
  perte irréversible d'eau exposée pour forcer une planification à long terme).
- **Le joueur n'agit que sur 5 curseurs vivants** (métaux, distance, rotation, volcanisme,
  usines) — c'est volontairement contraint, mais la distance et la rotation sont des
  leviers "tout ou rien" assez grossiers (déplacer une planète !). Un levier plus
  "ingénieur" (bouclier solaire artificiel, séquestration de carbone) donnerait des
  missions à la difficulté mieux dosée que "trouve la bonne distance au mètre près".
- **Le graphique d'historique** reste la seule fenêtre sur le passé récent (600 ans
  max) — rien ne permet de revoir *comment* on est arrivé à un emballement une fois qu'il
  a eu lieu il y a longtemps dans la partie.

## Axes de réalisme

**Solide** :
- Dynamo magnétique à trois conditions (métaux + rotation + chaleur interne), comme le
  consensus scientifique sur les champs planétaires.
- Proportions volcaniques H2O/CO2/cendres calées sur des mesures réelles de panaches.
- Capacité atmosphérique liée à la gravité (taille), rétention par le champ magnétique —
  conforme au contraste Mars/Vénus/Terre.
- Glace polaire protégée de la fuite d'eau (Mars garde sa glace malgré 4 milliards
  d'années d'atmosphère quasi nulle).
- Cendres volcaniques claires (pas noires), effet d'albédo seulement au-delà d'un seuil
  d'opacité — cohérent avec l'hiver volcanique réel (Pinatubo, Tambora).

**Simplifications qui pèsent sur le jeu** :
- **Aucun puits de CO2 abiotique** (voir boucle proposée #1) : une fois la vie éteinte,
  le CO2 ne redescend jamais tout seul. Dans la vraie vie, le cycle silicate-carbonate
  agit même sans biosphère (juste beaucoup plus lentement).
- **Les cendres bloquent la serre à 100 % plutôt que la masquer** : réaliste comme
  *gameplay* (lisible, net), mais la vraie physique n'« éteint » pas le CO2, elle le
  *masque* temporairement derrière un refroidissement plus fort — nuance à avoir en tête si
  on retravaille ce point plus tard.
- **Pas de cycle jour/nuit ni de saisons** : la rotation influence le vent et l'écart
  pôle-équateur, mais une planète à rotation très lente (type Vénus, 243 jours) devrait
  aussi avoir un écart jour/nuit énorme, pas seulement pôle/équateur.
- **La végétation est un seul agrégat** terrestre+marin, sans distinction d'écosystèmes —
  suffisant pour la lisibilité actuelle, mais limite toute mission plus fine ("sauver
  juste les océans").

## Propositions (classées par effort)

**Petit** (quelques lignes, sim.js) :
- Lier `erosion` à l'albédo (actuellement un stub mort) — boucle #5.
- Ajouter 1-2 missions supplémentaires avec les mécaniques déjà en place (cendres
  éternelles, dette d'eau).
- Flag générique « boucle en emballement » basé sur le signe de la dérivée de `temp` sur
  les ~20 dernières années d'historique (déjà stocké).

**Moyen** (nouvelle variable d'état ou nouveau terme, cohérent avec le style existant) :
- Thermostat silicate-carbonate (boucle #1) — résout aussi le point mort "monde mort sans
  vie, CO2 bloqué pour toujours".
- Dégazage océanique par la chaleur (boucle #2).
- Albédo des nuages d'eau (boucle #3), à doser pour ne pas trop assécher les emballements
  existants.

**Plus gros** (nouvelle mécanique à part entière) :
- Dégel du pergélisol à seuil (boucle #4).
- Cycle jour/nuit distinct de l'écart pôle-équateur, pour les mondes à rotation très lente.
- Historique/replay visuel au-delà de la fenêtre de 600 ans du graphique actuel.
