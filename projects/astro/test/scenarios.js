// Scénarios golden-master : chacun rejoue une situation type à pas fixes et
// renvoie un instantané (manœuvres calculées, échantillons d'état, résumé de
// la prédiction). Les fonctions s'exécutent dans le contexte du sketch.

// utilitaires injectés dans le contexte du sketch
function sampleShip(s, t) {
  return [t, s.ref.id, s.rx, s.ry, s.rvx, s.rvy, s.angle, s.angularVelocity, s.fuel, s.heat, s.landed, s.crashed];
}

function nodeSummary(nodes) {
  return nodes.map((n) => [n.kind ?? null, n.t, n.heading, n.power, n.duration]);
}

function predictionSummary(pred) {
  return {
    end: pred.end,
    finalT: pred.finalT,
    patches: pred.patches.map((p) => [p.body.id, p.t]),
    points: pred.points.length,
    lastPoint: pred.points[pred.points.length - 1],
    periapsis: pred.periapsis && pred.periapsis.dist,
    apoapsis: pred.apoapsis && pred.apoapsis.dist,
    fuel: pred.finalState.fuel,
  };
}

// exécute le plan depuis l'état courant du vaisseau, échantillonne tous
// les `every` pas, puis continue `extra` secondes après la fin du plan
function runPlan(world, nodes, extra, every) {
  const ctx = makeCtx(world.ship, world.time, nodes);
  const samples = [sampleShip(ctx.s, ctx.t)];
  let step = 0;
  const onStep = (c) => {
    if (++step % every === 0) samples.push(sampleShip(c.s, c.t));
  };
  runCtx(ctx, Infinity, (c) => {
    onStep(c);
    return !planDone(c);
  });
  runCtx(ctx, ctx.t + extra, onStep);
  samples.push(sampleShip(ctx.s, ctx.t));
  const pred = predictPath(world.ship, world.time, nodes.length ? createAutopilot(nodes) : null, PLAN_MAX_HORIZON);
  return { nodes: nodeSummary(nodes), samples, prediction: predictionSummary(pred) };
}

const SCENARIOS = {
  // pilotage manuel : poussée, virage, poussée, puis vol libre (atmosphère
  // terrestre, assistance au cap, retombée)
  decollage() {
    const s = cloneShip(createWorld().ship);
    let t = 0;
    let step = 0;
    const samples = [sampleShip(s, t)];
    const phases = [
      [1.5, { thrust: 1 }],
      [0.4, { right: true, thrust: 1 }],
      [2, { thrust: 1 }],
      [0.3, { left: true }],
      [120, {}],
    ];
    for (const [duration, keys] of phases) {
      const control = { ...COAST, assist: true, ...keys };
      const end = t + duration;
      while (t < end - 1e-9 && !s.crashed) {
        stepShip(s, t, SIM_DT, control);
        t += SIM_DT;
        if (++step % 30 === 0) samples.push(sampleShip(s, t));
      }
    }
    samples.push(sampleShip(s, t));
    return { samples, prediction: predictionSummary(predictPath(s, t, null, PLAN_MAX_HORIZON)) };
  },

  // décollage vertical calculé + circularisation en orbite de parking
  circularisation() {
    const world = createWorld();
    const nodes = [];
    legLaunch(makeCtx(world.ship, world.time, null), parkingRadius(planet), nodes);
    return runPlan(world, nodes, 60, 60);
  },

  // route complète Terre → Mars (évasion, fenêtre de tir, correction, capture)
  transfert() {
    const world = createWorld();
    const { nodes } = planRoute(world.ship, world.time, bodyById.mars, 150);
    return runPlan(world, nodes, 60, 600);
  },

  // route vers la Lune puis atterrissage guidé
  atterrissage() {
    const world = createWorld();
    const { nodes, final } = planRoute(world.ship, world.time, bodyById.moon, 100);
    const landing = landingSequence(final, final.t);
    return runPlan(world, [...nodes, ...landing.nodes], 5, 60);
  },
};

const HELPERS = [sampleShip, nodeSummary, predictionSummary, runPlan];

module.exports = { SCENARIOS, HELPERS };
