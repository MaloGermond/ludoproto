// Prototype "lancer, orbiter" — issue #4
// Un vaisseau décolle de la surface de la Terre et peut être placé en orbite.
// Système solaire configurable : voir BODY_CONFIGS.
//
// Mode navigation — issue #5
// Un bouton met le jeu en pause et ouvre la planification : on pose des
// points de manœuvre (rotation + poussée) sur le tracé prédit, ou on laisse
// le calculateur de route viser une orbite autour d'un astre, puis on relance
// le jeu et le pilote automatique exécute le plan.
//
// Gravité en "patched conics" (comme Kerbal Space Program) : le vaisseau ne
// subit que l'attraction de l'astre dont il occupe la sphère d'influence. Son
// état est stocké relativement à cet astre ; en sortant de la sphère il passe
// dans celle du parent, en entrant dans celle d'un satellite il passe dans
// celle-ci. Les orbites restent ainsi stables et prévisibles.

const G = 800; // constante de gravité (échelle jeu, pas la vraie valeur)

// horloge de jeu : la simulation avance par pas fixes, exactement comme la
// prédiction. Le plan exécuté suit donc au pas près le tracé planifié.
const SIM_DT = 1 / 60;
const MAX_FRAME_DT = 0.25; // évite une avalanche de pas après un onglet en arrière-plan
const WARP_LEVELS = [1, 2, 5, 10, 25, 50, 100]; // accélération du temps

const SHIP_SIZE = 14;
const THRUST_ACCEL = 45; // accélération à pleine puissance
const LANDED_ROTATION_SPEED = 3.6; // rad/s — rotation au sol, sans inertie

// carburant exprimé en Δv : chaque seconde de poussée à pleine puissance
// consomme THRUST_ACCEL unités. Réservoir vide = plus de poussée.
const FUEL_MAX = 500;

// atterrissage : sans danger si le vaisseau touche par l'arrière (nez vers
// l'extérieur), à une vitesse d'impact raisonnable — sinon c'est un crash.
const LANDING_MAX_ANGLE = (45 * Math.PI) / 180;
const LANDING_MAX_SPEED = 120;

// rotation façon RCS spatial : maintenir ←/→ accélère en continu la vitesse
// angulaire, un tapotement bref ne fait qu'un petit ajustement. Sans
// frottement, la vitesse angulaire persiste jusqu'à ce qu'on la contre.
const ROTATION_ACCEL = 1.5; // rad/s² pendant que la touche est maintenue
const ROTATION_TAP_UNIT = 0.15; // rad/s ≈ un tapotement bref — unité d'affichage des "coups"

// assistance au cap : si le vaisseau tourne très lentement et se trouve déjà
// près d'un cap remarquable (prograde/rétrograde/perpendiculaire à la
// vitesse), il s'y accroche automatiquement.
const SNAP_ANGULAR_VELOCITY = 0.05; // rad/s — rotation quasi nulle
const SNAP_ANGLE_TOLERANCE = 0.1; // rad — proximité requise pour accrocher
const SNAP_PULL = 0.08; // fraction de l'écart corrigée par frame (effet doux)

// pilote automatique : pivote à vitesse constante vers le cap de la
// manœuvre. Ce temps de rotation retarde d'autant le début de la poussée.
const AUTOPILOT_SLEW_RATE = 1.2; // rad/s

// atterrissage guidé : le moteur s'allume quand la décélération nécessaire
// pour s'arrêter au sol atteint cette fraction de la poussée maximale
// ("suicide burn"), puis la poussée est dosée pour toucher le sol à l'arrêt
const LANDING_IGNITION = 0.85;
const LANDING_MAX_TILT = 0.35; // rad — inclinaison max pour annuler la dérive horizontale
const LANDING_TIMEOUT = 3000; // s — garde-fou pour la vérification d'un atterrissage

// prédiction
const PLAN_MAX_HORIZON = 20000; // s — garde-fou, le tracé s'arrête normalement bien avant
const PLAN_TAIL = 60; // s — durée minimale de tracé après la dernière manœuvre
const MAX_TAIL = 2000; // s — au plus une orbite complète après la dernière manœuvre
const ESCAPE_TAIL = 600; // s — trajectoire non liée (évasion)
const THRUST_PREDICTION_HORIZON = 120; // s — tracé allégé pendant une poussée manuelle
const POINT_MAX_ANGLE = 0.026; // rad — un point de tracé tous les ~1,5° autour de l'astre
const POINT_MAX_GAP = 3; // s

// édition
const PICK_RADIUS = 14; // px — distance max d'un clic au tracé pour y poser un point
const NODE_HIT_RADIUS = 12; // px — distance max d'un clic à un point existant
const CLICK_MAX_MOVE = 5; // px — au-delà, le geste est un glisser (déplacement de vue)
const DEFAULT_NODE = { heading: 0, power: 1, duration: 1 };

const COAST = { left: false, right: false, thrust: 0, slewTo: null, assist: false };

const PHASE_STYLES = {
  coast: { color: [130, 255, 170, 180], weight: 1.5, dashed: true },
  rotate: { color: [255, 230, 120, 220], weight: 2.5, dashed: false },
  burn: { color: [255, 150, 60, 240], weight: 3.5, dashed: false },
};

// ---------------------------------------------------------------------------
// Système solaire — configuration déclarative. Pour ajouter un astre,
// ajouter une entrée ; pour en retirer un, supprimer l'entrée ou mettre
// `enabled: false`. `parent` référence l'id de l'astre autour duquel il
// orbite (null pour l'astre central, fixe). `phase` : position de départ sur
// l'orbite, en degrés. La vitesse orbitale découle de la loi de Kepler.
//
// Espacements et masses choisis pour que les sphères d'influence ne se
// chevauchent pas (vérifié au chargement) et laissent de la place autour de
// chaque astre pour y orbiter.
// ---------------------------------------------------------------------------

const BODY_CONFIGS = [
  { id: "sun", name: "Soleil", parent: null, radius: 900, mass: 40000, color: [255, 210, 90] },
  { id: "mercury", name: "Mercure", parent: "sun", orbitRadius: 3500, phase: 200, radius: 50, mass: 60, color: [180, 170, 160] },
  { id: "venus", name: "Vénus", parent: "sun", orbitRadius: 6500, phase: 140, radius: 150, mass: 1000, color: [230, 200, 140] },
  { id: "earth", name: "Terre", parent: "sun", orbitRadius: 12000, phase: 0, radius: 220, mass: 1800, color: [90, 140, 200] },
  { id: "moon", name: "Lune", parent: "earth", orbitRadius: 2200, phase: 60, radius: 60, mass: 120, color: [180, 180, 180] },
  { id: "mars", name: "Mars", parent: "sun", orbitRadius: 19000, phase: 70, radius: 120, mass: 500, color: [210, 120, 80] },
  { id: "phobos", name: "Phobos", parent: "mars", orbitRadius: 500, phase: 30, radius: 15, mass: 15, color: [140, 130, 120] },
  { id: "deimos", name: "Déimos", parent: "mars", orbitRadius: 1000, phase: 210, radius: 12, mass: 12, color: [150, 140, 130] },
  { id: "jupiter", name: "Jupiter", parent: "sun", orbitRadius: 36000, phase: 250, radius: 500, mass: 3000, color: [220, 180, 140] },
  { id: "io", name: "Io", parent: "jupiter", orbitRadius: 1900, phase: 0, radius: 45, mass: 50, color: [230, 210, 120] },
  { id: "europa", name: "Europe", parent: "jupiter", orbitRadius: 3600, phase: 90, radius: 40, mass: 45, color: [210, 200, 190] },
  { id: "ganymede", name: "Ganymède", parent: "jupiter", orbitRadius: 6500, phase: 180, radius: 55, mass: 65, color: [160, 150, 140] },
  { id: "callisto", name: "Callisto", parent: "jupiter", orbitRadius: 10500, phase: 270, radius: 50, mass: 60, color: [120, 110, 100] },
  { id: "saturn", name: "Saturne", parent: "sun", orbitRadius: 68000, phase: 320, radius: 420, mass: 1500, color: [230, 210, 160] },
  { id: "titan", name: "Titan", parent: "saturn", orbitRadius: 6000, phase: 45, radius: 65, mass: 60, color: [220, 180, 110] },
  { id: "uranus", name: "Uranus", parent: "sun", orbitRadius: 108000, phase: 30, radius: 260, mass: 600, color: [160, 220, 230] },
  { id: "titania", name: "Titania", parent: "uranus", orbitRadius: 5500, phase: 120, radius: 35, mass: 20, color: [180, 190, 195] },
  { id: "neptune", name: "Neptune", parent: "sun", orbitRadius: 160000, phase: 170, radius: 250, mass: 600, color: [100, 140, 230] },
  // orbite rétrograde (comme dans la réalité) : vitesse de Kepler forcée en négatif
  { id: "triton", name: "Triton", parent: "neptune", orbitRadius: 6500, orbitSpeed: -0.00132, phase: 80, radius: 40, mass: 25, color: [230, 220, 210] },
];

const ALL_BODIES = BODY_CONFIGS.filter((c) => c.enabled !== false).map((c) => ({ ...c, x: 0, y: 0, vx: 0, vy: 0, children: [] }));
const bodyById = Object.fromEntries(ALL_BODIES.map((b) => [b.id, b]));
for (const b of ALL_BODIES) {
  b.mu = G * b.mass;
  b.parentBody = b.parent ? bodyById[b.parent] : null;
}
for (const b of ALL_BODIES) {
  if (!b.parentBody) {
    b.soi = Infinity;
    continue;
  }
  b.parentBody.children.push(b);
  b.orbitSpeed = b.orbitSpeed ?? Math.sqrt(b.parentBody.mu / Math.pow(b.orbitRadius, 3));
  b.phase0 = ((b.phase || 0) * Math.PI) / 180;
  // sphère d'influence par rapport au parent (formule patched-conics)
  b.soi = b.orbitRadius * Math.pow(b.mass / b.parentBody.mass, 2 / 5);
}
// avertit si deux sphères d'influence voisines se chevauchent
for (const b of ALL_BODIES) {
  const kids = [...b.children].sort((a, c) => a.orbitRadius - c.orbitRadius);
  for (let i = 1; i < kids.length; i++) {
    if (kids[i - 1].orbitRadius + kids[i - 1].soi > kids[i].orbitRadius - kids[i].soi) {
      console.warn(`Sphères d'influence qui se chevauchent : ${kids[i - 1].name} / ${kids[i].name}`);
    }
  }
  if (b.parentBody && kids.length && kids[kids.length - 1].orbitRadius + kids[kids.length - 1].soi > b.soi) {
    console.warn(`${kids[kids.length - 1].name} sort de la sphère d'influence de ${b.name}`);
  }
}

const sun = ALL_BODIES.find((b) => !b.parentBody);
const planet = bodyById.earth; // astre de départ du vaisseau

let ship;
let trail = [];
const TRAIL_MAX = 600;

let gameTime = 0;
let simAccumulator = 0;
let warpIndex = 0;

let cameraX = 0;
let cameraY = 0;
let zoom = 1;
let zoomBias = 1; // réglage molette en caméra suiveuse
let cameraFree = false;
let cameraFrame = null; // astre avec lequel la caméra se déplace

// "flight" : jeu en cours · "planning" : jeu en pause, édition du plan
let mode = "flight";
let planNodes = []; // manœuvres en cours d'édition
let planTarget = null; // orbite visée par le calculateur de route { body, radius }
let nextNodeId = 1;
let selectedNodeId = null;
let planPrediction = null; // tracé mis en cache pendant la planification
let planDirty = true;
let autopilot = null; // plan en cours d'exécution
let autopilotPrediction = null; // son tracé : l'exécution est déterministe, il reste valable
let autopilotTarget = null;
let flightPrediction = null;
let flightPredictionDirty = true;

let pointer = null; // geste souris en cours
let routeMessage = { text: "", error: false };

let canvasElt;
const ui = {};

function setup() {
  canvasElt = createCanvas(windowWidth, windowHeight).elt;
  setupUI();
  resetShip();
}

