// Constantes physiques et de pilotage de la simulation.
//
// Les constantes réglables (cf. TUNABLE plus bas) sont des `let`, pas des
// `const` : les imports ES module sont des liaisons vivantes, donc toute
// réaffectation ici (via setConstant) se reflète immédiatement partout où
// elles sont importées par leur nom, sans rien changer aux usages.

export const G = 800; // constante de gravité (échelle jeu, pas la vraie valeur)

// horloge de jeu : la simulation avance par pas fixes, exactement comme la
// prédiction. Le plan exécuté suit donc au pas près le tracé planifié.
export const SIM_DT = 1 / 60;

export const SHIP_SIZE = 14;

export let THRUST_ACCEL = 45; // accélération à pleine puissance (masse de référence 1, cf. sim/ship.js thrustAccel)

export let LANDED_ROTATION_SPEED = 3.6; // rad/s — rotation au sol, sans inertie

// carburant exprimé en Δv : chaque seconde de poussée à pleine puissance
// consomme THRUST_ACCEL unités. Réservoir vide = plus de poussée.
export let FUEL_MAX = 500;

// atterrissage : sans danger si le vaisseau touche par l'arrière (nez vers
// l'extérieur), à une vitesse d'impact raisonnable — sinon c'est un crash.
export let LANDING_MAX_ANGLE = (45 * Math.PI) / 180;

export let LANDING_MAX_SPEED = 120;

// atmosphère : seuls certains astres en ont une (cf. BODY_CONFIGS, champ
// `atmosphere`). Densité décroissante avec l'altitude (échelle = hauteur/5,
// approximation d'une vraie atmosphère) ; parkingRadius() tient compte de la
// hauteur pour qu'une orbite de parking normale reste au-dessus, mais une
// orbite basse ou un passage au ras du sol la traversent franchement. Elle
// freine (traînée en v²) et échauffe (flux en v³) le vaisseau ; au-delà de
// HEAT_MAX, il se consume.
export let DRAG_COEFF = 0.0035; // accél. de freinage = DRAG_COEFF × densité × vitesse²

export let HEAT_RATE = 0.00004; // gain de chaleur/s = HEAT_RATE × densité × vitesse³

export let HEAT_COOLING = 3; // perte de chaleur/s par rayonnement, même hors atmosphère

export let HEAT_MAX = 100;

// rotation façon RCS spatial : maintenir ←/→ accélère en continu la vitesse
// angulaire, un tapotement bref ne fait qu'un petit ajustement. Sans
// frottement, la vitesse angulaire persiste jusqu'à ce qu'on la contre.
export let ROTATION_ACCEL = 1.5; // rad/s² pendant que la touche est maintenue

export const ROTATION_TAP_UNIT = 0.15; // rad/s ≈ un tapotement bref — unité d'affichage des "coups"

// assistance au cap : si le vaisseau tourne très lentement et se trouve déjà
// près d'un cap remarquable (prograde/rétrograde/perpendiculaire à la
// vitesse), il s'y accroche automatiquement.
export let SNAP_ANGULAR_VELOCITY = 0.05; // rad/s — rotation quasi nulle

export let SNAP_ANGLE_TOLERANCE = 0.1; // rad — proximité requise pour accrocher

export let SNAP_PULL = 0.08; // fraction de l'écart corrigée par frame (effet doux)

// pilote automatique : pivote à vitesse constante vers le cap de la
// manœuvre. Ce temps de rotation retarde d'autant le début de la poussée.
export let AUTOPILOT_SLEW_RATE = 1.2; // rad/s

export const COAST = { left: false, right: false, thrust: 0, slewTo: null, assist: false };

