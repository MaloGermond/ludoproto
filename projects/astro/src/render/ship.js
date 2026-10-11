// Vaisseau et vecteur vitesse.

export function drawShip(world, view) {
  const ship = world.ship;
  push();
  translate(ship.x, ship.y);
  rotate(ship.angle);
  // taille minimale à l'écran pour ne pas perdre le vaisseau en dézoomant
  const k = Math.max(1, 6 / (ship.size * view.zoom));
  scale(k);
  noStroke();
  fill(ship.crashed ? [200, 60, 60] : [255, 220, 120]);
  triangle(-ship.size / 2, -ship.size / 2, -ship.size / 2, ship.size / 2, ship.size / 2, 0);
  if (ship.thrusting && !ship.crashed && world.mode === "flight") {
    fill(255, 140, 40);
    triangle(-ship.size / 2, -ship.size / 4, -ship.size / 2, ship.size / 4, -ship.size - 8, 0);
  }
  pop();
}

export function drawVelocityVector(world, view) {
  const ship = world.ship;
  // vitesse relative au référentiel actif (comme le mode "Surface/Orbit" de Kerbal)
  const scaleFactor = 0.5;
  stroke(100, 220, 255, 200);
  strokeWeight(2 / view.zoom);
  line(ship.x, ship.y, ship.x + ship.rvx * scaleFactor, ship.y + ship.rvy * scaleFactor);
}
