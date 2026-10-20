// Interface du simulateur : panneau d'édition à gauche, planète au centre,
// jauges et courbes en dessous. Le modèle vit dans sim.js.

const state = {
  fixed: { ...FIXED_DEFAULTS },
  initial: { ...DYNAMIC_DEFAULTS },
  factories: 0,
  sim: { ...DYNAMIC_DEFAULTS },
  year: 0,
  history: [],
  playing: true,
  speed: 20,
};
const coeffs = coeffValues();
const HISTORY_MAX = 600;

const $ = (id) => document.getElementById(id);

// 1 unité de concentration normalisée (0–1) du modèle ≈ 10 000 ppm — calibré pour que les
// valeurs usuelles restent lisibles (CO2 initial ~0.02 → 200 ppm, proche du pré-industriel
// réel ; seuil toxique 0.3 → 3 000 ppm, dans l'ordre de grandeur des seuils de toxicité du
// CO2 pour l'humain). Appliqué pareil au CO2 et à la vapeur d'eau (H2O gazeux), pour rester
// cohérent entre les deux gaz traces.
const PPM_PER_UNIT = 10000;
const ppm = (v) => `${Math.round(v * PPM_PER_UNIT).toLocaleString("fr-FR")} ppm`;

// 1 unité d'H2O normalisée (water = 1) ≈ l'hydrosphère terrestre totale (océans + glace +
// vapeur, tous réservoirs confondus, ~1,386 milliard de km³). Les fractions dérivées
// (océans/glace, déjà exprimées à cette même échelle via `water`) se convertissent donc
// directement en volume réel par simple multiplication.
const EARTH_HYDROSPHERE_KM3 = 1.386e9;
const waterVolume = (fractionOfEarth) => {
  const km3 = fractionOfEarth * EARTH_HYDROSPHERE_KM3;
  if (km3 >= 1e6) return `${(km3 / 1e6).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} M km³`;
  return `${Math.round(km3).toLocaleString("fr-FR")} km³`;
};

// ---------- panneau ----------

// Crée un curseur ; `onChange` reçoit la valeur numérique.
function addSlider(parent, { label, value, min, max, step, format }, onChange) {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const out = document.createElement("output");
  const input = document.createElement("input");
  Object.assign(input, { type: "range", min, max, step, value });
  const fmt = format || ((v) => String(+v.toFixed(4)));
  wrap.append(label + " ", out, input);
  out.textContent = fmt(value);
  input.addEventListener("input", () => {
    out.textContent = fmt(+input.value);
    onChange(+input.value);
  });
  parent.append(wrap);
  return { set(v) { input.value = v; out.textContent = fmt(v); } };
}

const sliders = { fixed: {}, initial: {}, coeffs: {} };

