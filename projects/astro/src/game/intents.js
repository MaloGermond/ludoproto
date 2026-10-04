// Intentions : seule porte d'entrée par laquelle l'interface modifie l'état.
// L'interface traduit clics, touches et gestes souris en intentions
// explicites ({ type, ...paramètres }) ; dispatch les applique à world/view.
//
// Les gestes souris renvoient true quand la manœuvre sélectionnée (ou ses
// valeurs) a changé et que le panneau d'édition doit être resynchronisé.

import { createAutopilot } from "../autopilot/index.js";
import { layoutPrediction, PLAN_MAX_HORIZON, predictPath } from "../plan/index.js";
import { constrain, FUEL_MAX, setConstant } from "../sim/index.js";
import {
  addNodeAt,
  changeWarp,
  circularizeOrbit,
  clearPlan,
  deleteSelectedNode,
  enterPlanning,
  launchPlan,
  planLanding,
  planLandingAt,
  routeTo,
  toggleCamera,
  updateSelectedNode,
} from "./actions.js";
import { currentPlanPrediction } from "./loop.js";
import {
  CLICK_MAX_MOVE,
  nearestPathPoint,
  nodeAtScreen,
  PICK_RADIUS,
  screenToWorld,
} from "./screen.js";
import { recenterCamera, resetShip } from "./state.js";

// appui sur le canevas : sélection d'une manœuvre (et début de son
// déplacement le long du tracé) ou début d'un déplacement de la vue
function pointerDown(world, view, { x, y, screen }) {
  if (world.mode === "planning") {
    const prediction = currentPlanPrediction(world);
    const hitId = nodeAtScreen(view, screen, prediction, x, y);
    if (hitId !== null) {
      view.selectedNodeId = hitId;
      // tracé de référence pour le glisser : le plan sans ce point, dont la
      // trajectoire ne dépend pas de l'endroit où on le déplace
      const others = world.plan.nodes.filter((n) => n.id !== hitId);
      const pick = predictPath(world.ship, world.time, others.length ? createAutopilot(others) : null, PLAN_MAX_HORIZON);
      view.pointer = { kind: "node", pick };
      return true;
    }
  }
  view.pointer = { kind: "pan", startX: x, startY: y, moved: false };
  return false;
}

// glisser : déplace la manœuvre saisie, sinon la vue (dx, dy : mouvement
// depuis l'image précédente, en pixels)
function pointerDrag(world, view, { x, y, dx, dy, screen }) {
  const pointer = view.pointer;
  if (!pointer) return false;
  if (pointer.kind === "node") {
    const nearest = nearestPathPoint(view, screen, layoutPrediction(pointer.pick, world.time), x, y);
    if (!nearest) return false;
    updateSelectedNode(world, view, { t: nearest.point.t });
    return true;
  }
  if (Math.hypot(pointer.startX - x, pointer.startY - y) > CLICK_MAX_MOVE) pointer.moved = true;
  if (pointer.moved) {
    view.cameraFree = true; // glisser la vue en vol passe en caméra libre
    view.cameraX -= dx / view.zoom;
    view.cameraY -= dy / view.zoom;
  }
  return false;
}

// relâchement : un simple clic en planification pose un point de manœuvre
// sur le tracé, ou désélectionne
function pointerUp(world, view, { x, y, screen }) {
  const pointer = view.pointer;
  if (!pointer) return false;
  let changed = false;
  if (world.mode === "planning" && pointer.kind === "pan" && !pointer.moved) {
    const nearest = nearestPathPoint(view, screen, currentPlanPrediction(world), x, y);
    if (nearest && nearest.dist < PICK_RADIUS) addNodeAt(world, view, nearest.point.t);
    else view.selectedNodeId = null;
    changed = true;
  }
  view.pointer = null;
  return changed;
}

// molette : réglage du zoom de la caméra suiveuse, sinon zoom centré sur le
// curseur
function wheel(world, view, { x, y, delta, screen }) {
  const factor = Math.pow(1.0015, -delta);
  if (world.mode === "flight" && !view.cameraFree) {
    view.zoomBias = constrain(view.zoomBias * factor, 0.0005, 4);
    return false;
  }
  const before = screenToWorld(view, screen, x, y);
  view.zoom = constrain(view.zoom * factor, 0.0005, 4);
  const after = screenToWorld(view, screen, x, y);
  view.cameraX += before.x - after.x;
  view.cameraY += before.y - after.y;
  return false;
}

const HANDLERS = {
  pointerDown,
  pointerDrag,
  pointerUp,
  wheel,
  enterPlanning: (world, view) => enterPlanning(world, view),
  launchPlan: (world, view) => launchPlan(world, view),
  togglePlanning: (world, view) => (world.mode === "planning" ? launchPlan(world, view) : enterPlanning(world, view)),
  clearPlan: (world, view) => clearPlan(world, view),
  circularize: (world, view) => circularizeOrbit(world, view),
  land: (world, view, { angle }) => (angle === null ? planLanding(world, view) : planLandingAt(world, view, angle)),
  routeStart: (world, view) => {
    view.routeMessage = { text: "Calcul de la route…", error: false };
  },
  route: (world, view, { targetId, altitude }) => routeTo(world, view, targetId, altitude),
  updateNode: (world, view, { changes }) => updateSelectedNode(world, view, changes),
  deleteNode: (world, view) => deleteSelectedNode(world, view),
  deselect: (world, view) => {
    view.selectedNodeId = null;
  },
  toggleCamera: (world, view) => toggleCamera(view),
  changeWarp: (world, view, { delta }) => changeWarp(world, delta),
  resetWarp: (world) => {
    world.warpIndex = 0;
  },
  refuel: (world) => {
    if (world.ship.landed) world.ship.fuel = FUEL_MAX;
  },
  resetShip: (world, view) => {
    if (!world.ship.crashed) return;
    resetShip(world);
    recenterCamera(view, world.ship);
  },
  toggleSettings: (world, view) => {
    view.showSettings = !view.showSettings;
  },
  togglePrecision: (world, view) => {
    view.precisionMode = !view.precisionMode;
  },
  // panneau de configuration (⚙) : constantes physiques (liaisons vivantes,
  // cf. sim/constants.js) et masse du vaisseau — invalide les prédictions
  // mises en cache, qui sinon continueraient de refléter les anciennes valeurs
  setConstant: (world, view, { key, value }) => {
    setConstant(key, value);
    world.plan.dirty = true;
    world.flightPredictionDirty = true;
  },
  setShipMass: (world, view, { value }) => {
    world.ship.mass = Math.max(10, value); // kg — évite une masse nulle ou négative
    world.plan.dirty = true;
    world.flightPredictionDirty = true;
  },
};

export function dispatch(world, view, intent) {
  const handler = HANDLERS[intent.type];
  if (!handler) throw new Error(`Intention inconnue : ${intent.type}`);
  return handler(world, view, intent);
}
