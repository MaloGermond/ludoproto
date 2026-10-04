// ---------------------------------------------------------------------------
// Physique du vaisseau — partagée par la simulation et la prédiction.
// État relatif à l'astre de référence `ref` : rx, ry, rvx, rvy.
// ---------------------------------------------------------------------------

import {
  AUTOPILOT_SLEW_RATE,
  DRAG_COEFF,
  FUEL_MAX,
  HEAT_COOLING,
  HEAT_MAX,
  HEAT_RATE,
  LANDED_ROTATION_SPEED,
  LANDING_MAX_ANGLE,
  LANDING_MAX_SPEED,
  REFERENCE_MASS,
  ROTATION_ACCEL,
  SHIP_SIZE,
  SNAP_ANGLE_TOLERANCE,
  SNAP_ANGULAR_VELOCITY,
  SNAP_PULL,
  THRUST_ACCEL,
} from "./constants.js";
import { bodyPositionAt, bodyVelocityAt, localOrbit, planet } from "./bodies.js";
import { HALF_PI, PI, TWO_PI, angleDiff, slewToward } from "./math.js";

export function createShip(t) {
  const startAngle = -HALF_PI; // sommet de la planète
  const ship = {
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
    heat: 0,
    mass: REFERENCE_MASS, // kg — poids réglable dans l'interface
  };
  syncShipAbsolute(ship, t);
  return ship;
}

// ratio entre la masse réelle du vaisseau et celle pour laquelle
// THRUST_ACCEL (et les coefficients de traînée/échauffement) sont calibrés ;
// 1 à la masse de référence, comportement inchangé.
export function massRatio(s) {
  return s.mass / REFERENCE_MASS;
}

// accélération réellement délivrée par le moteur : un vaisseau plus lourd
// accélère moins pour la même poussée (F = m·a), freine aussi moins dans
// l'atmosphère (plus lourd = plus "balistique") et chauffe moins vite (plus
// d'inertie thermique) pour le même flux.
export function thrustAccel(s) {
  return THRUST_ACCEL / massRatio(s);
}

export function cloneShip(s) {
  return { ...s };
}

// position/vitesse absolues (affichage, caméra)
export function syncShipAbsolute(s, t) {
  const p = bodyPositionAt(s.ref, t);
  const v = bodyVelocityAt(s.ref, t);
  s.x = p.x + s.rx;
  s.y = p.y + s.ry;
  s.vx = v.vx + s.rvx;
  s.vy = v.vy + s.rvy;
}