function buildPanel() {
  const fixedDefs = {
    metals:    { label: "Métaux", min: 0, max: 1, step: 0.01 },
    distance:  { label: "Distance à l'étoile (UA)", min: 0.4, max: 2, step: 0.01 },
    rotation:  { label: "Vitesse de rotation", min: 0, max: 1, step: 0.01, format: (v) => (v > 0.02 ? `${Math.round(24 / v)} h/jour` : "≥ 1200 h (quasi figée)") },
    volcanism: { label: "Activité volcanique", min: 0, max: 1, step: 0.01 },
  };
  for (const k in fixedDefs) {
    sliders.fixed[k] = addSlider($("fixed"), { ...fixedDefs[k], value: state.fixed[k] }, (v) => { state.fixed[k] = v; });
  }

  addSlider($("player"), { label: "Usines", min: 0, max: 100, step: 1, value: state.factories, format: (v) => String(v) },
    (v) => { state.factories = v; });

  // taille/masse et H2O sont dans l'état initial (pas dans Planète) : modifiables d'une
  // simulation à l'autre, contrairement aux traits physiques immuables (métaux, distance…).
  // La densité d'atmosphère n'est plus réglable directement : elle est déduite de la
  // taille/masse (gravité qui retient les gaz dès l'origine).
  const initDefs = {
    size:       { label: "Taille / masse de la planète", min: 0.05, max: 1.5, step: 0.01 },
    water:      { label: "H2O initial (eau / glace / vapeur)", min: 0, max: 1, step: 0.01 },
    co2:        { label: "Taux de CO2", min: 0, max: 1, step: 0.005, format: ppm },
    vegetation: { label: "Végétation", min: 0, max: 1, step: 0.01 },
  };
  for (const k in initDefs) {
    sliders.initial[k] = addSlider($("initial"), { ...initDefs[k], value: state.initial[k] }, (v) => {
      state.initial[k] = v;
      reset();
    });
  }

  for (const k in COEFFS) {
    const { label, min, max, step, value } = COEFFS[k];
    sliders.coeffs[k] = addSlider($("coeffs"), { label, min, max, step, value }, (v) => { coeffs[k] = v; });
  }

  for (const key in PRESETS) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = PRESETS[key].label;
    b.addEventListener("click", () => loadPreset(key));
    $("presets").append(b);
  }

  $("btn-play").addEventListener("click", () => {
    state.playing = !state.playing;
    $("btn-play").textContent = state.playing ? "⏸ Pause" : "▶ Lecture";
  });
  $("btn-reset").addEventListener("click", reset);
  $("in-speed").addEventListener("input", (e) => {
    state.speed = +e.target.value;
    $("speed-out").textContent = `${state.speed} ans/s`;
  });
  $("btn-coeffs-reset").addEventListener("click", () => {
    for (const k in COEFFS) {
      coeffs[k] = COEFFS[k].value;
      sliders.coeffs[k].set(COEFFS[k].value);
    }
  });
}

function loadPreset(key) {
  const p = PRESETS[key];
  Object.assign(state.fixed, p.fixed);
  Object.assign(state.initial, p.dynamic);
  for (const k in p.fixed) sliders.fixed[k].set(p.fixed[k]);
  for (const k in p.dynamic) sliders.initial[k].set(p.dynamic[k]);
  reset();
}

function reset() {
  state.sim = { ...state.initial, atmosphere: initialAtmosphere(state.initial, coeffs), temp: insolation(state.fixed), haze: 0, erosion: 0 };
  state.year = 0;
  state.history = [];
  record();
}

function record() {
  const d = derive(state.fixed, state.sim, state.factories, coeffs);
  state.history.push({ ...state.sim, temp: d.temp, overheat: d.overheat });
  if (state.history.length > HISTORY_MAX) state.history.shift();
}

// ---------- rendu de la planète ----------

// bruit de valeur 3D (hash entier) — pas de couture sur la sphère
function hash3(x, y, z) {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
const smooth = (t) => t * t * (3 - 2 * t);
function noise3(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const u = smooth(x - xi), v = smooth(y - yi), w = smooth(z - zi);
  const lerp = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash3(xi + dx, yi + dy, zi + dz);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w);
}
const fbm = (x, y, z) => 0.6 * noise3(x * 2.2, y * 2.2, z * 2.2) + 0.4 * noise3(x * 5 + 9, y * 5 + 9, z * 5 + 9);

const PLANET_RES = 220;
const surface = document.createElement("canvas");
surface.width = surface.height = PLANET_RES;
const sctx = surface.getContext("2d");
const img = sctx.createImageData(PLANET_RES, PLANET_RES);
const mix = (a, b, t) => a + (b - a) * t;

