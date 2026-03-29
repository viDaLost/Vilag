import * as THREE from 'three';
import { AnimationMixer, LoopOnce } from 'three';
import { GAME_CONFIG, UNITS, UNIT_MODEL_MAP, UNIT_VISUALS } from '../config.js';
import { getCapital, buildingCenter, getBuildingWorkerDemand } from './buildings.js';
import { dist2 } from '../utils/helpers.js';
import { spawnCollapse, spawnProjectile } from './combat.js';
import { attachUnitModel } from '../core/assets.js';
import { getTerrainY } from './terrain.js';

let unitId = 1;

function addWeapon(group, kind, color) {
  const mat = new THREE.MeshStandardMaterial({ color, roughness: .9, metalness: .08 });
  if (kind === 'sword' || kind === 'blade' || kind === 'dual') {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(.05, .42, .05), mat);
    blade.position.set(.18, .12, .12);
    blade.rotation.z = -.45;
    group.add(blade);
    if (kind === 'dual') {
      const blade2 = blade.clone();
      blade2.position.set(-.18, .1, .12);
      blade2.rotation.z = .45;
      group.add(blade2);
    }
  } else if (kind === 'bow') {
    const bow = new THREE.Mesh(new THREE.TorusGeometry(.14, .02, 5, 16, Math.PI), mat);
    bow.rotation.z = Math.PI / 2;
    bow.position.set(.18, .1, 0);
    group.add(bow);
  } else if (kind === 'axe') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, .5, 5), mat);
    shaft.rotation.z = .55;
    shaft.position.set(.18, .08, .08);
    const head = new THREE.Mesh(new THREE.BoxGeometry(.14, .08, .04), new THREE.MeshStandardMaterial({ color: 0xc9c9c9, roughness: .45, metalness: .25 }));
    head.position.set(.28, .2, .08);
    head.rotation.z = .55;
    group.add(shaft, head);
  } else if (kind === 'staff') {
    const staff = new THREE.Mesh(new THREE.CylinderGeometry(.02, .02, .56, 5), mat);
    staff.rotation.z = -.15;
    staff.position.set(.16, .05, .08);
    const orb = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf2d07e, emissive: 0xe6b84d, emissiveIntensity: .5 }));
    orb.position.set(.2, .34, .1);
    group.add(staff, orb);
  }
}

function makeSilhouette(type, friendly) {
  const vis = UNIT_VISUALS[type] || UNIT_VISUALS.militia;
  const body = new THREE.Group();
  const mainMat = new THREE.MeshStandardMaterial({ color: vis.silhouette || (friendly ? 0x738ec7 : 0xa24b40), roughness: .95, transparent: true, opacity: .3 });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(type === 'brute' ? .17 : .13, type === 'wolfRider' ? .44 : .34, 4, 8), mainMat);
  torso.position.y = .03;
  const head = new THREE.Mesh(new THREE.SphereGeometry(type === 'brute' ? .12 : .1, 8, 8), new THREE.MeshStandardMaterial({ color: 0xf2d2b8, roughness: 1, transparent: true, opacity: .22 }));
  head.position.y = .34;
  body.add(torso, head);
  addWeapon(body, vis.weapon, vis.ring || 0xffd66b);
  return body;
}

function findClip(animations, keywords, fallbackIndex = 0) {
  if (!animations?.length) return null;
  const lowered = keywords.map((k) => k.toLowerCase());
  let clip = animations.find((a) => lowered.some((k) => (a.name || '').toLowerCase().includes(k)));
  if (!clip) clip = animations[fallbackIndex] || animations[0];
  return clip;
}

function setupMixer(group, model, animations, type) {
  const mixer = new AnimationMixer(model);
  const clips = {
    idle: findClip(animations, ['idle']),
    walk: findClip(animations, ['walk', 'run']),
    attack: findClip(animations, ['attack', 'shoot', 'staff_attack', 'sword_attack', 'dagger_attack', 'spell', 'bow_shoot', 'slash', 'strike', 'fire', 'punch']),
    hit: findClip(animations, ['recievehit', 'receivehit', 'hit', 'damage']),
    death: findClip(animations, ['death', 'die', 'fall'])
  };
  const actions = {};
  Object.entries(clips).forEach(([k, clip]) => {
    if (!clip) return;
    const act = mixer.clipAction(clip);
    act.enabled = true;
    act.clampWhenFinished = k === 'attack' || k === 'hit' || k === 'death';
    if (k === 'attack' || k === 'hit' || k === 'death') act.setLoop(LoopOnce, 1);
    actions[k] = act;
  });
  group.userData.mixer = mixer;
  group.userData.animActions = actions;
  group.userData.animState = null;
  setAnimationState(group, type === 'worker' ? 'walk' : 'idle');
}

