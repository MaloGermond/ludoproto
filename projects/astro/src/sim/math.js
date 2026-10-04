// Outils mathématiques de la simulation. PI, constrain, radians et degrees
// reproduisent exactement ceux de p5 1.9.3 (que la simulation utilisait
// jusqu'ici) : mêmes opérations, mêmes résultats au bit près. Ainsi sim/ ne
// dépend de rien, pas même de p5.

export const PI = Math.PI;
export const HALF_PI = PI / 2;
export const TWO_PI = PI * 2;

export const constrain = (n, low, high) => Math.max(Math.min(n, high), low);
export const radians = (angle) => angle * (PI / 180);
export const degrees = (angle) => angle * (180 / PI);

export function angleDiff(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > PI) d -= TWO_PI;
  if (d < -PI) d += TWO_PI;
  return d;
}

export function slewToward(angle, target, maxStep) {
  const d = angleDiff(angle, target);
  if (Math.abs(d) <= maxStep) return target;
  return angle + Math.sign(d) * maxStep;
}
