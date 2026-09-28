// Prototype "lancer, orbiter" — issue #4
// Un vaisseau décolle de la surface d'une planète, subit une gravité
// newtonienne (planète + lune), et peut être placé en orbite stable.
//
// Mode navigation — issue #5
// Un bouton met le jeu en pause et ouvre la planification : on pose des
// points de manœuvre (rotation + poussée) sur le tracé prédit, puis on
// relance le jeu et le pilote automatique exécute le plan.

const G = 800; // constante de gravité (échelle jeu, pas la vraie valeur)

// horloge de jeu : la simulation avance par pas fixes, exactement comme la
// prédiction. Le plan exécuté suit donc au pas près le tracé planifié.
const SIM_DT = 1 / 60;
const MAX_FRAME_DT = 0.25; // évite une avalanche de pas après un onglet en arrière-plan

const SHIP_SIZE = 14;
const THRUST_ACCEL = 45; // accélération à pleine puissance
const LANDED_ROTATION_SPEED = 3.6; // rad/s — rotation au sol, sans inertie

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

// prédiction
const FLIGHT_PREDICTION_HORIZON = 60; // s, en vol libre
const PLAN_MIN_HORIZON = 120; // s, en planification (time-warp implicite)
const PLAN_MAX_HORIZON = 400;
const PLAN_TAIL = 60; // s de tracé affiché après la dernière manœuvre
const POINT_STRIDE = 3; // un point de tracé tous les N pas de simulation

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

const planet = {
  name: "Terre", // astre principal du système par défaut, en attendant un Soleil
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 220,
  mass: 1800,
  color: [90, 140, 200],
};

const moon = {
  name: "Lune",
  orbitRadius: 1600,
  orbitSpeed: 0.028, // rad/s — réduit pour garder une vitesse de déplacement similaire malgré le rayon plus grand
  radius: 60,
  mass: 500,
  color: [180, 180, 180],
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
};
// rayon de la sphère d'influence de la Lune (formule patched-conics simplifiée)
moon.soi = moon.orbitRadius * Math.pow(moon.mass / planet.mass, 2 / 5);

let ship;
let trail = [];
const TRAIL_MAX = 400;

let gameTime = 0;
let simAccumulator = 0;

let cameraX = 0;
let cameraY = 0;
let zoom = 1;

// "flight" : jeu en cours · "planning" : jeu en pause, édition du plan
let mode = "flight";
let planNodes = []; // manœuvres en cours d'édition
let nextNodeId = 1;
let selectedNodeId = null;
let planPrediction = null; // tracé mis en cache pendant la planification
let planDirty = true;
let autopilot = null; // plan en cours d'exécution

let pointer = null; // geste souris en cours (planification)

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
    x: planet.x + cos(startAngle) * (planet.radius + SHIP_SIZE),
    y: planet.y + sin(startAngle) * (planet.radius + SHIP_SIZE),
    vx: 0,
    vy: 0,
    angle: startAngle, // nez à l'opposé du centre de la planète, prêt à décoller
    angularVelocity: 0,
    size: SHIP_SIZE,
    crashed: false,
    landed: true,
    landedBody: planet,
    landedAngle: startAngle,
    thrusting: false,
  };
  trail = [];
  autopilot = null;
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

// ---------------------------------------------------------------------------
// Astres : positions en fonction du temps de jeu
// ---------------------------------------------------------------------------

function moonPositionAt(t) {
  return {
    x: planet.x + cos(t * moon.orbitSpeed) * moon.orbitRadius,
    y: planet.y + sin(t * moon.orbitSpeed) * moon.orbitRadius,
  };
}

function bodyPositionAt(body, t) {
  return body === moon ? moonPositionAt(t) : { x: planet.x, y: planet.y };
}

function bodyVelocityAt(body, t) {
  if (body !== moon) return { vx: 0, vy: 0 };
  // vitesse instantanée de la Lune sur son orbite (dérivée de la position)
  return {
    vx: -moon.orbitRadius * moon.orbitSpeed * sin(t * moon.orbitSpeed),
    vy: moon.orbitRadius * moon.orbitSpeed * cos(t * moon.orbitSpeed),
  };
}

// met à jour les astres affichés à l'instant t
function bodies(t) {
  const pos = moonPositionAt(t);
  const vel = bodyVelocityAt(moon, t);
  moon.x = pos.x;
  moon.y = pos.y;
  moon.vx = vel.vx;
  moon.vy = vel.vy;
  return [planet, moon];
}

