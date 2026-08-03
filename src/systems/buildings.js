import { sampleTerrainHeight } from './terrain.js';
import { sampleTerrain } from './world.js';
import * as THREE from 'three';
import { BUILDINGS } from '../config.js';
import { loadBuildingModel, makeFallbackMesh, loadDecorModel, groundScene } from '../core/assets.js';
import { tradeNetworkBonus } from './roads.js';


let buildingId = 1;

function claimId(id) {
  const numeric = Number(String(id || '').replace(/\D/g, ''));
  if (Number.isFinite(numeric)) buildingId = Math.max(buildingId, numeric + 1);
}

function selectionRing() {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.4, 1.65, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: 0, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .04;
  return ring;
}

function scaleForBuilding(type, level) {
  const base = {
    capital: 2.38, farm: 1.02, lumber: 1.0, mine: 1.04, market: 1.08,
    granary: 1.02, temple: 1.12, barracks: 1.12, wall: .96, tower: 1.08,
    academy: 1.06, harbor: 1.08, wonder: 1.2
  };
  return (base[type] || 1.0) * (1 + (level - 1) * .1);
}

function buildingBaseLift(type) {
  return {
    capital: 0.18,
    barracks: 0.08,
    temple: 0.07,
    tower: 0.05,
    wall: 0.03,
  }[type] || 0.02;
}

export function getUpgradeCost(type, nextLevel) {
  const cfg = BUILDINGS[type];
  const base = cfg.cost || {};
  const mul = 0.7 + nextLevel * 0.42;
  const out = {};
  Object.entries(base).forEach(([k, v]) => { out[k] = Math.max(1, Math.round(v * mul)); });
  if (!Object.keys(out).length) {
    out.gold = 45 * nextLevel;
    out.stone = 18 * nextLevel;
  }
  return out;
}

export function getUpgradeTime(type, nextLevel) {
  return Math.round((BUILDINGS[type].baseBuildTime || 12) * (0.85 + nextLevel * 0.28));
}

export function canPlaceBuilding(state, type, x, z) {
  const cfg = BUILDINGS[type];
  if (!cfg) return false;
  if (Math.hypot(x, z) > state.territoryRadius) return false;

  const terrain = sampleTerrain(state, x, z);
  if (terrain.type === 'water') return false;

  // Rock is only safe for mines, temples/towers, and late prestige projects. Everything else needs flatter land.
  const rockAllowed = ['mine', 'tower', 'temple', 'wonder'].includes(type);
  if (terrain.type === 'rock' && !rockAllowed) return false;
  if (type === 'mine' && terrain.type !== 'hill' && terrain.type !== 'rock') return false;
  if (type === 'harbor' && terrain.type !== 'river') return false;

  const footprint = type === 'capital' ? 2.1 : type === 'wonder' ? 1.45 : 1.02;
  const heights = [
    sampleTerrain(state, x + footprint, z).height,
    sampleTerrain(state, x - footprint, z).height,
    sampleTerrain(state, x, z + footprint).height,
    sampleTerrain(state, x, z - footprint).height,
  ];
  const slope = Math.max(...heights) - Math.min(...heights);
  if (slope > (['mine', 'tower', 'wall'].includes(type) ? 1.15 : .68)) return false;

  // Check collision with other buildings
  const r = 1.0 + (type === 'capital' ? 1.2 : 0);
  for (const b of state.buildings) {
      if (Math.hypot(b.pos.x - x, b.pos.z - z) < r + b.blockRadius) return false;
  }
  for (const job of state.construction) {
    if (job.mode !== 'new') continue;
    if (Math.hypot(job.x - x, job.z - z) < r + 1.05) return false;
  }

  return true;
}

export function canUpgradeBuilding(state, building) {
  if (!building) return false;
  const cfg = BUILDINGS[building.type];
  if (!cfg || building.level >= (cfg.maxLevel || 1)) return false;
  if (state.construction.some((job) => job.buildingId === building.id)) return false;
  return hasCost(state.resources, getUpgradeCost(building.type, building.level + 1));
}

export function payCost(resources, cost) {
  if (!cost) return true;
  for (const [key, value] of Object.entries(cost)) {
    if ((resources[key] || 0) < value) return false;
  }
  for (const [key, value] of Object.entries(cost)) {
    resources[key] -= value;
  }
  return true;
}

export function hasCost(resources, cost) {
  if (!cost) return true;
  return Object.entries(cost).every(([k, v]) => (resources[k] || 0) >= v);
}

export function placeConstruction(state, type, x, z) {
  const cfg = BUILDINGS[type];
  const id = `c-${buildingId++}`;
  const job = {
    id, type, x, z, progress: 0, buildTime: cfg.baseBuildTime, mode: 'new',
  };
  state.construction.push(job);
  return job;
}

