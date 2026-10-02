// Astres, orbites, sphères d'influence et fond étoilé.

import { worldToScreen } from "../game/index.js";
import { ALL_BODIES, PI } from "../sim/index.js";

// cercle éventuellement immense (orbite, sphère d'influence) : au-delà
// d'une certaine taille à l'écran, on ne trace que l'arc visible — un
// cercle pointillé de plusieurs centaines de milliers de pixels est très
// coûteux à rasteriser
export function drawBigCircle(view, cx, cy, r) {
  const zoom = view.zoom;
  if (r * zoom < 2000) {
    circle(cx, cy, r * 2);
    return;
  }
  const half = Math.hypot(width, height) / 2 / zoom;
  const d = Math.hypot(view.cameraX - cx, view.cameraY - cy);
  if (Math.abs(d - r) > half) return; // arc hors de l'écran
  const center = Math.atan2(view.cameraY - cy, view.cameraX - cx);
  const span = Math.min(PI, Math.asin(Math.min(1, half / r)) * 1.3);
  beginShape();
  for (let i = 0; i <= 96; i++) {
    const a = center - span + (2 * span * i) / 96;
    vertex(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  endShape();
}

// orbite de chaque astre autour de son parent, et sphère d'influence de
// l'astre de référence et de ses satellites
export function drawOrbits(world, view) {
  const zoom = view.zoom;
  const ref = world.ship.ref;
  push();
  noFill();
  strokeWeight(1 / zoom);
  drawingContext.setLineDash([3 / zoom, 6 / zoom]);
  stroke(255, 255, 255, 70);
  for (const body of ALL_BODIES) {
    if (!body.parentBody) continue;
    drawBigCircle(view, body.parentBody.x, body.parentBody.y, body.orbitRadius);
  }
  stroke(120, 170, 255, 45);
  drawingContext.setLineDash([2 / zoom, 10 / zoom]);
  for (const body of [ref, ...ref.children]) {
    if (Number.isFinite(body.soi)) drawBigCircle(view, body.x, body.y, body.soi);
  }
  pop();
}

// fond étoilé très lointain : ne doit réagir qu'au panoramique (parallaxe,
// à peine), pas au zoom. Le décalage caméra doit donc être mis à l'échelle
// par view.zoom comme le reste de la scène (voir renderScene) — sans ce
// facteur, le recentrage de la molette (qui déplace cameraX/Y pour garder
// le point sous le curseur) était pris pour un panoramique et amplifié
// d'autant plus que le zoom était faible, d'où une dérive nette en dézoom.
const STAR_PARALLAX = 0.08;
export function drawStars(view) {
  randomSeed(1);
  noStroke();
  fill(255, 255, 255, 150);
  for (let i = 0; i < 200; i++) {
    const x = (random(-2000, 2000) - view.cameraX * view.zoom * STAR_PARALLAX) % width;
    const y = (random(-2000, 2000) - view.cameraY * view.zoom * STAR_PARALLAX) % height;
    circle((x + width) % width, (y + height) % height, 2);
  }
}

export function drawBody(view, body) {
  if (body.atmosphere) drawAtmosphere(body);
  noStroke();
  fill(...body.color);
  circle(body.x, body.y, Math.max(body.radius * 2, 6 / view.zoom));
}

// halo translucide (anneaux concentriques, de plus en plus transparents vers
// l'extérieur) représentant l'atmosphère : purement visuel, la physique
// réelle (densité exponentielle) est calculée séparément dans stepShip
export function drawAtmosphere(body) {
  const atmo = body.atmosphere;
  const col = atmo.color || body.color;
  const rings = 10;
  noStroke();
  for (let i = rings; i >= 1; i--) {
    const frac = i / rings; // 1 = bord extérieur, →0 = près du sol
    const r = body.radius + atmo.height * frac;
    const alpha = (1 - frac) * (1 - frac) * 70 * Math.min(1.4, atmo.density);
    fill(col[0], col[1], col[2], alpha);
    circle(body.x, body.y, r * 2);
  }
}

// nom des astres trop petits à l'écran pour être reconnus
export function drawBodyLabels(view) {
  noStroke();
  textSize(11);
  textAlign(CENTER, TOP);
  for (const body of ALL_BODIES) {
    if (body.radius * view.zoom > 12) continue;
    const s = worldToScreen(view, { width, height }, body.x, body.y);
    if (s.x < -50 || s.y < -50 || s.x > width + 50 || s.y > height + 50) continue;
    fill(255, 170);
    text(body.name, s.x, s.y + 6);
  }
}
