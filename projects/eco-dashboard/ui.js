// Dashboard : lisibilité et itération rapide avant tout.
// Hot-seat : on choisit "en tant que" qui l'on agit ; les joueurs non
// humains sont joués par une stratégie automatique à la fin du tour.

const { RARES, MATERIAL, ZONES, INFRA, TECHS, TECH_CATEGORIES, MILESTONES, AGES, PROJECTS, CONFIG } = Game;
const { STRATEGIES } = Strategies;

let S = null;
let actor = 0;
let toastTimer = null;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const P = (id) => S.players[id];
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const fmt = (n) => (Math.abs(n) >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
const signed = (n) => `<span class="${n > 0 ? "good" : n < 0 ? "bad" : "muted"}">${n > 0 ? "+" : ""}${fmt(n)}</span>`;

function toast(res) {
  if (!res || !res.msg) return;
  const el = $("#toast");
  el.textContent = res.msg;
  el.className = res.ok ? "" : "bad";
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2500);
}

function run(fn) {
  const res = fn();
  toast(res);
  render();
  return res;
}

function fillSelect(sel, options) {
  const prev = sel.value;
  sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join("");
  if (options.some(([v]) => String(v) === prev)) sel.value = prev;
}

// ---------------------------------------------------------------- partie

function newGame() {
  const n = +$("#cfg-players").value;
  const seed = +$("#cfg-seed").value || 1;
  // par défaut : le joueur 1 est humain, les autres ont des stratégies variées
  const prev = S ? S.players.map((p) => p.strategy) : [];
  const defaults = ["humain", "etrangleur", "preteur", "agressif", "pirate"];
  const strategies = Array.from({ length: n }, (_, i) => prev[i] || defaults[i]);
  S = Game.newGame({ players: n, seed, strategies });
  actor = Math.min(actor, n - 1);
  render();
}

function simulate(turns) {
  for (let i = 0; i < turns && !S.ended; i++) Game.endTurn(S);
  render();
}

// ---------------------------------------------------------------- rendu

function render() {
  renderStatus();
  renderPlayers();
  renderActions();
  renderThreats();
  renderProjects();
  renderOffers();
  renderLoans();
  renderRelations();
  renderIndicators();
  renderLog();
}

function meter(value, max, color) {
  const pct = Math.max(0, Math.min(100, (value / max) * 100));
  return `<span class="meter"><span style="width:${pct}%;background:${color}"></span></span>`;
}

function renderStatus() {
  const planetColor = S.planet > 60 ? "var(--good)" : S.planet > 30 ? "var(--warn)" : "var(--bad)";
  $("#status").innerHTML = `
    <span>Tour <strong>${S.turn}</strong> / ${CONFIG.maxTurns}</span>
    <span>Âge <strong>${AGES[S.age].name}</strong></span>
    <span>Planète ${S.sunDestroyed ? `<strong class="bad">détruite</strong>` : `${meter(S.planet, CONFIG.planetHealth, planetColor)} ${fmt(S.planet)} <span class="muted">(pollution terrestre ${fmt(S.lastPollution || 0)} − régén. ${CONFIG.pollutionRegen}/tour)</span>`}</span>
    <span>Forêt sombre ${forestLabel()}</span>`;
  const end = $("#ending");
  end.hidden = !S.ended;
  if (S.ended) end.textContent = `🏁 ${S.ended.text}`;
  $("#btn-end").disabled = $("#btn-sim").disabled = $("#btn-sim-end").disabled = !!S.ended;
}

function forestLabel() {
  if (S.darkForestCloaked) return `<span class="good">camouflage galactique</span>`;
  if (S.projectile) return `<strong class="bad">projectile : impact dans ${S.projectile.arrival - S.turn} tours</strong>`;
  if (S.fleet) return `<strong class="bad">flotte extraterrestre (force ${S.fleet.strength}) ${S.turn < S.fleet.arrival ? `dans ${S.fleet.arrival - S.turn} tours` : "dans le système"}</strong>`;
  if (S.darkForestTriggerTurn == null) return `<span class="muted">pas encore visible (jalon : ${MILESTONES.find((m) => m.id === CONFIG.darkForestTrigger).name})</span>`;
  return `${S.sunDestroyed ? `<span class="bad">Soleil détruit</span> · ` : ""}<strong class="warn">${(Game.darkForestRisk(S) * 100).toFixed(1)} %/tour</strong> <span class="muted">(visibilité de la table ${fmt(Game.tableVisibility(S))})</span>`;
}

