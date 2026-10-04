// Tests golden-master : rejoue les scénarios types et compare, au bit près,
// à l'instantané commité dans test/golden/. La simulation est déterministe
// (pas fixes), toute dérive signale un changement de comportement.
//
// Mettre à jour les instantanés (après un changement voulu) :
//   npm run test:update
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SCENARIOS } from "./scenarios.js";

const GOLDEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "golden");
const UPDATE = process.env.UPDATE_GOLDEN === "1";

// aller-retour JSON : même représentation que le fichier (-0 → 0, etc.)
const normalize = (value) => JSON.parse(JSON.stringify(value));

for (const [name, scenario] of Object.entries(SCENARIOS)) {
  test(name, () => {
    const actual = normalize(scenario());
    const file = path.join(GOLDEN_DIR, `${name}.json`);
    if (UPDATE) {
      fs.writeFileSync(file, JSON.stringify(actual) + "\n");
      return;
    }
    assert.ok(fs.existsSync(file), `instantané manquant : ${file} (lancer npm run test:update)`);
    assert.deepStrictEqual(actual, JSON.parse(fs.readFileSync(file, "utf8")));
  });
}