function resetShip() {
  const startAngle = -HALF_PI; // sommet de la planète
  ship = {
    ref: planet,
    rx: Math.cos(startAngle) * (planet.radius + SHIP_SIZE / 2),
    ry: Math.sin(startAngle) * (planet.radius + SHIP_SIZE / 2),
    rvx: 0,
    rvy: 0,
    angle: startAngle, // nez à l'opposé du centre de la planète, prêt à décoller
    angularVelocity: 0,
    size: SHIP_SIZE,
    crashed: false,
    landed: true,
    landedAngle: startAngle,
    thrusting: false,
    fuel: FUEL_MAX,
  };
  syncShipAbsolute(ship, gameTime);
  trail = [];
  autopilot = null;
  autopilotPrediction = null;
  flightPredictionDirty = true;
  cameraX = ship.x; // évite un panoramique depuis le Soleil au démarrage/relance
  cameraY = ship.y;
  cameraFrame = null;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ---------------------------------------------------------------------------
// Astres : positions en fonction du temps de jeu (orbites circulaires "sur
// rails", comme dans KSP)
// ---------------------------------------------------------------------------

// position/vitesse d'un astre relativement à son parent
function localOrbit(body, t) {
  const a = body.phase0 + body.orbitSpeed * t;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = body.orbitRadius;
  const w = body.orbitSpeed;
  return { x: r * c, y: r * s, vx: -r * w * s, vy: r * w * c };
}

function bodyPositionAt(body, t) {
  if (!body.parentBody) return { x: 0, y: 0 };
  const p = bodyPositionAt(body.parentBody, t);
  const o = localOrbit(body, t);
  return { x: p.x + o.x, y: p.y + o.y };
}

function bodyVelocityAt(body, t) {
  if (!body.parentBody) return { vx: 0, vy: 0 };
  const p = bodyVelocityAt(body.parentBody, t);
  const o = localOrbit(body, t);
  return { vx: p.vx + o.vx, vy: p.vy + o.vy };
}

// met à jour la position/vitesse affichée de chaque astre à l'instant t
function bodies(t) {
  for (const body of ALL_BODIES) {
    const pos = bodyPositionAt(body, t);
    const vel = bodyVelocityAt(body, t);
    body.x = pos.x;
    body.y = pos.y;
    body.vx = vel.vx;
    body.vy = vel.vy;
  }
  return ALL_BODIES;
}

function isAncestorOrSelf(ancestor, body) {
  for (let b = body; b; b = b.parentBody) if (b === ancestor) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Physique du vaisseau — partagée par la simulation et la prédiction.
// État relatif à l'astre de référence `ref` : rx, ry, rvx, rvy.
// ---------------------------------------------------------------------------

function angleDiff(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > PI) d -= TWO_PI;
  if (d < -PI) d += TWO_PI;
  return d;
}

function slewToward(angle, target, maxStep) {
  const d = angleDiff(angle, target);
  if (Math.abs(d) <= maxStep) return target;
  return angle + Math.sign(d) * maxStep;
}

function cloneShip(s) {
  return { ...s };
}

// position/vitesse absolues (affichage, caméra)
function syncShipAbsolute(s, t) {
  const p = bodyPositionAt(s.ref, t);
  const v = bodyVelocityAt(s.ref, t);
  s.x = p.x + s.rx;
  s.y = p.y + s.ry;
  s.vx = v.vx + s.rvx;
  s.vy = v.vy + s.rvy;
}

// changement de sphère d'influence à l'instant t
function updateSphereOfInfluence(s, t) {
  const R = s.ref;
  if (R.parentBody && s.rx * s.rx + s.ry * s.ry > R.soi * R.soi) {
    const o = localOrbit(R, t);
    s.rx += o.x;
    s.ry += o.y;
    s.rvx += o.vx;
    s.rvy += o.vy;
    s.ref = R.parentBody;
    return;
  }
  for (const child of R.children) {
    const o = localOrbit(child, t);
    const dx = s.rx - o.x;
    const dy = s.ry - o.y;
    if (dx * dx + dy * dy < child.soi * child.soi) {
      s.rx = dx;
      s.ry = dy;
      s.rvx -= o.vx;
      s.rvy -= o.vy;
      s.ref = child;
      return;
    }
  }
}

// avance l'état `s` du vaisseau d'un pas `dt` à partir de l'instant `t`.
// `control` : { left, right, thrust (0..1), slewTo (cap visé ou null), assist }
function stepShip(s, t, dt, control) {
  if (s.crashed) return;
  const R = s.ref;

  if (s.landed) {
    const h = R.radius + SHIP_SIZE / 2;
    s.rx = Math.cos(s.landedAngle) * h;
    s.ry = Math.sin(s.landedAngle) * h;
    s.rvx = 0; // posé : le vaisseau se déplace avec l'astre
    s.rvy = 0;
    s.thrusting = false;

    if (control.slewTo !== null) {
      s.angle = slewToward(s.angle, control.slewTo, AUTOPILOT_SLEW_RATE * dt);
    } else {
      if (control.left) s.angle -= LANDED_ROTATION_SPEED * dt;
      if (control.right) s.angle += LANDED_ROTATION_SPEED * dt;
    }

    if (!(control.thrust > 0) || s.fuel <= 0) return; // reste posé tant qu'on ne pousse pas
    s.landed = false; // décollage
  }

  if (control.slewTo !== null) {
    // pilote automatique : rotation à vitesse constante vers le cap du plan,
    // l'inertie de rotation est annulée
    s.angularVelocity = 0;
    s.angle = slewToward(s.angle, control.slewTo, AUTOPILOT_SLEW_RATE * dt);
  } else {
    // rotation manuelle : maintenir accélère en continu, sans frottement —
    // la vitesse angulaire persiste tant qu'on ne la contre pas
    if (control.left) s.angularVelocity -= ROTATION_ACCEL * dt;
    if (control.right) s.angularVelocity += ROTATION_ACCEL * dt;

    // stabilise automatiquement un résidu de rotation quasi nul une fois les
    // touches relâchées : évite d'avoir à tomber pile sur zéro au minutage près
    if (!control.left && !control.right && Math.abs(s.angularVelocity) < SNAP_ANGULAR_VELOCITY) {
      s.angularVelocity = 0;
    }

    s.angle += s.angularVelocity * dt;

    // assistance au cap : rotation quasi nulle + déjà proche d'un cap
    // remarquable (prograde/rétrograde/perpendiculaire) → accroche dessus.
    // Désactivée tant qu'on maintient une touche, pour ne jamais "rattraper"
    // une rotation volontaire et bloquer le vaisseau.
    if (control.assist && !control.left && !control.right && Math.abs(s.angularVelocity) < SNAP_ANGULAR_VELOCITY) {
      if (Math.hypot(s.rvx, s.rvy) > 1) {
        const velocityAngle = Math.atan2(s.rvy, s.rvx);
        const candidates = [velocityAngle, velocityAngle + PI, velocityAngle - HALF_PI, velocityAngle + HALF_PI];
        for (const target of candidates) {
          const diff = angleDiff(s.angle, target);
          if (Math.abs(diff) < SNAP_ANGLE_TOLERANCE) {
            // attraction douce vers le cap plutôt qu'un saut brutal
            s.angle += diff * SNAP_PULL;
            s.angularVelocity = 0;
            break;
          }
        }
      }
    }
  }

  // gravité de l'astre de référence uniquement (patched conics)
  const r2 = s.rx * s.rx + s.ry * s.ry;
  const r = Math.sqrt(r2) || 1;
  const g = R.mu / r2;
  let ax = (-g * s.rx) / r;
  let ay = (-g * s.ry) / r;

  // poussée directionnelle, limitée par le carburant restant
  let thrust = control.thrust > 0 ? control.thrust : 0;
  if (thrust > 0) {
    const cost = thrust * THRUST_ACCEL * dt;
    if (cost > s.fuel) thrust *= s.fuel / cost;
    s.fuel = Math.max(0, s.fuel - thrust * THRUST_ACCEL * dt);
    ax += Math.cos(s.angle) * THRUST_ACCEL * thrust;
    ay += Math.sin(s.angle) * THRUST_ACCEL * thrust;
  }
  s.thrusting = thrust > 0;

  s.rvx += ax * dt;
  s.rvy += ay * dt;
  s.rx += s.rvx * dt;
  s.ry += s.rvy * dt;

  // collision avec l'astre de référence
  const d = Math.hypot(s.rx, s.ry);
  if (d < R.radius + SHIP_SIZE / 2) {
    const outwardAngle = Math.atan2(s.ry, s.rx);
    const tilt = Math.abs(angleDiff(s.angle, outwardAngle));
    const impactSpeed = Math.hypot(s.rvx, s.rvy); // relative à l'astre

    if (tilt <= LANDING_MAX_ANGLE && impactSpeed <= LANDING_MAX_SPEED) {
      // touche par l'arrière, à vitesse raisonnable : atterrissage réussi
      s.landed = true;
      s.landedAngle = outwardAngle;
      s.angle = outwardAngle;
      s.rx = Math.cos(outwardAngle) * (R.radius + SHIP_SIZE / 2);
      s.ry = Math.sin(outwardAngle) * (R.radius + SHIP_SIZE / 2);
      s.rvx = 0;
      s.rvy = 0;
      s.angularVelocity = 0;
    } else {
      s.crashed = true;
    }
    return;
  }

  updateSphereOfInfluence(s, t + dt);
}

// direction du prograde (vitesse relative à l'astre de référence) ; posé au
// sol, c'est la verticale locale
function progradeAngle(s) {
  const radial = Math.atan2(s.ry, s.rx);
  if (s.landed) return s.landedAngle;
  if (Math.hypot(s.rvx, s.rvy) < 1) return radial;
  return Math.atan2(s.rvy, s.rvx);
}

// éléments de l'orbite képlérienne autour de l'astre de référence
function orbitElements(s) {
  const mu = s.ref.mu;
  const r = Math.hypot(s.rx, s.ry);
  const v2 = s.rvx * s.rvx + s.rvy * s.rvy;
  const rv = s.rx * s.rvx + s.ry * s.rvy;
  const k = v2 - mu / r;
  const ex = (k * s.rx - rv * s.rvx) / mu;
  const ey = (k * s.ry - rv * s.rvy) / mu;
  const e = Math.hypot(ex, ey);
  const energy = v2 / 2 - mu / r;
  const bound = energy < 0;
  const a = bound ? -mu / (2 * energy) : Infinity;
  return {
    r,
    e,
    a,
    bound,
    h: s.rx * s.rvy - s.ry * s.rvx,
    period: bound ? TWO_PI * Math.sqrt((a * a * a) / mu) : Infinity,
    periapsis: bound ? a * (1 - e) : r,
    apoapsis: bound ? a * (1 + e) : Infinity,
  };
}

// ---------------------------------------------------------------------------
// Pilote automatique : exécute les manœuvres dans l'ordre chronologique.
// Chaque manœuvre = rotation vers le cap (relatif au prograde au moment où
// elle démarre), puis poussée (puissance × durée). Une manœuvre ne démarre
// qu'une fois la précédente terminée : le temps de rotation décale la suite.
// ---------------------------------------------------------------------------

function createAutopilot(nodes) {
  return {
    nodes: nodes.map(copyNode).sort((a, b) => a.t - b.t),
    index: 0,
    phase: "pending", // "pending" | "rotating" | "burning"
    targetAngle: 0,
    burnEnd: 0,
  };
}

// kind : undefined pour une manœuvre classique (rotation + poussée fixe),
// "land" pour un atterrissage guidé
function copyNode(n) {
  return { id: n.id, kind: n.kind, t: n.t, heading: n.heading, power: n.power, duration: n.duration };
}

// commande de l'atterrissage guidé : nez vers le haut (incliné pour annuler
// la vitesse horizontale), poussée déclenchée au dernier moment et dosée
// pour que vitesse de descente et altitude s'annulent ensemble
function landingControl(s) {
  const R = s.ref;
  const r = Math.hypot(s.rx, s.ry);
  const up = Math.atan2(s.ry, s.rx);
  const h = r - (R.radius + SHIP_SIZE / 2);
  const vRadial = (s.rx * s.rvx + s.ry * s.rvy) / r; // < 0 en descente
  const vTangent = (s.rx * s.rvy - s.ry * s.rvx) / r;
  const g = R.mu / (r * r);

  const target = up + constrain(-vTangent * 0.05, -LANDING_MAX_TILT, LANDING_MAX_TILT);
  const descent = Math.max(0, -vRadial);
  const needed = (descent * descent) / (2 * Math.max(h - 1, 0.5)) + g;
  let thrust = 0;
  if (vRadial < 0 && needed > LANDING_IGNITION * THRUST_ACCEL) thrust = Math.min(1, needed / THRUST_ACCEL);
  // pas de poussée tant que le vaisseau n'est pas orienté
  if (Math.abs(angleDiff(s.angle, target)) > 0.3) thrust = 0;
  return { ...COAST, slewTo: target, thrust };
}

function cloneAutopilot(ap) {
  return { ...ap, nodes: ap.nodes.map((n) => ({ ...n })) };
}

function recordAt(node, key, s, t) {
  node[key + "T"] = t;
  node[key + "Ref"] = s.ref;
  node[key + "X"] = s.rx;
  node[key + "Y"] = s.ry;
}

// fait avancer les phases du plan à l'instant t et renvoie la commande du
// prochain pas, ou null quand le plan est terminé. Note au passage, dans
// chaque manœuvre, où et quand elle a réellement démarré/poussé/fini.
function autopilotControl(ap, s, t) {
  while (ap.index < ap.nodes.length) {
    const node = ap.nodes[ap.index];

    if (ap.phase === "pending") {
      if (t < node.t) return COAST;
      if (node.kind === "land") {
        ap.phase = "landing";
        node.fuelBefore = s.fuel;
        recordAt(node, "start", s, t);
      } else {
        ap.targetAngle = progradeAngle(s) + radians(node.heading);
      ap.phase = "rotating";
        node.targetAngle = ap.targetAngle;
        node.fuelBefore = s.fuel;
        recordAt(node, "start", s, t);
      }
    }

    if (ap.phase === "landing") {
      if (!s.landed) {
        const control = landingControl(s);
        if (control.thrust > 0 && node.burnStartT === undefined) recordAt(node, "burnStart", s, t);
        return control;
      }
      recordAt(node, "end", s, t);
      node.fuelAfter = s.fuel;
      ap.index++;
      ap.phase = "pending";
      continue;
    }

    if (ap.phase === "rotating") {
      if (angleDiff(s.angle, ap.targetAngle) !== 0) {
        return { ...COAST, slewTo: ap.targetAngle };
      }
      ap.phase = "burning";
      ap.burnEnd = t + node.duration;
      recordAt(node, "burnStart", s, t);
    }

    if (ap.phase === "burning") {
      if (node.power > 0 && t < ap.burnEnd - 1e-9) {
        return { ...COAST, slewTo: ap.targetAngle, thrust: node.power };
      }
      recordAt(node, "end", s, t);
      node.fuelAfter = s.fuel;
      ap.index++;
      ap.phase = "pending";
    }
  }
  return null;
}

// manœuvres pas encore terminées, pour les rééditer en cours d'exécution
function remainingNodes(ap, t) {
  return ap.nodes.slice(ap.index).map((n, i) => {
    const node = copyNode(n);
    if (i === 0 && ap.phase !== "pending") {
      node.t = t;
      if (ap.phase === "burning") node.duration = Math.max(0, ap.burnEnd - t);
    }
    return node;
  });
}

// ---------------------------------------------------------------------------
// Simulation "hors jeu" : contexte reprenable (état + plan + temps), utilisé
// par la prédiction et par le calculateur de route. Même pas, même code que
// la simulation en direct : résultats identiques au bit près.
// ---------------------------------------------------------------------------

function makeCtx(state, t, nodes) {
  return { s: cloneShip(state), t, ap: nodes && nodes.length ? createAutopilot(nodes) : null };
}

function cloneCtx(c) {
  return { s: cloneShip(c.s), t: c.t, ap: c.ap ? cloneAutopilot(c.ap) : null };
}

function planDone(ctx) {
  return !ctx.ap || ctx.ap.index >= ctx.ap.nodes.length;
}

// avance le contexte jusqu'à tEnd ; `onStep` peut renvoyer false pour arrêter
function runCtx(ctx, tEnd, onStep) {
  while (ctx.t < tEnd - 1e-9 && !ctx.s.crashed) {
    const control = ctx.ap ? autopilotControl(ctx.ap, ctx.s, ctx.t) || COAST : COAST;
    stepShip(ctx.s, ctx.t, SIM_DT, control);
    ctx.t += SIM_DT;
    if (onStep && onStep(ctx) === false) break;
  }
  return ctx;
}

// ---------------------------------------------------------------------------
// Prédiction de trajectoire, découpée en "patchs" : un patch par sphère
// d'influence traversée. Chaque point est stocké relativement à l'astre de
// son patch ; l'affichage place chaque patch autour de son astre (voir
// displayAnchors).
// ---------------------------------------------------------------------------

// durée de tracé après la dernière manœuvre : une orbite complète si elle
// est fermée, sinon un temps fixe
function tailDuration(s) {
  if (s.landed) return 0;
  const el = orbitElements(s);
  if (el.bound && el.apoapsis < s.ref.soi) return constrain(el.period * 1.02, PLAN_TAIL, MAX_TAIL);
  return ESCAPE_TAIL;
}

function predictPath(startState, t0, plan, maxHorizon) {
  const ctx = { s: cloneShip(startState), t: t0, ap: plan ? cloneAutopilot(plan) : null };
  const s = ctx.s;
  const patches = [{ body: s.ref, t: t0 }];
  const points = [];
  let last = null;
  const pushPoint = (phase) => {
    last = { rx: s.rx, ry: s.ry, t: ctx.t, phase, patch: patches.length - 1 };
    points.push(last);
  };
  pushPoint("coast");

  let lastPhase = "coast";
  let end = null;
  let tEnd = t0 + maxHorizon;
  let orbitStart = null;
  if (planDone(ctx)) {
    orbitStart = t0;
    tEnd = Math.min(tEnd, t0 + tailDuration(s));
  }

  while (ctx.t < tEnd - 1e-9) {
    const control = ctx.ap ? autopilotControl(ctx.ap, s, ctx.t) || COAST : COAST;
    const phase = control.thrust > 0 ? "burn" : control.slewTo !== null ? "rotate" : "coast";
    if (phase !== lastPhase) {
      pushPoint(lastPhase); // borne exacte du changement de phase
      lastPhase = phase;
    }

    const ref = s.ref;
    stepShip(s, ctx.t, SIM_DT, control);
    ctx.t += SIM_DT;

    if (s.ref !== ref) {
      patches.push({ body: s.ref, t: ctx.t });
      pushPoint(phase);
      continue;
    }
    if (s.crashed) {
      end = "crash";
      break;
    }
    const done = planDone(ctx);
    if (s.landed && done && ctx.t > t0 + SIM_DT) {
      end = "landed";
      break;
    }
    if (done && orbitStart === null) {
      orbitStart = ctx.t;
      tEnd = Math.min(tEnd, ctx.t + tailDuration(s));
    }

    // densité de points : fonction de l'angle parcouru autour de l'astre
    const cross = last.rx * s.ry - last.ry * s.rx;
    const dot = last.rx * s.rx + last.ry * s.ry;
    const lastR = Math.hypot(last.rx, last.ry);
    const r = Math.hypot(s.rx, s.ry);
    if (Math.abs(Math.atan2(cross, dot)) > POINT_MAX_ANGLE || Math.abs(r - lastR) > 0.02 * r || ctx.t - last.t > POINT_MAX_GAP) {
      pushPoint(phase);
    }
  }
  pushPoint(lastPhase);

  // seules les manœuvres restantes (les terminées ne s'affichent plus)
  const firstNode = plan ? plan.index : 0;
  const nodes = ctx.ap ? ctx.ap.nodes.slice(firstNode) : [];
  const patchIndexAt = (t, body) => {
    let k = 0;
    for (let j = 0; j < patches.length; j++) if (patches[j].t <= t + 1e-9 && patches[j].body === body) k = j;
    return k;
  };
  for (const n of nodes) {
    if (n.startT !== undefined) n.startPatch = patchIndexAt(n.startT, n.startRef);
    if (n.burnStartT !== undefined) n.burnStartPatch = patchIndexAt(n.burnStartT, n.burnStartRef);
  }

  // apogée/périgée de l'orbite finale (dernier patch, après la dernière manœuvre)
  let periapsis = null;
  let apoapsis = null;
  if (end !== "crash" && orbitStart !== null) {
    const lastPatch = patches.length - 1;
    for (const p of points) {
      if (p.t < orbitStart || p.patch !== lastPatch) continue;
      const d = Math.hypot(p.rx, p.ry);
      if (!periapsis || d < periapsis.dist) periapsis = { ...p, dist: d };
      if (!apoapsis || d > apoapsis.dist) apoapsis = { ...p, dist: d };
    }
  }

  return { points, patches, nodes, firstNode, end, periapsis, apoapsis, finalState: s, finalT: ctx.t };
}

// position d'affichage de chaque patch à l'instant T :
// - le patch courant est dessiné autour de la position actuelle de son astre ;
// - un patch dans l'astre parent (ou un ancêtre) est dessiné autour de la
//   position actuelle de cet astre, comme dans KSP ;
// - un patch dans un autre astre (satellite ou voisin rencontré en route)
//   est dessiné dans la continuité du tracé : autour de la position qu'aura
//   cet astre au moment de la rencontre (astre "fantôme").
function displayAnchors(pred, T) {
  const P = pred.patches;
  let k = 0;
  for (let j = 0; j < P.length; j++) if (P[j].t <= T + 1e-9) k = j;
  const anchors = new Array(P.length).fill(null);
  const broken = new Array(P.length).fill(false);
  anchors[k] = bodyPositionAt(P[k].body, T);
  for (let j = k + 1; j < P.length; j++) {
    const B = P[j].body;
    if (isAncestorOrSelf(B, P[k].body)) {
      anchors[j] = bodyPositionAt(B, T);
      broken[j] = true;
    } else {
      const te = P[j].t;
      const pb = bodyPositionAt(B, te);
      const pa = bodyPositionAt(P[j - 1].body, te);
      anchors[j] = { x: anchors[j - 1].x + pb.x - pa.x, y: anchors[j - 1].y + pb.y - pa.y };
    }
  }
  return { anchors, broken, current: k };
}

// calcule les coordonnées d'affichage des points visibles (à partir de T)
function layoutPrediction(pred, T) {
  const layout = displayAnchors(pred, T);
  const display = [];
  for (const p of pred.points) {
    if (p.patch < layout.current || (p.patch === layout.current && p.t < T - 1e-9)) continue;
    const a = layout.anchors[p.patch];
    display.push({ x: a.x + p.rx, y: a.y + p.ry, t: p.t, phase: p.phase, patch: p.patch });
  }
  pred.layout = layout;
  pred.display = display;
  return pred;
}

function displayPosition(pred, patch, rx, ry) {
  const a = pred.layout.anchors[patch];
  return a ? { x: a.x + rx, y: a.y + ry } : null;
}

function currentPlanPrediction() {
  if (planDirty || !planPrediction) {
    const plan = planNodes.length ? createAutopilot(planNodes) : null;
    planPrediction = predictPath(ship, gameTime, plan, PLAN_MAX_HORIZON);
    planDirty = false;
  }
  return planPrediction;
}

function currentFlightPrediction() {
  if (ship.crashed) return null;
  if (autopilot && autopilotPrediction) return autopilotPrediction;
  if (ship.landed) return null;
  if (flightPredictionDirty || !flightPrediction || gameTime > flightPrediction.finalT - 1) {
    const horizon = ship.thrusting ? THRUST_PREDICTION_HORIZON : PLAN_MAX_HORIZON;
    flightPrediction = predictPath(ship, gameTime, null, horizon);
    flightPredictionDirty = ship.thrusting; // tracé complet dès que la poussée s'arrête
  }
  return flightPrediction;
}

// ---------------------------------------------------------------------------
// Calculateur de route : choisir un astre et une altitude, il construit les
// manœuvres pour s'y mettre en orbite circulaire.
//
// Déroulé (chaque étape se termine en orbite circulaire) :
//  1. décollage vertical puis circularisation à l'apogée (si posé) ;
//  2. remontée vers l'astre parent tant que la destination n'est pas dans
//     la même famille (ex : Lune → Terre) ;
//  3. transfert de Hohmann vers la destination (fenêtre de tir calculée
//     d'après les positions des astres), avec évasion si besoin ;
//  4. correction à mi-parcours (recherche numérique sur la trajectoire
//     simulée) pour passer exactement à l'altitude visée ;
//  5. circularisation au périastre, puis petites corrections.
// ---------------------------------------------------------------------------

class PlanError extends Error {}

function mod(a, n) {
  return ((a % n) + n) % n;
}

function parkingRadius(body) {
  return body.radius + Math.max(80, body.radius * 0.5);
}

// orbite la plus haute utilisable autour d'un astre (sous les sphères
// d'influence de ses satellites et dans la sienne)
function maxOrbitRadius(body) {
  let max = body.soi * 0.8;
  for (const c of body.children) max = Math.min(max, (c.orbitRadius - c.soi) * 0.9);
  return max;
}

// Δv (vecteur) à appliquer pour une orbite circulaire au rayon actuel.
// dir : +1 sens direct (celui des astres), -1 rétrograde, 0 garder le sens actuel
function circularDv(s, dir) {
  const r = Math.hypot(s.rx, s.ry);
  const v = Math.sqrt(s.ref.mu / r);
  const sign = dir || Math.sign(s.rx * s.rvy - s.ry * s.rvx) || 1;
  const tx = (-s.ry / r) * sign;
  const ty = (s.rx / r) * sign;
  return { x: tx * v - s.rvx, y: ty * v - s.rvy };
}

function tangentialDv(s, speed) {
  const r = Math.hypot(s.rx, s.ry);
  const sign = Math.sign(s.rx * s.rvy - s.ry * s.rvx) || 1;
  return { x: (-s.ry / r) * sign * speed - s.rvx, y: (s.rx / r) * sign * speed - s.rvy };
}

function progradeDv(s, m) {
  const v = Math.hypot(s.rvx, s.rvy) || 1;
  return { x: (s.rvx / v) * m, y: (s.rvy / v) * m };
}

// construit une manœuvre dont la poussée est centrée sur tCenter (ou dès que
// possible) et réalise le Δv donné par dvFn(état au centre de la poussée).
// Le temps de rotation préalable est pris en compte pour avancer le départ.
function makeBurnNode(ctx, tCenter, dvFn) {
  let center = Math.max(tCenter, ctx.t);
  let node = null;
  for (let iter = 0; iter < 5; iter++) {
    const probe = runCtx(cloneCtx(ctx), center);
    const dv = dvFn(probe.s);
    const m = Math.hypot(dv.x, dv.y);
    if (!(m > 1e-3)) return null;
    const angle = Math.atan2(dv.y, dv.x);
    // Δv exact : nombre entier de pas, puissance ajustée
    const steps = Math.max(1, Math.ceil(m / (THRUST_ACCEL * SIM_DT)));
    const duration = steps * SIM_DT;
    const power = m / (steps * THRUST_ACCEL * SIM_DT);

    let start = Math.max(ctx.t, center - duration / 2);
    for (let k = 0; k < 2; k++) {
      const at = runCtx(cloneCtx(ctx), start);
      const rot = Math.abs(angleDiff(at.s.angle, angle)) / AUTOPILOT_SLEW_RATE;
      start = Math.max(ctx.t, center - duration / 2 - rot);
    }
    const at = runCtx(cloneCtx(ctx), start);
    const rot = Math.abs(angleDiff(at.s.angle, angle)) / AUTOPILOT_SLEW_RATE;
    node = { t: at.t, heading: degrees(angleDiff(progradeAngle(at.s), angle)), power, duration };
    const newCenter = at.t + rot + duration / 2;
    if (Math.abs(newCenter - center) < SIM_DT) break;
    center = newCenter;
  }
  return node;
}

// ajoute la manœuvre au plan et simule jusqu'à sa fin
function commitNode(ctx, node, nodes) {
  const c = cloneCtx(ctx);
  node.id = nextNodeId++;
  if (c.ap) c.ap.nodes.push(copyNode(node));
  else c.ap = createAutopilot([node]);
  nodes.push(node);
  runCtx(c, node.t + node.duration + 120, (cc) => !planDone(cc));
  if (c.s.crashed) throw new PlanError("La trajectoire calculée mène à un crash.");
  return c;
}

// prochain passage à un apside (vitesse radiale qui change de signe)
function nextApsisTime(ctx, maxSpan, minSpan = 0) {
  const c = cloneCtx(ctx);
  const ref = c.s.ref;
  let sign = Math.sign(c.s.rx * c.s.rvx + c.s.ry * c.s.rvy);
  let found = null;
  runCtx(c, ctx.t + maxSpan, (cc) => {
    if (cc.s.ref !== ref) return false;
    const sg = Math.sign(cc.s.rx * cc.s.rvx + cc.s.ry * cc.s.rvy);
    if (sign === 0) sign = sg;
    if (sg !== 0 && sg !== sign) {
      if (cc.t - ctx.t >= minSpan) {
        found = cc.t;
        return false;
      }
      sign = sg;
    }
  });
  return found;
}

// circularise autour de l'astre courant, poussée centrée sur tCenter, puis
// corrige le résidu d'excentricité aux apsides suivants
function circularize(ctx, tCenter, nodes, dir = 0) {
  let node = makeBurnNode(ctx, tCenter, (s) => circularDv(s, dir));
  if (node) ctx = commitNode(ctx, node, nodes);
  for (let k = 0; k < 2; k++) {
    const el = orbitElements(ctx.s);
    if (!el.bound || el.e < 0.01) break;
    const tA = nextApsisTime(ctx, el.period, el.period * 0.1);
    if (tA === null) break;
    node = makeBurnNode(ctx, tA, (s) => circularDv(s, 0));
    if (!node) break;
    ctx = commitNode(ctx, node, nodes);
  }
  return ctx;
}

// décollage vertical puis circularisation à l'apogée, au rayon rp
function legLaunch(ctx, rp, nodes) {
  const body = ctx.s.ref;
  const tryDv = (dv) => {
    const steps = Math.max(1, Math.ceil(dv / (THRUST_ACCEL * SIM_DT)));
    const node = { t: ctx.t, heading: 0, power: dv / (steps * THRUST_ACCEL * SIM_DT), duration: steps * SIM_DT };
    const c = commitNode(ctx, node, []);
    const apex = cloneCtx(c);
    let rmax = Math.hypot(apex.s.rx, apex.s.ry);
    runCtx(apex, apex.t + 1000, (cc) => {
      if (cc.s.ref !== body || cc.s.landed) return false;
      rmax = Math.max(rmax, Math.hypot(cc.s.rx, cc.s.ry));
      return cc.s.rx * cc.s.rvx + cc.s.ry * cc.s.rvy > 0;
    });
    return { rmax, node, afterBurn: c, tApex: apex.t };
  };

  let lo = 0;
  let hi = ctx.s.fuel;
  if (tryDv(hi).rmax < rp) throw new PlanError("Pas assez de carburant pour décoller jusqu'à cette altitude.");
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (tryDv(mid).rmax < rp) lo = mid;
    else hi = mid;
  }
  const best = tryDv(hi);
  best.node.id = nextNodeId++;
  nodes.push(best.node);
  return circularize(best.afterBurn, best.tApex, nodes, 1);
}