export function startUpgrade(state, building) {
  const nextLevel = building.level + 1;
  const cost = getUpgradeCost(building.type, nextLevel);
  if (!hasCost(state.resources, cost)) return null;
  payCost(state.resources, cost);
  const job = {
    id: `c-${buildingId++}`, type: building.type, buildingId: building.id,
    tileId: building.tileId, x: building.pos.x, z: building.pos.z, progress: 0, buildTime: getUpgradeTime(building.type, nextLevel),
    mode: 'upgrade', targetLevel: nextLevel,
  };
  state.construction.push(job);
  building.upgrading = true;
  return job;
}

export function repairBuilding(state, building) {
  if (!building || building.hp >= building.maxHp) return false;
  const missing = building.maxHp - building.hp;
  const cost = {
    wood: Math.max(1, Math.round(missing / 25)),
    stone: Math.max(0, Math.round(missing / 40)),
    gold: Math.max(1, Math.round(missing / 35)),
  };
  if (!hasCost(state.resources, cost)) return false;
  payCost(state.resources, cost);
  building.hp = Math.min(building.maxHp, building.hp + missing * .7);
  return true;
}

export function destroyBuilding(sceneCtx, state, building) {
  if (!building || building.type === 'capital') return false;
  const tile = null;
  if (tile) tile.buildingId = null;
  sceneCtx.groups.buildings.remove(building.mesh);
  if (building.extraMeshes?.length) building.extraMeshes.forEach((m) => sceneCtx.groups.decor.remove(m));
  state.units.forEach((u) => {
    if (u.assignedBuildingId === building.id) {
      u.assignedBuildingId = null;
      u.awaitingWork = true;
      u.taskPhase = 'toBuilding';
    }
  });
  state.buildings = state.buildings.filter((b) => b.id !== building.id);
  state.construction = state.construction.filter((job) => job.buildingId !== building.id);
  const refund = Math.round((BUILDINGS[building.type].cost?.wood || 0) * .25);
  state.resources.wood += refund;
  state.resources.stone += Math.round((BUILDINGS[building.type].cost?.stone || 0) * .2);
  return true;
}

function spawnFarmBeds(sceneCtx, state, cx, cz, entity) {
  const beds = [];
  entity.extraMeshes = beds;
  (async () => {
    try {
      const layout = [[-0.58,0.42],[0.0,0.58],[0.58,0.38],[-0.52,-0.18],[0.12,-0.28]];
      for (let i = 0; i < layout.length; i++) {
        const model = await loadDecorModel('crops.glb');
        const [ox, oz] = layout[i];
        model.scale.setScalar(0.26 + (i % 2) * 0.02);
        model.rotation.y = Math.PI / 2;
        const x = cx + ox;
        const z = cz + oz;
        model.position.set(x, sampleTerrainHeight(state, x, z) + 0.015, z);
        sceneCtx.groups.decor.add(model);
        beds.push(model);
      }
    } catch {
      // Decorative crop beds are optional; the gameplay building remains valid without them.
    }
  })();
}

export async function createGhostBuildingMesh(type) {
  const cfg = BUILDINGS[type];
  if (!cfg?.model) return null;
  try {
    const model = await loadBuildingModel(cfg.model);
    model.scale.setScalar(scaleForBuilding(type, 1));
    groundScene(model, buildingBaseLift(type));
    model.traverse((obj) => {
      if (obj.isMesh && obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        const ghostMats = mats.map((m) => {
          const clone = m.clone();
          clone.transparent = true;
          clone.opacity = 0.38;
          clone.depthWrite = false;
          return clone;
        });
        obj.material = Array.isArray(obj.material) ? ghostMats : ghostMats[0];
      }
    });
    return model;
  } catch { return null; }
}

function makeTextSprite(text, color = '#ffe7a8', bg = 'rgba(36,14,5,0.65)', scale = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect?.(10, 12, 236, 72, 28);
  if (!ctx.roundRect) ctx.fillRect(10, 12, 236, 72);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,214,107,0.35)'; ctx.lineWidth = 4; ctx.strokeRect(10, 12, 236, 72);
  ctx.fillStyle = color; ctx.font = '700 42px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 128, 50);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(1.3 * scale, 0.48 * scale, 1);
  sprite.position.set(0, 2.55, 0);
  return sprite;
}

function starCountForLevel(level) {
  return level <= 1 ? 0 : Math.min(5, level);
}

