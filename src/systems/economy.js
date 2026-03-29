import { GAME_CONFIG, TECHS, WEATHER_TYPES } from '../config.js';
import { computeBuildingYield } from './buildings.js';
import { clamp } from '../utils/helpers.js';

export function applyRealTimeEconomy(state, dt) {
  let income = {
    gold: 0,
    food: 0,
    wood: 0,
    stone: 0,
    prestige: 0,
    stability: 0,
    knowledge: 0,
    populationCap: 0,
    defense: 0,
    army: 0,
  };
  const totalWorkers = state.units.filter((u) => !u.dead && u.type === 'worker').length;

  state.buildings.forEach((building) => {
    const y = computeBuildingYield(state, building);
    for (const [key, value] of Object.entries(y)) income[key] = (income[key] || 0) + value;
  });

  const weather = WEATHER_TYPES[state.weather];
  const staffedDemand = state.buildings.reduce((sum, b) => sum + (b.workerDemand || 0), 0);
  const freeWorkers = Math.max(0, totalWorkers - state.buildings.reduce((sum, b) => sum + (b.activeWorkers || 0), 0));
  state.resources.workers = freeWorkers;
  const productivity = clamp(.68 + state.resources.stability / 100 * .54, .45, 1.26);
  const workerLoad = clamp(.58 + totalWorkers / Math.max(1, staffedDemand + 3) * .42, .55, 1.2);
  income.food *= weather.food * productivity;
  income.gold *= (state.techs.has('caravans') ? 1.06 : 1) * productivity;
  income.wood *= workerLoad;
  income.stone *= workerLoad;
  income.knowledge *= state.techs.has('archives') ? 1.05 : 1;
  if (state.techs.has('dynasty')) income.stability += .03;

  state.resources.gold += income.gold * dt;
  state.resources.food += (income.food * 0.12) * dt;
  state.resources.wood += (income.wood * 0.08) * dt;
  state.resources.stone += (income.stone * 0.08) * dt;
  state.resources.prestige += income.prestige * dt;
  state.resources.knowledge += income.knowledge * dt;
  state.resources.stability = clamp(state.resources.stability + income.stability * dt, 0, 100);
  state.resources.army += income.army * dt;

  const housingBonus = state.buildings.filter((b) => ['granary','market','temple'].includes(b.type)).reduce((s,b)=>s + Math.max(0, b.level-1), 0);
  const capBase = 10 + Math.round(income.populationCap) + housingBonus;
  state.resources.populationCap = Math.min(GAME_CONFIG.maxPopulationSoft, capBase);

  const foodDrain = (state.resources.population * 0.045 + state.units.filter((u) => !u.hostile && u.type !== 'worker').length * 0.03) * dt;
  state.resources.food = Math.max(0, state.resources.food - foodDrain);

  if (state.resources.food <= 0.5) {
    state.resources.stability = clamp(state.resources.stability - dt * .95, 0, 100);
    state.resources.prestige = Math.max(0, state.resources.prestige - dt * .12);
  }
  if (state.resources.stability < 28) {
    state.resources.gold = Math.max(0, state.resources.gold - dt * .26);
  }
  if (state.resources.food < 12) state.resources.threat = clamp(state.resources.threat + dt * .18, 0, 100);
  if (state.resources.stability > 82) state.resources.prestige += dt * .035;
  if (freeWorkers < Math.max(1, Math.ceil(staffedDemand * 0.12))) state.resources.stability = clamp(state.resources.stability - dt * 0.06, 0, 100);
  state.resources.threat = clamp(state.resources.threat + dt * (.05 + state.era * .012) - Math.min(0.05, income.defense * .0042), 0, 100);
}

export function updateConstruction(state, dt) {
  const laborBoost = clamp(.85 + Math.max(1, state.resources.workers) / Math.max(1, state.construction.length + 5) * .22, .9, 1.55);
  state.construction.forEach((job) => { job.progress += dt * laborBoost; });
}

export function collectFinishedConstruction(state) {
  const done = state.construction.filter((j) => j.progress >= j.buildTime);
  state.construction = state.construction.filter((j) => j.progress < j.buildTime);
  return done;
}

export function updateEra(state) {
  const capital = state.buildings.find((b) => b.type === 'capital');
  if (!capital) { state.era = 0; return; }
  if (capital.level >= 4 || state.buildings.some((b) => b.type === 'wonder')) state.era = 2;
  else if (capital.level >= 2 || state.buildings.some((b) => b.type === 'academy' || b.type === 'harbor')) state.era = 1;
  else state.era = 0;
}

export function canResearch(state, tech) {
  return !state.techs.has(tech.id) && state.era >= tech.minEra && !state.techProgress;
}

export function beginResearch(state, techId) {
  const tech = TECHS.find((t) => t.id === techId);
  if (!tech) return false;
  if (state.resources.knowledge < tech.cost) return false;
  state.resources.knowledge -= tech.cost;
  state.techProgress = { id: tech.id, progress: 0, duration: 18 + tech.cost * .35 };
  return true;
}

export function updateResearch(state, dt) {
  if (!state.techProgress) return null;
  state.techProgress.progress += dt * (1 + state.buildings.filter((b) => b.type === 'academy').length * .08);
  if (state.techProgress.progress >= state.techProgress.duration) {
    const id = state.techProgress.id;
    state.techs.add(id);
    state.techProgress = null;
    return id;
  }
  return null;
}

export function updateObjectives(state) {
  state.objectives.forEach((obj) => {
    if (obj.done) return;
    let current = 0;
    if (obj.metric === 'food') current = state.resources.food;
    if (obj.metric === 'economyReady') current = state.buildings.filter((b) => ['farm','lumber','mine'].includes(b.type)).length;
    if (obj.metric === 'armyUnits') current = state.stats.armyUnits;
    if (obj.metric === 'wonderBuilt') current = state.stats.wonderBuilt;
    if (current >= obj.target) {
      obj.done = true;
      for (const [k, v] of Object.entries(obj.reward)) state.resources[k] = (state.resources[k] || 0) + v;
    }
  });
}
