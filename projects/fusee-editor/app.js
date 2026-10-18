// Éditeur 2D de fusées/vaisseaux — issue #29.
// Branche le modèle (src/model.js) et les calculs (src/calc.js) sur un canvas
// 2D et un panneau DOM. Les données d'équilibrage viennent de config.json.
import { computeStats } from "./src/calc.js";
import { addSection, addStage, bounds, capHeight, copies, createDesign, engineSlots, getSection, maxEngines, removeLastStage, removeSection, setDims, setEngine, setStage, setType } from "./src/model.js";
import { REFERENCES } from "./src/references.js";

const $ = (id) => document.getElementById(id);
const KIND_COLOR = { tank: "#3b82c4", payload: "#3fae6a", structure: "#8a93a6" };
const STAGE_COLOR = ["#ffd479", "#ff8c6b", "#c79bff", "#7be0ff", "#9bffb0"];
const fmt = (n, d = 0) => n.toLocaleString("fr-FR", { maximumFractionDigits: d, minimumFractionDigits: d });
const fmtMass = (kg) => (kg >= 10000 ? `${fmt(kg / 1000, 1)} t` : `${fmt(kg)} kg`);

let config;
let design;
let stats;
let buttons = []; // zones cliquables des « + » (coordonnées écran)
const cv = $("cv");
const ctx = cv.getContext("2d");

async function boot() {
  config = await (await fetch("config.json", { cache: "no-store" })).json();
  design = createDesign(config);
  fillSelects();
  bind();
  refresh();
  window.addEventListener("resize", draw);
}

const unlocked = (tech) => config.unlockedTech.includes(tech);
const lockLabel = (name, tech) => (unlocked(tech) ? name : `🔒 ${name}`);

function fillSelects() {
  $("sel-type").innerHTML = Object.entries(config.sections)
    .map(([id, m]) => `<option value="${id}" ${unlocked(m.tech) ? "" : "disabled"}>${lockLabel(m.name, m.tech)}</option>`)
    .join("");
  $("sel-engine").innerHTML =
    `<option value="">Aucun moteur</option>` +
    Object.entries(config.engines)
      .map(([id, e]) => `<option value="${id}" ${unlocked(e.tech) ? "" : "disabled"}>${lockLabel(`${e.name} (${e.width} case${e.width > 1 ? "s" : ""})`, e.tech)}</option>`)
      .join("");
  $("sel-mission").innerHTML = Object.entries(config.missions)
    .map(([id, m]) => `<option value="${id}">${m.name} — ${fmt(m.dv)} m/s</option>`)
    .join("");
  $("sel-ref").innerHTML = `<option value="">Référence…</option>` + Object.entries(REFERENCES).map(([id, r]) => `<option value="${id}">${r.label}</option>`).join("");
  $("engine-presets").innerHTML = config.engineCounts.map((n) => `<button type="button" data-n="${n}">${n}</button>`).join("");
}

function say(text) {
  $("msg").textContent = text ?? "";
}

function act(result) {
  say(result && result.ok === false ? result.reason : "");
  refresh();
}

function bind() {
  $("btn-sym").onclick = () => ((design.symmetry = !design.symmetry), refresh());
  $("btn-new").onclick = () => ((design = createDesign(config)), refresh());
  $("sel-ref").onchange = (e) => {
    if (e.target.value) design = REFERENCES[e.target.value].build(config);
    e.target.value = "";
    say("");
    refresh();
  };
  $("in-payload").oninput = (e) => ((design.payloadMass = +e.target.value), refresh());
  $("btn-stage-add").onclick = () => (addStage(design), refresh());
  $("btn-stage-del").onclick = () => (removeLastStage(design), refresh());
  $("sel-mission").onchange = (e) => ((design.mission = e.target.value), refresh());
  $("sel-type").onchange = (e) => (setType(design, config, design.selected, e.target.value), refresh());
  $("sel-stage").onchange = (e) => (setStage(design, design.selected, +e.target.value), refresh());
  $("in-h").oninput = (e) => act(setDims(design, config, design.selected, { h: +e.target.value }));
  $("in-wb").oninput = (e) => act(setDims(design, config, design.selected, { wBase: +e.target.value }));
  $("in-wt").oninput = (e) => act(setDims(design, config, design.selected, { wTop: +e.target.value }));
  $("sel-cap").onchange = (e) => ((getSection(design).cap = e.target.value || null), refresh());
  $("sel-engine").onchange = (e) => {
    const s = getSection(design);
    setEngine(design, config, s.id, e.target.value, s.engine?.count || 1);
    refresh();
  };
  $("in-engine").oninput = (e) => {
    const s = getSection(design);
    setEngine(design, config, s.id, s.engine?.type ?? $("sel-engine").value, +e.target.value);
    refresh();
  };
  $("engine-presets").onclick = (e) => {
    const n = +e.target.dataset?.n;
    if (!n) return;
    const s = getSection(design);
    const type = s.engine?.type ?? $("sel-engine").value;
    if (type) setEngine(design, config, s.id, type, n);
    refresh();
  };
  $("btn-del").onclick = () => (removeSection(design), refresh());
  $("stage-list").onclick = (e) => {
    const id = +e.target.closest("[data-id]")?.dataset.id;
    if (!id) return;
    design.selected = id;
    say("");
    refresh();
  };
  cv.addEventListener("click", onCanvasClick);
}