function updateBuildingBadge(building) {
  if (building.levelBadge) { building.mesh.remove(building.levelBadge); building.levelBadge = null; }
  const count = starCountForLevel(building.level);
  if (!count) return;
  const badge = makeTextSprite('★'.repeat(count), '#ffe39a', 'rgba(29,12,4,0.55)', 1 + Math.min(0.3, count * 0.04));
  badge.position.y = 2.2 + Math.min(1.2, building.level * 0.22);
  building.mesh.add(badge);
  building.levelBadge = badge;
}

export function finishConstruction(sceneCtx, state, job) {
  if (job.mode === 'upgrade') {
    const building = getBuildingById(state, job.buildingId);
    if (!building) return null;
    const cfg = BUILDINGS[building.type];
    building.level = job.targetLevel;
    building.maxHp = Math.round(cfg.health * (1 + (building.level - 1) * .25));
    building.hp = building.maxHp;
    building.upgrading = false;
    const model = building.modelRoot || building.mesh.children[0];
    if (model) {
      model.scale.setScalar(scaleForBuilding(building.type, building.level));
      groundScene(model, buildingBaseLift(building.type));
    }
    if (building.glow) building.glow.intensity = .9 + building.level * .1;
    if (cfg.territory) state.territoryRadius += cfg.territory * 0.32;
    updateBuildingBadge(building);
    building.blockRadius = 0.9 + (building.level - 1) * 0.12 + (building.type === 'capital' ? 1.2 : 0);
    return building;
  }

  const cfg = BUILDINGS[job.type];
  if (!cfg) return null;

  const anchorY = sampleTerrainHeight(state, job.x, job.z);

  const restoredLevel = Math.max(1, job.savedLevel || 1);
  const restoredMaxHp = job.savedMaxHp || Math.round(cfg.health * (1 + (restoredLevel - 1) * .25));
  const entity = {
    id: job.savedId || `b-${buildingId++}`, type: job.type, tileId: null, level: restoredLevel, hp: job.savedHp ?? restoredMaxHp, maxHp: restoredMaxHp,
    cooldown: 0, trainQueue: [], mesh: new THREE.Group(), selection: null, glow: null, hitFlash: 0,
    upgrading: false, extraMeshes: [], levelBadge: null, rallyTileId: null, workerDemand: 0, activeWorkers: 0,
    workerRatio: 1, blockRadius: 0.9 + (job.type === 'capital' ? 1.2 : job.type === 'wonder' ? .45 : 0),
    pos: new THREE.Vector3(job.x, anchorY, job.z),
    surfaceY: anchorY, priority: job.savedPriority ?? 1, roadConnected: false,
    rallyPos: job.savedRallyPos ? new THREE.Vector3(job.savedRallyPos.x, sampleTerrainHeight(state, job.savedRallyPos.x, job.savedRallyPos.z), job.savedRallyPos.z) : null,
  };
  claimId(entity.id);
  entity.trainQueue = (job.savedTrainQueue || []).map((queued) => ({ ...queued }));

  const foundation = new THREE.Mesh(
    new THREE.CylinderGeometry(entity.blockRadius * .88, entity.blockRadius, .16, 16),
    new THREE.MeshStandardMaterial({ color: job.type === 'capital' ? 0xb9985e : 0x7a684f, roughness: 1 }),
  );
  foundation.position.y = .035;
  foundation.receiveShadow = true;
  entity.mesh.add(foundation);
  entity.foundation = foundation;

  const placeholder = makeFallbackMesh(job.type === 'capital' ? 0xc9a45b : 0xa8844d);
  placeholder.scale.setScalar(scaleForBuilding(job.type, entity.level));
  placeholder.position.y = buildingBaseLift(job.type);
  entity.mesh.add(placeholder);
  entity.modelRoot = placeholder;

  loadBuildingModel(cfg.model).then((model) => {
    if (!entity.mesh || !entity.modelRoot) return;
    entity.mesh.remove(entity.modelRoot);
    entity.modelRoot = model;
    model.scale.setScalar(scaleForBuilding(job.type, entity.level || 1));
    groundScene(model, buildingBaseLift(job.type));
    entity.mesh.add(model);
  }).catch(() => {});

  const ring = selectionRing(); ring.position.y = 0.05; entity.mesh.add(ring); entity.selection = ring;
  const light = new THREE.PointLight(0xffcc88, job.type === 'capital' ? 1.2 : 0.82, job.type === 'capital' ? 9 : 6);
  light.position.set(0, 2.2, 0); entity.mesh.add(light); entity.glow = light;
  
  entity.mesh.userData.buildingId = entity.id;
  entity.mesh.position.set(job.x, anchorY, job.z);
  sceneCtx.groups.buildings.add(entity.mesh);

  updateBuildingBadge(entity);
  state.buildings.push(entity);


  if (cfg.territory && !job.restoring) state.territoryRadius += cfg.territory;
  if (state.techs.has('stonework') && ['wall', 'tower', 'temple'].includes(job.type)) {
    entity.maxHp = Math.round(entity.maxHp * 1.18); entity.hp = entity.maxHp;
  }
  if (job.type === 'wonder') state.stats.wonderBuilt = 1;
  if (job.type === 'farm') spawnFarmBeds(sceneCtx, state, job.x, job.z, entity);
  return entity;
}

