// Simulateur d'évolution planétaire — issue #27
// Modèle pur (aucun DOM) : l'UI importe ce fichier via <script>, et
// `npm run sim` l'exécute en Node pour comparer les archétypes.
//
// Un pas de simulation = 1 "an". Tout est normalisé : 1 = valeur "terrestre".

// Coefficients d'équilibrage : seuils et vitesses, tous modifiables dans l'UI.
const COEFFS = {
  magneticMetals:  { label: "Métaux pour un champ magnétique complet", value: 0.3, min: 0.05, max: 1, step: 0.01 },
  dissipation:     { label: "Dissipation de l'atmosphère (sans champ)", value: 0.01, min: 0, max: 0.05, step: 0.0005 },
  baseLoss:        { label: "Fuite d'atmosphère résiduelle (avec champ)", value: 0.0002, min: 0, max: 0.01, step: 0.0001 },
  outgassing:      { label: "Dégazage volcanique (avec champ)", value: 0.004, min: 0, max: 0.05, step: 0.0005 },
  volcanicCo2:     { label: "CO2 volcanique naturel", value: 0.0005, min: 0, max: 0.01, step: 0.0001 },
  factoryCo2:      { label: "CO2 émis par usine / an", value: 0.0005, min: 0, max: 0.005, step: 0.0001 },
  vegAbsorb:       { label: "Absorption du CO2 par la végétation", value: 0.05, min: 0, max: 0.2, step: 0.001 },
  oceanAbsorb:     { label: "Absorption du CO2 par les océans", value: 0.01, min: 0, max: 0.1, step: 0.001 },
  naturalGreen:    { label: "Effet de serre naturel (°C × atmosphère)", value: 10, min: 0, max: 40, step: 0.5 },
  greenhouse:      { label: "Effet de serre du CO2 (°C × atmosphère)", value: 60, min: 0, max: 200, step: 1 },
  overheatRef:     { label: "Seuil de surchauffe à 1 UA (°C)", value: 45, min: 20, max: 100, step: 1 },
  overheatDist:    { label: "Sensibilité du seuil à la distance", value: 0.5, min: 0, max: 1, step: 0.05 },
  coldLimit:       { label: "Température minimale de la végétation (°C)", value: -5, min: -40, max: 20, step: 1 },
  atmMinVeg:       { label: "Atmosphère minimale pour la végétation", value: 0.15, min: 0, max: 0.8, step: 0.01 },
  lifeSeed:        { label: "Graine de vie (apparition à partir d'O2)", value: 0.0005, min: 0, max: 0.01, step: 0.0001 },
  growth:          { label: "Vitesse de croissance de la végétation", value: 0.08, min: 0, max: 0.5, step: 0.005 },
  collapse:        { label: "Vitesse d'effondrement (par 10 °C au-dessus du seuil)", value: 0.15, min: 0, max: 1, step: 0.01 },
  desertCap:       { label: "Végétation max. sans eau (désertique)", value: 0.25, min: 0, max: 1, step: 0.01 },
};

const FIXED_DEFAULTS = { metals: 0.8, water: 0.6, distance: 1 };
const DYNAMIC_DEFAULTS = { atmosphere: 0.6, co2: 0.02, vegetation: 0.02 };

// Planètes prêtes à l'emploi : 3 variables fixes + état initial.
const PRESETS = {
  ocean:   { label: "Océanique",  fixed: { metals: 0.9, water: 0.9, distance: 1 },    dynamic: { atmosphere: 0.8, co2: 0.02, vegetation: 0.05 } },
  desert:  { label: "Désertique", fixed: { metals: 0.8, water: 0,   distance: 0.85 }, dynamic: { atmosphere: 0.7, co2: 0.02, vegetation: 0.05 } },
  burning: { label: "Brûlante",   fixed: { metals: 0.8, water: 0.3, distance: 0.55 }, dynamic: { atmosphere: 0.9, co2: 0.1,  vegetation: 0.02 } },
  dead:    { label: "Morte",      fixed: { metals: 0,   water: 0.5, distance: 1 },    dynamic: { atmosphere: 1,   co2: 0.02, vegetation: 0.1 } },
};

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