function renderSurface(d, rot) {
  const { data } = img;
  const sea = clampUi(d.oceans);
  const vegAmount = state.sim.vegetation;
  const hotness = clampUi((d.temp - d.overheat) / 40);
  const cold = clampUi((5 - d.temp) / 30);
  const lx = -0.5, ly = -0.4, lz = 0.76;
  const cr = Math.cos(rot), sr = Math.sin(rot);
  for (let j = 0; j < PLANET_RES; j++) {
    for (let i = 0; i < PLANET_RES; i++) {
      const x = ((i + 0.5) / PLANET_RES) * 2 - 1;
      const y = ((j + 0.5) / PLANET_RES) * 2 - 1;
      const r2 = x * x + y * y;
      const o = (j * PLANET_RES + i) * 4;
      if (r2 >= 1) { data[o + 3] = 0; continue; }
      const z = Math.sqrt(1 - r2);
      const px = x * cr + z * sr, pz = -x * sr + z * cr;
      const n = fbm(px, y, pz);
      const m = fbm(px + 40, y + 40, pz + 40);
      let r, g, b;
      if (n < sea) {
        const depth = clampUi((sea - n) / 0.25);
        r = mix(60, 15, depth); g = mix(130, 60, depth); b = mix(200, 140, depth);
        if (m < vegAmount * 0.9) {
          // algues / plancton : verdissement de l'eau, la végétation vit aussi en mer
          r = mix(r, 20, 0.5); g = mix(g, 160, 0.5); b = mix(b, 110, 0.5);
        }
      } else {
        // roche : grise (froid) → brune → rouge sombre (brûlante)
        r = mix(150, 190, hotness); g = mix(125, 70, hotness); b = mix(95, 40, hotness);
        r = mix(r, 235, cold); g = mix(g, 240, cold); b = mix(b, 250, cold);
        if (m < vegAmount * 0.9) {
          // vert luxuriant si l'eau le permet, olive si désertique
          const lush = clampUi(state.sim.water / 0.5);
          r = mix(120, 40, lush); g = mix(130, 150, lush); b = mix(60, 50, lush);
        }
      }
      const light = 0.25 + 0.75 * Math.max(0, x * lx + y * ly + z * lz);
      data[o] = r * light; data[o + 1] = g * light; data[o + 2] = b * light; data[o + 3] = 255;
    }
  }
  sctx.putImageData(img, 0, 0);
}

function clampUi(v) { return Math.min(1, Math.max(0, v)); }

const planetCanvas = $("planet");
const pctx = planetCanvas.getContext("2d");

function drawPlanet(t) {
  const dpr = window.devicePixelRatio || 1;
  const w = planetCanvas.clientWidth, h = planetCanvas.clientHeight;
  if (planetCanvas.width !== w * dpr || planetCanvas.height !== h * dpr) {
    planetCanvas.width = w * dpr; planetCanvas.height = h * dpr;
  }
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.clearRect(0, 0, w, h);
  const d = derive(state.fixed, state.sim, state.factories, coeffs);
  const R = Math.min(w, h) * 0.34;
  const cx = w / 2, cy = h / 2;

  // halo d'atmosphère : bleu → orange selon CO2 / surchauffe, puis assombri vers le gris
  // sombre par les cendres volcaniques en suspension (haze) — plus il y en a, plus le ciel
  // est opaque et sale, pas seulement teinté.
  const atm = clampUi(state.sim.atmosphere / 1.2);
  const warm = clampUi(state.sim.co2 * 2 + (d.temp > d.overheat ? 0.3 : 0));
  const haze = clampUi(state.sim.haze);
  const hr = Math.round(mix(mix(110, 255, warm), 45, haze * 0.85));
  const hg = Math.round(mix(mix(180, 140, warm), 40, haze * 0.85));
  const hb = Math.round(mix(mix(255, 70, warm), 38, haze * 0.85));
  const outer = R * (1 + 0.05 + 0.3 * atm);
  const grad = pctx.createRadialGradient(cx, cy, R * 0.97, cx, cy, outer);
  grad.addColorStop(0, `rgba(${hr},${hg},${hb},${Math.min(1, 0.7 * atm + 0.3 * haze)})`);
  grad.addColorStop(1, `rgba(${hr},${hg},${hb},0)`);
  pctx.fillStyle = grad;
  pctx.beginPath(); pctx.arc(cx, cy, outer, 0, Math.PI * 2); pctx.fill();

  renderSurface(d, t * 0.00012 * (0.05 + 0.95 * state.fixed.rotation)); // vitesse de spin liée à la rotation
  pctx.imageSmoothingEnabled = true;
  pctx.drawImage(surface, cx - R, cy - R, R * 2, R * 2);
}

// ---------- jauges, courbes, statut ----------

