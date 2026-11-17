/** Required orbit distance for a centered board inside the visible HUD margins. */
export function getBoardOrbitRadius({ halfWidth, halfDepth, phi, fov, aspect, height, verticalReserve = 250, headroom = 3, safeX = .92 }) {
  const tanV = Math.tan(fov * Math.PI / 360);
  const safeY = Math.max(0.3, 1 - verticalReserve / height);
  let radius = 0;
  for (const x of [-halfWidth, halfWidth]) for (const z of [-halfDepth, halfDepth]) {
    const depth = z * Math.sin(phi);
    radius = Math.max(radius, depth + Math.abs(x) / (tanV * aspect * safeX),
      depth + (Math.abs(z * Math.cos(phi)) + headroom) / (tanV * safeY));
  }
  return radius;
}
