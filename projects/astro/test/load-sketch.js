// Charge sketch.js dans un contexte isolé, sans p5 ni navigateur : seules
// les fonctions mathématiques de p5 utilisées par la simulation sont
// fournies, avec exactement la même implémentation que p5 1.9.3 (résultats
// identiques au bit près). Les crochets p5 (setup, draw…) ne sont jamais
// appelés : le chargement ne fait que définir constantes et fonctions.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const SKETCH = path.join(__dirname, "..", "sketch.js");

const P5_MATH = {
  PI: Math.PI,
  HALF_PI: Math.PI / 2,
  TWO_PI: Math.PI * 2,
  constrain: (n, low, high) => Math.max(Math.min(n, high), low),
  radians: (angle) => angle * (Math.PI / 180),
  degrees: (angle) => angle * (180 / Math.PI),
  map: (n, start1, stop1, start2, stop2) => ((n - start1) / (stop1 - start1)) * (stop2 - start2) + start2,
  lerp: (start, stop, amt) => amt * (stop - start) + start,
  dist: (x1, y1, x2, y2) => Math.hypot(x2 - x1, y2 - y1),
};

function loadSketch() {
  const context = vm.createContext({ console, ...P5_MATH });
  vm.runInContext(fs.readFileSync(SKETCH, "utf8"), context, { filename: SKETCH });
  return {
    // exécute une fonction dans le contexte du sketch (accès à ses globales)
    call: (fn) => vm.runInContext(`(${fn.toString()})()`, context),
    define: (fn) => vm.runInContext(fn.toString(), context),
  };
}

module.exports = { loadSketch };
