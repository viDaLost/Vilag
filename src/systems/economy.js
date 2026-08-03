import { GAME_CONFIG, TECHS, WEATHER_TYPES } from '../config.js';
import { computeBuildingYield } from './buildings.js';
import { clamp } from '../utils/helpers.js';

function levelSum(state, types) {
  return state.buildings.filter((building) => types.includes(building.type)).reduce((sum, building) => sum + building.level, 0);
}

function updateStorageCaps(state) {
  const foodCap = 260 + levelSum(state, ['granary', 'farm']) * 95;
  const materialCap = 220 + levelSum(state, ['lumber', 'mine', 'market']) * 65;
  state.resources.storageFood = foodCap;
  state.resources.storageMaterials = materialCap;
  state.resources.food = Math.min(state.resources.food, foodCap);
  state.resources.wood = Math.min(state.resources.wood, materialCap);
  state.resources.stone = Math.min(state.resources.stone, materialCap);
  state.resources.gold = Math.min(state.resources.gold, 650 + levelSum(state, ['market', 'harbor', 'capital']) * 110);
}

function healNearTemples(state, dt) {
  const temples = state.buildings.filter((building) => building.type === 'temple' && building.hp > 0);
  if (!temples.length) return;
  for (const unit of state.units) {
    if (unit.hostile || unit.dead || unit.hp >= unit.maxHp) continue;
    const temple = temples.find((building) => building.pos.distanceTo(unit.pos) <= 5.5 + building.level);
    if (temple) unit.hp = Math.min(unit.maxHp, unit.hp + dt * (.16 + temple.level * .08));
  }
}

export function applyRealTimeEconomy(state, dt) {
  const income = {
    gold: 0, food: 0, wood: 0, stone: 0, prestige: 0,
    stability: 0, knowledge: 0, populationCap: 0, defense: 0, army: 0,
  };
  const livingWorkers = state.units.filter((unit) => !unit.dead && unit.type === 'worker');

  for (const building of state.buildings) {
    if (building.hp <= 0 || building.upgrading) continue;
    const buildingYield = computeBuildingYield(state, building);
    for (const [key, value] of Object.entries(buildingYield)) income[key] = (income[key] || 0) + value;
  }

  const weather = WEATHER_TYPES[state.weather] || WEATHER_TYPES.clear;
  const staffedWorkers = state.buildings.reduce((sum, building) => sum + (building.activeWorkers || 0), 0);
  const freeWorkers = Math.max(0, livingWorkers.length - staffedWorkers);
  state.resources.workers = freeWorkers;
  const productivity = clamp(.62 + state.resources.stability / 100 * .5, .42, 1.14);
  const shortageFactor = state.resources.food < 10 ? .72 : 1;

  state.resources.gold += income.gold * productivity * shortageFactor * dt;
  state.resources.food += income.food * weather.food * productivity * dt;
  state.resources.wood += income.wood * productivity * dt;
  state.resources.stone += income.stone * productivity * dt;
  state.resources.prestige += income.prestige * dt;
  state.resources.knowledge += income.knowledge * (state.techs.has('archives') ? 1.1 : 1) * dt;
  state.resources.stability = clamp(state.resources.stability + (income.stability + (state.techs.has('dynasty') ? .025 : 0)) * dt, 0, 100);
  state.resources.army = state.units.filter((unit) => !unit.dead && !unit.hostile && unit.type !== 'worker').length;

  const capBase = 8 + Math.round(income.populationCap);
  state.resources.populationCap = Math.min(GAME_CONFIG.maxPopulationSoft, capBase);
  const soldiers = state.units.filter((unit) => !unit.dead && !unit.hostile && unit.type !== 'worker').length;
  const foodDrain = (state.resources.population * .025 + soldiers * .018) * dt;
  state.resources.food = Math.max(0, state.resources.food - foodDrain);

  if (state.resources.food <= .5) {
    state.resources.stability = clamp(state.resources.stability - dt * .62, 0, 100);
    state.resources.prestige = Math.max(0, state.resources.prestige - dt * .08);
  }
  if (state.resources.stability < 28) state.resources.gold = Math.max(0, state.resources.gold - dt * .18);
  if (state.resources.food < 12) state.resources.threat = clamp(state.resources.threat + dt * .1, 0, 100);
  if (state.resources.stability > 82) state.resources.prestige += dt * .025;
  if (freeWorkers === 0 && state.construction.length) state.resources.stability = clamp(state.resources.stability - dt * .018, 0, 100);
  state.resources.threat = clamp(state.resources.threat + dt * (.025 + state.era * .01) - Math.min(.05, income.defense * .0035), 0, 100);

  healNearTemples(state, dt);
  updateStorageCaps(state);
}

