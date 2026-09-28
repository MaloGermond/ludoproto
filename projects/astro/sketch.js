// Prototype "lancer, orbiter" — issue #4
// Un vaisseau décolle de la surface d'une planète, subit une gravité
// newtonienne (planète + lune), et peut être placé en orbite stable.

const G = 800; // constante de gravité (échelle jeu, pas la vraie valeur)

// atterrissage : sans danger si le vaisseau touche par l'arrière (nez vers
// l'extérieur), à une vitesse d'impact raisonnable — sinon c'est un crash.
const LANDING_MAX_ANGLE = (45 * Math.PI) / 180;
const LANDING_MAX_SPEED = 120;

// rotation façon RCS spatial : maintenir ←/→ accélère en continu la vitesse
// angulaire, un tapotement bref ne fait qu'un petit ajustement. Sans
// frottement, la vitesse angulaire persiste jusqu'à ce qu'on la contre.
const ROTATION_ACCEL = 1.5; // rad/s² pendant que la touche est maintenue
const ROTATION_TAP_UNIT = 0.15; // rad/s ≈ un tapotement bref — unité d'affichage des "coups"

// assistance au cap : si le vaisseau tourne très lentement et se trouve déjà
// près d'un cap remarquable (prograde/rétrograde/perpendiculaire à la
// vitesse), il s'y accroche automatiquement.
const SNAP_ANGULAR_VELOCITY = 0.05; // rad/s — rotation quasi nulle
const SNAP_ANGLE_TOLERANCE = 0.1; // rad — proximité requise pour accrocher
const SNAP_PULL = 0.08; // fraction de l'écart corrigée par frame (effet doux)

const planet = {
  name: "Terre", // astre principal du système par défaut, en attendant un Soleil
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  radius: 220,
  mass: 1800,
  color: [90, 140, 200],
};

const moon = {
  name: "Lune",
  orbitRadius: 900,
  orbitSpeed: 0.05, // rad/s
  radius: 60,
  mass: 500,
  color: [180, 180, 180],
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
};
// rayon de la sphère d'influence de la Lune (formule patched-conics simplifiée)
moon.soi = moon.orbitRadius * Math.pow(moon.mass / planet.mass, 2 / 5);

let ship;
let trail = [];
const TRAIL_MAX = 400;

let cameraX = 0;
let cameraY = 0;
let zoom = 1;

function setup() {
  createCanvas(windowWidth, windowHeight);
  resetShip();
}

function resetShip() {
  const startAngle = -HALF_PI; // sommet de la planète
  ship = {
    x: planet.x + cos(startAngle) * (planet.radius + 14),
    y: planet.y + sin(startAngle) * (planet.radius + 14),
    vx: 0,
    vy: 0,
    angle: startAngle, // nez à l'opposé du centre de la planète, prêt à décoller
    angularVelocity: 0,
    size: 14,
    crashed: false,
    landed: true,
    landedBody: planet,
    landedAngle: startAngle,
  };
  trail = [];
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}

function moonPositionAt(t) {
  return {
    x: planet.x + cos(t * moon.orbitSpeed) * moon.orbitRadius,
    y: planet.y + sin(t * moon.orbitSpeed) * moon.orbitRadius,
  };
}

function bodies(t) {
  const pos = moonPositionAt(t);
  moon.x = pos.x;
  moon.y = pos.y;
  // vitesse instantanée de la Lune sur son orbite (dérivée de la position)
  moon.vx = -moon.orbitRadius * moon.orbitSpeed * sin(t * moon.orbitSpeed);
  moon.vy = moon.orbitRadius * moon.orbitSpeed * cos(t * moon.orbitSpeed);
  return [planet, moon];
}

function getReferenceBody(x, y) {
  // dans la sphère d'influence de la Lune : référentiel lunaire.
  // sinon, loin de tout, le référentiel par défaut est l'astre principal du système.
  if (dist(x, y, moon.x, moon.y) < moon.soi) return moon;
  return planet;
}

function referenceBodyPositionAt(referenceBody, t) {
  return referenceBody === moon ? moonPositionAt(t) : { x: planet.x, y: planet.y };
}

