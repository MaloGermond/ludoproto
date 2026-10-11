// Clavier et souris : traduit les événements p5 en intentions explicites
// (voir game/intents.js).

import { ui } from "./dom.js";
import { syncPanel } from "./panels.js";

// commande manuelle lue sur le clavier à chaque image. keyIsDown() est
// global à la page (indépendant du focus) : sans ce garde-fou, utiliser les
// flèches haut/bas d'un champ numérique (ex. poids du vaisseau, réglages)
// pour en changer la valeur déclenchait aussi la poussée/rotation du jeu.
//
// Mode d'approche précise (view.precisionMode) : ↑↓ avant/arrière et ←→
// latéral dans l'axe du vaisseau, à faible poussée (RCS), sans rotation —
// pour les corrections fines (accostage, visée d'un point) sans avoir à
// pivoter à chaque fois.
export function readManualControl(view) {
  const tag = document.activeElement && document.activeElement.tagName;
  if (tag === "INPUT" || tag === "SELECT") return { left: false, right: false, thrust: 0, slewTo: null, assist: true, translateForward: 0, translateRight: 0 };
  if (view.precisionMode) {
    return {
      left: false,
      right: false,
      thrust: 0,
      slewTo: null,
      assist: false,
      translateForward: (keyIsDown(UP_ARROW) ? 1 : 0) - (keyIsDown(DOWN_ARROW) ? 1 : 0),
      translateRight: (keyIsDown(RIGHT_ARROW) ? 1 : 0) - (keyIsDown(LEFT_ARROW) ? 1 : 0),
    };
  }
  return {
    left: keyIsDown(LEFT_ARROW),
    right: keyIsDown(RIGHT_ARROW),
    thrust: keyIsDown(UP_ARROW) ? 1 : 0,
    slewTo: null,
    assist: true,
    translateForward: 0,
    translateRight: 0,
  };
}

// gestionnaires des crochets p5 souris/clavier, reliés à l'application
export function createInputHandlers(app, emit) {
  const screen = () => ({ width, height });
  // émet l'intention et resynchronise le panneau si elle l'a demandé
  const emitAndSync = (intent) => {
    if (emit(intent)) syncPanel(app.world, app.view);
  };

  return {
    mousePressed(event) {
      if (!event || event.target !== ui.canvas) return;
      emitAndSync({ type: "pointerDown", x: mouseX, y: mouseY, screen: screen() });
    },

    mouseDragged() {
      emitAndSync({ type: "pointerDrag", x: mouseX, y: mouseY, dx: mouseX - pmouseX, dy: mouseY - pmouseY, screen: screen() });
    },

    mouseReleased() {
      emitAndSync({ type: "pointerUp", x: mouseX, y: mouseY, screen: screen() });
    },

    mouseWheel(event) {
      if (event.target !== ui.canvas) return;
      emit({ type: "wheel", x: mouseX, y: mouseY, delta: event.delta, screen: screen() });
      return false;
    },

    keyPressed() {
      const tag = document.activeElement && document.activeElement.tagName;
      if (tag === "INPUT" || tag === "SELECT") return; // saisie dans le panneau
      const { world, view } = app;
      if ((key === "r" || key === "R") && world.ship.crashed) {
        emit({ type: "resetShip" });
        return;
      }
      if (key === "p" || key === "P") {
        emit({ type: "togglePlanning" });
        syncPanel(world, view);
        return;
      }
      if (world.mode === "flight") {
        if (key === "c" || key === "C") emit({ type: "toggleCamera" });
        if (key === ".") emit({ type: "changeWarp", delta: 1 });
        if (key === ",") emit({ type: "changeWarp", delta: -1 });
        if (key === "f" || key === "F") emit({ type: "refuel" });
        if (key === "x" || key === "X") emit({ type: "togglePrecision" });
        return;
      }
      if (keyCode === DELETE || keyCode === BACKSPACE) {
        emit({ type: "deleteNode" });
        syncPanel(world, view);
        return false;
      }
      if (keyCode === ESCAPE) {
        emit({ type: "deselect" });
        syncPanel(world, view);
      }
    },
  };
}
