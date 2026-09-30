// Stratégies automatiques — pour tester rapidement qui une stratégie lèse
// ou avantage. Heuristiques volontairement simples et lisibles.

(function (root) {
  const G = typeof module !== "undefined" && module.exports ? require("./game.js") : root.Game;
  const { RARES, TECHS, INFRA, ZONES } = G;

  const STRATEGIES = {
    humain: { name: "Humain", desc: "Joué à la main depuis le dashboard" },
    equilibre: { name: "Équilibré", desc: "Construit, cherche un peu, échange à prix juste, rembourse" },
    specialiste: { name: "Spécialiste", desc: "Techs liées à sa ressource rare, vend des licences" },
    etrangleur: { name: "Étrangleur", desc: "Monte le prix de sa ressource quand on en dépend, achète des parts, rachète" },
    preteur: { name: "Prêteur", desc: "Prête aux plus pauvres avec intérêts, rachète les défaillants" },
    agressif: { name: "Agressif", desc: "Place des extracteurs agressifs chez les autres, refuse de compenser" },
    furtif: { name: "Furtif", desc: "Peu d'infrastructures, vise la furtivité, évite les voisins" },
    pirate: { name: "Mauvais payeur", desc: "Emprunte à tout le monde, ne rembourse jamais" },
  };

  // seuil d'acceptation d'un troc : valeur reçue / valeur cédée
  const THRESHOLD = { equilibre: 1, specialiste: 0.95, etrangleur: 1.2, preteur: 1.05, agressif: 1.3, furtif: 1.1, pirate: 0.9 };

  const others = (s, p) => G.activePlayers(s).filter((o) => o !== p);
  const count = (p, type) => p.infras.filter((i) => i.type === type).length;
  const rareZones = ZONES.filter((z) => z.rare);

  // rare déjà exploitée par le joueur (son premier extracteur), sinon rien —
  // remplace l'ancien "home" fixe : la spécialisation se gagne en jeu
  function specialtyRare(p) {
    const e = p.infras.find((i) => i.type === "extracteur");
    return e ? G.zone(e.zone).rare : null;
  }

  // zone rare la moins disputée (le moins d'infras d'autres joueurs) parmi
  // celles déjà à portée technologique, pour choisir où étendre son activité
  // (sinon la plus proche, en attendant d'avoir la technologie requise)
  function chosenZone(s, p) {
    const load = (z) => G.activePlayers(s).filter((o) => o !== p).reduce((a, o) => a + o.infras.filter((i) => i.zone === z.id).length, 0);
    const reachable = rareZones.filter((z) => !z.reachTech || G.hasTech(p, z.reachTech));
    const pool = reachable.length ? reachable : rareZones;
    return [...pool].sort((a, b) => load(a) - load(b) || a.tier - b.tier || a.id.localeCompare(b.id))[0].id;
  }

  // zone où étendre son activité rare : celle déjà choisie s'il y en a une, sinon la moins disputée
  function targetZone(s, p) {
    const r = specialtyRare(p);
    return r ? rareZones.find((z) => z.rare === r).id : chosenZone(s, p);
  }
  const defaultedOn = (s, a, b) => s.rel[a.id][b.id].defaults > 0;

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

  // prochaine techno du chemin dont les prérequis sont remplis, sinon la
  // moins chère disponible ailleurs dans l'arbre (progrès garanti)
  function nextAvailableTech(p, path) {
    const ready = (t) => !G.hasTech(p, t) && TECHS[t].prereqs.every((r) => G.hasTech(p, r));
    return path.find(ready) || Object.keys(TECHS).filter(ready).sort((a, b) => TECHS[a].cost - TECHS[b].cost)[0] || null;
  }

  // affecte des chercheurs (dans la limite du budget) à la prochaine techno
  // du chemin — une recherche à la fois, pour rester lisible et prudent.
  // Un laboratoire est requis avant toute recherche : on le construit d'abord.
  function advanceResearch(s, p, path, { researchers = 2, reserve = 15 } = {}) {
    if (!p.infras.some((i) => i.type === "labo")) {
      tryBuild(s, p, "labo", p.home, "prudent", reserve);
      return;
    }
    if (Object.keys(p.assignments).length) return;
    const t = nextAvailableTech(p, path);
    if (!t) return;
    const need = TECHS[t].rare || {};
    for (const r in need) if ((p.rares[r] || 0) < need[r]) return; // équipement manquant, on attend d'en avoir
    const perHead = G.researchCostPerHead(p, t);
    const n = Math.min(researchers, Math.max(0, Math.floor((p.money - reserve) / perHead)));
    if (n > 0) G.assignResearch(s, p.id, t, n);
  }

  // chemin partagé vers EXT-6 (accès à l'extraction de ressource rare) :
  // fondations Structure/Guidage/Communications/Recherche/Propulsion, puis
  // la branche Extraction proprement dite.
  const RARE_ACCESS_PATH = [
    "STR-1", "GUI-1", "COM-1", "REC-1", "PRO-1",
    "STR-2", "GUI-2", "GUI-3", "COM-2", "REC-2", "PRO-2",
    "STR-3", "GUI-4", "EXT-1",
    "PRO-3", "GUI-6", "EXT-2",
    "EXT-3", "EXT-4", "EXT-5", "EXT-6",
  ];
  // chemin discret pour les stratégies qui n'ont pas vocation à exploiter
  // une planète (peu d'infrastructures, faible empreinte)
  const LOW_KEY_PATH = ["REC-1", "OBS-1", "REC-2", "OBS-2"];

  function affordable(p, type, zoneId, reserve) {
    const c = G.buildCost(type, zoneId);
    return p.money - c.money >= reserve && p.material >= c.material;
  }

  function rareCostOk(s, p, type, zoneId, maxSpend = 25) {
    return buyMissing(s, p, G.buildCost(type, zoneId).rares, maxSpend);
  }

  // certaines stratégies freinent les constructions polluantes quand la planète va mal
  const ECO_AWARE = ["equilibre", "specialiste", "furtif"];

  function tryBuild(s, p, type, zoneId, mode = "prudent", reserve = 10) {
    const z = G.zone(zoneId);
    if (z.reachTech && !G.hasTech(p, z.reachTech)) return false; // trop loin pour l'instant
    if (!affordable(p, type, zoneId, reserve)) return false;
    if (ECO_AWARE.includes(p.strategy) && s.planet < 50 && INFRA[type].pollution >= 1) return false;
    if (!rareCostOk(s, p, type, zoneId)) return false;
    if (!affordable(p, type, zoneId, reserve)) return false;
    return G.build(s, p.id, type, zoneId, mode).ok;
  }

  function quietestZone(s, p) {
    const load = (z) => G.activePlayers(s).filter((o) => o !== p).reduce((a, o) => a + o.infras.filter((i) => i.zone === z.id).length, 0);
    const reachable = ZONES.filter((z) => !z.reachTech || G.hasTech(p, z.reachTech));
    return [...reachable].sort((a, b) => load(a) - load(b) || (a.id === p.home ? -1 : 1))[0].id;
  }

  function sellLicence(s, p) {
    for (const o of others(s, p)) {
      const t = p.techs.find((x) => !G.hasTech(o, x));
      const recent = s.offers.some((x) => x.from === p.id && x.to === o.id && s.turn - x.turn < 4);
      if (t && !recent) {
        G.proposeTrade(s, p.id, o.id, { techs: [t] }, { money: 25 }, "licence");
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

  // ------------------------------------------------------- stratégies

  const ACT = {
    equilibre(s, p) {
      repayDue(s, p);
      advanceResearch(s, p, RARE_ACCESS_PATH, { researchers: 2, reserve: 15 });
      if (G.hasTech(p, "EXT-6") && count(p, "extracteur") < 1) tryBuild(s, p, "extracteur", targetZone(s, p));
      else {
        const type = count(p, "comptoir") <= count(p, "mine") ? "comptoir" : "mine";
        if (p.infras.length < 7) tryBuild(s, p, type, p.home);
      }
    },

    specialiste(s, p) {
      repayDue(s, p);
      const zoneId = targetZone(s, p);
      const r = G.zone(zoneId).rare;
      if (!count(p, "labo")) tryBuild(s, p, "labo", p.home);
      advanceResearch(s, p, RARE_ACCESS_PATH, { researchers: 3, reserve: 12 });
      if (G.hasTech(p, "EXT-6") && count(p, "extracteur") < 2) tryBuild(s, p, "extracteur", zoneId);
      else if (p.infras.length < 6) tryBuild(s, p, "mine", p.home);
      if (specialtyRare(p)) G.setPrice(s, p.id, r, 4);
      sellLicence(s, p);
    },

    etrangleur(s, p) {
      repayDue(s, p);
      const r = specialtyRare(p);
      if (r) {
        // prix qui monte tant qu'on m'achète, redescend quand plus personne n'achète
        const sold = s.trades.filter((x) => x.seller === p.id && x.rare === r && x.turn >= s.turn - 1).length;
        G.setPrice(s, p.id, r, sold ? Math.ceil(p.prices[r] * 1.25) : Math.max(5, p.prices[r] - 1));
      }
      tryBuyouts(s, p);
      // achète des parts : à bas prix chez les affaiblis, avec prime quand il est riche
      for (const o of others(s, p)) {
        if (o.status === "faillite" || G.sharePrice(s, o) < 2) buySharesOf(s, p, o, 15, 1.1);
        else if (p.money > 150) buySharesOf(s, p, o, 10, 1.35);
      }
      if (G.hasTech(p, "EXT-6") && count(p, "extracteur") < 2) tryBuild(s, p, "extracteur", targetZone(s, p));
      else if (p.infras.length < 6) tryBuild(s, p, "comptoir", p.home, "prudent", 25);
      advanceResearch(s, p, RARE_ACCESS_PATH, { researchers: 2, reserve: 30 });
    },

    preteur(s, p) {
      repayDue(s, p);
      tryBuyouts(s, p);
      const active = s.loans.filter((l) => l.lender === p.id && G.outstanding(l));
      const poorest = others(s, p)
        .filter((o) => !active.some((l) => l.borrower === o.id) && !defaultedOn(s, o, p))
        .sort((a, b) => a.money - b.money)[0];
      if (poorest && p.money > 45 && poorest.money < 40) {
        G.proposeLoan(s, p.id, poorest.id, { lender: "from", principal: { money: 20 }, repay: 25, due: 3 });
      }
      for (const l of s.loans) {
        if (l.lender === p.id && l.status === "défaut") buySharesOf(s, p, s.players[l.borrower], 20, 1);
      }
      if (p.infras.length < 5) tryBuild(s, p, "comptoir", p.home, "prudent", 40);
      advanceResearch(s, p, RARE_ACCESS_PATH, { researchers: 1, reserve: 40 });
    },

    agressif(s, p) {
      repayDue(s, p);
      advanceResearch(s, p, RARE_ACCESS_PATH, { researchers: 2, reserve: 20 });
      if (G.hasTech(p, "EXT-6")) {
        // vise la zone où le rival le plus riche a déjà investi, pour le gêner
        const richest = others(s, p)
          .filter((o) => o.infras.some((i) => i.type === "extracteur"))
          .sort((a, b) => G.equity(s, b) - G.equity(s, a))[0];
        const zoneId = richest ? richest.infras.find((i) => i.type === "extracteur").zone : targetZone(s, p);
        if (count(p, "extracteur") < 4) tryBuild(s, p, "extracteur", zoneId, "agressif", 5);
      } else if (p.infras.length < 4) tryBuild(s, p, "mine", p.home);
    },

    furtif(s, p) {
      repayDue(s, p, true);
      advanceResearch(s, p, LOW_KEY_PATH, { researchers: 1, reserve: 40 });
      if (p.infras.length < 3) tryBuild(s, p, p.infras.length === 1 ? "comptoir" : "mine", quietestZone(s, p));
    },

    pirate(s, p) {
      const borrowing = s.loans.some((l) => l.borrower === p.id && l.status === "en cours");
      if (!borrowing) {
        const lender = others(s, p).filter((o) => !defaultedOn(s, p, o)).sort((a, b) => b.money - a.money)[0];
        if (lender) G.proposeLoan(s, p.id, lender.id, { lender: "to", principal: { money: 25 }, repay: 32, due: 2 });
      }
      if (p.infras.length < 6) tryBuild(s, p, "comptoir", p.home, "prudent", 5);
      advanceResearch(s, p, LOW_KEY_PATH, { researchers: 1, reserve: 20 });
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
    const fn = ACT[p.strategy];
    if (fn) fn(s, p);
  }

  G.setBots({ act, respond });

  const api = { STRATEGIES, act, respond };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Strategies = api;
})(this);
