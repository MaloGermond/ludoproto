# Chaîne de matériaux et d'énergie — eco-dashboard

Document de game design, à donner à Claude Code pour adapter le dashboard.
Il ne décrit pas de code : il décrit ce que les ressources représentent, d'où elles viennent
et à quel moment de la partie elles comptent.

---

## 1. Principe : trois âges d'exploitation

| Âge | Où on exploite | Énergie / carburant | Construction | Risque principal |
|---|---|---|---|---|
| **Early** | Terre uniquement | Ergols chimiques (hydrocarbures raffinés) | Tout est fabriqué au sol et lancé | Pollution : la planète s'effondre si on va trop vite |
| **Mid** | Espace proche : Orbite basse, Lune, Mars, Mercure | Ergols issus de la glace d'eau, puis fission nucléaire | Assemblage en orbite et sur place avec des matériaux locaux | Forêt sombre : trop d'expansion visible attire la menace |
| **Late** | Géantes gazeuses, comètes, planètes extérieures | Fusion (hélium-3) | Chantiers orbitaux géants, armada | Envahisseurs, tensions entre joueurs |

Idée directrice : chaque âge a sa ressource clé, et passer à l'âge suivant oblige à aller chercher plus loin, donc plus cher et plus risqué.

---

## 2. Matériaux bruts et où les trouver

### Terre (early game)
| Matériau brut | Raffiné en | Usage dans le jeu |
|---|---|---|
| Pétrole | Kérosène, ergols hydrocarbures | Premières fusées |
| Bauxite | Aluminium | Réservoirs, structures légères |
| Minerai de fer | Acier | Structures, bâtiments |
| Rutile / ilménite | Titane et alliages | Structures haute résistance |
| Sable de silice | Silicium | Électronique, ordinateurs de bord, panneaux solaires |
| Cuivre, terres rares | Câblage, aimants, capteurs | Communications, guidage |
| Carbone (charbon, pétrole, CO2, carbonates) | Fibres, composites, plus tard graphène et nanotubes | Voir section 5 |
| Uranium | Combustible de fission | Réacteurs (voir section 4) |

### Lune
| Matériau | Détail | Usage |
|---|---|---|
| Glace d'eau (cratères polaires à l'ombre) | Eau, puis hydrogène et oxygène | Ergols produits sur place, support de vie |
| Régolithe | Riche en silicium, aluminium, fer, titane, et en oxygène (lié aux oxydes) | Matériaux de construction locaux |
| Hélium-3 (traces) | Déposé par le vent solaire, très dilué | Fusion, mais peu rentable au début |

### Mars
| Matériau | Détail | Usage |
|---|---|---|
| Fer, nickel, aluminium | Croûte et surface | Construction locale |
| Glace d'eau (pôles, sous-sol) | | Ergols, support de vie |
| CO2 atmosphérique | Avec de l'hydrogène, permet de produire du méthane et de l'oxygène | Ergols produits sur place (procédé de Sabatier) |

### Mercure
| Matériau | Détail | Usage |
|---|---|---|
| Fer et métaux lourds | Noyau métallique énorme par rapport à sa taille | Construction, structures massives |
| Glace d'eau (cratères polaires à l'ombre) | Détectée par sonde | Ergols |
| Énergie solaire très intense | | Production d'énergie |

### Ceinture d'astéroïdes
| Matériau | Détail | Usage |
|---|---|---|
| Fer, nickel, cobalt | Astéroïdes métalliques | Construction |
| Platinoïdes (platine, etc.) | Astéroïdes métalliques | Équipements avancés, catalyseurs |
| Eau et carbone | Astéroïdes carbonés | Ergols, support de vie, matière première pour nanomatériaux |

### Géantes gazeuses et planètes extérieures
| Matériau | Détail | Usage |
|---|---|---|
| Hydrogène, hélium | Massifs | Carburant avancé |
| Hélium-3 | Bien plus concentré que sur la Lune, récolté dans l'atmosphère | Fusion (late game) |
| Deutérium | En petite quantité | Fusion |

Difficulté réaliste à garder : plus une planète est massive, plus il est coûteux de remonter ce qu'on y récolte. Saturne et Uranus sont généralement jugées plus abordables que Jupiter pour cette raison.

### Comètes
| Matériau | Usage |
|---|---|
| Glace d'eau et composés volatils | Ergols, eau, support de vie loin du Soleil |

---

## 3. Ergols : la chaîne de carburant

