export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
export const lerp = (a, b, t) => a + (b - a) * t;
export const tileKey = (q, r) => `${q},${r}`;
export const fmt = (n) => Math.round(n * 10) / 10;
export const dist2 = (a, b) => {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
};
export const deepClone = (x) => JSON.parse(JSON.stringify(x));
