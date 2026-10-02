// Mise en forme partagée par le rendu et l'interface.

import { THRUST_ACCEL } from "../sim/index.js";

export function formatT(t, now) {
  const dt = t - now;
  if (Math.abs(dt) < 600) return `T+${dt.toFixed(1)} s`;
  return `T+${Math.floor(dt / 60)} min ${Math.round(dt % 60)} s`;
}

export function nodeDeltaV(n, predicted) {
  if (n.kind === "land") return predicted && predicted.fuelAfter !== undefined ? predicted.fuelBefore - predicted.fuelAfter : 0;
  return THRUST_ACCEL * n.power * n.duration;
}
