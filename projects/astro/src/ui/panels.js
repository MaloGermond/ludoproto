// Panneaux de l'interface : recopie l'état dans le DOM, sans le modifier.

import { canPlan, formatT, nodeDeltaV, selectedNode, WARP_LEVELS } from "../game/index.js";
import { ui } from "./dom.js";

// recopie la manœuvre sélectionnée dans les curseurs
export function syncPanel(world, view) {
  const node = world.mode === "planning" ? selectedNode(world, view) : null;
  ui.panel.hidden = !node;
  if (!node) return;
  ui.time.max = Math.ceil(Math.max(300, node.t - world.time + 60));
  ui.time.value = node.t - world.time;
  ui.heading.value = node.heading;
  ui.power.value = Math.round(node.power * 100);
  ui.duration.value = node.duration;
}

export function updateUI(world, view, prediction) {
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
