// Constantes physiques et de pilotage de la simulation.

export const G = 800; // constante de gravité (échelle jeu, pas la vraie valeur)

// horloge de jeu : la simulation avance par pas fixes, exactement comme la
// prédiction. Le plan exécuté suit donc au pas près le tracé planifié.
export const SIM_DT = 1 / 60;

export const SHIP_SIZE = 14;

export const THRUST_ACCEL = 45; // accélération à pleine puissance

export const LANDED_ROTATION_SPEED = 3.6; // rad/s — rotation au sol, sans inertie

// carburant exprimé en Δv : chaque seconde de poussée à pleine puissance
// consomme THRUST_ACCEL unités. Réservoir vide = plus de poussée.
export const FUEL_MAX = 500;

// atterrissage : sans danger si le vaisseau touche par l'arrière (nez vers
// l'extérieur), à une vitesse d'impact raisonnable — sinon c'est un crash.
export const LANDING_MAX_ANGLE = (45 * Math.PI) / 180;

export const LANDING_MAX_SPEED = 120;

// atmosphère : seuls certains astres en ont une (cf. BODY_CONFIGS, champ
// `atmosphere`). Densité décroissante avec l'altitude (échelle = hauteur/5,
// approximation d'une vraie atmosphère) ; parkingRadius() tient compte de la
// hauteur pour qu'une orbite de parking normale reste au-dessus, mais une
// orbite basse ou un passage au ras du sol la traversent franchement. Elle
// freine (traînée en v²) et échauffe (flux en v³) le vaisseau ; au-delà de
// HEAT_MAX, il se consume.
export const DRAG_COEFF = 0.0035; // accél. de freinage = DRAG_COEFF × densité × vitesse²

export const HEAT_RATE = 0.00004; // gain de chaleur/s = HEAT_RATE × densité × vitesse³

export const HEAT_COOLING = 3; // perte de chaleur/s par rayonnement, même hors atmosphère

export const HEAT_MAX = 100;

// rotation façon RCS spatial : maintenir ←/→ accélère en continu la vitesse
// angulaire, un tapotement bref ne fait qu'un petit ajustement. Sans
// frottement, la vitesse angulaire persiste jusqu'à ce qu'on la contre.
export const ROTATION_ACCEL = 1.5; // rad/s² pendant que la touche est maintenue

export const ROTATION_TAP_UNIT = 0.15; // rad/s ≈ un tapotement bref — unité d'affichage des "coups"

// assistance au cap : si le vaisseau tourne très lentement et se trouve déjà
// près d'un cap remarquable (prograde/rétrograde/perpendiculaire à la
// vitesse), il s'y accroche automatiquement.
export const SNAP_ANGULAR_VELOCITY = 0.05; // rad/s — rotation quasi nulle

export const SNAP_ANGLE_TOLERANCE = 0.1; // rad — proximité requise pour accrocher

export const SNAP_PULL = 0.08; // fraction de l'écart corrigée par frame (effet doux)

// pilote automatique : pivote à vitesse constante vers le cap de la
// manœuvre. Ce temps de rotation retarde d'autant le début de la poussée.
export const AUTOPILOT_SLEW_RATE = 1.2; // rad/s

export const COAST = { left: false, right: false, thrust: 0, slewTo: null, assist: false };