function coeffValues() {
  const c = {};
  for (const k in COEFFS) c[k] = COEFFS[k].value;
  return c;
}

// Grandeurs déduites de l'état courant (pas de mémoire propre).
function derive(fixed, s, factories, c) {
  const magnetic = clamp(fixed.metals / c.magneticMetals);
  const baseTemp = 278 / Math.sqrt(fixed.distance) - 273;
  const temp = baseTemp + s.atmosphere * (c.naturalGreen + c.greenhouse * s.co2);
  const overheat = c.overheatRef * (1 - c.overheatDist + c.overheatDist * fixed.distance);
  const vegCap = fixed.water < 0.1 ? c.desertCap : c.desertCap + (1 - c.desertCap) * clamp(fixed.water / 0.5);
  const oceans = temp < 100 ? fixed.water * clamp(s.atmosphere / 0.3) : 0;
  return { magnetic, baseTemp, temp, overheat, vegCap, oceans };
}

// Avance l'état d'un an. Retourne le nouvel état (l'ancien n'est pas modifié).
function step(fixed, s, factories, c) {
  const d = derive(fixed, s, factories, c);
  let { atmosphere, co2, vegetation } = s;

  // atmosphère : fuite sans champ magnétique, dégazage avec
  const loss = c.dissipation * (1 - d.magnetic) + c.baseLoss;
  const lossAmount = atmosphere * loss;
  atmosphere += c.outgassing * d.magnetic * (1 - atmosphere) - lossAmount;
  atmosphere = clamp(atmosphere, 0, 2);

  // CO2 : usines + volcans, absorbé par végétation et océans, emporté avec l'atmosphère
  co2 += factories * c.factoryCo2 + c.volcanicCo2 * d.magnetic;
  co2 -= co2 * (c.vegAbsorb * vegetation + c.oceanAbsorb * d.oceans);
  co2 -= co2 * loss;
  co2 = clamp(co2, 0, 1);

  // végétation : croît si atmosphère + température OK, s'effondre au-delà du seuil
  const tempFactor = clamp((d.temp - c.coldLimit) / 10);
  const lifeOk = atmosphere > c.atmMinVeg && d.temp < d.overheat;
  if (lifeOk) {
    vegetation += c.growth * vegetation * (1 - vegetation / d.vegCap) * clamp(atmosphere / 0.5) * tempFactor;
    if (vegetation < c.lifeSeed * 20) vegetation += c.lifeSeed * tempFactor;
  }
  if (d.temp > d.overheat) vegetation -= vegetation * c.collapse * ((d.temp - d.overheat) / 10);
  if (atmosphere <= c.atmMinVeg) vegetation -= vegetation * 0.05;
  if (vegetation > d.vegCap) vegetation -= (vegetation - d.vegCap) * 0.1;
  vegetation = clamp(vegetation, 0, 1);

  return { atmosphere, co2, vegetation };
}

if (typeof module !== "undefined") {
  module.exports = { COEFFS, PRESETS, FIXED_DEFAULTS, DYNAMIC_DEFAULTS, clamp, coeffValues, derive, step };
}

// `npm run sim` : trajectoire des archétypes, sans puis avec 30 usines dès l'an 150.
if (typeof require !== "undefined" && require.main === module) {
  const c = coeffValues();
  for (const key in PRESETS) {
    const p = PRESETS[key];
    let s = { ...p.dynamic };
    const rows = [];
    for (let t = 0; t <= 600; t++) {
      const factories = t >= 150 ? 30 : 0;
      if (t % 100 === 0) {
        const d = derive(p.fixed, s, factories, c);
        rows.push(`an ${String(t).padStart(3)} | atm ${s.atmosphere.toFixed(2)} co2 ${s.co2.toFixed(3)} veg ${s.vegetation.toFixed(2)} | ${d.temp.toFixed(0)}°C (seuil ${d.overheat.toFixed(0)})`);
      }
      s = step(p.fixed, s, factories, c);
    }
    console.log(`\n${p.label}\n  ` + rows.join("\n  "));
  }
}
