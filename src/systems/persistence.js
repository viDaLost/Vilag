import { GAME_CONFIG } from '../config.js';

function vectorData(value) {
  if (!value) return null;
  return { x: Number(value.x) || 0, y: Number(value.y) || 0, z: Number(value.z) || 0 };
}

export function serializeGame(state) {
  return {
    version: GAME_CONFIG.saveVersion,
    savedAt: Date.now(),
    worldSeed: state.worldSeed,
    quality: state.quality,
    timeScale: state.timeScale,
    paused: state.paused,
    dayTime: state.dayTime,
    seasonTime: state.seasonTime,
    worldTime: state.worldTime,
    weather: state.weather,
    era: state.era,
    resources: { ...state.resources },
    objectives: state.objectives.map((objective) => ({ id: objective.id, done: objective.done })),
    campaign: { ...state.campaign },
    territoryRadius: state.territoryRadius,
    territoryGrowthAt: state.territoryGrowthAt,
    techs: [...state.techs],
    techProgress: state.techProgress ? { ...state.techProgress } : null,
    stats: { ...state.stats },
    victory: state.victory,
    aiState: { ...state.aiState },
    resourcesWorld: [
      ...state.trees.map((resource) => ({ id: resource.id, hp: resource.hp, depletedUntil: resource.depletedUntil || 0 })),
      ...state.rocks.map((resource) => ({ id: resource.id, hp: resource.hp, depletedUntil: resource.depletedUntil || 0 })),
    ],
    buildings: state.buildings.map((building) => ({
      id: building.id, type: building.type, pos: vectorData(building.pos), level: building.level,
      hp: building.hp, maxHp: building.maxHp, trainQueue: (building.trainQueue || []).map((item) => ({ ...item })),
      rallyPos: vectorData(building.rallyPos), priority: building.priority ?? 1,
    })),
    construction: state.construction.map((job) => ({
      id: job.id, type: job.type, x: job.x, z: job.z, progress: job.progress,
      buildTime: job.buildTime, mode: job.mode, buildingId: job.buildingId || null,
      targetLevel: job.targetLevel || null,
    })),
    enemyCamps: state.enemyCamps.map((camp) => ({
      id: camp.id, pos: vectorData(camp.pos), faction: camp.faction, hp: camp.hp, maxHp: camp.maxHp,
      level: camp.level || 1, stock: { ...(camp.stock || {}) }, lastRaidAt: camp.lastRaidAt || 0,
    })),
    units: state.units.map((unit) => ({
      id: unit.id, type: unit.type, hp: unit.hp, maxHp: unit.maxHp, pos: vectorData(unit.pos),
      homeBuildingId: unit.homeBuildingId, homeCampId: unit.homeCampId,
      assignedBuildingId: unit.assignedBuildingId, taskPhase: unit.taskPhase,
      carrying: unit.carrying ? { ...unit.carrying } : null, resourceTargetId: unit.resourceTargetId,
      commandTarget: vectorData(unit.commandTarget), patrolCenter: vectorData(unit.patrolCenter),
      guardPoint: vectorData(unit.guardPoint), targetBuildingId: unit.targetBuildingId, aiRole: unit.aiRole,
    })),
  };
}

export function saveGame(state) {
  try {
    localStorage.setItem(GAME_CONFIG.saveKey, JSON.stringify(serializeGame(state)));
    return true;
  } catch (error) {
    console.warn('Save failed', error);
    return false;
  }
}

function normalizeSave(raw) {
  if (!raw || typeof raw !== 'object' || !raw.resources) return null;
  if (!raw.version) return { ...raw, version: 1, worldSeed: raw.worldSeed || 12031991, legacy: true };
  return raw;
}

export function loadGame() {
  try {
    const stored = localStorage.getItem(GAME_CONFIG.saveKey);
    return stored ? normalizeSave(JSON.parse(stored)) : null;
  } catch {
    return null;
  }
}

export function applySaveToState(state, raw) {
  const save = normalizeSave(raw);
  if (!save) return false;
  state.worldSeed = save.worldSeed || state.worldSeed;
  state.quality = save.quality || state.quality;
  state.timeScale = [1, 2, 4].includes(save.timeScale) ? save.timeScale : 1;
  state.paused = false;
  state.dayTime = Number(save.dayTime) || 0;
  state.seasonTime = Number(save.seasonTime) || 0;
  state.worldTime = Number(save.worldTime) || 0;
  state.weather = save.weather || 'clear';
  state.era = Number(save.era) || 0;
  Object.assign(state.resources, save.resources || {});
  state.techs = new Set(Array.isArray(save.techs) ? save.techs : []);
  state.techProgress = save.techProgress ? { ...save.techProgress } : null;
  Object.assign(state.stats, save.stats || {});
  state.territoryRadius = Number(save.territoryRadius) || state.territoryRadius;
  state.territoryGrowthAt = Number(save.territoryGrowthAt) || state.territoryGrowthAt;
  state.victory = save.victory || null;
  Object.assign(state.campaign, save.campaign || {});
  Object.assign(state.aiState, save.aiState || {});
  const completed = new Set((save.objectives || []).filter((objective) => objective.done).map((objective) => objective.id));
  state.objectives.forEach((objective) => { objective.done = completed.has(objective.id); });
  state.resourceSnapshot = Array.isArray(save.resourcesWorld)
    ? save.resourcesWorld.map((resource) => ({ ...resource }))
    : [
        ...(save.trees || []).map((resource, index) => ({ id: resource.id || `tree-${index}`, hp: resource.hp, depletedUntil: 0 })),
        ...(save.rocks || []).map((resource, index) => ({ id: resource.id || `rock-${index}`, hp: resource.hp, depletedUntil: 0 })),
      ];
  state.restoreSnapshot = {
    buildings: Array.isArray(save.buildings) ? save.buildings : [],
    construction: Array.isArray(save.construction) ? save.construction : [],
    enemyCamps: Array.isArray(save.enemyCamps) ? save.enemyCamps : [],
    units: Array.isArray(save.units) ? save.units : [],
    legacy: Boolean(save.legacy),
  };
  return true;
}

export function clearSave() {
  localStorage.removeItem(GAME_CONFIG.saveKey);
}
