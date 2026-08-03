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
    let resource = resourceById(state, unit.resourceTargetId);
    if (!resource || resource.hp <= 0) {
      resource = nearestResource(state, building, kind);
      unit.resourceTargetId = resource?.id || null;
      unit.taskPhase = resource ? 'toResource' : 'toBuilding';
    }
    if (!resource) return { target: buildingApproach(unit, building), path: true, movedState: 'idle' };
    if (unit.taskPhase === 'toResource') {
      const target = new THREE.Vector3(resource.x, resource.y, resource.z);
      if (unit.pos.distanceTo(target) <= .72) {
        unit.taskPhase = 'gather';
        unit.workTimer = 1.25;
        return { target: null, movedState: 'attack' };
      }
      return { target, path: true, movedState: 'walk' };
    }
    if (unit.taskPhase === 'gather') {
      unit.workTimer -= dt;
      if (unit.workTimer <= 0) {
        depleteResource(state, resource, building.type === 'lumber' ? 5 : 7);
        unit.carrying = building.type === 'lumber'
          ? { wood: 4.8 + building.level * 1.1 }
          : { stone: 3.7 + building.level, gold: resource.isGold ? .9 : .2 };
        unit.taskPhase = 'toBuilding';
      }
      return { target: null, movedState: 'attack' };
    }
    const target = buildingApproach(unit, building, .12);
    if (unit.pos.distanceTo(target) <= .58) {
      Object.entries(unit.carrying || {}).forEach(([key, value]) => { state.resources[key] = (state.resources[key] || 0) + value; });
      unit.carrying = null;
      unit.resourceTargetId = null;
      unit.taskPhase = 'toResource';
      return { target: null, movedState: 'idle' };
    }
    return { target, path: true, movedState: 'walk' };
  }

  const target = buildingApproach(unit, building, .08);
  if (unit.pos.distanceTo(target) <= .52) return { target: null, movedState: 'idle' };
  return { target, path: true, movedState: 'walk' };
}

function attackUnit(sceneCtx, state, unit, target) {
  if (!target || unit.attackCooldown > 0) return;
  unit.attackCooldown = unit.range > 2 ? 1.25 : .95;
  unit.attackFlash = .14;
  playOneShot(unit.mesh, 'attack');
  const damage = unit.attack * (!unit.hostile && state.techs.has('discipline') ? 1.12 : 1);
  if (unit.range > 2) {
    state.projectiles.push(spawnProjectile(sceneCtx, unit.pos.clone().setY(unit.pos.y + .9), target.pos.clone().setY(target.pos.y + .8), unit.hostile ? 0xffa46d : 0xffe59e, { unitId: target.id, damage }));
  } else {
    applyUnitDamage(target, damage);
  }
}

function attackBuilding(sceneCtx, state, unit, building) {
  if (!building || unit.attackCooldown > 0) return;
  unit.attackCooldown = unit.range > 2 ? 1.45 : 1.05;
  unit.attackFlash = .16;
  playOneShot(unit.mesh, 'attack');
  const rawDamage = unit.attack * (unit.type === 'brute' ? 1.5 : 1);
  const stoneDefense = ['wall', 'tower', 'temple'].includes(building.type) && state.techs.has('stonework') ? .82 : 1;
  const damage = rawDamage * stoneDefense;
  if (unit.range > 2) {
    state.projectiles.push(spawnProjectile(sceneCtx, unit.pos.clone().setY(unit.pos.y + .95), buildingCenter(state, building), unit.hostile ? 0xffb278 : 0xffdd90, { buildingId: building.id, damage }));
  } else {
    building.hp -= damage;
    building.hitFlash = .25;
    if (building.hp <= 0) removeDestroyedBuilding(sceneCtx, state, building);
  }
}

function nearestCamp(unit, state, maxDistance = Infinity) {
  let best = null;
  let distance = Infinity;
  for (const camp of state.enemyCamps) {
    const current = unit.pos.distanceTo(camp.pos);
    if (camp.hp > 0 && current < distance && current <= maxDistance) { best = camp; distance = current; }
  }
  return { best, distance };
}