// ---------------------------------------------------------------------------
// Réglages exposés au panneau de configuration (menu ⚙). `unit: "deg"`
// affiche/édite en degrés une constante stockée en radians.
// ---------------------------------------------------------------------------
const SETTERS = {
  THRUST_ACCEL: (v) => (THRUST_ACCEL = v),
  LANDED_ROTATION_SPEED: (v) => (LANDED_ROTATION_SPEED = v),
  FUEL_MAX: (v) => (FUEL_MAX = v),
  LANDING_MAX_ANGLE: (v) => (LANDING_MAX_ANGLE = v),
  LANDING_MAX_SPEED: (v) => (LANDING_MAX_SPEED = v),
  DRAG_COEFF: (v) => (DRAG_COEFF = v),
  HEAT_RATE: (v) => (HEAT_RATE = v),
  HEAT_COOLING: (v) => (HEAT_COOLING = v),
  HEAT_MAX: (v) => (HEAT_MAX = v),
  ROTATION_ACCEL: (v) => (ROTATION_ACCEL = v),
  SNAP_ANGULAR_VELOCITY: (v) => (SNAP_ANGULAR_VELOCITY = v),
  SNAP_ANGLE_TOLERANCE: (v) => (SNAP_ANGLE_TOLERANCE = v),
  SNAP_PULL: (v) => (SNAP_PULL = v),
  AUTOPILOT_SLEW_RATE: (v) => (AUTOPILOT_SLEW_RATE = v),
};

export const TUNABLE = [
  { key: "THRUST_ACCEL", label: "Poussée (accél. max)", min: 5, max: 200, step: 1 },
  { key: "FUEL_MAX", label: "Carburant max (Δv)", min: 50, max: 2000, step: 10 },
  { key: "DRAG_COEFF", label: "Traînée atmosphérique", min: 0, max: 0.02, step: 0.0005 },
  { key: "HEAT_RATE", label: "Échauffement", min: 0, max: 0.004, step: 0.00005 },
  { key: "HEAT_COOLING", label: "Refroidissement", min: 0, max: 20, step: 0.5 },
  { key: "HEAT_MAX", label: "Jauge de chaleur max", min: 10, max: 500, step: 10 },
  { key: "LANDING_MAX_SPEED", label: "Vitesse d'atterrissage max", min: 10, max: 400, step: 5 },
  { key: "LANDING_MAX_ANGLE", label: "Inclinaison d'atterrissage max", min: 5, max: 90, step: 1, unit: "deg" },
  { key: "ROTATION_ACCEL", label: "Accél. de rotation (manuel)", min: 0.1, max: 10, step: 0.1 },
  { key: "LANDED_ROTATION_SPEED", label: "Vitesse de rotation au sol", min: 0.5, max: 10, step: 0.1 },
  { key: "AUTOPILOT_SLEW_RATE", label: "Vitesse de pivot (pilote auto)", min: 0.1, max: 5, step: 0.1 },
  { key: "SNAP_ANGULAR_VELOCITY", label: "Seuil d'accroche au cap", min: 0, max: 0.5, step: 0.01 },
  { key: "SNAP_ANGLE_TOLERANCE", label: "Tolérance d'accroche au cap", min: 0, max: 0.5, step: 0.01 },
  { key: "SNAP_PULL", label: "Force d'accroche au cap", min: 0, max: 1, step: 0.01 },
];

const GETTERS = {
  THRUST_ACCEL: () => THRUST_ACCEL,
  LANDED_ROTATION_SPEED: () => LANDED_ROTATION_SPEED,
  FUEL_MAX: () => FUEL_MAX,
  LANDING_MAX_ANGLE: () => LANDING_MAX_ANGLE,
  LANDING_MAX_SPEED: () => LANDING_MAX_SPEED,
  DRAG_COEFF: () => DRAG_COEFF,
  HEAT_RATE: () => HEAT_RATE,
  HEAT_COOLING: () => HEAT_COOLING,
  HEAT_MAX: () => HEAT_MAX,
  ROTATION_ACCEL: () => ROTATION_ACCEL,
  SNAP_ANGULAR_VELOCITY: () => SNAP_ANGULAR_VELOCITY,
  SNAP_ANGLE_TOLERANCE: () => SNAP_ANGLE_TOLERANCE,
  SNAP_PULL: () => SNAP_PULL,
  AUTOPILOT_SLEW_RATE: () => AUTOPILOT_SLEW_RATE,
};

export function getConstant(key) {
  return GETTERS[key]();
}

export function setConstant(key, value) {
  SETTERS[key](value);
}
