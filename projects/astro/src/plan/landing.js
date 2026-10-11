// Atterrissage : poussée qui annule la vitesse relative à l'astre (chute
// verticale), puis atterrissage guidé exécuté par le pilote automatique.

import { copyNode, LANDING_IGNITION } from "../autopilot/index.js";
import { angleDiff, degrees, orbitElements, PI, radians, thrustAccel } from "../sim/index.js";
import { commitNode, makeBurnNode, PlanError } from "./burns.js";
import { cloneCtx, planDone, runCtx } from "./context.js";

export const LANDING_TIMEOUT = 3000; // s — garde-fou pour la vérification d'un atterrissage

// séquence d'atterrissage : poussée qui annule la vitesse relative au temps
// deorbitT (chute verticale, sans dérive latérale puisque le moment
// cinétique devient nul), puis atterrissage guidé. Partagée par planLanding
// (déorbite immédiatement) et planLandingAt (déorbite au moment trouvé par
// recherche pour viser un point précis).
export function landingSequence(ctx, deorbitT) {
  const c0 = deorbitT > ctx.t + 1e-6 ? runCtx(cloneCtx(ctx), deorbitT) : cloneCtx(ctx);
  const nodes = [];
  const deorbit = makeBurnNode(c0, c0.t, (s) => ({ x: -s.rvx, y: -s.rvy }));
  let c = deorbit ? commitNode(c0, deorbit, nodes) : c0;
  const land = { kind: "land", t: c.t, heading: 0, power: 1, duration: 0 };
  c = cloneCtx(c);
  c.ap.nodes.push(copyNode(land));
  nodes.push(land);
  runCtx(c, c.t + LANDING_TIMEOUT, (cc) => !planDone(cc));
  return { c, nodes };
}

export function checkLandingPossible(ctx, body) {
  if (ctx.s.crashed) throw new PlanError("Le plan actuel se termine par un crash.");
  if (ctx.s.landed) throw new PlanError(`Déjà posé sur ${body.name} à la fin du plan.`);
  if (!body.parentBody) throw new PlanError(`Impossible de se poser sur ${body.name}.`);
  if (body.gasGiant) throw new PlanError(`${body.name} n'a pas de surface solide — on s'y enfonce, l'atmosphère y est fatale.`);
  if (body.mu / (body.radius * body.radius) > LANDING_IGNITION * thrustAccel(ctx.s)) {
    throw new PlanError(`Gravité de ${body.name} trop forte pour le moteur.`);
  }
}

// atterrissage dès que possible depuis le contexte `ctx` (fin du plan
// actuel) ; lève une PlanError s'il échoue
export function landAsap(ctx) {
  const body = ctx.s.ref;
  checkLandingPossible(ctx, body);
  const { c, nodes } = landingSequence(ctx, ctx.t);
  if (!c.s.landed || c.s.ref !== body) throw new PlanError(`L'atterrissage sur ${body.name} échoue (crash ou carburant).`);
  return { c, nodes, body };
}

// vise un point précis de la surface (angle en degrés, 0-359°) : cherche le
// moment du déorbitage qui y fait atterrir. Sans poussée latérale, la chute
// est purement radiale (moment cinétique nul) : l'angle d'atterrissage ne
// dépend que du moment du déorbitage, en croissant de façon monotone (mais
// pas forcément uniforme, la rotation préalable du vaisseau vers le
// rétrograde prenant un temps variable) sur une période orbitale complète —
// il passe donc par la cible exactement une fois. Balayage grossier pour
// repérer ce passage, puis dichotomie pour l'affiner.
export function findLandingAt(base, targetAngleDeg) {
  const body = base.s.ref;
  checkLandingPossible(base, body);
  const el = orbitElements(base.s);
  if (!el.bound || el.apoapsis >= body.soi) throw new PlanError("Orbite non liée : impossible de viser un point précis.");

  const target = radians(((targetAngleDeg % 360) + 360) % 360);
  const attempt = (t) => {
    const { c, nodes } = landingSequence(base, t);
    if (!c.s.landed || c.s.ref !== body) return null;
    return { c, nodes, err: angleDiff(c.s.landedAngle, target) };
  };

  // un vrai passage par la cible change le signe de err en le faisant
  // tendre vers 0 (somme des amplitudes petite) ; un saut de +180° à -180°
  // (habillage de l'angle) change aussi le signe mais sans s'approcher de
  // 0 (somme des amplitudes proche de 360°) — à ne pas confondre
  const isCrossing = (a, b) => Math.sign(a.err) !== Math.sign(b.err) && Math.abs(a.err) + Math.abs(b.err) < PI;

  const SCAN_STEPS = 16;
  let lo = base.t;
  let loTry = attempt(lo);
  if (!loTry) throw new PlanError(`L'atterrissage sur ${body.name} échoue (crash ou carburant) près de cette visée.`);
  let hi, hiTry;
  for (let i = 1; i <= SCAN_STEPS; i++) {
    hi = base.t + (i / SCAN_STEPS) * el.period;
    hiTry = attempt(hi);
    if (hiTry && isCrossing(loTry, hiTry)) break;
    lo = hi;
    loTry = hiTry || loTry;
  }
  if (!hiTry || !isCrossing(loTry, hiTry)) {
    throw new PlanError("Impossible de viser ce point sur l'orbite actuelle.");
  }
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    const midTry = attempt(mid);
    if (!midTry) break;
    if (Math.sign(midTry.err) === Math.sign(loTry.err)) {
      lo = mid;
      loTry = midTry;
    } else {
      hi = mid;
      hiTry = midTry;
    }
  }
  const result = Math.abs(loTry.err) < Math.abs(hiTry.err) ? loTry : hiTry;
  if (Math.abs(result.err) >= radians(2)) {
    throw new PlanError(`Visée imprécise (écart ${degrees(Math.abs(result.err)).toFixed(0)}°).`);
  }
  return { c: result.c, nodes: result.nodes, body };
}