function sparkline(id) {
  const pts = S.history.map((h) => h.equity[id]);
  if (pts.length < 2) return "";
  const all = S.history.flatMap((h) => Object.values(h.equity));
  const max = Math.max(1, ...all);
  const min = Math.min(0, ...all);
  const w = 200;
  const h = 30;
  const xy = pts.map((v, i) => `${((i / (pts.length - 1)) * w).toFixed(1)},${(h - ((v - min) / (max - min)) * h).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><polyline fill="none" stroke="var(--accent)" stroke-width="1.5" points="${xy.join(" ")}"/></svg>`;
}

function statusBadges(p) {
  const b = [];
  if (p.status === "faillite") b.push(`<span class="badge bad">faillite</span>`);
  else if (p.status === "racheté") b.push(`<span class="badge bad">racheté par ${P(p.endedBy).name}</span>`);
  else if (p.status === "détruit") b.push(`<span class="badge bad">détruit${p.endedBy != null ? ` par ${P(p.endedBy).name}` : ""}</span>`);
  if (Game.isActive(p) && p.money < 0) b.push(`<span class="badge warn">dans le rouge (${p.brokeTurns})</span>`);
  else if (Game.isActive(p) && p.money < 10) b.push(`<span class="badge warn">bloqué</span>`);
  if (S.ended && S.ended.winners.includes(p.id)) b.push(`<span class="badge good">gagnant</span>`);
  return b.join("");
}

function renderPlayers() {
  $("#players").innerHTML = S.players
    .map((p) => {
      const rares = Object.keys(RARES)
        .filter((r) => p.rares[r])
        .map((r) => `${p.rares[r]} ${RARES[r]} <span class="muted">@${p.prices[r]}</span>`)
        .join("<br>") || `<span class="muted">aucune</span>`;
      const infras = p.infras
        .map((i) => `<li>${INFRA[i.type].name} · ${Game.zone(i.zone).name}${Game.zone(i.zone).inner ? "" : " ✦"} · ${i.hp}/${INFRA[i.type].hp}${i.mode === "agressif" ? ` · <span class="bad">agressif</span>` : ""}</li>`)
        .join("");
      const research = [...new Set(p.staff.filter((r) => r.tech).map((r) => r.tech))]
        .map((t) => `${TECHS[t].name} (${Game.staffOn(p, t).length}, ${Math.round(Game.researchChance(t, Game.effectiveResearchers(p, t)) * 100)} %)`)
        .join(", ");
      const levels = [0, 1, 2].map((l) => p.staff.filter((r) => Game.xpLevel(r) === l).length);
      const holders = Object.entries(p.shares)
        .filter(([h]) => +h !== p.id)
        .map(([h, n]) => `${P(h).name} ${n}`)
        .join(", ");
      const owned = S.players
        .filter((c) => c !== p && c.shares[p.id])
        .map((c) => `${c.name} ${c.shares[p.id]}`)
        .join(", ");
      const debt = Game.debtOf(S, p);
      const recv = Game.receivableOf(S, p);
      const strat = Object.entries(STRATEGIES)
        .map(([k, v]) => `<option value="${k}" ${k === p.strategy ? "selected" : ""}>${v.name}</option>`)
        .join("");
      return `<article class="card ${p.id === actor ? "selected" : ""} ${Game.isActive(p) ? "" : "out"}" data-player="${p.id}">
        <header>
          <strong>${p.name}</strong>
          <select data-strategy="${p.id}" title="${esc(STRATEGIES[p.strategy].desc)}">${strat}</select>
        </header>
        <div class="muted">${Game.zone(p.home).name} · ${Strategies.POSTURE[p.strategy] ? `posture : ${Strategies.POSTURE[p.strategy]}` : "joué à la main"}</div>
        <div>${statusBadges(p)}</div>
        <dl>
          <dt>Argent</dt><dd class="${p.money < 0 ? "bad" : ""}">${fmt(p.money)} ₵</dd>
          <dt>${MATERIAL}</dt><dd>${fmt(p.material)}</dd>
          <dt>Chercheurs</dt><dd>${p.staff.length} / ${Game.labCapacity(p)} <span class="muted">(novices ${levels[0]}, confirmés ${levels[1]}, experts ${levels[2]})</span></dd>
          <dt>Recherche</dt><dd>${research || "—"}</dd>
          <dt>Rares</dt><dd>${rares}</dd>
          <dt>Valeur</dt><dd>${fmt(Game.equity(S, p))} <span class="muted">(${Game.sharePrice(S, p).toFixed(2)} ₵/part)</span></dd>
          <dt>Dette</dt><dd>${debt ? `<span class="bad">${debt} ₵</span>` : "—"}${recv ? ` <span class="muted">/ créances ${recv} ₵</span>` : ""}</dd>
          <dt>Visibilité</dt><dd>${fmt(Game.visibility(p))}</dd>
          <dt>Techs (${p.techs.length})</dt><dd>${p.techs.slice(-8).map((t) => `<span class="badge">${TECHS[t].name}</span>`).join("") || "—"}</dd>
          <dt>Jalons</dt><dd>${p.milestones.map((m) => `<span class="badge">${MILESTONES.find((x) => x.id === m).name}</span>`).join("") || "—"}</dd>
          <dt>Actionnaires</dt><dd>${holders || "—"}</dd>
          <dt>Détient</dt><dd>${owned || "—"}</dd>
        </dl>
        <div class="muted">Infrastructures (${p.infras.length}) — ✦ planète extérieure</div>
        <ul>${infras || "<li class='muted'>aucune</li>"}</ul>
        ${sparkline(p.id)}
      </article>`;
    })
    .join("");
}

// ------------------------------------------------------------- actions

function renderActions() {
  const me = P(actor);
  const everyone = S.players.map((p) => [p.id, p.name]);
  const others = S.players.filter((p) => p.id !== actor && Game.isActive(p)).map((p) => [p.id, p.name]);
  fillSelect($("#actor"), everyone);
  $("#actor").value = actor;
  $("#actor-summary").textContent = `${fmt(me.money)} ₵ · ${fmt(me.material)} ${MATERIAL.toLowerCase()} · ${me.staff.length} chercheur(s)${me.strategy !== "humain" ? " · ⚠ joué par une stratégie à la fin du tour" : ""}`;

  // recherche : technos dont les prérequis sont remplis (un seul suffit pour une recherche collective)
  const fr = $("#f-research");
  const idle = me.staff.filter((r) => !r.tech).length;
  $("[data-hint=staff]").textContent = `${me.staff.length} chercheur(s) dont ${idle} inactif(s) · capacité ${Game.labCapacity(me)} (${CONFIG.labCapacity} par laboratoire) · embauche ${CONFIG.hireCost} ₵ · salaire ${CONFIG.salary} ₵/tour · indemnité ${CONFIG.severance} ₵ × (1 + palier)`;
  const available = Object.keys(TECHS)
    .filter((t) => !Game.hasTech(me, t) && Game.canResearch(me, t))
    .sort((a, b) => TECH_CATEGORIES[TECHS[a].category].localeCompare(TECH_CATEGORIES[TECHS[b].category]) || TECHS[a].cost - TECHS[b].cost);
  fillSelect(
    fr.tech,
    available.map((t) => {
      const tool = Game.toolingCost(me, t);
      const cost = TECHS[t].pooled ? "collective" : me.tooled[t] ? "outillage installé" : `outillage ${tool.money} ₵ + ${tool.material} ${MATERIAL.toLowerCase()}`;
      return [t, `[${TECH_CATEGORIES[TECHS[t].category]}] ${TECHS[t].name} — ${cost}, ${(TECHS[t].chance * 100).toFixed(1)} %/chercheur`];
    })
  );
  const selected = fr.tech.value;
  if (!selected) $("[data-hint=tech]").textContent = available.length ? "" : "Aucune technologie accessible pour l'instant (prérequis manquants)";
  else {
    const equip = Game.equipmentCost(me, selected);
    const n = Game.staffOn(me, selected).length;
    const k = TECHS[selected].pooled ? Game.pooledKnowledge(S, selected) : null;
    const chance = k ? k.chance : Game.researchChance(selected, Game.effectiveResearchers(me, selected));
    $("[data-hint=tech]").textContent = [
      TECHS[selected].desc,
      Object.keys(equip).length && !me.tooled[selected] ? `équipement : ${Game.describeBundle(S, { money: 0, material: 0, rares: equip })}` : "",
      n ? `${n} chercheur(s) affecté(s), ${Math.round(chance * 100)} % ce tour` : "",
      k && k.missing.length ? `il manque à la table : ${k.missing.map((r) => TECHS[r].name).join(", ")}` : "",
      k && !k.tooled ? "aucun chantier de distorsion achevé" : "",
    ]
      .filter(Boolean)
      .join(" · ");
  }
  const assignedList = [...new Set(me.staff.filter((r) => r.tech).map((r) => r.tech))]
    .map((t) => `${TECHS[t].name} (${Game.staffOn(me, t).length})`)
    .join(", ");
  $("[data-hint=research-active]").textContent = assignedList ? `En cours : ${assignedList}` : "";

  // construction — la zone conditionne l'accès (verrou technologique) et le
  // coût (plus loin = plus cher), donc on la remplit avant le type d'infra
  const fb = $("#f-build");
  fillSelect(
    fb.zone,
    ZONES.map((z) => {
      const locked = z.reachTech && !Game.hasTech(me, z.reachTech);
      const neigh = S.players.filter((p) => p !== me && Game.isActive(p) && p.infras.some((i) => i.zone === z.id)).map((p) => p.name);
      const mult = 1 + z.tier * CONFIG.distanceCost;
      const yields = Object.keys(z.yield).map((r) => RARES[r]).join(", ");
      return [
        z.id,
        `${Game.zoneOpen(S, z) ? "" : "💥 "}${z.name}${yields ? ` (${yields})` : ""}${z.inner ? "" : " ✦"} — ×${mult.toFixed(1)}${locked ? ` 🔒 ${TECHS[z.reachTech].name}` : ""}${neigh.length ? ` — voisins : ${neigh.join(", ")}` : ""}`,
      ];
    })
  );
  fillSelect(
    fb.type,
    Object.keys(INFRA)
      .filter((k) => INFRA[k].buildable !== false)
      .map((k) => {
        const c = Game.buildCost(me, k, fb.zone.value);
        const rares = Object.entries(c.rares).map(([r, n]) => ` + ${n} ${RARES[r]}`).join("");
        return [k, `${INFRA[k].name} (${c.money} ₵ + ${c.material} mét.${rares})${c.heavyLaunch ? " ×3 lancement" : c.local ? " sur place" : ""}${INFRA[k].tech && !Game.hasTech(me, INFRA[k].tech) ? " 🔒" : ""}`];
      })
  );
  const zoneLocked = Game.zone(fb.zone.value).reachTech && !Game.hasTech(me, Game.zone(fb.zone.value).reachTech);
  const d = INFRA[fb.type.value];
  const z = Game.zone(fb.zone.value);
  const prod = Object.entries(d.prod).map(([k, v]) =>
    k === "zoneYield" ? Object.entries(z.yield).map(([r, n]) => `+${n} ${RARES[r]}`).join(", ") || "rien ici" : k === "material" ? `+${v * (fb.type.value === "mine" ? z.metals : 1)} ${MATERIAL.toLowerCase()}` : `+${v} ${{ money: "₵", ergols: "ergols" }[k] || k}`
  );
  const zoneWarning = zoneLocked ? `⚠ Trop loin : nécessite ${TECHS[z.reachTech].name} · ` : "";
  const station = Game.fuelStationFor(S, me, z.id);
  $("[data-hint=build]").textContent = [
    zoneWarning + (d.desc || ""),
    `${prod.join(", ") || "aucune production"} / tour`,
    `pollution ${z.id === "terre" ? d.pollution : `0 (lancement : ${fmt(z.tier * CONFIG.launchPollution)} une fois)`}`,
    `visibilité ${d.visibility}`,
    d.upkeep ? `consomme ${Object.entries(d.upkeep).map(([r, n]) => `${n} ${RARES[r]}`).join(", ")} / tour` : "",
    `entretien ${CONFIG.maintenance} ₵/tour`,
    station ? `station de ${station.name} : ergols à ${station.fuelFee} ₵` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  fillSelect(
    fb.infra,
    me.infras.filter((i) => i.type !== "base").map((i) => [i.id, `${INFRA[i.type].name} · ${Game.zone(i.zone).name}${i.zone === "terre" ? ` (pollution ${INFRA[i.type].pollution})` : ""}`])
  );

  // marché
  const fm = $("#f-market");
  fillSelect(fm.rare, [["material", MATERIAL], ...Object.entries(RARES)]);
  if (document.activeElement !== fm.fuelFee) fm.fuelFee.value = me.fuelFee;
  const isMaterial = fm.rare.value === "material";
  if (document.activeElement !== fm.price) fm.price.value = isMaterial ? me.materialPrice : me.prices[fm.rare.value];
  fillSelect(
    fm.seller,
    S.players
      .filter((p) => p !== me && Game.isActive(p))
      .map((p) =>
        isMaterial
          ? [p.id, `${p.name} — ${p.material} dispo à ${p.materialPrice} ₵`]
          : [p.id, `${p.name} — ${p.rares[fm.rare.value] || 0} dispo à ${p.prices[fm.rare.value]} ₵`]
      )
  );
  $("[data-hint=market]").textContent = isMaterial
    ? `Prix moyen des ${MATERIAL.toLowerCase()} : ${fmt(Game.materialPrice(S))} ₵`
    : `Prix moyen ${RARES[fm.rare.value]} : ${fmt(Game.marketPrice(S, fm.rare.value))} ₵`;

  // projets communs
  const fp = $("#f-project");
  fillSelect(fp.type, Object.entries(PROJECTS).map(([k, v]) => [k, `${v.name} (${Game.describeBundle(S, Game.normBundle(v.cost))})`]));
  fillSelect(fp.zone, ZONES.filter((z) => Object.keys(z.yield).length && Game.zoneOpen(S, z)).map((z) => [z.id, z.name]));
  fp.zone.disabled = !PROJECTS[fp.type.value].zone;
  $("[data-hint=project-type]").textContent = PROJECTS[fp.type.value].desc;
  fillSelect(
    fp.project,
    S.projects.filter((pr) => pr.status === "en cours" || pr.type === "armada").map((pr) => [pr.id, `${pr.name}${pr.zone ? ` (${Game.zone(pr.zone).name})` : ""} #${pr.id} — ${pr.status}`])
  );
  fillSelect(fp.rare, Object.entries(RARES).map(([r, n]) => [r, `${n} (${me.rares[r] || 0})`]));
  fillSelect(fp.target, others);
  const pr = S.projects.find((x) => x.id === +fp.project.value);
  $("[data-hint=project]").textContent = !pr
    ? "Aucun projet en cours"
    : pr.status === "en cours"
      ? `Reste à financer : ${Game.describeBundle(S, Game.projectRemaining(pr))}`
      : pr.type === "armada"
        ? `Armada de ${P(pr.controller).name}, mode ${pr.mode}, force ${Game.armadaStrength(S, pr)}`
        : "";

  // troc
  const ft = $("#f-trade");
  fillSelect(ft.to, others);
  for (const fs of $$("fieldset", ft)) {
    const who = fs.dataset.side === "give" ? me : P(+ft.to.value) || me;
    fillSelect(fs.querySelector("[name=rare]"), Object.entries(RARES).map(([r, n]) => [r, `${n} (${who.rares[r] || 0})`]));
    fillSelect(fs.querySelector("[name=tech]"), [["", "—"], ...who.techs.map((t) => [t, TECHS[t].name])]);
    fillSelect(
      fs.querySelector("[name=shareCo]"),
      S.players.filter((c) => Game.isActive(c) && c.shares[who.id]).map((c) => [c.id, `${c.name} (${c.shares[who.id]})`])
    );
  }

  // prêt
  fillSelect($("#f-loan").other, others);

  // rachat
  const fo = $("#f-buyout");
  fillSelect(fo.target, others);
  const t = +fo.target.value;
  $("[data-hint=buyout]").textContent = Number.isNaN(t) || !P(t) ? "" : Game.canBuyout(S, actor, t).msg;
}

function bundleFrom(fs) {
  const v = (n) => fs.querySelector(`[name=${n}]`).value;
  const b = { money: +v("money"), material: +v("material"), rares: {}, techs: [], shares: {} };
  if (+v("rareQty") > 0) b.rares[v("rare")] = +v("rareQty");
  if (v("tech")) b.techs.push(v("tech"));
  if (+v("shareQty") > 0 && v("shareCo") !== "") b.shares[v("shareCo")] = +v("shareQty");
  return b;
}

function bindActions() {
  $("#btn-new").onclick = newGame;
  $("#btn-end").onclick = () => run(() => Game.endTurn(S));
  $("#btn-sim").onclick = () => simulate(5);
  $("#btn-sim-end").onclick = () => simulate(CONFIG.maxTurns);
  $("#actor").onchange = (e) => {
    actor = +e.target.value;
    render();
  };

  $("#players").addEventListener("click", (e) => {
    if (e.target.closest("select")) return;
    const card = e.target.closest("[data-player]");
    if (!card) return;
    actor = +card.dataset.player;
    render();
  });
  $("#players").addEventListener("change", (e) => {
    const id = e.target.dataset.strategy;
    if (id === undefined) return;
    P(id).strategy = e.target.value;
    render();
  });

  const fr = $("#f-research");
  fr.onsubmit = (e) => {
    e.preventDefault();
    run(() => Game.assignResearch(S, actor, fr.tech.value, fr.researchers.value));
  };
  $("[data-act=stop]", fr).onclick = () => run(() => Game.assignResearch(S, actor, fr.tech.value, 0));
  fr.tech.onchange = renderActions;
  $("[data-act=hire]", fr).onclick = () => run(() => Game.hire(S, actor, fr.hireQty.value));
  $("[data-act=fire]", fr).onclick = () => run(() => Game.fire(S, actor, fr.hireQty.value));

  const fb = $("#f-build");
  fb.onsubmit = (e) => {
    e.preventDefault();
    run(() => Game.build(S, actor, fb.type.value, fb.zone.value, fb.mode.value));
  };
  fb.type.onchange = renderActions;
  fb.zone.onchange = renderActions;
  $("[data-act=dismantle]", fb).onclick = () => run(() => Game.dismantle(S, actor, fb.infra.value));

  const fm = $("#f-market");
  fm.onsubmit = (e) => {
    e.preventDefault();
    if (fm.rare.value === "material") run(() => Game.buyMaterial(S, actor, +fm.seller.value, fm.qty.value));
    else run(() => Game.buyRare(S, actor, +fm.seller.value, fm.rare.value, fm.qty.value));
  };
  $("[data-act=price]", fm).onclick = () =>
    run(() =>
      fm.rare.value === "material" ? Game.setMaterialPrice(S, actor, fm.price.value) : Game.setPrice(S, actor, fm.rare.value, fm.price.value)
    );
  $("[data-act=fuel]", fm).onclick = () => run(() => Game.setFuelFee(S, actor, fm.fuelFee.value));
  fm.rare.onchange = () => {
    const me = P(actor);
    fm.price.value = fm.rare.value === "material" ? me.materialPrice : me.prices[fm.rare.value];
    renderActions();
  };

  const fp = $("#f-project");
  fp.type.onchange = renderActions;
  fp.project.onchange = renderActions;
  $("[data-act=create]", fp).onclick = () => run(() => Game.createProject(S, actor, fp.type.value, fp.zone.value));
  $("[data-act=pledge]", fp).onclick = () => run(() => Game.pledge(S, actor, +fp.project.value, fp.pledge.value));
  $("[data-act=mode]", fp).onclick = () => run(() => Game.setArmadaMode(S, actor, +fp.project.value, fp.mode.value));
  $("[data-act=attack]", fp).onclick = () => run(() => Game.attack(S, actor, +fp.project.value, +fp.target.value));
  fp.onsubmit = (e) => {
    e.preventDefault();
    const rares = +fp.rareQty.value > 0 ? { [fp.rare.value]: +fp.rareQty.value } : {};
    run(() => Game.contribute(S, actor, +fp.project.value, { money: fp.money.value, material: fp.material.value, rares }));
  };

  const ft = $("#f-trade");
  ft.to.onchange = renderActions;
  ft.onsubmit = (e) => {
    e.preventDefault();
    const [give, want] = $$("fieldset", ft).map(bundleFrom);
    run(() => Game.proposeTrade(S, actor, +ft.to.value, give, want, ft.note.value.trim()));
  };

  const fl = $("#f-loan");
  fl.onsubmit = (e) => {
    e.preventDefault();
    run(() =>
      Game.proposeLoan(S, actor, +fl.other.value, {
        lender: fl.dir.value,
        principal: { money: fl.money.value, material: fl.material.value },
        repay: fl.repay.value,
        due: fl.due.value === "" ? null : fl.due.value,
      })
    );
  };

  const fo = $("#f-buyout");
  fo.target.onchange = renderActions;
  fo.onsubmit = (e) => {
    e.preventDefault();
    run(() => Game.buyout(S, actor, +fo.target.value));
  };

  document.body.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-offer],[data-loan]");
    if (!btn) return;
    const id = +(btn.dataset.offer || btn.dataset.loan);
    const fn = {
      accept: Game.acceptOffer,
      refuse: Game.refuseOffer,
      cancel: Game.cancelOffer,
      repay: Game.repayLoan,
      forgive: Game.forgiveLoan,
    }[btn.dataset.do];
    run(() => fn(S, id));
  });

  $("#log-filter").onchange = renderLog;
  $("#log-type").onchange = renderLog;
}