function getReferenceBody(x, y, t) {
  // dans la sphère d'influence de la Lune : référentiel lunaire.
  // sinon, loin de tout, le référentiel par défaut est l'astre principal du système.
  const moonPos = moonPositionAt(t);
  if (dist(x, y, moonPos.x, moonPos.y) < moon.soi) return moon;
  return planet;
}

// ---------------------------------------------------------------------------
// Physique du vaisseau — partagée par la simulation et la prédiction
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

// avance l'état `s` du vaisseau d'un pas `dt` à partir de l'instant `t`.
// `control` : { left, right, thrust (0..1), slewTo (cap visé ou null), assist }
function stepShip(s, t, dt, control) {
  if (s.crashed) return;

  if (s.landed) {
    const body = s.landedBody;
    const pos = bodyPositionAt(body, t);
    s.x = pos.x + cos(s.landedAngle) * (body.radius + SHIP_SIZE / 2);
    s.y = pos.y + sin(s.landedAngle) * (body.radius + SHIP_SIZE / 2);
    s.vx = 0;
    s.vy = 0;
    s.thrusting = false;

    if (control.slewTo !== null) {
      s.angle = slewToward(s.angle, control.slewTo, AUTOPILOT_SLEW_RATE * dt);
    } else {
      if (control.left) s.angle -= LANDED_ROTATION_SPEED * dt;
      if (control.right) s.angle += LANDED_ROTATION_SPEED * dt;
    }

    if (!(control.thrust > 0)) return; // reste posé tant qu'on ne pousse pas
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
      const ref = getReferenceBody(s.x, s.y, t);
      const refVel = bodyVelocityAt(ref, t);
      const relVx = s.vx - refVel.vx;
      const relVy = s.vy - refVel.vy;
      if (mag(relVx, relVy) > 1) {
        const velocityAngle = atan2(relVy, relVx);
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

  // gravité newtonienne cumulée de chaque corps, à leur position à l'instant t
  const bodyStates = [planet, moon].map((body) => ({ body, ...bodyPositionAt(body, t) }));
  let ax = 0;
  let ay = 0;
  for (const { body, x, y } of bodyStates) {
    const dx = x - s.x;
    const dy = y - s.y;
    const r = mag(dx, dy) || 1;
    const a = (G * body.mass) / (r * r);
    ax += (a * dx) / r;
    ay += (a * dy) / r;
  }

  // poussée directionnelle
  if (control.thrust > 0) {
    ax += cos(s.angle) * THRUST_ACCEL * control.thrust;
    ay += sin(s.angle) * THRUST_ACCEL * control.thrust;
  }
  s.thrusting = control.thrust > 0;

  s.vx += ax * dt;
  s.vy += ay * dt;
  s.x += s.vx * dt;
  s.y += s.vy * dt;

  // collision avec un corps céleste
  for (const { body, x, y } of bodyStates) {
    const d = dist(s.x, s.y, x, y);
    if (d < body.radius + SHIP_SIZE / 2) {
      const outwardAngle = atan2(s.y - y, s.x - x);
      const tilt = Math.abs(angleDiff(s.angle, outwardAngle));
      const impactSpeed = mag(s.vx, s.vy);

      if (tilt <= LANDING_MAX_ANGLE && impactSpeed <= LANDING_MAX_SPEED) {
        // touche par l'arrière, à vitesse raisonnable : atterrissage réussi
        s.landed = true;
        s.landedBody = body;
        s.landedAngle = outwardAngle;
        s.angle = outwardAngle;
        s.x = x + cos(outwardAngle) * (body.radius + SHIP_SIZE / 2);
        s.y = y + sin(outwardAngle) * (body.radius + SHIP_SIZE / 2);
        s.vx = 0;
        s.vy = 0;
        s.angularVelocity = 0;
      } else {
        s.crashed = true;
      }
      break;
    }
  }
}

// direction du prograde (vitesse relative au référentiel local) ; posé au
// sol, c'est la verticale locale
function progradeAngle(s, t) {
  const ref = s.landed ? s.landedBody : getReferenceBody(s.x, s.y, t);
  const pos = bodyPositionAt(ref, t);
  const radial = atan2(s.y - pos.y, s.x - pos.x);
  if (s.landed) return radial;
  const vel = bodyVelocityAt(ref, t);
  const relVx = s.vx - vel.vx;
  const relVy = s.vy - vel.vy;
  if (mag(relVx, relVy) < 1) return radial;
  return atan2(relVy, relVx);
}

// ---------------------------------------------------------------------------
// Pilote automatique : exécute les manœuvres dans l'ordre chronologique.
// Chaque manœuvre = rotation vers le cap (relatif au prograde au moment où
// elle démarre), puis poussée (puissance × durée). Une manœuvre ne démarre
// qu'une fois la précédente terminée : le temps de rotation décale la suite.
// ---------------------------------------------------------------------------

function createAutopilot(nodes) {
  return {
    nodes: nodes.map((n) => ({ id: n.id, t: n.t, heading: n.heading, power: n.power, duration: n.duration })).sort((a, b) => a.t - b.t),
    index: 0,
    phase: "pending", // "pending" | "rotating" | "burning"
    targetAngle: 0,
    burnEnd: 0,
  };
}

function cloneAutopilot(ap) {
  return { ...ap, nodes: ap.nodes.map((n) => ({ ...n })) };
}

// fait avancer les phases du plan à l'instant t et renvoie la commande du
// prochain pas, ou null quand le plan est terminé. Note au passage, dans
// chaque manœuvre, où et quand elle a réellement démarré/poussé/fini.
function autopilotControl(ap, s, t) {
  while (ap.index < ap.nodes.length) {
    const node = ap.nodes[ap.index];

    if (ap.phase === "pending") {
      if (t < node.t) return COAST;
      ap.targetAngle = progradeAngle(s, t) + radians(node.heading);
      ap.phase = "rotating";
      node.targetAngle = ap.targetAngle;
      Object.assign(node, { startT: t, startX: s.x, startY: s.y });
    }

    if (ap.phase === "rotating") {
      if (angleDiff(s.angle, ap.targetAngle) !== 0) {
        return { ...COAST, slewTo: ap.targetAngle };
      }
      ap.phase = "burning";
      ap.burnEnd = t + node.duration;
      Object.assign(node, { burnStartT: t, burnStartX: s.x, burnStartY: s.y });
    }

    if (ap.phase === "burning") {
      if (node.power > 0 && t < ap.burnEnd - 1e-9) {
        return { ...COAST, slewTo: ap.targetAngle, thrust: node.power };
      }
      Object.assign(node, { endT: t, endX: s.x, endY: s.y });
      ap.index++;
      ap.phase = "pending";
    }
  }
  return null;
}

// manœuvres pas encore terminées, pour les rééditer en cours d'exécution
function remainingNodes(ap, t) {
  return ap.nodes.slice(ap.index).map((n, i) => {
    const node = { id: n.id, t: n.t, heading: n.heading, power: n.power, duration: n.duration };
    if (i === 0 && ap.phase !== "pending") {
      node.t = t;
      if (ap.phase === "burning") node.duration = Math.max(0, ap.burnEnd - t);
    }
    return node;
  });
}

// ---------------------------------------------------------------------------
// Prédiction de trajectoire
// ---------------------------------------------------------------------------

function planHorizon(nodes, t0, minHorizon) {
  let horizon = minHorizon;
  for (const n of nodes) horizon = Math.max(horizon, n.t - t0 + n.duration + PLAN_TAIL);
  return Math.min(horizon, PLAN_MAX_HORIZON);
}

// simule le vaisseau depuis `startState` avec le plan donné, en déplaçant
// les astres avec le temps. Le tracé est exprimé comme si le référentiel
// actif (ex : la Lune) restait figé à sa position actuelle.
function predictPath(startState, t0, plan, horizon) {
  const s = { ...startState };
  const ap = plan ? cloneAutopilot(plan) : null;
  const frame = getReferenceBody(s.x, s.y, t0);
  const frameAtT0 = bodyPositionAt(frame, t0);
  const toDisplay = (x, y, t) => {
    const f = bodyPositionAt(frame, t);
    return { x: x - f.x + frameAtT0.x, y: y - f.y + frameAtT0.y };
  };

  let t = t0;
  const points = [];
  // chaque point porte la phase du segment qui y aboutit
  const pushPoint = (phase) => points.push({ ...toDisplay(s.x, s.y, t), t, phase });
  pushPoint("coast");

  let lastPhase = "coast";
  let end = null;
  const steps = Math.ceil(horizon / SIM_DT);
  for (let i = 0; i < steps; i++) {
    let control = COAST;
    if (ap) control = autopilotControl(ap, s, t) || COAST;
    const phase = control.thrust > 0 ? "burn" : control.slewTo !== null ? "rotate" : "coast";
    if (phase !== lastPhase) {
      pushPoint(lastPhase); // borne exacte du changement de phase
      lastPhase = phase;
    }

    stepShip(s, t, SIM_DT, control);
    t += SIM_DT;

    if (s.crashed) {
      end = "crash";
      break;
    }
    const planDone = !ap || ap.index >= ap.nodes.length;
    if (s.landed && planDone) {
      end = "landed";
      break;
    }
    if (i % POINT_STRIDE === POINT_STRIDE - 1) pushPoint(phase);
  }
  pushPoint(lastPhase);

  // apogée/périgée de l'orbite obtenue après la dernière manœuvre
  // seules les manœuvres restantes (les terminées ne s'affichent plus)
  const firstNode = plan ? plan.index : 0;
  const nodes = ap ? ap.nodes.slice(firstNode) : [];
  const orbitStart = nodes.reduce((acc, n) => (n.endT !== undefined ? Math.max(acc, n.endT) : acc), t0);
  const unfinished = nodes.some((n) => n.endT === undefined);
  let periapsis = null;
  let apoapsis = null;
  if (!unfinished) {
    for (const p of points) {
      if (p.t < orbitStart) continue;
      const d = dist(p.x, p.y, frameAtT0.x, frameAtT0.y);
      if (!periapsis || d < periapsis.dist) periapsis = { x: p.x, y: p.y, dist: d };
      if (!apoapsis || d > apoapsis.dist) apoapsis = { x: p.x, y: p.y, dist: d };
    }
  }

  return { points, nodes, firstNode, frame, toDisplay, end, periapsis, apoapsis };
}

function currentPlanPrediction() {
  if (planDirty || !planPrediction) {
    const plan = planNodes.length ? createAutopilot(planNodes) : null;
    planPrediction = predictPath(ship, gameTime, plan, planHorizon(planNodes, gameTime, PLAN_MIN_HORIZON));
    planDirty = false;
  }
  return planPrediction;
}

function flightPrediction() {
  if (ship.crashed) return null;
  if (autopilot) {
    const horizon = planHorizon(autopilot.nodes.slice(autopilot.index), gameTime, FLIGHT_PREDICTION_HORIZON);
    return predictPath(ship, gameTime, autopilot, horizon);
  }
  if (ship.landed) return null;
  return predictPath(ship, gameTime, null, FLIGHT_PREDICTION_HORIZON);
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

function advanceSimulation(elapsed) {
  simAccumulator += Math.min(elapsed, MAX_FRAME_DT);
  const manual = readManualControl();

  // toute commande manuelle reprend la main sur le pilote automatique
  if (autopilot && (manual.left || manual.right || manual.thrust > 0)) {
    autopilot = null;
  }

  while (simAccumulator >= SIM_DT) {
    simAccumulator -= SIM_DT;
    let control = manual;
    if (autopilot) {
      const planned = autopilotControl(autopilot, ship, gameTime);
      if (planned) control = planned;
      else autopilot = null; // plan terminé : retour en pilotage manuel
    }
    const wasCrashed = ship.crashed;
    stepShip(ship, gameTime, SIM_DT, control);
    gameTime += SIM_DT;
    if (!wasCrashed && !ship.landed) {
      trail.push({ x: ship.x, y: ship.y });
      if (trail.length > TRAIL_MAX) trail.shift();
    }
  }
  if (ship.crashed) autopilot = null;
}

function draw() {
  if (mode === "flight") advanceSimulation(deltaTime * 0.001);

  bodies(gameTime);
  const referenceBody = getReferenceBody(ship.x, ship.y, gameTime);

  if (mode === "flight") {
    // caméra centrée sur le vaisseau, dézoome un peu quand la vitesse augmente
    const speed = mag(ship.vx, ship.vy);
    const targetZoom = constrain(map(speed, 0, 400, 1, 0.4), 0.35, 1);
    zoom = lerp(zoom, targetZoom, 0.05);
    cameraX = lerp(cameraX, ship.x, 0.1);
    cameraY = lerp(cameraY, ship.y, 0.1);
  }

  const prediction = mode === "planning" ? currentPlanPrediction() : flightPrediction();

  background(6, 8, 16);
  drawStars();

  push();
  translate(width / 2, height / 2);
  scale(zoom);
  translate(-cameraX, -cameraY);

  drawTrail();
  drawOtherBodyOrbit(referenceBody);
  if (prediction) drawGhostBodies(prediction);
  drawBody(planet);
  drawBody(moon);
  if (prediction) {
    drawPredictedPath(prediction.points);
    if (prediction.periapsis) drawApsis(prediction.periapsis, "Périgée", [255, 130, 130]);
    if (prediction.apoapsis) drawApsis(prediction.apoapsis, "Apogée", [130, 190, 255]);
    drawPathEnd(prediction);
    drawManeuverNodes(prediction);
  }
  drawShip();
  drawVelocityVector(referenceBody);

  pop();

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
  autopilot = null;
  selectedNodeId = null;
  planDirty = true;
  syncPanel();
}

function launchPlan() {
  if (mode !== "planning") return;
  autopilot = planNodes.length ? createAutopilot(planNodes) : null;
  planNodes = [];
  selectedNodeId = null;
  pointer = null;
  mode = "flight";
  syncPanel();
}

function clearPlan() {
  planNodes = [];
  selectedNodeId = null;
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

function nearestPathPoint(points, sx, sy) {
  let best = null;
  let bestDist = Infinity;
  for (const p of points) {
    const s = worldToScreen(p.x, p.y);
    const d = dist(s.x, s.y, sx, sy);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { point: best, dist: bestDist } : null;
}

function nodeAtScreen(prediction, sx, sy) {
  for (const pn of prediction.nodes) {
    if (pn.startT === undefined) continue;
    const p = prediction.toDisplay(pn.startX, pn.startY, pn.startT);
    const s = worldToScreen(p.x, p.y);
    if (dist(s.x, s.y, sx, sy) < NODE_HIT_RADIUS) return pn.id;
  }
  return null;
}

function mousePressed(event) {
  if (mode !== "planning" || !event || event.target !== canvasElt) return;
  const prediction = currentPlanPrediction();
  const hitId = nodeAtScreen(prediction, mouseX, mouseY);

  if (hitId !== null) {
    selectedNodeId = hitId;
    syncPanel();
    // tracé de référence pour le glisser : le plan sans ce point, dont la
    // trajectoire ne dépend pas de l'endroit où on le déplace
    const others = planNodes.filter((n) => n.id !== hitId);
    const pick = predictPath(ship, gameTime, others.length ? createAutopilot(others) : null, planHorizon(planNodes, gameTime, PLAN_MIN_HORIZON));
    pointer = { kind: "node", pick };
  } else {
    pointer = { kind: "pan", startX: mouseX, startY: mouseY, moved: false };
  }
}

function mouseDragged(event) {
  if (mode !== "planning" || !pointer) return;
  if (pointer.kind === "node") {
    const nearest = nearestPathPoint(pointer.pick.points, mouseX, mouseY);
    if (nearest) {
      updateSelectedNode({ t: nearest.point.t });
      syncPanel();
    }
  } else {
    if (dist(mouseX, mouseY, pointer.startX, pointer.startY) > CLICK_MAX_MOVE) pointer.moved = true;
    if (pointer.moved) {
      cameraX -= (mouseX - pmouseX) / zoom;
      cameraY -= (mouseY - pmouseY) / zoom;
    }
  }
}

function mouseReleased() {
  if (mode !== "planning" || !pointer) return;
  if (pointer.kind === "pan" && !pointer.moved) {
    // simple clic : pose un point de manœuvre sur le tracé, sinon désélectionne
    const nearest = nearestPathPoint(currentPlanPrediction().points, mouseX, mouseY);
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
  if (mode !== "planning" || event.target !== canvasElt) return;
  // zoom centré sur le curseur
  const before = screenToWorld(mouseX, mouseY);
  zoom = constrain(zoom * Math.pow(1.0015, -event.delta), 0.05, 4);
  const after = screenToWorld(mouseX, mouseY);
  cameraX += before.x - after.x;
  cameraY += before.y - after.y;
  return false;
}

// ---------------------------------------------------------------------------
// Interface (boutons + panneau d'édition, définis dans index.html)
// ---------------------------------------------------------------------------

function setupUI() {
  const byId = (id) => document.getElementById(id);
  Object.assign(ui, {
    plan: byId("btn-plan"),
    launch: byId("btn-launch"),
    clear: byId("btn-clear"),
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
  });

  // rend la main au clavier du jeu après un clic sur un bouton
  const onClick = (el, fn) =>
    el.addEventListener("click", () => {
      fn();
      el.blur();
    });
  onClick(ui.plan, enterPlanning);
  onClick(ui.launch, launchPlan);
  onClick(ui.clear, clearPlan);
  onClick(ui.remove, deleteSelectedNode);

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
  ui.time.value = node.t - gameTime;
  ui.heading.value = node.heading;
  ui.power.value = Math.round(node.power * 100);
  ui.duration.value = node.duration;
}

function formatT(t) {
  return `T+${(t - gameTime).toFixed(1)} s`;
}

function updateUI(prediction) {
  const planning = mode === "planning";
  ui.plan.hidden = planning;
  ui.plan.disabled = !canPlan();
  ui.launch.hidden = !planning;
  ui.clear.hidden = !planning;
  ui.clear.disabled = planNodes.length === 0;
  ui.launch.textContent = planNodes.length ? "▶ Lancer le plan" : "▶ Reprendre";

  const node = planning ? selectedNode() : null;
  if (!node) {
    ui.panel.hidden = true;
    return;
  }
  ui.panel.hidden = false;
  const index = planNodes.indexOf(node);
  ui.title.textContent = `Manœuvre ${index + 1}/${planNodes.length}`;
  ui.outTime.textContent = formatT(node.t);
  ui.outHeading.textContent = `${node.heading > 0 ? "+" : ""}${node.heading}°`;
  ui.outPower.textContent = `${Math.round(node.power * 100)} %`;
  ui.outDuration.textContent = `${node.duration.toFixed(1)} s`;

  const predicted = prediction && prediction.nodes.find((n) => n.id === node.id);
  const deltaV = THRUST_ACCEL * node.power * node.duration;
  const lines = [`Δv ≈ ${deltaV.toFixed(0)}`];
  if (!predicted || predicted.startT === undefined) {
    lines.push("Non atteinte : le tracé s'arrête avant (impact ou horizon).");
  } else {
    const delay = predicted.startT - node.t;
    if (delay > 0.05) lines.push(`Démarre ${delay.toFixed(1)} s plus tard (manœuvre précédente).`);
    if (predicted.burnStartT !== undefined) {
      lines.push(`Rotation : ${(predicted.burnStartT - predicted.startT).toFixed(1)} s`);
      if (predicted.endT !== undefined && node.power > 0 && node.duration > 0) {
        lines.push(`Poussée : ${formatT(predicted.burnStartT)} → ${formatT(predicted.endT)}`);
      }
    }
    if (predicted.endT === undefined) lines.push("Interrompue avant la fin (impact ou horizon).");
  }
  ui.info.textContent = lines.join("\n");
}

// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

function drawPredictedPath(points) {
  noFill();
  let k = 1;
  while (k < points.length) {
    const phase = points[k].phase;
    const style = PHASE_STYLES[phase];
    stroke(...style.color);
    strokeWeight(style.weight / zoom);
    drawingContext.setLineDash(style.dashed ? [6 / zoom, 6 / zoom] : []);
    beginShape();
    vertex(points[k - 1].x, points[k - 1].y);
    while (k < points.length && points[k].phase === phase) {
      vertex(points[k].x, points[k].y);
      k++;
    }
    endShape();
  }
  drawingContext.setLineDash([]);
}

function drawPathEnd(prediction) {
  if (prediction.end !== "crash") return;
  const p = prediction.points[prediction.points.length - 1];
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

// dans ce système à deux corps (la Lune orbite la Terre sur un cercle),
// l'astre qui n'est pas le référentiel actif trace toujours un cercle de
// même rayon (celui de l'orbite lunaire) autour de la position actuelle du
// référentiel — que ce soit la Terre (orbite réelle de la Lune) ou la Lune
// (orbite apparente de la Terre dans son référentiel).
function drawOtherBodyOrbit(referenceBody) {
  push();
  noFill();
  stroke(255, 255, 255, 90);
  strokeWeight(1 / zoom);
  drawingContext.setLineDash([3 / zoom, 6 / zoom]);
  circle(referenceBody.x, referenceBody.y, moon.orbitRadius * 2);
  pop();
}

function drawApsis(point, label, color) {
  push();
  noStroke();
  fill(...color);
  circle(point.x, point.y, 8 / zoom);
  fill(255);
  textSize(12 / zoom);
  textAlign(CENTER, BOTTOM);
  text(label, point.x, point.y - 8 / zoom);
  pop();
}

// position des astres à l'heure prévue de chaque manœuvre (fantômes)
function drawGhostBodies(prediction) {
  push();
  drawingContext.setLineDash([4 / zoom, 4 / zoom]);
  for (const pn of prediction.nodes) {
    if (pn.startT === undefined) continue;
    const highlighted = pn.id === selectedNodeId;
    for (const body of [planet, moon]) {
      if (body === prediction.frame) continue; // le référentiel reste figé à l'affichage
      const pos = bodyPositionAt(body, pn.startT);
      const d = prediction.toDisplay(pos.x, pos.y, pn.startT);
      noFill();
      stroke(...body.color, highlighted ? 220 : 80);
      strokeWeight((highlighted ? 2 : 1) / zoom);
      circle(d.x, d.y, body.radius * 2);
      noStroke();
      fill(255, highlighted ? 220 : 110);
      textSize(11 / zoom);
      textAlign(CENTER, TOP);
      text(`${body.name} à ${formatT(pn.startT)}`, d.x, d.y + body.radius + 4 / zoom);
    }
  }
  pop();
}

function drawManeuverNodes(prediction) {
  push();
  prediction.nodes.forEach((pn, i) => {
    if (pn.startT === undefined) return;
    const selected = pn.id === selectedNodeId;
    const p = prediction.toDisplay(pn.startX, pn.startY, pn.startT);

    // direction de poussée, au point où la poussée commence
    if (pn.burnStartT !== undefined && pn.power > 0 && pn.duration > 0) {
      const b = prediction.toDisplay(pn.burnStartX, pn.burnStartY, pn.burnStartT);
      const len = 36 / zoom;
      const tipX = b.x + cos(pn.targetAngle) * len;
      const tipY = b.y + sin(pn.targetAngle) * len;
      stroke(255, 150, 60);
      strokeWeight(2 / zoom);
      line(b.x, b.y, tipX, tipY);
      noStroke();
      fill(255, 150, 60);
      const head = 6 / zoom;
      triangle(
        tipX + cos(pn.targetAngle) * head,
        tipY + sin(pn.targetAngle) * head,
        tipX + cos(pn.targetAngle + HALF_PI) * head * 0.7,
        tipY + sin(pn.targetAngle + HALF_PI) * head * 0.7,
        tipX + cos(pn.targetAngle - HALF_PI) * head * 0.7,
        tipY + sin(pn.targetAngle - HALF_PI) * head * 0.7
      );
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
    text(`M${prediction.firstNode + i + 1} · ${when}`, p.x + 9 / zoom, p.y - 6 / zoom);
  });
  pop();
}

function drawStars() {
  randomSeed(1);
  noStroke();
  fill(255, 255, 255, 150);
  for (let i = 0; i < 200; i++) {
    const x = (random(-2000, 2000) - cameraX * 0.1) % width;
    const y = (random(-2000, 2000) - cameraY * 0.1) % height;
    circle((x + width) % width, (y + height) % height, 2);
  }
}

function drawTrail() {
  noFill();
  beginShape();
  for (let i = 0; i < trail.length; i++) {
    stroke(255, 255, 255, map(i, 0, trail.length, 0, 120));
    strokeWeight(1.5);
    vertex(trail[i].x, trail[i].y);
  }
  endShape();
}

function drawBody(body) {
  noStroke();
  fill(...body.color);
  circle(body.x, body.y, body.radius * 2);
}

function drawShip() {
  push();
  translate(ship.x, ship.y);
  rotate(ship.angle);
  noStroke();
  fill(ship.crashed ? [200, 60, 60] : [255, 220, 120]);
  triangle(-ship.size / 2, -ship.size / 2, -ship.size / 2, ship.size / 2, ship.size / 2, 0);
  if (ship.thrusting && !ship.crashed && mode === "flight") {
    fill(255, 140, 40);
    triangle(-ship.size / 2, -ship.size / 4, -ship.size / 2, ship.size / 4, -ship.size - 8, 0);
  }
  pop();
}

function drawVelocityVector(referenceBody) {
  // vitesse relative au référentiel actif (comme le mode "Surface/Orbit" de Kerbal)
  const relVx = ship.vx - referenceBody.vx;
  const relVy = ship.vy - referenceBody.vy;
  const scaleFactor = 0.5;
  stroke(100, 220, 255, 200);
  strokeWeight(2);
  line(ship.x, ship.y, ship.x + relVx * scaleFactor, ship.y + relVy * scaleFactor);
}

function autopilotStatus() {
  if (!autopilot) return "";
  const node = autopilot.nodes[autopilot.index];
  const label = `Plan : manœuvre ${autopilot.index + 1}/${autopilot.nodes.length}`;
  if (!node) return label;
  if (autopilot.phase === "rotating") return `${label} — rotation vers le cap`;
  if (autopilot.phase === "burning") return `${label} — poussée (reste ${Math.max(0, autopilot.burnEnd - gameTime).toFixed(1)} s)`;
  return `${label} — dans ${Math.max(0, node.t - gameTime).toFixed(1)} s`;
}

function drawHUD(referenceBody, prediction) {
  const relSpeed = mag(ship.vx - referenceBody.vx, ship.vy - referenceBody.vy);
  const altitude = dist(ship.x, ship.y, referenceBody.x, referenceBody.y) - referenceBody.radius;
  const orbitalV = sqrt((G * referenceBody.mass) / (altitude + referenceBody.radius));

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
      ? "Posé — [↑] pour décoller"
      : "";
  const lines = [
    `Référentiel : ${referenceBody.name}`,
    `Vitesse relative : ${relSpeed.toFixed(1)}`,
    `Altitude : ${Math.max(0, altitude).toFixed(0)}`,
    `Vitesse orbitale visée : ${orbitalV.toFixed(1)}`,
    ship.landed ? "" : `Vitesse de rotation : ${degrees(ship.angularVelocity).toFixed(0)}°/s`,
    status,
  ];
  lines.forEach((l, i) => text(l, 16, 16 + i * 20));

  let y = 16 + lines.length * 20 + 4;
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
          "[P] ou « Lancer le plan » : reprendre le jeu, le pilote automatique exécute le plan",
          "Tracé : vert = sans poussée · jaune = rotation · orange = poussée — cercles pointillés : astres à l'heure de chaque manœuvre",
        ]
      : [
          "↑ poussée · ←/→ maintenir pour tourner, tapoter pour ajuster finement (inertie, sans frottement)",
          "Accroche automatique sur prograde/rétrograde/perpendiculaire si rotation quasi nulle",
          autopilot ? "Pilote automatique actif — une touche fléchée reprend la main" : "Pointillés verts : trajectoire prédite (sans poussée)",
          "[P] ou « Planifier » : pause et planification de la trajectoire",
        ];
  controlLines.forEach((l, i) => {
    text(l, 16, height - 16 - (controlLines.length - 1 - i) * 20);
  });
}

function drawPlanSummary(x, y, prediction) {
  textSize(13);
  textAlign(LEFT, TOP);
  noStroke();
  fill(255, 220);
  if (!planNodes.length) {
    text("Aucune manœuvre — cliquez sur le tracé pour en ajouter une", x, y);
    return;
  }
  text("Plan de vol :", x, y);
  planNodes.forEach((node, i) => {
    const predicted = prediction && prediction.nodes.find((n) => n.id === node.id);
    const start = predicted && predicted.startT !== undefined ? formatT(predicted.startT) : "non atteinte";
    const burn = node.power > 0 && node.duration > 0 ? `${Math.round(node.power * 100)} % × ${node.duration.toFixed(1)} s` : "rotation seule";
    fill(node.id === selectedNodeId ? [255, 230, 120] : [255, 255, 255, 200]);
    text(`M${i + 1} · ${start} · cap ${node.heading}° · ${burn}`, x, y + 18 + i * 18);
  });
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
  if ((key === "r" || key === "R") && ship.crashed) {
    resetShip();
    return;
  }
  if (key === "p" || key === "P") {
    if (mode === "planning") launchPlan();
    else enterPlanning();
    return;
  }
  if (mode !== "planning") return;
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    deleteSelectedNode();
    return false;
  }
  if (keyCode === ESCAPE) {
    selectedNodeId = null;
    syncPanel();
  }
}
