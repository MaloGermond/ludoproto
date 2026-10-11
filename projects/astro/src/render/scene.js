// ---------------------------------------------------------------------------
// Rendu
// ---------------------------------------------------------------------------

import { ALL_BODIES } from "../sim/index.js";
import { drawBody, drawBodyLabels, drawOrbits, drawStars } from "./bodies.js";
import { drawHUD } from "./hud.js";
import {
  drawApsis,
  drawGhostBodies,
  drawManeuverNodes,
  drawPathEnd,
  drawPredictedPath,
  drawTargetOrbit,
} from "./path.js";
import { drawShip, drawVelocityVector } from "./ship.js";

export function renderScene(world, view, prediction) {
  const target = world.mode === "planning" ? world.plan.target : world.autopilot ? world.autopilotTarget : null;

  background(6, 8, 16);
  drawStars(view);

  push();
  translate(width / 2, height / 2);
  scale(view.zoom);
  translate(-view.cameraX, -view.cameraY);

  drawOrbits(world, view);
  if (prediction) drawGhostBodies(world, view, prediction);
  for (const body of ALL_BODIES) drawBody(view, body);
  if (prediction) {
    drawTargetOrbit(view, prediction, target);
    drawPredictedPath(view, prediction);
    if (prediction.periapsis) drawApsis(view, prediction, prediction.periapsis, "Périastre", [255, 130, 130]);
    if (prediction.apoapsis) drawApsis(view, prediction, prediction.apoapsis, "Apoastre", [130, 190, 255]);
    drawPathEnd(view, prediction);
    drawManeuverNodes(world, view, prediction);
  }
  drawShip(world, view);
  drawVelocityVector(world, view);

  pop();

  drawBodyLabels(view);
  drawHUD(world, view, prediction);
}
