import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createInitialState } from '../src/state.js';
import { generateWorld, sampleTerrain, findNearestWalkable } from '../src/systems/world.js';
import { findPath } from '../src/systems/navigation.js';
import { applyRealTimeEconomy, updateObjectives } from '../src/systems/economy.js';
import { canPlaceBuilding } from '../src/systems/buildings.js';
import { applySaveToState, serializeGame } from '../src/systems/persistence.js';

function world(seed = 424242) {
  const state = createInitialState();
  state.worldSeed = seed;
  generateWorld(state);
  return state;
}

test('terrain generation is deterministic for a saved seed', () => {
  const first = world(7719);
  const second = world(7719);
  const different = world(7720);
  const points = [[0, 0], [13.2, -8.7], [-31, 18], [42, -11]];
  const sample = (state) => points.map(([x, z]) => {
    const terrain = sampleTerrain(state, x, z);
    return [terrain.type, Number(terrain.height.toFixed(6))];
  });
  assert.deepEqual(sample(first), sample(second));
  assert.notDeepEqual(sample(first), sample(different));
});

test('navigation creates a dry route through the river valley', () => {
  const state = world(55221);
  state.territoryRadius = 60;
  const from = findNearestWalkable(state, -24, -18, 12);
  const to = findNearestWalkable(state, 25, 19, 12);
  assert.ok(from && to);
  const path = findPath(state, from, to, { maxNodes: 2400 });
  assert.ok(path.length > 1, 'expected a route between opposite sides of the map');
  assert.ok(path.every((point) => sampleTerrain(state, point.x, point.z).type !== 'water'));
});

test('building placement enforces terrain specialisation and collisions', () => {
  const state = world(9042);
  state.territoryRadius = 54;
  let mineSite = null;
  for (let x = -44; x <= 44 && !mineSite; x += 2) {
    for (let z = -44; z <= 44; z += 2) {
      if (['hill', 'rock'].includes(sampleTerrain(state, x, z).type) && canPlaceBuilding(state, 'mine', x, z)) {
        mineSite = { x, z };
        break;
      }
    }
  }
  assert.ok(mineSite, 'the generated map should contain a legal mine site');
  assert.equal(canPlaceBuilding(state, 'farm', mineSite.x, mineSite.z), sampleTerrain(state, mineSite.x, mineSite.z).type !== 'rock');
  state.buildings.push({ id: 'b-test', pos: new THREE.Vector3(mineSite.x, 0, mineSite.z), blockRadius: 1 });
  assert.equal(canPlaceBuilding(state, 'mine', mineSite.x, mineSite.z), false);
});

test('staffed economy produces resources and computes free workers', () => {
  const state = world();
  state.resources.population = 2;
  state.resources.food = 50;
  state.units.push({ id: 'u-worker', type: 'worker', dead: false, assignedBuildingId: 'b-farm' });
  state.buildings.push({
    id: 'b-capital', type: 'capital', level: 1, hp: 380, pos: new THREE.Vector3(0, 0, 0),
    workerDemand: 0, activeWorkers: 0, workerRatio: 1, trainQueue: [],
  });
  state.buildings.push({
    id: 'b-farm', type: 'farm', level: 1, hp: 110, pos: new THREE.Vector3(7, 0, 2),
    workerDemand: 1, activeWorkers: 0, workerRatio: 1, trainQueue: [], priority: 1,
  });
  const before = state.resources.food;
  applyRealTimeEconomy(state, 10);
  assert.ok(state.resources.food > before);
  assert.equal(state.resources.workers, 0);
  assert.ok(state.resources.populationCap >= 20);
});

test('campaign advances chapter by chapter and supports conquest ending', () => {
  const state = createInitialState();
  state.buildings = ['farm', 'lumber', 'mine'].map((type) => ({ type }));
  state.resources.food = 160;
  state.resources.population = 7;
  let event = updateObjectives(state);
  assert.equal(event.chapterAdvanced, true);
  assert.equal(state.campaign.chapter, 1);

  state.buildings.push({ type: 'tower' }, { type: 'wall' });
  state.stats.armyUnits = 4;
  state.stats.campsDestroyed = 1;
  event = updateObjectives(state);
  assert.equal(event.chapterAdvanced, true);
  assert.equal(state.campaign.chapter, 2);

  state.techs = new Set(['irrigation', 'stonework', 'caravans']);
  state.buildings.push({ type: 'market' }, { type: 'harbor' });
  state.resources.prestige = 60;
  event = updateObjectives(state);
  assert.equal(event.chapterAdvanced, true);
  assert.equal(state.campaign.chapter, 3);

  state.enemyCamps = [];
  event = updateObjectives(state);
  assert.equal(event.victory, 'conquest');
  assert.equal(state.victory, 'conquest');
});

test('versioned save preserves simulation entities and assignments', () => {
  const state = world(1937);
  state.techs.add('irrigation');
  state.campaign.chapter = 2;
  state.buildings.push({
    id: 'b-8', type: 'farm', pos: new THREE.Vector3(6, .1, 3), level: 2,
    hp: 120, maxHp: 138, trainQueue: [], rallyPos: null, priority: 2,
  });
  state.units.push({
    id: 'u-3', type: 'worker', hp: 30, maxHp: 38, pos: new THREE.Vector3(4, 0, 2),
    homeBuildingId: 'b-8', homeCampId: null, assignedBuildingId: 'b-8', taskPhase: 'toBuilding',
    carrying: { wood: 4 }, resourceTargetId: null, commandTarget: null, patrolCenter: null,
    guardPoint: null, targetBuildingId: null, aiRole: 'guard',
  });
  const raw = serializeGame(state);
  const restored = createInitialState();
  assert.equal(applySaveToState(restored, raw), true);
  assert.equal(restored.worldSeed, 1937);
  assert.equal(restored.campaign.chapter, 2);
  assert.equal(restored.techs.has('irrigation'), true);
  assert.equal(restored.restoreSnapshot.buildings[0].priority, 2);
  assert.deepEqual(restored.restoreSnapshot.units[0].carrying, { wood: 4 });
});
