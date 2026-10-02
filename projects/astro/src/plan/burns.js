// Briques du calculateur de route : construction de manœuvres (poussée
// centrée sur un instant, circularisation, correction de trajectoire par
// recherche numérique sur la trajectoire simulée).

import { copyNode, createAutopilot } from "../autopilot/index.js";
import {
  angleDiff,
  AUTOPILOT_SLEW_RATE,
  bodyPositionAt,
  bodyVelocityAt,
  degrees,
  HALF_PI,
  orbitElements,
  progradeAngle,
  SIM_DT,
  thrustAccel,
} from "../sim/index.js";
import { cloneCtx, planDone, runCtx } from "./context.js";

export class PlanError extends Error {}

export function mod(a, n) {
  return ((a % n) + n) % n;
}

export function parkingRadius(body) {
  const clear = body.atmosphere ? body.atmosphere.height * 1.3 : 0;
  return body.radius + Math.max(80, body.radius * 0.5, clear);
}

// orbite la plus haute utilisable autour d'un astre (sous les sphères
// d'influence de ses satellites et dans la sienne)
export function maxOrbitRadius(body) {
  let max = body.soi * 0.8;
  for (const c of body.children) max = Math.min(max, (c.orbitRadius - c.soi) * 0.9);
  return max;
}

// Δv (vecteur) à appliquer pour une orbite circulaire au rayon actuel.
// dir : +1 sens direct (celui des astres), -1 rétrograde, 0 garder le sens actuel
export function circularDv(s, dir) {
  const r = Math.hypot(s.rx, s.ry);
  const v = Math.sqrt(s.ref.mu / r);
  const sign = dir || Math.sign(s.rx * s.rvy - s.ry * s.rvx) || 1;
  const tx = (-s.ry / r) * sign;
  const ty = (s.rx / r) * sign;
  return { x: tx * v - s.rvx, y: ty * v - s.rvy };
}

export function tangentialDv(s, speed) {
  const r = Math.hypot(s.rx, s.ry);
  const sign = Math.sign(s.rx * s.rvy - s.ry * s.rvx) || 1;
  return { x: (-s.ry / r) * sign * speed - s.rvx, y: (s.rx / r) * sign * speed - s.rvy };
}

export function progradeDv(s, m) {
  const v = Math.hypot(s.rvx, s.rvy) || 1;
  return { x: (s.rvx / v) * m, y: (s.rvy / v) * m };
}

// Δv d'intensité m dans la direction faisant l'angle phi avec le prograde
export function directionDv(s, m, phi) {
  const v = Math.hypot(s.rvx, s.rvy) || 1;
  const px = s.rvx / v;
  const py = s.rvy / v;
  const c = Math.cos(phi);
  const sn = Math.sin(phi);
  return { x: m * (c * px - sn * py), y: m * (c * py + sn * px) };
}

// construit une manœuvre dont la poussée est centrée sur tCenter (ou dès que
// possible) et réalise le Δv donné par dvFn(état au centre de la poussée).
// Le temps de rotation préalable est pris en compte pour avancer le départ.
export function makeBurnNode(ctx, tCenter, dvFn) {
  let center = Math.max(tCenter, ctx.t);
  let node = null;
  for (let iter = 0; iter < 5; iter++) {
    const probe = runCtx(cloneCtx(ctx), center);
    const dv = dvFn(probe.s);
    const m = Math.hypot(dv.x, dv.y);
    if (!(m > 1e-3)) return null;
    const angle = Math.atan2(dv.y, dv.x);
    const accel = thrustAccel(probe.s);
    // Δv exact : nombre entier de pas, puissance ajustée
    const steps = Math.max(1, Math.ceil(m / (accel * SIM_DT)));
    const duration = steps * SIM_DT;
    const power = m / (steps * accel * SIM_DT);

    let start = Math.max(ctx.t, center - duration / 2);
    for (let k = 0; k < 2; k++) {
      const at = runCtx(cloneCtx(ctx), start);
      const rot = Math.abs(angleDiff(at.s.angle, angle)) / AUTOPILOT_SLEW_RATE;
      start = Math.max(ctx.t, center - duration / 2 - rot);
    }
    const at = runCtx(cloneCtx(ctx), start);
    const rot = Math.abs(angleDiff(at.s.angle, angle)) / AUTOPILOT_SLEW_RATE;
    node = { t: at.t, heading: degrees(angleDiff(progradeAngle(at.s), angle)), power, duration };
    const newCenter = at.t + rot + duration / 2;
    if (Math.abs(newCenter - center) < SIM_DT) break;
    center = newCenter;
  }
  return node;
}

// ajoute la manœuvre au plan et simule jusqu'à sa fin
export function commitNode(ctx, node, nodes) {
  const c = cloneCtx(ctx);
  if (c.ap) c.ap.nodes.push(copyNode(node));
  else c.ap = createAutopilot([node]);
  nodes.push(node);
  runCtx(c, node.t + node.duration + 120, (cc) => !planDone(cc));
  if (c.s.crashed) throw new PlanError("La trajectoire calculée mène à un crash.");
  return c;
}