// ------------------------------------------------ menaces et projets

function renderThreats() {
  const k = Game.pooledKnowledge(S, "PRO-10");
  const deflector = S.players.find((p) => Game.hasTech(p, "PRO-10"));
  const nextFleet = CONFIG.fleetStrength + CONFIG.fleetGrowth * S.fleets;
  const fleets = S.fleet
    ? `<strong class="bad">force ${S.fleet.strength}, ${S.turn < S.fleet.arrival ? `arrive au tour ${S.fleet.arrival}` : `ravage le système jusqu'au tour ${S.fleet.leaves}`}</strong>`
    : S.projectiles
      ? `prochaine vague de la forêt sombre : une flotte de force ${nextFleet}${S.fleets ? ` (${S.fleets} déjà venue(s))` : ""}`
      : `<span class="muted">après le premier projectile</span>`;
  const defense = S.players
    .filter(Game.isActive)
    .map((p) => `${p.name} ${Game.defenseOf(S, p)}`)
    .join(" · ");
  const ages = Object.keys(AGES).map((a) => `${S.ageTurns[a] ? `<strong>${AGES[a].name}</strong> dès T${S.ageTurns[a]}` : `<span class="muted">${AGES[a].name}</span>`}`).join(" → ");
  $("#threats").innerHTML = `
    <p>${ages}</p>
    <table>
      <tr><th>Forêt sombre</th><td>${forestLabel()}${S.projectiles ? ` · ${S.projectiles} projectile(s), ${S.deviations} dévié(s)` : ""}</td></tr>
      <tr><th>Distorsion (PRO-10)</th><td>${
        deflector
          ? `<span class="good">maîtrisée par ${S.players.filter((p) => Game.hasTech(p, "PRO-10")).map((p) => p.name).join(", ")}</span>`
          : `participants : ${k.parts.map((p) => p.name).join(", ") || "aucun"} · ${fmt(k.eff)} chercheurs équivalents · ${
              k.missing.length ? `<span class="warn">il manque ${k.missing.map((r) => TECHS[r].name).join(", ")}</span>` : "savoir réuni"
            } · ${k.tooled ? "chantier de distorsion achevé" : `<span class="warn">pas de chantier de distorsion</span>`} · <strong>${Math.round(k.chance * 100)} %/tour</strong>`
      }</td></tr>
      <tr><th>Flottes extraterrestres</th><td>${fleets} · défense des joueurs (armadas) : ${defense}</td></tr>
      <tr><th>Repli possible</th><td>${
        S.players
          .filter(Game.isActive)
          .map((p) => {
            const outer = p.infras.filter((i) => !Game.zone(i.zone).inner).length;
            return `${p.name} : ${outer ? `<span class="good">${outer} infra(s) extérieure(s)</span>` : ZONES.some((z) => !z.inner && Game.hasTech(p, z.reachTech)) ? "à portée" : `<span class="muted">hors de portée</span>`}`;
          })
          .join(" · ")
      }</td></tr>
    </table>`;
}

