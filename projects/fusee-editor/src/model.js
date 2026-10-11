// Modèle de données de l'éditeur : un design est une liste de sections
// (trapèzes alignés sur la grille) + des moteurs sous leur base.
// Aucune dépendance au DOM : tout est testable sous Node.

export const MIN_SIZE = 1;
export const MAX_SIZE = 30;

export function sectionWidth(s) {
  return Math.max(s.wBase, s.wTop);
}

// Rectangles englobants de la section (une copie, ou deux si miroir).
// Une section "centrée" est posée sur l'axe vertical ; sinon `x` est le bord
// gauche de la copie de droite (la copie miroir est symétrique).
export function copies(s) {
  const w = sectionWidth(s);
  const base = s.anchor === "c" ? -w / 2 : s.x;
  const list = [{ x0: base, x1: base + w }];
  if (s.mirror && s.anchor !== "c") list.push({ x0: -(base + w), x1: -base });
  return list.map((c) => ({ ...c, cx: (c.x0 + c.x1) / 2, y0: s.y, y1: s.y + s.h }));
}

export function bounds(s) {
  const c = copies(s);
  return {
    x0: Math.min(...c.map((r) => r.x0)),
    x1: Math.max(...c.map((r) => r.x1)),
    y0: s.y,
    y1: s.y + s.h,
  };
}

export function copyCount(s) {
  return s.mirror && s.anchor !== "c" ? 2 : 1;
}

function overlaps(a, b) {
  const eps = 1e-6;
  return a.x0 < b.x1 - eps && b.x0 < a.x1 - eps && a.y0 < b.y1 - eps && b.y0 < a.y1 - eps;
}

function collides(design, candidate, ignoreId = null) {
  const mine = copies(candidate);
  return design.sections.some((o) => o.id !== ignoreId && copies(o).some((c) => mine.some((m) => overlaps(c, m))));
}

export function createDesign(config) {
  const first = makeSection(1, config, { type: "tank_kerolox", h: 3, wBase: 3, wTop: 3 });
  return {
    nextId: 2,
    symmetry: false,
    stageCount: 1,
    payloadMass: 0,
    mission: "leo",
    selected: 1,
    sections: [first],
  };
}

function makeSection(id, config, patch) {
  return {
    id,
    type: Object.keys(config.sections)[0],
    h: 3,
    wBase: 3,
    wTop: 3,
    cap: false,
    stage: 1,
    anchor: "c",
    x: 0,
    y: 0,
    mirror: false,
    engine: null, // { type, count }
    ...patch,
  };
}