// ─── synchronisation panneau ↔ modèle ──────────────────────────────────────

function refresh() {
  stats = computeStats(design, config);
  const s = getSection(design);
  $("btn-sym").classList.toggle("on", design.symmetry);
  $("in-payload").value = design.payloadMass;
  $("out-payload").textContent = fmtMass(design.payloadMass);
  $("stage-count").textContent = design.stageCount;
  $("btn-stage-del").disabled = design.stageCount <= 1;
  $("sel-mission").value = design.mission;
  $("sel-stage").innerHTML = Array.from({ length: design.stageCount }, (_, i) => `<option value="${i + 1}">Étage ${i + 1}</option>`).join("");
  $("sel-type").value = s.type;
  $("sel-stage").value = s.stage;
  for (const [id, key, label] of [["h", "h", "m"], ["wb", "wBase", "m"], ["wt", "wTop", "m"]]) {
    $(`in-${id}`).value = s[key];
    $(`out-${id}`).textContent = `${s[key]} ${label}`;
  }
  const isPayload = config.sections[s.type].kind === "payload";
  $("sel-cap").disabled = !isPayload;
  $("sel-cap").value = s.cap ?? "";
  $("sel-engine").value = s.engine?.type ?? "";
  $("in-engine").value = s.engine?.count ?? 0;
  const type = s.engine?.type ?? ($("sel-engine").value || null);
  $("in-engine").max = maxEngines(s, config, type ?? undefined);
  const slots = engineSlots(s, config);
  $("engine-info").textContent = `Cases sous la base : ${slots.total} · utilisées ${slots.used} · restantes ${slots.remaining}`;
  renderStageList();
  renderResults();
  draw();
}

function renderStageList() {
  const byStage = new Map();
  for (const s of design.sections) {
    if (!byStage.has(s.stage)) byStage.set(s.stage, []);
    byStage.get(s.stage).push(s);
  }
  let html = "";
  for (let k = 1; k <= design.stageCount; k++) {
    const list = byStage.get(k) ?? [];
    const color = STAGE_COLOR[(k - 1) % STAGE_COLOR.length];
    html += `<div class="stage-row"><span class="stage-tag" style="border-color:${color}">É${k}</span>` +
      (list.length
        ? list.map((s) => `<button type="button" class="block-chip${s.id === design.selected ? " on" : ""}" data-id="${s.id}">${config.sections[s.type].name}</button>`).join("")
        : `<span class="muted">(vide)</span>`) +
      `</div>`;
  }
  $("stage-list").innerHTML = html;
}

