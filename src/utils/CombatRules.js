export function getZombieSpeed(zombie, now, { globalSlow = false, rain = false } = {}) {
  let speed = zombie.baseSpeed * (zombie._phaseTwo ? 1.25 : 1);
  if (globalSlow || rain) speed *= .4;
  if (zombie._slowEnd > now) {
    const slow = zombie._slowMul ?? .5;
    speed *= zombie._slowTotal > 15 ? 1 - (1 - slow) * .5 : slow;
  }
  return speed;
}

export const isBoss = zombie => zombie.type === 'boss' || zombie.type === 'traitor';
