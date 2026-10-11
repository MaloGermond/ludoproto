// Passage monde ↔ écran et sélection à la souris (calculs purs : la taille
// de l'écran est fournie par l'appelant).

import { displayPosition } from "../plan/index.js";

// édition
export const PICK_RADIUS = 14; // px — distance max d'un clic au tracé pour y poser un point
export const NODE_HIT_RADIUS = 12; // px — distance max d'un clic à un point existant
export const CLICK_MAX_MOVE = 5; // px — au-delà, le geste est un glisser (déplacement de vue)

// `screen` : { width, height } de la zone de dessin
export function worldToScreen(view, screen, x, y) {
  return { x: (x - view.cameraX) * view.zoom + screen.width / 2, y: (y - view.cameraY) * view.zoom + screen.height / 2 };
}

export function screenToWorld(view, screen, x, y) {
  return { x: (x - screen.width / 2) / view.zoom + view.cameraX, y: (y - screen.height / 2) / view.zoom + view.cameraY };
}

export function nearestPathPoint(view, screen, pred, sx, sy) {
  let best = null;
  let bestDist = Infinity;
  for (const p of pred.display) {
    const s = worldToScreen(view, screen, p.x, p.y);
    const d = Math.hypot(sx - s.x, sy - s.y); // = dist() de p5
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best ? { point: best, dist: bestDist } : null;
}

export function nodeAtScreen(view, screen, pred, sx, sy) {
  for (const pn of pred.nodes) {
    if (pn.startT === undefined) continue;
    const p = displayPosition(pred, pn.startPatch, pn.startX, pn.startY);
    if (!p) continue;
    const s = worldToScreen(view, screen, p.x, p.y);
    if (Math.hypot(sx - s.x, sy - s.y) < NODE_HIT_RADIUS) return pn.id;
  }
  return null;
}
