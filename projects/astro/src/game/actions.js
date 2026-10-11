// ---------------------------------------------------------------------------
// Mode planification
// ---------------------------------------------------------------------------

import { copyNode, createAutopilot, remainingNodes } from "../autopilot/index.js";
import {
  circularDv,
  computeRoute,
  findLandingAt,
  landAsap,
  makeBurnNode,
  makeCtx,
  planDone,
  PlanError,
  runCtx,
} from "../plan/index.js";
import { bodyById, constrain, degrees } from "../sim/index.js";
import { formatT } from "./format.js";
import { currentPlanPrediction, stopAutopilot } from "./loop.js";
import { DEFAULT_NODE, WARP_LEVELS } from "./state.js";

// numérote les manœuvres qui entrent dans le plan (le calculateur de route
// les produit sans identifiant)
export function withIds(world, nodes) {
  return nodes.map((n) => ({ ...copyNode(n), id: world.nextNodeId++ }));
}

// calcule la route vers un astre et la met dans le plan
export function routeTo(world, view, targetId, altitude) {
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

export function canPlan(world) {
  return !world.ship.crashed;
}

export function enterPlanning(world, view) {
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

export function launchPlan(world, view) {
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

export function clearPlan(world, view) {
  world.plan.nodes = [];
  world.plan.target = null;
  world.plan.dirty = true;
  view.selectedNodeId = null;
  view.routeMessage = { text: "", error: false };
}

export function selectedNode(world, view) {
  return world.plan.nodes.find((n) => n.id === view.selectedNodeId) || null;
}

// ajoute des manœuvres au plan et sélectionne la dernière
export function addNodes(world, view, nodes) {
  const added = withIds(world, nodes);
  world.plan.nodes.push(...added);
  world.plan.nodes.sort((a, b) => a.t - b.t);
  world.plan.dirty = true;
  view.selectedNodeId = added[added.length - 1].id;
}

export function addNodeAt(world, view, t) {
  addNodes(world, view, [{ t, ...DEFAULT_NODE }]);
}

// état du vaisseau une fois le plan actuel exécuté
export function planEnd(world) {
  return runCtx(makeCtx(world.ship, world.time, world.plan.nodes), Infinity, (c) => !planDone(c));
}

// ajoute, après les manœuvres déjà prévues, celle qui circularise l'orbite
// à la distance où se trouve alors le vaisseau
export function circularizeOrbit(world, view) {
  if (world.mode !== "planning" || world.ship.crashed) return;
  const ctx = planEnd(world);
  if (ctx.s.landed || ctx.s.crashed) return;
  const node = makeBurnNode(ctx, ctx.t, (s) => circularDv(s, 0));
  if (!node) return; // déjà circulaire
  addNodes(world, view, [node]);
}

export function commitLanding(world, view, nodes, c, before, body) {
  addNodes(world, view, nodes);
  view.routeMessage = {
    text: `Atterrissage sur ${body.name} · Δv ${(before.s.fuel - c.s.fuel).toFixed(0)} · posé à ${formatT(c.t, world.time)} · angle ${degrees(c.s.landedAngle).toFixed(0)}°`,
    error: false,
  };
}

// ajoute, après les manœuvres déjà prévues, un atterrissage sur l'astre
// autour duquel le vaisseau se trouve alors, dès que possible
export function planLanding(world, view) {
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
export function planLandingAt(world, view, targetAngleDeg) {
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

export function deleteSelectedNode(world, view) {
  if (view.selectedNodeId === null) return;
  world.plan.nodes = world.plan.nodes.filter((n) => n.id !== view.selectedNodeId);
  world.plan.dirty = true;
  view.selectedNodeId = null;
}

export function updateSelectedNode(world, view, changes) {
  const node = selectedNode(world, view);
  if (!node) return;
  Object.assign(node, changes);
  world.plan.nodes.sort((a, b) => a.t - b.t);
  world.plan.dirty = true;
}

export function toggleCamera(view) {
  view.cameraFree = !view.cameraFree;
  if (!view.cameraFree) view.zoomBias = constrain(view.zoom, 0.0005, 4);
}

export function changeWarp(world, delta) {
  world.warpIndex = constrain(world.warpIndex + delta, 0, WARP_LEVELS.length - 1);
}
