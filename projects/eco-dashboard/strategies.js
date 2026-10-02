// Stratégies automatiques — pour tester rapidement qui une stratégie lèse
// ou avantage. Heuristiques volontairement simples et lisibles.
//
// Face au projectile de la forêt sombre, chaque stratégie a une posture
// (dilemme du prisonnier) : coopérer (chercheurs sur PRO-10, chantier de
// distorsion), se replier sur les planètes extérieures, ou promettre sans
// payer (trahison).

(function (root) {
  const G = typeof module !== "undefined" && module.exports ? require("./game.js") : root.Game;
  const { TECHS, INFRA, ZONES, CONFIG } = G;

  const STRATEGIES = {
    humain: { name: "Humain", desc: "Joué à la main depuis le dashboard" },
    equilibre: { name: "Équilibré", desc: "Construit, cherche, échange à prix juste, rembourse ; coopère face à la forêt sombre" },
    specialiste: { name: "Spécialiste", desc: "Grosse équipe de recherche, exploite une zone, vend des licences ; coopère" },
    etrangleur: { name: "Étrangleur", desc: "Monte ses prix quand on en dépend (rares, ravitaillement), achète des parts, rachète ; se replie" },
    preteur: { name: "Prêteur", desc: "Prête aux plus pauvres avec intérêts, rachète les défaillants ; finance les projets communs" },
    agressif: { name: "Agressif", desc: "Extracteurs agressifs chez les autres, armada de conquête ; se replie" },
    furtif: { name: "Furtif", desc: "Peu d'infrastructures, évite les voisins ; se replie dès que possible" },
    pirate: { name: "Mauvais payeur", desc: "Emprunte sans rembourser, promet aux projets communs sans verser" },
  };

  // posture face au projectile : coopérer, se replier, ou promettre sans payer
  const POSTURE = { equilibre: "coop", specialiste: "coop", preteur: "coop", etrangleur: "repli", agressif: "repli", furtif: "repli", pirate: "traître" };

  // seuil d'acceptation d'un troc : valeur reçue / valeur cédée
  const THRESHOLD = { equilibre: 1, specialiste: 0.95, etrangleur: 1.2, preteur: 1.05, agressif: 1.3, furtif: 1.1, pirate: 0.9 };

  const others = (s, p) => G.activePlayers(s).filter((o) => o !== p);
  const count = (p, type) => p.infras.filter((i) => i.type === type).length;
  const reachable = (s, p, z) => G.zoneOpen(s, z) && (!z.reachTech || G.hasTech(p, z.reachTech));
  const defaultedOn = (s, a, b) => s.rel[a.id][b.id].defaults > 0;
  const homeZone = (s) => (G.zoneOpen(s, G.zone("terre")) ? "terre" : null);

  function valueFor(s, p, b) {
    const own = { ...b, techs: b.techs.filter((t) => !G.hasTech(p, t)) };
    return G.bundleValue(s, own);
  }

  // ---------------------------------------------------------- réponses

  function respond(s, p, o) {
    const from = s.players[o.from];
    if (o.kind === "prêt") {
      const principal = o.principal.money + o.principal.material * 0.5;
      if (o.lender === p.id) {
        // on me demande un prêt
        if (defaultedOn(s, from, p)) return false;
        if (p.strategy === "preteur") return o.repay >= principal * 1.15 && p.money > principal + 10;
        if (p.strategy === "equilibre") return o.repay >= principal && p.money > principal * 3;
        if (p.strategy === "specialiste") return o.repay >= principal * 1.1 && p.money > principal * 2;
        return false;
      }
      // on me propose un prêt
      if (p.strategy === "pirate") return true;
      if (!o.due) return true; // sans condition : aucune raison de refuser
      if (p.strategy === "etrangleur") return o.repay <= principal * 1.3;
      return p.money < 30 && o.repay <= principal * 1.4;
    }

    const receive = valueFor(s, p, o.give);
    const pay = G.bundleValue(s, o.want);
    const isClaim = receive === 0 && pay > 0;
    if (isClaim) {
      // demande de compensation ou d'aide
      const guilty = s.rel[p.id][from.id].damage > 0;
      if (p.strategy === "agressif" || p.strategy === "pirate" || p.strategy === "etrangleur") return false;
      if (p.strategy === "furtif") return pay <= 20;
      return guilty && pay <= 15;
    }
    // vendre des parts de sa propre entreprise : seulement si on a besoin d'argent
    const sellsOwnShares = o.want.shares[p.id] > 0;
    if (sellsOwnShares && p.money > 30 && receive < pay * 1.3) return false;
    return receive >= pay * (THRESHOLD[p.strategy] || 1);
  }

  // ----------------------------------------------------------- helpers

  function repayDue(s, p, all = false) {
    if (p.strategy === "pirate") return;
    for (const l of s.loans) {
      if (l.borrower !== p.id || !G.outstanding(l)) continue;
      const urgent = l.due !== null && l.due <= s.turn;
      if ((urgent || all || l.status === "défaut") && p.money >= l.repay + 5) G.repayLoan(s, l.id);
    }
  }

  function cheapestSeller(s, p, rare, qty) {
    return others(s, p)
      .filter((o) => (o.rares[rare] || 0) >= qty)
      .sort((a, b) => a.prices[rare] - b.prices[rare])[0];
  }

  function buyMissing(s, p, need, maxSpend) {
    for (const r in need) {
      const missing = need[r] - (p.rares[r] || 0);
      if (missing <= 0) continue;
      const seller = cheapestSeller(s, p, r, missing);
      if (!seller || seller.prices[r] * missing > Math.min(maxSpend, p.money)) return false;
      G.buyRare(s, p.id, seller.id, r, missing);
    }
    return true;
  }

  // certaines stratégies freinent les constructions polluantes sur Terre quand la planète va mal
  const ECO_AWARE = ["equilibre", "specialiste", "furtif", "preteur"];

  function tryBuild(s, p, type, zoneId, mode = "prudent", reserve = 10) {
    if (!zoneId) return false;
    const z = G.zone(zoneId);
    if (!reachable(s, p, z)) return false;
    if (INFRA[type].tech && !G.hasTech(p, INFRA[type].tech)) return false;
    if (ECO_AWARE.includes(p.strategy) && zoneId === "terre" && INFRA[type].pollution > 0 && (s.planet < 60 || (s.lastPollution || 0) > CONFIG.pollutionRegen)) return false;
    const c = G.buildCost(p, type, zoneId);
    if (p.money - c.money < reserve || p.material < c.material) return false;
    const need = { ...c.rares };
    // les ergols manquants peuvent être achetés à une station sur place
    if (G.fuelStationFor(s, p, zoneId)) delete need.ergols;
    if (!buyMissing(s, p, need, 30)) return false;
    return G.build(s, p.id, type, zoneId, mode).ok;
  }

  // rares introuvables à la table (personne n'en a en stock) : ce sont
  // elles qu'il faut aller extraire
  function scarceRares(s) {
    return ["cristal", "he3", "glace"].filter((r) => G.activePlayers(s).reduce((a, o) => a + (o.rares[r] || 0), 0) < 3);
  }

  // zone à ressources : d'abord celles qui produisent une rare introuvable,
  // puis la moins disputée parmi celles à portée
  function targetZone(s, p, filter = () => true) {
    const load = (z) => others(s, p).reduce((a, o) => a + o.infras.filter((i) => i.zone === z.id).length, 0);
    const scarce = scarceRares(s);
    const needed = (z) => Object.keys(z.yield).some((r) => scarce.includes(r) && !p.infras.some((i) => i.type === "extracteur" && G.zone(i.zone).yield[r]));
    const pool = ZONES.filter((z) => Object.keys(z.yield).length && reachable(s, p, z) && filter(z));
    const urgent = pool.filter(needed).sort((a, b) => a.tier - b.tier)[0];
    if (urgent) return urgent.id;
    const own = p.infras.find((i) => i.type === "extracteur");
    if (own && G.zoneOpen(s, G.zone(own.zone)) && filter(G.zone(own.zone))) return own.zone;
    return pool.sort((a, b) => load(a) - load(b) || a.tier - b.tier)[0]?.id || null;
  }

  function outerZone(s, p) {
    return ZONES.filter((z) => !z.inner && reachable(s, p, z)).sort((a, b) => a.tier - b.tier)[0]?.id || null;
  }

  // ergols : raffinerie d'hydrocarbures au début (polluante), usine à glace ensuite
  function ensureErgols(s, p, reserve) {
    if ((p.rares.ergols || 0) >= 6) return;
    if (G.hasTech(p, "PRO-3") && count(p, "electrolyse") < 1) {
      const z = ZONES.find((x) => x.id !== "terre" && reachable(s, p, x) && (x.sabatier || x.yield.glace));
      const iceOk = z && (z.sabatier || (p.rares.glace || 0) > 2 || count(p, "extracteur"));
      if (iceOk && tryBuild(s, p, "electrolyse", z.id, "prudent", reserve)) return;
    }
    if (count(p, "raffinerie") < 1) tryBuild(s, p, "raffinerie", homeZone(s), "prudent", reserve);
  }

  // achète des métaux au vendeur le moins cher (outillage, projets)
  function buyMetals(s, p, qty, maxSpend) {
    if (qty <= 0) return true;
    const seller = others(s, p).filter((o) => o.material >= qty + 20).sort((a, b) => a.materialPrice - b.materialPrice)[0];
    if (!seller || seller.materialPrice * qty > Math.min(maxSpend, p.money)) return false;
    return G.buyMaterial(s, p.id, seller.id, qty).ok;
  }

  // technos manquantes pour atteindre `target` (prérequis compris), des plus simples aux plus profondes
  function techsToward(p, target) {
    const out = new Set();
    const walk = (t) => {
      if (G.hasTech(p, t) || out.has(t)) return;
      for (const r of TECHS[t].prereqs) walk(r);
      out.add(t);
    };
    walk(target);
    return [...out];
  }

  // face au projectile : ce qui manque à la table pour la distorsion
  function distorsionPath(s, p) {
    if (!s.projectile) return [];
    const table = G.activePlayers(s);
    const missing = TECHS["PRO-10"].prereqs.filter((r) => !table.some((o) => G.hasTech(o, r)));
    const target = missing.length ? missing : TECHS["PRO-10"].prereqs.filter((r) => !G.hasTech(p, r));
    return target.sort((a, b) => techsToward(p, a).length - techsToward(p, b).length).flatMap((t) => techsToward(p, t)).slice(0, 12);
  }

  // technos prêtes : celles du chemin d'abord, puis les moins chères de l'arbre
  function nextTechs(p, path, busy) {
    const ready = (t) => !G.hasTech(p, t) && !busy.has(t) && !TECHS[t].pooled && TECHS[t].prereqs.every((r) => G.hasTech(p, r));
    const fromPath = path.filter(ready);
    const rest = Object.keys(TECHS)
      .filter((t) => ready(t) && !fromPath.includes(t))
      .sort((a, b) => TECHS[a].cost - TECHS[b].cost);
    return [...fromPath, ...rest];
  }

  // équipe de recherche : laboratoires, embauches (sans licencier à tout
  // va), affectation des inactifs à quelques recherches en parallèle
  function manageResearch(s, p, path, { staff = 4, parallel = 2, reserve = 20 } = {}) {
    if (p.money < -10 && p.staff.length) {
      G.fire(s, p.id, 1);
      return;
    }
    const labZone = homeZone(s) || p.infras.find((i) => !G.zone(i.zone).inner)?.zone;
    if (G.labCapacity(p) < staff) tryBuild(s, p, "labo", labZone, "prudent", reserve);
    // n'embauche que si l'on peut payer une dizaine de tours de salaires
    const room = Math.min(staff, G.labCapacity(p)) - p.staff.length;
    const runway = p.money - reserve - (p.staff.length + 1) * CONFIG.salary * 10;
    const affordable = Math.floor(runway / (CONFIG.hireCost + CONFIG.salary * 10));
    if (room > 0 && affordable > 0) G.hire(s, p.id, Math.min(room, affordable));
    if (POSTURE[p.strategy] === "coop") path = [...distorsionPath(s, p), ...path];
    const busy = new Set(p.staff.filter((r) => r.tech).map((r) => r.tech));
    let idle = p.staff.filter((r) => !r.tech).length;
    const perTech = Math.max(1, Math.ceil(staff / parallel));
    // renforce d'abord les recherches en cours, puis en ouvre de nouvelles
    for (const t of busy) {
      if (!idle || TECHS[t].pooled) continue;
      const n = G.staffOn(p, t).length;
      const add = Math.min(idle, Math.max(0, perTech - n));
      if (add && G.assignResearch(s, p.id, t, n + add).ok) idle -= add;
    }
    for (const t of nextTechs(p, path, busy)) {
      if (!idle || busy.size >= parallel) break;
      if (!buyMissing(s, p, G.equipmentCost(p, t), 30)) continue;
      const tooling = G.toolingCost(p, t);
      if (tooling.money > p.money - reserve) continue;
      if (tooling.material > p.material && !buyMetals(s, p, tooling.material - p.material, p.money - reserve - tooling.money)) continue;
      const n = Math.min(idle, perTech);
      if (G.assignResearch(s, p.id, t, n).ok) {
        busy.add(t);
        idle -= n;
      }
    }
  }

  // chemin vers l'extraction spatiale, puis vers la fusion et les planètes extérieures
  const SPACE_PATH = [
    "STR-1", "GUI-1", "COM-1", "REC-1", "PRO-1",
    "STR-2", "GUI-2", "GUI-3", "COM-2", "REC-2", "PRO-2",
    "STR-3", "GUI-4", "EXT-1", "PRO-3", "GUI-6", "EXT-2",
    "EXT-3", "EXT-4", "EXT-5", "EXT-6", "CON-1",
  ];
  const LATE_PATH = ["REC-3", "REC-4", "PRO-4", "PRO-5", "PRO-6", "STR-4", "STR-7", "PRO-7", "REC-5", "OBS-1", "OBS-4", "OBS-5", "REC-7", "PRO-8", "GUI-5", "CON-2", "CON-5", "SUP-1", "SUP-2", "SUP-3", "SUP-4", "CON-6", "COM-3", "GUI-8", "GUI-7", "COM-4", "COM-5", "GUI-9", "EXT-7"];
  const PATH = [...SPACE_PATH, ...LATE_PATH];
  const LOW_KEY_PATH = ["REC-1", "OBS-1", "REC-2", "OBS-2", ...PATH];

  function sellLicence(s, p) {
    for (const o of others(s, p)) {
      const t = p.techs.find((x) => !G.hasTech(o, x) && TECHS[x].prereqs.every((r) => G.hasTech(o, r)));
      const recent = s.offers.some((x) => x.from === p.id && x.to === o.id && s.turn - x.turn < 4);
      if (t && !recent) {
        G.proposeTrade(s, p.id, o.id, { techs: [t] }, { money: Math.max(25, Math.round(TECHS[t].cost * 0.1)) }, "licence");
        return;
      }
    }
  }

  function buySharesOf(s, p, target, n, markup) {
    const price = Math.ceil(G.sharePrice(s, target) * n * markup);
    if ((target.shares[target.id] || 0) < n || p.money < price + 15) return;
    G.proposeTrade(s, p.id, target.id, { money: price }, { shares: { [target.id]: n } }, "achat de parts");
  }

  function tryBuyouts(s, p) {
    for (const o of others(s, p)) if (G.canBuyout(s, p.id, o.id).ok) G.buyout(s, p.id, o.id);
  }

  // ------------------------------------------- projets communs et menaces

  // verse une partie de ce qu'on peut se permettre à un projet en cours
  function contributeTo(s, p, pr, share, reserve) {
    const rem = G.projectRemaining(pr);
    const b = {
      money: Math.min(rem.money, Math.max(0, Math.floor((p.money - reserve) * share))),
      material: Math.min(rem.material, Math.max(0, Math.floor((p.material - 20) * share))),
      rares: {},
    };
    for (const r in rem.rares) if ((p.rares[r] || 0) > 0) b.rares[r] = Math.min(rem.rares[r], p.rares[r]);
    if (b.money + b.material + Object.values(b.rares).reduce((a, x) => a + x, 0) > 0) G.contribute(s, p.id, pr.id, b);
  }

  const openProject = (s, type) => s.projects.find((pr) => pr.type === type && pr.status === "en cours");

  function facingProjectile(s, p) {
    if (!s.projectile) return;
    const posture = POSTURE[p.strategy];
    if (posture === "repli") {
      const z = outerZone(s, p);
      if (z && !p.infras.some((i) => !G.zone(i.zone).inner)) {
        ensureErgols(s, p, 0);
        if (!tryBuild(s, p, "labo", z, "prudent", 0)) tryBuild(s, p, "comptoir", z, "prudent", 0);
      }
      return;
    }
    // coopération : chercheurs sur la distorsion, chantier commun
    // on rejoint la recherche collective si l'on comble un savoir manquant
    // (un chercheur suffit), ou avec tous ses inactifs quand la table a tout réuni ;
    // sinon on cherche d'abord ce qui manque (cf. distorsionPath)
    if (posture === "coop" && G.canResearch(p, "PRO-10") && !G.hasTech(p, "PRO-10")) {
      const k = G.pooledKnowledge(s, "PRO-10");
      const n = G.staffOn(p, "PRO-10").length;
      const idle = p.staff.filter((r) => !r.tech).length;
      const fillsGap = k.missing.some((r) => G.hasTech(p, r));
      if (!k.missing.length && idle) G.assignResearch(s, p.id, "PRO-10", n + idle);
      else if (fillsGap && !n && idle) G.assignResearch(s, p.id, "PRO-10", 1);
    }
    // un seul chantier de distorsion suffit (outillage commun)
    if (s.projects.some((x) => x.type === "distorsion" && x.status === "achevé")) return;
    let pr = openProject(s, "distorsion");
    if (!pr && posture === "coop" && G.createProject(s, p.id, "distorsion").ok) pr = openProject(s, "distorsion");
    if (!pr) return;
    if (posture === "traître") {
      if (!pr.pledges[p.id]) G.pledge(s, p.id, pr.id, 150);
      return;
    }
    contributeTo(s, p, pr, 0.5, 15);
  }

  function lateGame(s, p) {
    if (s.age !== "late") return;
    const posture = POSTURE[p.strategy];
    if (G.hasTech(p, INFRA.chantier.tech) && !count(p, "chantier")) {
      const site = p.infras.find((i) => i.type === "mine" && i.zone !== "terre")?.zone || "orbite";
      tryBuild(s, p, "chantier", site, "prudent", 40);
    }
    let armada = openProject(s, "armada");
    const ownsArmada = s.projects.some((x) => x.type === "armada" && x.creator === p.id);
    if (!armada && !ownsArmada && count(p, "chantier") && G.createProject(s, p.id, "armada").ok) armada = openProject(s, "armada");
    if (armada) {
      if (posture === "traître") {
        if (!armada.pledges[p.id]) G.pledge(s, p.id, armada.id, 200);
      } else if (posture === "coop" || armada.creator === p.id) contributeTo(s, p, armada, 0.4, 30);
    }
    for (const pr of s.projects) {
      if (pr.type !== "armada" || pr.status !== "achevé" || pr.controller !== p.id) continue;
      const crewCanWarp = Object.keys(pr.contrib).some((id) => G.hasTech(s.players[id], "PRO-10"));
      if (crewCanWarp) G.setArmadaMode(s, p.id, pr.id, "exploration");
      else if (p.strategy === "agressif") {
        G.setArmadaMode(s, p.id, pr.id, "conquête");
        const target = others(s, p).filter((o) => !pr.contrib[o.id]).sort((a, b) => G.equity(s, b) - G.equity(s, a))[0];
        if (target) G.attack(s, p.id, pr.id, target.id);
      } else G.setArmadaMode(s, p.id, pr.id, "défense");
    }
    if (G.hasTech(p, G.PROJECTS.megaextracteur.needsTech) && !s.projects.some((x) => x.type === "megaextracteur") && p.strategy === "specialiste") G.createProject(s, p.id, "megaextracteur", targetZone(s, p));
    const mega = openProject(s, "megaextracteur");
    if (mega && posture !== "traître") contributeTo(s, p, mega, 0.2, 40);
  }

  // expansion spatiale commune : ergols, extracteurs, mines hors Terre, réacteurs
  function expand(s, p, { reserve = 15, mode = "prudent", zone = null } = {}) {
    ensureErgols(s, p, reserve);
    const z = zone || targetZone(s, p);
    const scarce = scarceRares(s).some((r) => G.zone(z || "terre").yield[r]);
    if (G.hasTech(p, "EXT-6") && (count(p, "extracteur") < 2 || (scarce && count(p, "extracteur") < 4))) tryBuild(s, p, "extracteur", z, mode, reserve);
    const metalZone = ZONES.filter((x) => x.id !== "terre" && x.metals && reachable(s, p, x)).sort((a, b) => b.metals - a.metals)[0];
    if (metalZone && count(p, "mine") < 3) tryBuild(s, p, "mine", metalZone.id, "prudent", reserve);
    if (G.hasTech(p, "PRO-5") && count(p, "fission") < 1) tryBuild(s, p, "fission", homeZone(s) || z, "prudent", reserve + 20);
    if (G.hasTech(p, "PRO-8") && count(p, "reacteur") < 1) tryBuild(s, p, "reacteur", z, "prudent", reserve + 20);
  }

  // planète en danger : les stratégies attentives démantèlent leur
  // installation terrestre la plus polluante qui n'est plus indispensable
  function ecoCare(s, p) {
    if (!ECO_AWARE.includes(p.strategy) || s.planet >= 50 || (s.lastPollution || 0) <= CONFIG.pollutionRegen) return;
    const spaceFuel = count(p, "electrolyse") > 0 || (p.rares.ergols || 0) > 10;
    const spaceMines = p.infras.some((i) => i.type === "mine" && i.zone !== "terre");
    const victim = p.infras
      .filter((i) => i.zone === "terre" && ((i.type === "raffinerie" && spaceFuel) || (i.type === "mine" && (spaceMines || p.material > 80))))
      .sort((a, b) => INFRA[b.type].pollution - INFRA[a.type].pollution)[0];
    if (victim) G.dismantle(s, p.id, victim.id);
  }

  // ------------------------------------------------------- stratégies

  const ACT = {
    equilibre(s, p) {
      repayDue(s, p);
      manageResearch(s, p, PATH, { staff: 4, parallel: 2, reserve: 20 });
      expand(s, p);
      const type = count(p, "comptoir") <= count(p, "mine") ? "comptoir" : "mine";
      if (p.infras.length < 7) tryBuild(s, p, type, homeZone(s));
    },

    specialiste(s, p) {
      repayDue(s, p);
      manageResearch(s, p, PATH, { staff: 8, parallel: 3, reserve: 15 });
      expand(s, p);
      if (G.hasTech(p, "CON-5") && !count(p, "station")) tryBuild(s, p, "station", targetZone(s, p), "prudent", 30);
      if (p.infras.length < 5) tryBuild(s, p, "mine", homeZone(s));
      for (const r of ["cristal", "glace", "he3"]) if ((p.rares[r] || 0) > 4) G.setPrice(s, p.id, r, 4);
      G.setMaterialPrice(s, p.id, p.material > 500 ? 1 : 2);
      sellLicence(s, p);
    },

    etrangleur(s, p) {
      repayDue(s, p);
      // prix qui montent tant qu'on m'achète, redescendent sinon (rares et ravitaillement)
      for (const r of ["cristal", "glace", "he3", "ergols"]) {
        if (!(p.rares[r] > 0)) continue;
        const sold = s.trades.filter((x) => x.seller === p.id && x.rare === r && x.turn >= s.turn - 1).length;
        G.setPrice(s, p.id, r, sold ? Math.ceil(p.prices[r] * 1.25) : Math.max(5, p.prices[r] - 1));
      }
      if (count(p, "station")) G.setFuelFee(s, p.id, Math.min(30, p.fuelFee + 1));
      tryBuyouts(s, p);
      for (const o of others(s, p)) {
        if (o.status === "faillite" || G.sharePrice(s, o) < 2) buySharesOf(s, p, o, 15, 1.1);
        else if (p.money > 250) buySharesOf(s, p, o, 10, 1.35);
      }
      manageResearch(s, p, PATH, { staff: 4, parallel: 2, reserve: 30 });
      expand(s, p, { reserve: 25 });
      if (G.hasTech(p, "CON-5") && !count(p, "station")) tryBuild(s, p, "station", targetZone(s, p), "prudent", 30);
      if (p.infras.length < 6) tryBuild(s, p, "comptoir", homeZone(s), "prudent", 25);
    },

    preteur(s, p) {
      repayDue(s, p);
      tryBuyouts(s, p);
      const active = s.loans.filter((l) => l.lender === p.id && G.outstanding(l));
      const poorest = others(s, p)
        .filter((o) => !active.some((l) => l.borrower === o.id) && !defaultedOn(s, o, p))
        .sort((a, b) => a.money - b.money)[0];
      if (poorest && p.money > 60 && poorest.money < 40) {
        G.proposeLoan(s, p.id, poorest.id, { lender: "from", principal: { money: 30 }, repay: 38, due: 4 });
      }
      for (const l of s.loans) {
        if (l.lender === p.id && l.status === "défaut") buySharesOf(s, p, s.players[l.borrower], 20, 1);
      }
      manageResearch(s, p, PATH, { staff: 2, parallel: 1, reserve: 40 });
      if (p.infras.length < 5) tryBuild(s, p, "comptoir", homeZone(s), "prudent", 40);
      expand(s, p, { reserve: 40 });
    },

    agressif(s, p) {
      repayDue(s, p);
      manageResearch(s, p, PATH, { staff: 4, parallel: 2, reserve: 20 });
      // vise la zone où le rival le plus riche a déjà investi, pour le gêner
      const richest = others(s, p)
        .filter((o) => o.infras.some((i) => i.type === "extracteur"))
        .sort((a, b) => G.equity(s, b) - G.equity(s, a))[0];
      const z = richest ? richest.infras.find((i) => i.type === "extracteur").zone : null;
      expand(s, p, { mode: "agressif", zone: z && reachable(s, p, G.zone(z)) ? z : null, reserve: 10 });
      if (p.infras.length < 4) tryBuild(s, p, "mine", homeZone(s));
    },

    furtif(s, p) {
      repayDue(s, p, true);
      manageResearch(s, p, LOW_KEY_PATH, { staff: 3, parallel: 2, reserve: 30 });
      // peu d'infrastructures, loin des autres ; repli extérieur dès que possible
      const outer = outerZone(s, p);
      if (outer && !p.infras.some((i) => i.zone === outer)) {
        ensureErgols(s, p, 20);
        tryBuild(s, p, "labo", outer, "prudent", 20);
      }
      if (p.infras.length < 4) {
        ensureErgols(s, p, 30);
        const z = targetZone(s, p, (x) => !others(s, p).some((o) => o.infras.some((i) => i.zone === x.id)));
        if (G.hasTech(p, "EXT-6") && !count(p, "extracteur")) tryBuild(s, p, "extracteur", z, "prudent", 30);
        else tryBuild(s, p, "comptoir", homeZone(s), "prudent", 30);
      }
    },

    pirate(s, p) {
      const borrowing = s.loans.some((l) => l.borrower === p.id && l.status === "en cours");
      if (!borrowing) {
        const lender = others(s, p).filter((o) => !defaultedOn(s, p, o)).sort((a, b) => b.money - a.money)[0];
        if (lender) G.proposeLoan(s, p.id, lender.id, { lender: "to", principal: { money: 25 }, repay: 32, due: 2 });
      }
      if (p.infras.length < 6) tryBuild(s, p, "comptoir", homeZone(s), "prudent", 5);
      manageResearch(s, p, PATH, { staff: 2, parallel: 1, reserve: 20 });
      expand(s, p, { reserve: 20 });
    },
  };

  function act(s, p) {
    // traite d'abord les offres reçues d'autres joueurs
    for (const o of s.offers) {
      if (o.to !== p.id || o.status !== "en attente") continue;
      if (respond(s, p, o)) {
        if (!G.acceptOffer(s, o.id).ok) G.refuseOffer(s, o.id);
      } else G.refuseOffer(s, o.id);
    }
    facingProjectile(s, p);
    ecoCare(s, p);
    const fn = ACT[p.strategy];
    if (fn) fn(s, p);
    lateGame(s, p);
  }

  G.setBots({ act, respond });

  const api = { STRATEGIES, POSTURE, act, respond };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Strategies = api;
})(this);