function renderResults() {
  const m = stats.mission;
  $("mission-line").innerHTML = m
    ? `Δv obtenu <b>${fmt(stats.dvTotal)} m/s</b> / requis ${fmt(m.dv)} m/s — ` +
      (m.ok ? `<span class="ok">objectif atteint (+${fmt(m.margin)})</span>` : `<span class="bad">${m.margin < 0 ? `il manque ${fmt(-m.margin)} m/s` : "ne décolle pas"}</span>`)
    : "";
  $("tbl-stages").innerHTML =
    `<tr class="muted"><th>Étage</th><th>Δv m/s</th><th>Masse départ</th><th>Poussée/poids</th></tr>` +
    stats.stages.map((st) => `<tr><td style="color:${STAGE_COLOR[(st.index - 1) % STAGE_COLOR.length]}">É${st.index}</td><td>${fmt(st.dv)}</td><td>${fmtMass(st.m0)}</td><td class="${st.twr > 1 || st.index > 1 ? "" : "bad"}">${fmt(st.twr, 2)}</td></tr>`).join("");
  const p = stats.payload;
  $("tbl-total").innerHTML = [
    ["Δv total", `${fmt(stats.dvTotal)} m/s`],
    ["Masse totale", fmtMass(stats.totalMass)],
    ["Masse sèche", fmtMass(stats.dryMass)],
    ["Masse d'ergols", fmtMass(stats.propMass)],
    ["Poussée/poids au décollage", `<span class="${stats.twr0 > 1 ? "ok" : "bad"}">${fmt(stats.twr0, 2)}</span>`],
    ["Volume utile de charge", `${fmt(p.volume, 1)} m³ (≈ ${fmtMass(p.massByVolume)})`],
    ["Charge utile max (mission)", `<span class="${p.mass <= p.maxMassForMission ? "" : "bad"}">${fmtMass(p.maxMassForMission)}</span>`],
    ["Coût total", `${fmt(stats.cost)} k$`],
    ["Δv par k$", fmt(stats.dvPerCost, 2)],
  ].map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join("");
  const w = [...stats.warnings];
  if (!p.fits) w.push(`Charge utile ${fmtMass(p.mass)} > volume disponible (${fmtMass(p.massByVolume)})`);
  $("warnings").innerHTML = w.map((x) => `<p class="warn">⚠ ${x}</p>`).join("");
}

// ─── dessin ────────────────────────────────────────────────────────────────

const GROUND_PAD = 3; // cases sous y=0 pour les tuyères

// vrai si une autre section occupe l'espace juste sous cette copie (moteurs cachés derrière elle)
function isOnTopOfAnother(s, c) {
  return design.sections.some((o) => o.id !== s.id && copies(o).some((oc) => Math.abs(oc.y1 - c.y0) < 1e-6 && oc.x0 < c.x1 - 1e-6 && c.x0 < oc.x1 - 1e-6));
}

function view() {
  const all = design.sections.map(bounds);
  const x0 = Math.min(...all.map((b) => b.x0), -2);
  const x1 = Math.max(...all.map((b) => b.x1), 2);
  const y1 = Math.max(...design.sections.map((s) => s.y + s.h + (s.cap ? capHeight(s) : 0))) + 4;
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  const scale = Math.max(2, Math.min(48, (W - 120) / (x1 - x0 + 4), (H - 60) / (y1 + GROUND_PAD)));
  const ox = W / 2;
  const oy = H - 30 - GROUND_PAD * scale;
  return { scale, X: (x) => ox + x * scale, Y: (y) => oy - y * scale };
}

function sectionPath(c, s, v) {
  // trapèze d'une copie (+ calotte arrondie ou pointe)
  const { X, Y } = v;
  const mod = config.sections[s.type];
  const p = new Path2D();
  p.moveTo(X(c.cx - s.wBase / 2), Y(c.y0));
  p.lineTo(X(c.cx + s.wBase / 2), Y(c.y0));
  p.lineTo(X(c.cx + s.wTop / 2), Y(c.y1));
  if (s.cap === "round" && mod.kind === "payload") {
    p.ellipse(X(c.cx), Y(c.y1), (s.wTop / 2) * v.scale, (s.wTop / 2) * v.scale, 0, 0, -Math.PI, true);
  } else if (s.cap === "point" && mod.kind === "payload") {
    p.lineTo(X(c.cx), Y(c.y1 + capHeight(s)));
    p.lineTo(X(c.cx - s.wTop / 2), Y(c.y1));
  } else {
    p.lineTo(X(c.cx - s.wTop / 2), Y(c.y1));
  }
  p.closePath();
  return p;
}

