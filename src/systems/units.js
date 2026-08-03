import * as THREE from 'three';
import { AnimationMixer, LoopOnce } from 'three';
import { GAME_CONFIG, UNITS, UNIT_MODEL_MAP, UNIT_VISUALS, WEATHER_TYPES } from '../config.js';
import { getCapital, buildingCenter, getBuildingWorkerDemand } from './buildings.js';
import { dist2 } from '../utils/helpers.js';
import { applyUnitDamage, removeDestroyedBuilding, spawnCollapse, spawnProjectile } from './combat.js';
import { attachUnitModel } from '../core/assets.js';
import { sampleTerrainHeight } from './terrain.js';
import { sampleTerrain } from './world.js';
import { findPath, isWalkable } from './navigation.js';
import { roadMovementMultiplier } from './roads.js';
import { setResourceVisible } from './renderWorld.js';

let unitId = 1;

function claimId(id) {
  const numeric = Number(String(id || '').replace(/\D/g, ''));
  if (Number.isFinite(numeric)) unitId = Math.max(unitId, numeric + 1);
}

function addWeapon(group, kind, color) {
  const material = new THREE.MeshStandardMaterial({ color, roughness: .9, metalness: .08 });
  if (['sword', 'blade', 'dual'].includes(kind)) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.05, .42, .05), material);
    blade.position.set(.18, .12, .12);
    blade.rotation.z = -.45;
    group.add(blade);
    if (kind === 'dual') {
      const second = blade.clone();
      second.position.set(-.18, .1, .12);
      second.rotation.z = .45;
      group.add(second);
    }
  } else if (kind === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(.14, .02, 5, 16, Math.PI), material);
    bow.rotation.z = Math.PI / 2;
    bow.position.set(.18, .1, 0);
    group.add(bow);
  } else if (kind === 'axe') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .5, 5), material);
    shaft.rotation.z = .55;
    shaft.position.set(.18, .08, .08);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.14, .08, .04), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: .45, metalness: .25 }));
    head.position.set(.28, .2, .08);
    head.rotation.z = .55;
    group.add(shaft, head);
  } else if (kind === 'staff') {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .56, 5), material);
    staff.rotation.z = -.15;
    staff.position.set(.16, .05, .08);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf2d07e, emissive: 0xe6b84d, emissiveIntensity: .5 }));
    orb.position.set(.2, .34, .1);
    group.add(staff, orb);
  }
}

function makeSilhouette(type, friendly) {
  const visual = UNIT_VISUALS[type] || UNIT_VISUALS.militia;
  const body = new THREE.Group();
  const mainMaterial = new THREE.MeshStandardMaterial({ color: visual.silhouette || (friendly ? 0x738ec7 : 0xa24b40), roughness: .95, transparent: true, opacity: .3 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(type === 'brute' ? .17 : .13, type === 'wolfRider' ? .44 : .34, 4, 8), mainMaterial);
  torso.position.y = .03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(type === 'brute' ? .12 : .1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf2d2b8, roughness: 1, transparent: true, opacity: .22 }));
  head.position.y = .34;
  body.add(torso, head);
  addWeapon(body, visual.weapon, visual.ring || 0xffd66b);
  return body;
}

function findClip(animations, keywords, fallbackIndex = 0) {
  if (!animations?.length) return null;
  const lowered = keywords.map((keyword) => keyword.toLowerCase());
  return animations.find((animation) => lowered.some((keyword) => (animation.name || '').toLowerCase().includes(keyword))) || animations[fallbackIndex] || animations[0];
}

function setAnimationState(group, next) {
  const actions = group.userData.animActions;
  if (!actions?.[next] || group.userData.animState === next) return;
  const previous = actions[group.userData.animState];
  const action = actions[next];
  if (previous && previous !== action) previous.fadeOut(.16);
  action.reset().fadeIn(.16).play();
  group.userData.animState = next;
}