function setAnimationState(group, next) {
  const actions = group.userData.animActions;
  if (!actions || !actions[next]) return;
  if (group.userData.animState === next) return;
  const prev = actions[group.userData.animState];
  const nextAction = actions[next];
  if (prev && prev !== nextAction) prev.fadeOut(.18);
  nextAction.reset().fadeIn(.18).play();
  group.userData.animState = next;
}

function playOneShot(group, kind, fallback = 'idle') {
  const actions = group.userData.animActions;
  if (!actions?.[kind]) return;
  const action = actions[kind];
  const idle = actions[fallback] || actions.idle;
  action.reset();
  action.play();
  group.userData.animState = kind;
  if (kind !== 'death') {
    setTimeout(() => {
      if (group.userData.animState === kind && idle) {
        setAnimationState(group, fallback);
      }
    }, 420);
  }
}

function makeUnitMesh(type) {
  const cfg = UNITS[type];
  const vis = UNIT_VISUALS[type] || UNIT_VISUALS.militia;
  const friendly = !cfg.hostile;
  const group = new THREE.Group();

  const hiddenBody = new THREE.Mesh(
    new THREE.CapsuleGeometry(type === 'brute' ? .16 : .12, type === 'wolfRider' ? .42 : .32, 4, 6),
    new THREE.MeshStandardMaterial({ color: friendly ? 0x7ba6ff : 0xbf4c40, roughness: .95, transparent: true, opacity: 0.001 })
  );
  group.add(hiddenBody);
  group.userData.body = hiddenBody;

  const silhouette = makeSilhouette(type, friendly);
  group.add(silhouette);
  group.userData.silhouette = silhouette;

  const mapping = UNIT_MODEL_MAP[type];
  if (mapping) {
    group.userData.facingOffset = mapping.faceOffset || 0;
    attachUnitModel(group, mapping).then((loaded) => {
      if (!loaded) return;
      const { model, animations } = loaded;
      if (group.userData.silhouette) group.userData.silhouette.visible = false;
      setupMixer(group, model, animations, type);
    }).catch(() => {});
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(type === 'brute' ? .42 : .34, type === 'brute' ? .56 : .46, 24),
    new THREE.MeshBasicMaterial({ color: vis.ring || (cfg.hostile ? 0xff6f61 : 0xffd66b), transparent: true, opacity: .34, side: THREE.DoubleSide })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -.42;
  group.add(ring);
  group.userData.ring = ring;
  group.userData.visual = vis;
  return group;
}

export function spawnUnit(sceneCtx, state, type, pos, target = null) {
  const cfg = UNITS[type];
  const entity = {
    id: `u-${unitId++}`,
    type,
    hp: cfg.hp,
    maxHp: cfg.hp,
    speed: cfg.speed,
    attack: cfg.attack,
    range: cfg.range,
    hostile: !!cfg.hostile,
    attackCooldown: 0,
    pos: new THREE.Vector3(pos.x, pos.y, pos.z),
    target,
    mode: target ? 'move' : 'idle',
    mesh: makeUnitMesh(type),
    stepPhase: Math.random() * Math.PI * 2,
    attackFlash: 0,
    hitFlash: 0,
    healthEl: null,
    dead: false,
    workTimer: 0,
    idleTimer: 0,
    homeBuildingId: null,
    assignedBuildingId: null,
    taskPhase: 'toBuilding',
    pauseAtBuilding: 0,
    gatherCooldown: 0,
    commandTarget: target ? target.clone() : null,
    patrolCenter: target ? target.clone() : null,
    baseY: pos.y,
  };
  entity.mesh.position.copy(entity.pos);
  entity.mesh.position.y += .18;
  sceneCtx.groups.units.add(entity.mesh);
  state.units.push(entity);
  if (!entity.hostile) state.stats.armyUnits = state.units.filter((u) => !u.hostile && u.type !== 'worker').length;
  return entity;
}

export function queueTraining(building, type) {
  const cfg = UNITS[type];
  building.trainQueue.push({ type, progress: 0, trainTime: cfg.trainTime });
}

export function updateTraining(sceneCtx, state, dt, notify) {
  dt = Math.min(dt, 0.1); 

  for (const building of state.buildings) {
    if (!building.trainQueue.length) continue;
    const current = building.trainQueue[0];
    current.progress += dt;
    if (current.progress >= current.trainTime) {
      const tile = state.mapIndex.get(building.tileId);
      const spawnPos = new THREE.Vector3(tile.pos.x + .8, tile.height, tile.pos.z + .8);
      const target = current.type === 'worker' ? null : (building.rallyTileId ? state.mapIndex.get(building.rallyTileId)?.pos?.clone() : getCapital(state) ? state.mapIndex.get(getCapital(state).tileId).pos.clone() : null);
      const unit = spawnUnit(sceneCtx, state, current.type, spawnPos, target);
      unit.homeBuildingId = building.id;
      if (target) {
        unit.commandTarget = target.clone();
        unit.patrolCenter = target.clone();
      }
      building.trainQueue.shift();
      notify(`${UNITS[current.type].name} готов`);
    }
  }
}

function nearestTarget(unit, state, predicate, maxDistance = Infinity) {
  let best = null;
  let bestD = Infinity;
  state.units.forEach((candidate) => {
    if (!predicate(candidate)) return;
    const d = dist2(unit.pos, candidate.pos);
    if (d < bestD && d <= maxDistance) {
      best = candidate;
      bestD = d;
    }
  });
  return { best, bestD };
}

function damageNearestBuilding(sceneCtx, state, unit, notify) {
  let nearest = null;
  let nearestD = Infinity;
  state.buildings.forEach((b) => {
    const d = dist2(unit.pos, buildingCenter(state, b));
    if (d < nearestD) {
      nearest = b;
      nearestD = d;
    }
  });
  if (!nearest || nearestD > unit.range + 0.9 || unit.attackCooldown > 0) return;
  unit.attackCooldown = unit.range > 2 ? 1.45 : 1.05;
  unit.attackFlash = .16;
  playOneShot(unit.mesh, 'attack');
  if (unit.range > 2) {
    state.projectiles.push(spawnProjectile(sceneCtx, unit.pos.clone().add(new THREE.Vector3(0, .95, 0)), buildingCenter(state, nearest).clone().add(new THREE.Vector3(0, .65, 0)), unit.hostile ? 0xffb278 : 0xffdd90, { buildingId: nearest.id, damage: unit.attack * (unit.type === 'brute' ? 1.5 : 1) }));
  } else {
    nearest.hp -= unit.attack * (unit.type === 'brute' ? 1.5 : 1);
    nearest.hitFlash = .25;
  }
  if (nearest.hp <= 0) {
    const center = buildingCenter(state, nearest);
    spawnCollapse(sceneCtx, center, nearest.type === 'wall' ? 0x9c9c9c : 0xa06b44);
    if (nearest.type === 'capital') {
      nearest.hp = 0;
    } else {
      sceneCtx.groups.buildings.remove(nearest.mesh);
      const tile = state.mapIndex.get(nearest.tileId);
      if (tile) tile.buildingId = null;
      state.buildings = state.buildings.filter((b) => b.id !== nearest.id);
      notify(`Разрушено здание: ${nearest.type}`);
    }
  }
}

function cleanupDeadUnit(sceneCtx, state, unit, index) {
  if (unit.dead) return;
  unit.dead = true;
  spawnCollapse(sceneCtx, unit.pos.clone().setY(unit.pos.y + .6), unit.hostile ? 0xd36d58 : 0x8ebbe0);
  if (unit.mesh.userData.mixer) playOneShot(unit.mesh, 'death', 'idle');
  sceneCtx.groups.units.remove(unit.mesh);
  state.units.splice(index, 1);
  if (!unit.hostile) state.stats.armyUnits = state.units.filter((u) => !u.hostile && u.type !== 'worker').length;
}

function assignWorkers(state) {
  const workers = state.units.filter((u) => !u.dead && u.type === 'worker');
  const buildings = state.buildings
    .map((b) => ({ building: b, demand: getBuildingWorkerDemand(b) }))
    .filter((x) => x.demand > 0)
    .sort((a, b) => (b.demand * 10 + b.building.level) - (a.demand * 10 + a.building.level));

  workers.forEach((w) => { w.tempAssigned = false; });
  for (const { building, demand } of buildings) {
    const assigned = workers.filter((w) => w.assignedBuildingId === building.id && !w.tempAssigned).slice(0, demand);
    assigned.forEach((w) => { w.tempAssigned = true; });
    let remaining = demand - assigned.length;
    if (remaining <= 0) continue;
    const free = workers.filter((w) => !w.tempAssigned).sort((a, b) => dist2(a.pos, buildingCenter(state, building)) - dist2(b.pos, buildingCenter(state, building)));
    free.slice(0, remaining).forEach((w) => {
      w.assignedBuildingId = building.id;
      w.tempAssigned = true;
    });
  }
  workers.forEach((w) => {
    if (!w.tempAssigned && !state.buildings.some((b) => b.id === w.assignedBuildingId)) w.assignedBuildingId = null;
    delete w.tempAssigned;
  });
}

function workerTaskTarget(unit, state, capitalTile) {
  const building = state.buildings.find((b) => b.id === unit.assignedBuildingId);
  if (!building) return capitalTile ? capitalTile.pos.clone() : null;
  const center = buildingCenter(state, building);
  if (building.type === 'farm') {
    const offsets = [[-0.55,0.34],[0.42,0.4],[0.18,-0.28],[-0.35,-0.18]];
    const idx = Number(String(unit.id).replace(/\D/g, '')) % offsets.length;
    const [ox, oz] = offsets[idx];
    return new THREE.Vector3(center.x + ox, center.y, center.z + oz);
  }
  const offset = building.type === 'mine' ? new THREE.Vector3(0.78, 0, 0.1) : new THREE.Vector3(0.72, 0, 0.18);
  return center.clone().add(offset);
}

function patrolTargetFor(unit, state, capitalTile) {
  const focus = unit.commandTarget || unit.patrolCenter || (capitalTile ? capitalTile.pos : null);
  if (!focus) return null;
  const t = (performance.now() * 0.001 + Number(String(unit.id).replace(/\D/g, '')) * 0.37) % (Math.PI * 2);
  const radius = 0.45 + (unit.range > 2 ? 0.45 : 0.2);
  return new THREE.Vector3(focus.x + Math.cos(t) * radius, focus.y || 0, focus.z + Math.sin(t) * radius);
}

function keepAwayFromBuildings(unit, state) {
  for (const building of state.buildings) {
    const center = buildingCenter(state, building);
    const radius = (building.blockRadius || 1.0) + (unit.range > 2 ? 0.2 : 0.1);
    const dx = unit.pos.x - center.x;
    const dz = unit.pos.z - center.z;
    const d = Math.hypot(dx, dz) || 0.0001;
    if (d < radius) {
      const push = (radius - d) * 0.8;
      unit.pos.x += (dx / d) * push;
      unit.pos.z += (dz / d) * push;
    }
  }
}

function computeBuildingReturn(building) {
  return building.type === 'farm' ? 0.7 + building.level * 0.22 : 0.9 + building.level * 0.25;
}

function nearestEnemyCamp(unit, state, maxDistance = 8) {
  let best = null;
  let bestD = Infinity;
  for (const camp of state.enemyCamps) {
    if (camp.hp <= 0) continue;
    const d = unit.pos.distanceTo(camp.pos);
    if (d < bestD && d <= maxDistance) {
      best = camp; bestD = d;
    }
  }
  return { best, bestD };
}

function damageEnemyCamp(sceneCtx, state, unit, camp, notify) {
  if (!camp || unit.attackCooldown > 0) return;
  unit.attackCooldown = unit.range > 2 ? 1.2 : 0.95;
  playOneShot(unit.mesh, 'attack');
  camp.hp -= unit.attack * (unit.range > 2 ? 0.9 : 1.15);
  camp.hitFlash = 0.25;
  if ((camp.spawnCooldown || 0) <= 0 && camp.hp > 0) {
    camp.spawnCooldown = 6;
    const defenders = camp.faction === 'iron' ? ['brute'] : camp.faction === 'beasts' ? ['wolfRider'] : ['raider','raiderArcher'];
    const type = defenders[Math.floor(Math.random() * defenders.length)];
    const spawned = spawnUnit(sceneCtx, state, type, camp.pos.clone().add(new THREE.Vector3((Math.random()-.5)*1.2, 0, (Math.random()-.5)*1.2)));
    spawned.commandTarget = getCapital(state) ? state.mapIndex.get(getCapital(state).tileId)?.pos?.clone() : null;
  }
  if (camp.hp <= 0) {
    camp.hp = 0;
    spawnCollapse(sceneCtx, camp.pos.clone().setY(camp.pos.y + 0.5), 0xb06845);
    sceneCtx.groups.enemyCamps.remove(camp.mesh);
    state.enemyCamps = state.enemyCamps.filter((x) => x.id !== camp.id);
    state.stats.campsDestroyed += 1;
    notify('Вражеский лагерь разрушен');
  }
}
function attackUnit(sceneCtx, state, unit, target) {
  if (!target || unit.attackCooldown > 0) return;
  unit.attackCooldown = unit.range > 2 ? 1.25 : 0.95;
  unit.attackFlash = .12;
  playOneShot(unit.mesh, 'attack');
  if (unit.range > 2) {
    state.projectiles.push(spawnProjectile(sceneCtx, unit.pos.clone().add(new THREE.Vector3(0, .9, 0)), target.pos.clone().add(new THREE.Vector3(0, .8, 0)), unit.hostile ? 0xffa46d : 0xffe59e, { unitId: target.id, damage: unit.attack }));
  } else {
    target.hp -= unit.attack;
    target.hitFlash = .18;
  }
}

export function updateUnits(sceneCtx, state, dt, notify) {
  dt = Math.min(dt, 0.1);
  const capital = getCapital(state);
  const capitalTile = capital ? state.mapIndex.get(capital.tileId) : null;
  assignWorkers(state);

  for (let i = state.units.length - 1; i >= 0; i--) {
    const unit = state.units[i];
    const vis = UNIT_VISUALS[unit.type] || UNIT_VISUALS.militia;
    state.enemyCamps.forEach((camp) => { camp.spawnCooldown = Math.max(0, (camp.spawnCooldown || 0) - dt); });
    unit.attackCooldown = Math.max(0, unit.attackCooldown - dt);
    unit.attackFlash = Math.max(0, unit.attackFlash - dt * 2.2);
    unit.hitFlash = Math.max(0, unit.hitFlash - dt * 3.4);

    let targetPos = null;
    let moved = false;
    let attackTarget = null;

    if (unit.hostile) {
      const { best: defender, bestD } = nearestTarget(unit, state, (u) => !u.hostile && u.type !== 'worker', unit.range > 2 ? 9 : 6.5);
      if (defender) {
        targetPos = defender.pos;
        attackTarget = defender;
        if (bestD <= unit.range + .25 && unit.attackCooldown <= 0) attackUnit(sceneCtx, state, unit, defender);
      } else if (capitalTile) {
        targetPos = capitalTile.pos;
        if (dist2(unit.pos, capitalTile.pos) <= unit.range + 1.4) damageNearestBuilding(sceneCtx, state, unit, notify);
      }
    } else if (unit.type === 'worker') {
      const assignedBuilding = state.buildings.find((b) => b.id === unit.assignedBuildingId);
      const capitalPos = capitalTile ? capitalTile.pos.clone() : unit.pos.clone();
      if (!assignedBuilding) {
        targetPos = capitalPos;
      } else if (assignedBuilding.type === 'farm') {
        const node = workerTaskTarget(unit, state, capitalTile);
        targetPos = node;
        if (node && unit.pos.distanceTo(node) < 0.3) {
          unit.gatherCooldown -= dt;
          if (unit.gatherCooldown <= 0) {
            unit.gatherCooldown = 1.4;
            state.resources.food += computeBuildingReturn(assignedBuilding);
          }
          targetPos = null;
        }
      } else {
        targetPos = unit.taskPhase === 'toBuilding' ? workerTaskTarget(unit, state, capitalTile) : capitalPos;
        if (targetPos && unit.pos.distanceTo(targetPos) < 0.34) {
          if (unit.taskPhase === 'toBuilding') {
            unit.taskPhase = 'toCapital';
          } else {
            state.resources[assignedBuilding.type === 'mine' ? 'stone' : 'wood'] += computeBuildingReturn(assignedBuilding);
            if (assignedBuilding.type === 'mine') state.resources.gold += assignedBuilding.level >= 2 ? 0.2 : 0;
            unit.taskPhase = 'toBuilding';
          }
          targetPos = null;
        }
      }
    } else {
      const { best: camp, bestD: campD } = nearestEnemyCamp(unit, state, unit.range > 2 ? 9 : 7);
      const { best: enemy, bestD } = nearestTarget(unit, state, (u) => u.hostile, unit.range > 2 ? 10 : 8);
      if (enemy) {
        targetPos = enemy.pos;
        attackTarget = enemy;
        if (bestD <= unit.range + .25 && unit.attackCooldown <= 0) attackUnit(sceneCtx, state, unit, enemy);
      } else if (camp) {
        targetPos = camp.pos;
        if (campD <= Math.max(1.4, unit.range + 0.7) && unit.attackCooldown <= 0) damageEnemyCamp(sceneCtx, state, unit, camp, notify);
      } else {
        targetPos = patrolTargetFor(unit, state, capitalTile);
      }
    }

    if (targetPos) {
      const dir = new THREE.Vector3().subVectors(targetPos, unit.pos);
      dir.y = 0;
      const len = dir.length();
      const stopDistance = attackTarget ? Math.max(unit.range * 0.92, 0.36) : 0.16;
      if (len > stopDistance) {
        dir.normalize();
        unit.pos.addScaledVector(dir, unit.speed * dt);
        moved = true;
        unit.stepPhase += dt * unit.speed * vis.bobSpeed;
      }
      if (len > 0.03) {
        const faceDir = attackTarget ? new THREE.Vector3().subVectors(attackTarget.pos, unit.pos) : dir;
        const desiredYaw = Math.atan2(faceDir.x, faceDir.z) + (unit.mesh.userData.facingOffset || 0);
        let deltaYaw = desiredYaw - unit.mesh.rotation.y;
        while (deltaYaw > Math.PI) deltaYaw -= Math.PI * 2;
        while (deltaYaw < -Math.PI) deltaYaw += Math.PI * 2;
        unit.mesh.rotation.y += deltaYaw * Math.min(1, dt * 12);
      }
    }

    keepAwayFromBuildings(unit, state);
    unit.baseY = getTerrainY(unit.pos.x, unit.pos.z);
    unit.mesh.position.set(unit.pos.x, unit.baseY + .02, unit.pos.z);
    const ringOpacity = unit.hostile ? .38 : .28;
    unit.mesh.userData.ring.material.opacity = ringOpacity + unit.attackFlash * .4 + unit.hitFlash * .3;
    unit.mesh.userData.ring.material.color.setHex(unit.hostile ? 0xff7c63 : 0xffd66b);
    const body = unit.mesh.userData.body;
    if (body) {
      body.position.y = Math.sin(unit.stepPhase) * vis.bounce;
      body.rotation.z = Math.sin(unit.stepPhase * .5) * vis.lean;
      body.material.opacity = .001 + unit.attackFlash * .02 + unit.hitFlash * .04;
    }

    if (unit.mesh.userData.mixer) {
      unit.mesh.userData.mixer.update(dt);
      if (!unit.attackFlash && !unit.hitFlash) setAnimationState(unit.mesh, moved ? 'walk' : 'idle');
    }

    if (unit.hitFlash > 0 && unit.mesh.userData.animActions?.hit) playOneShot(unit.mesh, 'hit');
    if (unit.hp <= 0) cleanupDeadUnit(sceneCtx, state, unit, i);
  }
}

export function autoSpawnWorkers(sceneCtx, state, dt, notify) {
  dt = Math.min(dt, 0.1);
  state.workerSpawnTimer += dt;
  const cap = state.resources.populationCap || 18;
  const spawnDelay = state.workerSpawnDelay || GAME_CONFIG.workerSpawnEvery || 22;
  if (state.workerSpawnTimer < spawnDelay) return;
  state.workerSpawnTimer = 0;
  if (state.resources.population >= cap) return;
  const totalWorkers = state.units.filter((u) => !u.dead && u.type === 'worker').length;
  const workerDemand = state.buildings.reduce((s, b) => s + getBuildingWorkerDemand(b), 0);
  if (totalWorkers >= workerDemand + 2) return;
  if (state.resources.food < 18 || state.resources.stability < 40) return;
  const capital = getCapital(state);
  if (!capital) return;
  const tile = state.mapIndex.get(capital.tileId);
  if (!tile) return;
  state.resources.population += 1;
  state.resources.food = Math.max(0, state.resources.food - 6);
  spawnUnit(sceneCtx, state, 'worker', new THREE.Vector3(tile.pos.x + (Math.random() - 0.5) * 1.2, tile.height, tile.pos.z + (Math.random() - 0.5) * 1.2), null);
  notify('В столице вырос новый рабочий для экономики');
}