const GAUGES = [
  { key: "atmosphere", label: "Atmosphère", color: "#6ab7ff", max: 2 },
  { key: "co2", label: "CO2", color: "#ff9a5a", max: 1, format: ppm },
  { key: "vegetation", label: "Végétation", color: "#6bd96b", max: 1 },
  { key: "haze", label: "Cendres volcaniques", color: "#a99", max: 1 },
];
for (const g of GAUGES) {
  const el = document.createElement("div");
  el.className = "gauge";
  el.innerHTML = `<div class="label"><span>${g.label}</span><span></span></div><div class="bar"><i style="background:${g.color}"></i></div>`;
  $("gauges").append(el);
  g.value = el.querySelector(".label span:last-child");
  g.bar = el.querySelector("i");
}

function updateGauges() {
  for (const g of GAUGES) {
    const v = state.sim[g.key];
    g.value.textContent = (g.format || ((x) => x.toFixed(3)))(v);
    g.bar.style.width = `${clampUi(v / g.max) * 100}%`;
  }
}

function updateStatus() {
  const d = derive(state.fixed, state.sim, state.factories, coeffs);
  $("year-out").textContent = `an ${state.year}`;

  const rows = [
    ["Température", `${d.temp.toFixed(0)} °C`],
    ["Équilibre radiatif", `${d.equilibriumTemp.toFixed(0)} °C`],
    ["Seuil de surchauffe", `${d.overheat.toFixed(0)} °C`],
    ["Champ magnétique", `${(d.magnetic * 100).toFixed(0)} %`],
    ["Océans", waterVolume(d.oceans)],
    ["Glace", waterVolume(d.ice)],
    ["Vapeur d'eau", ppm(d.vapor)],
    ["Albédo", `${(d.albedo * 100).toFixed(0)} %`],
    ["Vent", d.wind.toFixed(1)],
    ["Captation CO2 (vivant)", `${(d.co2AbsorbVeg * 100).toFixed(1)} %/an`],
    ["Captation CO2 (océans)", `${(d.co2AbsorbOcean * 100).toFixed(1)} %/an`],
  ];
  $("status").innerHTML = rows.map(([k, v]) => `<div class="info-row"><span>${k}</span><span>${v}</span></div>`).join("");

  const flags = [];
  if (d.magnetic < 1) flags.push(d.magnetic === 0 ? "pas de champ magnétique : l'atmosphère se dissipe" : "champ magnétique faible");
  if (d.temp > d.overheat) flags.push("🔥 surchauffe : la végétation s'effondre");
  if (state.sim.atmosphere <= coeffs.atmMinVeg) flags.push("atmosphère trop mince pour la vie");
  $("flags").innerHTML = flags.map((f) => `<p class="flag">⚠ ${f}</p>`).join("");

  drawAtmoPie(d);
}

// ---------- camembert de composition atmosphérique ----------

const atmoPie = $("atmo-pie");
const apctx = atmoPie.getContext("2d");
const ATMO_SLICES = [
  { key: "other", color: "#6ab7ff", label: "Autres (N2/O2…)" },
  { key: "co2", color: "#ff9a5a", label: "CO2" },
  { key: "vapor", color: "#8fd0ff", label: "H2O (vapeur)" },
];

// la taille du camembert code la densité de l'atmosphère, ses parts codent sa composition
function drawAtmoPie(d) {
  const dpr = window.devicePixelRatio || 1;
  const w = atmoPie.clientWidth, h = atmoPie.clientHeight;
  if (atmoPie.width !== w * dpr || atmoPie.height !== h * dpr) { atmoPie.width = w * dpr; atmoPie.height = h * dpr; }
  apctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  apctx.clearRect(0, 0, w, h);

  const cx = w / 2, cy = h / 2;
  const maxR = Math.min(w, h) / 2 - 2;
  const density = clampUi(state.sim.atmosphere / 1.2);
  const r = Math.max(4, maxR * density);

  const co2 = state.sim.co2, vapor = d.vapor, other = Math.max(0, 1 - co2 - vapor);
  const values = { other, co2, vapor };
  const total = other + co2 + vapor || 1;

  let angle = -Math.PI / 2;
  for (const sl of ATMO_SLICES) {
    const frac = values[sl.key] / total;
    if (frac <= 0) continue;
    const next = angle + frac * Math.PI * 2;
    apctx.beginPath();
    apctx.moveTo(cx, cy);
    apctx.arc(cx, cy, r, angle, next);
    apctx.closePath();
    apctx.fillStyle = sl.color;
    apctx.fill();
    angle = next;
  }
  apctx.strokeStyle = "rgba(255,255,255,.25)";
  apctx.lineWidth = 1;
  apctx.beginPath();
  apctx.arc(cx, cy, r, 0, Math.PI * 2);
  apctx.stroke();

  $("atmo-density-out").textContent = `densité ${state.sim.atmosphere.toFixed(2)}`;
  $("atmo-legend").innerHTML = ATMO_SLICES.map((sl) =>
    `<div><span class="sw" style="background:${sl.color}"></span>${sl.label} — ${((values[sl.key] / total) * 100).toFixed(1)} %</div>`
  ).join("");
}