// remet le vaisseau sur une orbite circulaire s'il en est loin
function legStabilize(ctx, nodes) {
  const body = ctx.s.ref;
  const el = orbitElements(ctx.s);
  const low = el.periapsis < body.radius + 20;
  if (el.bound && el.e < 0.05 && !low && el.apoapsis < body.soi) return ctx;
  if (low) {
    // trajectoire suborbitale : on circularise au sommet de la montée
    const climbing = ctx.s.rx * ctx.s.rvx + ctx.s.ry * ctx.s.rvy > 0;
    const tA = climbing ? nextApsisTime(ctx, el.bound ? el.period : 2000) : null;
    if (tA === null || el.apoapsis < body.radius + 30) {
      throw new PlanError("Trajectoire trop basse pour se mettre en orbite : reprenez de l'altitude ou posez-vous.");
    }
    return circularize(ctx, tA, nodes, 1);
  }
  return circularize(ctx, ctx.t, nodes, 0);
}

// changement d'altitude autour du même astre (transfert de Hohmann)
function legAltitude(ctx, rt, nodes) {
  const mu = ctx.s.ref.mu;
  const r1 = Math.hypot(ctx.s.rx, ctx.s.ry);
  if (Math.abs(r1 - rt) < 2) return ctx;
  const node = makeBurnNode(ctx, ctx.t, (s) => {
    const r = Math.hypot(s.rx, s.ry);
    const a = (r + rt) / 2;
    return tangentialDv(s, Math.sqrt(mu * (2 / r - 1 / a)));
  });
  if (node) ctx = commitNode(ctx, node, nodes);
  const el = orbitElements(ctx.s);
  const tA = nextApsisTime(ctx, el.bound ? el.period : 2000, 1);
  if (tA === null) throw new PlanError("Transfert d'altitude impossible.");
  return circularize(ctx, tA, nodes, 0);
}

