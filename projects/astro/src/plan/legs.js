// Étapes ("jambes") d'une route : chacune part d'une orbite circulaire (ou
// du sol) et se termine en orbite circulaire autour de l'astre suivant.

import {
  angleDiff,
  localOrbit,
  orbitElements,
  PI,
  SIM_DT,
  thrustAccel,
  TWO_PI,
} from "../sim/index.js";
import {
  circularize,
  commitNode,
  correctTrajectory,
  makeBurnNode,
  mod,
  nextApsisTime,
  PlanError,
  progradeDv,
  signedApproach,
  tangentialDv,
} from "./burns.js";
import { cloneCtx, runCtx } from "./context.js";

// décollage vertical puis circularisation à l'apogée, au rayon rp
export function legLaunch(ctx, rp, nodes) {
  const body = ctx.s.ref;
  const accel = thrustAccel(ctx.s);
  const tryDv = (dv) => {
    const steps = Math.max(1, Math.ceil(dv / (accel * SIM_DT)));
    const node = { t: ctx.t, heading: 0, power: dv / (steps * accel * SIM_DT), duration: steps * SIM_DT };
    const c = commitNode(ctx, node, []);
    const apex = cloneCtx(c);
    let rmax = Math.hypot(apex.s.rx, apex.s.ry);
    runCtx(apex, apex.t + 1000, (cc) => {
      if (cc.s.ref !== body || cc.s.landed) return false;
      rmax = Math.max(rmax, Math.hypot(cc.s.rx, cc.s.ry));
      return cc.s.rx * cc.s.rvx + cc.s.ry * cc.s.rvy > 0;
    });
    return { rmax, node, afterBurn: c, tApex: apex.t };
  };

  let lo = 0;
  let hi = ctx.s.fuel;
  if (tryDv(hi).rmax < rp) throw new PlanError("Pas assez de carburant pour décoller jusqu'à cette altitude.");
  for (let i = 0; i < 30; i++) {
    const mid = (lo + hi) / 2;
    if (tryDv(mid).rmax < rp) lo = mid;
    else hi = mid;
  }
  const best = tryDv(hi);
  nodes.push(best.node);
  return circularize(best.afterBurn, best.tApex, nodes, 1);
}

// remet le vaisseau sur une orbite circulaire s'il en est loin
export function legStabilize(ctx, nodes) {
  const body = ctx.s.ref;
  const el = orbitElements(ctx.s);
  const low = el.periapsis < body.radius + 20;
  if (el.bound && el.e < 0.05 && !low && el.apoapsis < body.soi) return ctx;
  if (low) {
    // trajectoire suborbitale : on circularise au sommet de la montée
    const climbing = ctx.s.rx * ctx.s.rvx + ctx.s.ry * ctx.s.rvy > 0;
    const tA = climbing ? nextApsisTime(ctx, el.bound ? el.period : 2000) : null;
    if (tA === null || el.apoapsis < body.radius + 30) {
      throw new PlanError("Trajectoire trop basse pour se mettre en orbite : reprenez de l'altitude ou posez-vous.");
    }
    return circularize(ctx, tA, nodes, 1);
  }
  return circularize(ctx, ctx.t, nodes, 0);
}

// changement d'altitude autour du même astre (transfert de Hohmann)
export function legAltitude(ctx, rt, nodes) {
  const mu = ctx.s.ref.mu;
  const r1 = Math.hypot(ctx.s.rx, ctx.s.ry);
  if (Math.abs(r1 - rt) < 2) return ctx;
  const node = makeBurnNode(ctx, ctx.t, (s) => {
    const r = Math.hypot(s.rx, s.ry);
    const a = (r + rt) / 2;
    return tangentialDv(s, Math.sqrt(mu * (2 / r - 1 / a)));
  });
  if (node) ctx = commitNode(ctx, node, nodes);
  const el = orbitElements(ctx.s);
  const tA = nextApsisTime(ctx, el.bound ? el.period : 2000, 1);
  if (tA === null) throw new PlanError("Transfert d'altitude impossible.");
  return circularize(ctx, tA, nodes, 0);
}

