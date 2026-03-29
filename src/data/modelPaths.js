export const MODEL_ROOTS = {
  buildings: './assets/models/buildings/',
  decor: './assets/models/decor/',
  units: './assets/models/units/',
  kenney: './assets/kenney/nature/'
};

export function getModelCandidates(filename, root = 'buildings') {
  if (!filename) return [];
  const dir = MODEL_ROOTS[root] || MODEL_ROOTS.buildings;
  const base = `${dir}${filename}`;
  return [
    `${base}?v999`,
    base,
  ];
}