const chart = $("chart");
const cctx = chart.getContext("2d");

function drawChart() {
  const dpr = window.devicePixelRatio || 1;
  const w = chart.clientWidth, h = chart.clientHeight;
  if (chart.width !== w * dpr || chart.height !== h * dpr) { chart.width = w * dpr; chart.height = h * dpr; }
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);
  const pad = { l: 16, r: 44, t: 10, b: 20 };
  const pw = w - pad.l - pad.r, ph = h - pad.t - pad.b;
  cctx.strokeStyle = "rgba(255,255,255,0.15)";
  cctx.strokeRect(pad.l, pad.t, pw, ph);
  const hist = state.history;
  if (hist.length < 2) return;

  const xAt = (i) => pad.l + (i / (HISTORY_MAX - 1)) * pw;
  const series = [
    { key: "atmosphere", color: "#6ab7ff", scale: (v) => v / 2 },
    { key: "co2", color: "#ff9a5a", scale: (v) => v },
    { key: "vegetation", color: "#6bd96b", scale: (v) => v },
    { key: "temp", color: "#ff6a6a", scale: (v) => (v + 50) / 250, dash: [4, 3] }, // −50…200 °C
  ];
  const first = state.year - hist.length + 1;
  for (const s of series) {
    cctx.strokeStyle = s.color;
    cctx.lineWidth = 2;
    cctx.setLineDash(s.dash || []);
    cctx.beginPath();
    hist.forEach((p, i) => {
      const y = pad.t + ph * (1 - clampUi(s.scale(p[s.key])));
      i ? cctx.lineTo(xAt(i), y) : cctx.moveTo(xAt(i), y);
    });
    cctx.stroke();
  }
  cctx.setLineDash([]);

  // seuil de surchauffe
  const last = hist[hist.length - 1];
  const yOver = pad.t + ph * (1 - clampUi((last.overheat + 50) / 250));
  cctx.strokeStyle = "rgba(255,106,106,0.5)";
  cctx.setLineDash([2, 4]);
  cctx.beginPath(); cctx.moveTo(pad.l, yOver); cctx.lineTo(pad.l + pw, yOver); cctx.stroke();
  cctx.setLineDash([]);

  cctx.font = "11px system-ui, sans-serif";
  cctx.fillStyle = "rgba(232,236,245,0.6)";
  cctx.fillText(`an ${first}`, pad.l, h - 5);
  cctx.textAlign = "right";
  cctx.fillText(`an ${state.year}`, pad.l + pw, h - 5);
  cctx.fillStyle = "#ff6a6a";
  cctx.fillText("seuil", w - 4, yOver + 4);
  cctx.textAlign = "left";
  let lx = pad.l + 6;
  for (const s of [...series].map((s, i) => ({ ...s, name: ["atmosphère", "CO2", "végétation", "température"][i] }))) {
    cctx.fillStyle = s.color;
    cctx.fillText(s.name, lx, pad.t + 14);
    lx += cctx.measureText(s.name).width + 14;
  }
}

// ---------- boucle ----------

let last = performance.now(), acc = 0;
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (state.playing) {
    acc += dt * state.speed;
    while (acc >= 1) {
      state.sim = step(state.fixed, state.sim, state.factories, coeffs);
      state.year++;
      record();
      acc -= 1;
    }
  }
  drawPlanet(now);
  updateGauges();
  updateStatus();
  drawChart();
  requestAnimationFrame(frame);
}

buildPanel();
reset();
requestAnimationFrame(frame);