// descente vers un satellite de l'astre courant (ex : Terre → Lune)
export function legDown(ctx, B, rt, nodes) {
  const P = ctx.s.ref;
  const mu = P.mu;
  const r1 = Math.hypot(ctx.s.rx, ctx.s.ry);
  const r2 = B.orbitRadius;
  const a = (r1 + r2) / 2;
  const Th = PI * Math.sqrt((a * a * a) / mu);
  const sgn = Math.sign(ctx.s.rx * ctx.s.rvy - ctx.s.ry * ctx.s.rvx) || 1;
  const ws = sgn * Math.sqrt(mu / (r1 * r1 * r1));
  const wB = B.orbitSpeed;

  // fenêtre de tir : à l'arrivée (demi-orbite de transfert plus tard), le
  // satellite doit se trouver à l'opposé du point de départ
  const rate = wB - ws;
  const theta = (t) => Math.atan2(ctx.s.ry, ctx.s.rx) + ws * (t - ctx.t);
  const g = (t) => B.phase0 + wB * (t + Th) - theta(t) - PI;
  const synodic = TWO_PI / Math.abs(rate);
  let tb = ctx.t + (rate > 0 ? mod(-g(ctx.t), TWO_PI) : mod(g(ctx.t), TWO_PI)) / Math.abs(rate);
  if (tb < ctx.t + 5) tb += synodic;

  const base = tb - 10 > ctx.t ? runCtx(cloneCtx(ctx), tb - 10) : ctx;
  const vt = Math.sqrt(mu * (2 / r1 - 1 / a));
  const dep = makeBurnNode(base, tb, (s) => tangentialDv(s, vt));
  let c = commitNode(base, dep, nodes);

  // correction à mi-parcours pour passer à l'altitude visée
  const mcc = runCtx(cloneCtx(c), c.t + 0.25 * Th);
  const horizon = 1.6 * Th;
  const objective = (cc) => signedApproach(cc, B, cc.t + horizon).signed - rt;
  c = correctTrajectory(mcc, objective, Math.max(2, 0.15 * vt), Math.max(2, 0.03 * rt), nodes);

  const approach = signedApproach(c, B, c.t + horizon);
  return circularize(c, approach.t, nodes, 0);
}

// sortie de la sphère d'influence de l'astre courant C avec une vitesse
// d'excès vinf (signée : > 0 dans le sens du mouvement de C), en visant une
// sortie vers tExitWanted si donné
export function escapeBurn(ctx, vinfSigned, tExitWanted) {
  const C = ctx.s.ref;
  const mu = C.mu;
  const rp = Math.hypot(ctx.s.rx, ctx.s.ry);
  const sgn = Math.sign(ctx.s.rx * ctx.s.rvy - ctx.s.ry * ctx.s.rvx) || 1;
  const vinf = Math.abs(vinfSigned);
  const vb = Math.sqrt(vinf * vinf + 2 * mu * (1 / rp - 1 / C.soi));
  // angle entre le point de poussée et la direction de sortie de l'hyperbole
  const e = 1 + (rp * vinf * vinf) / mu;
  const nuInf = Math.acos(-1 / e);
  const Tpark = TWO_PI * Math.sqrt((rp * rp * rp) / mu);
  const ws = (sgn * TWO_PI) / Tpark;
  const theta0 = Math.atan2(ctx.s.ry, ctx.s.rx);

  const exitDirAt = (t) => {
    const o = localOrbit(C, t);
    return Math.atan2(o.vy, o.vx) + (vinfSigned < 0 ? PI : 0);
  };
  let tExit = tExitWanted ?? ctx.t;
  let tEsc = 0;
  let result = null;
  // la sortie réelle (sphère d'influence finie, poussée non instantanée)
  // s'écarte un peu de la théorie : on mesure et on corrige à chaque tour
  let biasAngle = 0;
  let vb2 = vb * vb;
  for (let iter = 0; iter < 4; iter++) {
    const dvCur = Math.sqrt(vb2) - Math.sqrt(mu / rp);
    const thetaP = exitDirAt(tExit) - sgn * nuInf + biasAngle;
    const wanted = Math.max(ctx.t + 3, (tExitWanted ?? ctx.t) - tEsc);
    // instant où le vaisseau passe à l'angle thetaP, le plus proche de `wanted`
    const first = ctx.t + mod((thetaP - theta0) * sgn, TWO_PI) / Math.abs(ws);
    const tb0 = first + Math.round((wanted - first) / Tpark) * Tpark;

    // essaie le tour d'orbite voulu, puis les voisins, jusqu'à une sortie
    // qui ne croise pas un satellite de C (ex : la Lune en quittant la Terre)
    result = null;
    for (const k of [0, 1, -1, 2, -2, 3, -3, 4, -4]) {
      const tb = tb0 + k * Tpark;
      if (tb < ctx.t + 3) continue;
      const base = tb - 10 > ctx.t ? runCtx(cloneCtx(ctx), tb - 10) : ctx;
      const node = makeBurnNode(base, tb, (s) => progradeDv(s, dvCur));
      let c;
      try {
        c = commitNode(base, node, []);
      } catch (e) {
        continue;
      }
      const out = cloneCtx(c);
      runCtx(out, out.t + 5000, (cc) => cc.s.ref === C);
      if (out.s.ref !== C.parentBody) continue; // resté lié à C, ou capturé par un satellite
      tEsc = out.t - tb;
      result = { ctx: c, node, tExit: out.t };
      // vitesse de sortie relative à C, comparée à celle voulue
      const o = localOrbit(C, out.t);
      const relVx = out.s.rvx - o.vx;
      const relVy = out.s.rvy - o.vy;
      biasAngle += angleDiff(Math.atan2(relVy, relVx), exitDirAt(out.t));
      vb2 = Math.max(vb2 + vinf * vinf - (relVx * relVx + relVy * relVy), 2 * mu * (1 / rp - 1 / C.soi) + 1);
      break;
    }
    if (!result) throw new PlanError(`Impossible de quitter l'attraction de ${C.name}.`);
    if (tExitWanted === undefined) tExit = result.tExit;
  }
  return result;
}

