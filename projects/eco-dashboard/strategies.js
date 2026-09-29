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
  const homeRare = (p) => G.zone(p.home).rare;
  const count = (p, type) => p.infras.filter((i) => i.type === type).length;
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

  function pursueTech(s, p, t, { reserve = 15, maxInvest = 12, maxSpend = 30 } = {}) {
    if (G.hasTech(p, t)) return true;
    const cost = G.techCost(p, t);
    if (p.research < cost) {
      const cash = Math.min(maxInvest, Math.max(0, p.money - reserve), cost - p.research);
      const mat = Math.min(Math.max(0, p.material - 20), cost - p.research - cash);
      if (cash + mat > 0) G.invest(s, p.id, cash, mat);
    }
    if (p.research >= cost && buyMissing(s, p, TECHS[t].rare, maxSpend)) return G.unlockTech(s, p.id, t).ok;
    return false;
  }

  function affordable(p, type, reserve) {
    const c = G.buildCost(p, type);
    return p.money - c.money >= reserve && p.material >= c.material;
  }

  function rareCostOk(s, p, type, maxSpend = 25) {
    return buyMissing(s, p, G.buildCost(p, type).rares, maxSpend);
  }

  // certaines stratégies freinent les constructions polluantes quand la planète va mal
  const ECO_AWARE = ["equilibre", "specialiste", "furtif"];

  function tryBuild(s, p, type, zoneId, mode = "prudent", reserve = 10) {
    if (!affordable(p, type, reserve)) return false;
    if (ECO_AWARE.includes(p.strategy) && s.planet < 50 && INFRA[type].pollution >= 1) return false;
    if (!rareCostOk(s, p, type)) return false;
    if (!affordable(p, type, reserve)) return false;
    return G.build(s, p.id, type, zoneId, mode).ok;
  }

  function nextTech(p, list) {
    return list.find((t) => !G.hasTech(p, t));
  }

  function quietestZone(s, p) {
    const load = (z) => G.activePlayers(s).filter((o) => o !== p).reduce((a, o) => a + o.infras.filter((i) => i.zone === z.id).length, 0);
    return [...ZONES].sort((a, b) => load(a) - load(b) || (a.id === p.home ? -1 : 1))[0].id;
  }

  function sellLicence(s, p) {
    const mine = p.techs.filter((t) => t !== "logistique");
    for (const o of others(s, p)) {
      const t = mine.find((x) => !G.hasTech(o, x));
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
      const t = nextTech(p, ["logistique", "recyclage", "forage", "blindage"]);
      if (t) pursueTech(s, p, t);
      const type = count(p, "comptoir") <= count(p, "mine") ? "comptoir" : "mine";
      if (p.infras.length < 7) tryBuild(s, p, type, p.home);
    },

    specialiste(s, p) {
      repayDue(s, p);
      const r = homeRare(p);
      const path = Object.keys(TECHS).filter((t) => TECHS[t].rare[r]).concat(["logistique"]);
      if (!count(p, "labo")) tryBuild(s, p, "labo", p.home);
      const t = nextTech(p, path);
      if (t) pursueTech(s, p, t, { maxInvest: 18 });
      if (G.hasTech(p, "forage") && count(p, "extracteur") < 2) tryBuild(s, p, "extracteur", p.home);
      else if (p.infras.length < 6) tryBuild(s, p, "mine", p.home);
      if (r) G.setPrice(s, p.id, r, 4);
      sellLicence(s, p);
    },

    etrangleur(s, p) {
      repayDue(s, p);
      const r = homeRare(p);
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
      if (G.hasTech(p, "forage") && count(p, "extracteur") < 2) tryBuild(s, p, "extracteur", p.home);
      else if (p.infras.length < 6) tryBuild(s, p, "comptoir", p.home, "prudent", 25);
      const t = nextTech(p, ["forage", "logistique"]);
      if (t) pursueTech(s, p, t, { reserve: 30 });
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
      const t = nextTech(p, ["logistique"]);
      if (t) pursueTech(s, p, t, { reserve: 40 });
    },

    agressif(s, p) {
      repayDue(s, p);
      const t = nextTech(p, ["forage", "armement"]);
      if (t) pursueTech(s, p, t, { maxSpend: 40 });
      if (G.hasTech(p, "forage")) {
        const richest = others(s, p)
          .filter((o) => G.zone(o.home).rare && G.zone(o.home).rare !== homeRare(p))
          .sort((a, b) => G.equity(s, b) - G.equity(s, a))[0];
        if (richest && count(p, "extracteur") < 4) tryBuild(s, p, "extracteur", richest.home, "agressif", 5);
      } else if (p.infras.length < 4) tryBuild(s, p, "mine", p.home);
    },

    furtif(s, p) {
      repayDue(s, p, true);
      const t = nextTech(p, ["furtivite", "recyclage", "blindage"]);
      if (t) pursueTech(s, p, t, { maxSpend: 40 });
      if (p.infras.length < 3) tryBuild(s, p, p.infras.length === 1 ? "comptoir" : "mine", quietestZone(s, p));
    },

    pirate(s, p) {
      const borrowing = s.loans.some((l) => l.borrower === p.id && l.status === "en cours");
      if (!borrowing) {
        const lender = others(s, p).filter((o) => !defaultedOn(s, p, o)).sort((a, b) => b.money - a.money)[0];
        if (lender) G.proposeLoan(s, p.id, lender.id, { lender: "to", principal: { money: 25 }, repay: 32, due: 2 });
      }
      if (p.infras.length < 6) tryBuild(s, p, "comptoir", p.home, "prudent", 5);
      const t = nextTech(p, ["logistique"]);
      if (t) pursueTech(s, p, t);
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
