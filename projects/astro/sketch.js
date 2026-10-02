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

import {
  ALL_BODIES,
  AUTOPILOT_SLEW_RATE,
  COAST,
  FUEL_MAX,
  HALF_PI,
  HEAT_MAX,
  PI,
  ROTATION_TAP_UNIT,
  SHIP_SIZE,
  SIM_DT,
  THRUST_ACCEL,
  TWO_PI,
  angleDiff,
  bodies,
  bodyById,
  bodyPositionAt,
  bodyVelocityAt,
  cloneShip,
  constrain,
  createShip,
  degrees,
  isAncestorOrSelf,
  localOrbit,
  orbitElements,
  progradeAngle,
  radians,
  stepShip,
  sun,
  syncShipAbsolute,
} from "./src/sim/index.js";

const MAX_FRAME_DT = 0.25; // évite une avalanche de pas après un onglet en arrière-plan
const WARP_LEVELS = [1, 2, 5, 10, 25, 50, 100]; // accélération du temps

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

const PHASE_STYLES = {
  coast: { color: [130, 255, 170, 180], weight: 1.5, dashed: true },
  rotate: { color: [255, 230, 120, 220], weight: 2.5, dashed: false },
  burn: { color: [255, 150, 60, 240], weight: 3.5, dashed: false },
};

// ---------------------------------------------------------------------------
// État du jeu, regroupé en deux objets explicites que les fonctions reçoivent
// en paramètre (aucune variable d'état globale) :
// - world : ce qui est simulé ou planifié (vaisseau, temps, mode, plan…) ;
// - view : la façon de le regarder et de l'éditer (caméra, sélection…).
// ---------------------------------------------------------------------------

function createWorld() {
  const world = {
    ship: null,
    time: 0, // horloge de jeu
    accumulator: 0, // temps réel pas encore converti en pas de simulation
    warpIndex: 0,
    mode: "flight", // "flight" : jeu en cours · "planning" : pause, édition du plan
    nextNodeId: 1,
    plan: {
      nodes: [], // manœuvres en cours d'édition
      target: null, // orbite visée par le calculateur de route { body, radius }
      prediction: null, // tracé mis en cache pendant la planification
      dirty: true,
    },
    autopilot: null, // plan en cours d'exécution
    autopilotPrediction: null, // son tracé : l'exécution est déterministe, il reste valable
    autopilotTarget: null,
    flightPrediction: null,
    flightPredictionDirty: true,
  };
  resetShip(world);
  return world;
}

function createView(world) {
  return {
    cameraX: world.ship.x, // centrée sur le vaisseau au démarrage
    cameraY: world.ship.y,
    zoom: 1,
    zoomBias: 1, // réglage molette en caméra suiveuse
    cameraFree: false,
    cameraFrame: null, // astre avec lequel la caméra se déplace
    selectedNodeId: null,
    pointer: null, // geste souris en cours
    routeMessage: { text: "", error: false },
  };
}

function resetShip(world) {
  world.ship = createShip(world.time);
  world.autopilot = null;
  world.autopilotPrediction = null;
  world.flightPredictionDirty = true;
}

// évite un panoramique depuis le Soleil au démarrage/relance
function recenterCamera(view, ship) {
  view.cameraX = ship.x;
  view.cameraY = ship.y;
  view.cameraFrame = null;
}

// ---------------------------------------------------------------------------
// Copies : la simulation et la planification travaillent sur des copies
// pour explorer des futurs possibles sans toucher à l'état du jeu
// ---------------------------------------------------------------------------

// kind : undefined pour une manœuvre classique (rotation + poussée fixe),
// "land" pour un atterrissage guidé
function copyNode(n) {
  return { id: n.id, kind: n.kind, t: n.t, heading: n.heading, power: n.power, duration: n.duration };
}

function cloneAutopilot(ap) {
  return { ...ap, nodes: ap.nodes.map((n) => ({ ...n })) };
}