function draw() {
  if (!design) return;
  const dpr = window.devicePixelRatio || 1;
  cv.width = cv.clientWidth * dpr;
  cv.height = cv.clientHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
  const v = view();
  const { X, Y, scale } = v;
  buttons = [];

  // grille
  ctx.lineWidth = 1;
  ctx.strokeStyle = "rgba(255,255,255,.07)";
  const W = cv.clientWidth;
  const H = cv.clientHeight;
  ctx.beginPath();
  for (let x = Math.ceil((0 - W / 2) / scale); x <= (W / 2) / scale; x++) (ctx.moveTo(X(x), 0), ctx.lineTo(X(x), H));
  for (let y = -GROUND_PAD; y < Y(0) / scale + 2; y++) (ctx.moveTo(0, Y(y)), ctx.lineTo(W, Y(y)));
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.3)";
  ctx.beginPath();
  ctx.moveTo(X(0), 0);
  ctx.lineTo(X(0), H);
  ctx.moveTo(0, Y(0));
  ctx.lineTo(W, Y(0));
  ctx.stroke();

  // moteurs puis sections
  for (const s of design.sections) {
    if (!s.engine) continue;
    const e = config.engines[s.engine.type];
    for (const c of copies(s)) {
      // moteurs masqués par la section du dessous (étage supérieur posé sur un autre) : affichés en transparence
      ctx.globalAlpha = isOnTopOfAnother(s, c) ? 0.3 : 1;
      const total = s.engine.count * e.width;
      const left = c.cx - total / 2;
      for (let i = 0; i < s.engine.count; i++) {
        const ex = left + i * e.width;
        const h = Math.min(2, e.width * 0.8 + 0.5);
        ctx.fillStyle = "#c9ccd6";
        ctx.beginPath();
        ctx.moveTo(X(ex + e.width * 0.25), Y(c.y0));
        ctx.lineTo(X(ex + e.width * 0.75), Y(c.y0));
        ctx.lineTo(X(ex + e.width * 0.95), Y(c.y0 - h));
        ctx.lineTo(X(ex + e.width * 0.05), Y(c.y0 - h));
        ctx.closePath();
        ctx.fill();
      }
    }
  }
  ctx.globalAlpha = 1;
  for (const s of design.sections) {
    const mod = config.sections[s.type];
    const stageColor = STAGE_COLOR[(s.stage - 1) % STAGE_COLOR.length];
    for (const c of copies(s)) {
      const p = sectionPath(c, s, v);
      ctx.fillStyle = KIND_COLOR[mod.kind];
      ctx.fill(p);
      ctx.lineWidth = s.id === design.selected ? 3 : 1.5;
      ctx.strokeStyle = s.id === design.selected ? "#fff" : stageColor;
      ctx.stroke(p);
      ctx.fillStyle = "rgba(0,0,0,.55)";
      ctx.font = `${Math.max(10, Math.min(14, scale * 0.9))}px system-ui`;
      ctx.textAlign = "center";
      ctx.fillText(`É${s.stage}`, X(c.cx), Y((c.y0 + c.y1) / 2) + 4);
    }
  }

  // boutons « + » autour de la section sélectionnée
  const sel = getSection(design);
  const b = bounds(sel);
  const top = copies(sel).sort((a, c) => c.cx - a.cx)[0];
  const midY = (b.y0 + b.y1) / 2;
  const plus = [
    { side: "top", x: X(top.cx), y: Y(b.y1) - 18 },
    { side: "left", x: X(b.x0) - 18, y: Y(midY) },
    { side: "right", x: X(b.x1) + 18, y: Y(midY) },
  ];
  for (const bt of plus) {
    ctx.fillStyle = "rgba(130,255,170,.25)";
    ctx.strokeStyle = "rgba(130,255,170,.8)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bt.x, bt.y, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "16px system-ui";
    ctx.textAlign = "center";
    ctx.fillText("+", bt.x, bt.y + 5.5);
    buttons.push({ ...bt, r: 12 });
  }
}

function onCanvasClick(e) {
  const r = cv.getBoundingClientRect();
  const x = e.clientX - r.left;
  const y = e.clientY - r.top;
  const hit = buttons.find((b) => Math.hypot(b.x - x, b.y - y) <= b.r);
  if (hit) return act(addSection(design, config, hit.side));
  const v = view();
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0); // isPointInPath applique l'inverse du CTM au point testé ; on neutralise le scale dpr du dernier draw() pour comparer en coordonnées CSS brutes, comme le tracé.
  for (const s of [...design.sections].reverse()) {
    for (const c of copies(s)) {
      if (ctx.isPointInPath(sectionPath(c, s, v), x, y)) {
        ctx.restore();
        design.selected = s.id;
        say("");
        return refresh();
      }
    }
  }
  ctx.restore();
}

boot();