// prochain passage à un apside (vitesse radiale qui change de signe)
export function nextApsisTime(ctx, maxSpan, minSpan = 0) {
  const c = cloneCtx(ctx);
  const ref = c.s.ref;
  let sign = Math.sign(c.s.rx * c.s.rvx + c.s.ry * c.s.rvy);
  let found = null;
  runCtx(c, ctx.t + maxSpan, (cc) => {
    if (cc.s.ref !== ref) return false;
    const sg = Math.sign(cc.s.rx * cc.s.rvx + cc.s.ry * cc.s.rvy);
    if (sign === 0) sign = sg;
    if (sg !== 0 && sg !== sign) {
      if (cc.t - ctx.t >= minSpan) {
        found = cc.t;
        return false;
      }
      sign = sg;
    }
  });
  return found;
}

// circularise autour de l'astre courant, poussée centrée sur tCenter, puis
// corrige le résidu d'excentricité aux apsides suivants
export function circularize(ctx, tCenter, nodes, dir = 0) {
  let node = makeBurnNode(ctx, tCenter, (s) => circularDv(s, dir));
  if (node) ctx = commitNode(ctx, node, nodes);
  for (let k = 0; k < 2; k++) {
    const el = orbitElements(ctx.s);
    if (!el.bound || el.e < 0.01) break;
    const tA = nextApsisTime(ctx, el.period, el.period * 0.1);
    if (tA === null) break;
    node = makeBurnNode(ctx, tA, (s) => circularDv(s, 0));
    if (!node) break;
    ctx = commitNode(ctx, node, nodes);
  }
  return ctx;
}

// passage au plus près d'un astre, signé par le sens de rotation autour de
// lui (positif = sens direct) : c'est la grandeur que la correction vise
export function signedApproach(ctx, B, tMax) {
  const c = cloneCtx(ctx);
  let best = { d: Infinity, signed: Infinity, t: c.t };
  const measure = (cc) => {
    let dx, dy, dvx, dvy;
    if (cc.s.ref === B) {
      dx = cc.s.rx;
      dy = cc.s.ry;
      dvx = cc.s.rvx;
      dvy = cc.s.rvy;
    } else {
      const pr = bodyPositionAt(cc.s.ref, cc.t);
      const vr = bodyVelocityAt(cc.s.ref, cc.t);
      const pb = bodyPositionAt(B, cc.t);
      const vb = bodyVelocityAt(B, cc.t);
      dx = pr.x + cc.s.rx - pb.x;
      dy = pr.y + cc.s.ry - pb.y;
      dvx = vr.vx + cc.s.rvx - vb.vx;
      dvy = vr.vy + cc.s.rvy - vb.vy;
    }
    const d = Math.hypot(dx, dy);
    if (d < best.d) best = { d, signed: (Math.sign(dx * dvy - dy * dvx) || 1) * d, t: cc.t };
    // périastre passé dans la sphère d'influence : inutile d'aller plus loin
    if (cc.s.ref === B && dx * dvx + dy * dvy > 0) return false;
  };
  runCtx(c, tMax, measure);
  return best;
}

// correction de trajectoire : poussée d'intensité m (balayage puis
// dichotomie) pour annuler objective(contexte). La direction suit d'abord
// le gradient de l'objectif (mélange prograde/radial), puis le prograde et
// le radial seuls si besoin.
export function correctTrajectory(ctx, objective, scale, tol, nodes) {
  const f0 = objective(ctx);
  if (Math.abs(f0) < tol) return ctx;
  const evalM = (m, phi) => {
    if (Math.abs(m) < 1e-4) return { f: f0, c: ctx, node: null };
    const node = makeBurnNode(ctx, ctx.t, (s) => directionDv(s, m, phi));
    if (!node) return { f: f0, c: ctx, node: null };
    let c;
    try {
      c = commitNode(ctx, node, []);
    } catch (e) {
      return { f: NaN };
    }
    return { f: objective(c), c, node };
  };

  const d = scale * 0.02;
  const fp = evalM(d, 0).f;
  const fr = evalM(d, HALF_PI).f;
  const directions = [0, HALF_PI];
  if (Number.isFinite(fp) && Number.isFinite(fr)) directions.unshift(Math.atan2(fr - f0, fp - f0));

  for (const phi of directions) {
    const found = searchAlong(evalM, phi, f0, scale, tol);
    if (found) {
      if (!found.node) return ctx;
      nodes.push(found.node);
      return found.c;
    }
  }
  throw new PlanError("Correction de trajectoire introuvable — essayez une autre altitude.");
}

export function searchAlong(evalM, phi, f0, scale, tol) {
  const N = 12;
  const samples = [];
  for (let i = -N; i <= N; i++) {
    const m = (scale * i) / N;
    samples.push({ m, ...(i === 0 ? { f: f0, node: null } : evalM(m, phi)) });
  }
  const brackets = [];
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    if (Number.isFinite(a.f) && Number.isFinite(b.f) && Math.sign(a.f) !== Math.sign(b.f)) brackets.push([a, b]);
  }
  brackets.sort((p, q) => Math.min(Math.abs(p[0].m), Math.abs(p[1].m)) - Math.min(Math.abs(q[0].m), Math.abs(q[1].m)));

  for (let [a, b] of brackets) {
    for (let i = 0; i < 30; i++) {
      const mid = { m: (a.m + b.m) / 2 };
      Object.assign(mid, evalM(mid.m, phi));
      if (!Number.isFinite(mid.f)) break;
      if (Math.sign(mid.f) === Math.sign(a.f)) a = mid;
      else b = mid;
      if (Math.abs(mid.f) < tol) break;
    }
    const best = Math.abs(a.f) < Math.abs(b.f) ? a : b;
    if (Number.isFinite(best.f) && Math.abs(best.f) < tol) return best;
  }
  return null;
}