// passage au plus près d'un astre, signé par le sens de rotation autour de
// lui (positif = sens direct) : c'est la grandeur que la correction vise
function signedApproach(ctx, B, tMax) {
  const c = cloneCtx(ctx);
  let best = { d: Infinity, signed: Infinity, t: c.t };
  const measure = (cc) => {
    let dx, dy, dvx, dvy;
    if (cc.s.ref === B) {
      dx = cc.s.rx;
      dy = cc.s.ry;
      dvx = cc.s.rvx;
      dvy = cc.s.rvy;
    } else {
      const pr = bodyPositionAt(cc.s.ref, cc.t);
      const vr = bodyVelocityAt(cc.s.ref, cc.t);
      const pb = bodyPositionAt(B, cc.t);
      const vb = bodyVelocityAt(B, cc.t);
      dx = pr.x + cc.s.rx - pb.x;
      dy = pr.y + cc.s.ry - pb.y;
      dvx = vr.vx + cc.s.rvx - vb.vx;
      dvy = vr.vy + cc.s.rvy - vb.vy;
    }
    const d = Math.hypot(dx, dy);
    if (d < best.d) best = { d, signed: (Math.sign(dx * dvy - dy * dvx) || 1) * d, t: cc.t };
    // périastre passé dans la sphère d'influence : inutile d'aller plus loin
    if (cc.s.ref === B && dx * dvx + dy * dvy > 0) return false;
  };
  runCtx(c, tMax, measure);
  return best;
}

// Δv d'intensité m dans la direction faisant l'angle phi avec le prograde
function directionDv(s, m, phi) {
  const v = Math.hypot(s.rvx, s.rvy) || 1;
  const px = s.rvx / v;
  const py = s.rvy / v;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  return { x: m * (c * px - sn * py), y: m * (c * py + sn * px) };
}

// correction de trajectoire : poussée d'intensité m (balayage puis
// dichotomie) pour annuler objective(contexte). La direction suit d'abord
// le gradient de l'objectif (mélange prograde/radial), puis le prograde et
// le radial seuls si besoin.
function correctTrajectory(ctx, objective, scale, tol, nodes) {
  const f0 = objective(ctx);
  if (Math.abs(f0) < tol) return ctx;
  const evalM = (m, phi) => {
    if (Math.abs(m) < 1e-4) return { f: f0, c: ctx, node: null };
    const node = makeBurnNode(ctx, ctx.t, (s) => directionDv(s, m, phi));
    if (!node) return { f: f0, c: ctx, node: null };
    let c;
    try {
      c = commitNode(ctx, node, []);
    } catch (e) {
      return { f: NaN };
    }
    return { f: objective(c), c, node };
  };

  const d = scale * 0.02;
  const fp = evalM(d, 0).f;
  const fr = evalM(d, HALF_PI).f;
  const directions = [0, HALF_PI];
  if (Number.isFinite(fp) && Number.isFinite(fr)) directions.unshift(Math.atan2(fr - f0, fp - f0));

  for (const phi of directions) {
    const found = searchAlong(evalM, phi, f0, scale, tol);
    if (found) {
      if (!found.node) return ctx;
      found.node.id = nextNodeId++;
      nodes.push(found.node);
      return found.c;
    }
  }
  throw new PlanError("Correction de trajectoire introuvable — essayez une autre altitude.");
}

function searchAlong(evalM, phi, f0, scale, tol) {
  const N = 12;
  const samples = [];
  for (let i = -N; i <= N; i++) {
    const m = (scale * i) / N;
    samples.push({ m, ...(i === 0 ? { f: f0, node: null } : evalM(m, phi)) });
  }
  const brackets = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (Number.isFinite(a.f) && Number.isFinite(b.f) && Math.sign(a.f) !== Math.sign(b.f)) brackets.push([a, b]);
  }
  brackets.sort((p, q) => Math.min(Math.abs(p[0].m), Math.abs(p[1].m)) - Math.min(Math.abs(q[0].m), Math.abs(q[1].m)));

  for (let [a, b] of brackets) {
    for (let i = 0; i < 30; i++) {
      const mid = { m: (a.m + b.m) / 2 };
      Object.assign(mid, evalM(mid.m, phi));
      if (!Number.isFinite(mid.f)) break;
      if (Math.sign(mid.f) === Math.sign(a.f)) a = mid;
      else b = mid;
      if (Math.abs(mid.f) < tol) break;
    }
    const best = Math.abs(a.f) < Math.abs(b.f) ? a : b;
    if (Number.isFinite(best.f) && Math.abs(best.f) < tol) return best;
  }
  return null;
}

// descente vers un satellite de l'astre courant (ex : Terre → Lune)
function legDown(ctx, B, rt, nodes) {
  const P = ctx.s.ref;
  const mu = P.mu;
  const r1 = Math.hypot(ctx.s.rx, ctx.s.ry);
  const r2 = B.orbitRadius;
  const a = (r1 + r2) / 2;
  const Th = PI * Math.sqrt((a * a * a) / mu);
  const sgn = Math.sign(ctx.s.rx * ctx.s.rvy - ctx.s.ry * ctx.s.rvx) || 1;
  const ws = sgn * Math.sqrt(mu / (r1 * r1 * r1));
  const wB = B.orbitSpeed;

  // fenêtre de tir : à l'arrivée (demi-orbite de transfert plus tard), le
  // satellite doit se trouver à l'opposé du point de départ
  const rate = wB - ws;
  const theta = (t) => Math.atan2(ctx.s.ry, ctx.s.rx) + ws * (t - ctx.t);
  const g = (t) => B.phase0 + wB * (t + Th) - theta(t) - PI;
  const synodic = TWO_PI / Math.abs(rate);
  let tb = ctx.t + (rate > 0 ? mod(-g(ctx.t), TWO_PI) : mod(g(ctx.t), TWO_PI)) / Math.abs(rate);
  if (tb < ctx.t + 5) tb += synodic;

  const base = tb - 10 > ctx.t ? runCtx(cloneCtx(ctx), tb - 10) : ctx;
  const vt = Math.sqrt(mu * (2 / r1 - 1 / a));
  const dep = makeBurnNode(base, tb, (s) => tangentialDv(s, vt));
  let c = commitNode(base, dep, nodes);

  // correction à mi-parcours pour passer à l'altitude visée
  const mcc = runCtx(cloneCtx(c), c.t + 0.25 * Th);
  const horizon = 1.6 * Th;
  const objective = (cc) => signedApproach(cc, B, cc.t + horizon).signed - rt;
  c = correctTrajectory(mcc, objective, Math.max(2, 0.15 * vt), Math.max(2, 0.03 * rt), nodes);

  const approach = signedApproach(c, B, c.t + horizon);
  return circularize(c, approach.t, nodes, 0);
}

