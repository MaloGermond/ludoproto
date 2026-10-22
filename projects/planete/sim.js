// Simulateur d'évolution planétaire — issue #27 (v2 : modèle causal)
// Modèle pur (aucun DOM) : l'UI importe ce fichier via <script>, et
// `npm run sim` l'exécute en Node pour comparer les archétypes.
//
// Un pas de simulation = 1 "an". Tout est normalisé : 1 = valeur "terrestre".

// Coefficients d'équilibrage : seuils et vitesses, tous modifiables dans l'UI.
const COEFFS = {
  magneticMetals:    { label: "Métaux pour un champ magnétique complet", value: 0.3, min: 0.05, max: 1, step: 0.01 },
  magneticRotation:  { label: "Rotation minimale pour l'effet dynamo", value: 0.15, min: 0, max: 0.8, step: 0.01 },
  magneticVolcanism: { label: "Activité volcanique minimale pour l'effet dynamo", value: 0.05, min: 0, max: 0.5, step: 0.01 },
  poleGradient:      { label: "Écart pôle-équateur à rotation nulle (°C)", value: 50, min: 0, max: 150, step: 1 },
  sizeToAtm:         { label: "Atmosphère initiale par unité de taille/masse", value: 1.2, min: 0, max: 2, step: 0.05 },
  gravityRetention:  { label: "Réduction de la fuite d'atmosphère par unité de taille/masse", value: 1, min: 0, max: 2, step: 0.05 },
  dissipation:     { label: "Dissipation de l'atmosphère (sans champ)", value: 0.01, min: 0, max: 0.05, step: 0.0005 },
  baseLoss:        { label: "Fuite d'atmosphère résiduelle (avec champ)", value: 0.0002, min: 0, max: 0.01, step: 0.0001 },
  // le volcanisme dégage un seul flux total, réparti entre CO2 et cendres/aérosols — le
  // gaz inerte (N2/O2) n'est PAS produit par le volcanisme dans ce modèle (réaliste : il
  // vient de la formation de la planète, pas de son dégazage actif). Pas de lien avec
  // l'eau : ça faisait grossir les océans beaucoup trop vite, et c'était difficile à doser
  // sans que ça parte dans un sens ou dans l'autre — l'eau est maintenant une variable
  // d'état initial indépendante, qui ne varie plus que par fuite (voir `waterEscape`).
  volcanicOutput:  { label: "Dégazage volcanique total (CO2 + cendres)", value: 0.02, min: 0, max: 0.1, step: 0.001 },
  volcanicCO2Frac: { label: "Part de CO2 dans le dégazage volcanique (reste = cendres)", value: 0.6, min: 0, max: 1, step: 0.01 },
  factoryCo2:      { label: "CO2 émis par usine / an", value: 0.0005, min: 0, max: 0.005, step: 0.0001 },
  vegAbsorb:       { label: "Absorption du CO2 par la végétation", value: 0.05, min: 0, max: 0.2, step: 0.001 },
  oceanAbsorb:     { label: "Absorption du CO2 par les océans", value: 0.01, min: 0, max: 0.1, step: 0.001 },
  naturalGreen:    { label: "Effet de serre naturel (°C × atmosphère)", value: 10, min: 0, max: 40, step: 0.5 },
  greenhouse:      { label: "Effet de serre du CO2 (°C × atmosphère)", value: 60, min: 0, max: 200, step: 1 },

  oceanFreeze:       { label: "Température de gel des océans (°C)", value: 0, min: -30, max: 30, step: 1 },
  freezeRange:       { label: "Plage de gel progressif des océans (°C)", value: 15, min: 1, max: 40, step: 1 },
  minPressureLiquid: { label: "Pression minimale pour l'eau liquide", value: 0.12, min: 0, max: 0.8, step: 0.01 },
  waterEscape:       { label: "Fuite irréversible d'H2O vers l'espace (sans pression)", value: 0.01, min: 0, max: 0.1, step: 0.001 },

  vaporStart:      { label: "Température de départ de l'évaporation (°C)", value: 20, min: -40, max: 60, step: 1 },
  vaporRange:      { label: "Plage de saturation de la vapeur d'eau (°C)", value: 80, min: 5, max: 120, step: 1 },
  vaporGreenhouse: { label: "Effet de serre de la vapeur d'eau (°C × vapeur)", value: 25, min: 0, max: 80, step: 1 },

  albedoBase:        { label: "Albédo de base (roche nue)", value: 0.3, min: 0, max: 0.9, step: 0.01 },
  albedoIce:         { label: "Albédo supplémentaire de la glace", value: 0.5, min: 0, max: 0.9, step: 0.01 },
  albedoOcean:       { label: "Albédo en moins des océans (sombres)", value: 0.15, min: 0, max: 0.5, step: 0.01 },
  albedoVeg:         { label: "Albédo en moins de la végétation (sombre)", value: 0.05, min: 0, max: 0.3, step: 0.01 },
  albedoAsh:         { label: "Albédo en plus des cendres au sol (gris clair)", value: 0.15, min: 0, max: 0.4, step: 0.01 },
  albedoHaze:        { label: "Albédo en plus du nuage de cendres (passé 50 % d'opacité)", value: 0.25, min: 0, max: 0.5, step: 0.01 },
  albedoSensitivity: { label: "Sensibilité de la température à l'albédo (°C)", value: 40, min: 0, max: 100, step: 1 },
  // couche de cendres en altitude : au-delà du seuil, elle bloque le rayonnement et empêche
  // l'effet de serre (H2O+CO2) de s'exercer — une fois dissipée, il reprend normalement.
  // calé pour qu'à 1× l'activité terrestre il n'y ait pas encore de blocage, que ça
  // commence vers 1,5×, et que ce soit total vers 5× (couverture complète de cendres).
  ashShieldStart: { label: "Opacité de cendres à partir de laquelle l'effet de serre se bloque", value: 0.15, min: 0, max: 1, step: 0.01 },
  ashShieldRange: { label: "Plage jusqu'au blocage complet de l'effet de serre", value: 0.31, min: 0.01, max: 1, step: 0.01 },

  ashDecay:   { label: "Vitesse de retombée des cendres", value: 0.03, min: 0, max: 0.3, step: 0.005 },
  ashRainout: { label: "Lessivage des cendres par la pluie (océans + vapeur)", value: 1, min: 0, max: 5, step: 0.1 },
  ashDeposit:    { label: "Part des cendres qui se dépose au sol en retombant", value: 0.3, min: 0, max: 1, step: 0.01 },
  ashWeathering: { label: "Vitesse à laquelle les cendres au sol s'effacent", value: 0.02, min: 0, max: 0.1, step: 0.001 },

  climateEase:     { label: "Vitesse de retour à l'équilibre climatique", value: 0.25, min: 0.02, max: 1, step: 0.01 },
  oceanDamping:    { label: "Inertie thermique des océans (ralentit le climat)", value: 0.2, min: 0, max: 0.9, step: 0.01 },
  oceanWarmBuffer: { label: "Océans : capacité supplémentaire à absorber un réchauffement", value: 2, min: 1, max: 5, step: 0.1 },

  overheatRef:     { label: "Seuil de surchauffe à 1 UA (°C)", value: 45, min: 20, max: 100, step: 1 },
  overheatDist:    { label: "Sensibilité du seuil à la distance", value: 0.5, min: 0, max: 1, step: 0.05 },
  adaptRange:      { label: "Amplitude d'adaptation de la végétation au climat (°C)", value: 15, min: 0, max: 50, step: 1 },
  adaptSpeed:      { label: "Vitesse d'adaptation de la végétation à la température", value: 0.03, min: 0, max: 0.2, step: 0.005 },
  tempTolerance:   { label: "Tolérance de la végétation à l'écart de température (°C)", value: 10, min: 1, max: 40, step: 1 },
  atmMinVeg:       { label: "Atmosphère minimale pour la végétation", value: 0.15, min: 0, max: 0.8, step: 0.01 },
  co2Optimal:      { label: "CO2 idéal pour la fertilisation de la végétation", value: 0.08, min: 0.01, max: 0.5, step: 0.01 },
  co2Boost:        { label: "Boost de croissance max. grâce au CO2", value: 0.6, min: 0, max: 2, step: 0.05 },
  co2Toxic:        { label: "Seuil de CO2 toxique pour la végétation", value: 0.3, min: 0.05, max: 1, step: 0.01 },
  co2Damage:       { label: "Vitesse de destruction de la végétation par le CO2 toxique", value: 0.3, min: 0, max: 1, step: 0.01 },
  lifeSeed:        { label: "Graine de vie (apparition à partir d'O2)", value: 0.0005, min: 0, max: 0.01, step: 0.0001 },
  growth:          { label: "Vitesse de croissance de la végétation", value: 0.08, min: 0, max: 0.5, step: 0.005 },
  collapse:        { label: "Vitesse d'effondrement (par 10 °C au-dessus du seuil)", value: 0.15, min: 0, max: 1, step: 0.01 },
  desertCap:       { label: "Végétation max. sans eau (désertique)", value: 0.25, min: 0, max: 1, step: 0.01 },

  windRotation:   { label: "Vent dû à la rotation", value: 1, min: 0, max: 3, step: 0.1 },
  windAtmosphere: { label: "Vent dû à la densité de l'atmosphère", value: 0.5, min: 0, max: 3, step: 0.1 },
  erosionRate:    { label: "Vitesse d'érosion (vent + eau)", value: 0.01, min: 0, max: 0.1, step: 0.001 },
};

