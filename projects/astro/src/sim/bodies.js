import { G } from "./constants.js";

// ---------------------------------------------------------------------------
// Système solaire — configuration déclarative. Pour ajouter un astre,
// ajouter une entrée ; pour en retirer un, supprimer l'entrée ou mettre
// `enabled: false`. `parent` référence l'id de l'astre autour duquel il
// orbite (null pour l'astre central, fixe). `phase` : position de départ sur
// l'orbite, en degrés. La vitesse orbitale découle de la loi de Kepler.
//
// Espacements et masses choisis pour que les sphères d'influence ne se
// chevauchent pas (vérifié au chargement) et laissent de la place autour de
// chaque astre pour y orbiter.
// ---------------------------------------------------------------------------

// Masses choisies pour que la gravité de surface (g = G·masse/rayon²) varie
// vraiment d'un astre à l'autre, à l'image des écarts réels (une planète
// tellurique dense tire fort, une petite lune est quasi flottante) — avant
// cette passe, masse et rayon avaient été choisis en proportion l'un de
// l'autre pour l'espacement des sphères d'influence, ce qui aplatissait
// g à peu près au même niveau partout. Les géantes gazeuses gardent leur
// masse d'origine : la grossir pour coller à leur vraie gravité ferait
// déborder leur sphère d'influence sur l'orbite de Mars (cf. essais).
export const BODY_CONFIGS = [
  { id: "sun", name: "Soleil", parent: null, radius: 900, mass: 40000, color: [255, 210, 90] },
  { id: "mercury", name: "Mercure", parent: "sun", orbitRadius: 3500, phase: 200, radius: 50, mass: 35, color: [180, 170, 160] },
  { id: "venus", name: "Vénus", parent: "sun", orbitRadius: 6500, phase: 140, radius: 150, mass: 750, color: [230, 200, 140], atmosphere: { height: 130, density: 2.2, color: [235, 210, 150] } },
  { id: "earth", name: "Terre", parent: "sun", orbitRadius: 12000, phase: 0, radius: 220, mass: 1800, color: [90, 140, 200], atmosphere: { height: 150, density: 1, color: [150, 190, 255] } },
  { id: "moon", name: "Lune", parent: "earth", orbitRadius: 2200, phase: 60, radius: 60, mass: 22, color: [180, 180, 180] },
  { id: "mars", name: "Mars", parent: "sun", orbitRadius: 19000, phase: 70, radius: 120, mass: 200, color: [210, 120, 80], atmosphere: { height: 75, density: 0.4, color: [220, 160, 120] } },
  { id: "phobos", name: "Phobos", parent: "mars", orbitRadius: 500, phase: 30, radius: 15, mass: 1, color: [140, 130, 120] },
  { id: "deimos", name: "Déimos", parent: "mars", orbitRadius: 1000, phase: 210, radius: 12, mass: 1, color: [150, 140, 130] },
  { id: "jupiter", name: "Jupiter", parent: "sun", orbitRadius: 36000, phase: 250, radius: 500, mass: 3000, color: [220, 180, 140] },
  { id: "io", name: "Io", parent: "jupiter", orbitRadius: 1900, phase: 0, radius: 45, mass: 14, color: [230, 210, 120] },
  { id: "europa", name: "Europe", parent: "jupiter", orbitRadius: 3600, phase: 90, radius: 40, mass: 8, color: [210, 200, 190] },
  { id: "ganymede", name: "Ganymède", parent: "jupiter", orbitRadius: 6500, phase: 180, radius: 55, mass: 16, color: [160, 150, 140] },
  { id: "callisto", name: "Callisto", parent: "jupiter", orbitRadius: 10500, phase: 270, radius: 50, mass: 12, color: [120, 110, 100] },
  { id: "saturn", name: "Saturne", parent: "sun", orbitRadius: 68000, phase: 320, radius: 420, mass: 1500, color: [230, 210, 160] },
  { id: "titan", name: "Titan", parent: "saturn", orbitRadius: 6000, phase: 45, radius: 65, mass: 22, color: [220, 180, 110], atmosphere: { height: 65, density: 1.3, color: [210, 160, 90] } },
  { id: "uranus", name: "Uranus", parent: "sun", orbitRadius: 108000, phase: 30, radius: 260, mass: 600, color: [160, 220, 230] },
  { id: "titania", name: "Titania", parent: "uranus", orbitRadius: 5500, phase: 120, radius: 35, mass: 2, color: [180, 190, 195] },
  { id: "neptune", name: "Neptune", parent: "sun", orbitRadius: 160000, phase: 170, radius: 250, mass: 600, color: [100, 140, 230] },
  // orbite rétrograde (comme dans la réalité) : vitesse de Kepler forcée en négatif
  { id: "triton", name: "Triton", parent: "neptune", orbitRadius: 6500, orbitSpeed: -0.00132, phase: 80, radius: 40, mass: 5, color: [230, 220, 210] },
];