function setupMixer(group, model, animations, type) {
  const mixer = new AnimationMixer(model);
  const clips = {
    idle: findClip(animations, ['idle']),
    walk: findClip(animations, ['walk', 'run']),
    attack: findClip(animations, ['attack', 'shoot', 'spell', 'slash', 'strike']),
    hit: findClip(animations, ['recievehit', 'receivehit', 'hit', 'damage']),
    death: findClip(animations, ['death', 'die', 'fall']),
  };
  const actions = {};
  Object.entries(clips).forEach(([key, clip]) => {
    if (!clip) return;
    const action = mixer.clipAction(clip);
    action.enabled = true;
    action.clampWhenFinished = ['attack', 'hit', 'death'].includes(key);
    if (['attack', 'hit', 'death'].includes(key)) action.setLoop(LoopOnce, 1);
    actions[key] = action;
  });
  group.userData.mixer = mixer;
  group.userData.animActions = actions;
  group.userData.animState = null;
  setAnimationState(group, type === 'worker' ? 'walk' : 'idle');
}

function playOneShot(group, kind, fallback = 'idle') {
  const actions = group.userData.animActions;
  if (!actions?.[kind]) return;
  actions[kind].reset().play();
  group.userData.animState = kind;
  if (kind === 'death') return;
  setTimeout(() => {
    if (group.userData.animState === kind) setAnimationState(group, fallback);
  }, 420);
}

function makeUnitMesh(type) {
  const cfg = UNITS[type];
  const visual = UNIT_VISUALS[type] || UNIT_VISUALS.militia;
  const friendly = !cfg.hostile;
  const group = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(type === 'brute' ? .16 : .12, type === 'wolfRider' ? .42 : .32, 4, 6),
    new THREE.MeshStandardMaterial({ color: friendly ? 0x7ba6ff : 0xbf4c40, roughness: .95, transparent: true, opacity: .001 }),
  );
  group.add(body);
  group.userData.body = body;
  const silhouette = makeSilhouette(type, friendly);
  group.add(silhouette);
  group.userData.silhouette = silhouette;
  const mapping = UNIT_MODEL_MAP[type];
  if (mapping) {
    group.userData.facingOffset = mapping.faceOffset || 0;
    attachUnitModel(group, mapping).then((loaded) => {
      if (!loaded) return;
      group.userData.silhouette.visible = false;
      setupMixer(group, loaded.model, loaded.animations, type);
    }).catch(() => {});
  }
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(type === 'brute' ? .42 : .34, type === 'brute' ? .56 : .46, 20),
    new THREE.MeshBasicMaterial({ color: visual.ring || (cfg.hostile ? 0xff6f61 : 0xffd66b), transparent: true, opacity: .3, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = .015;
  group.add(ring);
  group.userData.ring = ring;
  group.userData.visual = visual;
  return group;
}

function vectorFrom(value) {
  if (!value) return null;
  return value.isVector3 ? value.clone() : new THREE.Vector3(value.x || 0, value.y || 0, value.z || 0);
}

export function spawnUnit(sceneCtx, state, type, pos, target = null, options = {}) {
  const cfg = UNITS[type];
  if (!cfg) return null;
  const y = sampleTerrainHeight(state, pos.x, pos.z);
  const entity = {
    id: options.id || `u-${unitId++}`, type,
    hp: options.hp ?? cfg.hp, maxHp: options.maxHp ?? cfg.hp,
    speed: cfg.speed, attack: cfg.attack, range: cfg.range, armor: cfg.armor || 0, sight: cfg.sight || 8,
    hostile: Boolean(cfg.hostile), role: cfg.role,
    attackCooldown: 0, pos: new THREE.Vector3(pos.x, y, pos.z),
    target: null, mode: target ? 'move' : 'idle', mesh: makeUnitMesh(type),
    stepPhase: Math.random() * Math.PI * 2, attackFlash: 0, hitFlash: 0,
    healthEl: null, dead: false, workTimer: 0, idleTimer: 0,
    homeBuildingId: options.homeBuildingId || null,
    homeCampId: options.homeCampId || null,
    assignedBuildingId: options.assignedBuildingId || null,
    taskPhase: options.taskPhase || 'toBuilding',
    gatherCooldown: 0, carrying: options.carrying || null, resourceTargetId: options.resourceTargetId || null,
    commandTarget: vectorFrom(options.commandTarget || target),
    patrolCenter: vectorFrom(options.patrolCenter || target),
    manualTarget: vectorFrom(options.manualTarget),
    guardPoint: vectorFrom(options.guardPoint),
    targetBuildingId: options.targetBuildingId || null,
    aiRole: options.aiRole || (cfg.hostile ? 'guard' : 'guard'),
    forceJob: false, awaitingWork: false, baseY: y,
    path: [], pathIndex: 0, pathDestinationKey: null, repathTimer: 0,
    fleeUntil: 0,
  };
  claimId(entity.id);
  entity.mesh.userData.unitId = entity.id;
  entity.mesh.traverse((object) => { object.userData.unitId = entity.id; });
  entity.mesh.position.set(entity.pos.x, y + .02, entity.pos.z);
  sceneCtx.groups.units.add(entity.mesh);
  state.units.push(entity);
  if (!entity.hostile) state.stats.armyUnits = state.units.filter((unit) => !unit.hostile && unit.type !== 'worker').length;
  return entity;
}

export function queueTraining(building, type) {
  const cfg = UNITS[type];
  building.trainQueue.push({ type, progress: 0, trainTime: cfg.trainTime });
}

export function updateTraining(sceneCtx, state, dt, notify) {
  for (const building of state.buildings) {
    if (!building.trainQueue?.length || building.hp <= 0 || building.upgrading) continue;
    const current = building.trainQueue[0];
    current.progress += dt * (1 + (building.level - 1) * .08);
    if (current.progress < current.trainTime) continue;
    const spawnPos = spawnPointNearBuilding(state, building, building.trainQueue.length) || building.pos.clone();
    const destination = building.rallyPos || (current.type === 'worker' ? null : getCapital(state)?.pos || null);
    const unit = spawnUnit(sceneCtx, state, current.type, spawnPos, destination, { homeBuildingId: building.id, patrolCenter: destination });
    if (unit && !unit.hostile) {
      state.resources.population = Math.min(state.resources.populationCap || 99, (state.resources.population || 0) + 1);
      state.stats.armyUnits = state.units.filter((candidate) => !candidate.hostile && candidate.type !== 'worker').length;
    }
    building.trainQueue.shift();
    notify(`${UNITS[current.type].name} готов`);
  }
}

function nearestUnit(unit, state, predicate, maxDistance = Infinity) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of state.units) {
    if (candidate === unit || candidate.dead || !predicate(candidate)) continue;
    const distance = dist2(unit.pos, candidate.pos);
    if (distance < bestDistance && distance <= maxDistance) { best = candidate; bestDistance = distance; }
  }
  return { best, distance: bestDistance };
}