1. **Early** : hydrocarbures raffinés depuis le pétrole terrestre. Coûteux en pollution.
2. **Mid** : ergols produits à partir de la **glace d'eau** (Lune, Mars, Mercure) : électrolyse en hydrogène et oxygène, ou méthane sur Mars. Moins de dépendance à la Terre, mais il faut ravitailler : c'est un point de tension à garder (les stations de ravitaillement deviennent stratégiques).
3. **Late** : fusion (hélium-3 et deutérium). Énergie quasi illimitée, mais l'hélium-3 vient de loin.

---

## 4. Énergie nucléaire

Point de réalisme à respecter :

- **Fission** : le combustible (uranium) existe sur Terre, donc ce qui bloque n'est pas le combustible mais le **coût de lancement** d'un réacteur lourd et de son blindage. Argument de jeu : lancer un réacteur depuis la Terre est possible mais très cher. On y gagne à le construire en orbite ou sur place avec des métaux locaux.
- **Fusion** : nécessite de l'hélium-3 (et du deutérium). Volontairement repoussée au late game, comme tu le souhaites.

---

## 5. Construction : sur Terre, puis dans l'espace

Règle proposée : le coût d'une structure = coût de fabrication + coût de lancement (déjà représenté par le multiplicateur de distance ×1 à ×3).

- **Structures légères** (satellites, sondes, capsules) : fabriquées au sol et lancées, dès l'early.
- **Structures lourdes** (réacteurs, stations, chantiers) : le coût de lancement devient prohibitif. Solution : avec la technologie de construction en orbite, on les assemble sur place avec des métaux extraits localement (Lune, Mars, Mercure, astéroïdes).
- **Conséquence** : l'extraction locale alimente la construction locale, sans repasser par la Terre. C'est ce qui justifie d'aller chercher des métaux dans l'espace proche au mid-game.

---

## 6. Matériaux avancés : le carbone

Constat réaliste : le carbone est présent partout (Terre, astéroïdes carbonés, comètes), donc il n'a pas besoin d'un territoire minier lointain.

Chaîne proposée :

1. Carbone brut
2. Fibres de carbone et composites (early/mid)
3. Graphène et nanotubes de carbone (mid/late). Ce sont des matériaux réels : leur résistance théorique est de l'ordre de 50 fois celle de l'acier pour un poids environ six fois moindre, et ils sont sérieusement envisagés pour le câble d'un ascenseur spatial. La maîtrise industrielle à grande échelle reste à conquérir.
4. Nanotubes de nitrure de bore, variante complémentaire, notamment pour la tenue à la chaleur (optionnel)
5. **Matière à interaction forte** : purement fictionnelle (issue du roman), sans base physique réelle. À assumer comme de la science-fiction dans le jeu.

### Twist de fin de partie (idée à valider)
Une fois la maîtrise des matériaux à base de carbone acquise (et, au sommet, l'interaction forte), l'accès aux mines lointaines devient moins déterminant : on peut fabriquer l'essentiel avec du carbone disponible partout. Effet voulu : les joueurs qui ont dominé le mid-game en contrôlant des territoires miniers perdent une partie de leur avantage, ce qui relance la compétition en fin de partie.

À nuancer : les nanomatériaux exigent aussi de l'énergie et de la technologie, donc la fusion garde un rôle.

---

## 7. Correspondance avec le dashboard actuel

Le README actuel définit 5 zones (Orbite basse, Lune, Ceinture, Géante gazeuse, Comète) et 5 rares (Pierre lunaire, Hélium-3, Cristaux, Glace, Ergols). Écarts à traiter :

- **Mars et Mercure** ne sont pas des zones aujourd'hui. Soit on les ajoute, soit on les fusionne avec des zones existantes.
- **Le fer, l'aluminium, le titane, le carbone** sont des matières premières. La mécanique « matière » actuelle est à repenser selon ce que le joueur a remarqué (les matières ne semblent pas fonctionner).
- **Cristaux** : ressource sans équivalent clair dans ce document. À redéfinir ou à mapper (par exemple silicium de haute pureté ou minéraux spécialisés).
- **Hélium-3** : actuellement une rare. Dans ce document, il devient la ressource pivot du late game sur les géantes gazeuses.

---

## 8. Points à trancher

1. Ajouter Mars et Mercure comme zones distinctes, ou les regrouper ?
2. Quelles matières brutes sont modélisées dans le jeu (fer, aluminium, titane, carbone) et lesquelles restent implicites ?
3. La fission débloque-t-elle vraiment un avantage économique (moins de coût d'ergols), ou surtout des constructions ?
4. Le twist du carbone : combien il réduit exactement l'intérêt des mines lointaines (partiel ou total) ?
5. Les stations de ravitaillement sont-elles des bâtiments à part entière ?