const FIXED_DEFAULTS = { metals: 0.8, distance: 1, rotation: 0.5, volcanism: 0.3 };
const DYNAMIC_DEFAULTS = { size: 0.5, water: 0.6, co2: 0.02, vegetation: 0.02 };

// Planètes prêtes à l'emploi : 4 variables fixes + état initial (H2O et taille/masse en
// font partie : elles peuvent varier d'une simulation à l'autre, contrairement à
// métaux/distance/rotation/volcanisme qui sont des traits physiques immuables).
const PRESETS = {
  earth:      { label: "Terre",             fixed: { metals: 0.8, distance: 1,    rotation: 0.5, volcanism: 0.3 },  dynamic: { size: 0.67, water: 0.7, co2: 0.02, vegetation: 0.1 } },
  ocean:      { label: "Océanique stable",  fixed: { metals: 0.9, distance: 1,    rotation: 0.5, volcanism: 0.3 },  dynamic: { size: 0.67, water: 0.9, co2: 0.02, vegetation: 0.05 } },
  desert:     { label: "Désertique",        fixed: { metals: 0.8, distance: 0.85, rotation: 0.6, volcanism: 0.2 },  dynamic: { size: 0.58, water: 0,   co2: 0.02, vegetation: 0.05 } },
  greenhouse: { label: "Effet de serre",    fixed: { metals: 0.8, distance: 0.55, rotation: 0.4, volcanism: 0.5 },  dynamic: { size: 0.75, water: 0.3, co2: 0.1,  vegetation: 0.02 } },
  dead:       { label: "Morte",             fixed: { metals: 0.8, distance: 1,    rotation: 0.5, volcanism: 0 },    dynamic: { size: 0.83, water: 0,   co2: 0.02, vegetation: 0 } },
  venus:      { label: "Vénus (pas de rotation)", fixed: { metals: 0.8, distance: 0.72, rotation: 0, volcanism: 0.6 }, dynamic: { size: 0.67, water: 0.3, co2: 0.05, vegetation: 0.02 } },
  volcanic:   { label: "Volcanique sombre", fixed: { metals: 0.7, distance: 1,    rotation: 0.3, volcanism: 3 }, dynamic: { size: 0.67, water: 0.4, co2: 0.05, vegetation: 0.02 } },
  glaciation: { label: "Glaciation",        fixed: { metals: 0.8, distance: 1.6,  rotation: 0.5, volcanism: 0.1 },  dynamic: { size: 0.5,  water: 0.6, co2: 0.02, vegetation: 0.05 } },
};

