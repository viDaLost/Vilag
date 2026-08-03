import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { gridToWorld, isInsideWorld, sampleTerrain, terrainMoveCost, worldToGrid } from './world.js';

const DIRECTIONS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
];

class MinHeap {
  constructor() { this.items = []; }
  push(item) {
    this.items.push(item);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (this.items[parent].score <= item.score) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        let next = left;
        if (right < this.items.length && this.items[right].score < this.items[left].score) next = right;
        if (this.items[next].score >= last.score) break;
        this.items[index] = this.items[next];
        index = next;
      }
      this.items[index] = last;
    }
    return first;
  }
  get length() { return this.items.length; }
}

function nodeKey(gx, gz) { return `${gx},${gz}`; }

export function isNearRoad(state, x, z, threshold = 1.25) {
  for (const road of state.roads || []) {
    for (const point of road.points || []) {
      if (Math.hypot(point.x - x, point.z - z) <= threshold) return true;
    }
  }
  return false;
}

export function isWalkable(state, x, z, options = {}) {
  if (!isInsideWorld(state, x, z, .8)) return false;
  if (sampleTerrain(state, x, z).type === 'water') return false;
  if (options.ignoreBuildings) return true;
  for (const building of state.buildings || []) {
    if (building.id === options.ignoreBuildingId) continue;
    const radius = Math.max(.55, (building.blockRadius || .9) * .83);
    if (Math.hypot(building.pos.x - x, building.pos.z - z) < radius) return false;
  }
  return true;
}

function nearestOpenGrid(state, grid, options) {
  const direct = gridToWorld(grid.gx, grid.gz);
  if (isWalkable(state, direct.x, direct.z, options)) return grid;
  for (let radius = 1; radius <= 4; radius++) {
    for (let x = -radius; x <= radius; x++) {
      for (let z = -radius; z <= radius; z++) {
        if (Math.abs(x) !== radius && Math.abs(z) !== radius) continue;
        const candidate = { gx: grid.gx + x, gz: grid.gz + z };
        const pos = gridToWorld(candidate.gx, candidate.gz);
        if (isWalkable(state, pos.x, pos.z, options)) return candidate;
      }
    }
  }
  return null;
}

export function findPath(state, from, to, options = {}) {
  const start = nearestOpenGrid(state, worldToGrid(from.x, from.z), { ...options, ignoreBuildings: true });
  const goal = nearestOpenGrid(state, worldToGrid(to.x, to.z), options);
  if (!start || !goal) return [];
  if (start.gx === goal.gx && start.gz === goal.gz) return [new THREE.Vector3(to.x, sampleTerrain(state, to.x, to.z).height, to.z)];

  const open = new MinHeap();
  const cameFrom = new Map();
  const gScore = new Map();
  const closed = new Set();
  const startKey = nodeKey(start.gx, start.gz);
  gScore.set(startKey, 0);
  open.push({ ...start, score: 0 });
  let visited = 0;
  const maxNodes = options.maxNodes || 1300;

  while (open.length && visited < maxNodes) {
    const current = open.pop();
    const currentKey = nodeKey(current.gx, current.gz);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited += 1;

    if (current.gx === goal.gx && current.gz === goal.gz) {
      const path = [];
      let cursor = currentKey;
      while (cursor && cursor !== startKey) {
        const [gx, gz] = cursor.split(',').map(Number);
        const pos = gridToWorld(gx, gz);
        pos.y = sampleTerrain(state, pos.x, pos.z).height;
        path.push(pos);
        cursor = cameFrom.get(cursor);
      }
      path.reverse();
      if (path.length) path[path.length - 1] = new THREE.Vector3(to.x, sampleTerrain(state, to.x, to.z).height, to.z);
      return simplifyPath(state, path, options);
    }

    const currentCost = gScore.get(currentKey) ?? Infinity;
    for (const [dx, dz, distance] of DIRECTIONS) {
      const gx = current.gx + dx;
      const gz = current.gz + dz;
      const key = nodeKey(gx, gz);
      if (closed.has(key)) continue;
      const pos = gridToWorld(gx, gz);
      if (!isWalkable(state, pos.x, pos.z, options)) continue;
      const terrainCost = terrainMoveCost(state, pos.x, pos.z);
      if (!Number.isFinite(terrainCost)) continue;
      const roadBonus = isNearRoad(state, pos.x, pos.z) ? .72 : 1;
      const tentative = currentCost + distance * terrainCost * roadBonus;
      if (tentative >= (gScore.get(key) ?? Infinity)) continue;
      cameFrom.set(key, currentKey);
      gScore.set(key, tentative);
      const heuristic = Math.hypot(goal.gx - gx, goal.gz - gz);
      open.push({ gx, gz, score: tentative + heuristic });
    }
  }
  return [];
}

function lineWalkable(state, a, b, options) {
  const distance = a.distanceTo(b);
  const steps = Math.max(1, Math.ceil(distance / (GAME_CONFIG.gridSize * .7)));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (!isWalkable(state, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, options)) return false;
  }
  return true;
}

function simplifyPath(state, path, options) {
  if (path.length < 3) return path;
  const result = [];
  let anchor = path[0];
  result.push(anchor);
  for (let i = 2; i < path.length; i++) {
    if (!lineWalkable(state, anchor, path[i], options)) {
      anchor = path[i - 1];
      result.push(anchor);
    }
  }
  if (result[result.length - 1] !== path[path.length - 1]) result.push(path[path.length - 1]);
  return result;
}
