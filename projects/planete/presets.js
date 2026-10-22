// Archétypes : planètes prêtes à l'emploi (4 variables fixes + état initial) qui mettent
// en avant un phénomène précis du modèle (sim.js). Voir aussi README.md. H2O et taille/masse
// font partie de l'état initial (ils peuvent varier d'une simulation à l'autre), contrairement
// à métaux/distance/rotation/volcanisme qui sont des traits physiques immuables.
const PRESETS = {
  earth:      { label: "Terre",             fixed: { metals: 0.8, distance: 1,    rotation: 0.5, volcanism: 0.3 },  dynamic: { size: 0.67, water: 0.7, co2: 0.02, vegetation: 0.1 } },
  ocean:      { label: "Océanique stable",  fixed: { metals: 0.9, distance: 1,    rotation: 0.5, volcanism: 0.3 },  dynamic: { size: 0.67, water: 0.9, co2: 0.02, vegetation: 0.05 } },
  desert:     { label: "Désertique",        fixed: { metals: 0.8, distance: 0.85, rotation: 0.6, volcanism: 0.2 },  dynamic: { size: 0.58, water: 0,   co2: 0.02, vegetation: 0.05 } },
  greenhouse: { label: "Effet de serre",    fixed: { metals: 0.8, distance: 0.55, rotation: 0.4, volcanism: 0.5 },  dynamic: { size: 0.75, water: 0.3, co2: 0.1,  vegetation: 0.02 } },
  dead:       { label: "Morte",             fixed: { metals: 0.8, distance: 1,    rotation: 0.5, volcanism: 0 },    dynamic: { size: 0.83, water: 0,   co2: 0.02, vegetation: 0 } },
  venus:      { label: "Vénus (pas de rotation)", fixed: { metals: 0.8, distance: 0.72, rotation: 0, volcanism: 0.6 }, dynamic: { size: 0.67, water: 0.3, co2: 0.05, vegetation: 0.02 } },
  volcanic:   { label: "Volcanique sombre", fixed: { metals: 0.7, distance: 1,    rotation: 0.3, volcanism: 3 }, dynamic: { size: 0.67, water: 0.4, co2: 0.05, vegetation: 0.02 } },
  glaciation: { label: "Glaciation",        fixed: { metals: 0.8, distance: 1.6,  rotation: 0.5, volcanism: 0.1 },  dynamic: { size: 0.5,  water: 0.6, co2: 0.02, vegetation: 0.05 } },
};

if (typeof module !== "undefined") {
  module.exports = { PRESETS };
}
