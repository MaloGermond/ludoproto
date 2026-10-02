// Vérifie qu'aucune techno n'exige une ressource rare qu'on ne peut obtenir
// qu'après l'avoir découverte (blocage impossible à résoudre).
// Usage : node check-tree.js
const G = require("./game.js");
const { TECHS, ZONES, INFRA } = G;

const closure = (t, acc = new Set()) => {
  for (const p of TECHS[t].prereqs) if (!acc.has(p)) closure(p, acc.add(p));
  return acc;
};
// technos nécessaires pour obtenir une rare : accès à la zone + extracteur
// (les ergols viennent aussi de la raffinerie d'hydrocarbures, sur Terre)
function sources(rare) {
  const out = [];
  if (rare === "ergols") out.push([INFRA.raffinerie.tech]);
  for (const z of ZONES) if (z.yield[rare]) out.push([z.reachTech, INFRA.extracteur.tech].filter(Boolean));
  return out;
}
let problems = 0;
for (const t in TECHS) {
  for (const r in TECHS[t].rare || {}) {
    const ok = sources(r).some((techs) => techs.every((x) => x !== t && !closure(x).has(t)));
    if (!ok) {
      problems++;
      console.log(`✗ ${t} (${TECHS[t].name}) exige ${r}, inaccessible sans elle`);
    }
  }
}
console.log(problems ? `${problems} blocage(s)` : "✓ aucun blocage dans l'arbre");
process.exit(problems ? 1 : 0);
