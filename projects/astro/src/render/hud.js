// Affichage tête haute : télémétrie, jauges, plan de vol, aide.

import { effectiveWarp, formatT, nodeDeltaV, WARP_LEVELS } from "../game/index.js";
import { constrain, degrees, FUEL_MAX, HEAT_MAX, ROTATION_TAP_UNIT } from "../sim/index.js";

export function autopilotStatus(world) {
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

export function drawHUD(world, view, prediction) {
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
export function drawFuelGauge(world, x, y, prediction) {
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
export function drawHeatGauge(ship, x, y) {
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

export function drawPlanSummary(world, view, x, y, prediction) {
  const planNodes = world.plan.nodes;
  textSize(13);
  textAlign(LEFT, TOP);
  noStroke();
  fill(255, 220);
  if (!planNodes.length) {
    text("Aucune manœuvre — cliquez sur le tracé ou choisissez une destination", x, y);
    return;
  }
  const total = planNodes.reduce((sum, n) => sum + nodeDeltaV(n, world.ship, prediction && prediction.nodes.find((p) => p.id === n.id)), 0);
  text(`Plan de vol : ${planNodes.length} manœuvres · Δv total ${total.toFixed(0)}`, x, y);
  const maxLines = Math.max(3, Math.floor((height - y - 160) / 18));
  planNodes.slice(0, maxLines).forEach((node, i) => {
    const predicted = prediction && prediction.nodes.find((n) => n.id === node.id);
    const start = predicted && predicted.startT !== undefined ? `${formatT(predicted.startT, world.time)} (${predicted.startRef.name})` : "non atteinte";
    const burn = node.power > 0 && node.duration > 0 ? `Δv ${nodeDeltaV(node, world.ship).toFixed(1)}` : "rotation seule";
    const what =
      node.kind === "land" ? `atterrissage guidé · Δv ${nodeDeltaV(node, world.ship, predicted).toFixed(1)}` : `cap ${Math.round(node.heading)}° · ${burn}`;
    fill(node.id === view.selectedNodeId ? [255, 230, 120] : [255, 255, 255, 200]);
    text(`M${i + 1} · ${start} · ${what}`, x, y + 18 + i * 18);
  });
  if (planNodes.length > maxLines) {
    fill(255, 160);
    text(`… ${planNodes.length - maxLines} de plus`, x, y + 18 + maxLines * 18);
  }
}

export function drawRotationIndicator(ship, x, y) {
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