// sortie de la sphère d'influence de l'astre courant C avec une vitesse
// d'excès vinf (signée : > 0 dans le sens du mouvement de C), en visant une
// sortie vers tExitWanted si donné
function escapeBurn(ctx, vinfSigned, tExitWanted) {
  const C = ctx.s.ref;
  const mu = C.mu;
  const rp = Math.hypot(ctx.s.rx, ctx.s.ry);
  const sgn = Math.sign(ctx.s.rx * ctx.s.rvy - ctx.s.ry * ctx.s.rvx) || 1;
  const vinf = Math.abs(vinfSigned);
  const vb = Math.sqrt(vinf * vinf + 2 * mu * (1 / rp - 1 / C.soi));
  // angle entre le point de poussée et la direction de sortie de l'hyperbole
  const e = 1 + (rp * vinf * vinf) / mu;
  const nuInf = Math.acos(-1 / e);
  const Tpark = TWO_PI * Math.sqrt((rp * rp * rp) / mu);
  const ws = (sgn * TWO_PI) / Tpark;
  const theta0 = Math.atan2(ctx.s.ry, ctx.s.rx);

  const exitDirAt = (t) => {
    const o = localOrbit(C, t);
    return Math.atan2(o.vy, o.vx) + (vinfSigned < 0 ? PI : 0);
  };
  let tExit = tExitWanted ?? ctx.t;
  let tEsc = 0;
  let result = null;
  // la sortie réelle (sphère d'influence finie, poussée non instantanée)
  // s'écarte un peu de la théorie : on mesure et on corrige à chaque tour
  let biasAngle = 0;
  let vb2 = vb * vb;
  for (let iter = 0; iter < 4; iter++) {
    const dvCur = Math.sqrt(vb2) - Math.sqrt(mu / rp);
    const thetaP = exitDirAt(tExit) - sgn * nuInf + biasAngle;
    const wanted = Math.max(ctx.t + 3, (tExitWanted ?? ctx.t) - tEsc);
    // instant où le vaisseau passe à l'angle thetaP, le plus proche de `wanted`
    const first = ctx.t + mod((thetaP - theta0) * sgn, TWO_PI) / Math.abs(ws);
    const tb0 = first + Math.round((wanted - first) / Tpark) * Tpark;

    // essaie le tour d'orbite voulu, puis les voisins, jusqu'à une sortie
    // qui ne croise pas un satellite de C (ex : la Lune en quittant la Terre)
    result = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const tb = tb0 + k * Tpark;
      if (tb < ctx.t + 3) continue;
      const base = tb - 10 > ctx.t ? runCtx(cloneCtx(ctx), tb - 10) : ctx;
      const node = makeBurnNode(base, tb, (s) => progradeDv(s, dvCur));
      let c;
      try {
        c = commitNode(base, node, []);
      } catch (e) {
        continue;
      }
      const out = cloneCtx(c);
      runCtx(out, out.t + 5000, (cc) => cc.s.ref === C);
      if (out.s.ref !== C.parentBody) continue; // resté lié à C, ou capturé par un satellite
      tEsc = out.t - tb;
      result = { ctx: c, node, tExit: out.t };
      // vitesse de sortie relative à C, comparée à celle voulue
      const o = localOrbit(C, out.t);
      const relVx = out.s.rvx - o.vx;
      const relVy = out.s.rvy - o.vy;
      biasAngle += angleDiff(Math.atan2(relVy, relVx), exitDirAt(out.t));
      vb2 = Math.max(vb2 + vinf * vinf - (relVx * relVx + relVy * relVy), 2 * mu * (1 / rp - 1 / C.soi) + 1);
      break;
    }
    if (!result) throw new PlanError(`Impossible de quitter l'attraction de ${C.name}.`);
    if (tExitWanted === undefined) tExit = result.tExit;
  }
  return result;
}

// remontée vers l'astre parent, orbite circulaire de rayon rt autour de lui
function legUp(ctx, rt, nodes) {
  const C = ctx.s.ref;
  const P = C.parentBody;
  const rC = C.orbitRadius;
  const vC = C.orbitSpeed * rC;
  const hohmann = vC * (Math.sqrt((2 * rt) / (rC + rt)) - 1);
  const minVinf = 0.6 * Math.sqrt((2 * C.mu) / C.soi);
  const vinf = Math.sign(hohmann) * Math.max(Math.abs(hohmann), minVinf);
  const esc = escapeBurn(ctx, vinf);
  esc.node.id = nextNodeId++;
  nodes.push(esc.node);

  const a = (rC + rt) / 2;
  const Th = PI * Math.sqrt((a * a * a) / P.mu);
  const lower = rt < rC;
  // rayon extrême (périastre si on descend, apoastre si on monte) autour de P
  const extremum = (cc) => {
    const c = cloneCtx(cc);
    let best = null;
    runCtx(c, cc.t + 1.3 * Th, (x) => {
      if (x.s.ref !== P) return false;
      const r = Math.hypot(x.s.rx, x.s.ry);
      if (!best || (lower ? r < best.r : r > best.r)) best = { r, t: x.t };
    });
    return best || { r: lower ? Infinity : 0, t: cc.t };
  };
  const mcc = runCtx(cloneCtx(esc.ctx), esc.tExit + 5);
  const c = correctTrajectory(mcc, (cc) => extremum(cc).r - rt, Math.max(3, Math.abs(vinf)), Math.max(2, 0.02 * rt), nodes);
  return circularize(c, extremum(c).t, nodes, 0);
}

// temps de vol et angle parcouru sur une orbite qui part tangentiellement
// (donc d'un apside) au rayon r1 à la vitesse v1, jusqu'au rayon r2
function transferGeometry(mu, r1, v1, r2) {
  const h = r1 * v1;
  const p = (h * h) / mu;
  const e = Math.abs(p / r1 - 1);
  const a = p / (1 - e * e);
  if (!(e < 1)) return null;
  const outward = r2 > r1;
  const cosNu = (p / r2 - 1) / e;
  if (Math.abs(cosNu) > 1) return null; // r2 hors d'atteinte
  const nu = Math.acos(cosNu);
  const timeFromPeri = (anomaly) => {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(anomaly / 2));
    return (E - e * Math.sin(E)) * Math.sqrt((a * a * a) / mu);
  };
  const T = TWO_PI * Math.sqrt((a * a * a) / mu);
  // départ au périastre (on monte) ou à l'apoastre (on descend)
  return outward ? { tof: timeFromPeri(nu), dnu: nu } : { tof: T / 2 - timeFromPeri(nu), dnu: PI - nu };
}

// transfert vers un astre voisin (même parent), ex : Terre → Mars
function legAcross(ctx, B, rt, nodes) {
  const C = ctx.s.ref;
  const P = C.parentBody;
  const rC = C.orbitRadius;
  const rB = B.orbitRadius;
  const vC = C.orbitSpeed * rC;
  // vitesse d'excès : celle de Hohmann, mais au moins une fraction de la
  // vitesse de libération au bord de la sphère d'influence — sinon le
  // vaisseau s'attarde à sa lisière et risque d'y croiser un satellite
  const hohmann = vC * (Math.sqrt((2 * rB) / (rC + rB)) - 1);
  const minVinf = 0.6 * Math.sqrt((2 * C.mu) / C.soi);
  const vinf = Math.sign(hohmann) * Math.max(Math.abs(hohmann), minVinf);
  const geo = transferGeometry(P.mu, rC, vC + vinf, rB);
  if (!geo) throw new PlanError(`${B.name} hors d'atteinte.`);

  // durée d'évasion estimée, puis fenêtre de tir : à l'arrivée (tof plus
  // tard), B doit se trouver dnu plus loin que le point de sortie de C
  const trial = escapeBurn(ctx, vinf);
  const tEsc = trial.tExit - ctx.t;
  const rate = B.orbitSpeed - C.orbitSpeed;
  const g = (t) => B.phase0 + B.orbitSpeed * (t + geo.tof) - (C.phase0 + C.orbitSpeed * t) - geo.dnu;
  const earliest = ctx.t + tEsc + 5;
  const tw = earliest + (rate > 0 ? mod(-g(earliest), TWO_PI) : mod(g(earliest), TWO_PI)) / Math.abs(rate);

  const esc = escapeBurn(ctx, vinf, tw);
  esc.node.id = nextNodeId++;
  nodes.push(esc.node);

  const mcc = runCtx(cloneCtx(esc.ctx), esc.tExit + 5);
  const horizon = 1.5 * geo.tof + 200;
  const objective = (cc) => signedApproach(cc, B, cc.t + horizon).signed - rt;
  const c = correctTrajectory(mcc, objective, Math.max(3, Math.abs(vinf)), Math.max(2, 0.03 * rt), nodes);
  const approach = signedApproach(c, B, c.t + horizon);
  return circularize(c, approach.t, nodes, 0);
}

// étapes du trajet dans l'arbre des astres, de C vers B
function routeLegs(C, B) {
  const legs = [];
  let lca = C;
  while (!isAncestorOrSelf(lca, B)) lca = lca.parentBody;

  let cur = C;
  if (B === lca) {
    while (cur !== B) {
      legs.push({ type: "up", to: cur.parentBody });
      cur = cur.parentBody;
    }
    return legs;
  }
  const down = [];
  for (let b = B; b !== lca; b = b.parentBody) down.unshift(b);
  while (cur !== lca && cur.parentBody !== lca) {
    legs.push({ type: "up", to: cur.parentBody });
    cur = cur.parentBody;
  }
  if (cur === lca) legs.push({ type: "down", to: down[0] });
  else legs.push({ type: "across", to: down[0] });
  for (let i = 1; i < down.length; i++) legs.push({ type: "down", to: down[i] });
  return legs;
}

function planRoute(target, altitude) {
  if (ship.crashed) throw new PlanError("Vaisseau détruit — [R] pour relancer.");
  const rt = target.radius + altitude;
  if (altitude < 10) throw new PlanError("Altitude trop basse (minimum 10).");
  if (rt > maxOrbitRadius(target)) {
    throw new PlanError(`Altitude trop haute pour ${target.name} (max ${Math.floor(maxOrbitRadius(target) - target.radius)}).`);
  }

  const nodes = [];
  let ctx = makeCtx(ship, gameTime, null);
  const home = ctx.s.ref;
  if (ctx.s.landed) ctx = legLaunch(ctx, home === target ? rt : parkingRadius(home), nodes);
  else ctx = legStabilize(ctx, nodes);

  const legs = routeLegs(ctx.s.ref, target);
  if (!legs.length) ctx = legAltitude(ctx, rt, nodes);
  else if (Math.hypot(ctx.s.rx, ctx.s.ry) < parkingRadius(ctx.s.ref) * 0.9) {
    // orbite trop basse pour un départ propre : remonte à l'orbite de parking
    ctx = legAltitude(ctx, parkingRadius(ctx.s.ref), nodes);
  }
  legs.forEach((leg, i) => {
    const r = i === legs.length - 1 ? rt : parkingRadius(leg.to);
    if (leg.type === "up") ctx = legUp(ctx, r, nodes);
    else if (leg.type === "down") ctx = legDown(ctx, leg.to, r, nodes);
    else ctx = legAcross(ctx, leg.to, r, nodes);
    if (ctx.s.ref !== leg.to) throw new PlanError(`Capture autour de ${leg.to.name} manquée.`);
  });
  return { nodes, final: ctx };
}

function computeRoute() {
  const target = bodyById[ui.target.value];
  const altitude = Number(ui.altitude.value);
  try {
    const { nodes, final } = planRoute(target, altitude);
    planNodes = nodes.map(copyNode);
    planTarget = { body: target, radius: target.radius + altitude };
    selectedNodeId = null;
    planDirty = true;
    syncPanel();
    const dv = nodes.reduce((sum, n) => sum + n.power * n.duration * THRUST_ACCEL, 0);
    const el = orbitElements(final.s);
    routeMessage = {
      text:
        `${nodes.length} manœuvres · Δv ${dv.toFixed(0)} (carburant ${ship.fuel.toFixed(0)})\n` +
        `Arrivée ${formatT(final.t)} · orbite ${(el.periapsis - target.radius).toFixed(0)}–${(el.apoapsis - target.radius).toFixed(0)}` +
        (dv > ship.fuel ? "\n⚠ Carburant insuffisant pour tout le plan" : ""),
      error: dv > ship.fuel,
    };
  } catch (e) {
    if (!(e instanceof PlanError)) console.error(e);
    routeMessage = { text: e instanceof PlanError ? e.message : "Erreur de calcul de la route.", error: true };
  }
}

// ---------------------------------------------------------------------------
// Boucle de jeu
// ---------------------------------------------------------------------------

function readManualControl() {
  return {
    left: keyIsDown(LEFT_ARROW),
    right: keyIsDown(RIGHT_ARROW),
    thrust: keyIsDown(UP_ARROW) ? 1 : 0,
    slewTo: null,
    assist: true,
  };
}

// l'accélération du temps ralentit à l'approche d'une manœuvre du plan
function effectiveWarp() {
  let warp = WARP_LEVELS[warpIndex];
  if (autopilot) {
    const node = autopilot.nodes[autopilot.index];
    if (autopilot.phase !== "pending") warp = 1;
    else if (node) warp = Math.min(warp, Math.max(1, node.t - gameTime));
  }
  return warp;
}

function advanceSimulation(elapsed) {
  const warp = effectiveWarp();
  simAccumulator += Math.min(elapsed, MAX_FRAME_DT) * warp;
  const manual = readManualControl();

  // toute commande manuelle reprend la main sur le pilote automatique
  if (autopilot && (manual.left || manual.right || manual.thrust > 0)) {
    autopilot = null;
    autopilotPrediction = null;
    flightPredictionDirty = true;
  }

  while (simAccumulator >= SIM_DT) {
    simAccumulator -= SIM_DT;
    let control = manual;
    if (autopilot) {
      const planned = autopilotControl(autopilot, ship, gameTime);
      if (planned) control = planned;
      else {
        autopilot = null; // plan terminé : retour en pilotage manuel
        autopilotPrediction = null;
        flightPredictionDirty = true;
      }
    }
    const wasLanded = ship.landed;
    stepShip(ship, gameTime, SIM_DT, control);
    gameTime += SIM_DT;
    if (ship.thrusting || ship.landed !== wasLanded) flightPredictionDirty = true;
    if (!ship.crashed && !ship.landed) {
      trail.push({ ref: ship.ref, rx: ship.rx, ry: ship.ry });
      if (trail.length > TRAIL_MAX) trail.shift();
    }
  }
  if (ship.crashed) {
    autopilot = null;
    autopilotPrediction = null;
  }
}

