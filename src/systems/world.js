import * as THREE from 'three';
import { createNoise2D } from 'simplex-noise';
import { GAME_CONFIG } from '../config.js';
import { clamp } from '../utils/helpers.js';

export function createSeededRandom(seed) {
  let value = (Number(seed) || 1) >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function coordinateRandom(x, z, salt = 0) {
  const value = Math.sin(x * 12.9898 + z * 78.233 + salt * 37.719) * 43758.5453;
  return value - Math.floor(value);
}

export function worldToGrid(x, z) {
  return {
    gx: Math.round(x / GAME_CONFIG.gridSize),
    gz: Math.round(z / GAME_CONFIG.gridSize),
  };
}

export function gridToWorld(gx, gz) {
  return new THREE.Vector3(gx * GAME_CONFIG.gridSize, 0, gz * GAME_CONFIG.gridSize);
}

function biomeNoise(noise2D, x, z, scale, ox = 0, oy = 0) {
  return noise2D(x * scale + ox, z * scale + oy);
}

export function generateWorld(state) {
  const random = createSeededRandom(state.worldSeed);
  const noise2D = createNoise2D(random);
  const riverAngle = -.38 + random() * .76;
  const riverDir = new THREE.Vector2(Math.cos(riverAngle), Math.sin(riverAngle));
  const riverNormal = new THREE.Vector2(-riverDir.y, riverDir.x);

  state.worldConfig = {
    seed: state.worldSeed,
    radius: GAME_CONFIG.worldRadius,
    noise2D,
    riverAngle,
    riverDir,
    riverNormal,
    fords: [-22 + random() * 4, 2 + random() * 5, 24 + random() * 3],
  };
}

export function sampleTerrain(state, x, z) {
  if (!state.worldConfig) return { type: 'grass', height: 0, steepness: 0, elevation: 0, riverDistance: 99, noise: 0 };

  const { radius, noise2D, riverDir, riverNormal, fords } = state.worldConfig;
  const d = Math.hypot(x, z);
  const edge = d / radius;
  const nx = x / radius;
  const nz = z / radius;
  const detail = biomeNoise(noise2D, x, z, .115, 4, -7);
  const broad = biomeNoise(noise2D, x, z, .025, 88, -23);
  const ridges = Math.abs(biomeNoise(noise2D, x, z, .052, 9, 61));
  const moisture = biomeNoise(noise2D, x, z, .038, -41, 13) + (nz < -.1 ? .13 : 0);
  const coastNoise = biomeNoise(noise2D, x, z, .07, 19, -7) * .035;

  const worldPos = new THREE.Vector2(x, z);
  const along = worldPos.dot(riverDir);
  const meander = Math.sin(along * .115) * 2.25 + noise2D(along * .028 + 12, -2) * 1.5;
  const signedAcross = worldPos.dot(riverNormal) + meander;
  const across = Math.abs(signedAcross);
  const riverWidth = 2.65 + Math.max(0, 1 - Math.abs(along) / radius) * 1.45;
  const atFord = fords.some((ford) => Math.abs(along - ford) < 2.1);

  const centralBasin = Math.max(0, 1 - d / 15);
  const mountainBias = Math.max(0, nx * .65 + nz * .35 + .1);
  let elevation = broad * .62 + ridges * .42 + mountainBias * .5 - centralBasin * .72;
  elevation -= Math.max(0, edge - .72) * .32;

  let type = 'grass';
  let height = .12 + elevation * .7 + detail * .06;
  const coastLine = .91 + coastNoise;
  const lakeDistance = Math.hypot(x + radius * .31, z - radius * .22);
  const isLake = lakeDistance < 6.8 + detail * 1.2;

  if (edge > coastLine || isLake) {
    type = 'water';
    height = GAME_CONFIG.terrain.waterLevel - .3 + detail * .025;
  } else if (across < riverWidth * .48 && !atFord && d > 7) {
    type = 'water';
    height = GAME_CONFIG.terrain.waterLevel - .2 + detail * .02;
  } else if (across < riverWidth * 1.45 || (atFord && across < riverWidth * .72)) {
    type = 'river';
    height = atFord && across < riverWidth * .72
      ? -.03 + detail * .015
      : .04 + Math.max(0, elevation * .18) + detail * .02;
  } else if (elevation > .68 || (mountainBias > .48 && elevation > .38)) {
    type = 'rock';
    height = .72 + elevation * .72 + detail * .1;
  } else if (elevation > .36 || (ridges > .67 && d > 13)) {
    type = 'hill';
    height = .34 + elevation * .38 + detail * .06;
  } else if (moisture > .18 && d > 9 && nx < .42) {
    type = 'forest';
    height = .14 + Math.max(0, elevation * .38) + detail * .035;
  } else if (across < riverWidth * 2.7 || moisture < -.23 || (nx < -.28 && nz > .05)) {
    type = 'fertile';
    height = .09 + Math.max(0, elevation * .32) + detail * .025;
  }

  const sacredA = Math.hypot(x - 11, z + 12) < 4.2;
  const sacredB = Math.hypot(x + 17, z - 8) < 3.8;
  if ((sacredA || sacredB) && type !== 'water' && type !== 'rock') {
    type = 'sacred';
    height = .16 + Math.max(0, elevation * .25);
  }

  if (d < 7.5) {
    type = 'grass';
    const blend = clamp(d / 7.5, 0, 1);
    height = height * blend + .08 * (1 - blend);
  }

  return {
    type,
    height,
    moisture,
    elevation,
    riverDistance: across,
    riverAlong: along,
    isFord: atFord,
    noise: detail,
  };
}

export function isTileInsideTerritory(state, x, z) {
  return Math.hypot(x, z) <= state.territoryRadius;
}

export function isInsideWorld(state, x, z, margin = 0) {
  return Math.hypot(x, z) <= (state.worldConfig?.radius || GAME_CONFIG.worldRadius) - margin;
}

export function terrainMoveCost(state, x, z) {
  const terrain = sampleTerrain(state, x, z);
  if (terrain.type === 'water') return Infinity;
  return ({ river: 1.18, rock: 1.6, hill: 1.35, forest: 1.22, fertile: .96, sacred: .94 })[terrain.type] || 1;
}

export function findNearestWalkable(state, x, z, searchRadius = 8) {
  const direct = sampleTerrain(state, x, z);
  if (direct.type !== 'water' && isInsideWorld(state, x, z, 1)) return new THREE.Vector3(x, direct.height, z);
  for (let radius = GAME_CONFIG.gridSize; radius <= searchRadius; radius += GAME_CONFIG.gridSize) {
    for (let i = 0; i < 12; i++) {
      const angle = (i / 12) * Math.PI * 2;
      const px = x + Math.cos(angle) * radius;
      const pz = z + Math.sin(angle) * radius;
      const terrain = sampleTerrain(state, px, pz);
      if (terrain.type !== 'water' && isInsideWorld(state, px, pz, 1)) return new THREE.Vector3(px, terrain.height, pz);
    }
  }
  return null;
}
