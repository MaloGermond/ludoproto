# Forêt sombre, coopération et trahison — eco-dashboard

Document de game design, à donner à Claude Code pour adapter le dashboard.
Il décrit les mécaniques narratives et sociales, pas le code.

---

## 1. Vue d'ensemble : trois âges

| Âge | Objectif des joueurs | Tension centrale |
|---|---|---|
| **Early** | Atteindre l'espace le plus vite possible | Aller vite pollue : si la planète s'effondre, défaite collective |
| **Mid** | Poser des extracteurs sur les planètes proches | Aller trop vite ou trop loin déclenche la forêt sombre |
| **Late** | Construire une armada de vaisseaux puissants | Trois usages possibles : défense, conquête, exploration |

L'armada se choisit en fin de partie :
- **Défense** : contre les envahisseurs ou pour parer la forêt sombre.
- **Conquête** : contre les autres joueurs (fin Guerrière).
- **Exploration** : partir vers d'autres galaxies (fin Galactique).

Ces choix peuvent différer entre joueurs à la même table, ce qui nourrit la collaboration et la trahison.

---

## 2. Early game : la course et la pollution

- Chaque construction pollue. Plus on va vite, plus la santé de la planète baisse.
- Aucun frein artificiel : la vitesse est possible, mais le prix est collectif.
- Les 40 % de défaites collectives observés dans les sims sont plutôt un bon signe (la mécanique mord), à calibrer plutôt qu'à supprimer.

---

## 3. Mid game : la forêt sombre

### Déclenchement
- Comme dans le README : la menace n'apparaît qu'après le jalon « Première orbite ».
- Le déclencheur reste lié à la visibilité : plus on s'étend, plus on est repérable. L'idée du projet est qu'aller trop vite au mid-game attire la menace.

### Le projectile
- Un énorme bloc de **matière à interaction forte**, envoyé vers le Soleil pour le faire exploser.
- Il arrive **vite** (décompte en tours) et **ne peut presque pas être dévié** par des moyens classiques.
- Conséquence s'il touche : le Soleil explose et détruit les planètes proches. Dans le roman, la destruction va jusqu'à Jupiter. Pour le jeu : zones intérieures détruites (Terre, Orbite basse, Lune, Mars, Mercure, Ceinture), zones extérieures épargnées (planètes lointaines).

### La parade
- La seule vraie parade est de **dévier** le projectile en déformant l'espace-temps, donc de disposer de la technologie de distorsion (PRO-10), tout en haut de l'arbre.
- Elle reste **très difficile** volontairement : chance de base très faible par chercheur.
- Forçage de la coopération : personne ne peut la découvrir seul. Chaque joueur doit investir en laboratoires, outillages et chercheurs, et c'est l'effort cumulé de la table qui augmente les chances d'y arriver à temps.
- Pour ne pas rendre la distorsion inaccessible, il faudra vérifier par simulation que les chances collectives sont réalistes. Sinon, ajouter des technologies intermédiaires après PRO-10 ou revoir la hiérarchie de l'arbre (pistes évoquées par le joueur).

### Le dilemme du prisonnier
Chaque joueur choisit :
- **Coopérer** : tout miser sur la recherche collective et les chantiers communs.
- **Se replier** sur les planètes extérieures, épargnées, et jouer solo. C'est plus sûr pour lui, mais il abandonne les autres. Cela peut recréer du conflit, et c'est voulu.

---

## 4. Late game : les envahisseurs (à confirmer)

- Vers la fin de partie, des vaisseaux de différentes races extraterrestres arrivent pour annihiler ce qui est construit sur les planètes.
- Cela donne du sens à l'option « Défense » de l'armada et impose une pression de temps naturelle.
- **Question ouverte** : arrivent-ils dans tous les cas, ou seulement si la forêt sombre a déjà été déclenchée ?

---

## 5. Construction collaborative

- Certains bâtiments (chantier de déviation, armada, gros extracteurs) peuvent recevoir des contributions de plusieurs joueurs.
- Chaque contributeur apporte argent, matière ou rares au projet commun.
- Ouverture à la **trahison** : promettre sans contribuer, ou chercher à prendre le contrôle du projet fini.
- À décider : qui possède un bâtiment construit à plusieurs, et ce que chaque contributeur en retire (part de production, droit de vote, accès).

---

## 6. Coût de la construction et de la recherche

- **Construction** : coût du bâtiment plus coût logistique (envoi des fusées, ravitaillement, récupération). Le multiplicateur de distance existant représente déjà cette logistique.
- **Recherche** : coût de l'outillage (laboratoires, accélérateur de particules, etc.) plus coût des chercheurs.

### Les chercheurs
Objectif : éviter d'embaucher massivement puis de licencier.

- **Embauche coûteuse** au départ.
- **Expérience progressive** : un chercheur gagne de l'expérience à chaque tour passé sur la même recherche. Un premier palier dès 2 tours, un second vers 3 ou 4 tours, qui augmentent sa contribution à la chance de découverte. L'idée n'est pas d'en faire une « rockstar », mais de rendre son départ coûteux.
- **Licenciement coûteux** : renvoyer un chercheur expérimenté puis en réembaucher un novice doit coûter cher en temps et en argent.
- **Besoin croissant** : plus la technologie est avancée, plus il faut de chercheurs, ou plus ils sont chers.

Cohérence avec le README : l'actuel bonus d'ancienneté (+3 % tous les 5 tours, plafonné à +10 %) va déjà dans ce sens. Il faut le transformer en expérience par chercheur plutôt qu'en bonus global.

---

## 7. Troc de technologies

- Le troc entre factions existe déjà dans le README (licences de techno).
- Intention : quand les joueurs jouent en équipe et échangent leurs technologies, ils gèrent plus facilement écologie et forêt sombre.
- À décider : une licence donne-t-elle un accès immédiat à la technologie, ou seulement un bonus de recherche ?

---

## 8. Ce qui reste inchangé

- Le calcul de la chance de découverte : 1 - (1 - p)^N, plafonné à 95 %.
- Le camouflage galactique (COM-7 et OBS-8), qui neutralise la forêt sombre.
- Les fins existantes : Galactique, Économique, Guerrière, Narrative, Défaite collective.
- La durée de 400 tours.

---

## 9. Questions ouvertes

1. Les envahisseurs sont-ils systématiques ou liés à la forêt sombre ?
2. Comment calibrer la parade (PRO-10) pour qu'elle reste très rare mais atteignable en coopérant ?
3. Faut-il ajouter des technologies après PRO-10 ou réorganiser la hiérarchie de l'arbre ?
4. Qui déclenche la forêt sombre : le joueur le plus visible, ou le cumul de toute la table ?
5. La matière à interaction forte : simple menace, ou technologie que les joueurs peuvent eux-mêmes rechercher (comme la Goutte d'eau dans le roman) ?
6. Propriété et partage des bénéfices dans les constructions collaboratives.
7. Licences de technologie : accès immédiat ou bonus de recherche ?
