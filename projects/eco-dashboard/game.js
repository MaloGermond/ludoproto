// POC mécaniques socio-économiques — issue #12
// Modèle de jeu pur (aucun DOM) : ressources, recherche, infrastructures,
// marché, troc, prêts, parts d'entreprise, conflit opportuniste, forêt
// sombre et conditions de fin. Les chiffres sont volontairement approximatifs.

(function (root) {
  const RARES = {
    lune: "Pierre lunaire",
    he3: "Hélium-3",
    cristal: "Cristaux",
    glace: "Glace cométaire",
  };

  // pas de position réelle : une zone n'est qu'un "lieu" où les
  // infrastructures de joueurs différents peuvent se gêner.
  const ZONES = [
    { id: "lune", name: "Lune", rare: "lune" },
    { id: "geante", name: "Géante gazeuse", rare: "he3" },
    { id: "ceinture", name: "Ceinture", rare: "cristal" },
    { id: "comete", name: "Comète", rare: "glace" },
    { id: "orbite", name: "Orbite basse", rare: null },
  ];

  const CONFIG = {
    maxTurns: 20,
    startMoney: 40,
    startMaterial: 30,
    startRare: 3,
    bankerStartMoney: 80, // joueur sans ressource rare (Orbite basse) : le financeur
    maintenance: 2, // argent / infrastructure / tour (hors base)
    shares: 100,
    dividendRate: 0.2, // part de l'argent produit reversée aux actionnaires
    incidentBase: 0.05, // risque par tour d'abîmer un voisin, placement prudent
    incidentAggressive: 0.2, // risque par tour d'abîmer un voisin, placement agressif
    planetHealth: 100,
    pollutionRegen: 12,
    darkForestStart: 8, // tour où la forêt sombre commence à frapper
    darkForestStep: 0.05, // +5 % de risque de frappe par tour ensuite
    darkForestMax: 0.6,
    bankruptTurns: 2, // tours consécutifs en négatif avant la faillite
    researchCostScale: 0.5, // chaque techno possédée renchérit les suivantes de +50 %
    defaultRarePrice: 5,
    buyoutMajority: 51,
    offerTTL: 2, // tours avant qu'une offre non traitée expire
  };

  const INFRA = {
    base: { name: "Base", cost: {}, hp: 3, prod: { money: 10, material: 8, homeRare: 1 }, pollution: 0.5, visibility: 2, buildable: false },
    mine: { name: "Mine", cost: { money: 10, material: 10 }, hp: 2, prod: { material: 6 }, pollution: 1.5, visibility: 1 },
    comptoir: { name: "Comptoir", cost: { money: 15, material: 15, rares: { he3: 1 } }, hp: 2, prod: { money: 8 }, pollution: 0.5, visibility: 2 },
    labo: { name: "Laboratoire", cost: { money: 20, material: 10, rares: { cristal: 1 } }, hp: 2, prod: { research: 4 }, pollution: 0.5, visibility: 1 },
    extracteur: { name: "Extracteur", cost: { money: 15, material: 20, rares: { lune: 1 } }, hp: 2, prod: { zoneRare: 2 }, pollution: 3, visibility: 2, tech: "forage" },
    reacteur: { name: "Réacteur à fusion", cost: { money: 25, material: 25, rares: { glace: 1 } }, hp: 2, prod: { money: 14, material: 4 }, upkeep: { he3: 1 }, pollution: 0, visibility: 3, tech: "fusion" },
  };

  const TECHS = {
    logistique: { name: "Logistique", rp: 15, rare: {}, desc: "-25 % sur le coût de construction" },
    forage: { name: "Forage profond", rp: 20, rare: { cristal: 2 }, desc: "Débloque l'extracteur (ressource rare de la zone)" },
    blindage: { name: "Blindage", rp: 20, rare: { lune: 2 }, desc: "Divise par 2 le risque de dégâts par empiètement" },
    recyclage: { name: "Recyclage", rp: 20, rare: { glace: 2 }, desc: "Divise par 2 la pollution de vos infrastructures" },
    furtivite: { name: "Furtivité", rp: 25, rare: { glace: 1, lune: 1 }, desc: "Divise par 2 votre visibilité (forêt sombre)" },
    fusion: { name: "Fusion", rp: 30, rare: { he3: 3 }, desc: "Débloque le réacteur à fusion (consomme 1 He-3 / tour)" },
    armement: { name: "Armement", rp: 30, rare: { lune: 1, cristal: 2 }, desc: "Double le risque causé par vos placements agressifs" },
  };

  const NAMES = ["Aurora", "Borealis", "Cygnus", "Draco", "Eridan"];
  const HOMES = ["lune", "geante", "ceinture", "comete", "orbite"];
  const ACTIVE = ["actif", "faillite"];

  // ---------------------------------------------------------------- utils

  function rand(s) {
    // mulberry32 : parties reproductibles à partir d'une graine
    s.rng = (s.rng + 0x6d2b79f5) | 0;
    let t = s.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const ok = (msg) => ({ ok: true, msg });
  const fail = (msg) => ({ ok: false, msg });
  const zone = (id) => ZONES.find((z) => z.id === id);
  const player = (s, id) => s.players[id];
  const isActive = (p) => p && ACTIVE.includes(p.status);
  const activePlayers = (s) => s.players.filter(isActive);
  const hasTech = (p, t) => p.techs.includes(t);

  function emptyBundle() {
    return { money: 0, material: 0, rares: {}, techs: [], shares: {} };
  }

  function normBundle(b) {
    const n = emptyBundle();
    if (!b) return n;
    n.money = Math.max(0, Math.floor(+b.money || 0));
    n.material = Math.max(0, Math.floor(+b.material || 0));
    for (const r in b.rares || {}) if (+b.rares[r] > 0) n.rares[r] = Math.floor(+b.rares[r]);
    n.techs = (b.techs || []).filter((t) => TECHS[t]);
    for (const c in b.shares || {}) if (+b.shares[c] > 0) n.shares[c] = Math.floor(+b.shares[c]);
    return n;
  }

  function isEmptyBundle(b) {
    return !b.money && !b.material && !Object.keys(b.rares).length && !b.techs.length && !Object.keys(b.shares).length;
  }

  function describeBundle(s, b) {
    const parts = [];
    if (b.money) parts.push(`${b.money} ₵`);
    if (b.material) parts.push(`${b.material} matière`);
    for (const r in b.rares) parts.push(`${b.rares[r]} ${RARES[r]}`);
    for (const t of b.techs) parts.push(`licence ${TECHS[t].name}`);
    for (const c in b.shares) parts.push(`${b.shares[c]} parts de ${player(s, c).name}`);
    return parts.length ? parts.join(", ") : "rien";
  }

  function log(s, type, text, ids = []) {
    s.log.push({ turn: s.turn, type, text, ids });
  }

  function canGive(s, p, b) {
    if (p.money < b.money) return fail(`${p.name} n'a pas ${b.money} ₵`);
    if (p.material < b.material) return fail(`${p.name} n'a pas ${b.material} matière`);
    for (const r in b.rares) if ((p.rares[r] || 0) < b.rares[r]) return fail(`${p.name} n'a pas ${b.rares[r]} ${RARES[r]}`);
    for (const t of b.techs) if (!hasTech(p, t)) return fail(`${p.name} ne possède pas ${TECHS[t].name}`);
    for (const c in b.shares) {
      const comp = player(s, c);
      if (!comp || !comp.shares || (comp.shares[p.id] || 0) < b.shares[c]) return fail(`${p.name} n'a pas ${b.shares[c]} parts de ${comp ? comp.name : c}`);
    }
    return ok();
  }

  // les technologies sont données en licence : le donneur les garde
  function transfer(s, from, to, b) {
    from.money -= b.money;
    to.money += b.money;
    from.material -= b.material;
    to.material += b.material;
    for (const r in b.rares) {
      from.rares[r] -= b.rares[r];
      to.rares[r] = (to.rares[r] || 0) + b.rares[r];
    }
    for (const t of b.techs) if (!hasTech(to, t)) to.techs.push(t);
    for (const c in b.shares) {
      const comp = player(s, c);
      comp.shares[from.id] -= b.shares[c];
      if (!comp.shares[from.id]) delete comp.shares[from.id];
      comp.shares[to.id] = (comp.shares[to.id] || 0) + b.shares[c];
    }
    flow(s, from.id, to.id, bundleValue(s, b));
  }

  // rel[a][b] : ce que a a versé à b (valeur), dégâts que a a causés à b...
  function flow(s, a, b, value, key = "paid") {
    if (a === b) return;
    s.rel[a][b][key] += value;
  }

  // ------------------------------------------------------------ valuations

  function marketPrice(s, rare) {
    const prices = s.players.filter((p) => isActive(p) && (p.rares[rare] || 0) > 0).map((p) => p.prices[rare]);
    if (!prices.length) return CONFIG.defaultRarePrice;
    return prices.reduce((a, b) => a + b, 0) / prices.length;
  }

  function infraValue(i) {
    const d = INFRA[i.type];
    const v = i.type === "base" ? 60 : (d.cost.money || 0) + (d.cost.material || 0) * 0.5;
    return (v * i.hp) / d.hp;
  }

  function bundleValue(s, b) {
    let v = b.money + b.material * 0.5 + b.techs.length * 20;
    for (const r in b.rares) v += b.rares[r] * marketPrice(s, r);
    for (const c in b.shares) v += b.shares[c] * sharePrice(s, player(s, c));
    return v;
  }

  function outstanding(l) {
    return l.status === "en cours" || l.status === "défaut" ? l.repay : 0;
  }

  function debtOf(s, p) {
    return s.loans.filter((l) => l.borrower === p.id).reduce((a, l) => a + outstanding(l), 0);
  }

  function receivableOf(s, p) {
    return s.loans.filter((l) => l.lender === p.id).reduce((a, l) => a + outstanding(l), 0);
  }

  // valeur nette de l'entreprise, hors parts détenues chez les autres
  function equity(s, p) {
    if (!isActive(p)) return 0;
    let v = p.money + p.material * 0.5 + p.techs.length * 10 + p.research * 0.5;
    for (const r in p.rares) v += p.rares[r] * marketPrice(s, r);
    for (const i of p.infras) v += infraValue(i);
    return v + receivableOf(s, p) * 0.8 - debtOf(s, p);
  }

  function sharePrice(s, p) {
    if (!isActive(p)) return 0;
    return Math.max(0.1, equity(s, p) / CONFIG.shares);
  }

  function visibility(p) {
    const v = p.infras.reduce((a, i) => a + INFRA[i.type].visibility, 0);
    return hasTech(p, "furtivite") ? v / 2 : v;
  }

  function techCost(p, t) {
    return Math.round(TECHS[t].rp * (1 + CONFIG.researchCostScale * p.techs.length));
  }

  function buildCost(p, type) {
    const c = INFRA[type].cost;
    const k = hasTech(p, "logistique") ? 0.75 : 1;
    return { money: Math.ceil((c.money || 0) * k), material: Math.ceil((c.material || 0) * k), rares: { ...(c.rares || {}) } };
  }

  function darkForestRisk(s) {
    if (s.turn < CONFIG.darkForestStart) return 0;
    return Math.min(CONFIG.darkForestMax, CONFIG.darkForestStep * (s.turn - CONFIG.darkForestStart + 1));
  }

  // ------------------------------------------------------------- new game

  function newGame(opts = {}) {
    const n = Math.max(3, Math.min(5, opts.players || 4));
    const s = {
      turn: 1,
      seed: opts.seed || 1,
      rng: opts.seed || 1,
      planet: CONFIG.planetHealth,
      players: [],
      offers: [],
      loans: [],
      log: [],
      history: [],
      trades: [], // achats de ressource rare au marché
      rel: [],
      ended: null,
      nextId: 1,
    };
    for (let i = 0; i < n; i++) {
      const home = HOMES[i];
      const rare = zone(home).rare;
      const p = {
        id: i,
        name: NAMES[i],
        home,
        strategy: (opts.strategies && opts.strategies[i]) || "humain",
        money: rare ? CONFIG.startMoney : CONFIG.bankerStartMoney,
        material: CONFIG.startMaterial,
        research: 0,
        rares: {},
        prices: {},
        techs: [],
        infras: [],
        shares: { [i]: CONFIG.shares },
        status: "actif",
        brokeTurns: 0,
        endedBy: null,
      };
      for (const r in RARES) {
        p.rares[r] = r === rare ? CONFIG.startRare : 0;
        p.prices[r] = CONFIG.defaultRarePrice;
      }
      p.infras.push({ id: s.nextId++, type: "base", zone: home, hp: INFRA.base.hp, mode: "prudent", built: 0 });
      s.players.push(p);
    }
    s.rel = s.players.map(() => s.players.map(() => ({ paid: 0, damage: 0, damageValue: 0, defaults: 0, repaid: 0 })));
    log(s, "partie", `Nouvelle partie : ${n} joueurs, graine ${s.seed}`);
    snapshot(s);
    return s;
  }

  // -------------------------------------------------------------- actions

  function guard(s, p) {
    if (s.ended) return fail("La partie est terminée");
    if (!isActive(p)) return fail(`${p ? p.name : "?"} n'est plus en jeu`);
    return null;
  }

  // arbitrage irréversible : l'argent / la matière versés à la recherche sont perdus
  function invest(s, pid, money, material) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    money = Math.max(0, Math.floor(+money || 0));
    material = Math.max(0, Math.floor(+material || 0));
    if (!money && !material) return fail("Rien à investir");
    if (p.money < money || p.material < material) return fail("Ressources insuffisantes");
    p.money -= money;
    p.material -= material;
    p.research += money + material;
    log(s, "recherche", `${p.name} investit ${money} ₵ et ${material} matière dans la recherche`, [pid]);
    return ok("Investi");
  }

  function unlockTech(s, pid, t) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    if (!TECHS[t]) return fail("Technologie inconnue");
    if (hasTech(p, t)) return fail("Déjà débloquée");
    const cost = techCost(p, t);
    if (p.research < cost) return fail(`Il faut ${cost} points de recherche`);
    for (const r in TECHS[t].rare) if ((p.rares[r] || 0) < TECHS[t].rare[r]) return fail(`Il faut ${TECHS[t].rare[r]} ${RARES[r]}`);
    p.research -= cost;
    for (const r in TECHS[t].rare) p.rares[r] -= TECHS[t].rare[r];
    p.techs.push(t);
    log(s, "recherche", `${p.name} débloque ${TECHS[t].name}`, [pid]);
    return ok(`${TECHS[t].name} débloquée`);
  }

  function build(s, pid, type, zoneId, mode = "prudent") {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    const d = INFRA[type];
    if (!d || d.buildable === false) return fail("Infrastructure inconnue");
    if (!zone(zoneId)) return fail("Zone inconnue");
    if (d.tech && !hasTech(p, d.tech)) return fail(`Nécessite ${TECHS[d.tech].name}`);
    if (type === "extracteur" && !zone(zoneId).rare) return fail("Pas de ressource rare dans cette zone");
    const c = buildCost(p, type);
    if (p.money < c.money || p.material < c.material) return fail(`Coût : ${c.money} ₵ + ${c.material} matière`);
    for (const r in c.rares) if ((p.rares[r] || 0) < c.rares[r]) return fail(`Il faut ${c.rares[r]} ${RARES[r]}`);
    p.money -= c.money;
    p.material -= c.material;
    for (const r in c.rares) p.rares[r] -= c.rares[r];
    p.infras.push({ id: s.nextId++, type, zone: zoneId, hp: d.hp, mode, built: s.turn });
    const neighbours = s.players.filter((o) => o !== p && isActive(o) && o.infras.some((i) => i.zone === zoneId));
    const near = neighbours.length ? ` — à proximité de ${neighbours.map((o) => o.name).join(", ")}` : "";
    log(s, "construction", `${p.name} construit ${d.name} (${mode}) en ${zone(zoneId).name}${near}`, [pid, ...neighbours.map((o) => o.id)]);
    return ok(`Construction : ${d.name}`);
  }

  function setPrice(s, pid, rare, price) {
    const p = player(s, pid);
    const g = guard(s, p);
    if (g) return g;
    price = Math.max(1, Math.round(+price || 1));
    if (!RARES[rare] || p.prices[rare] === price) return ok();
    const old = p.prices[rare];
    p.prices[rare] = price;
    log(s, "prix", `${p.name} passe le prix de ${RARES[rare]} de ${old} à ${price} ₵`, [pid]);
    return ok("Prix mis à jour");
  }

  // marché : achat immédiat au prix affiché par le vendeur
  function buyRare(s, buyerId, sellerId, rare, qty) {
    const b = player(s, buyerId);
    const se = player(s, sellerId);
    const g = guard(s, b) || guard(s, se);
    if (g) return g;
    qty = Math.floor(+qty || 0);
    if (b === se) return fail("Impossible d'acheter à soi-même");
    if (qty <= 0) return fail("Quantité invalide");
    if ((se.rares[rare] || 0) < qty) return fail(`${se.name} n'a que ${se.rares[rare] || 0} ${RARES[rare]}`);
    const cost = qty * se.prices[rare];
    if (b.money < cost) return fail(`Il faut ${cost} ₵`);
    b.money -= cost;
    se.money += cost;
    se.rares[rare] -= qty;
    b.rares[rare] = (b.rares[rare] || 0) + qty;
    // valeur nette de l'échange : surcoût payé par rapport au prix moyen du marché
    flow(s, b.id, se.id, cost);
    flow(s, se.id, b.id, qty * CONFIG.defaultRarePrice);
    s.trades.push({ turn: s.turn, buyer: b.id, seller: se.id, rare, qty, price: se.prices[rare] });
    log(s, "marché", `${b.name} achète ${qty} ${RARES[rare]} à ${se.name} pour ${cost} ₵ (${se.prices[rare]} ₵/u)`, [b.id, se.id]);
    return ok("Achat effectué");
  }

  // troc : from propose de donner `give` contre `want`
  function proposeTrade(s, fromId, toId, give, want, note = "") {
    const from = player(s, fromId);
    const to = player(s, toId);
    const g = guard(s, from) || guard(s, to);
    if (g) return g;
    if (from === to) return fail("Choisir un autre joueur");
    give = normBundle(give);
    want = normBundle(want);
    if (isEmptyBundle(give) && isEmptyBundle(want)) return fail("Offre vide");
    const c = canGive(s, from, give);
    if (!c.ok) return c;
    const o = { id: s.nextId++, kind: "troc", from: fromId, to: toId, give, want, note, turn: s.turn, status: "en attente" };
    s.offers.push(o);
    const label = isEmptyBundle(give) ? "demande" : "propose";
    log(s, "offre", `${from.name} ${label} à ${to.name} : ${describeBundle(s, give)} contre ${describeBundle(s, want)}${note ? ` (« ${note} »)` : ""}`, [fromId, toId]);
    autoRespond(s, o);
    return ok("Offre envoyée");
  }

  // prêt : proposé par le prêteur ou demandé par l'emprunteur.
  // due = null → prêt sans condition de remboursement.
  function proposeLoan(s, fromId, toId, { lender, principal, repay, due, note = "" }) {
    const from = player(s, fromId);
    const to = player(s, toId);
    const g = guard(s, from) || guard(s, to);
    if (g) return g;
    if (from === to) return fail("Choisir un autre joueur");
    principal = normBundle({ money: principal.money, material: principal.material });
    if (isEmptyBundle(principal)) return fail("Montant vide");
    repay = Math.max(0, Math.floor(+repay || 0));
    const lenderId = lender === "from" ? fromId : toId;
    const borrowerId = lender === "from" ? toId : fromId;
    if (lenderId === fromId) {
      const c = canGive(s, from, principal);
      if (!c.ok) return c;
    }
    due = due === null || due === "" || due === undefined ? null : s.turn + Math.max(1, Math.floor(+due));
    const o = { id: s.nextId++, kind: "prêt", from: fromId, to: toId, lender: lenderId, borrower: borrowerId, principal, repay, due, note, turn: s.turn, status: "en attente" };
    s.offers.push(o);
    const terms = due ? `à rembourser ${repay} ₵ au tour ${due}` : repay ? `remboursement libre de ${repay} ₵` : "sans remboursement";
    const verb = lenderId === fromId ? "propose un prêt à" : "demande un prêt à";
    log(s, "offre", `${from.name} ${verb} ${to.name} : ${describeBundle(s, principal)}, ${terms}`, [fromId, toId]);
    autoRespond(s, o);
    return ok("Proposition de prêt envoyée");
  }

  function acceptOffer(s, offerId) {
    const o = s.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "en attente") return fail("Offre indisponible");
    const from = player(s, o.from);
    const to = player(s, o.to);
    const g = guard(s, from) || guard(s, to);
    if (g) return g;
    if (o.kind === "troc") {
      const c1 = canGive(s, from, o.give);
      if (!c1.ok) return c1;
      const c2 = canGive(s, to, o.want);
      if (!c2.ok) return c2;
      transfer(s, from, to, o.give);
      transfer(s, to, from, o.want);
      o.status = "acceptée";
      log(s, "échange", `${to.name} accepte : ${from.name} donne ${describeBundle(s, o.give)}, reçoit ${describeBundle(s, o.want)}`, [from.id, to.id]);
    } else {
      const lender = player(s, o.lender);
      const borrower = player(s, o.borrower);
      const c = canGive(s, lender, o.principal);
      if (!c.ok) return c;
      lender.money -= o.principal.money;
      lender.material -= o.principal.material;
      borrower.money += o.principal.money;
      borrower.material += o.principal.material;
      flow(s, lender.id, borrower.id, bundleValue(s, o.principal));
      const l = { id: s.nextId++, lender: lender.id, borrower: borrower.id, principal: o.principal, repay: o.repay, due: o.due, status: o.repay ? "en cours" : "don", turn: s.turn };
      s.loans.push(l);
      o.status = "acceptée";
      log(s, "prêt", `${lender.name} prête ${describeBundle(s, o.principal)} à ${borrower.name}${o.due ? ` (échéance tour ${o.due}, ${o.repay} ₵)` : ""}`, [lender.id, borrower.id]);
    }
    return ok("Offre acceptée");
  }

  function refuseOffer(s, offerId) {
    const o = s.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "en attente") return fail("Offre indisponible");
    o.status = "refusée";
    log(s, "offre", `${player(s, o.to).name} refuse l'offre de ${player(s, o.from).name}`, [o.from, o.to]);
    return ok("Offre refusée");
  }

  function cancelOffer(s, offerId) {
    const o = s.offers.find((x) => x.id === offerId);
    if (!o || o.status !== "en attente") return fail("Offre indisponible");
    o.status = "annulée";
    return ok("Offre annulée");
  }

  function repayLoan(s, loanId) {
    const l = s.loans.find((x) => x.id === loanId);
    if (!l || !outstanding(l)) return fail("Rien à rembourser");
    const b = player(s, l.borrower);
    const g = guard(s, b);
    if (g) return g;
    if (b.money < l.repay) return fail(`Il faut ${l.repay} ₵`);
    const lender = player(s, l.lender);
    b.money -= l.repay;
    lender.money += l.repay;
    flow(s, b.id, lender.id, l.repay);
    const late = l.status === "défaut";
    l.status = late ? "remboursé en retard" : "remboursé";
    s.rel[b.id][lender.id].repaid++;
    log(s, "prêt", `${b.name} rembourse ${l.repay} ₵ à ${lender.name}${late ? " (en retard)" : ""}`, [b.id, lender.id]);
    return ok("Remboursé");
  }

  function forgiveLoan(s, loanId) {
    const l = s.loans.find((x) => x.id === loanId);
    if (!l || !outstanding(l)) return fail("Rien à annuler");
    l.status = "annulé";
    log(s, "prêt", `${player(s, l.lender).name} efface la dette de ${player(s, l.borrower).name}`, [l.lender, l.borrower]);
    return ok("Dette effacée");
  }

  function buyoutCost(s, buyer, target) {
    const held = target.shares[buyer.id] || 0;
    return Math.ceil(sharePrice(s, target) * (CONFIG.shares - held));
  }

  function canBuyout(s, buyerId, targetId) {
    const b = player(s, buyerId);
    const t = player(s, targetId);
    if (!isActive(b) || !isActive(t) || b === t) return fail("Rachat impossible");
    const held = t.shares[b.id] || 0;
    if (t.status !== "faillite" && held < CONFIG.buyoutMajority) return fail(`${t.name} doit être en faillite, ou il faut ${CONFIG.buyoutMajority} parts (vous : ${held})`);
    const cost = buyoutCost(s, b, t);
    if (b.money < cost) return fail(`Il faut ${cost} ₵`);
    return ok(`Rachat possible pour ${cost} ₵`);
  }

  // le racheteur paie les autres actionnaires ; la part de l'entreprise
  // elle-même va à ses créanciers. Il absorbe ensuite tous ses actifs et dettes.
  function buyout(s, buyerId, targetId) {
    const g = guard(s, player(s, buyerId));
    if (g) return g;
    const c = canBuyout(s, buyerId, targetId);
    if (!c.ok) return c;
    const b = player(s, buyerId);
    const t = player(s, targetId);
    const price = sharePrice(s, t);
    for (const h in t.shares) {
      const hid = +h;
      if (hid === b.id) continue;
      const amount = Math.ceil(price * t.shares[h]);
      if (hid === t.id) {
        const debts = s.loans.filter((l) => l.borrower === t.id && outstanding(l) && l.lender !== b.id);
        const total = debts.reduce((a, l) => a + l.repay, 0);
        for (const l of debts) {
          const part = Math.floor((amount * l.repay) / total);
          b.money -= part;
          player(s, l.lender).money += part;
          flow(s, b.id, l.lender, part);
        }
      } else {
        b.money -= amount;
        player(s, hid).money += amount;
        flow(s, b.id, hid, amount);
      }
    }
    absorb(s, b, t);
    t.status = "racheté";
    t.endedBy = b.id;
    log(s, "rachat", `${b.name} rachète ${t.name} et absorbe ses actifs et ses dettes`, [b.id, t.id]);
    checkEnd(s);
    return ok(`${t.name} racheté`);
  }

  function absorb(s, b, t) {
    b.money += t.money;
    b.material += t.material;
    b.research += t.research;
    for (const r in t.rares) b.rares[r] = (b.rares[r] || 0) + t.rares[r];
    for (const tech of t.techs) if (!hasTech(b, tech)) b.techs.push(tech);
    for (const i of t.infras) b.infras.push(i);
    t.infras = [];
    t.money = t.material = t.research = 0;
    for (const r in t.rares) t.rares[r] = 0;
    for (const l of s.loans) {
      if (l.borrower === t.id) l.borrower = b.id;
      if (l.lender === t.id) l.lender = b.id;
      if (l.borrower === l.lender && outstanding(l)) l.status = "annulé";
    }
    for (const comp of s.players) {
      if (comp === t || !comp.shares[t.id]) continue;
      comp.shares[b.id] = (comp.shares[b.id] || 0) + comp.shares[t.id];
      delete comp.shares[t.id];
    }
    t.shares = {};
    for (const o of s.offers) if (o.status === "en attente" && (o.from === t.id || o.to === t.id)) o.status = "annulée";
  }

  function eliminate(s, p, byId, reason) {
    p.status = "détruit";
    p.endedBy = byId;
    p.infras = [];
    for (const l of s.loans) if (l.borrower === p.id && outstanding(l)) l.status = "perdu";
    for (const l of s.loans) if (l.lender === p.id && outstanding(l)) l.status = "annulé";
    for (const comp of s.players) delete comp.shares[p.id];
    p.shares = {};
    for (const o of s.offers) if (o.status === "en attente" && (o.from === p.id || o.to === p.id)) o.status = "annulée";
    log(s, "élimination", `${p.name} est détruit (${reason})`, byId != null ? [p.id, byId] : [p.id]);
  }

  // ---------------------------------------------------------- turn phases

  function produce(s, p) {
    const prod = { money: 0, material: 0, research: 0, rares: {} };
    for (const i of p.infras) {
      const d = INFRA[i.type];
      const eff = i.hp >= d.hp ? 1 : 0.5;
      if (d.upkeep) {
        const lacking = Object.keys(d.upkeep).find((r) => (p.rares[r] || 0) < d.upkeep[r]);
        if (lacking) {
          log(s, "pénurie", `${d.name} de ${p.name} à l'arrêt : manque de ${RARES[lacking]}`, [p.id]);
          continue;
        }
        for (const r in d.upkeep) p.rares[r] -= d.upkeep[r];
      }
      const home = zone(p.home);
      let baseMoney = d.prod.money || 0;
      if (i.type === "base" && !home.rare) baseMoney += 6; // le financeur n'a pas de rare, mais plus de revenus
      prod.money += Math.round(baseMoney * eff);
      prod.material += Math.round((d.prod.material || 0) * eff);
      prod.research += Math.round((d.prod.research || 0) * eff);
      const rare = d.prod.homeRare ? home.rare : d.prod.zoneRare ? zone(i.zone).rare : null;
      if (rare) prod.rares[rare] = (prod.rares[rare] || 0) + Math.round((d.prod.homeRare || d.prod.zoneRare) * eff);
    }
    const maintenance = (p.infras.length - 1) * CONFIG.maintenance;
    p.money += prod.money - maintenance;
    p.material += prod.material;
    p.research += prod.research;
    for (const r in prod.rares) p.rares[r] = (p.rares[r] || 0) + prod.rares[r];

    // dividendes versés aux actionnaires extérieurs
    const div = Math.max(0, prod.money * CONFIG.dividendRate);
    for (const h in p.shares) {
      const hid = +h;
      if (hid === p.id) continue;
      const amount = Math.floor((div * p.shares[h]) / CONFIG.shares);
      if (!amount) continue;
      p.money -= amount;
      player(s, hid).money += amount;
      flow(s, p.id, hid, amount);
      log(s, "dividende", `${p.name} verse ${amount} ₵ de dividendes à ${player(s, hid).name}`, [p.id, hid]);
    }
  }

  function damage(s, attacker, victim, infra, voluntary, cause) {
    const before = infraValue(infra);
    infra.hp -= 1;
    const d = INFRA[infra.type];
    const lost = before - (infra.hp > 0 ? infraValue(infra) : 0);
    if (attacker) {
      s.rel[attacker.id][victim.id].damage++;
      s.rel[attacker.id][victim.id].damageValue += lost;
    }
    const who = attacker ? `${attacker.name} ${voluntary ? "endommage volontairement" : "endommage accidentellement"}` : cause;
    if (infra.hp <= 0) {
      victim.infras = victim.infras.filter((x) => x !== infra);
      log(s, "conflit", `${who} : ${d.name} de ${victim.name} en ${zone(infra.zone).name} détruit`, attacker ? [attacker.id, victim.id] : [victim.id]);
      if (infra.type === "base") eliminate(s, victim, attacker ? attacker.id : null, "base détruite");
    } else {
      log(s, "conflit", `${who} : ${d.name} de ${victim.name} en ${zone(infra.zone).name} dégradé (${infra.hp}/${d.hp})`, attacker ? [attacker.id, victim.id] : [victim.id]);
    }
  }

  // conflit opportuniste : toute infrastructure plus récente placée à côté de
  // celle d'un autre joueur risque de la dégrader, un peu par accident,
  // beaucoup si elle a été placée de façon agressive.
  function incidents(s) {
    for (const z of ZONES) {
      const here = [];
      for (const p of activePlayers(s)) for (const i of p.infras) if (i.zone === z.id) here.push({ p, i });
      // chaque infrastructure "arrivée après" risque un incident par tour
      // avec l'une des infrastructures plus anciennes de ses voisins
      for (const a of here) {
        if (!isActive(a.p) || !a.p.infras.includes(a.i)) continue;
        const older = here.filter(
          (b) => b.p !== a.p && isActive(b.p) && b.p.infras.includes(b.i) && (a.i.built > b.i.built || (a.i.built === b.i.built && a.i.id > b.i.id))
        );
        if (!older.length) continue;
        const b = older[Math.floor(rand(s) * older.length)];
        const voluntary = a.i.mode === "agressif";
        let chance = voluntary ? CONFIG.incidentAggressive : CONFIG.incidentBase;
        if (voluntary && hasTech(a.p, "armement")) chance *= 2;
        if (hasTech(b.p, "blindage")) chance /= 2;
        if (rand(s) < chance) damage(s, a.p, b.p, b.i, voluntary);
      }
    }
  }

  function loansDue(s) {
    for (const l of s.loans) {
      if (l.status === "en cours" && l.due !== null && l.due <= s.turn) {
        l.status = "défaut";
        s.rel[l.borrower][l.lender].defaults++;
        log(s, "prêt", `${player(s, l.borrower).name} ne rembourse pas ${player(s, l.lender).name} à l'échéance (${l.repay} ₵)`, [l.borrower, l.lender]);
      }
    }
  }

  function pollution(s) {
    let total = 0;
    for (const p of activePlayers(s)) {
      const k = hasTech(p, "recyclage") ? 0.5 : 1;
      for (const i of p.infras) total += INFRA[i.type].pollution * k;
    }
    const delta = CONFIG.pollutionRegen - total;
    s.planet = Math.min(CONFIG.planetHealth, s.planet + delta);
    s.lastPollution = total;
    if (delta < -5) log(s, "planète", `Pollution ${total.toFixed(1)} — santé de la planète ${Math.round(s.planet)}`);
  }

  function darkForest(s) {
    const risk = darkForestRisk(s);
    if (!risk || rand(s) >= risk) return;
    const alive = activePlayers(s);
    if (!alive.length) return;
    const target = alive.reduce((a, b) => (visibility(b) > visibility(a) ? b : a));
    const infras = [...target.infras].sort((a, b) => INFRA[b.type].visibility - INFRA[a.type].visibility);
    const hit = infras.find((i) => i.type !== "base") || infras[0];
    log(s, "forêt sombre", `La forêt sombre frappe ${target.name}, le plus visible (visibilité ${visibility(target)})`, [target.id]);
    if (hit) damage(s, null, target, hit, false, "La forêt sombre");
  }

  function solvency(s) {
    for (const p of activePlayers(s)) {
      p.brokeTurns = p.money < 0 ? p.brokeTurns + 1 : 0;
      if (p.status === "actif" && p.brokeTurns >= CONFIG.bankruptTurns) {
        p.status = "faillite";
        log(s, "faillite", `${p.name} est en faillite : il peut être racheté`, [p.id]);
      } else if (p.status === "faillite" && p.money >= 0) {
        p.status = "actif";
        log(s, "faillite", `${p.name} sort de la faillite`, [p.id]);
      }
    }
  }

  function expireOffers(s) {
    for (const o of s.offers) {
      if (o.status === "en attente" && s.turn - o.turn >= CONFIG.offerTTL) o.status = "expirée";
    }
  }

  function checkEnd(s) {
    if (s.ended) return s.ended;
    const alive = activePlayers(s);
    if (s.planet <= 0) {
      s.ended = { type: "collective", text: "Défaite collective : la planète principale est détruite écologiquement. Personne ne gagne.", winners: [] };
    } else if (!alive.length) {
      s.ended = { type: "collective", text: "Défaite collective : aucun survivant.", winners: [] };
    } else if (alive.length === 1 && s.players.length > 1) {
      const w = alive[0];
      const others = s.players.filter((p) => p !== w);
      const bought = others.filter((p) => p.status === "racheté").length;
      const type = bought >= others.length - bought ? "économique" : "guerrière";
      s.ended = { type, text: `Victoire ${type} de ${w.name}.`, winners: [w.id] };
    } else if (s.turn >= CONFIG.maxTurns) {
      s.ended = { type: "narrative", text: `Victoire narrative : ${alive.map((p) => p.name).join(", ")} ont survécu à la forêt sombre.`, winners: alive.map((p) => p.id) };
    }
    if (s.ended) log(s, "fin", s.ended.text, s.ended.winners);
    return s.ended;
  }

  function snapshot(s) {
    const eq = {};
    const sp = {};
    for (const p of s.players) {
      eq[p.id] = Math.round(equity(s, p));
      sp[p.id] = +sharePrice(s, p).toFixed(2);
    }
    const prices = {};
    for (const p of s.players) prices[p.id] = { ...p.prices };
    s.history.push({ turn: s.turn, equity: eq, sharePrice: sp, planet: s.planet, prices });
  }

  // hook pour les stratégies automatiques (défini dans strategies.js)
  let botHooks = { act: null, respond: null };
  function setBots(hooks) {
    botHooks = hooks;
  }

  function autoRespond(s, o) {
    const to = player(s, o.to);
    if (!botHooks.respond || to.strategy === "humain" || o.status !== "en attente") return;
    if (botHooks.respond(s, to, o)) {
      const r = acceptOffer(s, o.id);
      if (!r.ok) refuseOffer(s, o.id);
    } else refuseOffer(s, o.id);
  }

  function endTurn(s) {
    if (s.ended) return fail("La partie est terminée");
    if (botHooks.act) for (const p of s.players) if (isActive(p) && p.strategy !== "humain" && !s.ended) botHooks.act(s, p);
    if (s.ended) return ok();
    for (const p of activePlayers(s)) produce(s, p);
    incidents(s);
    loansDue(s);
    pollution(s);
    darkForest(s);
    solvency(s);
    expireOffers(s);
    snapshot(s);
    if (!checkEnd(s)) {
      s.turn++;
      log(s, "tour", `— Début du tour ${s.turn} —`);
    }
    return ok(`Tour ${s.turn}`);
  }

  const api = {
    RARES, ZONES, CONFIG, INFRA, TECHS,
    newGame, endTurn, setBots,
    invest, unlockTech, build, setPrice, buyRare,
    proposeTrade, proposeLoan, acceptOffer, refuseOffer, cancelOffer,
    repayLoan, forgiveLoan, buyout, canBuyout, buyoutCost,
    equity, sharePrice, visibility, techCost, buildCost, marketPrice,
    bundleValue, normBundle, describeBundle, debtOf, receivableOf, outstanding,
    darkForestRisk, isActive, activePlayers, hasTech, zone, rand,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Game = api;
})(this);
