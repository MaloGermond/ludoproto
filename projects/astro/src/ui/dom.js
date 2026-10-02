// ---------------------------------------------------------------------------
// Interface (boutons + panneaux, définis dans index.html) : seul endroit qui
// touche au DOM. Chaque bouton émet une intention (voir game/intents.js) ;
// l'interface ne modifie jamais l'état directement.
// ---------------------------------------------------------------------------

import { sun } from "../sim/index.js";
import { syncPanel } from "./panels.js";

// références DOM (singletons de la page, pas de l'état de jeu)
export const ui = {};

// crée le canevas p5 et branche les contrôles de la page sur `emit`
export function setupUI(app, emit) {
  ui.canvas = createCanvas(windowWidth, windowHeight).elt;
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

  // un clic émet son intention, le panneau est resynchronisé après coup et
  // le clavier rendu au jeu
  const onClick = (el, intent) =>
    el.addEventListener("click", () => {
      emit(intent());
      syncPanel(app.world, app.view);
      el.blur();
    });
  onClick(ui.plan, () => ({ type: "enterPlanning" }));
  onClick(ui.launch, () => ({ type: "launchPlan" }));
  onClick(ui.clear, () => ({ type: "clearPlan" }));
  onClick(ui.circularize, () => ({ type: "circularize" }));
  onClick(ui.land, () => ({ type: "land", angle: ui.landAngle.value === "" ? null : +ui.landAngle.value }));
  onClick(ui.remove, () => ({ type: "deleteNode" }));
  onClick(ui.camera, () => ({ type: "toggleCamera" }));
  onClick(ui.warpUp, () => ({ type: "changeWarp", delta: 1 }));
  onClick(ui.warpDown, () => ({ type: "changeWarp", delta: -1 }));
  onClick(ui.warp, () => ({ type: "resetWarp" }));
  ui.route.addEventListener("click", () => {
    emit({ type: "routeStart" });
    ui.routeInfo.textContent = app.view.routeMessage.text;
    ui.route.disabled = true;
    // laisse le navigateur afficher le message avant le calcul
    setTimeout(() => {
      emit({ type: "route", targetId: ui.target.value, altitude: Number(ui.altitude.value) });
      syncPanel(app.world, app.view);
      ui.route.disabled = false;
    }, 30);
    syncPanel(app.world, app.view);
    ui.route.blur();
  });

  const onInput = (el, changes) => el.addEventListener("input", () => emit({ type: "updateNode", changes: changes() }));
  onInput(ui.time, () => ({ t: app.world.time + Number(ui.time.value) }));
  onInput(ui.heading, () => ({ heading: Number(ui.heading.value) }));
  onInput(ui.power, () => ({ power: Number(ui.power.value) / 100 }));
  onInput(ui.duration, () => ({ duration: Number(ui.duration.value) }));
  for (const preset of document.querySelectorAll("[data-heading]")) {
    onClick(preset, () => ({ type: "updateNode", changes: { heading: Number(preset.dataset.heading) } }));
  }
}

export function resizeToWindow() {
  resizeCanvas(windowWidth, windowHeight);
}