export function getBuildingById(state, id) { return state.buildings.find((b) => b.id === id) || null; }
export function getBuildingOnTile(state, tile) { if (!tile?.buildingId) return null; return getBuildingById(state, tile.buildingId); }

export function getBuildingWorkerDemand(building) {
  const cfg = BUILDINGS[building.type];
  const base = cfg?.requiredWorkers || 0;
  if (!base) return 0;
  return Math.max(1, Math.ceil(base + (building.level - 1) * 0.9));
}

export function getBuildingWorkerStatus(state, building) {
  const demand = getBuildingWorkerDemand(building);
  const assigned = state.units.filter((u) => u.type === 'worker' && !u.dead && u.assignedBuildingId === building.id).length;
  return { demand, assigned, ratio: demand ? Math.min(1, assigned / demand) : 1 };
}

export function computeBuildingYield(state, building) {
  const cfg = BUILDINGS[building.type];
  const out = { ...(cfg.yields || {}) };
  const levelFactor = 1 + (building.level - 1) * .35;
  for (const key of Object.keys(out)) out[key] *= levelFactor;

  const terrain = sampleTerrain(state, building.pos.x, building.pos.z);

  if (building.type === 'farm') {
    if (terrain.type === 'fertile') out.food += .32;
    if (terrain.type === 'river') out.food += .25;
    if (state.techs.has('irrigation') && ['river', 'fertile'].includes(terrain.type)) out.food += .22;
  }

  if (building.type === 'lumber') {
    // Lumber relies on workers actively chopping trees now, but passive background yield could scale on nearby trees
    let nearbyTrees = 0;
    for (const tree of state.trees) {
        if (Math.hypot(tree.x - building.pos.x, tree.z - building.pos.z) < 5.0) nearbyTrees++;
    }
    out.wood += nearbyTrees * .02;
  }

  if (building.type === 'mine') {
    if (terrain.type === 'rock') out.stone += .18;
    if (terrain.type === 'hill') out.gold += .06;
  }
  if (building.type === 'market') out.gold = (out.gold + state.buildings.length * .008) * tradeNetworkBonus(state);
  if (building.type === 'temple' && terrain.type === 'sacred') out.prestige += .12;
  if (building.type === 'academy' && state.techs.has('archives')) out.knowledge += .08;
  if (building.type === 'harbor') out.gold *= tradeNetworkBonus(state);
  if (building.type === 'tower' && state.techs.has('discipline')) out.defense += .25;
  if (building.type === 'capital' && state.era > 0) { out.gold += .14 * state.era; out.populationCap += 2 * state.era; }

  const workerStatus = getBuildingWorkerStatus(state, building);
  building.workerDemand = workerStatus.demand; building.activeWorkers = workerStatus.assigned; building.workerRatio = workerStatus.ratio;
  if (workerStatus.demand && !['capital', 'barracks', 'wall', 'tower'].includes(building.type)) {
    Object.keys(out).forEach((key) => { if (key !== 'populationCap' && key !== 'defense') out[key] *= workerStatus.ratio; });
  }
  return out;
}

export function getCapital(state) { return state.buildings.find((b) => b.type === 'capital') || null; }

export function buildingCenter(state, building) {
  if (!building?.pos) return new THREE.Vector3(0, 0.6, 0);
  const y = Number.isFinite(building.surfaceY) ? building.surfaceY : building.pos.y;
  return building.pos.clone().setY(y + .6);
}

export function getBuildingStatus(state, building) {
  const cfg = BUILDINGS[building.type];
  const canUpgrade = canUpgradeBuilding(state, building);
  return {
    cfg, canUpgrade, upgradeCost: getUpgradeCost(building.type, building.level + 1),
    upgradeTime: getUpgradeTime(building.type, building.level + 1), repairNeeded: building.hp < building.maxHp * .96,
  };
}

export function cycleBuildingPriority(building) {
  building.priority = ((building.priority ?? 1) + 1) % 3;
  return building.priority;
}

export function buildingPriorityLabel(building) {
  return ['Низкий', 'Обычный', 'Высокий'][building.priority ?? 1];
}
