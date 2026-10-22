// Missions : un point de départ difficile + un objectif à atteindre en jouant sur les
// variables fixes (vivantes, pas besoin de relancer) et le nombre d'usines. Contrairement
// aux archétypes (observer un phénomène), il s'agit de résoudre un problème — le modèle ne
// s'en sort pas seul, voir `check`.
const MISSIONS = {
  co2dome: {
    label: "Sous un dôme de CO2",
    brief: "Un siècle d'industrie a saturé l'atmosphère de CO2 : la planète est bien au-dessus du seuil de surchauffe, la vie n'a plus la moindre chance de s'installer. Arrête les usines, et trouve comment faire redescendre la température (distance à l'étoile ? rotation ? volcanisme ?) pour qu'elle ait enfin une chance.",
    fixed: { metals: 0.8, distance: 1, rotation: 0.5, volcanism: 0.2 },
    dynamic: { size: 1.6, water: 0.5, co2: 0.25, vegetation: 0 },
    factories: 30,
    goal: { label: "Végétation > 20 %", check: (s) => s.vegetation > 0.2 },
  },
  iceball: {
    label: "Boule de glace",
    brief: "Cette planète (1,16 UA de son étoile, rotation rapide) est prise dans les glaces : sans eau liquide, la végétation plafonne à une petite frange désertique et n'ira jamais plus loin. Ajoute des usines pour produire du CO2, réchauffer suffisamment pour faire fondre la glace — mais pas trop, sous peine de rebasculer dans l'autre excès.",
    fixed: { metals: 0.8, distance: 1.16, rotation: 0.9, volcanism: 0.15 },
    dynamic: { size: 1, water: 0.6, co2: 0.02, vegetation: 0.02 },
    factories: 0,
    goal: { label: "Végétation > 50 %", check: (s) => s.vegetation > 0.5 },
  },
};

if (typeof module !== "undefined") {
  module.exports = { MISSIONS };
}