function attackCamp(sceneCtx, state, unit, camp, notify) {
  if (!camp || unit.attackCooldown > 0) return;
  unit.attackCooldown = unit.range > 2 ? 1.25 : .95;
  playOneShot(unit.mesh, 'attack');
  camp.hp -= unit.attack * (unit.range > 2 ? .9 : 1.15);
  camp.hitFlash = .25;
  camp.alert = (camp.alert || 0) + 3;
  if (camp.hp > 0) return;
  camp.hp = 0;
  spawnCollapse(sceneCtx, camp.pos.clone().setY(camp.pos.y + .5), 0xb06845);
  sceneCtx.groups.enemyCamps.remove(camp.mesh);
  state.enemyCamps = state.enemyCamps.filter((candidate) => candidate.id !== camp.id);
  state.stats.campsDestroyed += 1;
  state.resources.gold += 28;
  state.resources.threat = Math.max(0, state.resources.threat - 14);
  state.units.filter((candidate) => candidate.hostile && candidate.homeCampId === camp.id).forEach((candidate) => {
    candidate.homeCampId = null;
    candidate.aiRole = 'raid';
    candidate.targetBuildingId = getCapital(state)?.id || null;
  });
  notify('Вражеский лагерь разрушен — захвачено 28 золота');
}

function patrolTarget(unit, center) {
  if (!center) return null;
  const numeric = Number(unit.id.replace(/\D/g, '')) || 1;
  const angle = performance.now() * .00035 + numeric * 1.7;
  const radius = 1.1 + (numeric % 3) * .45;
  return center.clone().add(new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius));
}

function updateFriendlySoldier(sceneCtx, state, unit, notify) {
  const { best: enemy, distance: enemyDistance } = nearestUnit(unit, state, (candidate) => candidate.hostile, unit.sight);
  if (enemy) {
    if (enemyDistance <= unit.range + .28) attackUnit(sceneCtx, state, unit, enemy);
    return { target: enemy.pos, path: false, attackTarget: enemy };
  }
  const { best: camp, distance: campDistance } = nearestCamp(unit, state, unit.commandTarget ? 11 : 7);
  if (camp) {
    if (campDistance <= Math.max(1.3, unit.range + .65)) attackCamp(sceneCtx, state, unit, camp, notify);
    return { target: camp.pos, path: true };
  }
  if (unit.manualTarget) return { target: unit.manualTarget, path: true, manual: true };
  const center = unit.commandTarget || unit.patrolCenter || getCapital(state)?.pos;
  return { target: patrolTarget(unit, center), path: true };
}

function hostileHomeCamp(state, unit) {
  return state.enemyCamps.find((camp) => camp.id === unit.homeCampId) || null;
}

function updateHostile(sceneCtx, state, unit, dt) {
  const camp = hostileHomeCamp(state, unit);
  if (camp && unit.hp < unit.maxHp * .24 && unit.aiRole !== 'retreat') unit.aiRole = 'retreat';
  if (unit.aiRole === 'retreat' && camp) {
    if (unit.pos.distanceTo(camp.pos) < 2.2) {
      unit.hp = Math.min(unit.maxHp, unit.hp + dt * .9);
      if (unit.hp >= unit.maxHp * .58) unit.aiRole = 'guard';
      return { target: null, path: false };
    }
    return { target: camp.pos, path: true };
  }

  const engagementRange = unit.aiRole === 'guard' ? unit.sight : unit.sight * .8;
  const { best: defender, distance } = nearestUnit(unit, state, (candidate) => !candidate.hostile, engagementRange);
  if (defender) {
    if (distance <= unit.range + .28) attackUnit(sceneCtx, state, unit, defender);
    return { target: defender.pos, path: false, attackTarget: defender };
  }

  if (unit.aiRole === 'guard' && camp) return { target: patrolTarget(unit, camp.pos), path: true };
  let targetBuilding = state.buildings.find((building) => building.id === unit.targetBuildingId);
  if (!targetBuilding) targetBuilding = getCapital(state) || state.buildings[0];
  if (!targetBuilding) return { target: null };
  unit.targetBuildingId = targetBuilding.id;
  const approach = buildingApproach(unit, targetBuilding, unit.range > 2 ? Math.max(1.4, unit.range - .2) : .2);
  const distanceToBuilding = unit.pos.distanceTo(approach);
  if (distanceToBuilding <= .55 || unit.pos.distanceTo(targetBuilding.pos) <= unit.range + targetBuilding.blockRadius) attackBuilding(sceneCtx, state, unit, targetBuilding);
  return { target: approach, path: true };
}

function destinationKey(target) {
  return `${Math.round(target.x / 1.8)},${Math.round(target.z / 1.8)}`;
}