// la caméra accompagne l'astre de référence du vaisseau (sinon, avec la
// Terre qui file autour du Soleil, tout sortirait de l'écran)
function updateCamera() {
  const refPos = bodyPositionAt(ship.ref, gameTime);
  if (cameraFrame && cameraFrame.body === ship.ref) {
    cameraX += refPos.x - cameraFrame.x;
    cameraY += refPos.y - cameraFrame.y;
  }
  cameraFrame = { body: ship.ref, x: refPos.x, y: refPos.y };
  if (cameraFree) return;

  // caméra suiveuse : centrée sur le vaisseau, dézoome quand la vitesse augmente
  const speed = Math.hypot(ship.rvx, ship.rvy);
  const targetZoom = constrain(map(speed, 0, 150, 1, 0.3), 0.25, 1) * zoomBias;
  zoom = lerp(zoom, targetZoom, 0.05);
  cameraX = lerp(cameraX, ship.x, 0.15);
  cameraY = lerp(cameraY, ship.y, 0.15);
}

function draw() {
  if (mode === "flight") advanceSimulation(deltaTime * 0.001);

  bodies(gameTime);
  syncShipAbsolute(ship, gameTime);
  const referenceBody = ship.ref;
  if (mode === "flight") updateCamera();

  const prediction = mode === "planning" ? currentPlanPrediction() : currentFlightPrediction();
  if (prediction) layoutPrediction(prediction, gameTime);
  const target = mode === "planning" ? planTarget : autopilot ? autopilotTarget : null;

  background(6, 8, 16);
  drawStars();

  push();
  translate(width / 2, height / 2);
  scale(zoom);
  translate(-cameraX, -cameraY);

  drawOrbits();
  drawTrail();
  if (prediction) drawGhostBodies(prediction);
  for (const body of ALL_BODIES) drawBody(body);
  if (prediction) {
    drawTargetOrbit(prediction, target);
    drawPredictedPath(prediction);
    if (prediction.periapsis) drawApsis(prediction, prediction.periapsis, "Périastre", [255, 130, 130]);
    if (prediction.apoapsis) drawApsis(prediction, prediction.apoapsis, "Apoastre", [130, 190, 255]);
    drawPathEnd(prediction);
    drawManeuverNodes(prediction);
  }
  drawShip();
  drawVelocityVector();

  pop();

  drawBodyLabels();
  drawHUD(referenceBody, prediction);
  updateUI(prediction);
}

// ---------------------------------------------------------------------------
// Mode planification
// ---------------------------------------------------------------------------

function canPlan() {
  return !ship.crashed;
}

function enterPlanning() {
  if (mode === "planning" || !canPlan()) return;
  mode = "planning";
  // le plan en cours (s'il y en a un) redevient éditable
  planNodes = autopilot ? remainingNodes(autopilot, gameTime) : [];
  planTarget = autopilot ? autopilotTarget : null;
  autopilot = null;
  autopilotPrediction = null;
  selectedNodeId = null;
  routeMessage = { text: "", error: false };
  planDirty = true;
  syncPanel();
}

function launchPlan() {
  if (mode !== "planning") return;
  const prediction = currentPlanPrediction();
  autopilot = planNodes.length ? createAutopilot(planNodes) : null;
  // exécution déterministe : le tracé planifié reste exact pendant le vol
  autopilotPrediction = autopilot ? prediction : null;
  autopilotTarget = autopilot ? planTarget : null;
  planNodes = [];
  planTarget = null;
  selectedNodeId = null;
  pointer = null;
  flightPredictionDirty = true;
  cameraFrame = null;
  mode = "flight";
  syncPanel();
}

function clearPlan() {
  planNodes = [];
  planTarget = null;
  selectedNodeId = null;
  routeMessage = { text: "", error: false };
  planDirty = true;
  syncPanel();
}

function selectedNode() {
  return planNodes.find((n) => n.id === selectedNodeId) || null;
}

function addNodeAt(t) {
  const node = { id: nextNodeId++, t, ...DEFAULT_NODE };
  planNodes.push(node);
  planNodes.sort((a, b) => a.t - b.t);
  selectedNodeId = node.id;
  planDirty = true;
  syncPanel();
}

// ajoute, après les manœuvres déjà prévues, celle qui circularise l'orbite
// à la distance où se trouve alors le vaisseau
function circularizeOrbit() {
  if (mode !== "planning" || ship.crashed) return;
  const ctx = runCtx(makeCtx(ship, gameTime, planNodes), Infinity, (c) => !planDone(c));
  if (ctx.s.landed || ctx.s.crashed) return;
  const node = makeBurnNode(ctx, ctx.t, (s) => circularDv(s, 0));
  if (!node) return; // déjà circulaire
  node.id = nextNodeId++;
  planNodes.push(node);
  planNodes.sort((a, b) => a.t - b.t);
  selectedNodeId = node.id;
  planDirty = true;
  syncPanel();
}

// ajoute, après les manœuvres déjà prévues, un atterrissage sur l'astre
// autour duquel le vaisseau se trouve alors : poussée qui annule la vitesse
// relative (chute verticale), puis atterrissage guidé
function planLanding() {
  if (mode !== "planning" || ship.crashed) return;
  const ctx = runCtx(makeCtx(ship, gameTime, planNodes), Infinity, (c) => !planDone(c));
  const body = ctx.s.ref;
  try {
    if (ctx.s.crashed) throw new PlanError("Le plan actuel se termine par un crash.");
    if (ctx.s.landed) throw new PlanError(`Déjà posé sur ${body.name} à la fin du plan.`);
    if (!body.parentBody) throw new PlanError(`Impossible de se poser sur ${body.name}.`);
    if (body.mu / (body.radius * body.radius) > LANDING_IGNITION * THRUST_ACCEL) {
      throw new PlanError(`Gravité de ${body.name} trop forte pour le moteur.`);
    }

    const nodes = [];
    let c = ctx;
    const deorbit = makeBurnNode(ctx, ctx.t, (s) => ({ x: -s.rvx, y: -s.rvy }));
    if (deorbit) c = commitNode(ctx, deorbit, nodes);
    const land = { kind: "land", t: c.t, heading: 0, power: 1, duration: 0 };
    c = cloneCtx(c);
    land.id = nextNodeId++;
    c.ap.nodes.push(copyNode(land));
    nodes.push(land);
    runCtx(c, c.t + LANDING_TIMEOUT, (cc) => !planDone(cc));
    if (!c.s.landed || c.s.ref !== body) throw new PlanError(`L'atterrissage sur ${body.name} échoue (crash ou carburant).`);

    planNodes.push(...nodes.map(copyNode));
    planNodes.sort((a, b) => a.t - b.t);
    selectedNodeId = land.id;
    planDirty = true;
    syncPanel();
    routeMessage = {
      text: `Atterrissage sur ${body.name} · Δv ${(ctx.s.fuel - c.s.fuel).toFixed(0)} · posé à ${formatT(c.t)}`,
      error: false,
    };
  } catch (e) {
    if (!(e instanceof PlanError)) console.error(e);
    routeMessage = { text: e instanceof PlanError ? e.message : "Erreur de calcul de l'atterrissage.", error: true };
  }
}

function deleteSelectedNode() {
  if (selectedNodeId === null) return;
  planNodes = planNodes.filter((n) => n.id !== selectedNodeId);
  selectedNodeId = null;
  planDirty = true;
  syncPanel();
}

function updateSelectedNode(changes) {
  const node = selectedNode();
  if (!node) return;
  Object.assign(node, changes);
  planNodes.sort((a, b) => a.t - b.t);
  planDirty = true;
}

function worldToScreen(x, y) {
  return { x: (x - cameraX) * zoom + width / 2, y: (y - cameraY) * zoom + height / 2 };
}

function screenToWorld(x, y) {
  return { x: (x - width / 2) / zoom + cameraX, y: (y - height / 2) / zoom + cameraY };
}

