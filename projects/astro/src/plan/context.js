// ---------------------------------------------------------------------------
// Simulation "hors jeu" : contexte reprenable (état + plan + temps), utilisé
// par la prédiction et par le calculateur de route. Même pas, même code que
// la simulation en direct : résultats identiques au bit près.
// ---------------------------------------------------------------------------

import { autopilotControl, cloneAutopilot, createAutopilot } from "../autopilot/index.js";
import { cloneShip, COAST, SIM_DT, stepShip } from "../sim/index.js";

export function makeCtx(state, t, nodes) {
  return { s: cloneShip(state), t, ap: nodes && nodes.length ? createAutopilot(nodes) : null };
}

export function cloneCtx(c) {
  return { s: cloneShip(c.s), t: c.t, ap: c.ap ? cloneAutopilot(c.ap) : null };
}

export function planDone(ctx) {
  return !ctx.ap || ctx.ap.index >= ctx.ap.nodes.length;
}

// avance le contexte jusqu'à tEnd ; `onStep` peut renvoyer false pour arrêter
export function runCtx(ctx, tEnd, onStep) {
  while (ctx.t < tEnd - 1e-9 && !ctx.s.crashed) {
    const control = ctx.ap ? autopilotControl(ctx.ap, ctx.s, ctx.t) || COAST : COAST;
    stepShip(ctx.s, ctx.t, SIM_DT, control);
    ctx.t += SIM_DT;
    if (onStep && onStep(ctx) === false) break;
  }
  return ctx;
}
