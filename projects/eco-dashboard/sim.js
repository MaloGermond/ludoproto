// Simulation en masse des stratégies automatiques, sans navigateur.
// Usage : node sim.js [parties=200] [stratégie,stratégie,...]
// ex.   : node sim.js 500 etrangleur,preteur,pirate,equilibre

const G = require("./game.js");
const { STRATEGIES } = require("./strategies.js");

const games = +process.argv[2] || 200;
const bots = Object.keys(STRATEGIES).filter((k) => k !== "humain");
const fixed = process.argv[3] ? process.argv[3].split(",") : null;

const endings = {};
const byStrategy = {};
const loanStatus = {};
let incidents = 0;
let voluntary = 0;
let trades = 0;

const pick = { rng: 12345 };
for (let seed = 1; seed <= games; seed++) {
  const n = fixed ? fixed.length : 3 + (seed % 3);
  // sans liste imposée : tirage reproductible des stratégies
  const strategies = fixed || Array.from({ length: n }, () => bots[Math.floor(G.rand(pick) * bots.length)]);
  const s = G.newGame({ players: n, seed, strategies });
  while (!s.ended) G.endTurn(s);

  endings[s.ended.type] = (endings[s.ended.type] || 0) + 1;
  for (const p of s.players) {
    const st = (byStrategy[p.strategy] ||= { parties: 0, gagne: 0, survit: 0, valeur: 0, gainNet: 0, degatsCauses: 0, degatsSubis: 0 });
    st.parties++;
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
console.log("Fins de partie :", endings);
console.log("Prêts :", loanStatus);
console.log(`Incidents : ${incidents} (${voluntary} volontaires) · achats au marché : ${trades}\n`);
console.table(
  Object.fromEntries(
    Object.entries(byStrategy).map(([k, v]) => [
      STRATEGIES[k].name,
      {
        parties: v.parties,
        "% victoire": Math.round((v.gagne / v.parties) * 100),
        "% survie": Math.round((v.survit / v.parties) * 100),
        "valeur finale": Math.round(v.valeur / v.parties),
        "gain net sur autres": Math.round(v.gainNet / v.parties),
        "dégâts causés": +(v.degatsCauses / v.parties).toFixed(1),
        "dégâts subis": +(v.degatsSubis / v.parties).toFixed(1),
      },
    ])
  )
);