export const ALL_BODIES = BODY_CONFIGS.filter((c) => c.enabled !== false).map((c) => ({ ...c, x: 0, y: 0, vx: 0, vy: 0, children: [] }));
export const bodyById = Object.fromEntries(ALL_BODIES.map((b) => [b.id, b]));
for (const b of ALL_BODIES) {
  b.mu = G * b.mass;
  b.parentBody = b.parent ? bodyById[b.parent] : null;
  if (b.atmosphere) b.atmosphere.scaleHeight = b.atmosphere.height / 5;
}
for (const b of ALL_BODIES) {
  if (!b.parentBody) {
    b.soi = Infinity;
    continue;
  }
  b.parentBody.children.push(b);
  b.orbitSpeed = b.orbitSpeed ?? Math.sqrt(b.parentBody.mu / Math.pow(b.orbitRadius, 3));
  b.phase0 = ((b.phase || 0) * Math.PI) / 180;
  // sphère d'influence par rapport au parent (formule patched-conics)
  b.soi = b.orbitRadius * Math.pow(b.mass / b.parentBody.mass, 2 / 5);
}
// avertit si deux sphères d'influence voisines se chevauchent
for (const b of ALL_BODIES) {
  const kids = [...b.children].sort((a, c) => a.orbitRadius - c.orbitRadius);
  for (let i = 1; i < kids.length; i++) {
    if (kids[i - 1].orbitRadius + kids[i - 1].soi > kids[i].orbitRadius - kids[i].soi) {
      console.warn(`Sphères d'influence qui se chevauchent : ${kids[i - 1].name} / ${kids[i].name}`);
    }
  }
  if (b.parentBody && kids.length && kids[kids.length - 1].orbitRadius + kids[kids.length - 1].soi > b.soi) {
    console.warn(`${kids[kids.length - 1].name} sort de la sphère d'influence de ${b.name}`);
  }
}

export const sun = ALL_BODIES.find((b) => !b.parentBody);
export const planet = bodyById.earth; // astre de départ du vaisseau

// ---------------------------------------------------------------------------
// Astres : positions en fonction du temps de jeu (orbites circulaires "sur
// rails", comme dans KSP)
// ---------------------------------------------------------------------------

// position/vitesse d'un astre relativement à son parent
export function localOrbit(body, t) {
  const a = body.phase0 + body.orbitSpeed * t;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const r = body.orbitRadius;
  const w = body.orbitSpeed;
  return { x: r * c, y: r * s, vx: -r * w * s, vy: r * w * c };
}

export function bodyPositionAt(body, t) {
  if (!body.parentBody) return { x: 0, y: 0 };
  const p = bodyPositionAt(body.parentBody, t);
  const o = localOrbit(body, t);
  return { x: p.x + o.x, y: p.y + o.y };
}

export function bodyVelocityAt(body, t) {
  if (!body.parentBody) return { vx: 0, vy: 0 };
  const p = bodyVelocityAt(body.parentBody, t);
  const o = localOrbit(body, t);
  return { vx: p.vx + o.vx, vy: p.vy + o.vy };
}

// met à jour la position/vitesse affichée de chaque astre à l'instant t
export function bodies(t) {
  for (const body of ALL_BODIES) {
    const pos = bodyPositionAt(body, t);
    const vel = bodyVelocityAt(body, t);
    body.x = pos.x;
    body.y = pos.y;
    body.vx = vel.vx;
    body.vy = vel.vy;
  }
  return ALL_BODIES;
}

export function isAncestorOrSelf(ancestor, body) {
  for (let b = body; b; b = b.parentBody) if (b === ancestor) return true;
  return false;
}
