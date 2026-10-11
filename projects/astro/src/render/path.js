// Tracé prédit, manœuvres, apsides, orbite visée et astres fantômes.

import { formatT } from "../game/index.js";
import { displayPosition } from "../plan/index.js";
import { bodyPositionAt, HALF_PI } from "../sim/index.js";
import { drawBigCircle } from "./bodies.js";
import { PHASE_STYLES } from "./styles.js";

export function drawPredictedPath(view, pred) {
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

export function drawPathEnd(view, pred) {
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

export function drawApsis(view, pred, point, label, color) {
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
export function drawTargetOrbit(view, pred, target) {
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
export function drawGhostBodies(world, view, pred) {
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

export function drawManeuverNodes(world, view, pred) {
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