function renderProjects() {
  if (!S.projects.length) {
    $("#projects").innerHTML = `<p class="muted">Aucun projet commun lancé.</p>`;
    return;
  }
  $("#projects").innerHTML = `<table>
    <tr><th>Projet</th><th>Statut</th><th>Apports (valeur)</th><th>Promesses</th><th>Reste / contrôle</th></tr>
    ${[...S.projects]
      .reverse()
      .map((pr) => {
        const contrib = Object.entries(pr.contrib).map(([id, v]) => `${P(id).name} ${Math.round(v)}${pr.status === "achevé" ? ` (${Math.round(Game.projectShare(pr, +id) * 100)} %)` : ""}`).join(", ");
        const pledges = Object.entries(pr.pledges)
          .map(([id, v]) => {
            const paid = pr.contrib[id] || 0;
            return `<span class="${paid >= v ? "good" : "warn"}">${P(id).name} ${v} (versé ${Math.round(paid)})</span>`;
          })
          .join(", ");
        const tail = pr.status === "en cours" ? Game.describeBundle(S, Game.projectRemaining(pr)) : pr.type === "armada" ? `${P(pr.controller).name} — mode ${pr.mode}, force ${Game.armadaStrength(S, pr)}` : P(pr.controller).name;
        return `<tr><td>${pr.name}${pr.zone ? ` · ${Game.zone(pr.zone).name}` : ""} <span class="muted">#${pr.id}, T${pr.turn}</span></td><td>${pr.status}</td><td>${contrib || "—"}</td><td>${pledges || "—"}</td><td>${tail}</td></tr>`;
      })
      .join("")}
  </table>`;
}

// --------------------------------------------------- offres et prêts

function offerText(o) {
  if (o.kind === "prêt") {
    const terms = o.due ? `→ ${o.repay} ₵ au tour ${o.due}` : o.repay ? `→ ${o.repay} ₵, libre` : "sans remboursement";
    return `<strong>prêt</strong> ${P(o.lender).name} → ${P(o.borrower).name} : ${Game.describeBundle(S, o.principal)} ${terms}`;
  }
  return `donne ${Game.describeBundle(S, o.give)} contre ${Game.describeBundle(S, o.want)}${o.note ? ` <span class="muted">« ${esc(o.note)} »</span>` : ""}`;
}

function renderOffers() {
  const pending = S.offers.filter((o) => o.status === "en attente");
  const recent = S.offers.filter((o) => o.status !== "en attente").slice(-8).reverse();
  const row = (o) => `<tr>
    <td>T${o.turn}</td>
    <td>${P(o.from).name} → ${P(o.to).name}</td>
    <td>${offerText(o)}</td>
    <td>${o.status === "en attente"
      ? `<button class="small" data-offer="${o.id}" data-do="accept">Accepter</button> <button class="small" data-offer="${o.id}" data-do="refuse">Refuser</button> <button class="small" data-offer="${o.id}" data-do="cancel" title="Annulé par ${P(o.from).name}">×</button>`
      : `<span class="${o.status === "acceptée" ? "good" : "muted"}">${o.status}</span>`}</td>
  </tr>`;
  $("#offers").innerHTML = `<table>
    <tr><th>Tour</th><th>De → à</th><th>Contenu</th><th></th></tr>
    ${pending.map(row).join("") || `<tr><td colspan="4" class="muted">Aucune offre en attente</td></tr>`}
    ${recent.length ? `<tr><th colspan="4">Récemment traitées</th></tr>${recent.map(row).join("")}` : ""}
  </table>`;
}

function renderLoans() {
  const loans = [...S.loans].reverse();
  $("#loans").innerHTML = `<table>
    <tr><th>Prêteur → emprunteur</th><th>Prêté</th><th>Dû</th><th>Échéance</th><th>Statut</th><th></th></tr>
    ${loans
      .map((l) => {
        const open = Game.outstanding(l) > 0;
        const cls = { défaut: "bad", perdu: "bad", remboursé: "good", "remboursé en retard": "warn" }[l.status] || "";
        return `<tr>
          <td>${P(l.lender).name} → ${P(l.borrower).name}</td>
          <td>${Game.describeBundle(S, l.principal)}</td>
          <td class="num">${l.repay || "—"}</td>
          <td>${l.due ? `T${l.due}` : "libre"}</td>
          <td class="${cls}">${l.status}</td>
          <td>${open ? `<button class="small" data-loan="${l.id}" data-do="repay">Rembourser</button> <button class="small" data-loan="${l.id}" data-do="forgive">Effacer</button>` : ""}</td>
        </tr>`;
      })
      .join("") || `<tr><td colspan="6" class="muted">Aucun prêt</td></tr>`}
  </table>`;
}

// -------------------------------------------------------- relations

function renderRelations() {
  const ps = S.players;
  const net = (a, b) => S.rel[b.id][a.id].paid - S.rel[a.id][b.id].paid;
  const head = ps.map((p) => `<th>${p.name}</th>`).join("");
  const rows = ps
    .map((a) => {
      let totalNet = 0;
      let caused = 0;
      let suffered = 0;
      const cells = ps
        .map((b) => {
          if (a === b) return `<td class="muted">—</td>`;
          const n = net(a, b);
          totalNet += n;
          const r = S.rel[a.id][b.id];
          caused += r.damage;
          suffered += S.rel[b.id][a.id].damage;
          const marks = [];
          if (r.damage) marks.push(`<span class="bad" title="dégâts causés à ${b.name}">⚔${r.damage}</span>`);
          if (r.defaults) marks.push(`<span class="warn" title="défauts de paiement envers ${b.name}">✗${r.defaults}</span>`);
          if (r.repaid) marks.push(`<span class="good" title="remboursements à ${b.name}">✓${r.repaid}</span>`);
          return `<td>${signed(n)}<br>${marks.join(" ")}</td>`;
        })
        .join("");
      return `<tr><th>${a.name}</th>${cells}<td>${signed(totalNet)}</td><td class="num">${caused}</td><td class="num">${suffered}</td></tr>`;
    })
    .join("");
  $("#relations").innerHTML = `
    <p class="muted">Ligne = ce que le joueur a gagné (valeur nette en ₵) grâce à la colonne : échanges, achats au-dessus du prix de référence, prêts non remboursés, dividendes, rachats.
    ⚔ dégâts causés · ✗ défauts de paiement · ✓ remboursements.</p>
    <table class="matrix"><tr><th>gagne sur ↓ / →</th>${head}<th>Net</th><th>⚔ causés</th><th>⚔ subis</th></tr>${rows}</table>`;
}

// ------------------------------------------------------- indicateurs

function renderIndicators() {
  const ps = S.players;
  const offers = S.offers;
  const trocs = offers.filter((o) => o.kind === "troc");
  const accepted = trocs.filter((o) => o.status === "acceptée").length;
  const claims = trocs.filter((o) => Game.bundleValue(S, o.give) === 0);

  // 1. rareté → négociation
  const volume = (a, b) => S.trades.filter((t) => t.buyer === a.id && t.seller === b.id).reduce((x, t) => x + t.qty, 0);
  const tradeRows = ps.map((a) => `<tr><th>${a.name}</th>${ps.map((b) => `<td>${a === b ? "—" : volume(a, b) || ""}</td>`).join("")}</tr>`).join("");
  const priceTrend = Object.keys(RARES)
    .map((r) => {
      const cells = ps.map((p) => {
        const past = S.history[Math.max(0, S.history.length - 4)].prices[p.id][r];
        const now = p.prices[r];
        return `<td>${now}${now !== past ? ` <small>${signed(now - past)}</small>` : ""}</td>`;
      });
      return `<tr><th>${RARES[r]}</th>${cells.join("")}</tr>`;
    })
    .join("");

  // 2. prêts
  const byStatus = {};
  for (const l of S.loans) byStatus[l.status] = (byStatus[l.status] || 0) + 1;
  const reliability = ps
    .map((p) => {
      const mine = S.loans.filter((l) => l.borrower === p.id && l.status !== "don");
      if (!mine.length) return "";
      const onTime = mine.filter((l) => l.status === "remboursé").length;
      const bad = mine.filter((l) => ["défaut", "perdu", "remboursé en retard"].includes(l.status)).length;
      return `<tr><th>${p.name}</th><td class="num">${mine.length}</td><td class="num good">${onTime}</td><td class="num bad">${bad}</td></tr>`;
    })
    .join("");

  // 3. conflit
  const conflicts = S.log.filter((l) => l.type === "conflit");
  const voluntary = conflicts.filter((l) => l.text.includes("volontairement")).length;
  const accidental = conflicts.filter((l) => l.text.includes("accidentellement")).length;
  const broken = S.log.filter((l) => l.type === "trahison");
  const claimsAccepted = claims.filter((o) => o.status === "acceptée").length;

  // 4. spécialisation
  // technos possédées par branche : une spécialisation se lit en colonnes déséquilibrées
  const techRows = Object.entries(TECH_CATEGORIES)
    .map(([c, name]) => {
      const total = Object.values(TECHS).filter((t) => t.category === c).length;
      return `<tr><th>${name} <span class="muted">/${total}</span></th>${ps.map((p) => `<td>${p.techs.filter((t) => TECHS[t].category === c).length || ""}</td>`).join("")}</tr>`;
    })
    .join("");
  const bought = (p) => S.trades.filter((t) => t.buyer === p.id).reduce((x, t) => x + t.qty, 0);

  // 5. monopole
  const shareRows = ps
    .filter((c) => Game.isActive(c))
    .map((c) => {
      const first = S.history[0].sharePrice[c.id];
      const now = Game.sharePrice(S, c);
      return `<tr><th>${c.name}</th>${ps.map((h) => `<td>${c.shares[h.id] ? `${c.shares[h.id]}` : ""}</td>`).join("")}<td>${now.toFixed(2)} <small>${signed(now - first)}</small></td></tr>`;
    })
    .join("");
  const head = ps.map((p) => `<th>${p.name}</th>`).join("");

  $("#indicators").innerHTML = `
    <div>
      <h3>La rareté crée-t-elle de la négociation ?</h3>
      <p>${S.trades.length} achats au marché · ${trocs.length} trocs proposés, ${accepted} acceptés (${trocs.length ? Math.round((accepted / trocs.length) * 100) : 0} %)</p>
      <table class="matrix"><tr><th>acheteur ↓ / vendeur →</th>${head}</tr>${tradeRows}</table>
      <h3>Prix affichés <small>(variation sur 3 tours)</small></h3>
      <table class="matrix"><tr><th></th>${head}</tr>${priceTrend}</table>
    </div>
    <div>
      <h3>Les prêts sont-ils respectés ?</h3>
      <p>${Object.entries(byStatus).map(([k, v]) => `${k} : <strong>${v}</strong>`).join(" · ") || "Aucun prêt"}</p>
      <table><tr><th>Emprunteur</th><th>Prêts</th><th>À l'heure</th><th>Défaut / retard</th></tr>${reliability || `<tr><td colspan="4" class="muted">—</td></tr>`}</table>
    </div>
    <div>
      <h3>Le conflit opportuniste : dynamique ou frustration ?</h3>
      <p>Incidents : <strong class="bad">${voluntary}</strong> volontaires · <strong>${accidental}</strong> accidentels · attaques d'armada : ${S.log.filter((l) => l.type === "armada" && l.text.includes("attaque")).length}</p>
      <p>Demandes de compensation : ${claims.length} (${claimsAccepted} acceptées, ${claims.filter((o) => o.status === "refusée").length} refusées)</p>
      <p class="muted">Voir la matrice « qui lèse qui » : ⚔ causés vs subis, puis les échanges qui suivent (représailles, compensation, silence).</p>
    </div>
    <div>
      <h3>Coopérer ou se replier face à la forêt sombre ?</h3>
      <p>Projectiles : ${S.projectiles} · déviés : ${S.deviations} · Soleil ${S.sunDestroyed ? `<strong class="bad">détruit</strong>` : "intact"}</p>
      <table><tr><th></th><th>Chercheurs sur PRO-10</th><th>Versé aux projets</th><th>Promis non versé</th><th>Infras extérieures</th></tr>
        ${ps
          .map((p) => {
            const paid = S.projects.reduce((a, pr) => a + (pr.contrib[p.id] || 0), 0);
            const unpaid = S.projects.reduce((a, pr) => a + Math.max(0, (pr.pledges[p.id] || 0) - (pr.contrib[p.id] || 0)), 0);
            return `<tr><th>${p.name}</th><td class="num">${Game.staffOn(p, "PRO-10").length}</td><td class="num">${Math.round(paid)}</td><td class="num ${unpaid ? "warn" : ""}">${Math.round(unpaid)}</td><td class="num">${p.infras.filter((i) => !Game.zone(i.zone).inner).length}</td></tr>`;
          })
          .join("")}
      </table>
      <p class="muted">${broken.length} promesse(s) non tenue(s) à l'achèvement d'un projet.</p>
    </div>
    <div>
      <h3>La spécialisation émerge-t-elle ?</h3>
      <table class="matrix"><tr><th></th>${head}</tr>${techRows}
        <tr><th>Rares achetés</th>${ps.map((p) => `<td>${bought(p)}</td>`).join("")}</tr>
        <tr><th>Infras hors base</th>${ps.map((p) => `<td>${p.infras.length - (p.infras.some((i) => i.type === "base") ? 1 : 0)}</td>`).join("")}</tr>
      </table>
    </div>
    <div>
      <h3>Le monopole est-il lisible ?</h3>
      <table class="matrix"><tr><th>entreprise ↓ / détenteur →</th>${head}<th>₵/part</th></tr>${shareRows}</table>
      <p class="muted">Rachat possible à ${CONFIG.buyoutMajority} parts ou en faillite (${CONFIG.bankruptTurns} tours dans le rouge).</p>
    </div>`;
}

// ------------------------------------------------------------- journal

function renderLog() {
  const fp = $("#log-filter");
  const ft = $("#log-type");
  fillSelect(fp, [["", "tous les joueurs"], ...S.players.map((p) => [p.id, p.name])]);
  const types = [...new Set(S.log.map((l) => l.type))].sort();
  fillSelect(ft, [["", "tous les types"], ...types.map((t) => [t, t])]);
  const who = fp.value === "" ? null : +fp.value;
  const type = ft.value;
  const entries = S.log.filter((l) => (who === null || l.ids.includes(who)) && (!type || l.type === type)).slice(-400).reverse();
  $("#log").innerHTML = entries.map((l) => `<li class="${esc(l.type)}"><span class="t">T${l.turn}</span><span class="k">${esc(l.type)}</span>${esc(l.text)}</li>`).join("");
}

bindActions();
newGame();