function draw() {
  const t = millis() / 1000;
  const activeBodies = bodies(t);
  const referenceBody = getReferenceBody(ship.x, ship.y);

  if (!ship.crashed) {
    updateShip(activeBodies, referenceBody);
  }

  // caméra centrée sur le vaisseau, dézoome un peu quand la vitesse augmente
  const speed = mag(ship.vx, ship.vy);
  const targetZoom = constrain(map(speed, 0, 400, 1, 0.4), 0.35, 1);
  zoom = lerp(zoom, targetZoom, 0.05);
  cameraX = lerp(cameraX, ship.x, 0.1);
  cameraY = lerp(cameraY, ship.y, 0.1);

  background(6, 8, 16);
  drawStars();

  push();
  translate(width / 2, height / 2);
  scale(zoom);
  translate(-cameraX, -cameraY);

  drawTrail();
  drawBody(planet);
  drawBody(moon);
  if (!ship.crashed && !ship.landed) {
    const trajectory = predictTrajectory(t, referenceBody);
    drawPredictedPath(trajectory.points);
    drawApsis(trajectory.periapsis, "Périgée", [255, 130, 130]);
    drawApsis(trajectory.apoapsis, "Apogée", [130, 190, 255]);
  }
  drawShip();
  drawVelocityVector(referenceBody);

  pop();

  drawHUD(referenceBody);
}

function predictTrajectory(t0, referenceBody) {
  const steps = 1800;
  const stepDt = 1 / 30; // pas fin pour rester stable près d'un corps (forte gravité locale)
  let x = ship.x;
  let y = ship.y;
  let vx = ship.vx;
  let vy = ship.vy;
  const refAtT0 = referenceBodyPositionAt(referenceBody, t0);
  const points = [{ x, y }];

  // apogée/périgée : point le plus proche/éloigné du référentiel actif sur
  // la trajectoire prédite
  const startDist = dist(x, y, refAtT0.x, refAtT0.y);
  let periapsis = { x, y, dist: startDist };
  let apoapsis = { x, y, dist: startDist };

  for (let i = 0; i < steps; i++) {
    // la lune continue d'avancer sur son orbite pendant la simulation
    const moonPos = moonPositionAt(t0 + i * stepDt);
    const stepBodies = [
      planet,
      { x: moonPos.x, y: moonPos.y, radius: moon.radius, mass: moon.mass },
    ];

    let ax = 0;
    let ay = 0;
    for (const body of stepBodies) {
      const dx = body.x - x;
      const dy = body.y - y;
      const r = mag(dx, dy) || 1;
      const a = (G * body.mass) / (r * r);
      ax += (a * dx) / r;
      ay += (a * dy) / r;
    }
    vx += ax * stepDt;
    vy += ay * stepDt;
    x += vx * stepDt;
    y += vy * stepDt;

    // affiche la trajectoire comme si le référentiel actif (ex : la Lune)
    // restait figé à sa position actuelle, plutôt qu'en coordonnées absolues
    const refNow = referenceBodyPositionAt(referenceBody, t0 + (i + 1) * stepDt);
    const displayX = x - refNow.x + refAtT0.x;
    const displayY = y - refNow.y + refAtT0.y;
    points.push({ x: displayX, y: displayY });

    const distToRef = dist(displayX, displayY, refAtT0.x, refAtT0.y);
    if (distToRef < periapsis.dist) periapsis = { x: displayX, y: displayY, dist: distToRef };
    if (distToRef > apoapsis.dist) apoapsis = { x: displayX, y: displayY, dist: distToRef };

    if (stepBodies.some((body) => dist(x, y, body.x, body.y) < body.radius)) {
      break; // impact prévu : on arrête la ligne là
    }
  }
  return { points, periapsis, apoapsis };
}

function drawPredictedPath(points) {
  noFill();
  stroke(130, 255, 170, 180);
  strokeWeight(1.5);
  drawingContext.setLineDash([6, 6]);
  beginShape();
  for (const p of points) vertex(p.x, p.y);
  endShape();
  drawingContext.setLineDash([]);
}

function drawApsis(point, label, color) {
  push();
  noStroke();
  fill(...color);
  circle(point.x, point.y, 8);
  fill(255);
  textSize(12);
  textAlign(CENTER, BOTTOM);
  text(label, point.x, point.y - 8);
  pop();
}

function angleDiff(from, to) {
  let d = (to - from) % TWO_PI;
  if (d > PI) d -= TWO_PI;
  if (d < -PI) d += TWO_PI;
  return d;
}

