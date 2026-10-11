// Prototype "lancer, orbiter" — issue #4
// Un vaisseau décolle de la surface de la Terre et peut être placé en orbite.
// Système solaire configurable : voir BODY_CONFIGS (src/sim/bodies.js).
//
// Mode navigation — issue #5
// Un bouton met le jeu en pause et ouvre la planification : on pose des
// points de manœuvre (rotation + poussée) sur le tracé prédit, ou on laisse
// le calculateur de route viser une orbite autour d'un astre, puis on relance
// le jeu et le pilote automatique exécute le plan.
//
// Gravité en "patched conics" (comme Kerbal Space Program) : le vaisseau ne
// subit que l'attraction de l'astre dont il occupe la sphère d'influence.
//
// Organisation (src/) :
//   sim/       physique (astres, vaisseau) — n'importe rien
//   autopilot/ exécution des manœuvres — sim
//   plan/      prédiction, calculateur de route, atterrissage — sim, autopilot
//   game/      état world/view, boucle, actions, intentions — sim, autopilot, plan
//   render/    dessin p5, lit l'état
//   ui/        DOM, clavier, souris : lit l'état, émet des intentions
// Ce fichier ne fait que brancher les crochets p5.

import { createView, createWorld, dispatch, frame } from "./src/game/index.js";
import { renderScene } from "./src/render/index.js";
import { createInputHandlers, readManualControl, resizeToWindow, setupUI, updateUI } from "./src/ui/index.js";

// état de l'application : seule référence au monde et à sa vue
const app = { world: null, view: null };
const emit = (intent) => dispatch(app.world, app.view, intent);
const input = createInputHandlers(app, emit);

function setup() {
  app.world = createWorld();
  app.view = createView(app.world);
  setupUI(app, emit);
}

function windowResized() {
  resizeToWindow();
}

function draw() {
  const { world, view } = app;
  const prediction = frame(world, view, deltaTime * 0.001, readManualControl(view));
  renderScene(world, view, prediction);
  updateUI(world, view, prediction);
}

function keyPressed() {
  return input.keyPressed();
}

// p5 en mode global cherche ses crochets sur window ; un module ES ne les y
// expose pas tout seul
Object.assign(window, {
  setup,
  draw,
  windowResized,
  keyPressed,
  mousePressed: input.mousePressed,
  mouseDragged: input.mouseDragged,
  mouseReleased: input.mouseReleased,
  mouseWheel: input.mouseWheel,
});

// pour les contrôles de non-régression du rendu, pilotés depuis un navigateur
export { app };
