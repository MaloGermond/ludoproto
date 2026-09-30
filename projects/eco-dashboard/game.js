// POC mécaniques socio-économiques — issue #12
// Modèle de jeu pur (aucun DOM) : ressources, recherche, infrastructures,
// marché, troc, prêts, parts d'entreprise, conflit opportuniste, forêt
// sombre et conditions de fin. Les chiffres sont volontairement approximatifs.

(function (root) {
  const RARES = {
    lune: "Pierre lunaire",
    he3: "Hélium-3",
    cristal: "Cristaux",
    glace: "Glace cométaire",
    ergols: "Ergols", // raffinés depuis la glace (Raffinerie) — carburant de propulsion
  };

  // pas de position réelle : une zone n'est qu'un "lieu" où les
  // infrastructures de joueurs différents peuvent se gêner. La Terre est le
  // foyer commun de tous les joueurs (`safe`) : pas de conflit d'empiètement
  // là-bas — les autres zones ("planètes") sont ouvertes à tous, sans
  // exclusivité. `tier` = éloignement (0 = Terre) : renchérit la construction
  // (cf. buildCost) ; `reachTech` = technologie minimale pour y construire
  // quoi que ce soit — au-delà, l'accès à la ressource rare elle-même
  // demande en plus la technologie de l'infrastructure concernée (ex :
  // l'Extracteur exige EXT-6, cf. INFRA).
  const ZONES = [
    { id: "terre", name: "Terre", rare: null, safe: true, tier: 0, reachTech: null },
    { id: "orbite", name: "Orbite basse", rare: null, tier: 1, reachTech: "CON-1" },
    { id: "lune", name: "Lune", rare: "lune", tier: 2, reachTech: "EXT-3" },
    { id: "ceinture", name: "Ceinture", rare: "cristal", tier: 3, reachTech: "EXT-5" },
    { id: "geante", name: "Géante gazeuse", rare: "he3", tier: 4, reachTech: "EXT-7" },
    { id: "comete", name: "Comète", rare: "glace", tier: 5, reachTech: "EXT-8" },
  ];
  // multiplicateur de coût (argent/matière) selon l'éloignement de la zone
  const ZONE_COST_MULT = (zoneId) => 1 + zone(zoneId).tier * 0.4;

  const CONFIG = {
    maxTurns: 400, // 100 ans à 4 tours (saisons) par an — laisse une chance d'atteindre les technos profondes (EXT-6 tombe en moyenne bien plus tard, mais quelques parties chanceuses y arrivent)
    startMoney: 40,
    startMaterial: 30,
    startRare: 3,
    bankerStartMoney: 80, // tous les joueurs partent de la Terre (pas de rare) : ce montant s'applique désormais à tout le monde
    maintenance: 2, // argent / infrastructure / tour (hors base)
    shares: 100,
    dividendRate: 0.2, // part de l'argent produit reversée aux actionnaires
    incidentBase: 0.05, // risque par tour d'abîmer un voisin, placement prudent
    incidentAggressive: 0.2, // risque par tour d'abîmer un voisin, placement agressif
    planetHealth: 100,
    pollutionRegen: 12,
    darkForestTrigger: "orbit", // jalon (cf. MILESTONES) qui rend l'humanité visible et déclenche la forêt sombre
    darkForestStep: 0.0025, // +0,25 % de risque de frappe par tour depuis le déclenchement
    darkForestMax: 0.6,
    bankruptTurns: 2, // tours consécutifs en négatif avant la faillite
    researchMaxChance: 0.95, // plafond de chance de découverte par tour, tous chercheurs confondus
    researchContinuationRate: 0.3, // coût des tours suivants (une fois la recherche lancée), en fraction du coût initial
    seniorityBonusTurns: 5, // un bloc d'ancienneté toutes les N tours sur la même techno
    seniorityBonusPerBlock: 0.03, // +3 % de chance par bloc d'ancienneté
    seniorityBonusMax: 0.1, // plafond du bonus d'ancienneté (pas de gain infini)
    defaultRarePrice: 5,
    defaultMaterialPrice: 2, // vendre sa matière première pour financer le développement des autres
    buyoutMajority: 51,
    offerTTL: 2, // tours avant qu'une offre non traitée expire
  };

  const INFRA = {
    base: { name: "Base", cost: {}, hp: 3, prod: { money: 10, material: 8, homeRare: 1 }, pollution: 0.5, visibility: 2, buildable: false },
    mine: { name: "Mine", cost: { money: 10, material: 10 }, hp: 2, prod: { material: 6 }, pollution: 1.5, visibility: 1 },
    comptoir: { name: "Comptoir", cost: { money: 15, material: 15, rares: { he3: 1 } }, hp: 2, prod: { money: 8 }, pollution: 0.5, visibility: 2 },
    labo: { name: "Laboratoire", cost: { money: 20, material: 15 }, hp: 2, prod: { money: 6 }, pollution: 0.5, visibility: 1 },
    extracteur: { name: "Extracteur", cost: { money: 15, material: 20 }, hp: 2, prod: { zoneRare: 2 }, pollution: 3, visibility: 2, tech: "EXT-6" },
    reacteur: { name: "Réacteur à fusion", cost: { money: 25, material: 25, rares: { glace: 1 } }, hp: 2, prod: { money: 14, material: 4 }, upkeep: { he3: 1 }, pollution: 0, visibility: 3, tech: "PRO-8" },
    raffinerie: { name: "Raffinerie", cost: { money: 15, material: 15 }, hp: 2, prod: { ergols: 3 }, upkeep: { glace: 2 }, pollution: 1, visibility: 1 },
  };

  // Arbre technologique — programme spatial. `cost` = crédits dépensés par
  // chercheur affecté, tant que la recherche est en cours ; la première
  // affectation coûte plein tarif (mise en place), les tours suivants sur la
  // même techno coûtent CONFIG.researchContinuationRate × cost (maintenance,
  // moins cher). `chance` = probabilité de découverte par chercheur et par
  // tour ; avec N chercheurs, chance du tour = 1 - (1 - chance)^N, plafonnée
  // à 95 %. Un tour infructueux est perdu (aucun remboursement).
  // Coûts redimensionnés (÷10) par rapport à la table de référence pour
  // rester dans l'échelle économique du jeu (départ à 80 ₵).
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
    "PRO-2": { name: "Moteur à ergols liquides", category: "pro", prereqs: ["PRO-1"], cost: 30, chance: 0.12 },
    "PRO-3": { name: "Moteur cryogénique", category: "pro", prereqs: ["PRO-2", "STR-3"], cost: 80, chance: 0.08 },
    "PRO-4": { name: "Moteur ionique", category: "pro", prereqs: ["PRO-3", "REC-3"], cost: 200, chance: 0.05 },
    "PRO-5": { name: "Propulsion nucléaire thermique", category: "pro", prereqs: ["PRO-3", "REC-4"], cost: 400, chance: 0.04, rare: {ergols: 2} },
    "PRO-6": { name: "Moteur à plasma", category: "pro", prereqs: ["PRO-4"], cost: 600, chance: 0.03 },
    "PRO-7": { name: "Moteur à fission avancée", category: "pro", prereqs: ["PRO-5", "STR-7"], cost: 1000, chance: 0.02 },
    "PRO-8": { name: "Moteur à fusion", category: "pro", prereqs: ["PRO-6", "PRO-7", "REC-7"], cost: 2500, chance: 0.015, rare: {ergols: 3,he3: 2} },
    "PRO-9": { name: "Moteur à antimatière", category: "pro", prereqs: ["PRO-8", "REC-8"], cost: 6000, chance: 0.01 },
    "PRO-10": { name: "Moteur à distorsion", category: "pro", prereqs: ["PRO-9", "OBS-8", "REC-9"], cost: 15000, chance: 0.005, rare: {ergols: 6} },
    // Structure et carburant
    "STR-1": { name: "Corps de fusée en tôle", category: "str", prereqs: [], cost: 10, chance: 0.2 },
    "STR-2": { name: "Réservoirs pressurisés en aluminium", category: "str", prereqs: ["STR-1"], cost: 25, chance: 0.14 },
    "STR-3": { name: "Étagement", category: "str", prereqs: ["STR-2", "PRO-2"], cost: 60, chance: 0.09 },
    "STR-4": { name: "Matériaux composites", category: "str", prereqs: ["STR-2", "REC-2"], cost: 120, chance: 0.07, rare: { lune: 1 } },
    "STR-5": { name: "Réservoirs cryogéniques isolés", category: "str", prereqs: ["STR-4"], cost: 200, chance: 0.05 },
    "STR-6": { name: "Blindage anti-radiations", category: "str", prereqs: ["STR-4"], cost: 300, chance: 0.04 },
    "STR-7": { name: "Alliages haute résistance", category: "str", prereqs: ["STR-4", "REC-2"], cost: 500, chance: 0.03, rare: {lune: 2} },
    "STR-8": { name: "Nanomatériaux", category: "str", prereqs: ["STR-7", "REC-5"], cost: 2000, chance: 0.015, rare: {lune: 4} },
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
    "EXT-6": { name: "Exploitation minière lunaire", category: "ext", prereqs: ["EXT-5"], cost: 1000, chance: 0.025, desc: "Débloque l'extracteur (ressource rare de la zone)" },
    "EXT-7": { name: "Exploitation d'astéroïdes", category: "ext", prereqs: ["EXT-6", "GUI-9"], cost: 2000, chance: 0.015 },
    "EXT-8": { name: "Raffinage sur place", category: "ext", prereqs: ["EXT-7", "CON-9"], cost: 3500, chance: 0.01 },
    "EXT-9": { name: "Catapulte électromagnétique planétaire", category: "ext", prereqs: ["EXT-8", "PRO-8"], cost: 7000, chance: 0.007 },
    // Construction spatiale et satellites
    "CON-1": { name: "Satellite basique", category: "con", prereqs: ["PRO-3", "GUI-4"], cost: 150, chance: 0.07 },
    "CON-2": { name: "Panneaux solaires", category: "con", prereqs: ["CON-1", "REC-3"], cost: 200, chance: 0.06 },
    "CON-3": { name: "Satellite de communication", category: "con", prereqs: ["CON-2", "COM-3"], cost: 300, chance: 0.05 },
    "CON-4": { name: "Satellite relais", category: "con", prereqs: ["CON-3"], cost: 400, chance: 0.04 },
    "CON-5": { name: "Amarrage en orbite", category: "con", prereqs: ["CON-2", "GUI-5"], cost: 500, chance: 0.04 },
    "CON-6": { name: "Station spatiale", category: "con", prereqs: ["CON-5", "SUP-4"], cost: 900, chance: 0.03, rare: {lune: 1} },
    "CON-7": { name: "Bras robotique orbital", category: "con", prereqs: ["CON-6", "GUI-8"], cost: 1200, chance: 0.02 },
    "CON-8": { name: "Constellations de satellites", category: "con", prereqs: ["CON-4", "CON-7"], cost: 1500, chance: 0.02 },
    "CON-9": { name: "Impression 3D en orbite", category: "con", prereqs: ["CON-7", "STR-7"], cost: 2000, chance: 0.015, rare: {lune: 2} },
    "CON-10": { name: "Chantier orbital et usine spatiale", category: "con", prereqs: ["CON-9", "EXT-6"], cost: 4000, chance: 0.01 },
    "CON-11": { name: "Ascenseur spatial", category: "con", prereqs: ["CON-10", "STR-8"], cost: 10000, chance: 0.005, rare: {lune: 4} },
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

  // jalons narratifs : informatifs (journalisés une fois atteints), pas des
  // conditions de victoire — celles-ci restent celles de checkEnd()
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
    if (b.material) parts.push(`${b.material} matière`);
    for (const r in b.rares) parts.push(`${b.rares[r]} ${RARES[r]}`);
    for (const t of b.techs) parts.push(`licence ${TECHS[t].name}`);
    for (const c in b.shares) parts.push(`${b.shares[c]} parts de ${player(s, c).name}`);
    return parts.length ? parts.join(", ") : "rien";
  }

  function log(s, type, text, ids = []) {
    s.log.push({ turn: s.turn, type, text, ids });
  }

  function canGive(s, p, b) {
    if (p.money < b.money) return fail(`${p.name} n'a pas ${b.money} ₵`);
    if (p.material < b.material) return fail(`${p.name} n'a pas ${b.material} matière`);
    for (const r in b.rares) if ((p.rares[r] || 0) < b.rares[r]) return fail(`${p.name} n'a pas ${b.rares[r]} ${RARES[r]}`);
    for (const t of b.techs) if (!hasTech(p, t)) return fail(`${p.name} ne possède pas ${TECHS[t].name}`);
    for (const c in b.shares) {
      const comp = player(s, c);
      if (!comp || !comp.shares || (comp.shares[p.id] || 0) < b.shares[c]) return fail(`${p.name} n'a pas ${b.shares[c]} parts de ${comp ? comp.name : c}`);
    }
    return ok();
  }

  // les technologies sont données en licence : le donneur les garde
  function transfer(s, from, to, b) {
    from.money -= b.money;
    to.money += b.money;
    from.material -= b.material;
    to.material += b.material;
    for (const r in b.rares) {
      from.rares[r] -= b.rares[r];
      to.rares[r] = (to.rares[r] || 0) + b.rares[r];
    }
    for (const t of b.techs) if (!hasTech(to, t)) to.techs.push(t);
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

  // même logique que marketPrice, mais pour la matière première (pas une rare)
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
    let v = b.money + b.material * 0.5 + b.techs.length * 20;
    for (const r in b.rares) v += b.rares[r] * marketPrice(s, r);
    for (const c in b.shares) v += b.shares[c] * sharePrice(s, player(s, c));
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

  // valeur nette de l'entreprise, hors parts détenues chez les autres
  function equity(s, p) {
    if (!isActive(p)) return 0;
    let v = p.money + p.material * 0.5 + p.techs.length * 10;
    for (const r in p.rares) v += p.rares[r] * marketPrice(s, r);
    for (const i of p.infras) v += infraValue(i);
    return v + receivableOf(s, p) * 0.8 - debtOf(s, p);
  }

  function sharePrice(s, p) {
    if (!isActive(p)) return 0;
    return Math.max(0.1, equity(s, p) / CONFIG.shares);
  }

  function visibility(p) {
    return p.infras.reduce((a, i) => a + INFRA[i.type].visibility, 0);
  }

  // coût (en crédits) par chercheur affecté à `t` ce tour-ci : plein tarif
  // au premier tour de cette recherche, tarif réduit ensuite (maintenance)
  function researchCostPerHead(p, t) {
    const started = (p.assignments[t] && p.assignments[t].turns) || 0;
    return Math.ceil(TECHS[t].cost * (started === 0 ? 1 : CONFIG.researchContinuationRate));
  }

  // chance de découverte ce tour-ci avec N chercheurs affectés
  function researchChance(t, researchers) {
    return Math.min(CONFIG.researchMaxChance, 1 - Math.pow(1 - TECHS[t].chance, researchers));
  }

  // le coût en argent/matière augmente avec l'éloignement de la zone visée
  // (logistique) ; le coût en ressources rares, lui, ne change pas.
  // le coût en ergols (carburant d'acheminement) grandit avec l'éloignement,
  // sauf sur la Comète elle-même : c'est la source de la glace qui raffine
  // les ergols, l'exempter évite un blocage impossible (il faudrait des
  // ergols pour y aller, mais des ergols n'existent qu'une fois qu'on y est)
  // la Lune (tier 2) reste accessible tôt sans ergols — seules les zones
  // vraiment lointaines (Ceinture et au-delà) en demandent, pour ne pas
  // retarder toute expansion derrière la chaîne de raffinage
  function zoneErgolsCost(zoneId) {
    const z = zone(zoneId);
    return z.rare === "glace" || z.tier < 3 ? 0 : z.tier - 2;
  }

  function buildCost(type, zoneId) {
    const c = INFRA[type].cost;
    const k = ZONE_COST_MULT(zoneId);
    const rares = { ...(c.rares || {}) };
    const ergols = zoneErgolsCost(zoneId);
    if (ergols) rares.ergols = (rares.ergols || 0) + ergols;
    return { money: Math.ceil((c.money || 0) * k), material: Math.ceil((c.material || 0) * k), rares };
  }

  // la forêt sombre ne guette qu'une fois l'humanité devenue visible (jalon
  // CONFIG.darkForestTrigger atteint par n'importe quel joueur) — pas à une
  // date arbitraire, pour laisser le temps de se développer sans pression.
  function darkForestRisk(s) {
    if (s.darkForestCloaked || s.darkForestTriggerTurn == null) return 0;
    const elapsed = s.turn - s.darkForestTriggerTurn;
    if (elapsed < 0) return 0;
    return Math.min(CONFIG.darkForestMax, CONFIG.darkForestStep * (elapsed + 1));
  }

  // ------------------------------------------------------------- new game

  function newGame(opts = {}) {
    const n = Math.max(1, Math.min(5, opts.players || 4));
    const s = {
      turn: 1,
      seed: opts.seed || 1,
      rng: opts.seed || 1,
      planet: CONFIG.planetHealth,
      darkForestTriggerTurn: null, // tour où l'humanité est devenue visible (cf. CONFIG.darkForestTrigger) ; null tant que personne n'a atteint le jalon
      darkForestCloaked: false, // jalon "cloak" (COM-7 + OBS-8) atteint : neutralise définitivement la forêt sombre
      players: [],
      offers: [],
      loans: [],
      log: [],
      history: [],
      trades: [], // achats de ressource rare au marché
      rel: [],
      ended: null,
      nextId: 1,
    };
    for (let i = 0; i < n; i++) {
      const home = "terre"; // tous les joueurs démarrent au même endroit, avec les mêmes ressources
      const rare = zone(home).rare;
      const p = {
        id: i,
        name: NAMES[i],
        home,
        strategy: (opts.strategies && opts.strategies[i]) || "humain",
        money: rare ? CONFIG.startMoney : CONFIG.bankerStartMoney,
        material: CONFIG.startMaterial,
        materialPrice: CONFIG.defaultMaterialPrice,
        assignments: {}, // { [techId]: { researchers, turns } } — recherche en cours
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
        p.rares[r] = r === rare ? CONFIG.startRare : 0;
        p.prices[r] = CONFIG.defaultRarePrice;
      }
      p.infras.push({ id: s.nextId++, type: "base", zone: home, hp: INFRA.base.hp, mode: "prudent", built: 0 });
      s.players.push(p);
    }
    s.rel = s.players.map(() => s.players.map(() => ({ paid: 0, damage: 0, damageValue: 0, defaults: 0, repaid: 0 })));
    log(s, "partie", `Nouvelle partie : ${n} joueurs, graine ${s.seed}`);
    snapshot(s);
    return s;
  }

  // -------------------------------------------------------------- actions

  function guard(s, p) {
    if (s.ended) return fail("La partie est terminée");
    if (!isActive(p)) return fail(`${p ? p.name : "?"} n'est plus en jeu`);
    return null;
  }

  // affecte (ou réaffecte) des chercheurs à une techno ; 0 arrête la recherche.
  // Le coût est prélevé chaque tour (research(), phase de fin de tour) tant
  // que l'affectation reste active — pari risqué, rien n'est remboursé.
  function assignResearch(s, pid, t, researchers) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    if (!TECHS[t]) return fail("Technologie inconnue");
    if (hasTech(p, t)) return fail("Déjà débloquée");
    const missing = TECHS[t].prereqs.filter((r) => !hasTech(p, r));
    if (missing.length) return fail(`Prérequis manquant : ${missing.map((r) => TECHS[r].name).join(", ")}`);
    researchers = Math.max(0, Math.floor(+researchers || 0));
    if (!researchers) {
      if (p.assignments[t]) {
        delete p.assignments[t];
        log(s, "recherche", `${p.name} arrête la recherche sur ${TECHS[t].name}`, [pid]);
      }
      return ok("Recherche arrêtée");
    }
    const existing = p.assignments[t];
    if (!existing) {
      // premier engagement sur cette techno : il faut un laboratoire pour
      // accueillir les chercheurs, et l'équipement spécialisé (rare) requis
      if (!p.infras.some((i) => i.type === "labo")) return fail("Il faut un Laboratoire pour affecter des chercheurs");
      const need = TECHS[t].rare || {};
      for (const r in need) if ((p.rares[r] || 0) < need[r]) return fail(`Équipement requis : ${need[r]} ${RARES[r]}`);
      for (const r in need) p.rares[r] -= need[r];
    }
    p.assignments[t] = { researchers, turns: existing ? existing.turns : 0 };
    log(s, "recherche", `${p.name} affecte ${researchers} chercheur(s) à ${TECHS[t].name}`, [pid]);
    return ok("Chercheurs affectés");
  }

  // résout chaque recherche en cours : prélève le coût du tour, tente la
  // découverte. Un tour non financé (faute d'argent) arrête l'affectation.
  function research(s) {
    for (const p of activePlayers(s)) {
      for (const t of Object.keys(p.assignments)) {
        const a = p.assignments[t];
        if (hasTech(p, t)) {
          delete p.assignments[t];
          continue;
        }
        const cost = researchCostPerHead(p, t) * a.researchers;
        if (p.money < cost) {
          log(s, "recherche", `${p.name} ne peut plus financer ${TECHS[t].name} (${cost} ₵) : chercheurs licenciés`, [p.id]);
          delete p.assignments[t];
          continue;
        }
        p.money -= cost;
        a.turns++;
        // ancienneté : rester affecté longtemps sur la même techno donne un
        // bonus plafonné (expérience de l'équipe), pour décourager de
        // licencier/réembaucher les chercheurs à chaque tour
        const seniority = Math.min(CONFIG.seniorityBonusMax, Math.floor(a.turns / CONFIG.seniorityBonusTurns) * CONFIG.seniorityBonusPerBlock);
        const chance = Math.min(CONFIG.researchMaxChance, researchChance(t, a.researchers) + seniority);
        if (rand(s) < chance) {
          p.techs.push(t);
          delete p.assignments[t];
          log(s, "recherche", `${p.name} découvre ${TECHS[t].name} !`, [p.id]);
        } else {
          log(s, "recherche", `${p.name} poursuit ${TECHS[t].name} (${a.researchers} chercheur(s), ${Math.round(chance * 100)} % de chance, ${cost} ₵) — sans succès`, [p.id]);
        }
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
        log(s, "forêt sombre", `${p.name} parvient à camoufler toute la galaxie — la forêt sombre ne représente plus une menace`, [p.id]);
      }
    }
  }

  function build(s, pid, type, zoneId, mode = "prudent") {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const d = INFRA[type];
    if (!d || d.buildable === false) return fail("Infrastructure inconnue");
    if (!zone(zoneId)) return fail("Zone inconnue");
    const z = zone(zoneId);
    if (z.reachTech && !hasTech(p, z.reachTech)) return fail(`Trop loin : nécessite ${TECHS[z.reachTech].name}`);
    if (d.tech && !hasTech(p, d.tech)) return fail(`Nécessite ${TECHS[d.tech].name}`);
    if (type === "extracteur" && !z.rare) return fail("Pas de ressource rare dans cette zone");
    const c = buildCost(type, zoneId);
    if (p.money < c.money || p.material < c.material) return fail(`Coût : ${c.money} ₵ + ${c.material} matière`);
    for (const r in c.rares) if ((p.rares[r] || 0) < c.rares[r]) return fail(`Il faut ${c.rares[r]} ${RARES[r]}`);
    p.money -= c.money;
    p.material -= c.material;
    for (const r in c.rares) p.rares[r] -= c.rares[r];
    p.infras.push({ id: s.nextId++, type, zone: zoneId, hp: d.hp, mode, built: s.turn });
    const neighbours = s.players.filter((o) => o !== p && isActive(o) && o.infras.some((i) => i.zone === zoneId));
    const near = neighbours.length ? ` — à proximité de ${neighbours.map((o) => o.name).join(", ")}` : "";
    log(s, "construction", `${p.name} construit ${d.name} (${mode}) en ${zone(zoneId).name}${near}`, [pid, ...neighbours.map((o) => o.id)]);
    return ok(`Construction : ${d.name}`);
  }

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
    // valeur nette de l'échange : surcoût payé par rapport au prix moyen du marché
    flow(s, b.id, se.id, cost);
    flow(s, se.id, b.id, qty * CONFIG.defaultRarePrice);
    s.trades.push({ turn: s.turn, buyer: b.id, seller: se.id, rare, qty, price: se.prices[rare] });
    log(s, "marché", `${b.name} achète ${qty} ${RARES[rare]} à ${se.name} pour ${cost} ₵ (${se.prices[rare]} ₵/u)`, [b.id, se.id]);
    return ok("Achat effectué");
  }

  function setMaterialPrice(s, pid, price) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    price = Math.max(1, Math.round(+price || 1));
    if (p.materialPrice === price) return ok();
    const old = p.materialPrice;
    p.materialPrice = price;
    log(s, "prix", `${p.name} passe le prix de la matière première de ${old} à ${price} ₵`, [pid]);
    return ok("Prix mis à jour");
  }

  // marché de matière première : les joueurs avancés dans l'extraction
  // peuvent revendre leurs surplus à ceux qui construisent, plutôt que de
  // ne trafiquer que les 4 ressources rares
  function buyMaterial(s, buyerId, sellerId, qty) {
    const b = player(s, buyerId);
    const se = player(s, sellerId);
    const g = guard(s, b) || guard(s, se);
    if (g) return g;
    qty = Math.floor(+qty || 0);
    if (b === se) return fail("Impossible d'acheter à soi-même");
    if (qty <= 0) return fail("Quantité invalide");
    if (se.material < qty) return fail(`${se.name} n'a que ${se.material} matière`);
    const cost = qty * se.materialPrice;
    if (b.money < cost) return fail(`Il faut ${cost} ₵`);
    b.money -= cost;
    se.money += cost;
    se.material -= qty;
    b.material += qty;
    flow(s, b.id, se.id, cost);
    flow(s, se.id, b.id, qty * CONFIG.defaultMaterialPrice);
    s.trades.push({ turn: s.turn, buyer: b.id, seller: se.id, rare: "material", qty, price: se.materialPrice });
    log(s, "marché", `${b.name} achète ${qty} matière à ${se.name} pour ${cost} ₵ (${se.materialPrice} ₵/u)`, [b.id, se.id]);
    return ok("Achat effectué");
  }

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
    b.research += t.research;
    for (const r in t.rares) b.rares[r] = (b.rares[r] || 0) + t.rares[r];
    for (const tech of t.techs) if (!hasTech(b, tech)) b.techs.push(tech);
    for (const i of t.infras) b.infras.push(i);
    t.infras = [];
    t.money = t.material = t.research = 0;
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
    t.shares = {};
    for (const o of s.offers) if (o.status === "en attente" && (o.from === t.id || o.to === t.id)) o.status = "annulée";
  }

  function eliminate(s, p, byId, reason) {
    p.status = "détruit";
    p.endedBy = byId;
    p.infras = [];
    for (const l of s.loans) if (l.borrower === p.id && outstanding(l)) l.status = "perdu";
    for (const l of s.loans) if (l.lender === p.id && outstanding(l)) l.status = "annulé";
    for (const comp of s.players) delete comp.shares[p.id];
    p.shares = {};
    for (const o of s.offers) if (o.status === "en attente" && (o.from === p.id || o.to === p.id)) o.status = "annulée";
    log(s, "élimination", `${p.name} est détruit (${reason})`, byId != null ? [p.id, byId] : [p.id]);
  }

  // ---------------------------------------------------------- turn phases

  function produce(s, p) {
    const prod = { money: 0, material: 0, rares: {} };
    for (const i of p.infras) {
      const d = INFRA[i.type];
      const eff = i.hp >= d.hp ? 1 : 0.5;
      if (d.upkeep) {
        const lacking = Object.keys(d.upkeep).find((r) => (p.rares[r] || 0) < d.upkeep[r]);
        if (lacking) {
          log(s, "pénurie", `${d.name} de ${p.name} à l'arrêt : manque de ${RARES[lacking]}`, [p.id]);
          continue;
        }
        for (const r in d.upkeep) p.rares[r] -= d.upkeep[r];
      }
      const home = zone(p.home);
      let baseMoney = d.prod.money || 0;
      if (i.type === "base" && !home.rare) baseMoney += 6; // foyer sans rare (la Terre, pour tout le monde) : compensé par plus de revenus
      prod.money += Math.round(baseMoney * eff);
      prod.material += Math.round((d.prod.material || 0) * eff);
      const rare = d.prod.homeRare ? home.rare : d.prod.zoneRare ? zone(i.zone).rare : null;
      if (rare) prod.rares[rare] = (prod.rares[rare] || 0) + Math.round((d.prod.homeRare || d.prod.zoneRare) * eff);
    }
    const maintenance = (p.infras.length - 1) * CONFIG.maintenance;
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
      if (infra.type === "base") eliminate(s, victim, attacker ? attacker.id : null, "base détruite");
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
      // chaque infrastructure "arrivée après" risque un incident par tour
      // avec l'une des infrastructures plus anciennes de ses voisins
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

  function pollution(s) {
    let total = 0;
    for (const p of activePlayers(s)) {
      const k = hasTech(p, "SUP-4") ? 0.5 : 1; // recyclage de l'eau/nourriture : réduit aussi la pollution
      for (const i of p.infras) total += INFRA[i.type].pollution * k;
    }
    const delta = CONFIG.pollutionRegen - total;
    s.planet = Math.min(CONFIG.planetHealth, s.planet + delta);
    s.lastPollution = total;
    if (delta < -5) log(s, "planète", `Pollution ${total.toFixed(1)} — santé de la planète ${Math.round(s.planet)}`);
  }

  function darkForest(s) {
    const risk = darkForestRisk(s);
    if (!risk || rand(s) >= risk) return;
    const alive = activePlayers(s);
    if (!alive.length) return;
    const target = alive.reduce((a, b) => (visibility(b) > visibility(a) ? b : a));
    const infras = [...target.infras].sort((a, b) => INFRA[b.type].visibility - INFRA[a.type].visibility);
    const hit = infras.find((i) => i.type !== "base") || infras[0];
    log(s, "forêt sombre", `La forêt sombre frappe ${target.name}, le plus visible (visibilité ${visibility(target)})`, [target.id]);
    if (hit) damage(s, null, target, hit, false, "La forêt sombre");
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
    if (ascended) {
      // maîtrise totale de l'arbre technologique : un vaisseau doté de
      // toutes les technologies avancées part vers d'autres galaxies
      s.ended = {
        type: "galactique",
        text: `Victoire galactique : ${ascended.name} a maîtrisé toutes les technologies et s'élance vers d'autres galaxies à bord d'un vaisseau ultime.`,
        winners: [ascended.id],
      };
    } else if (s.planet <= 0) {
      s.ended = { type: "collective", text: "Défaite collective : la planète principale est détruite écologiquement. Personne ne gagne.", winners: [] };
    } else if (!alive.length) {
      s.ended = { type: "collective", text: "Défaite collective : aucun survivant.", winners: [] };
    } else if (alive.length === 1 && s.players.length > 1) {
      const w = alive[0];
      const others = s.players.filter((p) => p !== w);
      const bought = others.filter((p) => p.status === "racheté").length;
      const type = bought >= others.length - bought ? "économique" : "guerrière";
      s.ended = { type, text: `Victoire ${type} de ${w.name}.`, winners: [w.id] };
    } else if (s.turn >= CONFIG.maxTurns) {
      const cloak = s.darkForestCloaked ? " L'humanité a même réussi à camoufler toute la galaxie face à la forêt sombre." : "";
      s.ended = { type: "narrative", text: `Victoire narrative : ${alive.map((p) => p.name).join(", ")} ont survécu à la forêt sombre.${cloak}`, winners: alive.map((p) => p.id) };
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
    research(s);
    for (const p of activePlayers(s)) checkMilestones(s, p);
    incidents(s);
    loansDue(s);
    pollution(s);
    darkForest(s);
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
    RARES, ZONES, CONFIG, INFRA, TECHS, TECH_CATEGORIES, MILESTONES,
    newGame, endTurn, setBots,
    assignResearch, researchCostPerHead, researchChance, build, setPrice, buyRare,
    setMaterialPrice, buyMaterial, materialPrice,
    proposeTrade, proposeLoan, acceptOffer, refuseOffer, cancelOffer,
    repayLoan, forgiveLoan, buyout, canBuyout, buyoutCost,
    equity, sharePrice, visibility, buildCost, marketPrice,
    bundleValue, normBundle, describeBundle, debtOf, receivableOf, outstanding,
    darkForestRisk, isActive, activePlayers, hasTech, zone, rand,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Game = api;
})(this);