function updateShip(activeBodies, referenceBody) {
  const dt = deltaTime * 0.001;

  // pilotage manuel — flèches uniquement
  const left = keyIsDown(LEFT_ARROW);
  const right = keyIsDown(RIGHT_ARROW);
  const thrusting = keyIsDown(UP_ARROW);

  if (ship.landed) {
    const body = ship.landedBody;
    ship.x = body.x + cos(ship.landedAngle) * (body.radius + ship.size / 2);
    ship.y = body.y + sin(ship.landedAngle) * (body.radius + ship.size / 2);
    ship.vx = 0;
    ship.vy = 0;
    ship.thrusting = false;

    if (left) ship.angle -= 3.6 * dt;
    if (right) ship.angle += 3.6 * dt;

    if (!thrusting) return; // reste posé tant qu'on ne pousse pas
    ship.landed = false; // décollage
  }

  // rotation manuelle : maintenir accélère en continu, sans frottement —
  // la vitesse angulaire persiste tant qu'on ne la contre pas
  if (left) ship.angularVelocity -= ROTATION_ACCEL * dt;
  if (right) ship.angularVelocity += ROTATION_ACCEL * dt;

  // stabilise automatiquement un résidu de rotation quasi nul une fois les
  // touches relâchées : évite d'avoir à tomber pile sur zéro au minutage près
  if (!left && !right && Math.abs(ship.angularVelocity) < SNAP_ANGULAR_VELOCITY) {
    ship.angularVelocity = 0;
  }

  ship.angle += ship.angularVelocity * dt;

  // assistance au cap : rotation quasi nulle + déjà proche d'un cap
  // remarquable (prograde/rétrograde/perpendiculaire) → accroche dessus.
  // Désactivée tant qu'on maintient une touche, pour ne jamais "rattraper"
  // une rotation volontaire et bloquer le vaisseau.
  const relVx = ship.vx - referenceBody.vx;
  const relVy = ship.vy - referenceBody.vy;
  const speedNow = mag(relVx, relVy);
  if (!left && !right && speedNow > 1 && Math.abs(ship.angularVelocity) < SNAP_ANGULAR_VELOCITY) {
    const velocityAngle = atan2(relVy, relVx);
    const candidates = [velocityAngle, velocityAngle + PI, velocityAngle - HALF_PI, velocityAngle + HALF_PI];
    for (const target of candidates) {
      const diff = angleDiff(ship.angle, target);
      if (Math.abs(diff) < SNAP_ANGLE_TOLERANCE) {
        // attraction douce vers le cap plutôt qu'un saut brutal
        ship.angle += diff * SNAP_PULL;
        ship.angularVelocity = 0;
        break;
      }
    }
  }

  // gravité newtonienne cumulée de chaque corps
  let ax = 0;
  let ay = 0;
  for (const body of activeBodies) {
    const dx = body.x - ship.x;
    const dy = body.y - ship.y;
    const r = mag(dx, dy) || 1;
    const a = (G * body.mass) / (r * r);
    ax += (a * dx) / r;
    ay += (a * dy) / r;
  }

  // poussée directionnelle
  if (thrusting) {
    const thrustAccel = 90;
    ax += cos(ship.angle) * thrustAccel;
    ay += sin(ship.angle) * thrustAccel;
  }
  ship.thrusting = thrusting;

  ship.vx += ax * dt;
  ship.vy += ay * dt;
  ship.x += ship.vx * dt;
  ship.y += ship.vy * dt;

  trail.push({ x: ship.x, y: ship.y });
  if (trail.length > TRAIL_MAX) trail.shift();

  // collision avec un corps céleste
  for (const body of activeBodies) {
    const d = dist(ship.x, ship.y, body.x, body.y);
    if (d < body.radius + ship.size / 2) {
      const outwardAngle = atan2(ship.y - body.y, ship.x - body.x);
      const tilt = Math.abs(angleDiff(ship.angle, outwardAngle));
      const impactSpeed = mag(ship.vx, ship.vy);

      if (tilt <= LANDING_MAX_ANGLE && impactSpeed <= LANDING_MAX_SPEED) {
        // touche par l'arrière, à vitesse raisonnable : atterrissage réussi
        ship.landed = true;
        ship.landedBody = body;
        ship.landedAngle = outwardAngle;
        ship.angle = outwardAngle;
        ship.x = body.x + cos(outwardAngle) * (body.radius + ship.size / 2);
        ship.y = body.y + sin(outwardAngle) * (body.radius + ship.size / 2);
        ship.vx = 0;
        ship.vy = 0;
        ship.angularVelocity = 0;
      } else {
        ship.crashed = true;
      }
      break;
    }
  }
}

function drawStars() {
  randomSeed(1);
  noStroke();
  fill(255, 255, 255, 150);
  for (let i = 0; i < 200; i++) {
    const x = (random(-2000, 2000) - cameraX * 0.1) % width;
    const y = (random(-2000, 2000) - cameraY * 0.1) % height;
    circle((x + width) % width, (y + height) % height, 2);
  }
}

function drawTrail() {
  noFill();
  beginShape();
  for (let i = 0; i < trail.length; i++) {
    stroke(255, 255, 255, map(i, 0, trail.length, 0, 120));
    strokeWeight(1.5);
    vertex(trail[i].x, trail[i].y);
  }
  endShape();
}