function cloneCtx(c) {
  return { s: cloneShip(c.s), t: c.t, ap: c.ap ? cloneAutopilot(c.ap) : null };
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

function currentPlanPrediction(world) {
  const plan = world.plan;
  if (plan.dirty || !plan.prediction) {
    plan.prediction = predictPath(world.ship, world.time, plan.nodes.length ? createAutopilot(plan.nodes) : null, PLAN_MAX_HORIZON);
    plan.dirty = false;
  }
  return plan.prediction;
}

function currentFlightPrediction(world) {
  const ship = world.ship;
  if (ship.crashed) return null;
  if (world.autopilot && world.autopilotPrediction) return world.autopilotPrediction;
  if (ship.landed) return null;
  if (world.flightPredictionDirty || !world.flightPrediction || world.time > world.flightPrediction.finalT - 1) {
    const horizon = ship.thrusting ? THRUST_PREDICTION_HORIZON : PLAN_MAX_HORIZON;
    world.flightPrediction = predictPath(ship, world.time, null, horizon);
    world.flightPredictionDirty = ship.thrusting; // tracé complet dès que la poussée s'arrête
  }
  return world.flightPrediction;
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
  const clear = body.atmosphere ? body.atmosphere.height * 1.3 : 0;
  return body.radius + Math.max(80, body.radius * 0.5, clear);
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

function planRoute(ship, t, target, altitude) {
  if (ship.crashed) throw new PlanError("Vaisseau détruit — [R] pour relancer.");
  const rt = target.radius + altitude;
  if (altitude < 10) throw new PlanError("Altitude trop basse (minimum 10).");
  if (rt > maxOrbitRadius(target)) {
    throw new PlanError(`Altitude trop haute pour ${target.name} (max ${Math.floor(maxOrbitRadius(target) - target.radius)}).`);
  }

  const nodes = [];
  let ctx = makeCtx(ship, t, null);
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

// numérote les manœuvres qui entrent dans le plan (le calculateur de route
// les produit sans identifiant)
function withIds(world, nodes) {
  return nodes.map((n) => ({ ...copyNode(n), id: world.nextNodeId++ }));
}

function computeRoute(world, view, targetId, altitude) {
  const target = bodyById[targetId];
  const ship = world.ship;
  try {
    const { nodes, final } = planRoute(ship, world.time, target, altitude);
    world.plan.nodes = withIds(world, nodes);
    world.plan.target = { body: target, radius: target.radius + altitude };
    world.plan.dirty = true;
    view.selectedNodeId = null;
    const dv = nodes.reduce((sum, n) => sum + n.power * n.duration * THRUST_ACCEL, 0);
    const el = orbitElements(final.s);
    view.routeMessage = {
      text:
        `${nodes.length} manœuvres · Δv ${dv.toFixed(0)} (carburant ${ship.fuel.toFixed(0)})\n` +
        `Arrivée ${formatT(final.t, world.time)} · orbite ${(el.periapsis - target.radius).toFixed(0)}–${(el.apoapsis - target.radius).toFixed(0)}` +
        (dv > ship.fuel ? "\n⚠ Carburant insuffisant pour tout le plan" : ""),
      error: dv > ship.fuel,
    };
  } catch (e) {
    if (!(e instanceof PlanError)) console.error(e);
    view.routeMessage = { text: e instanceof PlanError ? e.message : "Erreur de calcul de la route.", error: true };
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
function effectiveWarp(world) {
  let warp = WARP_LEVELS[world.warpIndex];
  const autopilot = world.autopilot;
  if (autopilot) {
    const node = autopilot.nodes[autopilot.index];
    if (autopilot.phase !== "pending") warp = 1;
    else if (node) warp = Math.min(warp, Math.max(1, node.t - world.time));
  }
  return warp;
}

function stopAutopilot(world) {
  world.autopilot = null;
  world.autopilotPrediction = null;
}

// un pas fixe de simulation : pilote automatique (s'il y en a un), sinon
// commande manuelle, puis physique du vaisseau
function stepWorld(world, control) {
  if (world.autopilot) {
    const planned = autopilotControl(world.autopilot, world.ship, world.time);
    if (planned) control = planned;
    else {
      stopAutopilot(world); // plan terminé : retour en pilotage manuel
      world.flightPredictionDirty = true;
    }
  }
  const wasLanded = world.ship.landed;
  stepShip(world.ship, world.time, SIM_DT, control);
  world.time += SIM_DT;
  if (world.ship.thrusting || world.ship.landed !== wasLanded) world.flightPredictionDirty = true;
}

function advanceSimulation(world, elapsed, manual) {
  const warp = effectiveWarp(world);
  world.accumulator += Math.min(elapsed, MAX_FRAME_DT) * warp;

  // toute commande manuelle reprend la main sur le pilote automatique
  if (world.autopilot && (manual.left || manual.right || manual.thrust > 0)) {
    stopAutopilot(world);
    world.flightPredictionDirty = true;
  }

  while (world.accumulator >= SIM_DT) {
    world.accumulator -= SIM_DT;
    stepWorld(world, manual);
  }
  if (world.ship.crashed) stopAutopilot(world);
}

// la caméra accompagne l'astre de référence du vaisseau (sinon, avec la
// Terre qui file autour du Soleil, tout sortirait de l'écran)
function updateCamera(view, world) {
  const ship = world.ship;
  const refPos = bodyPositionAt(ship.ref, world.time);
  if (view.cameraFrame && view.cameraFrame.body === ship.ref) {
    view.cameraX += refPos.x - view.cameraFrame.x;
    view.cameraY += refPos.y - view.cameraFrame.y;
  }
  view.cameraFrame = { body: ship.ref, x: refPos.x, y: refPos.y };
  if (view.cameraFree) return;

  // caméra suiveuse : centrée sur le vaisseau, dézoome quand la vitesse augmente
  const speed = Math.hypot(ship.rvx, ship.rvy);
  const targetZoom = constrain(map(speed, 0, 150, 1, 0.3), 0.25, 1) * view.zoomBias;
  view.zoom = lerp(view.zoom, targetZoom, 0.05);
  view.cameraX = lerp(view.cameraX, ship.x, 0.15);
  view.cameraY = lerp(view.cameraY, ship.y, 0.15);
}

// ---------------------------------------------------------------------------
// Crochets p5 : seul endroit où vivent l'état du jeu et sa vue
// ---------------------------------------------------------------------------

const app = { world: null, view: null };

function setup() {
  ui.canvas = createCanvas(windowWidth, windowHeight).elt;
  app.world = createWorld();
  app.view = createView(app.world);
  setupUI(app);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function draw() {
  const { world, view } = app;
  if (world.mode === "flight") advanceSimulation(world, deltaTime * 0.001, readManualControl());

  bodies(world.time);
  syncShipAbsolute(world.ship, world.time);
  if (world.mode === "flight") updateCamera(view, world);

  const prediction = world.mode === "planning" ? currentPlanPrediction(world) : currentFlightPrediction(world);
  if (prediction) layoutPrediction(prediction, world.time);
  renderScene(world, view, prediction);
  updateUI(world, view, prediction);
}

// ---------------------------------------------------------------------------
// Mode planification
// ---------------------------------------------------------------------------

function canPlan(world) {
  return !world.ship.crashed;
}

function enterPlanning(world, view) {
  if (world.mode === "planning" || !canPlan(world)) return;
  world.mode = "planning";
  // le plan en cours (s'il y en a un) redevient éditable
  world.plan.nodes = world.autopilot ? remainingNodes(world.autopilot, world.time) : [];
  world.plan.target = world.autopilot ? world.autopilotTarget : null;
  world.plan.dirty = true;
  stopAutopilot(world);
  view.selectedNodeId = null;
  view.routeMessage = { text: "", error: false };
}

function launchPlan(world, view) {
  if (world.mode !== "planning") return;
  const prediction = currentPlanPrediction(world);
  const plan = world.plan;
  world.autopilot = plan.nodes.length ? createAutopilot(plan.nodes) : null;
  // exécution déterministe : le tracé planifié reste exact pendant le vol
  world.autopilotPrediction = world.autopilot ? prediction : null;
  world.autopilotTarget = world.autopilot ? plan.target : null;
  plan.nodes = [];
  plan.target = null;
  world.flightPredictionDirty = true;
  world.mode = "flight";
  view.selectedNodeId = null;
  view.pointer = null;
  view.cameraFrame = null;
}

function clearPlan(world, view) {
  world.plan.nodes = [];
  world.plan.target = null;
  world.plan.dirty = true;
  view.selectedNodeId = null;
  view.routeMessage = { text: "", error: false };
}

function selectedNode(world, view) {
  return world.plan.nodes.find((n) => n.id === view.selectedNodeId) || null;
}

// ajoute des manœuvres au plan et sélectionne la dernière
function addNodes(world, view, nodes) {
  const added = withIds(world, nodes);
  world.plan.nodes.push(...added);
  world.plan.nodes.sort((a, b) => a.t - b.t);
  world.plan.dirty = true;
  view.selectedNodeId = added[added.length - 1].id;
}

function addNodeAt(world, view, t) {
  addNodes(world, view, [{ t, ...DEFAULT_NODE }]);
}

// état du vaisseau une fois le plan actuel exécuté
function planEnd(world) {
  return runCtx(makeCtx(world.ship, world.time, world.plan.nodes), Infinity, (c) => !planDone(c));
}

// ajoute, après les manœuvres déjà prévues, celle qui circularise l'orbite
// à la distance où se trouve alors le vaisseau
function circularizeOrbit(world, view) {
  if (world.mode !== "planning" || world.ship.crashed) return;
  const ctx = planEnd(world);
  if (ctx.s.landed || ctx.s.crashed) return;
  const node = makeBurnNode(ctx, ctx.t, (s) => circularDv(s, 0));
  if (!node) return; // déjà circulaire
  addNodes(world, view, [node]);
}

// séquence d'atterrissage : poussée qui annule la vitesse relative au temps
// deorbitT (chute verticale, sans dérive latérale puisque le moment
// cinétique devient nul), puis atterrissage guidé. Partagée par planLanding
// (déorbite immédiatement) et planLandingAt (déorbite au moment trouvé par
// recherche pour viser un point précis).
function landingSequence(ctx, deorbitT) {
  const c0 = deorbitT > ctx.t + 1e-6 ? runCtx(cloneCtx(ctx), deorbitT) : cloneCtx(ctx);
  const nodes = [];
  const deorbit = makeBurnNode(c0, c0.t, (s) => ({ x: -s.rvx, y: -s.rvy }));
  let c = deorbit ? commitNode(c0, deorbit, nodes) : c0;
  const land = { kind: "land", t: c.t, heading: 0, power: 1, duration: 0 };
  c = cloneCtx(c);
  c.ap.nodes.push(copyNode(land));
  nodes.push(land);
  runCtx(c, c.t + LANDING_TIMEOUT, (cc) => !planDone(cc));
  return { c, nodes };
}

function commitLanding(world, view, nodes, c, before, body) {
  addNodes(world, view, nodes);
  view.routeMessage = {
    text: `Atterrissage sur ${body.name} · Δv ${(before.s.fuel - c.s.fuel).toFixed(0)} · posé à ${formatT(c.t, world.time)} · angle ${degrees(c.s.landedAngle).toFixed(0)}°`,
    error: false,
  };
}

function checkLandingPossible(ctx, body) {
  if (ctx.s.crashed) throw new PlanError("Le plan actuel se termine par un crash.");
  if (ctx.s.landed) throw new PlanError(`Déjà posé sur ${body.name} à la fin du plan.`);
  if (!body.parentBody) throw new PlanError(`Impossible de se poser sur ${body.name}.`);
  if (body.mu / (body.radius * body.radius) > LANDING_IGNITION * THRUST_ACCEL) {
    throw new PlanError(`Gravité de ${body.name} trop forte pour le moteur.`);
  }
}

// ajoute, après les manœuvres déjà prévues, un atterrissage sur l'astre
// autour duquel le vaisseau se trouve alors, dès que possible
function planLanding(world, view) {
  if (world.mode !== "planning" || world.ship.crashed) return;
  const ctx = planEnd(world);
  const body = ctx.s.ref;
  try {
    checkLandingPossible(ctx, body);
    const { c, nodes } = landingSequence(ctx, ctx.t);
    if (!c.s.landed || c.s.ref !== body) throw new PlanError(`L'atterrissage sur ${body.name} échoue (crash ou carburant).`);
    commitLanding(world, view, nodes, c, ctx, body);
  } catch (e) {
    if (!(e instanceof PlanError)) console.error(e);
    view.routeMessage = { text: e instanceof PlanError ? e.message : "Erreur de calcul de l'atterrissage.", error: true };
  }
}

// vise un point précis de la surface (angle en degrés, 0-359°) : cherche le
// moment du déorbitage qui y fait atterrir. Sans poussée latérale, la chute
// est purement radiale (moment cinétique nul) : l'angle d'atterrissage ne
// dépend que du moment du déorbitage, en croissant de façon monotone (mais
// pas forcément uniforme, la rotation préalable du vaisseau vers le
// rétrograde prenant un temps variable) sur une période orbitale complète —
// il passe donc par la cible exactement une fois. Balayage grossier pour
// repérer ce passage, puis dichotomie pour l'affiner.
function planLandingAt(world, view, targetAngleDeg) {
  if (world.mode !== "planning" || world.ship.crashed) return;
  const base = planEnd(world);
  const body = base.s.ref;
  try {
    checkLandingPossible(base, body);
    const el = orbitElements(base.s);
    if (!el.bound || el.apoapsis >= body.soi) throw new PlanError("Orbite non liée : impossible de viser un point précis.");

    const target = radians(((targetAngleDeg % 360) + 360) % 360);
    const attempt = (t) => {
      const { c, nodes } = landingSequence(base, t);
      if (!c.s.landed || c.s.ref !== body) return null;
      return { c, nodes, err: angleDiff(c.s.landedAngle, target) };
    };

    // un vrai passage par la cible change le signe de err en le faisant
    // tendre vers 0 (somme des amplitudes petite) ; un saut de +180° à -180°
    // (habillage de l'angle) change aussi le signe mais sans s'approcher de
    // 0 (somme des amplitudes proche de 360°) — à ne pas confondre
    const isCrossing = (a, b) => Math.sign(a.err) !== Math.sign(b.err) && Math.abs(a.err) + Math.abs(b.err) < PI;

    const SCAN_STEPS = 16;
    let lo = base.t;
    let loTry = attempt(lo);
    if (!loTry) throw new PlanError(`L'atterrissage sur ${body.name} échoue (crash ou carburant) près de cette visée.`);
    let hi, hiTry;
    for (let i = 1; i <= SCAN_STEPS; i++) {
      hi = base.t + (i / SCAN_STEPS) * el.period;
      hiTry = attempt(hi);
      if (hiTry && isCrossing(loTry, hiTry)) break;
      lo = hi;
      loTry = hiTry || loTry;
    }
    if (!hiTry || !isCrossing(loTry, hiTry)) {
      throw new PlanError("Impossible de viser ce point sur l'orbite actuelle.");
    }
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      const midTry = attempt(mid);
      if (!midTry) break;
      if (Math.sign(midTry.err) === Math.sign(loTry.err)) {
        lo = mid;
        loTry = midTry;
      } else {
        hi = mid;
        hiTry = midTry;
      }
    }
    const result = Math.abs(loTry.err) < Math.abs(hiTry.err) ? loTry : hiTry;
    if (Math.abs(result.err) >= radians(2)) {
      throw new PlanError(`Visée imprécise (écart ${degrees(Math.abs(result.err)).toFixed(0)}°).`);
    }
    commitLanding(world, view, result.nodes, result.c, base, body);
  } catch (e) {
    if (!(e instanceof PlanError)) console.error(e);
    view.routeMessage = { text: e instanceof PlanError ? e.message : "Erreur de calcul de l'atterrissage visé.", error: true };
  }
}

function deleteSelectedNode(world, view) {
  if (view.selectedNodeId === null) return;
  world.plan.nodes = world.plan.nodes.filter((n) => n.id !== view.selectedNodeId);
  world.plan.dirty = true;
  view.selectedNodeId = null;
}

function updateSelectedNode(world, view, changes) {
  const node = selectedNode(world, view);
  if (!node) return;
  Object.assign(node, changes);
  world.plan.nodes.sort((a, b) => a.t - b.t);
  world.plan.dirty = true;
}

function worldToScreen(view, x, y) {
  return { x: (x - view.cameraX) * view.zoom + width / 2, y: (y - view.cameraY) * view.zoom + height / 2 };
}

function screenToWorld(view, x, y) {
  return { x: (x - width / 2) / view.zoom + view.cameraX, y: (y - height / 2) / view.zoom + view.cameraY };
}

function nearestPathPoint(view, pred, sx, sy) {
  let best = null;
  let bestDist = Infinity;
  for (const p of pred.display) {
    const s = worldToScreen(view, p.x, p.y);
    const d = dist(s.x, s.y, sx, sy);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { point: best, dist: bestDist } : null;
}

function nodeAtScreen(view, pred, sx, sy) {
  for (const pn of pred.nodes) {
    if (pn.startT === undefined) continue;
    const p = displayPosition(pred, pn.startPatch, pn.startX, pn.startY);
    if (!p) continue;
    const s = worldToScreen(view, p.x, p.y);
    if (dist(s.x, s.y, sx, sy) < NODE_HIT_RADIUS) return pn.id;
  }
  return null;
}

function mousePressed(event) {
  if (!event || event.target !== ui.canvas) return;
  const { world, view } = app;
  if (world.mode === "planning") {
    const prediction = currentPlanPrediction(world);
    const hitId = nodeAtScreen(view, prediction, mouseX, mouseY);
    if (hitId !== null) {
      view.selectedNodeId = hitId;
      syncPanel(world, view);
      // tracé de référence pour le glisser : le plan sans ce point, dont la
      // trajectoire ne dépend pas de l'endroit où on le déplace
      const others = world.plan.nodes.filter((n) => n.id !== hitId);
      const pick = predictPath(world.ship, world.time, others.length ? createAutopilot(others) : null, PLAN_MAX_HORIZON);
      view.pointer = { kind: "node", pick };
      return;
    }
  }
  view.pointer = { kind: "pan", startX: mouseX, startY: mouseY, moved: false };
}

function mouseDragged() {
  const { world, view } = app;
  const pointer = view.pointer;
  if (!pointer) return;
  if (pointer.kind === "node") {
    const nearest = nearestPathPoint(view, layoutPrediction(pointer.pick, world.time), mouseX, mouseY);
    if (nearest) {
      updateSelectedNode(world, view, { t: nearest.point.t });
      syncPanel(world, view);
    }
    return;
  }
  if (dist(mouseX, mouseY, pointer.startX, pointer.startY) > CLICK_MAX_MOVE) pointer.moved = true;
  if (pointer.moved) {
    view.cameraFree = true; // glisser la vue en vol passe en caméra libre
    view.cameraX -= (mouseX - pmouseX) / view.zoom;
    view.cameraY -= (mouseY - pmouseY) / view.zoom;
  }
}

function mouseReleased() {
  const { world, view } = app;
  const pointer = view.pointer;
  if (!pointer) return;
  if (world.mode === "planning" && pointer.kind === "pan" && !pointer.moved) {
    // simple clic : pose un point de manœuvre sur le tracé, sinon désélectionne
    const nearest = nearestPathPoint(view, currentPlanPrediction(world), mouseX, mouseY);
    if (nearest && nearest.dist < PICK_RADIUS) addNodeAt(world, view, nearest.point.t);
    else view.selectedNodeId = null;
    syncPanel(world, view);
  }
  view.pointer = null;
}

function mouseWheel(event) {
  if (event.target !== ui.canvas) return;
  const { world, view } = app;
  const factor = Math.pow(1.0015, -event.delta);
  if (world.mode === "flight" && !view.cameraFree) {
    view.zoomBias = constrain(view.zoomBias * factor, 0.0005, 4);
    return false;
  }
  // zoom centré sur le curseur
  const before = screenToWorld(view, mouseX, mouseY);
  view.zoom = constrain(view.zoom * factor, 0.0005, 4);
  const after = screenToWorld(view, mouseX, mouseY);
  view.cameraX += before.x - after.x;
  view.cameraY += before.y - after.y;
  return false;
}

function toggleCamera(view) {
  view.cameraFree = !view.cameraFree;
  if (!view.cameraFree) view.zoomBias = constrain(view.zoom, 0.0005, 4);
}

function changeWarp(world, delta) {
  world.warpIndex = constrain(world.warpIndex + delta, 0, WARP_LEVELS.length - 1);
}

function keyPressed() {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT") return; // saisie dans le panneau
  const { world, view } = app;
  if ((key === "r" || key === "R") && world.ship.crashed) {
    resetShip(world);
    recenterCamera(view, world.ship);
    return;
  }
  if (key === "p" || key === "P") {
    if (world.mode === "planning") launchPlan(world, view);
    else enterPlanning(world, view);
    syncPanel(world, view);
    return;
  }
  if (world.mode === "flight") {
    if (key === "c" || key === "C") toggleCamera(view);
    if (key === ".") changeWarp(world, 1);
    if (key === ",") changeWarp(world, -1);
    if ((key === "f" || key === "F") && world.ship.landed) world.ship.fuel = FUEL_MAX;
    return;
  }
  if (keyCode === DELETE || keyCode === BACKSPACE) {
    deleteSelectedNode(world, view);
    syncPanel(world, view);
    return false;
  }
  if (keyCode === ESCAPE) {
    view.selectedNodeId = null;
    syncPanel(world, view);
  }
}

// ---------------------------------------------------------------------------
// Interface (boutons + panneaux, définis dans index.html)
// ---------------------------------------------------------------------------

// références DOM (singletons de la page, pas de l'état de jeu)
const ui = {};

function setupUI(app) {
  const byId = (id) => document.getElementById(id);
  Object.assign(ui, {
    plan: byId("btn-plan"),
    launch: byId("btn-launch"),
    clear: byId("btn-clear"),
    circularize: byId("btn-circularize"),
    land: byId("btn-land"),
    landAngle: byId("in-land-angle"),
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

  // chaque action reçoit l'état courant ; le panneau est resynchronisé
  // après coup, et le clavier rendu au jeu
  const onClick = (el, fn) =>
    el.addEventListener("click", () => {
      fn(app.world, app.view);
      syncPanel(app.world, app.view);
      el.blur();
    });
  onClick(ui.plan, enterPlanning);
  onClick(ui.launch, launchPlan);
  onClick(ui.clear, clearPlan);
  onClick(ui.circularize, circularizeOrbit);
  onClick(ui.land, (world, view) => (ui.landAngle.value === "" ? planLanding(world, view) : planLandingAt(world, view, +ui.landAngle.value)));
  onClick(ui.remove, deleteSelectedNode);
  onClick(ui.camera, (world, view) => toggleCamera(view));
  onClick(ui.warpUp, (world) => changeWarp(world, 1));
  onClick(ui.warpDown, (world) => changeWarp(world, -1));
  onClick(ui.warp, (world) => (world.warpIndex = 0));
  onClick(ui.route, (world, view) => {
    view.routeMessage = { text: "Calcul de la route…", error: false };
    ui.routeInfo.textContent = view.routeMessage.text;
    ui.route.disabled = true;
    // laisse le navigateur afficher le message avant le calcul
    setTimeout(() => {
      computeRoute(app.world, app.view, ui.target.value, Number(ui.altitude.value));
      syncPanel(app.world, app.view);
      ui.route.disabled = false;
    }, 30);
  });

  const onInput = (el, changes) => el.addEventListener("input", () => updateSelectedNode(app.world, app.view, changes()));
  onInput(ui.time, () => ({ t: app.world.time + Number(ui.time.value) }));
  onInput(ui.heading, () => ({ heading: Number(ui.heading.value) }));
  onInput(ui.power, () => ({ power: Number(ui.power.value) / 100 }));
  onInput(ui.duration, () => ({ duration: Number(ui.duration.value) }));
  for (const preset of document.querySelectorAll("[data-heading]")) {
    onClick(preset, (world, view) => updateSelectedNode(world, view, { heading: Number(preset.dataset.heading) }));
  }
}

// recopie la manœuvre sélectionnée dans les curseurs
function syncPanel(world, view) {
  const node = world.mode === "planning" ? selectedNode(world, view) : null;
  ui.panel.hidden = !node;
  if (!node) return;
  ui.time.max = Math.ceil(Math.max(300, node.t - world.time + 60));
  ui.time.value = node.t - world.time;
  ui.heading.value = node.heading;
  ui.power.value = Math.round(node.power * 100);
  ui.duration.value = node.duration;
}

function formatT(t, now) {
  const dt = t - now;
  if (Math.abs(dt) < 600) return `T+${dt.toFixed(1)} s`;
  return `T+${Math.floor(dt / 60)} min ${Math.round(dt % 60)} s`;
}

function nodeDeltaV(n, predicted) {
  if (n.kind === "land") return predicted && predicted.fuelAfter !== undefined ? predicted.fuelBefore - predicted.fuelAfter : 0;
  return THRUST_ACCEL * n.power * n.duration;
}

function updateUI(world, view, prediction) {
  const planning = world.mode === "planning";
  const ship = world.ship;
  const planNodes = world.plan.nodes;
  ui.plan.hidden = planning;
  ui.plan.disabled = !canPlan(world);
  ui.launch.hidden = !planning;
  ui.clear.hidden = !planning;
  ui.clear.disabled = planNodes.length === 0;
  ui.launch.textContent = planNodes.length ? "▶ Lancer le plan" : "▶ Reprendre";
  ui.circularize.hidden = !planning;
  ui.circularize.disabled = ship.crashed;
  ui.land.hidden = !planning;
  ui.land.disabled = ship.crashed;
  ui.landAngle.hidden = !planning;
  ui.targetPanel.hidden = !planning;
  ui.routeInfo.textContent = view.routeMessage.text;
  ui.routeInfo.classList.toggle("error", view.routeMessage.error);
  ui.camera.hidden = planning;
  ui.camera.classList.toggle("active", view.cameraFree);
  ui.camera.textContent = view.cameraFree ? "🎯 Suivre le vaisseau" : "🎥 Caméra libre";
  ui.warp.textContent = `×${WARP_LEVELS[world.warpIndex]}`;
  for (const b of [ui.warp, ui.warpUp, ui.warpDown]) b.hidden = planning;

  const node = planning ? selectedNode(world, view) : null;
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
  ui.outTime.textContent = formatT(node.t, world.time);
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
      if (predicted.burnStartT !== undefined) lines.push(`Allumage : ${formatT(predicted.burnStartT, world.time)}`);
      if (predicted.endT !== undefined) lines.push(`Posé : ${formatT(predicted.endT, world.time)} · carburant ${predicted.fuelAfter.toFixed(0)}`);
      else lines.push("Pas de contact prévu (crash ou horizon dépassé).");
    } else if (predicted.burnStartT !== undefined) {
      lines.push(`Rotation : ${(predicted.burnStartT - predicted.startT).toFixed(1)} s`);
      if (predicted.endT !== undefined && node.power > 0 && node.duration > 0) {
        lines.push(`Poussée : ${formatT(predicted.burnStartT, world.time)} → ${formatT(predicted.endT, world.time)}`);
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

function renderScene(world, view, prediction) {
  const target = world.mode === "planning" ? world.plan.target : world.autopilot ? world.autopilotTarget : null;

  background(6, 8, 16);
  drawStars(view);

  push();
  translate(width / 2, height / 2);
  scale(view.zoom);
  translate(-view.cameraX, -view.cameraY);

  drawOrbits(world, view);
  if (prediction) drawGhostBodies(world, view, prediction);
  for (const body of ALL_BODIES) drawBody(view, body);
  if (prediction) {
    drawTargetOrbit(view, prediction, target);
    drawPredictedPath(view, prediction);
    if (prediction.periapsis) drawApsis(view, prediction, prediction.periapsis, "Périastre", [255, 130, 130]);
    if (prediction.apoapsis) drawApsis(view, prediction, prediction.apoapsis, "Apoastre", [130, 190, 255]);
    drawPathEnd(view, prediction);
    drawManeuverNodes(world, view, prediction);
  }
  drawShip(world, view);
  drawVelocityVector(world, view);

  pop();

  drawBodyLabels(view);
  drawHUD(world, view, prediction);
}

function drawPredictedPath(view, pred) {
  const zoom = view.zoom;
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

function drawPathEnd(view, pred) {
  if (pred.end !== "crash" || !pred.display.length) return;
  const zoom = view.zoom;
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
function drawBigCircle(view, cx, cy, r) {
  const zoom = view.zoom;
  if (r * zoom < 2000) {
    circle(cx, cy, r * 2);
    return;
  }
  const half = Math.hypot(width, height) / 2 / zoom;
  const d = Math.hypot(view.cameraX - cx, view.cameraY - cy);
  if (Math.abs(d - r) > half) return; // arc hors de l'écran
  const center = Math.atan2(view.cameraY - cy, view.cameraX - cx);
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
function drawOrbits(world, view) {
  const zoom = view.zoom;
  const ref = world.ship.ref;
  push();
  noFill();
  strokeWeight(1 / zoom);
  drawingContext.setLineDash([3 / zoom, 6 / zoom]);
  stroke(255, 255, 255, 70);
  for (const body of ALL_BODIES) {
    if (!body.parentBody) continue;
    drawBigCircle(view, body.parentBody.x, body.parentBody.y, body.orbitRadius);
  }
  stroke(120, 170, 255, 45);
  drawingContext.setLineDash([2 / zoom, 10 / zoom]);
  for (const body of [ref, ...ref.children]) {
    if (Number.isFinite(body.soi)) drawBigCircle(view, body.x, body.y, body.soi);
  }
  pop();
}

function drawApsis(view, pred, point, label, color) {
  const zoom = view.zoom;
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
function drawTargetOrbit(view, pred, target) {
  if (!target) return;
  const zoom = view.zoom;
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
  drawBigCircle(view, center.x, center.y, target.radius);
  noStroke();
  fill(255, 120, 220);
  textSize(12 / zoom);
  textAlign(CENTER, BOTTOM);
  text(`Orbite visée · ${target.body.name}`, center.x, center.y - target.radius - 4 / zoom);
  pop();
}

// position des astres à l'heure prévue de chaque manœuvre (fantômes), dans
// le repère du patch où se trouve la manœuvre
function drawGhostBodies(world, view, pred) {
  const zoom = view.zoom;
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
    text(`${body.name} à l'arrivée (${formatT(pred.patches[j].t, world.time)})`, anchors[j].x, anchors[j].y + Math.max(body.radius, 4 / zoom) + 4 / zoom);
  }
  drawingContext.setLineDash([4 / zoom, 4 / zoom]);
  for (const pn of pred.nodes) {
    if (pn.startT === undefined) continue;
    const anchor = pred.layout.anchors[pn.startPatch];
    if (!anchor) continue;
    const frameBody = pred.patches[pn.startPatch].body;
    const framePos = bodyPositionAt(frameBody, pn.startT);
    const highlighted = pn.id === view.selectedNodeId;
    // les satellites de l'astre du patch (ex : la Lune autour de la Terre,
    // les planètes autour du Soleil) — l'astre du patch lui-même reste fixe
    for (const body of frameBody.children) {
      const pos = bodyPositionAt(body, pn.startT);
      const x = anchor.x + pos.x - framePos.x;
      const y = anchor.y + pos.y - framePos.y;
      noFill();
      stroke(...body.color, highlighted ? 220 : 80);
      strokeWeight((highlighted ? 2 : 1) / zoom);
      drawBigCircle(view, x, y, Math.max(body.radius, 4 / zoom));
      if (highlighted) {
        noStroke();
        fill(255, 220);
        textSize(11 / zoom);
        textAlign(CENTER, TOP);
        text(`${body.name} à ${formatT(pn.startT, world.time)}`, x, y + Math.max(body.radius, 4 / zoom) + 4 / zoom);
      }
    }
  }
  pop();
}

function drawManeuverNodes(world, view, pred) {
  const zoom = view.zoom;
  push();
  pred.nodes.forEach((pn, i) => {
    if (pn.startT === undefined) return;
    const p = displayPosition(pred, pn.startPatch, pn.startX, pn.startY);
    if (!p) return;
    const selected = pn.id === view.selectedNodeId;

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
    const when = pn.startT < world.time ? "en cours" : formatT(pn.startT, world.time);
    const label = pn.kind === "land" ? " · atterrissage" : "";
    text(`M${pred.firstNode + i + 1} · ${when}${label}`, p.x + 9 / zoom, p.y - 6 / zoom);
  });
  pop();
}

function drawStars(view) {
  randomSeed(1);
  noStroke();
  fill(255, 255, 255, 150);
  for (let i = 0; i < 200; i++) {
    const x = (random(-2000, 2000) - view.cameraX * 0.02) % width;
    const y = (random(-2000, 2000) - view.cameraY * 0.02) % height;
    circle((x + width) % width, (y + height) % height, 2);
  }
}

function drawBody(view, body) {
  if (body.atmosphere) drawAtmosphere(body);
  noStroke();
  fill(...body.color);
  circle(body.x, body.y, Math.max(body.radius * 2, 6 / view.zoom));
}

// halo translucide (anneaux concentriques, de plus en plus transparents vers
// l'extérieur) représentant l'atmosphère : purement visuel, la physique
// réelle (densité exponentielle) est calculée séparément dans stepShip
function drawAtmosphere(body) {
  const atmo = body.atmosphere;
  const col = atmo.color || body.color;
  const rings = 10;
  noStroke();
  for (let i = rings; i >= 1; i--) {
    const frac = i / rings; // 1 = bord extérieur, →0 = près du sol
    const r = body.radius + atmo.height * frac;
    const alpha = (1 - frac) * (1 - frac) * 70 * Math.min(1.4, atmo.density);
    fill(col[0], col[1], col[2], alpha);
    circle(body.x, body.y, r * 2);
  }
}

// nom des astres trop petits à l'écran pour être reconnus
function drawBodyLabels(view) {
  noStroke();
  textSize(11);
  textAlign(CENTER, TOP);
  for (const body of ALL_BODIES) {
    if (body.radius * view.zoom > 12) continue;
    const s = worldToScreen(view, body.x, body.y);
    if (s.x < -50 || s.y < -50 || s.x > width + 50 || s.y > height + 50) continue;
    fill(255, 170);
    text(body.name, s.x, s.y + 6);
  }
}

function drawShip(world, view) {
  const ship = world.ship;
  push();
  translate(ship.x, ship.y);
  rotate(ship.angle);
  // taille minimale à l'écran pour ne pas perdre le vaisseau en dézoomant
  const k = Math.max(1, 6 / (ship.size * view.zoom));
  scale(k);
  noStroke();
  fill(ship.crashed ? [200, 60, 60] : [255, 220, 120]);
  triangle(-ship.size / 2, -ship.size / 2, -ship.size / 2, ship.size / 2, ship.size / 2, 0);
  if (ship.thrusting && !ship.crashed && world.mode === "flight") {
    fill(255, 140, 40);
    triangle(-ship.size / 2, -ship.size / 4, -ship.size / 2, ship.size / 4, -ship.size - 8, 0);
  }
  pop();
}

function drawVelocityVector(world, view) {
  const ship = world.ship;
  // vitesse relative au référentiel actif (comme le mode "Surface/Orbit" de Kerbal)
  const scaleFactor = 0.5;
  stroke(100, 220, 255, 200);
  strokeWeight(2 / view.zoom);
  line(ship.x, ship.y, ship.x + ship.rvx * scaleFactor, ship.y + ship.rvy * scaleFactor);
}

function autopilotStatus(world) {
  const autopilot = world.autopilot;
  if (!autopilot) return "";
  const node = autopilot.nodes[autopilot.index];
  const label = `Plan : manœuvre ${autopilot.index + 1}/${autopilot.nodes.length}`;
  if (!node) return label;
  if (autopilot.phase === "landing") return `${label} — atterrissage guidé`;
  if (autopilot.phase === "rotating") return `${label} — rotation vers le cap`;
  if (autopilot.phase === "burning") return `${label} — poussée (reste ${Math.max(0, autopilot.burnEnd - world.time).toFixed(1)} s)`;
  return `${label} — dans ${formatT(node.t, world.time).replace("T+", "")}`;
}

function drawHUD(world, view, prediction) {
  const ship = world.ship;
  const referenceBody = ship.ref;
  const relSpeed = Math.hypot(ship.rvx, ship.rvy);
  const r = Math.hypot(ship.rx, ship.ry);
  const altitude = r - referenceBody.radius;
  const orbitalV = Math.sqrt(referenceBody.mu / r);

  noStroke();
  fill(255, 220);
  textSize(14);
  textAlign(LEFT, TOP);
  const status =
    world.mode === "planning"
      ? "⏸ PAUSE — planification"
      : ship.crashed
      ? ship.crashReason === "chaleur"
        ? "CRASH — le vaisseau s'est consumé dans l'atmosphère — [R] pour relancer"
        : "CRASH — [R] pour relancer"
      : world.autopilot
      ? autopilotStatus(world)
      : ship.landed
      ? "Posé — [↑] pour décoller · [F] faire le plein"
      : "";
  const warp = effectiveWarp(world);
  const warpLevel = WARP_LEVELS[world.warpIndex];
  const lines = [
    `Référentiel : ${referenceBody.name}`,
    `Vitesse relative : ${relSpeed.toFixed(1)}`,
    `Altitude : ${Math.max(0, altitude).toFixed(0)}`,
    `Vitesse orbitale visée : ${orbitalV.toFixed(1)}`,
    ship.landed ? "" : `Vitesse de rotation : ${degrees(ship.angularVelocity).toFixed(0)}°/s`,
    world.mode === "flight" && warpLevel > 1 ? `Temps accéléré ×${Math.round(warp)}${warp < warpLevel ? " (manœuvre proche)" : ""}` : "",
    status,
  ];
  lines.forEach((l, i) => text(l, 16, 16 + i * 20));

  let y = 16 + lines.length * 20 + 4;
  drawFuelGauge(world, 16, y, prediction);
  y += 34;
  if (referenceBody.atmosphere || ship.heat > 1) {
    drawHeatGauge(ship, 16, y);
    y += 34;
  }
  if (!ship.landed && !ship.crashed) {
    drawRotationIndicator(ship, 16, y);
    y += 40;
  }

  if (world.mode === "planning") drawPlanSummary(world, view, 16, y, prediction);

  fill(255, 220);
  textSize(14);
  textAlign(LEFT, BOTTOM);
  const controlLines =
    world.mode === "planning"
      ? [
          "Clic sur le tracé : ajouter une manœuvre · clic sur un point : la sélectionner · glisser un point : le déplacer",
          "Glisser le fond : déplacer la vue · molette : zoom · [Suppr] effacer la manœuvre · [Échap] désélectionner",
          "« Destination » : choisir un astre et une altitude, la route est calculée automatiquement · « Atterrir » : se poser à la fin du plan (angle précisé = viser ce point de la surface)",
          "[P] ou « Lancer le plan » : reprendre le jeu, le pilote automatique exécute le plan",
          "Tracé : vert = sans poussée · jaune = rotation · orange = poussée — chaque portion est dessinée autour de son astre",
        ]
      : [
          "↑ poussée · ←/→ maintenir pour tourner, tapoter pour ajuster finement (inertie, sans frottement)",
          "[C] caméra libre (glisser / molette) · [,] [.] accélérer le temps",
          world.autopilot ? "Pilote automatique actif — une touche fléchée reprend la main" : "Pointillés verts : trajectoire prédite (sans poussée)",
          "[P] ou « Planifier » : pause et planification de la trajectoire",
        ];
  controlLines.forEach((l, i) => {
    text(l, 16, height - 16 - (controlLines.length - 1 - i) * 20);
  });
}

// jauge de carburant ; en planification, marque ce qui restera après le plan
function drawFuelGauge(world, x, y, prediction) {
  const ship = world.ship;
  const w = 180;
  const h = 8;
  const ratio = ship.fuel / FUEL_MAX;
  noStroke();
  fill(255, 255, 255, 30);
  rect(x, y + 16, w, h, 3);
  fill(ratio > 0.2 ? [130, 220, 255] : [255, 110, 90]);
  rect(x, y + 16, w * ratio, h, 3);

  let label = `Carburant (Δv) : ${ship.fuel.toFixed(0)} / ${FUEL_MAX} · dépensé ${(FUEL_MAX - ship.fuel).toFixed(0)}`;
  if (world.mode === "planning" && prediction && world.plan.nodes.length) {
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

// jauge d'échauffement atmosphérique : vide tant qu'on est dans le vide,
// monte dans l'atmosphère avec la vitesse, pleine = destruction
function drawHeatGauge(ship, x, y) {
  const w = 180;
  const h = 8;
  const ratio = constrain(ship.heat / HEAT_MAX, 0, 1);
  noStroke();
  fill(255, 255, 255, 30);
  rect(x, y + 16, w, h, 3);
  fill(ratio < 0.5 ? [255, 200, 110] : [255, 90, 70]);
  rect(x, y + 16, w * ratio, h, 3);
  fill(255, 220);
  textSize(12);
  textAlign(LEFT, TOP);
  text(`Échauffement : ${Math.round(ratio * 100)} %${ratio > 0.7 ? " ⚠" : ""}`, x, y);
}

function drawPlanSummary(world, view, x, y, prediction) {
  const planNodes = world.plan.nodes;
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
    const start = predicted && predicted.startT !== undefined ? `${formatT(predicted.startT, world.time)} (${predicted.startRef.name})` : "non atteinte";
    const burn = node.power > 0 && node.duration > 0 ? `Δv ${nodeDeltaV(node).toFixed(1)}` : "rotation seule";
    const what = node.kind === "land" ? `atterrissage guidé · Δv ${nodeDeltaV(node, predicted).toFixed(1)}` : `cap ${Math.round(node.heading)}° · ${burn}`;
    fill(node.id === view.selectedNodeId ? [255, 230, 120] : [255, 255, 255, 200]);
    text(`M${i + 1} · ${start} · ${what}`, x, y + 18 + i * 18);
  });
  if (planNodes.length > maxLines) {
    fill(255, 160);
    text(`… ${planNodes.length - maxLines} de plus`, x, y + 18 + maxLines * 18);
  }
}

function drawRotationIndicator(ship, x, y) {
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

// p5 en mode global cherche ses crochets sur window ; un module ES ne les y
// expose pas tout seul (garde : ce fichier est aussi importé par les tests)
if (typeof window !== "undefined") {
  Object.assign(window, { setup, draw, windowResized, keyPressed, mousePressed, mouseDragged, mouseReleased, mouseWheel });
}

// exports pour les tests : logique de jeu (golden-master, en attendant son
// extraction dans plan/ et autopilot/) et état de l'application (contrôles
// de rendu pilotés depuis un navigateur)
export {
  PLAN_MAX_HORIZON,
  advanceSimulation,
  app,
  createView,
  displayPosition,
  readManualControl,
  createAutopilot,
  createWorld,
  landingSequence,
  legLaunch,
  makeCtx,
  parkingRadius,
  planDone,
  planRoute,
  predictPath,
  runCtx,
};
