import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { loadDecorModel } from '../core/assets.js';
import { buildTerrain } from './terrain.js';
import { coordinateRandom, sampleTerrain } from './world.js';

async function addDistantMountains(sceneCtx, state) {
  const group = sceneCtx.groups.backdrop;
  group.clear();
  const count = sceneCtx.quality?.mountainCount || 9;
  const fallbackMat = new THREE.MeshStandardMaterial({ color: 0x8f887d, roughness: 1, transparent: true, opacity: .94 });
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + coordinateRandom(i, state.worldSeed, 4) * .14;
    const radius = GAME_CONFIG.worldRadius + 7 + (i % 4) * 2.5;
    try {
      const model = await loadDecorModel(i % 3 === 0 ? 'mountain-group.glb' : 'mountain.glb');
      const scale = (i % 3 === 0 ? 2.45 : 1.95) + coordinateRandom(i, state.worldSeed, 6) * .35;
      model.scale.setScalar(scale);
      model.position.set(Math.cos(angle) * radius, -1.7, Math.sin(angle) * radius);
      model.rotation.y = angle + Math.PI;
      group.add(model);
    } catch {
      const height = 12 + coordinateRandom(i, state.worldSeed, 9) * 8;
      const mountain = new THREE.Mesh(new THREE.ConeGeometry(6.5, height, 5), fallbackMat);
      mountain.position.set(Math.cos(angle) * radius, -1.4 + height / 2, Math.sin(angle) * radius);
      group.add(mountain);
    }
  }
}

export function renderTiles(sceneCtx, state) {
  const { groups } = sceneCtx;
  groups.tiles.clear();
  groups.decor.clear();
  groups.overlays.clear();
  groups.backdrop.clear();

  const ringGeo = new THREE.RingGeometry(state.territoryRadius - .15, state.territoryRadius + .1, 96);
  const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .2, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .12;
  ring.name = 'territory-ring';
  groups.overlays.add(ring);

  buildTerrain(sceneCtx, state);
  void addDistantMountains(sceneCtx, state);
}

export function updateTerritoryOverlay(sceneCtx, state) {
  const ring = sceneCtx.groups.overlays.getObjectByName('territory-ring');
  if (!ring) return;
  ring.geometry.dispose();
  ring.geometry = new THREE.RingGeometry(state.territoryRadius - .15, state.territoryRadius + .1, 96);
}

function resourceSnapshot(state) {
  return new Map((state.resourceSnapshot || []).map((resource) => [resource.id, resource]));
}

function setInstanceTransform(mesh, index, resource, visible = true) {
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, resource.rotation || 0, 0));
  const scale = visible ? resource.scale || 1 : .0001;
  matrix.compose(new THREE.Vector3(resource.x, resource.y, resource.z), rotation, new THREE.Vector3(scale, scale, scale));
  mesh.setMatrixAt(index, matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

export function setResourceVisible(resource, visible) {
  resource.visible = visible;
  (resource.meshes || []).forEach((mesh, index) => {
    const y = resource.y + (resource.meshOffsets?.[index] || 0);
    setInstanceTransform(mesh, resource.instanceIndex, { ...resource, y }, visible);
  });
}

function addTreeInstances(sceneCtx, resources) {
  if (!resources.length) return;
  const trunk = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(.09, .13, .68, 6),
    new THREE.MeshStandardMaterial({ color: 0x6f4829, roughness: 1 }),
    resources.length,
  );
  const crown = new THREE.InstancedMesh(
    new THREE.ConeGeometry(.48, 1.28, 7),
    new THREE.MeshStandardMaterial({ color: 0x3d6b32, roughness: 1 }),
    resources.length,
  );
  trunk.name = 'resource-trees-trunks';
  crown.name = 'resource-trees';
  crown.userData.resourceKind = 'tree';
  trunk.castShadow = sceneCtx.quality?.shadows;
  crown.castShadow = sceneCtx.quality?.shadows;
  trunk.receiveShadow = crown.receiveShadow = true;

  resources.forEach((resource, index) => {
    resource.instanceIndex = index;
    resource.meshes = [trunk, crown];
    resource.meshOffsets = [.34, 1.0];
    const baseY = resource.y;
    const trunkResource = { ...resource, y: baseY + .34 };
    const crownResource = { ...resource, y: baseY + 1.0 };
    setInstanceTransform(trunk, index, trunkResource, resource.visible);
    setInstanceTransform(crown, index, crownResource, resource.visible);
    const tint = new THREE.Color(index % 3 === 0 ? 0x568342 : index % 3 === 1 ? 0x35622f : 0x47783b);
    crown.setColorAt(index, tint);
  });
  crown.instanceColor.needsUpdate = true;
  sceneCtx.groups.decor.add(trunk, crown);
}

function addRockInstances(sceneCtx, resources) {
  if (!resources.length) return;
  const rocks = new THREE.InstancedMesh(
    new THREE.DodecahedronGeometry(.43, 0),
    new THREE.MeshStandardMaterial({ color: 0x85817a, roughness: .94, metalness: .04 }),
    resources.length,
  );
  rocks.name = 'resource-rocks';
  rocks.userData.resourceKind = 'rock';
  rocks.castShadow = sceneCtx.quality?.shadows;
  rocks.receiveShadow = true;
  resources.forEach((resource, index) => {
    resource.instanceIndex = index;
    resource.meshes = [rocks];
    resource.meshOffsets = [.34];
    setInstanceTransform(rocks, index, { ...resource, y: resource.y + .34 }, resource.visible);
    rocks.setColorAt(index, new THREE.Color(resource.isGold ? 0xc79b32 : (index % 2 ? 0x77746f : 0x918c84)));
  });
  rocks.instanceColor.needsUpdate = true;
  sceneCtx.groups.decor.add(rocks);
}

