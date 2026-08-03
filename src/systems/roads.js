import * as THREE from 'three';
import { findPath, isNearRoad } from './navigation.js';
import { sampleTerrain } from './world.js';

function roadEligible(building) {
  return !['wall', 'tower'].includes(building.type);
}

function endpointOutside(building, toward) {
  const direction = new THREE.Vector3().subVectors(toward, building.pos);
  direction.y = 0;
  if (direction.lengthSq() < .001) direction.set(1, 0, 0);
  direction.normalize();
  return building.pos.clone().addScaledVector(direction, Math.max(1, (building.blockRadius || .9) + .25));
}

export function rebuildRoadNetwork(state) {
  const capital = state.buildings.find((building) => building.type === 'capital');
  if (!capital) {
    state.roads = [];
    state.resources.roads = 0;
    return [];
  }

  const pending = state.buildings
    .filter((building) => building.id !== capital.id && roadEligible(building))
    .sort((a, b) => a.pos.distanceToSquared(capital.pos) - b.pos.distanceToSquared(capital.pos));
  const connected = [capital];
  const roads = [];

  for (const building of pending) {
    let parent = connected[0];
    let bestDistance = Infinity;
    for (const candidate of connected) {
      const distance = candidate.pos.distanceToSquared(building.pos);
      if (distance < bestDistance) { parent = candidate; bestDistance = distance; }
    }
    const start = endpointOutside(parent, building.pos);
    const end = endpointOutside(building, parent.pos);
    let points = findPath(state, start, end, { ignoreBuildingId: building.id, maxNodes: 900 });
    if (!points.length) points = [start, end];
    points.unshift(start);
    points.push(end);
    points = points.map((point) => ({ x: point.x, z: point.z }));
    roads.push({ id: `road-${parent.id}-${building.id}`, fromId: parent.id, toId: building.id, points });
    building.roadConnected = true;
    connected.push(building);
  }

  state.roads = roads;
  const totalLength = roads.reduce((sum, road) => {
    let length = 0;
    for (let i = 1; i < road.points.length; i++) length += Math.hypot(road.points[i].x - road.points[i - 1].x, road.points[i].z - road.points[i - 1].z);
    return sum + length;
  }, 0);
  state.resources.roads = Math.round(totalLength / 6);
  return roads;
}

function disposeGroup(group) {
  for (const child of [...group.children]) {
    child.geometry?.dispose?.();
    if (Array.isArray(child.material)) child.material.forEach((material) => material.dispose?.());
    else child.material?.dispose?.();
    group.remove(child);
  }
}

export function renderRoads(sceneCtx, state) {
  const group = sceneCtx.groups.roads;
  disposeGroup(group);
  const material = new THREE.MeshStandardMaterial({ color: 0x9a7848, roughness: 1, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1 });

  for (const road of state.roads || []) {
    if (road.points.length < 2) continue;
    const points = road.points.map((point) => {
      const terrain = sampleTerrain(state, point.x, point.z);
      return new THREE.Vector3(point.x, terrain.height + .055, point.z);
    });
    const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
    const segments = Math.min(48, Math.max(4, Math.ceil(curve.getLength() / 1.2)));
    const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, .13, 4, false), material.clone());
    mesh.receiveShadow = true;
    mesh.name = road.id;
    group.add(mesh);
  }
}

export function roadMovementMultiplier(state, x, z) {
  return isNearRoad(state, x, z, 1.35) ? 1.22 : 1;
}

export function tradeNetworkBonus(state) {
  const connectedMarkets = state.buildings.filter((building) => building.roadConnected && ['market', 'harbor'].includes(building.type)).length;
  return 1 + Math.min(.42, connectedMarkets * .07 + (state.resources.roads || 0) * .0025);
}