function movementTarget(unit, state, desired, usePath) {
  if (!desired) return null;
  if (!usePath || unit.pos.distanceTo(desired) < 3.2) return desired;
  unit.repathTimer -= GAME_CONFIG.logicTick;
  const key = destinationKey(desired);
  if (unit.pathDestinationKey !== key || !unit.path?.length || unit.repathTimer <= 0) {
    unit.path = findPath(state, unit.pos, desired, { maxNodes: 1000 });
    unit.pathIndex = 0;
    unit.pathDestinationKey = key;
    unit.repathTimer = 2.5 + Math.random();
  }
  if (!unit.path.length) return desired;
  let waypoint = unit.path[unit.pathIndex] || desired;
  if (unit.pos.distanceTo(waypoint) < .38 && unit.pathIndex < unit.path.length - 1) {
    unit.pathIndex += 1;
    waypoint = unit.path[unit.pathIndex] || desired;
  }
  return waypoint;
}

function applySeparation(unit, state) {
  const push = new THREE.Vector3();
  let count = 0;
  for (const other of state.units) {
    if (other === unit || other.dead || other.hostile !== unit.hostile) continue;
    const dx = unit.pos.x - other.pos.x;
    const dz = unit.pos.z - other.pos.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= .001 || distance >= .55) continue;
    push.x += dx / distance * (.55 - distance);
    push.z += dz / distance * (.55 - distance);
    count += 1;
  }
  if (count) unit.pos.addScaledVector(push, .16 / count);
}

function keepOutsideBuildings(unit, state) {
  for (const building of state.buildings) {
    const dx = unit.pos.x - building.pos.x;
    const dz = unit.pos.z - building.pos.z;
    const distance = Math.hypot(dx, dz);
    const radius = Math.max(.5, (building.blockRadius || .9) * .76);
    if (distance >= radius) continue;
    if (distance < .001) {
      unit.pos.x += radius;
      continue;
    }
    const push = radius - distance + .02;
    unit.pos.x += dx / distance * push;
    unit.pos.z += dz / distance * push;
  }
}

function moveUnit(unit, state, target, dt, usePath, attackTarget = null) {
  const waypoint = movementTarget(unit, state, target, usePath);
  if (!waypoint) return false;
  const direction = new THREE.Vector3().subVectors(waypoint, unit.pos).setY(0);
  const distance = direction.length();
  const stopDistance = attackTarget ? Math.max(.26, unit.range * .88) : .14;
  if (distance <= stopDistance) return false;
  direction.normalize();
  const previous = unit.pos.clone();
  const weather = WEATHER_TYPES[state.weather] || WEATHER_TYPES.clear;
  const terrain = sampleTerrain(state, unit.pos.x, unit.pos.z);
  const terrainSpeed = ({ river: .82, rock: .74, hill: .82, forest: .88 })[terrain.type] || 1;
  const speed = unit.speed * weather.move * terrainSpeed * roadMovementMultiplier(state, unit.pos.x, unit.pos.z);
  unit.pos.addScaledVector(direction, speed * dt);
  if (!isWalkable(state, unit.pos.x, unit.pos.z, { ignoreBuildings: true })) {
    unit.pos.copy(previous);
    unit.path = [];
    unit.repathTimer = 0;
    return false;
  }
  applySeparation(unit, state);
  keepOutsideBuildings(unit, state);
  const desiredYaw = Math.atan2(direction.x, direction.z) + (unit.mesh.userData.facingOffset || 0);
  let delta = desiredYaw - unit.mesh.rotation.y;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  unit.mesh.rotation.y += delta * Math.min(1, dt * 12);
  return true;
}

function cleanupDeadUnit(sceneCtx, state, unit, index) {
  if (unit.dead) return;
  unit.dead = true;
  spawnCollapse(sceneCtx, unit.pos.clone().setY(unit.pos.y + .6), unit.hostile ? 0xd36d58 : 0x8ebbe0);
  playOneShot(unit.mesh, 'death');
  sceneCtx.groups.units.remove(unit.mesh);
  state.units.splice(index, 1);
  state.selectedUnits = state.selectedUnits.filter((selected) => selected.id !== unit.id);
  if (unit.hostile) state.stats.raidsDefeated += 1;
  else {
    state.resources.population = Math.max(0, (state.resources.population || 0) - 1);
    state.stats.armyUnits = state.units.filter((candidate) => !candidate.hostile && candidate.type !== 'worker').length;
  }
}

