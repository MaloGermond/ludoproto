import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { computeStats, rowWidth, sectionVolume } from "../src/calc.js";
import { addSection, addStage, bounds, createDesign, engineSlots, getSection, removeSection, setDims, setEngine, setStage } from "../src/model.js";
import { REFERENCES } from "../src/references.js";

const dir = path.dirname(fileURLToPath(import.meta.url));
const config = JSON.parse(fs.readFileSync(path.join(dir, "..", "config.json"), "utf8"));
const fresh = () => createDesign(config);

test("on démarre avec un carré", () => {
  const d = fresh();
  assert.equal(d.sections.length, 1);
  assert.equal(d.sections[0].wBase, d.sections[0].h);
});

test("volume : chaque rangée est un disque de sa largeur", () => {
  const s = { h: 3, wBase: 2, wTop: 2, cap: false };
  assert.ok(Math.abs(sectionVolume(s, config.sections.structure) - 3 * Math.PI) < 1e-9);
  const taper = { h: 2, wBase: 4, wTop: 2 };
  assert.equal(rowWidth(taper, 0), 3.5);
  assert.equal(rowWidth(taper, 1), 2.5);
});

test("« + » en haut empile ; sans symétrie un côté seulement", () => {
  const d = fresh();
  assert.ok(addSection(d, config, "top").ok);
  assert.equal(getSection(d).y, 3);
  d.selected = d.sections[0].id;
  const r = addSection(d, config, "right");
  assert.ok(r.ok);
  assert.equal(r.section.mirror, false);
  assert.equal(bounds(r.section).x0, 1.5);
  d.selected = d.sections[0].id;
  assert.ok(!addSection(d, config, "right").ok, "emplacement déjà occupé");
});

test("symétrie : un « + » agit des deux côtés, désactivée un seul", () => {
  const d = fresh();
  d.symmetry = true;
  const r = addSection(d, config, "left");
  assert.ok(r.section.mirror);
  const b = bounds(r.section);
  assert.equal(b.x0, -b.x1);
  const single = fresh();
  addSection(single, config, "left");
  assert.equal(single.sections[1].mirror, false);
  assert.ok(Math.abs(computeStats(d, config).propMass - computeStats(single, config).propMass - computeStats(single, config).propMass + computeStats(fresh(), config).propMass) < 1e-6, "la copie miroir double la section");
});

test("moteurs : limités par la largeur de la base, cases restantes affichées", () => {
  const d = fresh();
  const s = d.sections[0];
  setEngine(d, config, s.id, "mini", 10);
  assert.equal(s.engine.count, 3);
  assert.equal(engineSlots(s, config).remaining, 0);
  setEngine(d, config, s.id, "std", 5);
  assert.equal(s.engine.count, 1);
  assert.equal(engineSlots(s, config).remaining, 1);
  setDims(d, config, s.id, { wBase: 1 });
  assert.equal(s.engine, null, "plus de place : le moteur disparaît");
});

test("delta-v total = somme des étages ; l'étage largué disparaît", () => {
  const d = REFERENCES.lanceur.build(config);
  const st = computeStats(d, config);
  assert.equal(st.stages.length, 2);
  assert.ok(Math.abs(st.dvTotal - st.stages.reduce((a, x) => a + x.dv, 0)) < 1e-9);
  assert.ok(Math.abs(st.stages[1].m0 - (st.stages[0].mf - st.stages[0].dry)) < 1e-6, "m0 de l'étage 2 = masse finale de l'étage 1 sans sa structure");
  const mono = REFERENCES.lanceur.build(config);
  mono.sections.forEach((s) => (s.stage = 1));
  mono.stageCount = 1;
  mono.sections[0].engine = { type: "std", count: 1 };
  mono.sections[1].engine = null;
  assert.ok(computeStats(mono, config).dvTotal < st.dvTotal, "le découplage apporte du delta-v");
});

test("Tsiolkovski : un seul étage", () => {
  const d = fresh();
  setEngine(d, config, d.sections[0].id, "mini", 1);
  const st = computeStats(d, config);
  const s0 = st.stages[0];
  assert.ok(Math.abs(s0.dv - 290 * config.g0 * Math.log(s0.m0 / s0.mf)) < 1e-6);
});

test("poussée/poids ≤ 1 : alerte, mission non validée", () => {
  const d = REFERENCES.lanceur.build(config);
  d.sections[0].engine = { type: "mini", count: 1 };
  const st = computeStats(d, config);
  assert.ok(st.twr0 < 1);
  assert.ok(st.warnings.some((w) => /ne décolle pas/.test(w)));
  assert.equal(st.mission.ok, false);
});

test("coût = somme des modules", () => {
  const d = REFERENCES.missile.build(config);
  const st = computeStats(d, config);
  const s = d.sections[0];
  const expected = sectionVolume(s, config.sections.tank_solid) * config.sections.tank_solid.costPerM3 + config.engines.solid.cost;
  assert.ok(Math.abs(st.cost - expected) < 1e-9);
});

test("types, étages et suppression", () => {
  const d = fresh();
  addSection(d, config, "top");
  addStage(d);
  setStage(d, d.selected, 2);
  assert.equal(getSection(d).stage, 2);
  assert.ok(removeSection(d));
  assert.equal(d.sections.length, 1);
  assert.ok(!removeSection(d), "la dernière section ne se supprime pas");
});

test("designs de référence : objectif atteint avec la config initiale", () => {
  for (const [id, ref] of Object.entries(REFERENCES)) {
    const d = ref.build(config);
    const st = computeStats(d, config);
    assert.ok(st.mission.ok, `${id}: dv ${st.dvTotal.toFixed(0)} / ${st.mission.dv}, TWR ${st.twr0.toFixed(2)}`);
    assert.ok(st.payload.fits, `${id}: la charge utile doit tenir dans la coiffe`);
    assert.deepEqual(st.warnings, [], id);
  }
  const missile = computeStats(REFERENCES.missile.build(config), config);
  assert.equal(missile.stages.length, 1);
  assert.equal(missile.payload.mass, 0);
  assert.equal(computeStats(REFERENCES.lanceur.build(config), config).stages.length, 2);
  assert.ok(computeStats(REFERENCES.lourd.build(config), config).stages.length >= 3);
});