function findFreeWorkBuilding(unit, state) {
  const candidates = state.buildings.filter((building) => {
    const demand = getBuildingWorkerDemand(building);
    if (!demand || building.hp <= 0 || building.upgrading) return false;
    const assigned = state.units.filter((worker) => !worker.dead && worker.type === 'worker' && worker.assignedBuildingId === building.id).length;
    return assigned < demand;
  });
  candidates.sort((a, b) => {
    const priority = (b.priority ?? 1) - (a.priority ?? 1);
    return priority || dist2(unit.pos, a.pos) - dist2(unit.pos, b.pos);
  });
  return candidates[0] || null;
}

function assignWorkers(state) {
  for (const worker of state.units.filter((unit) => !unit.dead && unit.type === 'worker')) {
    if (worker.manualTarget || worker.fleeUntil > state.worldTime) continue;
    const assigned = state.buildings.find((building) => building.id === worker.assignedBuildingId);
    if (!assigned || assigned.hp <= 0) {
      worker.assignedBuildingId = null;
      worker.resourceTargetId = null;
      worker.carrying = null;
    }
    if (!worker.assignedBuildingId || worker.forceJob) {
      const building = findFreeWorkBuilding(worker, state);
      if (building) {
        worker.assignedBuildingId = building.id;
        worker.taskPhase = ['lumber', 'mine'].includes(building.type) ? 'toResource' : 'toBuilding';
        worker.awaitingWork = false;
      } else {
        worker.awaitingWork = true;
      }
      worker.forceJob = false;
    }
  }
}