function updateVisual(unit, state, dt, moved, requestedState) {
  const visual = UNIT_VISUALS[unit.type] || UNIT_VISUALS.militia;
  if (moved) unit.stepPhase += dt * unit.speed * visual.bobSpeed;
  unit.baseY = sampleTerrainHeight(state, unit.pos.x, unit.pos.z);
  unit.pos.y = unit.baseY;
  unit.mesh.position.set(unit.pos.x, unit.baseY + .02, unit.pos.z);
  const ring = unit.mesh.userData.ring;
  ring.material.opacity = (unit.hostile ? .36 : .25) + unit.attackFlash * .4 + unit.hitFlash * .3;
  ring.material.color.setHex(unit.hostile ? 0xff7c63 : 0xffd66b);
  const body = unit.mesh.userData.body;
  if (body) {
    body.position.y = Math.sin(unit.stepPhase) * visual.bounce;
    body.rotation.z = Math.sin(unit.stepPhase * .5) * visual.lean;
  }
  if (unit.mesh.userData.mixer) {
    unit.mesh.userData.mixer.update(dt);
    if (!unit.attackFlash && !unit.hitFlash) setAnimationState(unit.mesh, requestedState === 'attack' ? 'attack' : moved ? 'walk' : 'idle');
  }
}

export function updateUnits(sceneCtx, state, dt, notify) {
  assignWorkers(state);
  for (let index = state.units.length - 1; index >= 0; index--) {
    const unit = state.units[index];
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    unit.attackFlash = Math.max(0, unit.attackFlash - dt * 2.2);
    unit.hitFlash = Math.max(0, unit.hitFlash - dt * 3.4);
    let decision;
    if (unit.hostile) decision = updateHostile(sceneCtx, state, unit, dt);
    else if (unit.type === 'worker') decision = updateWorker(unit, state, dt);
    else decision = updateFriendlySoldier(sceneCtx, state, unit, notify);

    const moved = moveUnit(unit, state, decision?.target, dt, Boolean(decision?.path), decision?.attackTarget);
    if (decision?.manual && unit.manualTarget && unit.pos.distanceTo(unit.manualTarget) < .3) {
      unit.manualTarget = null;
      if (unit.type === 'worker') unit.commandTarget = null;
      else unit.patrolCenter = unit.commandTarget?.clone() || unit.patrolCenter;
      unit.path = [];
      unit.mode = 'idle';
    }
    updateVisual(unit, state, dt, moved, decision?.movedState);
    if (unit.hitFlash > 0 && unit.mesh.userData.animActions?.hit) playOneShot(unit.mesh, 'hit');
    if (unit.hp <= 0) cleanupDeadUnit(sceneCtx, state, unit, index);
  }
}

export function autoSpawnWorkers(sceneCtx, state, dt, notify) {
  state.workerSpawnTimer += dt;
  const spawnDelay = state.workerSpawnDelay || GAME_CONFIG.workerSpawnEvery;
  if (state.workerSpawnTimer < spawnDelay) return;
  state.workerSpawnTimer = 0;
  if (state.resources.population >= state.resources.populationCap) return;
  const workers = state.units.filter((unit) => !unit.dead && unit.type === 'worker').length;
  const demand = state.buildings.reduce((sum, building) => sum + getBuildingWorkerDemand(building), 0);
  if (workers >= demand + 1 || state.resources.food < 24 || state.resources.stability < 42) return;
  const capital = getCapital(state);
  if (!capital) return;
  state.resources.population += 1;
  state.resources.food -= 8;
  const spawnPos = spawnPointNearBuilding(state, capital, workers) || capital.pos.clone();
  spawnUnit(sceneCtx, state, 'worker', spawnPos, null, { homeBuildingId: capital.id });
  notify('В столице появился новый рабочий');
}

export function spawnPointNearBuilding(state, building, slot = 0) {
  if (!building) return null;
  const center = buildingCenter(state, building);
  const radius = Math.max(1.16, (building.blockRadius || .9) + .42);
  const angles = [0.3, 1.34, 2.42, 3.56, 4.65, 5.6];
  for (let attempt = 0; attempt < angles.length; attempt++) {
    const angle = angles[(slot + attempt) % angles.length];
    const x = center.x + Math.cos(angle) * radius;
    const z = center.z + Math.sin(angle) * radius;
    if (sampleTerrain(state, x, z).type !== 'water') return new THREE.Vector3(x, sampleTerrainHeight(state, x, z), z);
  }
  return center.clone();
}