// Missions : un point de départ difficile + un objectif à atteindre en jouant sur les
// variables fixes (vivantes, pas besoin de relancer) et le nombre d'usines. Contrairement
// aux archétypes (observer un phénomène), il s'agit de résoudre un problème — le modèle ne
// s'en sort pas seul, voir `check`.
const MISSIONS = {
  co2dome: {
    label: "Sous un dôme de CO2",
    brief: "Un siècle d'industrie a saturé l'atmosphère de CO2 : la planète est bien au-dessus du seuil de surchauffe, la vie n'a plus la moindre chance de s'installer. Arrête les usines, et trouve comment faire redescendre la température (distance à l'étoile ? rotation ? volcanisme ?) pour qu'elle ait enfin une chance.",
    fixed: { metals: 0.8, distance: 1, rotation: 0.5, volcanism: 0.2 },
    dynamic: { size: 1.6, water: 0.5, co2: 0.25, vegetation: 0 },
    factories: 30,
    goal: { label: "Végétation > 20 %", check: (s) => s.vegetation > 0.2 },
  },
  iceball: {
    label: "Boule de glace",
    brief: "Cette planète (1,16 UA de son étoile, rotation rapide) est prise dans les glaces : sans eau liquide, la végétation plafonne à une petite frange désertique et n'ira jamais plus loin. Ajoute des usines pour produire du CO2, réchauffer suffisamment pour faire fondre la glace — mais pas trop, sous peine de rebasculer dans l'autre excès.",
    fixed: { metals: 0.8, distance: 1.16, rotation: 0.9, volcanism: 0.15 },
    dynamic: { size: 1, water: 0.6, co2: 0.02, vegetation: 0.02 },
    factories: 0,
    goal: { label: "Végétation > 50 %", check: (s) => s.vegetation > 0.5 },
  },
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
// Rampe lissée : 0 avant `from`, 1 après `from + range`, linéaire entre les deux.
const ramp = (x, from, range) => clamp((x - from) / range);

// Bandes de latitude équateur→pôle (5 bandes de 18°), pour calculer une calotte polaire de
// taille variable plutôt qu'une seule température globale. `w` = poids (fraction de la
// surface d'une sphère couverte par cette bande, aire d'une zone sphérique = sin(haut)−sin(bas)
// en radians, les deux hémisphères étant symétriques). `f` = position pôle↔équateur (0 =
// équateur, 1 = pôle), au centre de la bande, utilisée pour interpoler sa température locale.
const LAT_BANDS = [
  { w: 0.309, f: 0.1 },
  { w: 0.279, f: 0.3 },
  { w: 0.221, f: 0.5 },
  { w: 0.142, f: 0.7 },
  { w: 0.049, f: 0.9 },
];

function coeffValues() {
  const c = {};
  for (const k in COEFFS) c[k] = COEFFS[k].value;
  return c;
}

// Température d'équilibre radiatif pure (sans serre/albédo) : ne dépend que de la distance.
function insolation(fixed) {
  return 278 / Math.sqrt(fixed.distance) - 273;
}

// Atmosphère initiale déduite de la taille/masse de la planète (gravité qui retient les gaz
// dès l'origine) plutôt que réglée à la main.
function initialAtmosphere(dynamic, c) {
  // le gaz inerte primordial ne remplit qu'une partie de la capacité totale (le reste de
  // la « place disponible » se remplit avec le temps via le dégazage volcanique — H2O,
  // CO2, cendres) ; sinon rien ne pourrait jamais s'ajouter dès le premier pas.
  return clamp(dynamic.size * c.sizeToAtm * 0.4, 0, 2);
}

// Grandeurs déduites de l'état courant (pas de mémoire propre).
function derive(fixed, s, factories, c) {
  // champ magnétique : effet dynamo, a besoin d'un noyau conducteur (métaux), d'une
  // rotation suffisante pour le brasser, ET d'une chaleur interne suffisante pour le faire
  // convecter (activité volcanique, indice de l'énergie interne disponible) — il manque
  // n'importe lequel des trois et il n'y a aucun champ, comme Vénus (métaux mais rotation
  // quasi nulle) ou une planète refroidie et géologiquement morte (plus de convection).
  const magnetic = clamp(fixed.metals / c.magneticMetals)
    * ramp(fixed.rotation, 0, c.magneticRotation)
    * ramp(fixed.volcanism, 0, c.magneticVolcanism);
  const baseTemp = insolation(fixed);
  const temp = s.temp;

  // glace / océans / vapeur : rampes lissées autour des points de gel et d'ébullition,
  // l'eau liquide a aussi besoin d'une pression (atmosphère) suffisante — sinon elle est
  // instable comme sur Mars, même si la température le permettrait.
  // La calotte polaire est calculée par bandes de latitude plutôt que sur la seule
  // moyenne globale : une rotation lente redistribue mal la chaleur (écart pôle-équateur
  // marqué, extrêmes plus forts), ce qui peut donner une grande calotte même si la
  // moyenne globale reste tempérée — et sa taille pèse directement sur l'albédo.
  const gradient = c.poleGradient * (1 - fixed.rotation);
  let ice = 0;
  for (const b of LAT_BANDS) {
    const localTemp = temp + gradient * (1 - 2 * b.f);
    ice += b.w * s.water * ramp(c.oceanFreeze - localTemp, 0, c.freezeRange);
  }
  const iceFrac = s.water > 0 ? ice / s.water : 0;
  // l'eau liquide a aussi besoin d'une pression suffisante (sinon elle bout/s'évapore,
  // comme sur Mars, même à température modérée) — mais ça ne la fait pas disparaître
  // d'un coup : ce qui ne peut pas rester liquide bascule en vapeur (ou reste gelé si
  // c'est déjà de la glace), proportionnellement et progressivement, pas par interrupteur.
  const pressureFrac = ramp(s.atmosphere, 0, c.minPressureLiquid);
  const vaporByTemp = ramp(temp - c.vaporStart, 0, c.vaporRange);
  const potentialLiquid = clamp(1 - iceFrac - vaporByTemp);
  const oceans = s.water * potentialLiquid * pressureFrac;
  const vapor = s.water * clamp(vaporByTemp + potentialLiquid * (1 - pressureFrac));

  const transparency = clamp(1 - s.haze);
  // albédo : glace et cendres au sol (claires, réfléchissent) montent, océans et végétation
  // (sombres, absorbent) baissent. Le nuage de cendres en suspension ne compte que passé
  // 50 % d'opacité (sinon trop fin pour changer la réflectivité globale) — c'est cette
  // composition de l'atmosphère qui pèse sur l'albédo, pas un refroidissement déconnecté.
  const hazeAlbedo = c.albedoHaze * ramp(s.haze, 0.5, 0.5);
  const albedo = clamp(c.albedoBase + c.albedoIce * ice + c.albedoAsh * s.groundAsh + hazeAlbedo - c.albedoOcean * oceans - c.albedoVeg * s.vegetation, 0.05, 0.9);

  // la couche de cendres en altitude bloque le rayonnement : au-delà du seuil, l'effet de
  // serre (gaz inerte + CO2 + vapeur) ne peut plus s'exercer du tout ; il reprend dès que
  // le nuage se dissipe, proportionnellement à ce qu'il reste de CO2/vapeur à ce moment.
  const greenhouseActive = clamp(1 - ramp(s.haze, c.ashShieldStart, c.ashShieldRange));

  // température d'équilibre : insolation ajustée par l'albédo, plus les effets de serre
  // (atmosphère/CO2, vapeur d'eau) sauf si les cendres les bloquent.
  const equilibriumTemp = baseTemp
    + c.albedoSensitivity * (c.albedoBase - albedo)
    + greenhouseActive * (s.atmosphere * (c.naturalGreen + c.greenhouse * s.co2) + c.vaporGreenhouse * vapor);

  // capacité totale de l'atmosphère (gravité/taille) et remplissage actuel, tous gaz
  // confondus (gaz inerte + CO2 + vapeur + cendres) — la « jauge de place disponible »
  // affichée dans le panneau. C'est cette pression totale, pas le seul gaz inerte, qui
  // compte pour la végétation et le vent ci-dessous.
  const atmTotal = s.atmosphere + s.co2 + vapor + s.haze;
  const atmCapacity = Math.max(0.0001, s.size * c.sizeToAtm);
  const atmFill = clamp(atmTotal / atmCapacity);

  const overheat = c.overheatRef * (1 - c.overheatDist + c.overheatDist * fixed.distance);
  // la végétation (terrestre + marine) est plafonnée par la couverture d'océan actuelle,
  // et une atmosphère mince limite aussi la densité de vie que le sol peut soutenir à
  // terme (pas seulement la vitesse à laquelle elle s'installe) : CO2/O2 disponibles,
  // rétention de l'eau, protection contre les UV.
  const oceanCap = oceans < 0.1 ? c.desertCap : c.desertCap + (1 - c.desertCap) * clamp(oceans / 0.5);
  const vegCap = oceanCap * clamp(atmTotal / 0.5);
  // vent : rotation rapide et atmosphère dense amplifient l'effet d'un écart thermique
  const wind = c.windRotation * fixed.rotation + c.windAtmosphere * atmTotal * clamp(Math.abs(temp - baseTemp) / 40);
  // part du CO2 atmosphérique captée chaque année, par le vivant terrestre et par le
  // phytoplancton océanique. Les deux retombent à 0 sans végétation : dans ce modèle,
  // c'est la vie (pas l'eau en elle-même) qui capte le CO2 — pas de biosphère, pas de
  // régulation du climat.
  const bioPresence = ramp(s.vegetation, 0, c.lifeSeed * 20);
  const co2AbsorbVeg = c.vegAbsorb * s.vegetation;
  const co2AbsorbOcean = c.oceanAbsorb * oceans * bioPresence;

  return { magnetic, baseTemp, temp, equilibriumTemp, ice, oceans, vapor, pressureFrac, transparency, albedo, greenhouseActive, atmTotal, atmCapacity, atmFill, overheat, vegCap, wind, co2AbsorbVeg, co2AbsorbOcean, groundAsh: s.groundAsh };
}

// Avance l'état d'un an. Retourne le nouvel état (l'ancien n'est pas modifié).
function step(fixed, s, factories, c) {
  const d = derive(fixed, s, factories, c);
  const { size } = s; // n'évolue jamais : simple passage à travers
  let { atmosphere, co2, vegetation, haze, erosion, water, groundAsh } = s;

  // sans pression suffisante, l'eau exposée (océans, vapeur) s'échappe peu à peu vers
  // l'espace, de façon irréversible — mais la glace polaire, elle, est protégée (comme sur
  // Mars, qui garde sa glace malgré 4 milliards d'années d'atmosphère quasi nulle) : si une
  // atmosphère se reconstitue plus tard, cette glace redevient une vraie source d'eau.
  const iceFrac = water > 0 ? d.ice / water : 0;
  water = Math.max(0, water - c.waterEscape * water * (1 - iceFrac) * (1 - d.pressureFrac));

  // gaz inerte (N2/O2) : fuite sans champ magnétique, aucune reconstitution (le volcanisme
  // ne produit pas ce genre de gaz, voir plus bas) — une planète finit donc par voir son
  // atmosphère dominée par ce que le volcanisme produit réellement (H2O, CO2), même si
  // elle a démarré avec surtout du gaz inerte. Une planète plus grande/massive le retient
  // mieux par sa seule gravité, indépendamment du champ magnétique.
  const gravityFactor = clamp(1 - c.gravityRetention * (size - 0.5), 0.1, 2);
  const loss = (c.dissipation * (1 - d.magnetic) + c.baseLoss) * gravityFactor;
  atmosphere = clamp(atmosphere - atmosphere * loss, 0, d.atmCapacity);

  // dégazage volcanique : un seul flux, réparti entre CO2 et cendres (voir COEFFS). Le CO2
  // est un vrai gaz qui occupe la place disponible dans l'atmosphère (`room`, la « jauge »
  // affichée dans le panneau) : plus elle est pleine, moins il peut en rentrer. Les
  // cendres sont des particules en suspension, pas un gaz — elles n'occupent pas ce volume
  // et ne sont donc pas limitées par la même jauge. Le CO2 a aussi besoin du champ
  // magnétique pour être retenu (sinon il s'échappe aussi vite qu'il est produit) ; les
  // cendres, simple éjection physique, n'en ont pas besoin. Pas de lien avec l'eau : elle
  // ne varie plus que par fuite (voir plus haut), c'est une variable d'état initial, pas
  // un produit du volcanisme.
  const volcTotal = c.volcanicOutput * fixed.volcanism;
  const volcCO2 = clamp(c.volcanicCO2Frac, 0, 1);
  const volcAsh = clamp(1 - volcCO2);
  const room = clamp(1 - d.atmFill);

  // CO2 : usines (pas limitées par la place disponible — brûler du charbon ne lutte pas
  // contre une contre-pression physique comme un dégazage volcanique, ça fait juste
  // monter la concentration) + volcans (eux, limités par `room`), absorbé par végétation
  // et océans, emporté avec l'atmosphère
  co2 += factories * c.factoryCo2 + volcTotal * volcCO2 * d.magnetic * room;
  co2 -= co2 * (d.co2AbsorbVeg + d.co2AbsorbOcean);
  co2 -= co2 * loss;
  co2 = clamp(co2, 0, 1);

  // cendres volcaniques : montent avec le volcanisme, retombent seules (boucle
  // stabilisatrice) et d'autant plus vite qu'il y a de l'eau liquide ou de la vapeur — la
  // pluie est le principal mécanisme qui lessive les aérosols/cendres de l'atmosphère.
  const rainout = 1 + c.ashRainout * (d.oceans + d.vapor);
  const ashFalling = c.ashDecay * haze * rainout; // ce qui retombe cette année-là
  haze += volcTotal * volcAsh * (1 - haze) - ashFalling;
  haze = clamp(haze, 0, 1);

  // une partie de ce qui retombe se dépose au sol et s'accumule (assombrit la surface,
  // voir ui.js) ; lentement recouvert/érodé avec le temps, sinon une éruption ancienne
  // resterait visible pour toujours.
  groundAsh = clamp(groundAsh + ashFalling * c.ashDeposit - groundAsh * c.ashWeathering, 0, 1);

  // érosion : suivie pour complétude (vent + eau/glace), sans effet en aval dans ce modèle
  erosion = clamp(erosion + c.erosionRate * d.wind * (d.oceans + d.ice), 0, 1);

  // adaptation climatique : la "zone de confort" de la végétation suit lentement la
  // température réelle, mais ne peut dériver que de ±adaptRange autour du climat
  // naturel de la planète (sans effet de serre) — l'adaptation a des limites.
  const comfortMin = d.baseTemp - c.adaptRange, comfortMax = d.baseTemp + c.adaptRange;
  let comfort = clamp(s.comfort ?? d.baseTemp, comfortMin, comfortMax);
  comfort += c.adaptSpeed * (d.temp - comfort);
  comfort = clamp(comfort, comfortMin, comfortMax);
  const tempFactor = clamp(1 - Math.abs(d.temp - comfort) / c.tempTolerance);

  // végétation : croît si atmosphère + température OK ; le CO2 qu'elle consomme la
  // fait pousser plus vite (fertilisation) jusqu'à un seuil au-delà duquel il devient
  // toxique. S'effondre aussi en cas de surchauffe. Les cendres volcaniques en
  // suspension bloquent une partie de la lumière (et retombent sur les feuilles),
  // ce qui ralentit directement la croissance (en plus de l'effet sur l'albédo/climat
  // une fois le nuage assez épais, voir `albedoHaze` dans `derive`).
  const atmTotalNow = atmosphere + co2 + d.vapor + haze; // pression totale actuelle, pas le seul gaz inerte
  const lifeOk = atmTotalNow > c.atmMinVeg && d.temp < d.overheat;
  if (lifeOk) {
    const co2Fert = clamp(co2 / c.co2Optimal);
    const boost = 1 + c.co2Boost * co2Fert;
    vegetation += c.growth * vegetation * (1 - vegetation / d.vegCap) * tempFactor * boost * d.transparency;
    if (vegetation < c.lifeSeed * 20) vegetation += c.lifeSeed * tempFactor * d.transparency;
  }
  if (d.temp > d.overheat) vegetation -= vegetation * c.collapse * ((d.temp - d.overheat) / 10);
  if (co2 > c.co2Toxic) vegetation -= vegetation * c.co2Damage * clamp((co2 - c.co2Toxic) / Math.max(0.01, 1 - c.co2Toxic));
  if (atmTotalNow <= c.atmMinVeg) vegetation -= vegetation * 0.05;
  if (vegetation > d.vegCap) vegetation -= (vegetation - d.vegCap) * 0.1;
  vegetation = clamp(vegetation, 0, 1);

  // température : s'approche de l'équilibre climatique, ralentie par l'inertie thermique
  // des océans. Cette inertie est plus forte à la hausse qu'à la baisse : les océans
  // absorbent préférentiellement l'excès de chaleur (comme dans la réalité, où ils captent
  // l'essentiel du réchauffement) — un même écart à l'équilibre se résorbe donc plus
  // lentement en se réchauffant qu'en se refroidissant.
  const warming = d.equilibriumTemp > d.temp;
  const oceanBuffer = c.oceanDamping * d.oceans * (warming ? c.oceanWarmBuffer : 1);
  const ease = clamp(c.climateEase - oceanBuffer, 0.02, 1);
  const temp = d.temp + ease * (d.equilibriumTemp - d.temp);

  return { atmosphere, co2, vegetation, comfort, haze, erosion, temp, water, size, groundAsh };
}

if (typeof module !== "undefined") {
  module.exports = { COEFFS, PRESETS, MISSIONS, FIXED_DEFAULTS, DYNAMIC_DEFAULTS, clamp, coeffValues, insolation, initialAtmosphere, derive, step };
}

// `npm run sim` : trajectoire des archétypes, sans puis avec 30 usines dès l'an 150.
if (typeof require !== "undefined" && require.main === module) {
  const c = coeffValues();
  for (const key in PRESETS) {
    const p = PRESETS[key];
    let s = { ...p.dynamic, atmosphere: initialAtmosphere(p.dynamic, c), temp: insolation(p.fixed), haze: 0, erosion: 0, groundAsh: 0 };
    const rows = [];
    for (let t = 0; t <= 600; t++) {
      const factories = t >= 150 ? 30 : 0;
      if (t % 100 === 0) {
        const d = derive(p.fixed, s, factories, c);
        rows.push(
          `an ${String(t).padStart(3)} | atm ${s.atmosphere.toFixed(2)} co2 ${s.co2.toFixed(3)} veg ${s.vegetation.toFixed(2)} haze ${s.haze.toFixed(2)} | ` +
          `${d.temp.toFixed(0)}°C (éq ${d.equilibriumTemp.toFixed(0)}, seuil ${d.overheat.toFixed(0)}) océans ${(d.oceans * 100).toFixed(0)}% glace ${(d.ice * 100).toFixed(0)}%`
        );
      }
      s = step(p.fixed, s, factories, c);
    }
    console.log(`\n${p.label}\n  ` + rows.join("\n  "));
  }
}