export function assignWorkerToBuilding(state, worker, building) {
  if (!worker || worker.type !== 'worker' || !building || getBuildingWorkerDemand(building) <= 0) return false;
  const assigned = state.units.filter((unit) => unit.type === 'worker' && !unit.dead && unit.assignedBuildingId === building.id).length;
  if (assigned >= getBuildingWorkerDemand(building)) return false;
  worker.assignedBuildingId = building.id;
  worker.manualTarget = null;
  worker.forceJob = false;
  worker.awaitingWork = false;
  worker.resourceTargetId = null;
  worker.taskPhase = ['lumber', 'mine'].includes(building.type) ? 'toResource' : 'toBuilding';
  worker.path = [];
  return true;
}

export function releaseWorkerFromBuilding(state, building) {
  const worker = state.units.find((unit) => unit.type === 'worker' && !unit.dead && unit.assignedBuildingId === building.id);
  if (!worker) return false;
  worker.assignedBuildingId = null;
  worker.resourceTargetId = null;
  worker.carrying = null;
  worker.awaitingWork = true;
  worker.taskPhase = 'toBuilding';
  return true;
}

function edgeTarget(unitPos, center, radius) {
  const direction = new THREE.Vector3().subVectors(unitPos, center);
  direction.y = 0;
  if (direction.lengthSq() < .001) direction.set(1, 0, 0);
  return center.clone().addScaledVector(direction.normalize(), radius);
}

function buildingApproach(unit, building, extra = .22) {
  return edgeTarget(unit.pos, buildingCenter(null, building), Math.max(.72, (building.blockRadius || .9) + extra));
}

function resourceById(state, id) {
  return state.trees.find((resource) => resource.id === id) || state.rocks.find((resource) => resource.id === id) || null;
}

function nearestResource(state, building, kind) {
  const list = kind === 'tree' ? state.trees : state.rocks;
  let best = null;
  let bestDistance = Infinity;
  for (const resource of list) {
    if (resource.hp <= 0) continue;
    const distance = Math.hypot(resource.x - building.pos.x, resource.z - building.pos.z);
    if (distance < bestDistance && distance <= 12) { best = resource; bestDistance = distance; }
  }
  return best;
}

function depleteResource(state, resource, amount) {
  resource.hp = Math.max(0, resource.hp - amount);
  if (resource.hp > 0) return;
  resource.depletedUntil = state.worldTime + (resource.kind === 'tree' ? GAME_CONFIG.resourceRegrowTime : GAME_CONFIG.resourceRegrowTime * 1.75);
  setResourceVisible(resource, false);
}

function triggerWorkerFlee(unit, state) {
  const { best: enemy, distance } = nearestUnit(unit, state, (candidate) => candidate.hostile, 4.2);
  if (!enemy || distance > 4.2) return null;
  unit.fleeUntil = state.worldTime + 5;
  const capital = getCapital(state);
  if (capital) return buildingApproach(unit, capital, .6);
  const away = new THREE.Vector3().subVectors(unit.pos, enemy.pos).setY(0).normalize();
  return unit.pos.clone().addScaledVector(away, 6);
}

function updateWorker(unit, state, dt) {
  const fleeTarget = triggerWorkerFlee(unit, state);
  if (fleeTarget) return { target: fleeTarget, path: true, movedState: 'walk' };
  if (unit.fleeUntil > state.worldTime) {
    const capital = getCapital(state);
    return { target: capital ? buildingApproach(unit, capital, .7) : null, path: true, movedState: 'walk' };
  }
  if (unit.manualTarget) return { target: unit.manualTarget, path: true, manual: true, movedState: 'walk' };

  const building = state.buildings.find((candidate) => candidate.id === unit.assignedBuildingId);
  if (!building) {
    const capital = getCapital(state);
    return { target: capital ? buildingApproach(unit, capital, .2) : null, path: true, movedState: 'idle' };
  }

  if (building.type === 'farm') {
    const target = spawnPointNearBuilding(state, building, Number(unit.id.replace(/\D/g, '')) || 0);
    if (target && unit.pos.distanceTo(target) <= .5) {
      unit.workTimer -= dt;
      if (unit.workTimer <= 0) {
        unit.workTimer = 1.15;
        state.resources.food += .62 * (1 + (building.level - 1) * .35);
      }
      return { target: null, movedState: 'idle' };
    }
    return { target, path: true, movedState: 'walk' };
  }

  if (['lumber', 'mine'].includes(building.type)) {
    const kind = building.type === 'lumber' ? 'tree' : 'rock';
    let resource = resourceById(state, unit.reso