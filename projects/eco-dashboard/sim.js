// Simulation en masse des stratégies automatiques, sans navigateur.
// Usage : node sim.js [parties=200] [stratégie,stratégie,...]
// ex.   : node sim.js 500 etrangleur,preteur,pirate,equilibre
//         node sim.js 100 equilibre,specialiste,preteur,specialiste   (table coopérative)

const G = require("./game.js");
const { STRATEGIES, POSTURE } = require("./strategies.js");

const games = +process.argv[2] || 200;
const bots = Object.keys(STRATEGIES).filter((k) => k !== "humain");
const fixed = process.argv[3] ? process.argv[3].split(",") : null;

const endings = {};
const causes = {};
const byStrategy = {};
const loanStatus = {};
const ages = { mid: [], late: [] };
const threat = { projectiles: 0, deviations: 0, impacts: 0, survivedImpact: 0, fleets: 0, cloaked: 0 };
const projects = { lancés: 0, achevés: 0, promessesNonTenues: 0 };
let incidents = 0;
let voluntary = 0;
let trades = 0;
let techs = 0;
let players = 0;

const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : "—");
const pick = { rng: 12345 };
for (let seed = 1; seed <= games; seed++) {
  const n = fixed ? fixed.length : 3 + (seed % 3);
  // sans liste imposée : tirage reproductible des stratégies
  const strategies = fixed || Array.from({ length: n }, () => bots[Math.floor(G.rand(pick) * bots.length)]);
  const s = G.newGame({ players: n, seed, strategies });
  while (!s.ended && s.turn < G.CONFIG.simSafetyCap) G.endTurn(s);
  // plus de limite de temps côté jeu : si même le plafond de sécurité est
  // atteint sans fin naturelle, c'est une partie bloquée (stats seulement)
  if (!s.ended) s.ended = { type: "plafond sécurité", text: "Plafond de sécurité atteint sans fin naturelle.", winners: [] };

  endings[s.ended.type] = (endings[s.ended.type] || 0) + 1;
  if (s.ended.type === "collective") {
    const cause = !s.sunDestroyed && s.planet <= 0 ? "planète polluée" : "anéantis par la forêt sombre";
    causes[cause] = (causes[cause] || 0) + 1;
  }
  for (const a of ["mid", "late"]) if (s.ageTurns[a]) ages[a].push(s.ageTurns[a]);
  threat.projectiles += s.projectiles;
  threat.deviations += s.deviations;
  threat.impacts += s.sunDestroyed ? 1 : 0;
  threat.survivedImpact += s.sunDestroyed && G.activePlayers(s).length ? 1 : 0;
  threat.fleets += s.fleets;
  threat.cloaked += s.darkForestCloaked ? 1 : 0;
  projects.lancés += s.projects.length;
  projects.achevés += s.projects.filter((p) => p.status === "achevé").length;
  projects.promessesNonTenues += s.log.filter((l) => l.type === "trahison").length;

  for (const p of s.players) {
    players++;
    techs += p.techs.length;
    const st = (byStrategy[p.strategy] ||= { parties: 0, gagne: 0, survit: 0, valeur: 0, gainNet: 0, degatsCauses: 0, degatsSubis: 0, techs: 0 });
    st.parties++;
    st.techs += p.techs.length;
    if (s.ended.winners.includes(p.id)) st.gagne++;
    if (G.isActive(p)) st.survit++;
    st.valeur += G.equity(s, p);
    for (const o of s.players) {
      st.gainNet += s.rel[o.id][p.id].paid - s.rel[p.id][o.id].paid;
      st.degatsCauses += s.rel[p.id][o.id].damage;
      st.degatsSubis += s.rel[o.id][p.id].damage;
    }
  }
  for (const l of s.loans) loanStatus[l.status] = (loanStatus[l.status] || 0) + 1;
  const conflicts = s.log.filter((l) => l.type === "conflit");
  incidents += conflicts.length;
  voluntary += conflicts.filter((l) => l.text.includes("volontairement")).length;
  trades += s.trades.length;
}

console.log(`${games} parties\n`);
console.log("Fins de partie :", endings, "· causes des défaites collectives :", causes);
console.log(`Âges : mid atteint dans ${ages.mid.length} parties (tour moyen ${avg(ages.mid)}), late dans ${ages.late.length} (tour moyen ${avg(ages.late)}) · ${Math.round(techs / players)} technos par joueur en moyenne`);
console.log("Forêt sombre :", threat);
console.log("Projets communs :", projects);
console.log("Prêts :", loanStatus);
console.log(`Incidents : ${incidents} (${voluntary} volontaires) · achats au marché : ${trades}\n`);
console.table(
  Object.fromEntries(
    Object.entries(byStrategy).map(([k, v]) => [
      STRATEGIES[k].name,
      {
        posture: POSTURE[k],
        parties: v.parties,
        "% victoire": Math.round((v.gagne / v.parties) * 100),
        "% survie": Math.round((v.survit / v.parties) * 100),
        technos: Math.round(v.techs / v.parties),
        "valeur finale": Math.round(v.valeur / v.parties),
        "gain net sur autres": Math.round(v.gainNet / v.parties),
        "dégâts causés": +(v.degatsCauses / v.parties).toFixed(1),
        "dégâts subis": +(v.degatsSubis / v.parties).toFixed(1),
      },
    ])
  )
);