function drawBody(body) {
  noStroke();
  fill(...body.color);
  circle(body.x, body.y, body.radius * 2);
}

function drawShip() {
  push();
  translate(ship.x, ship.y);
  rotate(ship.angle);
  noStroke();
  fill(ship.crashed ? [200, 60, 60] : [255, 220, 120]);
  triangle(-ship.size / 2, -ship.size / 2, -ship.size / 2, ship.size / 2, ship.size / 2, 0);
  if (ship.thrusting && !ship.crashed) {
    fill(255, 140, 40);
    triangle(-ship.size / 2, -ship.size / 4, -ship.size / 2, ship.size / 4, -ship.size - 8, 0);
  }
  pop();
}

function drawVelocityVector(referenceBody) {
  // vitesse relative au référentiel actif (comme le mode "Surface/Orbit" de Kerbal)
  const relVx = ship.vx - referenceBody.vx;
  const relVy = ship.vy - referenceBody.vy;
  const scaleFactor = 0.5;
  stroke(100, 220, 255, 200);
  strokeWeight(2);
  line(ship.x, ship.y, ship.x + relVx * scaleFactor, ship.y + relVy * scaleFactor);
}

function drawHUD(referenceBody) {
  const relSpeed = mag(ship.vx - referenceBody.vx, ship.vy - referenceBody.vy);
  const altitude = dist(ship.x, ship.y, referenceBody.x, referenceBody.y) - referenceBody.radius;
  const orbitalV = sqrt((G * referenceBody.mass) / (altitude + referenceBody.radius));

  noStroke();
  fill(255, 220);
  textSize(14);
  textAlign(LEFT, TOP);
  const lines = [
    `Référentiel : ${referenceBody.name}`,
    `Vitesse relative : ${relSpeed.toFixed(1)}`,
    `Altitude : ${Math.max(0, altitude).toFixed(0)}`,
    `Vitesse orbitale visée : ${orbitalV.toFixed(1)}`,
    ship.landed ? "" : `Vitesse de rotation : ${degrees(ship.angularVelocity).toFixed(0)}°/s`,
    ship.crashed ? "CRASH — [R] pour relancer" : ship.landed ? "Posé — [↑] pour décoller" : "",
  ];
  lines.forEach((l, i) => text(l, 16, 16 + i * 20));

  if (!ship.landed && !ship.crashed) {
    drawRotationIndicator(16, 16 + lines.length * 20 + 4);
  }

  textAlign(LEFT, BOTTOM);
  const controlLines = [
    "↑ poussée · ←/→ maintenir pour tourner, tapoter pour ajuster finement (inertie, sans frottement)",
    "Accroche automatique sur prograde/rétrograde/perpendiculaire si rotation quasi nulle",
    "Pointillés verts : trajectoire prédite (sans poussée)",
  ];
  controlLines.forEach((l, i) => {
    text(l, 16, height - 16 - (controlLines.length - 1 - i) * 20);
  });
}

function drawRotationIndicator(x, y) {
  const maxNotches = 6;
  const notchSize = 10;
  const gap = 3;
  const step = notchSize + gap;
  const count = constrain(Math.round(Math.abs(ship.angularVelocity) / ROTATION_TAP_UNIT), 0, maxNotches);
  const spinningLeft = ship.angularVelocity < -0.001;
  const spinningRight = ship.angularVelocity > 0.001;
  const centerX = x + maxNotches * step;

  noStroke();
  rectMode(CORNER);

  // crans à gauche du centre : s'allument si le vaisseau tourne à gauche
  for (let i = 0; i < maxNotches; i++) {
    const filled = spinningLeft && i < count;
    fill(filled ? [255, 150, 90] : [255, 255, 255, 30]);
    rect(centerX - gap / 2 - (i + 1) * step, y, notchSize, notchSize, 2);
  }
  // crans à droite du centre : s'allument si le vaisseau tourne à droite
  for (let i = 0; i < maxNotches; i++) {
    const filled = spinningRight && i < count;
    fill(filled ? [110, 190, 255] : [255, 255, 255, 30]);
    rect(centerX + gap / 2 + i * step, y, notchSize, notchSize, 2);
  }
  fill(255);
  rect(centerX - 1, y - 2, 2, notchSize + 4);

  fill(255, 200);
  textSize(11);
  textAlign(LEFT, TOP);
  const msg = spinningLeft
    ? `tourne à gauche — ${count} appui(s) droite pour stabiliser`
    : spinningRight
    ? `tourne à droite — ${count} appui(s) gauche pour stabiliser`
    : "rotation stable";
  text(msg, x, y + notchSize + 4);
}

function keyPressed() {
  if ((key === "r" || key === "R") && ship.crashed) {
    resetShip();
  }
}