// remontée vers l'astre parent, orbite circulaire de rayon rt autour de lui
export function legUp(ctx, rt, nodes) {
  const C = ctx.s.ref;
  const P = C.parentBody;
  const rC = C.orbitRadius;
  const vC = C.orbitSpeed * rC;
  const hohmann = vC * (Math.sqrt((2 * rt) / (rC + rt)) - 1);
  const minVinf = 0.6 * Math.sqrt((2 * C.mu) / C.soi);
  const vinf = Math.sign(hohmann) * Math.max(Math.abs(hohmann), minVinf);
  const esc = escapeBurn(ctx, vinf);
  nodes.push(esc.node);

  const a = (rC + rt) / 2;
  const Th = PI * Math.sqrt((a * a * a) / P.mu);
  const lower = rt < rC;
  // rayon extrême (périastre si on descend, apoastre si on monte) autour de P
  const extremum = (cc) => {
    const c = cloneCtx(cc);
    let best = null;
    runCtx(c, cc.t + 1.3 * Th, (x) => {
      if (x.s.ref !== P) return false;
      const r = Math.hypot(x.s.rx, x.s.ry);
      if (!best || (lower ? r < best.r : r > best.r)) best = { r, t: x.t };
    });
    return best || { r: lower ? Infinity : 0, t: cc.t };
  };
  const mcc = runCtx(cloneCtx(esc.ctx), esc.tExit + 5);
  const c = correctTrajectory(mcc, (cc) => extremum(cc).r - rt, Math.max(3, Math.abs(vinf)), Math.max(2, 0.02 * rt), nodes);
  return circularize(c, extremum(c).t, nodes, 0);
}

// temps de vol et angle parcouru sur une orbite qui part tangentiellement
// (donc d'un apside) au rayon r1 à la vitesse v1, jusqu'au rayon r2
export function transferGeometry(mu, r1, v1, r2) {
  const h = r1 * v1;
  const p = (h * h) / mu;
  const e = Math.abs(p / r1 - 1);
  const a = p / (1 - e * e);
  if (!(e < 1)) return null;
  const outward = r2 > r1;
  const cosNu = (p / r2 - 1) / e;
  if (Math.abs(cosNu) > 1) return null; // r2 hors d'atteinte
  const nu = Math.acos(cosNu);
  const timeFromPeri = (anomaly) => {
    const E = 2 * Math.atan(Math.sqrt((1 - e) / (1 + e)) * Math.tan(anomaly / 2));
    return (E - e * Math.sin(E)) * Math.sqrt((a * a * a) / mu);
  };
  const T = TWO_PI * Math.sqrt((a * a * a) / mu);
  // départ au périastre (on monte) ou à l'apoastre (on descend)
  return outward ? { tof: timeFromPeri(nu), dnu: nu } : { tof: T / 2 - timeFromPeri(nu), dnu: PI - nu };
}

// transfert vers un astre voisin (même parent), ex : Terre → Mars
export function legAcross(ctx, B, rt, nodes) {
  const C = ctx.s.ref;
  const P = C.parentBody;
  const rC = C.orbitRadius;
  const rB = B.orbitRadius;
  const vC = C.orbitSpeed * rC;
  // vitesse d'excès : celle de Hohmann, mais au moins une fraction de la
  // vitesse de libération au bord de la sphère d'influence — sinon le
  // vaisseau s'attarde à sa lisière et risque d'y croiser un satellite
  const hohmann = vC * (Math.sqrt((2 * rB) / (rC + rB)) - 1);
  const minVinf = 0.6 * Math.sqrt((2 * C.mu) / C.soi);
  const vinf = Math.sign(hohmann) * Math.max(Math.abs(hohmann), minVinf);
  const geo = transferGeometry(P.mu, rC, vC + vinf, rB);
  if (!geo) throw new PlanError(`${B.name} hors d'atteinte.`);

  // durée d'évasion estimée, puis fenêtre de tir : à l'arrivée (tof plus
  // tard), B doit se trouver dnu plus loin que le point de sortie de C
  const trial = escapeBurn(ctx, vinf);
  const tEsc = trial.tExit - ctx.t;
  const rate = B.orbitSpeed - C.orbitSpeed;
  const g = (t) => B.phase0 + B.orbitSpeed * (t + geo.tof) - (C.phase0 + C.orbitSpeed * t) - geo.dnu;
  const earliest = ctx.t + tEsc + 5;
  const tw = earliest + (rate > 0 ? mod(-g(earliest), TWO_PI) : mod(g(earliest), TWO_PI)) / Math.abs(rate);

  const esc = escapeBurn(ctx, vinf, tw);
  nodes.push(esc.node);

  const mcc = runCtx(cloneCtx(esc.ctx), esc.tExit + 5);
  const horizon = 1.5 * geo.tof + 200;
  const objective = (cc) => signedApproach(cc, B, cc.t + horizon).signed - rt;
  const c = correctTrajectory(mcc, objective, Math.max(3, Math.abs(vinf)), Math.max(2, 0.03 * rt), nodes);
  const approach = signedApproach(c, B, c.t + horizon);
  return circularize(c, approach.t, nodes, 0);
}
