// Tests golden-master : rejoue les scénarios types et compare, au bit près,
// à l'instantané commité dans test/golden/. La simulation est déterministe
// (pas fixes), toute dérive signale un changement de comportement.
//
// Mettre à jour les instantanés (après un changement voulu) :
//   npm run test:update
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { loadSketch } = require("./load-sketch");
const { SCENARIOS, HELPERS } = require("./scenarios");

const GOLDEN_DIR = path.join(__dirname, "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

// aller-retour JSON : même représentation que le fichier (-0 → 0, etc.)
const normalize = (value) => JSON.parse(JSON.stringify(value));

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(name, () => {
    const sketch = loadSketch();
    for (const helper of HELPERS) sketch.define(helper);
    // méthode `nom() { … }` → expression de fonction exécutée dans le sketch
    const actual = normalize(sketch.call(scenario.toString().replace(/^\w+\(\)/, "function ()")));
    const file = path.join(GOLDEN_DIR, `${name}.json`);
    if (UPDATE) {
      fs.writeFileSync(file, JSON.stringify(actual) + "\n");
      return;
    }
    assert.ok(fs.existsSync(file), `instantané manquant : ${file} (lancer npm run test:update)`);
    assert.deepStrictEqual(actual, JSON.parse(fs.readFileSync(file, "utf8")));
  });
}
