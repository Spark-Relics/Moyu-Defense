export const STEP = 1 / 60;

// Bounded fixed steps preserve collisions and the selected speed on slow frames.
export function advanceSimulation(accumulator, elapsed, speed, update) {
  accumulator += Math.min(Math.max(elapsed, 0), 0.1) * speed;
  while (accumulator + 1e-9 >= STEP) {
    if (update(STEP) === false) return 0;
    accumulator -= STEP;
  }
  return Math.max(0, accumulator);
}
