// ---------------------------------------------------------------------------
// Pilote automatique : exécute les manœuvres dans l'ordre chronologique.
// Chaque manœuvre = rotation vers le cap (relatif au prograde au moment où
// elle démarre), puis poussée (puissance × durée). Une manœuvre ne démarre
// qu'une fois la précédente terminée : le temps de rotation décale la suite.
// ---------------------------------------------------------------------------

import {
  angleDiff,
  COAST,
  constrain,
  progradeAngle,
  radians,
  SHIP_SIZE,
  THRUST_ACCEL,
} from "../sim/index.js";

// atterrissage guidé : le moteur s'allume quand la décélération nécessaire
// pour s'arrêter au sol atteint cette fraction de la poussée maximale
// ("suicide burn"), puis la poussée est dosée pour toucher le sol à l'arrêt
export const LANDING_IGNITION = 0.85;
export const LANDING_MAX_TILT = 0.35; // rad — inclinaison max pour annuler la dérive horizontale

// kind : undefined pour une manœuvre classique (rotation + poussée fixe),
// "land" pour un atterrissage guidé
export function copyNode(n) {
  return { id: n.id, kind: n.kind, t: n.t, heading: n.heading, power: n.power, duration: n.duration };
}

export function cloneAutopilot(ap) {
  return { ...ap, nodes: ap.nodes.map((n) => ({ ...n })) };
}

export function createAutopilot(nodes) {
  return {
    nodes: nodes.map(copyNode).sort((a, b) => a.t - b.t),
    index: 0,
    phase: "pending", // "pending" | "rotating" | "burning"
    targetAngle: 0,
    burnEnd: 0,
  };
}

// commande de l'atterrissage guidé : nez vers le haut (incliné pour annuler
// la vitesse horizontale), poussée déclenchée au dernier moment et dosée
// pour que vitesse de descente et altitude s'annulent ensemble
export function landingControl(s) {
  const R = s.ref;
  const r = Math.hypot(s.rx, s.ry);
  const up = Math.atan2(s.ry, s.rx);
  const h = r - (R.radius + SHIP_SIZE / 2);
  const vRadial = (s.rx * s.rvx + s.ry * s.rvy) / r; // < 0 en descente
  const vTangent = (s.rx * s.rvy - s.ry * s.rvx) / r;
  const g = R.mu / (r * r);

  const target = up + constrain(-vTangent * 0.05, -LANDING_MAX_TILT, LANDING_MAX_TILT);
  const descent = Math.max(0, -vRadial);
  const needed = (descent * descent) / (2 * Math.max(h - 1, 0.5)) + g;
  let thrust = 0;
  if (vRadial < 0 && needed > LANDING_IGNITION * THRUST_ACCEL) thrust = Math.min(1, needed / THRUST_ACCEL);
  // pas de poussée tant que le vaisseau n'est pas orienté
  if (Math.abs(angleDiff(s.angle, target)) > 0.3) thrust = 0;
  return { ...COAST, slewTo: target, thrust };
}

export function recordAt(node, key, s, t) {
  node[key + "T"] = t;
  node[key + "Ref"] = s.ref;
  node[key + "X"] = s.rx;
  node[key + "Y"] = s.ry;
}

// fait avancer les phases du plan à l'instant t et renvoie la commande du
// prochain pas, ou null quand le plan est terminé. Note au passage, dans
// chaque manœuvre, où et quand elle a réellement démarré/poussé/fini.
export function autopilotControl(ap, s, t) {
  while (ap.index < ap.nodes.length) {
    const node = ap.nodes[ap.index];

    if (ap.phase === "pending") {
      if (t < node.t) return COAST;
      if (node.kind === "land") {
        ap.phase = "landing";
        node.fuelBefore = s.fuel;
        recordAt(node, "start", s, t);
      } else {
        ap.targetAngle = progradeAngle(s) + radians(node.heading);
      ap.phase = "rotating";
        node.targetAngle = ap.targetAngle;
        node.fuelBefore = s.fuel;
        recordAt(node, "start", s, t);
      }
    }

    if (ap.phase === "landing") {
      if (!s.landed) {
        const control = landingControl(s);
        if (control.thrust > 0 && node.burnStartT === undefined) recordAt(node, "burnStart", s, t);
        return control;
      }
      recordAt(node, "end", s, t);
      node.fuelAfter = s.fuel;
      ap.index++;
      ap.phase = "pending";
      continue;
    }

    if (ap.phase === "rotating") {
      if (angleDiff(s.angle, ap.targetAngle) !== 0) {
        return { ...COAST, slewTo: ap.targetAngle };
      }
      ap.phase = "burning";
      ap.burnEnd = t + node.duration;
      recordAt(node, "burnStart", s, t);
    }

    if (ap.phase === "burning") {
      if (node.power > 0 && t < ap.burnEnd - 1e-9) {
        return { ...COAST, slewTo: ap.targetAngle, thrust: node.power };
      }
      recordAt(node, "end", s, t);
      node.fuelAfter = s.fuel;
      ap.index++;
      ap.phase = "pending";
    }
  }
  return null;
}

// manœuvres pas encore terminées, pour les rééditer en cours d'exécution
export function remainingNodes(ap, t) {
  return ap.nodes.slice(ap.index).map((n, i) => {
    const node = copyNode(n);
    if (i === 0 && ap.phase !== "pending") {
      node.t = t;
      if (ap.phase === "burning") node.duration = Math.max(0, ap.burnEnd - t);
    }
    return node;
  });
}