function nearestPathPoint(pred, sx, sy) {
  let best = null;
  let bestDist = Infinity;
  for (const p of pred.display) {
    const s = worldToScreen(p.x, p.y);
    const d = dist(s.x, s.y, sx, sy);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { point: best, dist: bestDist } : null;
}

function nodeAtScreen(pred, sx, sy) {
  for (const pn of pred.nodes) {
    if (pn.startT === undefined) continue;
    const p = displayPosition(pred, pn.startPatch, pn.startX, pn.startY);
    if (!p) continue;
    const s = worldToScreen(p.x, p.y);
    if (dist(s.x, s.y, sx, sy) < NODE_HIT_RADIUS) return pn.id;
  }
  return null;
}

function mousePressed(event) {
  if (!event || event.target !== canvasElt) return;
  if (mode === "planning") {
    const prediction = currentPlanPrediction();
    const hitId = nodeAtScreen(prediction, mouseX, mouseY);
    if (hitId !== null) {
      selectedNodeId = hitId;
      syncPanel();
      // tracé de référence pour le glisser : le plan sans ce point, dont la
      // trajectoire ne dépend pas de l'endroit où on le déplace
      const others = planNodes.filter((n) => n.id !== hitId);
      const pick = predictPath(ship, gameTime, others.length ? createAutopilot(others) : null, PLAN_MAX_HORIZON);
      pointer = { kind: "node", pick };
      return;
    }
  }
  pointer = { kind: "pan", startX: mouseX, startY: mouseY, moved: false };
}

function mouseDragged() {
  if (!pointer) return;
  if (pointer.kind === "node") {
    const nearest = nearestPathPoint(layoutPrediction(pointer.pick, gameTime), mouseX, mouseY);
    if (nearest) {
      updateSelectedNode({ t: nearest.point.t });
      syncPanel();
    }
    return;
  }
  if (dist(mouseX, mouseY, pointer.startX, pointer.startY) > CLICK_MAX_MOVE) pointer.moved = true;
  if (pointer.moved) {
    cameraFree = true; // glisser la vue en vol passe en caméra libre
    cameraX -= (mouseX - pmouseX) / zoom;
    cameraY -= (mouseY - pmouseY) / zoom;
  }
}

function mouseReleased() {
  if (!pointer) return;
  if (mode === "planning" && pointer.kind === "pan" && !pointer.moved) {
    // simple clic : pose un point de manœuvre sur le tracé, sinon désélectionne
    const nearest = nearestPathPoint(currentPlanPrediction(), mouseX, mouseY);
    if (nearest && nearest.dist < PICK_RADIUS) {
      addNodeAt(nearest.point.t);
    } else {
      selectedNodeId = null;
      syncPanel();
    }
  }
  pointer = null;
}

function mouseWheel(event) {
  if (event.target !== canvasElt) return;
  const factor = Math.pow(1.0015, -event.delta);
  if (mode === "flight" && !cameraFree) {
    zoomBias = constrain(zoomBias * factor, 0.0005, 4);
    return false;
  }
  // zoom centré sur le curseur
  const before = screenToWorld(mouseX, mouseY);
  zoom = constrain(zoom * factor, 0.0005, 4);
  const after = screenToWorld(mouseX, mouseY);
  cameraX += before.x - after.x;
  cameraY += before.y - after.y;
  return false;
}

function toggleCamera() {
  cameraFree = !cameraFree;
  if (!cameraFree) zoomBias = constrain(zoom, 0.0005, 4);
}

function changeWarp(delta) {
  warpIndex = constrain(warpIndex + delta, 0, WARP_LEVELS.length - 1);
}

// ---------------------------------------------------------------------------
// Interface (boutons + panneaux, définis dans index.html)
// ---------------------------------------------------------------------------

function setupUI() {
  const byId = (id) => document.getElementById(id);
  Object.assign(ui, {
    plan: byId("btn-plan"),
    launch: byId("btn-launch"),
    clear: byId("btn-clear"),
    circularize: byId("btn-circularize"),
    land: byId("btn-land"),
    camera: byId("btn-camera"),
    warp: byId("btn-warp"),
    warpUp: byId("btn-warp-up"),
    warpDown: byId("btn-warp-down"),
    targetPanel: byId("target-panel"),
    target: byId("in-target"),
    altitude: byId("in-altitude"),
    route: byId("btn-route"),
    routeInfo: byId("route-info"),
    panel: byId("node-panel"),
    title: byId("node-title"),
    remove: byId("btn-delete"),
    time: byId("in-time"),
    heading: byId("in-heading"),
    power: byId("in-power"),
    duration: byId("in-duration"),
    outTime: byId("out-time"),
    outHeading: byId("out-heading"),
    outPower: byId("out-power"),
    outDuration: byId("out-duration"),
    info: byId("node-info"),
    presets: document.querySelector("#node-panel .presets"),
  });

  // liste des destinations, satellites indentés sous leur planète
  const addOption = (body, depth) => {
    const opt = document.createElement("option");
    opt.value = body.id;
    opt.textContent = `${"  ".repeat(depth)}${depth ? "↳ " : ""}${body.name}`;
    ui.target.appendChild(opt);
    body.children.forEach((c) => addOption(c, depth + 1));
  };
  addOption(sun, 0);
  ui.target.value = "moon";

  // rend la main au clavier du jeu après un clic sur un bouton
  const onClick = (el, fn) =>
    el.addEventListener("click", () => {
      fn();
      el.blur();
    });
  onClick(ui.plan, enterPlanning);
  onClick(ui.launch, launchPlan);
  onClick(ui.clear, clearPlan);
  onClick(ui.circularize, circularizeOrbit);
  onClick(ui.land, planLanding);
  onClick(ui.remove, deleteSelectedNode);
  onClick(ui.camera, toggleCamera);
  onClick(ui.warpUp, () => changeWarp(1));
  onClick(ui.warpDown, () => changeWarp(-1));
  onClick(ui.warp, () => (warpIndex = 0));
  onClick(ui.route, () => {
    routeMessage = { text: "Calcul de la route…", error: false };
    ui.routeInfo.textContent = routeMessage.text;
    ui.route.disabled = true;
    // laisse le navigateur afficher le message avant le calcul
    setTimeout(() => {
      computeRoute();
      ui.route.disabled = false;
    }, 30);
  });

  ui.time.addEventListener("input", () => updateSelectedNode({ t: gameTime + Number(ui.time.value) }));
  ui.heading.addEventListener("input", () => updateSelectedNode({ heading: Number(ui.heading.value) }));
  ui.power.addEventListener("input", () => updateSelectedNode({ power: Number(ui.power.value) / 100 }));
  ui.duration.addEventListener("input", () => updateSelectedNode({ duration: Number(ui.duration.value) }));
  for (const preset of document.querySelectorAll("[data-heading]")) {
    onClick(preset, () => {
      updateSelectedNode({ heading: Number(preset.dataset.heading) });
      syncPanel();
    });
  }
}

// recopie la manœuvre sélectionnée dans les curseurs
function syncPanel() {
  const node = selectedNode();
  ui.panel.hidden = !node;
  if (!node) return;
  ui.time.max = Math.ceil(Math.max(300, node.t - gameTime + 60));
  ui.time.value = node.t - gameTime;
  ui.heading.value = node.heading;
  ui.power.value = Math.round(node.power * 100);
  ui.duration.value = node.duration;
}

function formatT(t) {
  const dt = t - gameTime;
  if (Math.abs(dt) < 600) return `T+${dt.toFixed(1)} s`;
  return `T+${Math.floor(dt / 60)} min ${Math.round(dt % 60)} s`;
}

function nodeDeltaV(n, predicted) {
  if (n.kind === "land") return predicted && predicted.fuelAfter !== undefined ? predicted.fuelBefore - predicted.fuelAfter : 0;
  return THRUST_ACCEL * n.power * n.duration;
}

function updateUI(prediction) {
  const planning = mode === "planning";
  ui.plan.hidden = planning;
  ui.plan.disabled = !canPlan();
  ui.launch.hidden = !planning;
  ui.clear.hidden = !planning;
  ui.clear.disabled = planNodes.length === 0;
  ui.launch.textContent = planNodes.length ? "▶ Lancer le plan" : "▶ Reprendre";
  ui.circularize.hidden = !planning;
  ui.circularize.disabled = ship.crashed;
  ui.land.hidden = !planning;
  ui.land.disabled = ship.crashed;
  ui.targetPanel.hidden = !planning;
  ui.routeInfo.textContent = routeMessage.text;
  ui.routeInfo.classList.toggle("error", routeMessage.error);
  ui.camera.hidden = planning;
  ui.camera.classList.toggle("active", cameraFree);
  ui.camera.textContent = cameraFree ? "🎯 Suivre le vaisseau" : "🎥 Caméra libre";
  ui.warp.textContent = `×${WARP_LEVELS[warpIndex]}`;
  for (const b of [ui.warp, ui.warpUp, ui.warpDown]) b.hidden = planning;

  const node = planning ? selectedNode() : null;
  if (!node) {
    ui.panel.hidden = true;
    return;
  }
  ui.panel.hidden = false;
  const index = planNodes.indexOf(node);
  const landing = node.kind === "land";
  ui.title.textContent = landing ? `Atterrissage ${index + 1}/${planNodes.length}` : `Manœuvre ${index + 1}/${planNodes.length}`;
  for (const el of [ui.heading, ui.power, ui.duration]) el.closest("label").hidden = landing;
  ui.presets.hidden = landing;
  ui.outTime.textContent = formatT(node.t);
  ui.outHeading.textContent = `${node.heading > 0 ? "+" : ""}${Math.round(node.heading)}°`;
  ui.outPower.textContent = `${Math.round(node.power * 100)} %`;
  ui.outDuration.textContent = `${node.duration.toFixed(2)} s`;

  const predicted = prediction && prediction.nodes.find((n) => n.id === node.id);
  const lines = [landing ? `Atterrissage guidé · Δv ≈ ${nodeDeltaV(node, predicted).toFixed(1)}` : `Δv ≈ ${nodeDeltaV(node).toFixed(1)}`];
  if (!predicted || predicted.startT === undefined) {
    lines.push("Non atteinte : le tracé s'arrête avant (impact ou horizon).");
  } else {
    const delay = predicted.startT - node.t;
    if (delay > 0.05) lines.push(`Démarre ${delay.toFixed(1)} s plus tard (manœuvre précédente).`);
    lines.push(`Référentiel : ${predicted.startRef.name}`);
    if (landing) {
      if (predicted.burnStartT !== undefined) lines.push(`Allumage : ${formatT(predicted.burnStartT)}`);
      if (predicted.endT !== undefined) lines.push(`Posé : ${formatT(predicted.endT)} · carburant ${predicted.fuelAfter.toFixed(0)}`);
      else lines.push("Pas de contact prévu (crash ou horizon dépassé).");
    } else if (predicted.burnStartT !== undefined) {
      lines.push(`Rotation : ${(predicted.burnStartT - predicted.startT).toFixed(1)} s`);
      if (predicted.endT !== undefined && node.power > 0 && node.duration > 0) {
        lines.push(`Poussée : ${formatT(predicted.burnStartT)} → ${formatT(predicted.endT)}`);
        lines.push(`Carburant : ${predicted.fuelBefore.toFixed(0)} → ${predicted.fuelAfter.toFixed(0)}`);
      }
    }
    if (predicted.endT === undefined) lines.push("Interrompue avant la fin (impact ou horizon).");
  }
  ui.info.textContent = lines.join("\n");
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function drawPredictedPath(pred) {
  const pts = pred.display;
  const broken = pred.layout.broken;
  noFill();
  let k = 1;
  while (k < pts.length) {
    const phase = pts[k].phase;
    const style = PHASE_STYLES[phase];
    stroke(...style.color);
    strokeWeight(style.weight / zoom);
    drawingContext.setLineDash(style.dashed ? [6 / zoom, 6 / zoom] : []);
    beginShape();
    vertex(pts[k - 1].x, pts[k - 1].y);
    while (k < pts.length && pts[k].phase === phase) {
      // changement de patch vers un astre ancêtre : le tracé repart autour
      // de la position actuelle de cet astre, on ne relie pas les deux
      if (pts[k].patch !== pts[k - 1].patch && broken[pts[k].patch]) break;
      vertex(pts[k].x, pts[k].y);
      k++;
    }
    endShape();
    if (k < pts.length && pts[k].patch !== pts[k - 1].patch && broken[pts[k].patch]) k++;
  }
  drawingContext.setLineDash([]);
}

function drawPathEnd(pred) {
  if (pred.end !== "crash" || !pred.display.length) return;
  const p = pred.display[pred.display.length - 1];
  const r = 6 / zoom;
  push();
  stroke(255, 90, 90);
  strokeWeight(2 / zoom);
  line(p.x - r, p.y - r, p.x + r, p.y + r);
  line(p.x - r, p.y + r, p.x + r, p.y - r);
  noStroke();
  fill(255, 90, 90);
  textSize(12 / zoom);
  textAlign(CENTER, BOTTOM);
  text("Impact prévu", p.x, p.y - r - 2 / zoom);
  pop();
}

// cercle éventuellement immense (orbite, sphère d'influence) : au-delà
// d'une certaine taille à l'écran, on ne trace que l'arc visible — un
// cercle pointillé de plusieurs centaines de milliers de pixels est très
// coûteux à rasteriser
function drawBigCircle(cx, cy, r) {
  if (r * zoom < 2000) {
    circle(cx, cy, r * 2);
    return;
  }
  const half = Math.hypot(width, height) / 2 / zoom;
  const d = Math.hypot(cameraX - cx, cameraY - cy);
  if (Math.abs(d - r) > half) return; // arc hors de l'écran
  const center = Math.atan2(cameraY - cy, cameraX - cx);
  const span = Math.min(PI, Math.asin(Math.min(1, half / r)) * 1.3);
  beginShape();
  for (let i = 0; i <= 96; i++) {
    const a = center - span + (2 * span * i) / 96;
    vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  endShape();
}

// orbite de chaque astre autour de son parent, et sphère d'influence de
// l'astre de référence et de ses satellites
function drawOrbits() {
  push();
  noFill();
  strokeWeight(1 / zoom);
  drawingContext.setLineDash([3 / zoom, 6 / zoom]);
  stroke(255, 255, 255, 70);
  for (const body of ALL_BODIES) {
    if (!body.parentBody) continue;
    drawBigCircle(body.parentBody.x, body.parentBody.y, body.orbitRadius);
  }
  stroke(120, 170, 255, 45);
  drawingContext.setLineDash([2 / zoom, 10 / zoom]);
  for (const body of [ship.ref, ...ship.ref.children]) {
    if (Number.isFinite(body.soi)) drawBigCircle(body.x, body.y, body.soi);
  }
  pop();
}

function drawApsis(pred, point, label, color) {
  const p = displayPosition(pred, point.patch, point.rx, point.ry);
  if (!p) return;
  const body = pred.patches[point.patch].body;
  push();
  noStroke();
  fill(...color);
  circle(p.x, p.y, 8 / zoom);
  fill(255);
  textSize(12 / zoom);
  textAlign(CENTER, BOTTOM);
  text(`${label} · alt ${(point.dist - body.radius).toFixed(0)}`, p.x, p.y - 8 / zoom);
  pop();
}

// orbite visée par le calculateur de route, autour de l'astre à l'arrivée
function drawTargetOrbit(pred, target) {
  if (!target) return;
  let center = null;
  for (let j = pred.patches.length - 1; j >= 0; j--) {
    if (pred.patches[j].body === target.body && pred.layout.anchors[j]) {
      center = pred.layout.anchors[j];
      break;
    }
  }
  if (!center) center = { x: target.body.x, y: target.body.y };
  push();
  noFill();
  stroke(255, 120, 220, 170);
  strokeWeight(1.5 / zoom);
  drawingContext.setLineDash([10 / zoom, 6 / zoom]);
  drawBigCircle(center.x, center.y, target.radius);
  noStroke();
  fill(255, 120, 220);
  textSize(12 / zoom);
  textAlign(CENTER, BOTTOM);
  text(`Orbite visée · ${target.body.name}`, center.x, center.y - target.radius - 4 / zoom);
  pop();
}

// position des astres à l'heure prévue de chaque manœuvre (fantômes), dans
// le repère du patch où se trouve la manœuvre
function drawGhostBodies(pred) {
  push();
  // astre rencontré en route : dessiné là où il sera au moment de la rencontre
  const { anchors, broken, current } = pred.layout;
  for (let j = current + 1; j < pred.patches.length; j++) {
    if (broken[j] || !anchors[j]) continue;
    const body = pred.patches[j].body;
    noStroke();
    fill(...body.color, 110);
    circle(anchors[j].x, anchors[j].y, Math.max(body.radius * 2, 8 / zoom));
    fill(255, 200);
    textSize(11 / zoom);
    textAlign(CENTER, TOP);
    text(`${body.name} à l'arrivée (${formatT(pred.patches[j].t)})`, anchors[j].x, anchors[j].y + Math.max(body.radius, 4 / zoom) + 4 / zoom);
  }
  drawingContext.setLineDash([4 / zoom, 4 / zoom]);
  for (const pn of pred.nodes) {
    if (pn.startT === undefined) continue;
    const anchor = pred.layout.anchors[pn.startPatch];
    if (!anchor) continue;
    const frameBody = pred.patches[pn.startPatch].body;
    const framePos = bodyPositionAt(frameBody, pn.startT);
    const highlighted = pn.id === selectedNodeId;
    // les satellites de l'astre du patch (ex : la Lune autour de la Terre,
    // les planètes autour du Soleil) — l'astre du patch lui-même reste fixe
    for (const body of frameBody.children) {
      const pos = bodyPositionAt(body, pn.startT);
      const x = anchor.x + pos.x - framePos.x;
      const y = anchor.y + pos.y - framePos.y;
      noFill();
      stroke(...body.color, highlighted ? 220 : 80);
      strokeWeight((highlighted ? 2 : 1) / zoom);
      drawBigCircle(x, y, Math.max(body.radius, 4 / zoom));
      if (highlighted) {
        noStroke();
        fill(255, 220);
        textSize(11 / zoom);
        textAlign(CENTER, TOP);
        text(`${body.name} à ${formatT(pn.startT)}`, x, y + Math.max(body.radius, 4 / zoom) + 4 / zoom);
      }
    }
  }
  pop();
}

function drawManeuverNodes(pred) {
  push();
  pred.nodes.forEach((pn, i) => {
    if (pn.startT === undefined) return;
    const p = displayPosition(pred, pn.startPatch, pn.startX, pn.startY);
    if (!p) return;
    const selected = pn.id === selectedNodeId;

    // direction de poussée, au point où la poussée commence
    if (pn.kind !== "land" && pn.burnStartT !== undefined && pn.power > 0 && pn.duration > 0) {
      const b = displayPosition(pred, pn.burnStartPatch, pn.burnStartX, pn.burnStartY);
      if (b) {
        const len = 36 / zoom;
        const tipX = b.x + Math.cos(pn.targetAngle) * len;
        const tipY = b.y + Math.sin(pn.targetAngle) * len;
        stroke(255, 150, 60);
        strokeWeight(2 / zoom);
        line(b.x, b.y, tipX, tipY);
        noStroke();
        fill(255, 150, 60);
        const head = 6 / zoom;
        triangle(
          tipX + Math.cos(pn.targetAngle) * head,
          tipY + Math.sin(pn.targetAngle) * head,
          tipX + Math.cos(pn.targetAngle + HALF_PI) * head * 0.7,
          tipY + Math.sin(pn.targetAngle + HALF_PI) * head * 0.7,
          tipX + Math.cos(pn.targetAngle - HALF_PI) * head * 0.7,
          tipY + Math.sin(pn.targetAngle - HALF_PI) * head * 0.7
        );
      }
    }

    stroke(255);
    strokeWeight((selected ? 3 : 1.5) / zoom);
    fill(selected ? [255, 230, 120] : [40, 50, 80]);
    circle(p.x, p.y, (selected ? 14 : 11) / zoom);
    noStroke();
    fill(255);
    textSize(11 / zoom);
    textAlign(LEFT, BOTTOM);
    const when = pn.startT < gameTime ? "en cours" : formatT(pn.startT);
    const label = pn.kind === "land" ? " · atterrissage" : "";
    text(`M${pred.firstNode + i + 1} · ${when}${label}`, p.x + 9 / zoom, p.y - 6 / zoom);
  });
  pop();
}

function drawStars() {
  randomSeed(1);
  noStroke();
  fill(255, 255, 255, 150);
  for (let i = 0; i < 200; i++) {
    const x = (random(-2000, 2000) - cameraX * 0.02) % width;
    const y = (random(-2000, 2000) - cameraY * 0.02) % height;
    circle((x + width) % width, (y + height) % height, 2);
  }
}

// traînée relative à l'astre de référence actuel
function drawTrail() {
  const refPos = bodyPositionAt(ship.ref, gameTime);
  noFill();
  strokeWeight(1.5 / zoom);
  beginShape();
  for (let i = 0; i < trail.length; i++) {
    const p = trail[i];
    if (p.ref !== ship.ref) continue;
    stroke(255, 255, 255, map(i, 0, trail.length, 0, 120));
    vertex(refPos.x + p.rx, refPos.y + p.ry);
  }
  endShape();
}

function drawBody(body) {
  noStroke();
  fill(...body.color);
  circle(body.x, body.y, Math.max(body.radius * 2, 6 / zoom));
}

// nom des astres trop petits à l'écran pour être reconnus
function drawBodyLabels() {
  noStroke();
  textSize(11);
  textAlign(CENTER, TOP);
  for (const body of ALL_BODIES) {
    if (body.radius * zoom > 12) continue;
    const s = worldToScreen(body.x, body.y);
    if (s.x < -50 || s.y < -50 || s.x > width + 50 || s.y > height + 50) continue;
    fill(255, 170);
    text(body.name, s.x, s.y + 6);
  }
}

function drawShip() {
  push();
  translate(ship.x, ship.y);
  rotate(ship.angle);
  // taille minimale à l'écran pour ne pas perdre le vaisseau en dézoomant
  const k = Math.max(1, 6 / (ship.size * zoom));
  scale(k);
  noStroke();
  fill(ship.crashed ? [200, 60, 60] : [255, 220, 120]);
  triangle(-ship.size / 2, -ship.size / 2, -ship.size / 2, ship.size / 2, ship.size / 2, 0);
  if (ship.thrusting && !ship.crashed && mode === "flight") {
    fill(255, 140, 40);
    triangle(-ship.size / 2, -ship.size / 4, -ship.size / 2, ship.size / 4, -ship.size - 8, 0);
  }
  pop();
}

function drawVelocityVector() {
  // vitesse relative au référentiel actif (comme le mode "Surface/Orbit" de Kerbal)
  const scaleFactor = 0.5;
  stroke(100, 220, 255, 200);
  strokeWeight(2 / zoom);
  line(ship.x, ship.y, ship.x + ship.rvx * scaleFactor, ship.y + ship.rvy * scaleFactor);
}

function autopilotStatus() {
  if (!autopilot) return "";
  const node = autopilot.nodes[autopilot.index];
  const label = `Plan : manœuvre ${autopilot.index + 1}/${autopilot.nodes.length}`;
  if (!node) return label;
  if (autopilot.phase === "landing") return `${label} — atterrissage guidé`;
  if (autopilot.phase === "rotating") return `${label} — rotation vers le cap`;
  if (autopilot.phase === "burning") return `${label} — poussée (reste ${Math.max(0, autopilot.burnEnd - gameTime).toFixed(1)} s)`;
  return `${label} — dans ${formatT(node.t).replace("T+", "")}`;
}

function drawHUD(referenceBody, prediction) {
  const relSpeed = Math.hypot(ship.rvx, ship.rvy);
  const r = Math.hypot(ship.rx, ship.ry);
  const altitude = r - referenceBody.radius;
  const orbitalV = Math.sqrt(referenceBody.mu / r);

  noStroke();
  fill(255, 220);
  textSize(14);
  textAlign(LEFT, TOP);
  const status =
    mode === "planning"
      ? "⏸ PAUSE — planification"
      : ship.crashed
      ? "CRASH — [R] pour relancer"
      : autopilot
      ? autopilotStatus()
      : ship.landed
      ? "Posé — [↑] pour décoller · [F] faire le plein"
      : "";
  const warp = effectiveWarp();
  const lines = [
    `Référentiel : ${referenceBody.name}`,
    `Vitesse relative : ${relSpeed.toFixed(1)}`,
    `Altitude : ${Math.max(0, altitude).toFixed(0)}`,
    `Vitesse orbitale visée : ${orbitalV.toFixed(1)}`,
    ship.landed ? "" : `Vitesse de rotation : ${degrees(ship.angularVelocity).toFixed(0)}°/s`,
    mode === "flight" && WARP_LEVELS[warpIndex] > 1 ? `Temps accéléré ×${Math.round(warp)}${warp < WARP_LEVELS[warpIndex] ? " (manœuvre proche)" : ""}` : "",
    status,
  ];
  lines.forEach((l, i) => text(l, 16, 16 + i * 20));

  let y = 16 + lines.length * 20 + 4;
  drawFuelGauge(16, y, prediction);
  y += 34;
  if (!ship.landed && !ship.crashed) {
    drawRotationIndicator(16, y);
    y += 40;
  }

  if (mode === "planning") drawPlanSummary(16, y, prediction);

  fill(255, 220);
  textSize(14);
  textAlign(LEFT, BOTTOM);
  const controlLines =
    mode === "planning"
      ? [
          "Clic sur le tracé : ajouter une manœuvre · clic sur un point : la sélectionner · glisser un point : le déplacer",
          "Glisser le fond : déplacer la vue · molette : zoom · [Suppr] effacer la manœuvre · [Échap] désélectionner",
          "« Destination » : choisir un astre et une altitude, la route est calculée automatiquement · « Atterrir » : se poser à la fin du plan",
          "[P] ou « Lancer le plan » : reprendre le jeu, le pilote automatique exécute le plan",
          "Tracé : vert = sans poussée · jaune = rotation · orange = poussée — chaque portion est dessinée autour de son astre",
        ]
      : [
          "↑ poussée · ←/→ maintenir pour tourner, tapoter pour ajuster finement (inertie, sans frottement)",
          "[C] caméra libre (glisser / molette) · [,] [.] accélérer le temps",
          autopilot ? "Pilote automatique actif — une touche fléchée reprend la main" : "Pointillés verts : trajectoire prédite (sans poussée)",
          "[P] ou « Planifier » : pause et planification de la trajectoire",
        ];
  controlLines.forEach((l, i) => {
    text(l, 16, height - 16 - (controlLines.length - 1 - i) * 20);
  });
}

// jauge de carburant ; en planification, marque ce qui restera après le plan
function drawFuelGauge(x, y, prediction) {
  const w = 180;
  const h = 8;
  const ratio = ship.fuel / FUEL_MAX;
  noStroke();
  fill(255, 255, 255, 30);
  rect(x, y + 16, w, h, 3);
  fill(ratio > 0.2 ? [130, 220, 255] : [255, 110, 90]);
  rect(x, y + 16, w * ratio, h, 3);

  let label = `Carburant (Δv) : ${ship.fuel.toFixed(0)} / ${FUEL_MAX} · dépensé ${(FUEL_MAX - ship.fuel).toFixed(0)}`;
  if (mode === "planning" && prediction && planNodes.length) {
    const after = prediction.finalState.fuel;
    fill(255, 230, 120);
    rect(x + w * (after / FUEL_MAX) - 1, y + 13, 2, h + 6);
    label += ` · après le plan ${after.toFixed(0)}`;
    if (after <= 0.01) label += " ⚠ réservoir vide";
  }
  fill(255, 220);
  textSize(12);
  textAlign(LEFT, TOP);
  text(label, x, y);
}

function drawPlanSummary(x, y, prediction) {
  textSize(13);
  textAlign(LEFT, TOP);
  noStroke();
  fill(255, 220);
  if (!planNodes.length) {
    text("Aucune manœuvre — cliquez sur le tracé ou choisissez une destination", x, y);
    return;
  }
  const total = planNodes.reduce((sum, n) => sum + nodeDeltaV(n, prediction && prediction.nodes.find((p) => p.id === n.id)), 0);
  text(`Plan de vol : ${planNodes.length} manœuvres · Δv total ${total.toFixed(0)}`, x, y);
  const maxLines = Math.max(3, Math.floor((height - y - 160) / 18));
  planNodes.slice(0, maxLines).forEach((node, i) => {
    const predicted = prediction && prediction.nodes.find((n) => n.id === node.id);
    const start = predicted && predicted.startT !== undefined ? `${formatT(predicted.startT)} (${predicted.startRef.name})` : "non atteinte";
    const burn = node.power > 0 && node.duration > 0 ? `Δv ${nodeDeltaV(node).toFixed(1)}` : "rotation seule";
    const what = node.kind === "land" ? `atterrissage guidé · Δv ${nodeDeltaV(node, predicted).toFixed(1)}` : `cap ${Math.round(node.heading)}° · ${burn}`;
    fill(node.id === selectedNodeId ? [255, 230, 120] : [255, 255, 255, 200]);
    text(`M${i + 1} · ${start} · ${what}`, x, y + 18 + i * 18);
  });
  if (planNodes.length > maxLines) {
    fill(255, 160);
    text(`… ${planNodes.length - maxLines} de plus`, x, y + 18 + maxLines * 18);
  }
}

function drawRotationIndicator(x, y) {
  const maxNotches = 6;
  const notchSize = 10;
  const gap = 3;
  const step = notchSize + gap;
  const count = constrain(Math.round(Math.abs(ship.angularVelocity) / ROTATION_TAP_UNIT), 0, maxNotches);
  const spinningLeft = ship.angularVelocity < -0.001;
  const spinningRight = ship.angularVelocity > 0.001;
  const centerX = x + maxNotches * step;

  noStroke();
  rectMode(CORNER);

  // crans à gauche du centre : s'allument si le vaisseau tourne à gauche
  for (let i = 0; i < maxNotches; i++) {
    const filled = spinningLeft && i < count;
    fill(filled ? [255, 150, 90] : [255, 255, 255, 30]);
    rect(centerX - gap / 2 - (i + 1) * step, y, notchSize, notchSize, 2);
  }
  // crans à droite du centre : s'allument si le vaisseau tourne à droite
  for (let i = 0; i < maxNotches; i++) {
    const filled = spinningRight && i < count;
    fill(filled ? [110, 190, 255] : [255, 255, 255, 30]);
    rect(centerX + gap / 2 + i * step, y, notchSize, notchSize, 2);
  }
  fill(255);
  rect(centerX - 1, y - 2, 2, notchSize + 4);

  fill(255, 200);
  textSize(11);
  textAlign(LEFT, TOP);
  const msg = spinningLeft
    ? `tourne à gauche — ${count} appui(s) droite pour stabiliser`
    : spinningRight
    ? `tourne à droite — ${count} appui(s) gauche pour stabiliser`
    : "rotation stable";
  text(msg, x, y + notchSize + 4);
}

function keyPressed() {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT") return; // saisie dans le panneau
  if ((key === "r" || key === "R") && ship.crashed) {
    resetShip();
    return;
  }
  if (key === "p" || key === "P") {
    if (mode === "planning") launchPlan();
    else enterPlanning();
    return;
  }
  if (mode === "flight") {
    if (key === "c" || key === "C") toggleCamera();
    if (key === ".") changeWarp(1);
    if (key === ",") changeWarp(-1);
    if ((key === "f" || key === "F") && ship.landed) ship.fuel = FUEL_MAX;
    return;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    deleteSelectedNode();
    return false;
  }
  if (keyCode === ESCAPE) {
    selectedNodeId = null;
    syncPanel();
  }
}
