export const MODEL_ROOTS = {
  buildings: './assets/models/buildings/',
  decor: './assets/models/decor/',
  units: './assets/models/units/'
};

export function getModelCandidates(filename, root = 'buildings') {
  if (!filename) return [];
  const dir = MODEL_ROOTS[root] || MODEL_ROOTS.buildings;
  const base = `${dir}${filename}`;
  const named = filename
    .replaceAll('-', ' ')
    .replace(/\w/g, (c) => c.toUpperCase());
  const legacy = `${dir}${named}`;
  return [
    `${base}?v=7`,
    base,
    `${legacy}?v=7`,
    legacy,
  ];
}