export function updateConstruction(state, dt) {
  const freeWorkers = Math.max(0, state.resources.workers || 0);
  const laborBoost = clamp(.58 + freeWorkers * .14 / Math.max(1, state.construction.length), .58, 1.45);
  state.construction.forEach((job) => { job.progress += dt * laborBoost; });
}

export function collectFinishedConstruction(state) {
  const done = state.construction.filter((job) => job.progress >= job.buildTime);
  state.construction = state.construction.filter((job) => job.progress < job.buildTime);
  return done;
}

export function updateEra(state) {
  const capital = state.buildings.find((building) => building.type === 'capital');
  if (!capital) { state.era = 0; return; }
  const learned = state.techs.size;
  if (capital.level >= 4 || (capital.level >= 3 && learned >= 3 && state.resources.prestige >= 55)) state.era = 2;
  else if (capital.level >= 2 || state.buildings.some((building) => building.type === 'academy' || building.type === 'harbor')) state.era = 1;
  else state.era = 0;
}

export function canResearch(state, tech) {
  return Boolean(tech) && !state.techs.has(tech.id) && state.era >= tech.minEra && !state.techProgress && state.resources.knowledge >= tech.cost;
}

export function beginResearch(state, techId) {
  const tech = TECHS.find((candidate) => candidate.id === techId);
  if (!canResearch(state, tech)) return false;
  state.resources.knowledge -= tech.cost;
  state.techProgress = { id: tech.id, progress: 0, duration: 17 + tech.cost * .32 };
  return true;
}

export function updateResearch(state, dt) {
  if (!state.techProgress) return null;
  const academyPower = state.buildings
    .filter((building) => building.type === 'academy')
    .reduce((sum, building) => sum + building.level * Math.max(.35, building.workerRatio || 0), 0);
  state.techProgress.progress += dt * (1 + academyPower * .12);
  if (state.techProgress.progress < state.techProgress.duration) return null;
  const id = state.techProgress.id;
  state.techs.add(id);
  state.techProgress = null;
  return id;
}

export function objectiveMetric(state, metric) {
  if (metric === 'food') return state.resources.food;
  if (metric === 'population') return state.resources.population;
  if (metric === 'economyReady') return ['farm', 'lumber', 'mine'].filter((type) => state.buildings.some((building) => building.type === type)).length;
  if (metric === 'uniqueBuildings') return new Set(state.buildings.map((building) => building.type)).size;
  if (metric === 'defensiveBuildings') return state.buildings.filter((building) => ['wall', 'tower', 'barracks'].includes(building.type)).length;
  if (metric === 'armyUnits') return state.stats.armyUnits;
  if (metric === 'campsDestroyed') return state.stats.campsDestroyed;
  if (metric === 'learnedTechs') return state.techs.size;
  if (metric === 'tradeBuildings') return ['market', 'harbor'].filter((type) => state.buildings.some((building) => building.type === type)).length;
  if (metric === 'prestige') return state.resources.prestige;
  if (metric === 'wonderBuilt') return state.stats.wonderBuilt;
  if (metric === 'enemyCampsRemaining') return state.enemyCamps.length;
  return 0;
}

export function updateObjectives(state) {
  const event = { completed: [], chapterAdvanced: false, victory: null };
  const chapter = state.campaign?.chapter || 0;
  for (const objective of state.objectives) {
    if (objective.done || objective.chapter !== chapter) continue;
    const current = objectiveMetric(state, objective.metric);
    const complete = objective.comparator === 'lte' ? current <= objective.target : current >= objective.target;
    if (!complete) continue;
    objective.done = true;
    for (const [key, value] of Object.entries(objective.reward)) state.resources[key] = (state.resources[key] || 0) + value;
    event.completed.push(objective);
    if (objective.branch) {
      state.victory = objective.branch;
      event.victory = objective.branch;
    }
  }

  if (!event.victory && chapter < 3) {
    const chapterObjectives = state.objectives.filter((objective) => objective.chapter === chapter);
    if (chapterObjectives.length && chapterObjectives.every((objective) => objective.done)) {
      state.campaign.chapter += 1;
      state.campaign.chapterStartedAt = state.worldTime;
      event.chapterAdvanced = true;
    }
  }
  return event;
}
