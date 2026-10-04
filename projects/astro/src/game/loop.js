// ---------------------------------------------------------------------------
// Boucle de jeu
// ---------------------------------------------------------------------------

import { autopilotControl, createAutopilot } from "../autopilot/index.js";
import {
  layoutPrediction,
  PLAN_MAX_HORIZON,
  predictPath,
  THRUST_PREDICTION_HORIZON,
} from "../plan/index.js";
import {
  bodies,
  bodyPositionAt,
  constrain,
  SIM_DT,
  stepShip,
  sun,
  syncShipAbsolute,
} from "../sim/index.js";
import { MAX_FRAME_DT, WARP_LEVELS } from "./state.js";

// mêmes formules que lerp() et map() de p5
const lerp = (start, stop, amt) => amt * (stop - start) + start;
const mapRange = (n, start1, stop1, start2, stop2) => ((n - start1) / (stop1 - start1)) * (stop2 - start2) + start2;

export function currentPlanPrediction(world) {
  const plan = world.plan;
  if (plan.dirty || !plan.prediction) {
    plan.prediction = predictPath(world.ship, world.time, plan.nodes.length ? createAutopilot(plan.nodes) : null, PLAN_MAX_HORIZON);
    plan.dirty = false;
  }
  return plan.prediction;
}

export function currentFlightPrediction(world) {
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

// l'accélération du temps ralentit à l'approche d'une manœuvre du plan
export function effectiveWarp(world) {
  let warp = WARP_LEVELS[world.warpIndex];
  const autopilot = world.autopilot;
  if (autopilot) {
    const node = autopilot.nodes[autopilot.index];
    if (autopilot.phase !== "pending") warp = 1;
    else if (node) warp = Math.min(warp, Math.max(1, node.t - world.time));
  }
  return warp;
}

export function stopAutopilot(world) {
  world.autopilot = null;
  world.autopilotPrediction = null;
}

// un pas fixe de simulation : pilote automatique (s'il y en a un), sinon
// commande manuelle, puis physique du vaisseau
export function stepWorld(world, control) {
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

export function advanceSimulation(world, elapsed, manual) {
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

// caméra suiveuse : accompagne l'astre de référence du vaisseau (sinon,
// avec la Terre qui file autour du Soleil, tout sortirait de l'écran).
// Caméra libre : accompagne le Soleil à la place — fixe (origine du
// système), donc la vue reste exactement où on l'a placée au lieu de
// dériver avec le mouvement orbital de l'astre où se trouve le vaisseau.
export function updateCamera(view, world) {
  const ship = world.ship;
  const frameBody = view.cameraFree ? sun : ship.ref;
  const refPos = bodyPositionAt(frameBody, world.time);
  if (view.cameraFrame && view.cameraFrame.body === frameBody) {
    view.cameraX += refPos.x - view.cameraFrame.x;
    view.cameraY += refPos.y - view.cameraFrame.y;
  }
  view.cameraFrame = { body: frameBody, x: refPos.x, y: refPos.y };
  if (view.cameraFree) return;

  // caméra suiveuse : centrée sur le vaisseau, dézoome quand la vitesse augmente
  const speed = Math.hypot(ship.rvx, ship.rvy);
  const targetZoom = constrain(mapRange(speed, 0, 150, 1, 0.3), 0.25, 1) * view.zoomBias;
  view.zoom = lerp(view.zoom, targetZoom, 0.05);
  view.cameraX = lerp(view.cameraX, ship.x, 0.15);
  view.cameraY = lerp(view.cameraY, ship.y, 0.15);
}

// une image : avance la simulation (en vol), met à jour astres, caméra et
// tracé prédit ; renvoie la prédiction à afficher
export function frame(world, view, elapsed, manual) {
  if (world.mode === "flight") advanceSimulation(world, elapsed, manual);

  bodies(world.time);
  syncShipAbsolute(world.ship, world.time);
  if (world.mode === "flight") updateCamera(view, world);

  const prediction = world.mode === "planning" ? currentPlanPrediction(world) : currentFlightPrediction(world);
  if (prediction) layoutPrediction(prediction, world.time);
  return prediction;
}
