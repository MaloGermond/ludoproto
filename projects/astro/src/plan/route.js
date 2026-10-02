// ---------------------------------------------------------------------------
// Calculateur de route : choisir un astre et une altitude, il construit les
// manœuvres pour s'y mettre en orbite circulaire.
//
// Déroulé (chaque étape se termine en orbite circulaire) :
//  1. décollage vertical puis circularisation à l'apogée (si posé) ;
//  2. remontée vers l'astre parent tant que la destination n'est pas dans
//     la même famille (ex : Lune → Terre) ;
//  3. transfert de Hohmann vers la destination (fenêtre de tir calculée
//     d'après les positions des astres), avec évasion si besoin ;
//  4. correction à mi-parcours (recherche numérique sur la trajectoire
//     simulée) pour passer exactement à l'altitude visée ;
//  5. circularisation au périastre, puis petites corrections.
// ---------------------------------------------------------------------------

import { isAncestorOrSelf, orbitElements, THRUST_ACCEL } from "../sim/index.js";
import { maxOrbitRadius, parkingRadius, PlanError } from "./burns.js";
import { makeCtx } from "./context.js";
import { legAcross, legAltitude, legDown, legLaunch, legStabilize, legUp } from "./legs.js";

// étapes du trajet dans l'arbre des astres, de C vers B
export function routeLegs(C, B) {
  const legs = [];
  let lca = C;
  while (!isAncestorOrSelf(lca, B)) lca = lca.parentBody;

  let cur = C;
  if (B === lca) {
    while (cur !== B) {
      legs.push({ type: "up", to: cur.parentBody });
      cur = cur.parentBody;
    }
    return legs;
  }
  const down = [];
  for (let b = B; b !== lca; b = b.parentBody) down.unshift(b);
  while (cur !== lca && cur.parentBody !== lca) {
    legs.push({ type: "up", to: cur.parentBody });
    cur = cur.parentBody;
  }
  if (cur === lca) legs.push({ type: "down", to: down[0] });
  else legs.push({ type: "across", to: down[0] });
  for (let i = 1; i < down.length; i++) legs.push({ type: "down", to: down[i] });
  return legs;
}

export function planRoute(ship, t, target, altitude) {
  if (ship.crashed) throw new PlanError("Vaisseau détruit — [R] pour relancer.");
  const rt = target.radius + altitude;
  if (altitude < 10) throw new PlanError("Altitude trop basse (minimum 10).");
  if (rt > maxOrbitRadius(target)) {
    throw new PlanError(`Altitude trop haute pour ${target.name} (max ${Math.floor(maxOrbitRadius(target) - target.radius)}).`);
  }

  const nodes = [];
  let ctx = makeCtx(ship, t, null);
  const home = ctx.s.ref;
  if (ctx.s.landed) ctx = legLaunch(ctx, home === target ? rt : parkingRadius(home), nodes);
  else ctx = legStabilize(ctx, nodes);

  const legs = routeLegs(ctx.s.ref, target);
  if (!legs.length) ctx = legAltitude(ctx, rt, nodes);
  else if (Math.hypot(ctx.s.rx, ctx.s.ry) < parkingRadius(ctx.s.ref) * 0.9) {
    // orbite trop basse pour un départ propre : remonte à l'orbite de parking
    ctx = legAltitude(ctx, parkingRadius(ctx.s.ref), nodes);
  }
  legs.forEach((leg, i) => {
    const r = i === legs.length - 1 ? rt : parkingRadius(leg.to);
    if (leg.type === "up") ctx = legUp(ctx, r, nodes);
    else if (leg.type === "down") ctx = legDown(ctx, leg.to, r, nodes);
    else ctx = legAcross(ctx, leg.to, r, nodes);
    if (ctx.s.ref !== leg.to) throw new PlanError(`Capture autour de ${leg.to.name} manquée.`);
  });
  return { nodes, final: ctx };
}

// route complète et son résumé (Δv total, orbite obtenue à l'arrivée) ;
// lève une PlanError si la destination est inaccessible
export function computeRoute(ship, t, target, altitude) {
  const { nodes, final } = planRoute(ship, t, target, altitude);
  const dv = nodes.reduce((sum, n) => sum + n.power * n.duration * THRUST_ACCEL, 0);
  const el = orbitElements(final.s);
  return { nodes, final, dv, periapsis: el.periapsis - target.radius, apoapsis: el.apoapsis - target.radius };
}
