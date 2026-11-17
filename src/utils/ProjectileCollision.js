// Sweep the segment traveled this step; a fast projectile must hit the first enemy it crosses.
export function findProjectileTarget(projectile, zombies) {
  const from = projectile.previousX, to = projectile.mesh.position.x;
  const radius = projectile.big ? .8 : .55;
  let nearest = null, distance = Infinity;
  for (const zombie of zombies) {
    if (zombie.dead || zombie.row !== projectile.row) continue;
    const x = zombie.mesh.position.x;
    if (x < Math.min(from, to) - radius || x > Math.max(from, to) + radius) continue;
    const delta = Math.abs(x - from);
    if (delta < distance) { nearest = zombie; distance = delta; }
  }
  return nearest;
}
