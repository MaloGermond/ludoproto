// Calculs de performance : volumes, masses, delta-v (Tsiolkovski), poussée/poids,
// coût. Formules provisoires, tous les paramètres viennent de config.json.
import { copies, copyCount } from "./model.js";

// Largeur d'une rangée de la grille : interpolation base → haut, mesurée au
// milieu de la rangée.
export function rowWidth(s, row) {
  return s.wBase + (s.wTop - s.wBase) * ((row + 0.5) / s.h);
}

// Volume d'une copie : chaque rangée (hauteur 1) est un disque de sa largeur.
export function sectionVolume(s, mod) {
  let v = 0;
  for (let row = 0; row < s.h; row++) {
    const w = rowWidth(s, row);
    v += Math.PI * (w / 2) ** 2;
  }
  // coiffe arrondie : demi-ellipsoïde posé sur la dernière rangée
  if (s.cap && mod.kind === "payload") {
    const r = s.wTop / 2;
    v += (2 / 3) * Math.PI * r ** 3 * (mod.roundBonus ?? 1);
  }
  return v;
}

// Masse + coût d'une section (toutes copies comprises).
export function sectionStats(s, config) {
  const mod = config.sections[s.type];
  const n = copyCount(s);
  const volume = sectionVolume(s, mod) * n;
  const dry = volume * mod.dryDensity;
  const prop = mod.kind === "tank" ? volume * mod.usableFraction * mod.propDensity : 0;
  const usable = mod.kind === "payload" ? volume * mod.usableFraction : 0;
  let cost = volume * mod.costPerM3;
  let engineMass = 0;
  let thrust = 0;
  let engineCount = 0;
  let isp = 0;
  if (s.engine) {
    const e = config.engines[s.engine.type];
    engineCount = s.engine.count * n;
    engineMass = engineCount * e.mass;
    thrust = engineCount * e.thrust;
    isp = e.isp;
    cost += engineCount * e.cost;
  }
  return { mod, volume, dry: dry + engineMass, structDry: dry, prop, usable, cost, engineMass, thrust, engineCount, isp };
}

export function computeStats(design, config, { skipCapacity = false } = {}) {
  const g0 = config.g0;
  const secs = design.sections.map((s) => ({ s, st: sectionStats(s, config) }));
  const payloadMass = design.payloadMass;
  const warnings = [];

  const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
  const totalProp = sum(secs, (x) => x.st.prop);
  const totalDry = sum(secs, (x) => x.st.dry) + payloadMass;
  const totalMass = totalDry + totalProp;
  const cost = sum(secs, (x) => x.st.cost);

  const payloadVolume = sum(secs, (x) => x.st.usable);
  const payloadByVolume = payloadVolume * config.payloadDensity;

  const stages = [];
  for (let k = 1; k <= design.stageCount; k++) {
    const mine = secs.filter((x) => x.s.stage === k);
    const carried = secs.filter((x) => x.s.stage >= k);
    const prop = sum(mine, (x) => x.st.prop);
    const thrust = sum(mine, (x) => x.st.thrust);
    const m0 = sum(carried, (x) => x.st.dry + x.st.prop) + payloadMass;
    const mf = m0 - prop;
    // Isp moyenne pondérée par la poussée : F / Σ(F_i / Isp_i)
    const flow = sum(mine, (x) => (x.st.isp > 0 ? x.st.thrust / x.st.isp : 0));
    const isp = flow > 0 ? thrust / flow : 0;
    const dv = isp > 0 && prop > 0 && mf > 0 ? isp * g0 * Math.log(m0 / mf) : 0;
    const twr = m0 > 0 ? thrust / (m0 * g0) : 0;
    const stageCost = sum(mine, (x) => x.st.cost);
    if (mine.length && prop > 0 && thrust === 0) warnings.push(`Étage ${k} : ergols sans moteur`);
    if (thrust > 0 && prop === 0) warnings.push(`Étage ${k} : moteurs sans ergols`);
    const tankProps = new Set(mine.filter((x) => x.st.mod.kind === "tank").map((x) => x.st.mod.propellant));
    const engProps = new Set(mine.filter((x) => x.s.engine).map((x) => config.engines[x.s.engine.type].propellant));
    for (const p of engProps) {
      if (tankProps.size && !tankProps.has(p)) warnings.push(`Étage ${k} : moteur ${p} sans réservoir ${p}`);
    }
    stages.push({ index: k, sections: mine.length, m0, mf, prop, dry: sum(mine, (x) => x.st.dry), thrust, isp, dv, twr, cost: stageCost });
  }

  const dvTotal = sum(stages, (st) => st.dv);
  const twr0 = stages.length && totalMass > 0 ? stages[0].thrust / (totalMass * g0) : 0;
  if (stages[0] && stages[0].thrust === 0) warnings.push("Étage 1 sans moteur : décollage impossible");
  else if (twr0 <= 1) warnings.push(`Poussée/poids ${twr0.toFixed(2)} ≤ 1 : l'engin ne décolle pas`);

  const mission = config.missions[design.mission];
  const missionInfo = mission
    ? { id: design.mission, name: mission.name, dv: mission.dv, margin: dvTotal - mission.dv, ok: dvTotal >= mission.dv && twr0 > 1 }
    : null;

  return {
    stages,
    dvTotal,
    totalMass,
    dryMass: totalDry,
    propMass: totalProp,
    twr0,
    cost,
    dvPerCost: cost > 0 ? dvTotal / cost : 0,
    payload: {
      mass: payloadMass,
      volume: payloadVolume,
      massByVolume: payloadByVolume,
      maxMassForMission: mission && !skipCapacity ? maxPayloadForDv(design, config, mission.dv) : 0,
      fits: payloadMass <= payloadByVolume + 1e-9,
    },
    mission: missionInfo,
    warnings,
  };
}

// Charge utile maximale (kg) qui permet encore d'atteindre un delta-v donné.
export function maxPayloadForDv(design, config, dvTarget) {
  const dvAt = (m) => computeStats({ ...design, payloadMass: m }, config, { skipCapacity: true }).dvTotal;
  if (dvAt(0) < dvTarget) return 0;
  let lo = 0;
  let hi = 1000;
  while (dvAt(hi) >= dvTarget && hi < 1e8) hi *= 2;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (dvAt(mid) >= dvTarget) lo = mid;
    else hi = mid;
  }
  return lo;
}