function validResourcePosition(state, x, z) {
  if (Math.hypot(x, z) < 8) return false;
  if (state.buildings.some((building) => Math.hypot(building.pos.x - x, building.pos.z - z) < (building.blockRadius || 1) + 1.2)) return false;
  return !state.enemyCamps.some((camp) => Math.hypot(camp.pos.x - x, camp.pos.z - z) < 2.4);
}

export async function populateDecorModels(sceneCtx, state) {
  const snapshots = resourceSnapshot(state);
  const treeCandidates = [];
  const rockCandidates = [];
  const limit = sceneCtx.quality?.decorLimit || 110;
  const radius = GAME_CONFIG.worldRadius - 3;
  const seedSalt = state.worldSeed * .00013;

  for (let x = -radius; x <= radius; x += 3.4) {
    for (let z = -radius; z <= radius; z += 3.4) {
      if (Math.hypot(x, z) > radius) continue;
      const jitterX = (coordinateRandom(x, z, seedSalt + 1) - .5) * 2.15;
      const jitterZ = (coordinateRandom(x, z, seedSalt + 2) - .5) * 2.15;
      const px = x + jitterX;
      const pz = z + jitterZ;
      if (!validResourcePosition(state, px, pz)) continue;
      const terrain = sampleTerrain(state, px, pz);
      const roll = coordinateRandom(x, z, seedSalt + 3);
      const treeChance = terrain.type === 'forest' ? .78 : terrain.type === 'grass' ? .11 : terrain.type === 'fertile' ? .07 : .015;
      const rockChance = terrain.type === 'rock' ? .72 : terrain.type === 'hill' ? .34 : .012;
      if (roll < treeChance) {
        treeCandidates.push({
          kind: 'tree', x: px, y: terrain.height, z: pz,
          rotation: coordinateRandom(x, z, seedSalt + 5) * Math.PI * 2,
          scale: .72 + coordinateRandom(x, z, seedSalt + 6) * .35,
          rank: coordinateRandom(x, z, seedSalt + 30),
        });
      } else if (roll > 1 - rockChance) {
        const isGold = coordinateRandom(x, z, seedSalt + 7) > .84;
        rockCandidates.push({
          kind: 'rock', x: px, y: terrain.height, z: pz, isGold,
          rotation: coordinateRandom(x, z, seedSalt + 8) * Math.PI * 2,
          scale: .72 + coordinateRandom(x, z, seedSalt + 9) * .5,
          rank: coordinateRandom(x, z, seedSalt + 31),
        });
      }
    }
  }

  treeCandidates.sort((a, b) => a.rank - b.rank);
  rockCandidates.sort((a, b) => a.rank - b.rank);
  const rockLimit = Math.min(rockCandidates.length, Math.max(18, Math.round(limit * .28)));
  const treeLimit = Math.min(treeCandidates.length, limit - rockLimit);
  const selectedTrees = treeCandidates.slice(0, treeLimit);
  const selectedRocks = rockCandidates.slice(0, Math.min(rockLimit + Math.max(0, limit - treeLimit - rockLimit), rockCandidates.length));
  for (const building of state.buildings) {
    const selected = building.type === 'lumber' ? selectedTrees : building.type === 'mine' ? selectedRocks : null;
    const candidates = building.type === 'lumber' ? treeCandidates : building.type === 'mine' ? rockCandidates : null;
    if (!selected || !candidates || selected.some((candidate) => Math.hypot(candidate.x - building.pos.x, candidate.z - building.pos.z) <= 12)) continue;
    const nearest = candidates.reduce((best, candidate) => {
      const distance = Math.hypot(candidate.x - building.pos.x, candidate.z - building.pos.z);
      return !best || distance < best.distance ? { candidate, distance } : best;
    }, null)?.candidate;
    if (nearest && !selected.includes(nearest)) selected[Math.max(0, selected.length - 1)] = nearest;
  }
  const trees = selectedTrees.map((candidate, index) => {
    const id = `tree-${index}`;
    const saved = snapshots.get(id);
    return { ...candidate, id, hp: saved?.hp ?? 36, maxHp: 36, depletedUntil: saved?.depletedUntil ?? 0, visible: (saved?.hp ?? 36) > 0 };
  });
  const rocks = selectedRocks.map((candidate, index) => {
    const id = `rock-${index}`;
    const saved = snapshots.get(id);
    return { ...candidate, id, hp: saved?.hp ?? 72, maxHp: 72, depletedUntil: saved?.depletedUntil ?? 0, visible: (saved?.hp ?? 72) > 0 };
  });

  state.trees = trees;
  state.rocks = rocks;
  addTreeInstances(sceneCtx, trees);
  addRockInstances(sceneCtx, rocks);
  state.resourceSnapshot = null;
}

export function updateResourceRegrowth(state) {
  for (const resource of [...state.trees, ...state.rocks]) {
    if (resource.hp > 0 || !resource.depletedUntil || state.worldTime < resource.depletedUntil) continue;
    resource.hp = resource.maxHp;
    resource.depletedUntil = 0;
    setResourceVisible(resource, true);
  }
}
