import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { getCapital } from './buildings.js';
import { rand } from '../utils/helpers.js';
import { spawnUnit } from './units.js';

export const ENEMY_FACTIONS = {
  clans: { name: 'Степные кланы', color: 0x8a2318, roster: ['raider', 'raider', 'raiderArcher'] },
  iron: { name: 'Железные мятежники', color: 0x5c5f68, roster: ['raider', 'brute', 'raiderArcher'] },
  beasts: { name: 'Звериные всадники', color: 0x4f3316, roster: ['wolfRider', 'raider', 'wolfRider'] },
};

export function updateEnvironmentState(state, dt) {
  state.dayTime += dt;
  state.seasonTime += dt;
  state.worldTime += dt;
}

export function maybeChangeWeather(state) {
  const previous = state.weather;
  const pool = previous === 'rain'
    ? ['clear', 'clear', 'mist', 'rain']
    : previous === 'dust'
      ? ['clear', 'clear', 'mist']
      : ['clear', 'clear', 'rain', 'mist', 'dust'];
  state.weather = rand(pool);
  return state.weather;
}

export function campFactionLabel(camp) {
  return ENEMY_FACTIONS[camp.faction]?.name || 'Налётчики';
}

function livingCampUnits(state, camp) {
  return state.units.filter((unit) => unit.hostile && !unit.dead && unit.homeCampId === camp.id);
}

function pickUnitType(camp, waveIndex) {
  const roster = ENEMY_FACTIONS[camp.faction]?.roster || ['raider'];
  const offset = Math.floor(Math.random() * roster.length + waveIndex) % roster.length;
  return roster[offset];
}

function spawnCampUnit(sceneCtx, state, camp, type, role = 'guard') {
  const angle = Math.random() * Math.PI * 2;
  const radius = 1.5 + Math.random() * 1.3;
  const position = camp.pos.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
  const unit = spawnUnit(sceneCtx, state, type, position, null, {
    homeCampId: camp.id,
    aiRole: role,
    guardPoint: camp.pos,
  });
  return unit;
}

function targetPriority(building) {
  return ({ tower: 0, wall: 1, barracks: 2, farm: 3, lumber: 3, mine: 3, market: 4, capital: 5 })[building.type] ?? 4;
}

function chooseRaidTarget(state, camp) {
  const candidates = state.buildings.filter((building) => building.hp > 0);
  if (!candidates.length) return null;
  candidates.sort((a, b) => {
    const priority = targetPriority(a) - targetPriority(b);
    if (priority) return priority;
    return a.pos.distanceToSquared(camp.pos) - b.pos.distanceToSquared(camp.pos);
  });
  const capital = getCapital(state);
  if ((state.aiState.waveIndex || 0) >= 4 && capital && Math.random() < .36) return capital;
  return candidates[0];
}

function launchRaid(state, camp, units, target) {
  units.forEach((unit, index) => {
    unit.aiRole = 'raid';
    unit.targetBuildingId = target.id;
    const spread = (index - (units.length - 1) / 2) * .55;
    unit.commandTarget = target.pos.clone().add(new THREE.Vector3(spread, 0, -spread));
    unit.manualTarget = null;
    unit.path = [];
    unit.pathDestinationKey = null;
  });
  camp.lastRaidAt = state.worldTime;
}

function updateCampEconomy(sceneCtx, state, camp) {
  if (!camp.stock) camp.stock = { food: 30, metal: 18 };
  camp.level = camp.level || 1;
  camp.stock.food += 1.25 + camp.level * .35;
  camp.stock.metal += .72 + camp.level * .22;
  camp.alert = Math.max(0, (camp.alert || 0) - 1);
  const garrison = livingCampUnits(state, camp);
  const cap = 3 + camp.level * 2 + Math.min(3, state.era);
  if (garrison.length >= cap || camp.stock.food < 12 || camp.stock.metal < 8) return;
  camp.stock.food -= 12;
  camp.stock.metal -= 8;
  spawnCampUnit(sceneCtx, state, camp, pickUnitType(camp, state.aiState.waveIndex), 'guard');
}

export function seedCampGarrisons(sceneCtx, state) {
  for (const camp of state.enemyCamps) {
    if (livingCampUnits(state, camp).length) continue;
    const count = camp.faction === 'iron' ? 2 : 1;
    for (let i = 0; i < count; i++) spawnCampUnit(sceneCtx, state, camp, pickUnitType(camp, i), 'guard');
  }
}

export function updateEnemyWaves(sceneCtx, state, dt, notify) {
  const ai = state.aiState;
  if (!ai || !state.enemyCamps.length) return;
  ai.decisionTimer -= dt;
  ai.waveTimer -= dt;
  if (ai.decisionTimer > 0) return;
  ai.decisionTimer = 1;

  for (const camp of state.enemyCamps) {
    updateCampEconomy(sceneCtx, state, camp);
    if ((camp.alert || 0) > 2) {
      livingCampUnits(state, camp).filter((unit) => unit.aiRole === 'guard').forEach((unit) => {
        unit.commandTarget = camp.pos.clone();
      });
    }
  }

  if (ai.waveTimer > 0) return;
  const readyCamps = state.enemyCamps
    .map((camp) => ({ camp, guards: livingCampUnits(state, camp).filter((unit) => unit.aiRole === 'guard') }))
    .filter((entry) => entry.guards.length >= 2)
    .sort((a, b) => b.guards.length - a.guards.length);

  if (!readyCamps.length) {
    ai.waveTimer = 14;
    return;
  }

  const { camp, guards } = readyCamps[0];
  const target = chooseRaidTarget(state, camp);
  if (!target) return;
  ai.waveIndex += 1;
  const raidSize = Math.min(guards.length, 2 + state.era + Math.floor(ai.waveIndex / 2));
  launchRaid(state, camp, guards.slice(0, raidSize), target);
  ai.pressure = Math.min(100, (ai.pressure || 0) + raidSize * 6);
  state.resources.threat = Math.min(100, state.resources.threat + raidSize * 3.5);
  ai.waveTimer = Math.max(62, GAME_CONFIG.enemyWaveEvery - state.era * 14 - Math.min(35, ai.waveIndex * 3));
  notify(`${campFactionLabel(camp)} начали набег: цель — ${target.type === 'capital' ? 'столица' : 'приграничные постройки'}`);
}
