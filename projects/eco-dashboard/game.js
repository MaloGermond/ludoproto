// POC mécaniques socio-économiques — issue #12
// Modèle de jeu pur (aucun DOM) : ressources, recherche, infrastructures,
// marché, troc, prêts, parts d'entreprise, conflit opportuniste, projets
// collaboratifs, forêt sombre, envahisseurs et conditions de fin.
// Les chiffres sont volontairement approximatifs (cf. CONFIG).
//
// Game design de référence : docs/materiaux-chaine.md (chaîne de matériaux
// et d'énergie, trois âges) et docs/foret-sombre-cooperation.md (forêt
// sombre, coopération, trahison, chercheurs).

(function (root) {
  // la "matière" du jeu représente les métaux de construction (fer,
  // aluminium, titane, laissés implicites) ; le régolithe lunaire en fait
  // partie : c'est un matériau de construction local, extrait par les mines
  // de la Lune, pas une ressource rare. Le carbone n'est pas une
  // ressource : il est partout, sa maîtrise passe par les technologies
  // (STR-4 composites → STR-8 nanomatériaux → STR-9 interaction forte).
  const RARES = {
    he3: "Hélium-3", // pivot du late game (fusion), récolté sur les géantes gazeuses
    cristal: "Platinoïdes", // astéroïdes métalliques : équipements avancés, catalyseurs, électronique
    glace: "Glace d'eau", // ergols du mid game, support de vie
    ergols: "Ergols", // carburant : hydrocarbures (Terre, polluant) puis glace (espace)
  };
  const MATERIAL = "Métaux";

  // pas de position réelle : une zone n'est qu'un "lieu" où les
  // infrastructures de joueurs différents peuvent se gêner.
  // tier = éloignement (renchérit la construction, ×1 sur Terre à ×3 sur la
  // Comète) ; reachTech = technologie minimale pour y construire (les
  // planètes extérieures s'atteignent par la propulsion, pour que le repli
  // face à la forêt sombre reste une option au mid game) ;
  // yield = ce qu'un extracteur y récolte par tour ; metals = rendement d'une
  // mine (0 = pas de métaux exploitables) ; inner = zone détruite si le
  // Soleil explose (projectile de la forêt sombre).
  const ZONES = [
    { id: "terre", name: "Terre", tier: 0, inner: true, safe: true, reachTech: null, yield: {}, metals: 1 },
    { id: "orbite", name: "Orbite basse", tier: 1, inner: true, reachTech: "CON-1", yield: {}, metals: 0 },
    { id: "lune", name: "Lune", tier: 2, inner: true, reachTech: "EXT-3", yield: { glace: 1 }, metals: 1.5 }, // régolithe : silicium, aluminium, titane
    { id: "mars", name: "Mars", tier: 3, inner: true, reachTech: "EXT-5", yield: { glace: 2 }, metals: 1, sabatier: true },
    { id: "mercure", name: "Mercure", tier: 3, inner: true, reachTech: "EXT-5", yield: { glace: 1 }, metals: 2 },
    { id: "ceinture", name: "Ceinture d'astéroïdes", tier: 4, inner: true, reachTech: "EXT-6", yield: { cristal: 2, glace: 1 }, metals: 1.5 },
    { id: "geante", name: "Géante gazeuse", tier: 5, inner: false, reachTech: "PRO-5", yield: { he3: 2 }, metals: 0 },
    { id: "comete", name: "Comète", tier: 6, inner: false, reachTech: "PRO-6", yield: { glace: 3 }, metals: 0 },
  ];

  const CONFIG = {
    maxTurns: 400, // 100 ans à 4 tours (saisons) par an
    startMoney: 80,
    startMaterial: 30,
    maintenance: 2, // argent / infrastructure / tour (hors base)
    shares: 100,
    dividendRate: 0.2, // part de l'argent produit reversée aux actionnaires
    incidentBase: 0.05, // risque par tour d'abîmer un voisin, placement prudent
    incidentAggressive: 0.2, // risque par tour d'abîmer un voisin, placement agressif
    planetHealth: 100,
    pollutionRegen: 12, // la planète encaisse ~12 de pollution par tour sans se dégrader
    launchPollution: 0.5, // pollution ponctuelle par niveau d'éloignement, pour chaque construction lancée depuis la Terre
    distanceCost: 1 / 3, // +33 % de coût par niveau d'éloignement (×3 sur la Comète)
    heavyLaunchMult: 3, // une structure lourde lancée depuis la Terre coûte 3 fois plus cher
    defaultFuelFee: 4, // ₵ par unité d'ergols facturés par une station de ravitaillement
    // recherche : outillage (payé une fois par techno) + chercheurs (salaire)
    toolingRate: 0.25, // outillage = coût de la techno × taux, en argent
    toolingMetalRate: 0.25, // … et en métaux (bancs d'essai, accélérateurs)
    hireCost: 20, // embauche d'un chercheur
    salary: 3, // salaire par chercheur et par tour, affecté ou non
    severance: 10, // indemnité de licenciement × (1 + palier d'expérience)
    labCapacity: 4, // chercheurs accueillis par laboratoire
    xpLevels: [2, 4], // tours de travail continu sur la même techno pour passer les paliers
    xpMult: [1, 1.3, 1.6], // contribution d'un chercheur selon son palier
    researchMaxChance: 0.95, // plafond de chance de découverte par tour
    licenceMode: "access", // "access" : une licence donne la techno ; "bonus" : outillage offert et chercheurs ×2 sur cette techno
    carbonDiscount: { "STR-8": 0.5, "STR-9": 1 }, // part des équipements en métaux et platinoïdes épargnée par la maîtrise du carbone
    // forêt sombre
    darkForestTrigger: "orbit", // jalon (cf. MILESTONES) qui rend l'humanité visible
    darkForestPerVis: 0.0005, // risque de lancement d'un projectile par tour, par point de visibilité cumulée de la table
    darkForestMax: 0.1,
    projectileTurns: 32, // délai avant impact (8 ans)
    projectileCooldown: 40, // tours de répit après une déviation
    distorsionBoost: 4, // chercheurs équivalents apportés par un chantier de distorsion
    // envahisseurs (late game, seulement si la forêt sombre a été déclenchée)
    invaderEvery: 16,
    invaderBase: 10,
    invaderGrowth: 6,
    armadaStrength: 12,
    defaultRarePrice: 5,
    defaultMaterialPrice: 2,
    bankruptTurns: 2, // tours consécutifs en négatif avant la faillite
    buyoutMajority: 51,
    offerTTL: 2, // tours avant qu'une offre non traitée expire
  };

  // heavy : structure lourde, très chère à lancer depuis la Terre ; on la
  // construit à prix normal "sur place" avec CON-9 et une mine dans la zone.
  // where : "terre" (au sol seulement), "espace" (hors Terre), sinon partout.
  const INFRA = {
    base: { name: "Base terrestre", cost: {}, hp: 3, prod: { money: 16, material: 5 }, pollution: 0.5, visibility: 2, buildable: false },
    mine: { name: "Mine", cost: { money: 10, material: 10 }, hp: 2, prod: { material: 6 }, pollution: 1, visibility: 1, desc: "Métaux (rendement selon la zone). Pollue seulement sur Terre." },
    comptoir: { name: "Comptoir", cost: { money: 15, material: 15 }, hp: 2, prod: { money: 8 }, pollution: 0.3, visibility: 2 },
    labo: { name: "Laboratoire", cost: { money: 20, material: 15 }, hp: 2, prod: { money: 6 }, pollution: 0.3, visibility: 1, desc: "Accueille des chercheurs (cf. CONFIG.labCapacity)" },
    raffinerie: { name: "Raffinerie d'hydrocarbures", cost: { money: 15, material: 15 }, hp: 2, prod: { ergols: 2 }, pollution: 2.5, visibility: 1, tech: "PRO-2", where: "terre", desc: "Ergols chimiques depuis le pétrole : early game, très polluant" },
    electrolyse: { name: "Usine d'ergols (glace)", cost: { money: 20, material: 20 }, hp: 2, prod: { ergols: 3 }, upkeep: { glace: 1 }, pollution: 0, visibility: 1, tech: "PRO-3", where: "espace", desc: "Électrolyse de la glace (sur Mars : procédé de Sabatier, sans glace)" },
    extracteur: { name: "Extracteur", cost: { money: 15, material: 20 }, hp: 2, prod: { zoneYield: 1 }, pollution: 0, visibility: 2, tech: "EXT-6", where: "espace", desc: "Récolte les ressources rares de la zone" },
    station: { name: "Station de ravitaillement", cost: { money: 30, material: 30 }, hp: 2, prod: {}, pollution: 0, visibility: 2, tech: "CON-5", where: "espace", desc: "Vous construisez dans cette zone sans ergols ; les autres vous paient un droit de ravitaillement" },
    fission: { name: "Réacteur à fission", cost: { money: 40, material: 40 }, hp: 2, prod: { money: 18 }, pollution: 0.5, visibility: 2, tech: "PRO-5", heavy: true, desc: "Uranium terrestre : le frein est le coût de lancement" },
    reacteur: { name: "Réacteur à fusion", cost: { money: 60, material: 60 }, hp: 2, prod: { money: 40, material: 8 }, upkeep: { he3: 1 }, pollution: 0, visibility: 3, tech: "PRO-8", heavy: true, where: "espace" },
    chantier: { name: "Chantier orbital", cost: { money: 80, material: 80 }, hp: 3, prod: {}, pollution: 0, visibility: 3, tech: "CON-6", heavy: true, where: "espace", desc: "Permet de lancer une armada" },
  };

  // projets collaboratifs : n'importe qui y contribue (argent, métaux,
  // rares) ; les promesses sont visibles mais n'engagent à rien. Une fois
  // financé, le projet appartient à ses contributeurs au prorata de leur
  // apport, et le plus gros contributeur le contrôle.
  const PROJECTS = {
    armada: {
      name: "Armada",
      cost: { money: 400, material: 300, rares: { he3: 4, ergols: 10 } },
      needsInfra: "chantier",
      desc: "Flotte de fin de partie. Mode défense (envahisseurs, forêt sombre), conquête (attaquer un joueur) ou exploration (avec PRO-10 : départ vers d'autres galaxies).",
    },
    distorsion: {
      name: "Chantier de distorsion",
      cost: { money: 600, material: 500, rares: { ergols: 10, cristal: 3 } },
      needsAnyTech: ["PRO-7", "OBS-5", "REC-7"],
      desc: "Outillage commun de la distorsion (PRO-10) : sans lui, la recherche collective ne peut pas aboutir. Ses contributeurs comptent dans le savoir réuni par la table.",
    },
    megaextracteur: {
      name: "Méga-extracteur",
      cost: { money: 250, material: 250, rares: { ergols: 8 } },
      needsTech: "EXT-6",
      zone: true,
      desc: "Récolte 4 fois le rendement de la zone, partagé entre les contributeurs.",
    },
  };

  // Arbre technologique — programme spatial. Coût de recherche =
  // outillage (cost × CONFIG.toolingRate, payé une fois, au premier
  // engagement) + salaire des chercheurs (CONFIG.salary / tour / chercheur).
  // `chance` = probabilité de découverte par chercheur (novice) et par tour :
  // avec N chercheurs (pondérés par leur expérience), 1 - (1 - chance)^N,
  // plafonnée à 95 %. `rare` = équipement spécialisé consommé à l'engagement.
  // `metals` = équipement en métaux, payé avec l'outillage.
  // `pooled` = recherche collective : les chercheurs de toute la table
  // s'additionnent (cf. research()).
  const TECH_CATEGORIES = {
    pro: "Propulsion",
    str: "Structure et carburant",
    gui: "Guidage et contrôle",
    com: "Communications radio",
    sup: "Support de vie",
    ent: "Entraînement",
    rec: "Recherche scientifique",
    ext: "Extraction de ressources",
    con: "Construction spatiale",
    obs: "Observation et détection",
  };

  const TECHS = {
    // Propulsion
    "PRO-1": { name: "Fusée à poudre", category: "pro", prereqs: [], cost: 10, chance: 0.2 },
    "PRO-2": { name: "Moteur à ergols liquides", category: "pro", prereqs: ["PRO-1"], cost: 30, chance: 0.12, desc: "Débloque la raffinerie d'hydrocarbures (ergols chimiques, polluants)" },
    "PRO-3": { name: "Moteur cryogénique", category: "pro", prereqs: ["PRO-2", "STR-3"], cost: 80, chance: 0.08, desc: "Débloque l'usine d'ergols à partir de glace (espace)" },
    "PRO-4": { name: "Moteur ionique", category: "pro", prereqs: ["PRO-3", "REC-3"], cost: 200, chance: 0.05 },
    "PRO-5": { name: "Propulsion nucléaire thermique", category: "pro", prereqs: ["PRO-3", "REC-4"], cost: 400, chance: 0.04, rare: {ergols: 2}, desc: "Débloque le réacteur à fission (structure lourde)" },
    "PRO-6": { name: "Moteur à plasma", category: "pro", prereqs: ["PRO-4"], cost: 600, chance: 0.03 },
    "PRO-7": { name: "Moteur à fission avancée", category: "pro", prereqs: ["PRO-5", "STR-7"], cost: 1000, chance: 0.02 },
    "PRO-8": { name: "Moteur à fusion", category: "pro", prereqs: ["PRO-6", "PRO-7", "REC-7"], cost: 2500, chance: 0.015, rare: {ergols: 3,he3: 2}, desc: "Débloque le réacteur à fusion (hélium-3) — ouvre le late game" },
    "PRO-9": { name: "Moteur à antimatière", category: "pro", prereqs: ["PRO-8", "REC-8"], cost: 6000, chance: 0.01 },
    "PRO-10": { name: "Moteur à distorsion", category: "pro", prereqs: ["PRO-7", "OBS-5", "REC-7"], cost: 15000, chance: 0.005, pooled: true, desc: "Recherche collective, seule parade au projectile : les chercheurs de toute la table s'additionnent. Il suffit de détenir un prérequis pour participer, mais la table doit les réunir tous et avoir achevé un chantier de distorsion (outillage commun)." },
    // Structure et carburant
    "STR-1": { name: "Corps de fusée en tôle", category: "str", prereqs: [], cost: 10, chance: 0.2 },
    "STR-2": { name: "Réservoirs pressurisés en aluminium", category: "str", prereqs: ["STR-1"], cost: 25, chance: 0.14 },
    "STR-3": { name: "Étagement", category: "str", prereqs: ["STR-2", "PRO-2"], cost: 60, chance: 0.09 },
    "STR-4": { name: "Composites (fibres de carbone)", category: "str", prereqs: ["STR-2", "REC-2"], cost: 120, chance: 0.07, metals: 20 },
    "STR-5": { name: "Réservoirs cryogéniques isolés", category: "str", prereqs: ["STR-4"], cost: 200, chance: 0.05 },
    "STR-6": { name: "Blindage anti-radiations", category: "str", prereqs: ["STR-4"], cost: 300, chance: 0.04 },
    "STR-7": { name: "Alliages haute résistance", category: "str", prereqs: ["STR-4", "REC-2"], cost: 500, chance: 0.03, metals: 50 },
    "STR-8": { name: "Nanomatériaux (graphène, nanotubes)", category: "str", prereqs: ["STR-7", "REC-5"], cost: 2000, chance: 0.015, metals: 100, rare: {cristal: 2}, desc: "Carbone disponible partout : -50 % sur les équipements en métaux et platinoïdes" },
    "STR-9": { name: "Matière à interaction forte", category: "str", prereqs: ["STR-8", "REC-9"], cost: 12000, chance: 0.004, rare: {he3: 3}, desc: "Science-fiction assumée : plus besoin d'équipements en métaux ni en platinoïdes ; armadas 50 % plus fortes" },
    // Guidage et contrôle
    "GUI-1": { name: "Trajectoire préprogrammée", category: "gui", prereqs: [], cost: 10, chance: 0.2 },
    "GUI-2": { name: "Gyroscopes et stabilisation", category: "gui", prereqs: ["GUI-1"], cost: 30, chance: 0.12 },
    "GUI-3": { name: "Mémoire étendue", category: "gui", prereqs: ["GUI-1"], cost: 50, chance: 0.1 },
    "GUI-4": { name: "Ordinateur de bord", category: "gui", prereqs: ["GUI-3", "REC-1"], cost: 120, chance: 0.07 },
    "GUI-5": { name: "Guidage inertiel de précision", category: "gui", prereqs: ["GUI-2", "GUI-4"], cost: 250, chance: 0.05, rare: {cristal: 1} },
    "GUI-6": { name: "Télécommande", category: "gui", prereqs: ["GUI-4", "COM-2"], cost: 350, chance: 0.04 },
    "GUI-7": { name: "Pilotage à distance en temps réel", category: "gui", prereqs: ["GUI-6", "COM-3"], cost: 600, chance: 0.03 },
    "GUI-8": { name: "Pilote automatique intelligent", category: "gui", prereqs: ["GUI-5", "REC-5"], cost: 1200, chance: 0.02, rare: {cristal: 2} },
    "GUI-9": { name: "Navigation interplanétaire autonome", category: "gui", prereqs: ["GUI-7", "GUI-8", "COM-5"], cost: 2500, chance: 0.015, rare: {cristal: 3} },
    // Communications radio
    "COM-1": { name: "Radio basique", category: "com", prereqs: [], cost: 15, chance: 0.18 },
    "COM-2": { name: "Émetteur longue portée", category: "com", prereqs: ["COM-1"], cost: 50, chance: 0.1 },
    "COM-3": { name: "Réseau de stations au sol", category: "com", prereqs: ["COM-2"], cost: 150, chance: 0.07, rare: {cristal: 1} },
    "COM-4": { name: "Satellites relais", category: "com", prereqs: ["COM-3", "CON-4"], cost: 300, chance: 0.05 },
    "COM-5": { name: "Réseau d'espace lointain", category: "com", prereqs: ["COM-4", "REC-3"], cost: 800, chance: 0.03 },
    "COM-6": { name: "Communication laser", category: "com", prereqs: ["COM-5", "REC-5"], cost: 1500, chance: 0.02, rare: {cristal: 2} },
    "COM-7": { name: "Communication quantique", category: "com", prereqs: ["COM-6", "REC-8"], cost: 5000, chance: 0.008, rare: {cristal: 4} },
    // Support de vie
    "SUP-1": { name: "Capsule pressurisée", category: "sup", prereqs: ["STR-2"], cost: 40, chance: 0.12 },
    "SUP-2": { name: "Réserves d'oxygène", category: "sup", prereqs: ["SUP-1"], cost: 60, chance: 0.1 },
    "SUP-3": { name: "Recyclage du CO2", category: "sup", prereqs: ["SUP-2", "REC-2"], cost: 150, chance: 0.07 },
    "SUP-4": { name: "Recyclage de l'eau et de la nourriture", category: "sup", prereqs: ["SUP-3"], cost: 300, chance: 0.05 },
    "SUP-5": { name: "Protection contre les radiations", category: "sup", prereqs: ["SUP-4", "STR-6"], cost: 500, chance: 0.04 },
    "SUP-6": { name: "Gravité artificielle", category: "sup", prereqs: ["SUP-4", "CON-6"], cost: 900, chance: 0.03, rare: {glace: 2} },
    "SUP-7": { name: "Biosphère fermée", category: "sup", prereqs: ["SUP-5", "SUP-6"], cost: 2000, chance: 0.015 },
    "SUP-8": { name: "Hibernation des équipages", category: "sup", prereqs: ["SUP-7", "REC-8"], cost: 4000, chance: 0.01, rare: {glace: 4} },
    // Entraînement
    "ENT-1": { name: "Centre d'entraînement de base", category: "ent", prereqs: [], cost: 30, chance: 0.15 },
    "ENT-2": { name: "Centrifugeuse", category: "ent", prereqs: ["ENT-1"], cost: 80, chance: 0.09 },
    "ENT-3": { name: "Simulateurs de vol", category: "ent", prereqs: ["ENT-1", "GUI-4"], cost: 150, chance: 0.07 },
    "ENT-4": { name: "Bassin d'apesanteur simulée", category: "ent", prereqs: ["ENT-2", "SUP-1"], cost: 250, chance: 0.05 },
    "ENT-5": { name: "Entraînement aux longues missions", category: "ent", prereqs: ["ENT-3", "SUP-4"], cost: 500, chance: 0.04, rare: {glace: 1} },
    "ENT-6": { name: "Sélection d'élite", category: "ent", prereqs: ["ENT-5"], cost: 800, chance: 0.03 },
    "ENT-7": { name: "Simulation en réalité virtuelle", category: "ent", prereqs: ["ENT-6", "REC-5"], cost: 1500, chance: 0.02 },
    // Recherche scientifique
    "REC-1": { name: "Laboratoire de base", category: "rec", prereqs: [], cost: 20, chance: 0.18 },
    "REC-2": { name: "Laboratoire des matériaux", category: "rec", prereqs: ["REC-1"], cost: 60, chance: 0.1 },
    "REC-3": { name: "Laboratoire d'énergie", category: "rec", prereqs: ["REC-1"], cost: 80, chance: 0.09 },
    "REC-4": { name: "Centre de physique nucléaire", category: "rec", prereqs: ["REC-3"], cost: 250, chance: 0.05 },
    "REC-5": { name: "Supercalculateur", category: "rec", prereqs: ["REC-2", "REC-3"], cost: 400, chance: 0.04 },
    "REC-6": { name: "Laboratoire orbital", category: "rec", prereqs: ["REC-5", "CON-6"], cost: 800, chance: 0.03, rare: {cristal: 2} },
    "REC-7": { name: "Institut de physique des plasmas", category: "rec", prereqs: ["REC-4", "REC-5"], cost: 1200, chance: 0.02 },
    "REC-8": { name: "Institut d'antimatière et de physique quantique", category: "rec", prereqs: ["REC-7", "REC-6"], cost: 3500, chance: 0.01, rare: {cristal: 4} },
    "REC-9": { name: "Institut de physique fondamentale", category: "rec", prereqs: ["REC-8"], cost: 8000, chance: 0.007 },
    // Extraction de ressources
    "EXT-1": { name: "Capsule de retour d'échantillons", category: "ext", prereqs: ["STR-2", "GUI-2"], cost: 80, chance: 0.09 },
    "EXT-2": { name: "Bouclier thermique de rentrée", category: "ext", prereqs: ["EXT-1", "REC-2"], cost: 150, chance: 0.07 },
    "EXT-3": { name: "Sonde d'atterrissage", category: "ext", prereqs: ["EXT-2", "GUI-6"], cost: 300, chance: 0.05 },
    "EXT-4": { name: "Foreuse robotique", category: "ext", prereqs: ["EXT-3"], cost: 450, chance: 0.04 },
    "EXT-5": { name: "Cargo de retour de ressources", category: "ext", prereqs: ["EXT-4", "PRO-3"], cost: 700, chance: 0.03 },
    "EXT-6": { name: "Exploitation minière spatiale", category: "ext", prereqs: ["EXT-5"], cost: 1000, chance: 0.025, desc: "Débloque l'extracteur (ressource rare de la zone)" },
    "EXT-7": { name: "Exploitation d'astéroïdes", category: "ext", prereqs: ["EXT-6", "GUI-9"], cost: 2000, chance: 0.015 },
    "EXT-8": { name: "Raffinage sur place", category: "ext", prereqs: ["EXT-7", "CON-9"], cost: 3500, chance: 0.01 },
    "EXT-9": { name: "Catapulte électromagnétique planétaire", category: "ext", prereqs: ["EXT-8", "PRO-8"], cost: 7000, chance: 0.007 },
    // Construction spatiale et satellites
    "CON-1": { name: "Satellite basique", category: "con", prereqs: ["PRO-3", "GUI-4"], cost: 150, chance: 0.07 },
    "CON-2": { name: "Panneaux solaires", category: "con", prereqs: ["CON-1", "REC-3"], cost: 200, chance: 0.06 },
    "CON-3": { name: "Satellite de communication", category: "con", prereqs: ["CON-2", "COM-3"], cost: 300, chance: 0.05 },
    "CON-4": { name: "Satellite relais", category: "con", prereqs: ["CON-3"], cost: 400, chance: 0.04 },
    "CON-5": { name: "Amarrage en orbite", category: "con", prereqs: ["CON-2", "GUI-5"], cost: 500, chance: 0.04, desc: "Débloque la station de ravitaillement" },
    "CON-6": { name: "Station spatiale", category: "con", prereqs: ["CON-5", "SUP-4"], cost: 900, chance: 0.03, metals: 40, desc: "Débloque le chantier orbital (armadas)" },
    "CON-7": { name: "Bras robotique orbital", category: "con", prereqs: ["CON-6", "GUI-8"], cost: 1200, chance: 0.02 },
    "CON-8": { name: "Constellations de satellites", category: "con", prereqs: ["CON-4", "CON-7"], cost: 1500, chance: 0.02 },
    "CON-9": { name: "Impression 3D en orbite", category: "con", prereqs: ["CON-7", "STR-7"], cost: 2000, chance: 0.015, metals: 60, desc: "Construction sur place : une structure lourde ne coûte plus ×3 dans une zone où vous avez une mine" },
    "CON-10": { name: "Chantier orbital et usine spatiale", category: "con", prereqs: ["CON-9", "EXT-6"], cost: 4000, chance: 0.01 },
    "CON-11": { name: "Ascenseur spatial", category: "con", prereqs: ["CON-10", "STR-8"], cost: 10000, chance: 0.005, metals: 150, rare: {cristal: 3} },
    // Observation et détection
    "OBS-1": { name: "Télescope au sol", category: "obs", prereqs: [], cost: 20, chance: 0.15 },
    "OBS-2": { name: "Analyse de sol depuis le sol", category: "obs", prereqs: ["OBS-1", "REC-2"], cost: 80, chance: 0.09 },
    "OBS-3": { name: "Alerte et suivi des astéroïdes", category: "obs", prereqs: ["OBS-1", "COM-3"], cost: 200, chance: 0.06 },
    "OBS-4": { name: "Satellite d'observation", category: "obs", prereqs: ["CON-1", "OBS-1"], cost: 300, chance: 0.05, rare: {cristal: 1} },
    "OBS-5": { name: "Télescope orbital", category: "obs", prereqs: ["OBS-4", "REC-5"], cost: 800, chance: 0.03 },
    "OBS-6": { name: "Analyse des sols depuis l'orbite", category: "obs", prereqs: ["OBS-4", "OBS-2"], cost: 600, chance: 0.04 },
    "OBS-7": { name: "Détection d'exoplanètes", category: "obs", prereqs: ["OBS-5"], cost: 1500, chance: 0.02 },
    "OBS-8": { name: "Réseau de télescopes géants", category: "obs", prereqs: ["OBS-7", "CON-8"], cost: 4000, chance: 0.01, rare: {cristal: 2} },
  };

  // jalons narratifs : journalisés une fois atteints ; "orbit" déclenche la
  // forêt sombre et le mid game, "cloak" la neutralise.
  const MILESTONES = [
    { id: "liftoff", name: "Première fusée qui décolle", need: ["PRO-1"] },
    { id: "altitude", name: "Record d'altitude", need: ["PRO-2", "STR-2", "GUI-2"] },
    { id: "orbit", name: "Première orbite", need: ["PRO-3", "STR-3", "GUI-4"] },
    { id: "satellite", name: "Premier satellite", need: ["PRO-3", "STR-3", "GUI-4", "CON-4"] },
    { id: "human", name: "Premier humain en orbite", need: ["PRO-3", "STR-3", "GUI-4", "SUP-1", "SUP-2", "ENT-1"] },
    { id: "samples", name: "Retour d'échantillons d'un autre astre", need: ["EXT-1", "EXT-2", "COM-5"] },
    { id: "station", name: "Première station spatiale", need: ["CON-6", "SUP-4"] },
    { id: "elevator", name: "Ascenseur spatial", need: ["CON-11"] },
    { id: "cloak", name: "Camouflage galactique", need: ["COM-7", "OBS-8"] },
  ];

  // trois âges : early (atteindre l'espace, la pollution menace), mid
  // (planètes proches, la forêt sombre guette), late (fusion, planètes
  // extérieures, armadas, envahisseurs)
  const AGES = {
    early: { name: "Early — la course à l'espace", risk: "pollution" },
    mid: { name: "Mid — l'espace proche", risk: "forêt sombre" },
    late: { name: "Late — fusion et armadas", risk: "envahisseurs et tensions" },
  };

  const NAMES = ["Aurora", "Borealis", "Cygnus", "Draco", "Eridan"];
  const ACTIVE = ["actif", "faillite"];

  // ---------------------------------------------------------------- utils

  function rand(s) {
    // mulberry32 : parties reproductibles à partir d'une graine
    s.rng = (s.rng + 0x6d2b79f5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const ok = (msg) => ({ ok: true, msg });
  const fail = (msg) => ({ ok: false, msg });
  const zone = (id) => ZONES.find((z) => z.id === id);
  const player = (s, id) => s.players[id];
  const isActive = (p) => p && ACTIVE.includes(p.status);
  const activePlayers = (s) => s.players.filter(isActive);
  const hasTech = (p, t) => p.techs.includes(t);
  const zoneOpen = (s, z) => !(s.sunDestroyed && z.inner);

  function emptyBundle() {
    return { money: 0, material: 0, rares: {}, techs: [], shares: {} };
  }

  function normBundle(b) {
    const n = emptyBundle();
    if (!b) return n;
    n.money = Math.max(0, Math.floor(+b.money || 0));
    n.material = Math.max(0, Math.floor(+b.material || 0));
    for (const r in b.rares || {}) if (+b.rares[r] > 0) n.rares[r] = Math.floor(+b.rares[r]);
    n.techs = (b.techs || []).filter((t) => TECHS[t]);
    for (const c in b.shares || {}) if (+b.shares[c] > 0) n.shares[c] = Math.floor(+b.shares[c]);
    return n;
  }

  function isEmptyBundle(b) {
    return !b.money && !b.material && !Object.keys(b.rares).length && !b.techs.length && !Object.keys(b.shares).length;
  }

  function describeBundle(s, b) {
    const parts = [];
    if (b.money) parts.push(`${b.money} ₵`);
    if (b.material) parts.push(`${b.material} ${MATERIAL.toLowerCase()}`);
    for (const r in b.rares) if (b.rares[r]) parts.push(`${b.rares[r]} ${RARES[r]}`);
    for (const t of b.techs || []) parts.push(`licence ${TECHS[t].name}`);
    for (const c in b.shares || {}) parts.push(`${b.shares[c]} parts de ${player(s, c).name}`);
    return parts.length ? parts.join(", ") : "rien";
  }

  function log(s, type, text, ids = []) {
    s.log.push({ turn: s.turn, type, text, ids });
  }

  function canGive(s, p, b) {
    if (p.money < b.money) return fail(`${p.name} n'a pas ${b.money} ₵`);
    if (p.material < b.material) return fail(`${p.name} n'a pas ${b.material} ${MATERIAL.toLowerCase()}`);
    for (const r in b.rares) if ((p.rares[r] || 0) < b.rares[r]) return fail(`${p.name} n'a pas ${b.rares[r]} ${RARES[r]}`);
    for (const t of b.techs) if (!hasTech(p, t)) return fail(`${p.name} ne possède pas ${TECHS[t].name}`);
    for (const c in b.shares) {
      const comp = player(s, c);
      if (!comp || !comp.shares || (comp.shares[p.id] || 0) < b.shares[c]) return fail(`${p.name} n'a pas ${b.shares[c]} parts de ${comp ? comp.name : c}`);
    }
    return ok();
  }

  // les technologies sont données en licence : le donneur les garde.
  // CONFIG.licenceMode décide si la licence donne la techno ou un bonus.
  function transfer(s, from, to, b) {
    from.money -= b.money;
    to.money += b.money;
    from.material -= b.material;
    to.material += b.material;
    for (const r in b.rares) {
      from.rares[r] -= b.rares[r];
      to.rares[r] = (to.rares[r] || 0) + b.rares[r];
    }
    for (const t of b.techs) {
      if (hasTech(to, t)) continue;
      if (CONFIG.licenceMode === "access") to.techs.push(t);
      else to.licences[t] = true;
    }
    for (const c in b.shares) {
      const comp = player(s, c);
      comp.shares[from.id] -= b.shares[c];
      if (!comp.shares[from.id]) delete comp.shares[from.id];
      comp.shares[to.id] = (comp.shares[to.id] || 0) + b.shares[c];
    }
    flow(s, from.id, to.id, bundleValue(s, b));
  }

  // rel[a][b] : ce que a a versé à b (valeur), dégâts que a a causés à b...
  function flow(s, a, b, value, key = "paid") {
    if (a === b) return;
    s.rel[a][b][key] += value;
  }

  // ------------------------------------------------------------ valuations

  function marketPrice(s, rare) {
    const prices = s.players.filter((p) => isActive(p) && (p.rares[rare] || 0) > 0).map((p) => p.prices[rare]);
    if (!prices.length) return CONFIG.defaultRarePrice;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  function materialPrice(s) {
    const prices = s.players.filter((p) => isActive(p) && p.material > 0).map((p) => p.materialPrice);
    if (!prices.length) return CONFIG.defaultMaterialPrice;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  function infraValue(i) {
    const d = INFRA[i.type];
    const v = i.type === "base" ? 60 : (d.cost.money || 0) + (d.cost.material || 0) * 0.5;
    return (v * i.hp) / d.hp;
  }

  function bundleValue(s, b) {
    let v = b.money + b.material * 0.5 + (b.techs || []).length * 20;
    for (const r in b.rares) v += b.rares[r] * marketPrice(s, r);
    for (const c in b.shares || {}) v += b.shares[c] * sharePrice(s, player(s, c));
    return v;
  }

  function outstanding(l) {
    return l.status === "en cours" || l.status === "défaut" ? l.repay : 0;
  }

  function debtOf(s, p) {
    return s.loans.filter((l) => l.borrower === p.id).reduce((a, l) => a + outstanding(l), 0);
  }

  function receivableOf(s, p) {
    return s.loans.filter((l) => l.lender === p.id).reduce((a, l) => a + outstanding(l), 0);
  }

  // part d'un joueur dans un projet collaboratif achevé (0..1)
  function projectShare(pr, pid) {
    const total = Object.values(pr.contrib).reduce((a, b) => a + b, 0);
    return total ? (pr.contrib[pid] || 0) / total : 0;
  }

  // valeur nette de l'entreprise, hors parts détenues chez les autres
  function equity(s, p) {
    if (!isActive(p)) return 0;
    let v = p.money + p.material * 0.5 + p.techs.length * 10 + p.staff.length * 5;
    for (const r in p.rares) v += p.rares[r] * marketPrice(s, r);
    for (const i of p.infras) v += infraValue(i);
    for (const pr of s.projects) if (pr.status === "achevé") v += projectShare(pr, p.id) * pr.value * 0.5;
    return v + receivableOf(s, p) * 0.8 - debtOf(s, p);
  }

  function sharePrice(s, p) {
    if (!isActive(p)) return 0;
    return Math.max(0.1, equity(s, p) / CONFIG.shares);
  }

  // visibilité depuis la galaxie : seule l'expansion hors de la Terre se
  // voit, et d'autant plus qu'elle est lointaine
  function visibility(p) {
    return p.infras.reduce((a, i) => a + (i.zone === "terre" ? 0 : INFRA[i.type].visibility * (1 + zone(i.zone).tier * 0.25)), 0);
  }

  function tableVisibility(s) {
    return activePlayers(s).reduce((a, p) => a + visibility(p), 0);
  }

  // ------------------------------------------------------------ recherche

  function xpLevel(r) {
    return r.xp >= CONFIG.xpLevels[1] ? 2 : r.xp >= CONFIG.xpLevels[0] ? 1 : 0;
  }

  function labCapacity(p) {
    return p.infras.filter((i) => i.type === "labo").length * CONFIG.labCapacity;
  }

  function staffOn(p, t) {
    return p.staff.filter((r) => r.tech === t);
  }

  // chercheurs équivalents (pondérés par l'expérience) affectés à t
  function effectiveResearchers(p, t) {
    const n = staffOn(p, t).reduce((a, r) => a + CONFIG.xpMult[xpLevel(r)], 0);
    return p.licences[t] ? n * 2 : n;
  }

  function researchChance(t, effective) {
    return Math.min(CONFIG.researchMaxChance, 1 - Math.pow(1 - TECHS[t].chance, effective));
  }

  // outillage : payé une fois par techno ; offert par une licence (mode
  // "bonus") ; pour une recherche collective, c'est le chantier commun
  function toolingCost(p, t) {
    if (p.licences[t] || TECHS[t].pooled) return { money: 0, material: 0 };
    const equipment = Math.ceil((TECHS[t].metals || 0) * (1 - carbonDiscount(p)));
    return { money: Math.ceil(TECHS[t].cost * CONFIG.toolingRate), material: Math.ceil(TECHS[t].cost * CONFIG.toolingMetalRate) + equipment };
  }

  // remise "carbone" sur les équipements en métaux et platinoïdes
  function carbonDiscount(p) {
    let d = 0;
    for (const t in CONFIG.carbonDiscount) if (hasTech(p, t)) d = Math.max(d, CONFIG.carbonDiscount[t]);
    return d;
  }

  function discountedRares(p, rares) {
    const d = carbonDiscount(p);
    const out = {};
    for (const r in rares || {}) {
      const n = r === "cristal" ? Math.ceil(rares[r] * (1 - d)) : rares[r];
      if (n > 0) out[r] = n;
    }
    return out;
  }

  function equipmentCost(p, t) {
    return discountedRares(p, TECHS[t].rare);
  }

  // prérequis : tous pour une recherche normale ; pour une recherche
  // collective (pooled), il suffit d'en détenir un — c'est la table qui doit
  // les réunir tous (cf. pooledKnowledge)
  function canResearch(p, t) {
    const pre = TECHS[t].prereqs;
    return TECHS[t].pooled ? pre.some((r) => hasTech(p, r)) : pre.every((r) => hasTech(p, r));
  }

  function hire(s, pid, n) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    n = Math.max(0, Math.floor(+n || 0));
    if (!n) return fail("Nombre invalide");
    if (p.staff.length + n > labCapacity(p)) return fail(`Capacité des laboratoires : ${labCapacity(p)} chercheurs (${p.staff.length} déjà)`);
    const cost = n * CONFIG.hireCost;
    if (p.money < cost) return fail(`Il faut ${cost} ₵`);
    p.money -= cost;
    for (let i = 0; i < n; i++) p.staff.push({ id: s.nextId++, xp: 0, tech: null });
    log(s, "recherche", `${p.name} embauche ${n} chercheur(s) (${cost} ₵)`, [pid]);
    return ok(`${n} chercheur(s) embauché(s)`);
  }

  // licencie d'abord les inactifs, puis les moins expérimentés
  function fire(s, pid, n) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    n = Math.min(p.staff.length, Math.max(0, Math.floor(+n || 0)));
    if (!n) return fail("Personne à licencier");
    const order = [...p.staff].sort((a, b) => (a.tech ? 1 : 0) - (b.tech ? 1 : 0) || a.xp - b.xp);
    const gone = order.slice(0, n);
    const cost = gone.reduce((a, r) => a + CONFIG.severance * (1 + xpLevel(r)), 0);
    p.money -= cost;
    p.staff = p.staff.filter((r) => !gone.includes(r));
    log(s, "recherche", `${p.name} licencie ${n} chercheur(s) (indemnités ${cost} ₵)`, [pid]);
    return ok(`${n} chercheur(s) licencié(s), ${cost} ₵ d'indemnités`);
  }

  // fixe à n le nombre de chercheurs sur t (0 = arrêt). Le premier
  // engagement paie l'outillage et l'équipement spécialisé. Un chercheur
  // retiré d'une recherche inachevée perd son expérience.
  function assignResearch(s, pid, t, n) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    if (!TECHS[t]) return fail("Technologie inconnue");
    if (hasTech(p, t)) return fail("Déjà débloquée");
    n = Math.max(0, Math.floor(+n || 0));
    const current = staffOn(p, t);
    if (!n) {
      if (!current.length) return ok();
      for (const r of current) {
        r.tech = null;
        r.xp = 0;
      }
      log(s, "recherche", `${p.name} arrête la recherche sur ${TECHS[t].name}`, [pid]);
      return ok("Recherche arrêtée");
    }
    if (!canResearch(p, t)) {
      const need = TECHS[t].pooled ? `au moins une de : ${TECHS[t].prereqs.map((r) => TECHS[r].name).join(", ")}` : TECHS[t].prereqs.filter((r) => !hasTech(p, r)).map((r) => TECHS[r].name).join(", ");
      return fail(`Prérequis manquant : ${need}`);
    }
    if (n > current.length) {
      const idle = p.staff.filter((r) => !r.tech).sort((a, b) => b.xp - a.xp);
      if (idle.length < n - current.length) return fail(`Pas assez de chercheurs inactifs (${idle.length}) : embauchez`);
      if (!p.tooled[t]) {
        const tooling = toolingCost(p, t);
        const equip = equipmentCost(p, t);
        if (p.money < tooling.money || p.material < tooling.material) return fail(`Outillage : ${tooling.money} ₵ + ${tooling.material} ${MATERIAL.toLowerCase()}`);
        for (const r in equip) if ((p.rares[r] || 0) < equip[r]) return fail(`Équipement requis : ${equip[r]} ${RARES[r]}`);
        p.money -= tooling.money;
        p.material -= tooling.material;
        for (const r in equip) p.rares[r] -= equip[r];
        p.tooled[t] = true;
        if (tooling.money || Object.keys(equip).length) log(s, "recherche", `${p.name} installe l'outillage pour ${TECHS[t].name} (${describeBundle(s, { ...tooling, rares: equip })})`, [pid]);
      }
      // l'expérience acquise est gardée d'une techno achevée à la suivante ;
      // elle n'est perdue que si on retire un chercheur d'une recherche en cours
      for (const r of idle.slice(0, n - current.length)) r.tech = t;
    } else if (n < current.length) {
      for (const r of current.sort((a, b) => a.xp - b.xp).slice(0, current.length - n)) {
        r.tech = null;
        r.xp = 0;
      }
    }
    log(s, "recherche", `${p.name} affecte ${n} chercheur(s) à ${TECHS[t].name}`, [pid]);
    return ok("Chercheurs affectés");
  }

  // savoir réuni par les participants d'une recherche collective : chercheurs
  // affectés + contributeurs des chantiers de distorsion achevés
  function pooledParticipants(s, t) {
    const ids = new Set();
    for (const p of activePlayers(s)) if (staffOn(p, t).length) ids.add(p.id);
    for (const pr of s.projects) if (pr.type === "distorsion" && pr.status === "achevé") for (const pid in pr.contrib) if (isActive(player(s, pid))) ids.add(+pid);
    return [...ids].map((id) => player(s, id));
  }

  function pooledKnowledge(s, t) {
    const parts = pooledParticipants(s, t);
    const missing = TECHS[t].prereqs.filter((r) => !parts.some((p) => hasTech(p, r)));
    const boost = s.projects.filter((pr) => pr.type === "distorsion" && pr.status === "achevé").length * CONFIG.distorsionBoost;
    const eff = activePlayers(s).reduce((a, p) => a + effectiveResearchers(p, t), 0);
    const tooled = boost > 0;
    return { parts, missing, tooled, eff: eff ? eff + boost : 0, chance: eff && tooled && !missing.length ? researchChance(t, eff + boost) : 0 };
  }

  function discover(s, p, t, how = "") {
    if (hasTech(p, t)) return;
    p.techs.push(t);
    delete p.licences[t];
    for (const r of staffOn(p, t)) r.tech = null;
    log(s, "recherche", `${p.name} découvre ${TECHS[t].name}${how} !`, [p.id]);
  }

  // salaires, expérience et tirages de découverte
  function research(s) {
    for (const p of activePlayers(s)) {
      const wages = p.staff.length * CONFIG.salary;
      p.money -= wages;
      for (const r of p.staff) if (r.tech) r.xp++;
    }
    const pooledDone = new Set();
    for (const p of activePlayers(s)) {
      const techs = [...new Set(p.staff.filter((r) => r.tech).map((r) => r.tech))];
      for (const t of techs) {
        if (hasTech(p, t)) {
          for (const r of staffOn(p, t)) r.tech = null;
          continue;
        }
        if (TECHS[t].pooled) {
          if (pooledDone.has(t)) continue;
          pooledDone.add(t);
          const k = pooledKnowledge(s, t);
          if (k.missing.length) {
            if (s.turn % 4 === 0) log(s, "recherche", `Recherche collective ${TECHS[t].name} bloquée : il manque à la table ${k.missing.map((r) => TECHS[r].name).join(", ")}`);
          } else if (!k.tooled) {
            if (s.turn % 4 === 0) log(s, "recherche", `Recherche collective ${TECHS[t].name} bloquée : aucun chantier de distorsion achevé (outillage commun)`);
          } else if (rand(s) < k.chance) {
            for (const q of k.parts) discover(s, q, t, " (recherche collective)");
          }
          continue;
        }
        const chance = researchChance(t, effectiveResearchers(p, t));
        if (rand(s) < chance) discover(s, p, t);
      }
    }
  }

  function checkMilestones(s, p) {
    for (const m of MILESTONES) {
      if (p.milestones.includes(m.id) || !m.need.every((t) => hasTech(p, t))) continue;
      p.milestones.push(m.id);
      log(s, "jalon", `${p.name} atteint un jalon : ${m.name}`, [p.id]);
      if (m.id === CONFIG.darkForestTrigger && s.darkForestTriggerTurn == null) {
        s.darkForestTriggerTurn = s.turn;
        log(s, "forêt sombre", `${p.name} rend l'humanité visible (${m.name}) — la forêt sombre commence à guetter`, [p.id]);
      }
      if (m.id === "cloak" && !s.darkForestCloaked) {
        s.darkForestCloaked = true;
        log(s, "forêt sombre", `${p.name} parvient à camoufler l'humanité — plus de projectile ni d'envahisseurs`, [p.id]);
      }
    }
  }

  // -------------------------------------------------------- construction

  // construction "sur place" : impression 3D en orbite + une mine à soi
  // dans la zone → une structure lourde n'a pas à être lancée depuis la Terre
  function buildsLocally(p, zoneId) {
    return zoneId !== "terre" && hasTech(p, "CON-9") && p.infras.some((i) => i.type === "mine" && i.zone === zoneId);
  }

  function hasStation(p, zoneId) {
    return p.infras.some((i) => i.type === "station" && i.zone === zoneId);
  }

  // coût = fabrication × éloignement (logistique) ; ×3 pour une structure
  // lourde lancée depuis la Terre ; ergols = carburant d'acheminement (un
  // par niveau d'éloignement), inutiles avec sa propre station dans la zone
  function buildCost(p, type, zoneId) {
    const d = INFRA[type];
    const z = zone(zoneId);
    const local = buildsLocally(p, zoneId);
    let k = 1 + z.tier * CONFIG.distanceCost;
    if (d.heavy && zoneId !== "terre" && !local) k *= CONFIG.heavyLaunchMult;
    const rares = discountedRares(p, d.cost.rares);
    const ergols = zoneId === "terre" || hasStation(p, zoneId) ? 0 : z.tier;
    if (ergols) rares.ergols = (rares.ergols || 0) + ergols;
    return { money: Math.ceil((d.cost.money || 0) * k), material: Math.ceil((d.cost.material || 0) * k), rares, local, heavyLaunch: d.heavy && zoneId !== "terre" && !local };
  }

  // station d'un autre joueur dans la zone : on peut y acheter les ergols
  // manquants au tarif de son propriétaire
  function fuelStationFor(s, p, zoneId) {
    return s.players.filter((o) => o !== p && isActive(o) && hasStation(o, zoneId)).sort((a, b) => a.fuelFee - b.fuelFee)[0] || null;
  }

  function build(s, pid, type, zoneId, mode = "prudent") {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const d = INFRA[type];
    const z = zone(zoneId);
    if (!d || d.buildable === false) return fail("Infrastructure inconnue");
    if (!z) return fail("Zone inconnue");
    if (!zoneOpen(s, z)) return fail(`${z.name} a été détruite`);
    if (z.reachTech && !hasTech(p, z.reachTech)) return fail(`Trop loin : nécessite ${TECHS[z.reachTech].name}`);
    if (d.tech && !hasTech(p, d.tech)) return fail(`Nécessite ${TECHS[d.tech].name}`);
    if (d.where === "terre" && zoneId !== "terre") return fail(`${d.name} : sur Terre uniquement`);
    if (d.where === "espace" && zoneId === "terre") return fail(`${d.name} : dans l'espace uniquement`);
    if (type === "extracteur" && !Object.keys(z.yield).length) return fail("Rien à extraire dans cette zone");
    if (type === "mine" && !z.metals) return fail("Pas de métaux exploitables dans cette zone");
    const c = buildCost(p, type, zoneId);
    if (p.money < c.money || p.material < c.material) return fail(`Coût : ${c.money} ₵ + ${c.material} ${MATERIAL.toLowerCase()}`);
    // ergols manquants : achetés à une station de ravitaillement d'un autre joueur
    let fuelFrom = null;
    let fuelUnits = 0;
    const missingErgols = Math.max(0, (c.rares.ergols || 0) - (p.rares.ergols || 0));
    if (missingErgols) {
      fuelFrom = fuelStationFor(s, p, zoneId);
      fuelUnits = missingErgols;
      if (!fuelFrom) return fail(`Il faut ${c.rares.ergols} ${RARES.ergols}`);
      if (p.money < c.money + fuelUnits * fuelFrom.fuelFee) return fail(`Ravitaillement chez ${fuelFrom.name} : ${fuelUnits * fuelFrom.fuelFee} ₵ en plus`);
    }
    for (const r in c.rares) if (r !== "ergols" && (p.rares[r] || 0) < c.rares[r]) return fail(`Il faut ${c.rares[r]} ${RARES[r]}`);
    p.money -= c.money;
    p.material -= c.material;
    for (const r in c.rares) p.rares[r] = (p.rares[r] || 0) - (r === "ergols" ? c.rares[r] - fuelUnits : c.rares[r]);
    if (fuelFrom) {
      const fee = fuelUnits * fuelFrom.fuelFee;
      p.money -= fee;
      fuelFrom.money += fee;
      flow(s, p.id, fuelFrom.id, fee - fuelUnits * CONFIG.defaultRarePrice);
      log(s, "marché", `${p.name} se ravitaille à la station de ${fuelFrom.name} en ${z.name} : ${fuelUnits} ergols pour ${fee} ₵`, [p.id, fuelFrom.id]);
    }
    if (zoneId !== "terre" && !c.local) s.planet -= z.tier * CONFIG.launchPollution; // lancement depuis la Terre
    p.infras.push({ id: s.nextId++, type, zone: zoneId, hp: d.hp, mode, built: s.turn });
    const neighbours = s.players.filter((o) => o !== p && isActive(o) && o.infras.some((i) => i.zone === zoneId));
    const near = neighbours.length && !z.safe ? ` — à proximité de ${neighbours.map((o) => o.name).join(", ")}` : "";
    const how = c.heavyLaunch ? " (lancé depuis la Terre, coût ×3)" : c.local ? " (construit sur place)" : "";
    log(s, "construction", `${p.name} construit ${d.name} (${mode}) en ${z.name}${how}${near}`, [pid, ...neighbours.map((o) => o.id)]);
    return ok(`Construction : ${d.name}`);
  }

  // démanteler : seul moyen de réduire la pollution terrestre une fois
  // l'industrie installée ; on récupère la moitié des métaux
  function dismantle(s, pid, infraId) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const i = p.infras.find((x) => x.id === +infraId);
    if (!i) return fail("Infrastructure introuvable");
    if (i.type === "base") return fail("On ne démantèle pas sa base");
    p.infras = p.infras.filter((x) => x !== i);
    const back = Math.floor((INFRA[i.type].cost.material || 0) / 2);
    p.material += back;
    log(s, "construction", `${p.name} démantèle ${INFRA[i.type].name} en ${zone(i.zone).name} (+${back} ${MATERIAL.toLowerCase()})`, [pid]);
    return ok(`${INFRA[i.type].name} démantelé`);
  }

  // ---------------------------------------------------------------- marché

  function setPrice(s, pid, rare, price) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    price = Math.max(1, Math.round(+price || 1));
    if (!RARES[rare] || p.prices[rare] === price) return ok();
    const old = p.prices[rare];
    p.prices[rare] = price;
    log(s, "prix", `${p.name} passe le prix de ${RARES[rare]} de ${old} à ${price} ₵`, [pid]);
    return ok("Prix mis à jour");
  }

  function setMaterialPrice(s, pid, price) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    price = Math.max(1, Math.round(+price || 1));
    if (p.materialPrice === price) return ok();
    const old = p.materialPrice;
    p.materialPrice = price;
    log(s, "prix", `${p.name} passe le prix des ${MATERIAL.toLowerCase()} de ${old} à ${price} ₵`, [pid]);
    return ok("Prix mis à jour");
  }

  function setFuelFee(s, pid, fee) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    fee = Math.max(0, Math.round(+fee || 0));
    if (p.fuelFee === fee) return ok();
    log(s, "prix", `${p.name} passe son droit de ravitaillement de ${p.fuelFee} à ${fee} ₵ par ergol`, [pid]);
    p.fuelFee = fee;
    return ok("Tarif mis à jour");
  }

  // marché : achat immédiat au prix affiché par le vendeur
  function buyRare(s, buyerId, sellerId, rare, qty) {
    const b = player(s, buyerId);
    const se = player(s, sellerId);
    const g = guard(s, b) || guard(s, se);
    if (g) return g;
    qty = Math.floor(+qty || 0);
    if (b === se) return fail("Impossible d'acheter à soi-même");
    if (qty <= 0) return fail("Quantité invalide");
    if ((se.rares[rare] || 0) < qty) return fail(`${se.name} n'a que ${se.rares[rare] || 0} ${RARES[rare]}`);
    const cost = qty * se.prices[rare];
    if (b.money < cost) return fail(`Il faut ${cost} ₵`);
    b.money -= cost;
    se.money += cost;
    se.rares[rare] -= qty;
    b.rares[rare] = (b.rares[rare] || 0) + qty;
    // valeur nette de l'échange : surcoût payé par rapport au prix de référence
    flow(s, b.id, se.id, cost);
    flow(s, se.id, b.id, qty * CONFIG.defaultRarePrice);
    s.trades.push({ turn: s.turn, buyer: b.id, seller: se.id, rare, qty, price: se.prices[rare] });
    log(s, "marché", `${b.name} achète ${qty} ${RARES[rare]} à ${se.name} pour ${cost} ₵ (${se.prices[rare]} ₵/u)`, [b.id, se.id]);
    return ok("Achat effectué");
  }

  function buyMaterial(s, buyerId, sellerId, qty) {
    const b = player(s, buyerId);
    const se = player(s, sellerId);
    const g = guard(s, b) || guard(s, se);
    if (g) return g;
    qty = Math.floor(+qty || 0);
    if (b === se) return fail("Impossible d'acheter à soi-même");
    if (qty <= 0) return fail("Quantité invalide");
    if (se.material < qty) return fail(`${se.name} n'a que ${se.material} ${MATERIAL.toLowerCase()}`);
    const cost = qty * se.materialPrice;
    if (b.money < cost) return fail(`Il faut ${cost} ₵`);
    b.money -= cost;
    se.money += cost;
    se.material -= qty;
    b.material += qty;
    flow(s, b.id, se.id, cost);
    flow(s, se.id, b.id, qty * CONFIG.defaultMaterialPrice);
    s.trades.push({ turn: s.turn, buyer: b.id, seller: se.id, rare: "material", qty, price: se.materialPrice });
    log(s, "marché", `${b.name} achète ${qty} ${MATERIAL.toLowerCase()} à ${se.name} pour ${cost} ₵ (${se.materialPrice} ₵/u)`, [b.id, se.id]);
    return ok("Achat effectué");
  }

  // ------------------------------------------------------- offres et prêts

  // troc : from propose de donner `give` contre `want`
  function proposeTrade(s, fromId, toId, give, want, note = "") {
    const from = player(s, fromId);
    const to = player(s, toId);
    const g = guard(s, from) || guard(s, to);
    if (g) return g;
    if (from === to) return fail("Choisir un autre joueur");
    give = normBundle(give);
    want = normBundle(want);
    if (isEmptyBundle(give) && isEmptyBundle(want)) return fail("Offre vide");
    const c = canGive(s, from, give);
    if (!c.ok) return c;
    const o = { id: s.nextId++, kind: "troc", from: fromId, to: toId, give, want, note, turn: s.turn, status: "en attente" };
    s.offers.push(o);
    const label = isEmptyBundle(give) ? "demande" : "propose";
    log(s, "offre", `${from.name} ${label} à ${to.name} : ${describeBundle(s, give)} contre ${describeBundle(s, want)}${note ? ` (« ${note} »)` : ""}`, [fromId, toId]);
    autoRespond(s, o);
    return ok("Offre envoyée");
  }

  // prêt : proposé par le prêteur ou demandé par l'emprunteur.
  // due = null → prêt sans condition de remboursement.
  function proposeLoan(s, fromId, toId, { lender, principal, repay, due, note = "" }) {
    const from = player(s, fromId);
    const to = player(s, toId);
    const g = guard(s, from) || guard(s, to);
    if (g) return g;
    if (from === to) return fail("Choisir un autre joueur");
    principal = normBundle({ money: principal.money, material: principal.material });
    if (isEmptyBundle(principal)) return fail("Montant vide");
    repay = Math.max(0, Math.floor(+repay || 0));
    const lenderId = lender === "from" ? fromId : toId;
    const borrowerId = lender === "from" ? toId : fromId;
    if (lenderId === fromId) {
      const c = canGive(s, from, principal);
      if (!c.ok) return c;
    }
    due = due === null || due === "" || due === undefined ? null : s.turn + Math.max(1, Math.floor(+due));
    const o = { id: s.nextId++, kind: "prêt", from: fromId, to: toId, lender: lenderId, borrower: borrowerId, principal, repay, due, note, turn: s.turn, status: "en attente" };
    s.offers.push(o);
    const terms = due ? `à rembourser ${repay} ₵ au tour ${due}` : repay ? `remboursement libre de ${repay} ₵` : "sans remboursement";
    const verb = lenderId === fromId ? "propose un prêt à" : "demande un prêt à";
    log(s, "offre", `${from.name} ${verb} ${to.name} : ${describeBundle(s, principal)}, ${terms}`, [fromId, toId]);
    autoRespond(s, o);
    return ok("Proposition de prêt envoyée");
  }

  function acceptOffer(s, offerId) {
    const o = s.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "en attente") return fail("Offre indisponible");
    const from = player(s, o.from);
    const to = player(s, o.to);
    const g = guard(s, from) || guard(s, to);
    if (g) return g;
    if (o.kind === "troc") {
      const c1 = canGive(s, from, o.give);
      if (!c1.ok) return c1;
      const c2 = canGive(s, to, o.want);
      if (!c2.ok) return c2;
      transfer(s, from, to, o.give);
      transfer(s, to, from, o.want);
      o.status = "acceptée";
      log(s, "échange", `${to.name} accepte : ${from.name} donne ${describeBundle(s, o.give)}, reçoit ${describeBundle(s, o.want)}`, [from.id, to.id]);
    } else {
      const lender = player(s, o.lender);
      const borrower = player(s, o.borrower);
      const c = canGive(s, lender, o.principal);
      if (!c.ok) return c;
      lender.money -= o.principal.money;
      lender.material -= o.principal.material;
      borrower.money += o.principal.money;
      borrower.material += o.principal.material;
      flow(s, lender.id, borrower.id, bundleValue(s, o.principal));
      const l = { id: s.nextId++, lender: lender.id, borrower: borrower.id, principal: o.principal, repay: o.repay, due: o.due, status: o.repay ? "en cours" : "don", turn: s.turn };
      s.loans.push(l);
      o.status = "acceptée";
      log(s, "prêt", `${lender.name} prête ${describeBundle(s, o.principal)} à ${borrower.name}${o.due ? ` (échéance tour ${o.due}, ${o.repay} ₵)` : ""}`, [lender.id, borrower.id]);
    }
    return ok("Offre acceptée");
  }

  function refuseOffer(s, offerId) {
    const o = s.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "en attente") return fail("Offre indisponible");
    o.status = "refusée";
    log(s, "offre", `${player(s, o.to).name} refuse l'offre de ${player(s, o.from).name}`, [o.from, o.to]);
    return ok("Offre refusée");
  }

  function cancelOffer(s, offerId) {
    const o = s.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "en attente") return fail("Offre indisponible");
    o.status = "annulée";
    return ok("Offre annulée");
  }

  function repayLoan(s, loanId) {
    const l = s.loans.find((x) => x.id === loanId);
    if (!l || !outstanding(l)) return fail("Rien à rembourser");
    const b = player(s, l.borrower);
    const g = guard(s, b);
    if (g) return g;
    if (b.money < l.repay) return fail(`Il faut ${l.repay} ₵`);
    const lender = player(s, l.lender);
    b.money -= l.repay;
    lender.money += l.repay;
    flow(s, b.id, lender.id, l.repay);
    const late = l.status === "défaut";
    l.status = late ? "remboursé en retard" : "remboursé";
    s.rel[b.id][lender.id].repaid++;
    log(s, "prêt", `${b.name} rembourse ${l.repay} ₵ à ${lender.name}${late ? " (en retard)" : ""}`, [b.id, lender.id]);
    return ok("Remboursé");
  }

  function forgiveLoan(s, loanId) {
    const l = s.loans.find((x) => x.id === loanId);
    if (!l || !outstanding(l)) return fail("Rien à annuler");
    l.status = "annulé";
    log(s, "prêt", `${player(s, l.lender).name} efface la dette de ${player(s, l.borrower).name}`, [l.lender, l.borrower]);
    return ok("Dette effacée");
  }

  // ---------------------------------------------------------------- rachat

  function buyoutCost(s, buyer, target) {
    const held = target.shares[buyer.id] || 0;
    return Math.ceil(sharePrice(s, target) * (CONFIG.shares - held));
  }

  function canBuyout(s, buyerId, targetId) {
    const b = player(s, buyerId);
    const t = player(s, targetId);
    if (!isActive(b) || !isActive(t) || b === t) return fail("Rachat impossible");
    const held = t.shares[b.id] || 0;
    if (t.status !== "faillite" && held < CONFIG.buyoutMajority) return fail(`${t.name} doit être en faillite, ou il faut ${CONFIG.buyoutMajority} parts (vous : ${held})`);
    const cost = buyoutCost(s, b, t);
    if (b.money < cost) return fail(`Il faut ${cost} ₵`);
    return ok(`Rachat possible pour ${cost} ₵`);
  }

  // le racheteur paie les autres actionnaires ; la part de l'entreprise
  // elle-même va à ses créanciers. Il absorbe ensuite tous ses actifs et dettes.
  function buyout(s, buyerId, targetId) {
    const g = guard(s, player(s, buyerId));
    if (g) return g;
    const c = canBuyout(s, buyerId, targetId);
    if (!c.ok) return c;
    const b = player(s, buyerId);
    const t = player(s, targetId);
    const price = sharePrice(s, t);
    for (const h in t.shares) {
      const hid = +h;
      if (hid === b.id) continue;
      const amount = Math.ceil(price * t.shares[h]);
      if (hid === t.id) {
        const debts = s.loans.filter((l) => l.borrower === t.id && outstanding(l) && l.lender !== b.id);
        const total = debts.reduce((a, l) => a + l.repay, 0);
        for (const l of debts) {
          const part = Math.floor((amount * l.repay) / total);
          b.money -= part;
          player(s, l.lender).money += part;
          flow(s, b.id, l.lender, part);
        }
      } else {
        b.money -= amount;
        player(s, hid).money += amount;
        flow(s, b.id, hid, amount);
      }
    }
    absorb(s, b, t);
    t.status = "racheté";
    t.endedBy = b.id;
    log(s, "rachat", `${b.name} rachète ${t.name} et absorbe ses actifs et ses dettes`, [b.id, t.id]);
    checkEnd(s);
    return ok(`${t.name} racheté`);
  }

  function absorb(s, b, t) {
    b.money += t.money;
    b.material += t.material;
    for (const r in t.rares) b.rares[r] = (b.rares[r] || 0) + t.rares[r];
    for (const tech of t.techs) if (!hasTech(b, tech)) b.techs.push(tech);
    for (const i of t.infras) b.infras.push(i);
    for (const r of t.staff) b.staff.push({ ...r, tech: null });
    for (const tech in t.tooled) b.tooled[tech] = true;
    t.infras = [];
    t.staff = [];
    t.money = t.material = 0;
    for (const r in t.rares) t.rares[r] = 0;
    for (const l of s.loans) {
      if (l.borrower === t.id) l.borrower = b.id;
      if (l.lender === t.id) l.lender = b.id;
      if (l.borrower === l.lender && outstanding(l)) l.status = "annulé";
    }
    for (const comp of s.players) {
      if (comp === t || !comp.shares[t.id]) continue;
      comp.shares[b.id] = (comp.shares[b.id] || 0) + comp.shares[t.id];
      delete comp.shares[t.id];
    }
    for (const pr of s.projects) {
      if (!pr.contrib[t.id]) continue;
      pr.contrib[b.id] = (pr.contrib[b.id] || 0) + pr.contrib[t.id];
      delete pr.contrib[t.id];
      if (pr.controller === t.id) pr.controller = b.id;
    }
    t.shares = {};
    for (const o of s.offers) if (o.status === "en attente" && (o.from === t.id || o.to === t.id)) o.status = "annulée";
  }

  function eliminate(s, p, byId, reason) {
    p.status = "détruit";
    p.endedBy = byId;
    p.infras = [];
    p.staff = [];
    for (const l of s.loans) if (l.borrower === p.id && outstanding(l)) l.status = "perdu";
    for (const l of s.loans) if (l.lender === p.id && outstanding(l)) l.status = "annulé";
    for (const comp of s.players) delete comp.shares[p.id];
    p.shares = {};
    for (const o of s.offers) if (o.status === "en attente" && (o.from === p.id || o.to === p.id)) o.status = "annulée";
    log(s, "élimination", `${p.name} est détruit (${reason})`, byId != null ? [p.id, byId] : [p.id]);
  }

  // ---------------------------------------------------- projets communs

  function projectRemaining(pr) {
    const need = pr.cost;
    const rem = { money: Math.max(0, need.money - pr.funded.money), material: Math.max(0, need.material - pr.funded.material), rares: {} };
    for (const r in need.rares) {
      const left = need.rares[r] - (pr.funded.rares[r] || 0);
      if (left > 0) rem.rares[r] = left;
    }
    return rem;
  }

  function createProject(s, pid, type, zoneId = null) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const def = PROJECTS[type];
    if (!def) return fail("Projet inconnu");
    if (def.needsInfra && !p.infras.some((i) => i.type === def.needsInfra)) return fail(`Il faut posséder : ${INFRA[def.needsInfra].name}`);
    if (def.needsTech && !hasTech(p, def.needsTech)) return fail(`Nécessite ${TECHS[def.needsTech].name}`);
    if (def.needsAnyTech && !def.needsAnyTech.some((t) => hasTech(p, t))) return fail(`Nécessite l'une de : ${def.needsAnyTech.map((t) => TECHS[t].name).join(", ")}`);
    if (def.zone) {
      const z = zone(zoneId);
      if (!z || !Object.keys(z.yield).length) return fail("Choisir une zone avec des ressources");
      if (!zoneOpen(s, z)) return fail(`${z.name} a été détruite`);
      if (z.reachTech && !hasTech(p, z.reachTech)) return fail(`Trop loin : nécessite ${TECHS[z.reachTech].name}`);
    }
    const pr = {
      id: s.nextId++,
      type,
      name: def.name,
      zone: def.zone ? zoneId : null,
      creator: pid,
      cost: normBundle(def.cost),
      funded: { money: 0, material: 0, rares: {} },
      contrib: {},
      pledges: {},
      status: "en cours",
      controller: null,
      mode: type === "armada" ? "défense" : null,
      value: bundleValue(s, normBundle(def.cost)),
      turn: s.turn,
      lastAttack: null,
    };
    s.projects.push(pr);
    log(s, "projet", `${p.name} lance le projet ${def.name}${pr.zone ? ` en ${zone(pr.zone).name}` : ""} (${describeBundle(s, pr.cost)})`, [pid]);
    return ok("Projet lancé");
  }

  // promesse : visible par tous, n'engage à rien (trahison possible)
  function pledge(s, pid, projectId, value) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const pr = s.projects.find((x) => x.id === projectId);
    if (!pr || pr.status !== "en cours") return fail("Projet indisponible");
    value = Math.max(0, Math.floor(+value || 0));
    pr.pledges[pid] = value;
    log(s, "projet", `${p.name} promet ${value} ₵ (valeur) au projet ${pr.name}`, [pid]);
    return ok("Promesse enregistrée");
  }

  function contribute(s, pid, projectId, bundle) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const pr = s.projects.find((x) => x.id === projectId);
    if (!pr || pr.status !== "en cours") return fail("Projet indisponible");
    const rem = projectRemaining(pr);
    const b = normBundle(bundle);
    // on ne verse jamais plus que ce qu'il reste à financer
    b.money = Math.min(b.money, rem.money);
    b.material = Math.min(b.material, rem.material);
    for (const r in b.rares) b.rares[r] = Math.min(b.rares[r], rem.rares[r] || 0);
    b.techs = [];
    b.shares = {};
    const c = canGive(s, p, b);
    if (!c.ok) return c;
    const value = bundleValue(s, b);
    if (!value) return fail("Rien d'utile à verser (déjà financé)");
    p.money -= b.money;
    p.material -= b.material;
    pr.funded.money += b.money;
    pr.funded.material += b.material;
    for (const r in b.rares) {
      p.rares[r] -= b.rares[r];
      pr.funded.rares[r] = (pr.funded.rares[r] || 0) + b.rares[r];
    }
    pr.contrib[pid] = (pr.contrib[pid] || 0) + value;
    log(s, "projet", `${p.name} verse ${describeBundle(s, b)} au projet ${pr.name}`, [pid]);
    const left = projectRemaining(pr);
    if (!left.money && !left.material && !Object.keys(left.rares).length) completeProject(s, pr);
    return ok("Contribution versée");
  }

  function completeProject(s, pr) {
    pr.status = "achevé";
    pr.completed = s.turn;
    pr.controller = +Object.entries(pr.contrib).sort((a, b) => b[1] - a[1])[0][0];
    const owners = Object.keys(pr.contrib).map((id) => `${player(s, id).name} ${Math.round(projectShare(pr, +id) * 100)} %`);
    log(s, "projet", `Projet ${pr.name} achevé — propriétaires : ${owners.join(", ")} ; contrôle : ${player(s, pr.controller).name}`, Object.keys(pr.contrib).map(Number));
    // promesses non tenues
    for (const pid in pr.pledges) {
      const gap = pr.pledges[pid] - (pr.contrib[pid] || 0);
      if (gap > 0) log(s, "trahison", `${player(s, pid).name} avait promis ${pr.pledges[pid]} ₵ au projet ${pr.name} et n'en a versé que ${Math.round(pr.contrib[pid] || 0)}`, [+pid]);
    }
  }

  function armadaStrength(s, pr) {
    const ctrl = player(s, pr.controller);
    return CONFIG.armadaStrength * (ctrl && hasTech(ctrl, "STR-9") ? 1.5 : 1);
  }

  // défense dont bénéficie un joueur : armadas en mode défense qu'il co-possède
  function defenseOf(s, p) {
    return s.projects.filter((pr) => pr.type === "armada" && pr.status === "achevé" && pr.mode === "défense" && pr.contrib[p.id]).reduce((a, pr) => a + armadaStrength(s, pr), 0);
  }

  function setArmadaMode(s, pid, projectId, mode) {
    const pr = s.projects.find((x) => x.id === projectId);
    if (!pr || pr.type !== "armada" || pr.status !== "achevé") return fail("Armada indisponible");
    if (pr.controller !== pid) return fail("Seul le plus gros contributeur contrôle l'armada");
    if (!["défense", "conquête", "exploration"].includes(mode)) return fail("Mode inconnu");
    if (pr.mode === mode) return ok();
    pr.mode = mode;
    log(s, "armada", `${player(s, pid).name} passe l'armada en mode ${mode}`, [pid, ...Object.keys(pr.contrib).map(Number)]);
    return ok(`Armada en mode ${mode}`);
  }

  // conquête : une attaque par tour ; détruit jusqu'à deux infrastructures
  // de la cible, sauf si sa défense égale ou dépasse la force de l'armada
  function attack(s, pid, projectId, targetId) {
    const p = player(s, pid);
    const t = player(s, targetId);
    const g = guard(s, p) || guard(s, t);
    if (g) return g;
    const pr = s.projects.find((x) => x.id === projectId);
    if (!pr || pr.type !== "armada" || pr.status !== "achevé") return fail("Armada indisponible");
    if (pr.controller !== pid) return fail("Seul le plus gros contributeur contrôle l'armada");
    if (pr.mode !== "conquête") return fail("L'armada doit être en mode conquête");
    if (pr.lastAttack === s.turn) return fail("Une seule attaque par tour");
    if (pr.contrib[targetId]) return fail("On n'attaque pas un co-propriétaire de l'armada");
    pr.lastAttack = s.turn;
    const strength = armadaStrength(s, pr);
    const def = defenseOf(s, t);
    if (def >= strength) {
      log(s, "armada", `L'armada de ${p.name} attaque ${t.name}, repoussée par sa défense (${def} contre ${strength})`, [pid, targetId]);
      return ok("Attaque repoussée");
    }
    const targets = [...t.infras].sort((a, b) => (a.type === "base") - (b.type === "base") || infraValue(b) - infraValue(a)).slice(0, 2);
    log(s, "armada", `L'armada de ${p.name} attaque ${t.name}`, [pid, targetId]);
    for (const i of targets) {
      while (t.infras.includes(i) && isActive(t)) damage(s, p, t, i, true);
    }
    if (isActive(t) && !t.infras.length) eliminate(s, t, pid, "plus aucune infrastructure");
    checkEnd(s);
    return ok("Attaque menée");
  }

  // ---------------------------------------------------------- turn phases

  function produce(s, p) {
    const prod = { money: 0, material: 0, rares: {} };
    for (const i of p.infras) {
      const d = INFRA[i.type];
      const z = zone(i.zone);
      const eff = i.hp >= d.hp ? 1 : 0.5;
      const upkeep = i.type === "electrolyse" && z.sabatier ? {} : d.upkeep;
      if (upkeep) {
        const lacking = Object.keys(upkeep).find((r) => (p.rares[r] || 0) < upkeep[r]);
        if (lacking) {
          log(s, "pénurie", `${d.name} de ${p.name} à l'arrêt : manque de ${RARES[lacking]}`, [p.id]);
          continue;
        }
        for (const r in upkeep) p.rares[r] -= upkeep[r];
      }
      prod.money += Math.round((d.prod.money || 0) * eff);
      prod.material += Math.round((d.prod.material || 0) * eff * (i.type === "mine" ? z.metals : 1));
      if (d.prod.ergols) prod.rares.ergols = (prod.rares.ergols || 0) + Math.round(d.prod.ergols * eff);
      if (d.prod.zoneYield) for (const r in z.yield) prod.rares[r] = (prod.rares[r] || 0) + Math.round(z.yield[r] * eff);
    }
    const maintenance = (p.infras.filter((i) => i.type !== "base").length) * CONFIG.maintenance;
    p.money += prod.money - maintenance;
    p.material += prod.material;
    for (const r in prod.rares) p.rares[r] = (p.rares[r] || 0) + prod.rares[r];

    // dividendes versés aux actionnaires extérieurs
    const div = Math.max(0, prod.money * CONFIG.dividendRate);
    for (const h in p.shares) {
      const hid = +h;
      if (hid === p.id) continue;
      const amount = Math.floor((div * p.shares[h]) / CONFIG.shares);
      if (!amount) continue;
      p.money -= amount;
      player(s, hid).money += amount;
      flow(s, p.id, hid, amount);
      log(s, "dividende", `${p.name} verse ${amount} ₵ de dividendes à ${player(s, hid).name}`, [p.id, hid]);
    }
  }

  // méga-extracteurs : production partagée au prorata des apports
  function produceProjects(s) {
    for (const pr of s.projects) {
      if (pr.type !== "megaextracteur" || pr.status !== "achevé") continue;
      const z = zone(pr.zone);
      if (!zoneOpen(s, z)) continue;
      for (const r in z.yield) {
        const total = z.yield[r] * 4;
        for (const pid in pr.contrib) {
          const p = player(s, pid);
          if (!isActive(p)) continue;
          p.rares[r] = (p.rares[r] || 0) + Math.round(total * projectShare(pr, +pid));
        }
      }
    }
  }

  function damage(s, attacker, victim, infra, voluntary, cause) {
    const before = infraValue(infra);
    infra.hp -= 1;
    const d = INFRA[infra.type];
    const lost = before - (infra.hp > 0 ? infraValue(infra) : 0);
    if (attacker) {
      s.rel[attacker.id][victim.id].damage++;
      s.rel[attacker.id][victim.id].damageValue += lost;
    }
    const who = attacker ? `${attacker.name} ${voluntary ? "endommage volontairement" : "endommage accidentellement"}` : cause;
    if (infra.hp <= 0) {
      victim.infras = victim.infras.filter((x) => x !== infra);
      log(s, "conflit", `${who} : ${d.name} de ${victim.name} en ${zone(infra.zone).name} détruit`, attacker ? [attacker.id, victim.id] : [victim.id]);
      if (infra.type === "base" && !victim.infras.length) eliminate(s, victim, attacker ? attacker.id : null, "base détruite");
    } else {
      log(s, "conflit", `${who} : ${d.name} de ${victim.name} en ${zone(infra.zone).name} dégradé (${infra.hp}/${d.hp})`, attacker ? [attacker.id, victim.id] : [victim.id]);
    }
  }

  // conflit opportuniste : toute infrastructure plus récente placée à côté de
  // celle d'un autre joueur risque de la dégrader, un peu par accident,
  // beaucoup si elle a été placée de façon agressive.
  function incidents(s) {
    for (const z of ZONES) {
      if (z.safe) continue; // la Terre est le foyer commun : pas de conflit d'empiètement là-bas
      const here = [];
      for (const p of activePlayers(s)) for (const i of p.infras) if (i.zone === z.id) here.push({ p, i });
      for (const a of here) {
        if (!isActive(a.p) || !a.p.infras.includes(a.i)) continue;
        const older = here.filter(
          (b) => b.p !== a.p && isActive(b.p) && b.p.infras.includes(b.i) && (a.i.built > b.i.built || (a.i.built === b.i.built && a.i.id > b.i.id))
        );
        if (!older.length) continue;
        const b = older[Math.floor(rand(s) * older.length)];
        const voluntary = a.i.mode === "agressif";
        let chance = voluntary ? CONFIG.incidentAggressive : CONFIG.incidentBase;
        if (hasTech(b.p, "STR-6")) chance /= 2; // blindage anti-radiations : atténue aussi les dégâts d'empiètement
        if (rand(s) < chance) damage(s, a.p, b.p, b.i, voluntary);
      }
    }
  }

  function loansDue(s) {
    for (const l of s.loans) {
      if (l.status === "en cours" && l.due !== null && l.due <= s.turn) {
        l.status = "défaut";
        s.rel[l.borrower][l.lender].defaults++;
        log(s, "prêt", `${player(s, l.borrower).name} ne rembourse pas ${player(s, l.lender).name} à l'échéance (${l.repay} ₵)`, [l.borrower, l.lender]);
      }
    }
  }

  // seules les installations sur Terre polluent la planète en continu ;
  // l'industrie déplacée dans l'espace la soulage (mais chaque lancement
  // depuis le sol pollue une fois, cf. build())
  function pollution(s) {
    if (s.sunDestroyed) return;
    let total = 0;
    for (const p of activePlayers(s)) {
      const k = hasTech(p, "SUP-4") ? 0.5 : 1; // recyclage de l'eau/nourriture : réduit aussi la pollution
      for (const i of p.infras) if (i.zone === "terre") total += INFRA[i.type].pollution * k;
    }
    const delta = CONFIG.pollutionRegen - total;
    s.planet = Math.min(CONFIG.planetHealth, s.planet + delta);
    s.lastPollution = total;
    if (delta < -5) log(s, "planète", `Pollution ${total.toFixed(1)} — santé de la planète ${Math.round(s.planet)}`);
  }

  // forêt sombre : risque de lancement d'un projectile proportionnel à la
  // visibilité cumulée de toute la table (tout le monde est responsable),
  // divisé par deux si une armada défend la table
  function darkForestRisk(s) {
    if (s.darkForestCloaked || s.darkForestTriggerTurn == null || s.projectile || s.sunDestroyed) return 0;
    if (s.turn < s.projectileCooldownUntil) return 0;
    const defended = s.projects.some((pr) => pr.type === "armada" && pr.status === "achevé" && pr.mode === "défense");
    return Math.min(CONFIG.darkForestMax, CONFIG.darkForestPerVis * tableVisibility(s)) * (defended ? 0.5 : 1);
  }

  function darkForest(s) {
    if (s.projectile) {
      // parade : la distorsion (PRO-10) dévie le projectile
      const deflector = activePlayers(s).find((p) => hasTech(p, "PRO-10"));
      if (deflector) {
        log(s, "forêt sombre", `${deflector.name} déforme l'espace-temps : le projectile est dévié !`, [deflector.id]);
        s.projectile = null;
        s.projectileCooldownUntil = s.turn + CONFIG.projectileCooldown;
        s.deviations++;
        return;
      }
      if (s.turn >= s.projectile.arrival) return impact(s);
      const left = s.projectile.arrival - s.turn;
      if (left % 4 === 0) log(s, "forêt sombre", `Projectile : impact sur le Soleil dans ${left} tours`);
      return;
    }
    const risk = darkForestRisk(s);
    if (!risk || rand(s) >= risk) return;
    s.projectile = { launched: s.turn, arrival: s.turn + CONFIG.projectileTurns };
    s.projectiles++;
    log(s, "forêt sombre", `Un bloc de matière à interaction forte fonce vers le Soleil ! Impact au tour ${s.projectile.arrival}. Seule la distorsion (PRO-10) peut le dévier — ou se replier sur les planètes extérieures.`);
  }

  // le Soleil explose : toutes les zones intérieures sont détruites
  function impact(s) {
    s.projectile = null;
    s.sunDestroyed = true;
    log(s, "forêt sombre", "💥 Le projectile frappe le Soleil. Terre, Orbite basse, Lune, Mars, Mercure et Ceinture sont détruites.");
    for (const p of activePlayers(s)) {
      const lost = p.infras.filter((i) => zone(i.zone).inner);
      p.infras = p.infras.filter((i) => !zone(i.zone).inner);
      if (lost.length) log(s, "forêt sombre", `${p.name} perd ${lost.length} infrastructure(s)`, [p.id]);
      if (!p.infras.length) eliminate(s, p, null, "anéanti avec le système intérieur");
      else {
        // replié sur les planètes extérieures : les chercheurs sans labo partent
        const cap = labCapacity(p);
        if (p.staff.length > cap) p.staff = p.staff.slice(0, cap);
      }
    }
  }

  // envahisseurs : vagues de fin de partie, seulement si la forêt sombre a
  // déjà repéré l'humanité (et qu'elle ne s'est pas camouflée)
  function invaders(s) {
    if (s.age !== "late" || s.darkForestTriggerTurn == null || s.darkForestCloaked) return;
    if (s.invaderNext == null) s.invaderNext = s.turn + CONFIG.invaderEvery;
    if (s.turn < s.invaderNext) return;
    s.invaderNext = s.turn + CONFIG.invaderEvery;
    const strength = CONFIG.invaderBase + CONFIG.invaderGrowth * s.invaderWaves;
    s.invaderWaves++;
    const zones = ZONES.filter((z) => zoneOpen(s, z) && activePlayers(s).some((p) => p.infras.some((i) => i.zone === z.id)));
    if (!zones.length) return;
    const z = zones[Math.floor(rand(s) * zones.length)];
    log(s, "envahisseurs", `Une flotte extraterrestre (force ${strength}) attaque ${z.name}`);
    for (const p of activePlayers(s)) {
      const here = p.infras.filter((i) => i.zone === z.id);
      if (!here.length) continue;
      const def = defenseOf(s, p);
      if (def >= strength) {
        log(s, "envahisseurs", `${p.name} repousse l'assaut grâce à son armada (défense ${def})`, [p.id]);
        continue;
      }
      p.infras = p.infras.filter((i) => i.zone !== z.id);
      log(s, "envahisseurs", `${p.name} perd ${here.length} infrastructure(s) en ${z.name}`, [p.id]);
      if (!p.infras.length) eliminate(s, p, null, "anéanti par les envahisseurs");
    }
  }

  function updateAge(s) {
    let age = s.age;
    if (age === "early" && s.darkForestTriggerTurn != null) age = "mid";
    // late : la fusion (hélium-3) est maîtrisée, ou l'on exploite déjà les planètes extérieures
    if (age === "mid" && activePlayers(s).some((p) => hasTech(p, "PRO-8") || p.infras.some((i) => i.type === "extracteur" && !zone(i.zone).inner))) age = "late";
    if (s.sunDestroyed && age !== "late") age = "late";
    if (age !== s.age) {
      s.age = age;
      s.ageTurns[age] = s.turn;
      log(s, "âge", `Nouvel âge : ${AGES[age].name} (menace principale : ${AGES[age].risk})`);
    }
  }

  function solvency(s) {
    for (const p of activePlayers(s)) {
      p.brokeTurns = p.money < 0 ? p.brokeTurns + 1 : 0;
      if (p.status === "actif" && p.brokeTurns >= CONFIG.bankruptTurns) {
        p.status = "faillite";
        log(s, "faillite", `${p.name} est en faillite : il peut être racheté`, [p.id]);
      } else if (p.status === "faillite" && p.money >= 0) {
        p.status = "actif";
        log(s, "faillite", `${p.name} sort de la faillite`, [p.id]);
      }
    }
  }

  function expireOffers(s) {
    for (const o of s.offers) {
      if (o.status === "en attente" && s.turn - o.turn >= CONFIG.offerTTL) o.status = "expirée";
    }
  }

  function checkEnd(s) {
    if (s.ended) return s.ended;
    const alive = activePlayers(s);
    const allTechCount = Object.keys(TECHS).length;
    const ascended = alive.find((p) => p.techs.length >= allTechCount);
    const explorers = s.projects.find(
      (pr) => pr.type === "armada" && pr.status === "achevé" && pr.mode === "exploration" && Object.keys(pr.contrib).some((id) => isActive(player(s, id)) && hasTech(player(s, id), "PRO-10"))
    );
    if (ascended) {
      s.ended = {
        type: "galactique",
        text: `Victoire galactique : ${ascended.name} a maîtrisé toutes les technologies et s'élance vers d'autres galaxies.`,
        winners: [ascended.id],
      };
    } else if (explorers) {
      const crew = Object.keys(explorers.contrib).map(Number).filter((id) => isActive(player(s, id)));
      s.ended = {
        type: "galactique",
        text: `Victoire galactique : l'armada de ${crew.map((id) => player(s, id).name).join(", ")} part vers d'autres galaxies grâce à la distorsion.`,
        winners: crew,
      };
    } else if (!s.sunDestroyed && s.planet <= 0) {
      s.ended = { type: "collective", text: "Défaite collective : la planète principale est détruite écologiquement. Personne ne gagne.", winners: [] };
    } else if (!alive.length) {
      s.ended = { type: "collective", text: s.sunDestroyed ? "Défaite collective : personne n'a survécu à l'explosion du Soleil." : "Défaite collective : aucun survivant.", winners: [] };
    } else if (alive.length === 1 && s.players.length > 1) {
      // dernier en lice : la fin dépend de la façon dont les autres sont tombés
      const w = alive[0];
      const others = s.players.filter((p) => p !== w);
      const bought = others.filter((p) => p.status === "racheté").length;
      const killed = others.filter((p) => p.status === "détruit" && p.endedBy != null).length;
      const nature = others.length - bought - killed; // Soleil, envahisseurs
      if (nature > bought && nature > killed) {
        s.ended = { type: "narrative", text: `Victoire narrative : ${w.name} est le seul à avoir survécu à la forêt sombre.`, winners: [w.id] };
      } else {
        const type = bought >= killed ? "économique" : "guerrière";
        s.ended = { type, text: `Victoire ${type} de ${w.name}.`, winners: [w.id] };
      }
    } else if (s.turn >= CONFIG.maxTurns) {
      const how = s.darkForestCloaked
        ? " L'humanité a même réussi à se camoufler."
        : s.sunDestroyed
          ? " Ils se sont repliés sur les planètes extérieures."
          : s.deviations
            ? ` La distorsion a dévié ${s.deviations} projectile(s).`
            : "";
      s.ended = { type: "narrative", text: `Victoire narrative : ${alive.map((p) => p.name).join(", ")} ont survécu à la forêt sombre.${how}`, winners: alive.map((p) => p.id) };
    }
    if (s.ended) log(s, "fin", s.ended.text, s.ended.winners);
    return s.ended;
  }

  function snapshot(s) {
    const eq = {};
    const sp = {};
    for (const p of s.players) {
      eq[p.id] = Math.round(equity(s, p));
      sp[p.id] = +sharePrice(s, p).toFixed(2);
    }
    const prices = {};
    for (const p of s.players) prices[p.id] = { ...p.prices };
    s.history.push({ turn: s.turn, equity: eq, sharePrice: sp, planet: s.planet, prices });
  }

  // ------------------------------------------------------------- new game

  function newGame(opts = {}) {
    const n = Math.max(1, Math.min(5, opts.players || 4));
    const s = {
      turn: 1,
      seed: opts.seed || 1,
      rng: opts.seed || 1,
      planet: CONFIG.planetHealth,
      age: "early",
      ageTurns: { early: 1 },
      darkForestTriggerTurn: null, // tour où l'humanité est devenue visible
      darkForestCloaked: false,
      projectile: null, // { launched, arrival }
      projectileCooldownUntil: 0,
      projectiles: 0,
      deviations: 0,
      sunDestroyed: false,
      invaderNext: null,
      invaderWaves: 0,
      players: [],
      offers: [],
      loans: [],
      projects: [],
      log: [],
      history: [],
      trades: [],
      rel: [],
      ended: null,
      nextId: 1,
    };
    for (let i = 0; i < n; i++) {
      const p = {
        id: i,
        name: NAMES[i],
        home: "terre", // tous les joueurs démarrent sur Terre, avec les mêmes ressources
        strategy: (opts.strategies && opts.strategies[i]) || "humain",
        money: CONFIG.startMoney,
        material: CONFIG.startMaterial,
        materialPrice: CONFIG.defaultMaterialPrice,
        fuelFee: CONFIG.defaultFuelFee,
        staff: [], // chercheurs { id, xp, tech }
        tooled: {}, // technos dont l'outillage est installé
        licences: {}, // licences reçues (mode "bonus")
        rares: {},
        prices: {},
        techs: [],
        milestones: [],
        infras: [],
        shares: { [i]: CONFIG.shares },
        status: "actif",
        brokeTurns: 0,
        endedBy: null,
      };
      for (const r in RARES) {
        p.rares[r] = 0;
        p.prices[r] = CONFIG.defaultRarePrice;
      }
      p.infras.push({ id: s.nextId++, type: "base", zone: "terre", hp: INFRA.base.hp, mode: "prudent", built: 0 });
      s.players.push(p);
    }
    s.rel = s.players.map(() => s.players.map(() => ({ paid: 0, damage: 0, damageValue: 0, defaults: 0, repaid: 0 })));
    log(s, "partie", `Nouvelle partie : ${n} joueur(s), graine ${s.seed}`);
    snapshot(s);
    return s;
  }

  function guard(s, p) {
    if (s.ended) return fail("La partie est terminée");
    if (!isActive(p)) return fail(`${p ? p.name : "?"} n'est plus en jeu`);
    return null;
  }

  // hook pour les stratégies automatiques (défini dans strategies.js)
  let botHooks = { act: null, respond: null };
  function setBots(hooks) {
    botHooks = hooks;
  }

  function autoRespond(s, o) {
    const to = player(s, o.to);
    if (!botHooks.respond || to.strategy === "humain" || o.status !== "en attente") return;
    if (botHooks.respond(s, to, o)) {
      const r = acceptOffer(s, o.id);
      if (!r.ok) refuseOffer(s, o.id);
    } else refuseOffer(s, o.id);
  }

  function endTurn(s) {
    if (s.ended) return fail("La partie est terminée");
    if (botHooks.act) for (const p of s.players) if (isActive(p) && p.strategy !== "humain" && !s.ended) botHooks.act(s, p);
    if (s.ended) return ok();
    for (const p of activePlayers(s)) produce(s, p);
    produceProjects(s);
    research(s);
    for (const p of activePlayers(s)) checkMilestones(s, p);
    updateAge(s);
    incidents(s);
    loansDue(s);
    pollution(s);
    darkForest(s);
    invaders(s);
    solvency(s);
    expireOffers(s);
    snapshot(s);
    if (!checkEnd(s)) {
      s.turn++;
      log(s, "tour", `— Début du tour ${s.turn} —`);
    }
    return ok(`Tour ${s.turn}`);
  }

  const api = {
    RARES, MATERIAL, ZONES, CONFIG, INFRA, TECHS, TECH_CATEGORIES, MILESTONES, AGES, PROJECTS,
    newGame, endTurn, setBots,
    hire, fire, assignResearch, staffOn, effectiveResearchers, researchChance, toolingCost, equipmentCost, canResearch, xpLevel, labCapacity, pooledKnowledge,
    build, dismantle, buildCost, fuelStationFor, setPrice, buyRare, setMaterialPrice, buyMaterial, setFuelFee, materialPrice,
    proposeTrade, proposeLoan, acceptOffer, refuseOffer, cancelOffer,
    repayLoan, forgiveLoan, buyout, canBuyout, buyoutCost,
    createProject, pledge, contribute, projectRemaining, projectShare, setArmadaMode, attack, armadaStrength, defenseOf,
    equity, sharePrice, visibility, tableVisibility, marketPrice,
    bundleValue, normBundle, describeBundle, debtOf, receivableOf, outstanding,
    darkForestRisk, isActive, activePlayers, hasTech, zone, zoneOpen, rand, carbonDiscount,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Game = api;
})(this);
