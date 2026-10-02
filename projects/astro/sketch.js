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
  autopilotControl,
  copyNode,
  createAutopilot,
  remainingNodes,
} from "./src/autopilot/index.js";
import {
  circularDv,
  computeRoute,
  displayPosition,
  findLandingAt,
  landAsap,
  layoutPrediction,
  makeBurnNode,
  makeCtx,
  PLAN_MAX_HORIZON,
  planDone,
  PlanError,
  predictPath,
  runCtx,
  THRUST_PREDICTION_HORIZON,
} from "./src/plan/index.js";
import {
  ALL_BODIES,
  bodies,
  bodyById,
  bodyPositionAt,
  constrain,
  createShip,
  degrees,
  FUEL_MAX,
  HALF_PI,
  HEAT_MAX,
  PI,
  ROTATION_TAP_UNIT,
  SIM_DT,
  stepShip,
  sun,
  syncShipAbsolute,
  THRUST_ACCEL,
} from "./src/sim/index.js";

const MAX_FRAME_DT = 0.25; // évite une avalanche de pas après un onglet en arrière-plan
const WARP_LEVELS = [1, 2, 5, 10, 25, 50, 100]; // accélération du temps

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

// numérote les manœuvres qui entrent dans le plan (le calculateur de route
// les produit sans identifiant)
function withIds(world, nodes) {
  return nodes.map((n) => ({ ...copyNode(n), id: world.nextNodeId++ }));
}

// calcule la route vers un astre et la met dans le plan
function routeTo(world, view, targetId, altitude) {
  const target = bodyById[targetId];
  const ship = world.ship;
  try {
    const route = computeRoute(ship, world.time, target, altitude);
    world.plan.nodes = withIds(world, route.nodes);
    world.plan.target = { body: target, radius: target.radius + altitude };
    world.plan.dirty = true;
    view.selectedNodeId = null;
    view.routeMessage = {
      text:
        `${route.nodes.length} manœuvres · Δv ${route.dv.toFixed(0)} (carburant ${ship.fuel.toFixed(0)})\n` +
        `Arrivée ${formatT(route.final.t, world.time)} · orbite ${route.periapsis.toFixed(0)}–${route.apoapsis.toFixed(0)}` +
        (route.dv > ship.fuel ? "\n⚠ Carburant insuffisant pour tout le plan" : ""),
      error: route.dv > ship.fuel,
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

function commitLanding(world, view, nodes, c, before, body) {
  addNodes(world, view, nodes);
  view.routeMessage = {
    text: `Atterrissage sur ${body.name} · Δv ${(before.s.fuel - c.s.fuel).toFixed(0)} · posé à ${formatT(c.t, world.time)} · angle ${degrees(c.s.landedAngle).toFixed(0)}°`,
    error: false,
  };
}

// ajoute, après les manœuvres déjà prévues, un atterrissage sur l'astre
// autour duquel le vaisseau se trouve alors, dès que possible
function planLanding(world, view) {
  if (world.mode !== "planning" || world.ship.crashed) return;
  const base = planEnd(world);
  try {
    const { c, nodes, body } = landAsap(base);
    commitLanding(world, view, nodes, c, base, body);
  } catch (e) {
    if (!(e instanceof PlanError)) console.error(e);
    view.routeMessage = { text: e instanceof PlanError ? e.message : "Erreur de calcul de l'atterrissage.", error: true };
  }
}

// atterrissage visant un point précis de la surface (angle en degrés)
function planLandingAt(world, view, targetAngleDeg) {
  if (world.mode !== "planning" || world.ship.crashed) return;
  const base = planEnd(world);
  try {
    const { c, nodes, body } = findLandingAt(base, targetAngleDeg);
    commitLanding(world, view, nodes, c, base, body);
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
      routeTo(app.world, app.view, ui.target.value, Number(ui.altitude.value));
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

// état de l'application et boucle de jeu, pour piloter le rendu depuis un
// navigateur dans les contrôles de non-régression
export { advanceSimulation, app, createView, createWorld, readManualControl };
