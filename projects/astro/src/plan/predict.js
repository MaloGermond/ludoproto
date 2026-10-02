// ---------------------------------------------------------------------------
// Prédiction de trajectoire, découpée en "patchs" : un patch par sphère
// d'influence traversée. Chaque point est stocké relativement à l'astre de
// son patch ; l'affichage place chaque patch autour de son astre (voir
// displayAnchors).
// ---------------------------------------------------------------------------

import { autopilotControl, cloneAutopilot } from "../autopilot/index.js";
import {
  bodyPositionAt,
  cloneShip,
  COAST,
  constrain,
  isAncestorOrSelf,
  orbitElements,
  SIM_DT,
  stepShip,
} from "../sim/index.js";
import { planDone } from "./context.js";

// réglages de la prédiction
export const PLAN_MAX_HORIZON = 20000; // s — garde-fou, le tracé s'arrête normalement bien avant
export const PLAN_TAIL = 60; // s — durée minimale de tracé après la dernière manœuvre
export const MAX_TAIL = 2000; // s — au plus une orbite complète après la dernière manœuvre
export const ESCAPE_TAIL = 600; // s — trajectoire non liée (évasion)
export const THRUST_PREDICTION_HORIZON = 120; // s — tracé allégé pendant une poussée manuelle
export const POINT_MAX_ANGLE = 0.026; // rad — un point de tracé tous les ~1,5° autour de l'astre
export const POINT_MAX_GAP = 3; // s

// durée de tracé après la dernière manœuvre : une orbite complète si elle
// est fermée, sinon un temps fixe
export function tailDuration(s) {
  if (s.landed) return 0;
  const el = orbitElements(s);
  if (el.bound && el.apoapsis < s.ref.soi) return constrain(el.period * 1.02, PLAN_TAIL, MAX_TAIL);
  return ESCAPE_TAIL;
}

export function predictPath(startState, t0, plan, maxHorizon) {
  const ctx = { s: cloneShip(startState), t: t0, ap: plan ? cloneAutopilot(plan) : null };
  const s = ctx.s;
  const patches = [{ body: s.ref, t: t0 }];
  const points = [];
  let last = null;
  const pushPoint = (phase) => {
    last = { rx: s.rx, ry: s.ry, t: ctx.t, phase, patch: patches.length - 1 };
    points.push(last);
  };
  pushPoint("coast");

  let lastPhase = "coast";
  let end = null;
  let tEnd = t0 + maxHorizon;
  let orbitStart = null;
  if (planDone(ctx)) {
    orbitStart = t0;
    tEnd = Math.min(tEnd, t0 + tailDuration(s));
  }

  while (ctx.t < tEnd - 1e-9) {
    const control = ctx.ap ? autopilotControl(ctx.ap, s, ctx.t) || COAST : COAST;
    const phase = control.thrust > 0 ? "burn" : control.slewTo !== null ? "rotate" : "coast";
    if (phase !== lastPhase) {
      pushPoint(lastPhase); // borne exacte du changement de phase
      lastPhase = phase;
    }

    const ref = s.ref;
    stepShip(s, ctx.t, SIM_DT, control);
    ctx.t += SIM_DT;

    if (s.ref !== ref) {
      patches.push({ body: s.ref, t: ctx.t });
      pushPoint(phase);
      continue;
    }
    if (s.crashed) {
      end = "crash";
      break;
    }
    const done = planDone(ctx);
    if (s.landed && done && ctx.t > t0 + SIM_DT) {
      end = "landed";
      break;
    }
    if (done && orbitStart === null) {
      orbitStart = ctx.t;
      tEnd = Math.min(tEnd, ctx.t + tailDuration(s));
    }

    // densité de points : fonction de l'angle parcouru autour de l'astre
    const cross = last.rx * s.ry - last.ry * s.rx;
    const dot = last.rx * s.rx + last.ry * s.ry;
    const lastR = Math.hypot(last.rx, last.ry);
    const r = Math.hypot(s.rx, s.ry);
    if (Math.abs(Math.atan2(cross, dot)) > POINT_MAX_ANGLE || Math.abs(r - lastR) > 0.02 * r || ctx.t - last.t > POINT_MAX_GAP) {
      pushPoint(phase);
    }
  }
  pushPoint(lastPhase);

  // seules les manœuvres restantes (les terminées ne s'affichent plus)
  const firstNode = plan ? plan.index : 0;
  const nodes = ctx.ap ? ctx.ap.nodes.slice(firstNode) : [];
  const patchIndexAt = (t, body) => {
    let k = 0;
    for (let j = 0; j < patches.length; j++) if (patches[j].t <= t + 1e-9 && patches[j].body === body) k = j;
    return k;
  };
  for (const n of nodes) {
    if (n.startT !== undefined) n.startPatch = patchIndexAt(n.startT, n.startRef);
    if (n.burnStartT !== undefined) n.burnStartPatch = patchIndexAt(n.burnStartT, n.burnStartRef);
  }

  // apogée/périgée de l'orbite finale (dernier patch, après la dernière manœuvre)
  let periapsis = null;
  let apoapsis = null;
  if (end !== "crash" && orbitStart !== null) {
    const lastPatch = patches.length - 1;
    for (const p of points) {
      if (p.t < orbitStart || p.patch !== lastPatch) continue;
      const d = Math.hypot(p.rx, p.ry);
      if (!periapsis || d < periapsis.dist) periapsis = { ...p, dist: d };
      if (!apoapsis || d > apoapsis.dist) apoapsis = { ...p, dist: d };
    }
  }

  return { points, patches, nodes, firstNode, end, periapsis, apoapsis, finalState: s, finalT: ctx.t };
}