export function getSection(design, id = design.selected) {
  return design.sections.find((s) => s.id === id) ?? null;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const snap = (v) => Math.round(v);

// ─── ajout de sections ("+") ────────────────────────────────────────────────

export function addSection(design, config, side) {
  const sel = getSection(design);
  if (!sel) return { ok: false, reason: "Aucune section sélectionnée" };
  const b = bounds(sel);
  const id = design.nextId;
  const patch = { stage: sel.stage, type: sel.type === "fairing_basic" ? "structure" : sel.type };
  let s;
  if (side === "top") {
    s = makeSection(id, config, {
      ...patch,
      h: sel.h,
      wBase: sel.wTop,
      wTop: sel.wTop,
      anchor: sel.anchor,
      x: sel.x,
      mirror: sel.mirror,
      y: sel.y + sel.h,
    });
  } else {
    const w = Math.max(MIN_SIZE, sel.h > 0 ? Math.round(sectionWidth(sel)) : 3);
    const base = { ...patch, h: sel.h, wBase: w, wTop: w, y: sel.y, anchor: "x" };
    if (design.symmetry) {
      // les deux côtés à la fois : on pose la copie de droite, le miroir suit
      s = makeSection(id, config, { ...base, x: b.x1, mirror: true });
    } else if (side === "right") {
      s = makeSection(id, config, { ...base, x: b.x1 });
    } else {
      s = makeSection(id, config, { ...base, x: b.x0 - w });
    }
  }
  const lim = config.limits;
  const nb = bounds(s);
  if (nb.y1 > lim.gridHeight || nb.x1 > lim.gridWidth / 2 || nb.x0 < -lim.gridWidth / 2) {
    return { ok: false, reason: "Limite de la grille atteinte" };
  }
  if (collides(design, s)) return { ok: false, reason: "Emplacement occupé" };
  design.nextId += 1;
  design.sections.push(s);
  design.selected = s.id;
  return { ok: true, section: s };
}

export function removeSection(design, id = design.selected) {
  if (design.sections.length <= 1) return false;
  const doomed = getSection(design, id);
  if (!doomed) return false;
  // on retire aussi ce qui reposait dessus (sinon il flotterait)
  const gone = new Set([id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const s of design.sections) {
      if (gone.has(s.id)) continue;
      const sb = bounds(s);
      const resting = design.sections.some((o) => {
        if (!gone.has(o.id)) return false;
        const ob = bounds(o);
        return Math.abs(sb.y0 - ob.y1) < 1e-6 && sb.x0 < ob.x1 && ob.x0 < sb.x1;
      });
      if (resting) {
        gone.add(s.id);
        grew = true;
      }
    }
  }
  if (gone.size >= design.sections.length) gone.clear(), gone.add(id);
  design.sections = design.sections.filter((s) => !gone.has(s.id));
  design.selected = design.sections[design.sections.length - 1].id;
  return true;
}

// ─── édition ────────────────────────────────────────────────────────────────

export function setDims(design, config, id, dims) {
  const s = getSection(design, id);
  if (!s) return { ok: false, reason: "Section introuvable" };
  const next = { ...s };
  if (dims.h != null) next.h = clamp(snap(dims.h), MIN_SIZE, MAX_SIZE * 3);
  if (dims.wBase != null) next.wBase = clamp(snap(dims.wBase), MIN_SIZE, MAX_SIZE);
  if (dims.wTop != null) next.wTop = clamp(snap(dims.wTop), MIN_SIZE, MAX_SIZE);
  // le bord collé à ses voisins reste fixe quand la largeur change
  if (next.anchor === "x") {
    const dw = sectionWidth(next) - sectionWidth(s);
    if (!next.mirror && s.x + sectionWidth(s) <= 0) next.x = s.x - dw; // côté gauche : bord droit fixe
  }
  if (collides(design, next, id)) return { ok: false, reason: "Collision avec une autre section" };
  Object.assign(s, next);
  clampEngine(s, config);
  return { ok: true };
}

export function setType(design, config, id, type) {
  const s = getSection(design, id);
  if (!s || !config.sections[type]) return;
  s.type = type;
  if (config.sections[type].kind !== "payload") s.cap = false;
}

export function setStage(design, id, stage) {
  const s = getSection(design, id);
  if (!s) return;
  s.stage = clamp(Math.round(stage), 1, design.stageCount);
}

export function addStage(design) {
  design.stageCount += 1;
  return design.stageCount;
}

export function removeLastStage(design) {
  if (design.stageCount <= 1) return false;
  for (const s of design.sections) if (s.stage >= design.stageCount) s.stage = design.stageCount - 1;
  design.stageCount -= 1;
  return true;
}

// ─── moteurs ────────────────────────────────────────────────────────────────

export function engineSlots(s, config) {
  const used = s.engine ? s.engine.count * config.engines[s.engine.type].width : 0;
  const total = Math.floor(s.wBase);
  return { total, used, remaining: total - used };
}

export function maxEngines(s, config, type = s.engine?.type) {
  if (!type) return 0;
  return Math.min(config.limits.maxEngines, Math.floor(Math.floor(s.wBase) / config.engines[type].width));
}

function clampEngine(s, config) {
  if (!s.engine) return;
  s.engine.count = Math.min(s.engine.count, maxEngines(s, config));
  if (s.engine.count <= 0) s.engine = null;
}

export function setEngine(design, config, id, type, count) {
  const s = getSection(design, id);
  if (!s) return;
  if (!type || count <= 0) {
    s.engine = null;
    return;
  }
  s.engine = { type, count: Math.min(Math.max(1, Math.round(count)), maxEngines(s, config, type)) };
  clampEngine(s, config);
}
