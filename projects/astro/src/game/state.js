// ---------------------------------------------------------------------------
// État du jeu, regroupé en deux objets explicites que les fonctions reçoivent
// en paramètre (aucune variable d'état globale) :
// - world : ce qui est simulé ou planifié (vaisseau, temps, mode, plan…) ;
// - view : la façon de le regarder et de l'éditer (caméra, sélection…).
// ---------------------------------------------------------------------------

import { createShip } from "../sim/index.js";

export const MAX_FRAME_DT = 0.25; // évite une avalanche de pas après un onglet en arrière-plan
export const WARP_LEVELS = [1, 2, 5, 10, 25, 50, 100]; // accélération du temps
export const DEFAULT_NODE = { heading: 0, power: 1, duration: 1 };

export function createWorld() {
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

export function createView(world) {
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
    showSettings: false, // panneau de configuration (⚙)
  };
}

export function resetShip(world) {
  const mass = world.ship ? world.ship.mass : 1; // le poids choisi est une config du vaisseau, pas un consommable de vol : il survit au crash
  world.ship = createShip(world.time);
  world.ship.mass = mass;
  world.autopilot = null;
  world.autopilotPrediction = null;
  world.flightPredictionDirty = true;
}

// évite un panoramique depuis le Soleil au démarrage/relance
export function recenterCamera(view, ship) {
  view.cameraX = ship.x;
  view.cameraY = ship.y;
  view.cameraFrame = null;
}