// position d'affichage de chaque patch à l'instant T :
// - le patch courant est dessiné autour de la position actuelle de son astre ;
// - un patch dans l'astre parent (ou un ancêtre) est dessiné autour de la
//   position actuelle de cet astre, comme dans KSP ;
// - un patch dans un autre astre (satellite ou voisin rencontré en route)
//   est dessiné dans la continuité du tracé : autour de la position qu'aura
//   cet astre au moment de la rencontre (astre "fantôme").
export function displayAnchors(pred, T) {
  const P = pred.patches;
  let k = 0;
  for (let j = 0; j < P.length; j++) if (P[j].t <= T + 1e-9) k = j;
  const anchors = new Array(P.length).fill(null);
  const broken = new Array(P.length).fill(false);
  anchors[k] = bodyPositionAt(P[k].body, T);
  for (let j = k + 1; j < P.length; j++) {
    const B = P[j].body;
    if (isAncestorOrSelf(B, P[k].body)) {
      anchors[j] = bodyPositionAt(B, T);
      broken[j] = true;
    } else {
      const te = P[j].t;
      const pb = bodyPositionAt(B, te);
      const pa = bodyPositionAt(P[j - 1].body, te);
      anchors[j] = { x: anchors[j - 1].x + pb.x - pa.x, y: anchors[j - 1].y + pb.y - pa.y };
    }
  }
  return { anchors, broken, current: k };
}

// calcule les coordonnées d'affichage des points visibles (à partir de T)
export function layoutPrediction(pred, T) {
  const layout = displayAnchors(pred, T);
  const display = [];
  for (const p of pred.points) {
    if (p.patch < layout.current || (p.patch === layout.current && p.t < T - 1e-9)) continue;
    const a = layout.anchors[p.patch];
    display.push({ x: a.x + p.rx, y: a.y + p.ry, t: p.t, phase: p.phase, patch: p.patch });
  }
  pred.layout = layout;
  pred.display = display;
  return pred;
}

export function displayPosition(pred, patch, rx, ry) {
  const a = pred.layout.anchors[patch];
  return a ? { x: a.x + rx, y: a.y + ry } : null;
}