// changement de sphère d'influence à l'instant t
export function updateSphereOfInfluence(s, t) {
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
export function stepShip(s, t, dt, control) {
  if (s.crashed) return;
  if (s.landed && !stepLanded(s, dt, control)) return; // reste posé
  applyRotation(s, dt, control);
  const acc = gravity(s);
  applyThrust(s, dt, control, acc);
  applyAtmosphere(s, dt, acc);
  if (s.crashed) return; // consumé dans l'atmosphère
  integrate(s, dt, acc);
  if (resolveCollision(s)) return;
  updateSphereOfInfluence(s, t + dt);
}

// posé : le vaisseau se déplace avec l'astre et ne peut que pivoter ; renvoie
// true s'il décolle pendant ce pas
function stepLanded(s, dt, control) {
  const h = s.ref.radius + SHIP_SIZE / 2;
  s.rx = Math.cos(s.landedAngle) * h;
  s.ry = Math.sin(s.landedAngle) * h;
  s.rvx = 0;
  s.rvy = 0;
  s.thrusting = false;

  if (control.slewTo !== null) {
    s.angle = slewToward(s.angle, control.slewTo, AUTOPILOT_SLEW_RATE * dt);
  } else {
    if (control.left) s.angle -= LANDED_ROTATION_SPEED * dt;
    if (control.right) s.angle += LANDED_ROTATION_SPEED * dt;
  }

  if (!(control.thrust > 0) || s.fuel <= 0) return false; // reste posé tant qu'on ne pousse pas
  s.landed = false; // décollage
  return true;
}

function applyRotation(s, dt, control) {
  if (control.slewTo !== null) {
    // pilote automatique : rotation à vitesse constante vers le cap du plan,
    // l'inertie de rotation est annulée
    s.angularVelocity = 0;
    s.angle = slewToward(s.angle, control.slewTo, AUTOPILOT_SLEW_RATE * dt);
    return;
  }
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
  if (control.assist) applyHeadingAssist(s, control);
}

// assistance au cap : rotation quasi nulle + déjà proche d'un cap
// remarquable (prograde/rétrograde/perpendiculaire) → accroche dessus.
// Désactivée tant qu'on maintient une touche, pour ne jamais "rattraper"
// une rotation volontaire et bloquer le vaisseau.
function applyHeadingAssist(s, control) {
  if (control.left || control.right || Math.abs(s.angularVelocity) >= SNAP_ANGULAR_VELOCITY) return;
  if (!(Math.hypot(s.rvx, s.rvy) > 1)) return;
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

// gravité de l'astre de référence uniquement (patched conics) ; renvoie
// l'accélération du pas, complétée ensuite par la poussée et la traînée
function gravity(s) {
  const r2 = s.rx * s.rx + s.ry * s.ry;
  const r = Math.sqrt(r2) || 1;
  const g = s.ref.mu / r2;
  return { ax: (-g * s.rx) / r, ay: (-g * s.ry) / r, r };
}

// poussée directionnelle, limitée par le carburant restant. Le carburant
// reste un budget de Δv (indépendant de la masse, par définition du Δv) :
// un vaisseau plus lourd met plus de temps à le dépenser à pleine poussée,
// mais une manœuvre donnée (Δv requis) lui coûte le même carburant.
function applyThrust(s, dt, control, acc) {
  let thrust = control.thrust > 0 ? control.thrust : 0;
  if (thrust > 0) {
    const accel = thrustAccel(s);
    const cost = thrust * accel * dt;
    if (cost > s.fuel) thrust *= s.fuel / cost;
    s.fuel = Math.max(0, s.fuel - thrust * accel * dt);
    acc.ax += Math.cos(s.angle) * accel * thrust;
    acc.ay += Math.sin(s.angle) * accel * thrust;
  }
  s.thrusting = thrust > 0;
}

// atmosphère : freinage (traînée en v²) et échauffement (flux en v³),
// tous deux proportionnels à la densité locale (décroissance exponentielle
// avec l'altitude). Hors atmosphère (ou astre sans atmosphère), la jauge
// de chaleur ne fait que se refroidir. Au-delà de HEAT_MAX, le vaisseau se
// consume. Un vaisseau plus massif encaisse mieux (déjà le cas en vrai :
// coefficient balistique plus élevé, plus d'inertie thermique) : la
// décélération et la chauffe sont toutes deux divisées par la masse.
function applyAtmosphere(s, dt, acc) {
  const R = s.ref;
  const altitude = acc.r - R.radius;
  const density = R.atmosphere && altitude < R.atmosphere.height ? R.atmosphere.density * Math.exp(-Math.max(0, altitude) / R.atmosphere.scaleHeight) : 0;
  if (density > 0) {
    const speed = Math.hypot(s.rvx, s.rvy) || 1e-6;
    const ratio = massRatio(s);
    const drag = (DRAG_COEFF * density * speed * speed) / ratio;
    acc.ax -= (drag * s.rvx) / speed;
    acc.ay -= (drag * s.rvy) / speed;
    s.heat += ((HEAT_RATE * density * speed * speed * speed) / ratio - HEAT_COOLING) * dt;
  } else {
    s.heat -= HEAT_COOLING * dt;
  }
  s.heat = Math.max(0, s.heat);
  if (s.heat >= HEAT_MAX) {
    s.crashed = true;
    s.crashReason = "chaleur";
  }
}

// intégration semi-implicite (Euler symplectique)
function integrate(s, dt, acc) {
  s.rvx += acc.ax * dt;
  s.rvy += acc.ay * dt;
  s.rx += s.rvx * dt;
  s.ry += s.rvy * dt;
}

// contact avec l'astre de référence : atterrissage si le vaisseau touche
// par l'arrière (nez vers l'extérieur) à vitesse raisonnable, sinon crash.
// Renvoie true s'il y a eu contact.
function resolveCollision(s) {
  const R = s.ref;
  const d = Math.hypot(s.rx, s.ry);
  if (d >= R.radius + SHIP_SIZE / 2) return false;
  const outwardAngle = Math.atan2(s.ry, s.rx);
  const tilt = Math.abs(angleDiff(s.angle, outwardAngle));
  const impactSpeed = Math.hypot(s.rvx, s.rvy); // relative à l'astre

  if (tilt <= LANDING_MAX_ANGLE && impactSpeed <= LANDING_MAX_SPEED) {
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
  return true;
}

// direction du prograde (vitesse relative à l'astre de référence) ; posé au
// sol, c'est la verticale locale
export function progradeAngle(s) {
  const radial = Math.atan2(s.ry, s.rx);
  if (s.landed) return s.landedAngle;
  if (Math.hypot(s.rvx, s.rvy) < 1) return radial;
  return Math.atan2(s.rvy, s.rvx);
}

// éléments de l'orbite képlérienne autour de l'astre de référence
export function orbitElements(s) {
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
