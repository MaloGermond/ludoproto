// Designs de référence (cas de test) : on les construit avec les mêmes
// opérations que l'utilisateur (sections, miroir, étages, moteurs).
import { createDesign, getSection, addSection, setDims, setType, setStage, addStage, setEngine } from "./model.js";

// spec : liste de sections empilées { type, h, wBase, wTop, stage, cap?, engine?: [type,count] }
function stack(config, name, spec, extra = {}) {
  const d = createDesign(config);
  d.name = name;
  d.stageCount = extra.stageCount ?? 1;
  d.payloadMass = extra.payloadMass ?? 0;
  d.mission = extra.mission;
  spec.forEach((p, i) => {
    if (i > 0) {
      const r = addSection(d, config, "top");
      if (!r.ok) throw new Error(`${name}: ${r.reason}`);
    }
    const id = d.selected;
    const s = getSection(d, id);
    s.wBase = p.wBase ?? p.w;
    s.wTop = p.wTop ?? p.w;
    s.h = p.h;
    setType(d, config, id, p.type);
    if (p.cap) s.cap = true;
    setStage(d, id, p.stage ?? 1);
    if (p.engine) setEngine(d, config, id, p.engine[0], p.engine[1]);
  });
  return d;
}

// Boosters latéraux (symétriques) accrochés au flanc de la section de rang `at`.
function withBoosters(config, d, at, spec) {
  d.selected = d.sections[at].id;
  d.symmetry = true;
  const r = addSection(d, config, "right");
  if (!r.ok) throw new Error(r.reason);
  const s = getSection(d, r.section.id);
  s.type = spec.type;
  s.h = spec.h;
  s.wBase = s.wTop = spec.w;
  s.stage = spec.stage;
  if (spec.engine) setEngine(d, config, s.id, spec.engine[0], spec.engine[1]);
  d.symmetry = false;
  return d;
}

export const REFERENCES = {
  missile: {
    label: "Petit missile",
    build(config) {
      return stack(config, "Petit missile", [{ type: "tank_solid", w: 2, h: 6, stage: 1, engine: ["solid", 1] }], { mission: "ballistic" });
    },
  },
  lanceur: {
    label: "Petit lanceur orbital",
    build(config) {
      return stack(
        config,
        "Petit lanceur orbital",
        [
          { type: "tank_kerolox", w: 3, h: 4, stage: 1, engine: ["std", 1] },
          { type: "tank_kerolox", w: 3, h: 3, stage: 2, engine: ["mini", 2] },
          { type: "fairing_basic", wBase: 3, wTop: 2, h: 3, stage: 2, cap: true },
        ],
        { stageCount: 2, payloadMass: 150, mission: "leo" },
      );
    },
  },
  lourd: {
    label: "Lanceur lourd",
    build(config) {
      const d = stack(
        config,
        "Lanceur lourd",
        [
          { type: "tank_kerolox", w: 9, h: 5, stage: 1, engine: ["heavy", 3] },
          { type: "tank_kerolox", w: 9, h: 4, stage: 2, engine: ["std", 3] },
          { type: "tank_hydrolox", w: 6, h: 8, stage: 3, engine: ["hydro", 3] },
          { type: "fairing_advanced", wBase: 6, wTop: 5, h: 6, stage: 3, cap: true },
        ],
        { stageCount: 3, payloadMass: 20000, mission: "leo" },
      );
      return d;
    },
  },
};

export function buildReference(id, config) {
  return REFERENCES[id].build(config);
}
