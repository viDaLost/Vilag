function syncViewportHeight() {
  const height = window.visualViewport ? window.visualViewport.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', `${Math.round(height)}px`);
}

syncViewportHeight();
window.addEventListener('resize', syncViewportHeight, { passive: true });
window.visualViewport?.addEventListener('resize', syncViewportHeight, { passive: true });

import * as THREE from 'three';
import { BUILDINGS, CAMPAIGN_CHAPTERS, GAME_CONFIG, UNITS, WEATHER_TYPES } from './config.js';
import { createInitialState } from './state.js';
import { createScene } from './core/scene.js';
import { createPerformanceGovernor, detectQualityProfile } from './core/performance.js';
import { coordinateRandom, findNearestWalkable, generateWorld, isTileInsideTerritory, sampleTerrain } from './systems/world.js';
import { sampleTerrainHeight, updateTerrainVisuals } from './systems/terrain.js';
import { populateDecorModels, renderTiles, setResourceVisible, updateResourceRegrowth, updateTerritoryOverlay } from './systems/renderWorld.js';
import { rebuildRoadNetwork, renderRoads } from './systems/roads.js';
import { setupHud, updateHud } from './ui/hud.js';
import { drawMinimap, setupMinimapInteraction } from './ui/minimap.js';
import { notify } from './ui/notifications.js';
import { bindDrawerClose, closeDrawer, openBuildingMenu, openBuildMenu, openDrawer, openQuickBuildMenu, openResearchMenu, openTrainMenu } from './ui/drawer.js';
import { closeModal, openModal, setupModal } from './ui/modal.js';
import { updateSelection } from './ui/selection.js';
import { setupInput } from './core/input.js';
import { canPlaceBuilding, cycleBuildingPriority, destroyBuilding, finishConstruction, getBuildingById, getBuildingOnTile, getCapital, hasCost, payCost, placeConstruction, repairBuilding, startUpgrade, createGhostBuildingMesh } from './systems/buildings.js';
import { applyRealTimeEconomy, collectFinishedConstruction, updateConstruction, updateEra, updateObjectives, updateResearch } from './systems/economy.js';
import { assignWorkerToBuilding, autoSpawnWorkers, queueTraining, releaseWorkerFromBuilding, spawnPointNearBuilding, spawnUnit, updateTraining, updateUnits } from './systems/units.js';
import { spawnCollapse, updateDefense, updateProjectiles } from './systems/combat.js';
import { campFactionLabel, maybeChangeWeather, seedCampGarrisons, updateEnemyWaves, updateEnvironmentState } from './systems/events.js';
import { applySaveToState, clearSave, loadGame, saveGame } from './systems/persistence.js';
import { $, $$ } from './ui/dom.js';
import { clamp } from './utils/helpers.js';
import { groundScene, loadDecorModel } from './core/assets.js';

const state = createInitialState();
const storedSave = loadGame();
const restored = storedSave ? applySaveToState(state, storedSave) : false;
const quality = detectQualityProfile(state.quality);
const sceneCtx = createScene(document.getElementById('game'), quality);
const performanceGovernor = createPerformanceGovernor(sceneCtx, quality);

let ghostMesh = null;
let lastTime = performance.now();
let logicAccumulator = 0;
let hudAccumulator = 0;
let minimapAccumulator = 0;
let overlayAccumulator = 0;
let constructionDustTimer = 0;
let animationStarted = false;
let loadingReleased = false;
let lastKnownSpeed = state.timeScale || 1;

function setLoading(percent, text) {
  const fill = $('#loading-fill');
  const label = $('#loading-text');
  if (fill) fill.style.width = `${percent}%`;
  if (label) label.textContent = text;
}

function releaseLoading() {
  if (loadingReleased) return;
  loadingReleased = true;
  $('#loading-screen').style.display = 'none';
  if (!animationStarted) {
    animationStarted = true;
    lastTime = performance.now();
    requestAnimationFrame(animate);
  }
  restored ? showContinueMessage() : showPrologue();
}

function emergencyRelease(error = null) {
  if (error) console.error('Bootstrap failed', error);
  setLoading(96, 'Мир запущен в безопасном режиме');
  releaseLoading();
  notify('Часть оформления отключена, игровая логика продолжает работать');
}

async function bootstrap() {
  setupHud();
  setupModal();
  bindDrawerClose();
  hookButtons();
  hookLifecycle();

  setLoading(12, 'Создание долины и речных бродов…');
  generateWorld(state);
  renderTiles(sceneCtx, state);

  setLoading(32, restored ? 'Восстановление державы…' : 'Основание поселения…');
  if (restored) restoreWorld(); else createNewWorld();

  setLoading(48, 'Прокладка дорог…');
  rebuildAndRenderRoads();

  setLoading(62, 'Размещение лесов и месторождений…');
  await populateDecorModels(sceneCtx, state);

  if (!state.units.some((unit) => unit.hostile) && state.enemyCamps.length) seedCampGarrisons(sceneCtx, state);

  setLoading(78, 'Подключение управления…');
  setupInput(sceneCtx, state, {
    onTile: onTileSelected,
    onTileDouble: onTileDoubleSelected,
    onUnit: onUnitSelected,
    onCamp: onCampSelected,
    onResource: onResourceSelected,
    onEmpty: () => {
      state.selected = null;
      closeUnitActionMenu();
      updateSelection(state);
    },
  });
  setupMinimapInteraction(state, sceneCtx);
  sceneCtx.resize();
  updateHud(state);
  updateSelection(state);
  drawMinimap(state, sceneCtx);
  refreshConstructionOverlays();

  setLoading(100, 'Долина готова');
  window.setTimeout(releaseLoading, 180);
  registerServiceWorker();
}

function createNewWorld() {
  createCapitalAndSettlement();
  spawnEnemyCamps();
}

function createCapitalAndSettlement() {
  const capital = finishConstruction(sceneCtx, state, { type: 'capital', x: 0, z: 0, mode: 'new', restoring: false });
  state.capitalId = capital.id;
  capital.level = 1;
  state.resources.population = 4;

  const starters = [
    ['farm', ['fertile', 'river', 'grass'], .25],
    ['lumber', ['forest', 'grass'], 2.25],
    ['mine', ['hill', 'rock'], 4.3],
  ];
  const buildings = [];
  for (const [type, allowed, preferredAngle] of starters) {
    const site = findStarterSite(type, allowed, preferredAngle);
    if (!site) continue;
    const building = finishConstruction(sceneCtx, state, { type, x: site.x, z: site.z, mode: 'new', restoring: false });
    buildings.push(building);
  }
  buildings.forEach((building, index) => {
    const spawnPos = spawnPointNearBuilding(state, building, index) || building.pos.clone();
    spawnUnit(sceneCtx, state, 'worker', spawnPos, null, {
      homeBuildingId: capital.id,
      assignedBuildingId: building.id,
      taskPhase: ['lumber', 'mine'].includes(building.type) ? 'toResource' : 'toBuilding',
    });
  });
}

function findStarterSite(type, allowedTypes, preferredAngle) {
  for (let radius = 6.4; radius <= 20; radius += 1.4) {
    for (let offset = 0; offset < 12; offset++) {
      const angle = preferredAngle + (offset % 2 ? -1 : 1) * Math.ceil(offset / 2) * Math.PI / 12;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const terrain = sampleTerrain(state, x, z);
      if (allowedTypes.includes(terrain.type) && canPlaceBuilding(state, type, x, z)) return { x, z };
    }
  }
  return null;
}

function restoreWorld() {
  const snapshot = state.restoreSnapshot;
  if (!snapshot?.buildings?.length) {
    state.restoreSnapshot = null;
    createNewWorld();
    return;
  }

  for (const saved of snapshot.buildings) {
    const position = saved.pos || saved;
    const building = finishConstruction(sceneCtx, state, {
      type: saved.type,
      x: position.x,
      z: position.z,
      mode: 'new',
      restoring: true,
      savedId: saved.id,
      savedLevel: saved.level,
      savedHp: saved.hp,
      savedMaxHp: saved.maxHp,
      savedTrainQueue: saved.trainQueue,
      savedRallyPos: saved.rallyPos,
      savedPriority: saved.priority,
    });
    if (building?.type === 'capital') state.capitalId = building.id;
  }

  for (const saved of snapshot.enemyCamps || []) createCampFromSnapshot(saved);
  for (const saved of snapshot.units || []) {
    const position = saved.pos || saved;
    spawnUnit(sceneCtx, state, saved.type, position, null, {
      id: saved.id,
      hp: saved.hp,
      maxHp: saved.maxHp,
      homeBuildingId: saved.homeBuildingId,
      homeCampId: saved.homeCampId,
      assignedBuildingId: saved.assignedBuildingId,
      taskPhase: saved.taskPhase,
      carrying: saved.carrying,
      resourceTargetId: saved.resourceTargetId,
      commandTarget: saved.commandTarget,
      patrolCenter: saved.patrolCenter,
      guardPoint: saved.guardPoint,
      targetBuildingId: saved.targetBuildingId,
      aiRole: saved.aiRole,
    });
  }

  state.construction = (snapshot.construction || []).map((saved) => {
    const building = saved.buildingId ? getBuildingById(state, saved.buildingId) : null;
    const job = {
      ...saved,
      x: Number.isFinite(saved.x) ? saved.x : building?.pos.x || 0,
      z: Number.isFinite(saved.z) ? saved.z : building?.pos.z || 0,
      buildTime: saved.buildTime || BUILDINGS[saved.type]?.baseBuildTime || 12,
    };
    if (building && job.mode === 'upgrade') building.upgrading = true;
    attachConstructionVisual(job);
    return job;
  });
  state.restoreSnapshot = null;
}

function makeCampMesh(x, z, faction) {
  const group = new THREE.Group();
  const baseY = sampleTerrainHeight(state, x, z);
  group.position.set(x, baseY, z);
  const color = faction === 'iron' ? 0x606670 : faction === 'beasts' ? 0x5c3c18 : 0x7a2218;
  const fallback = new THREE.Mesh(new THREE.CylinderGeometry(.82, 1.05, .48, 7), new THREE.MeshStandardMaterial({ color, roughness: 1 }));
  fallback.position.y = .24;
  fallback.castShadow = sceneCtx.quality.shadows;
  fallback.receiveShadow = true;
  group.add(fallback);
  group.userData.fallback = fallback;
  const filename = faction === 'iron' ? 'small-watch-tower.glb' : faction === 'beasts' ? 'wooden-encampment.glb' : 'hut.glb';
  loadDecorModel(filename).then((model) => {
    model.scale.setScalar(faction === 'iron' ? .92 : .86);
    groundScene(model, .02);
    group.add(model);
  }).catch(() => {});
  return group;
}

function createCampFromSnapshot(saved) {
  const position = saved.pos || saved;
  const faction = saved.faction || 'clans';
  const mesh = makeCampMesh(position.x, position.z, faction);
  const maxHp = saved.maxHp || 130 + (faction === 'iron' ? 30 : 0);
  const camp = {
    id: saved.id || `camp-${state.enemyCamps.length + 1}`,
    faction,
    hp: saved.hp ?? maxHp,
    maxHp,
    pos: mesh.position.clone(),
    mesh,
    level: saved.level || 1,
    stock: { food: 34, metal: 20, ...(saved.stock || {}) },
    lastRaidAt: saved.lastRaidAt || 0,
    alert: 0,
    hitFlash: 0,
  };
  mesh.userData.campId = camp.id;
  sceneCtx.groups.enemyCamps.add(mesh);
  state.enemyCamps.push(camp);
  return camp;
}

function spawnEnemyCamps() {
  const factions = ['clans', 'iron', 'beasts', 'clans'];
  for (let index = 0; index < GAME_CONFIG.enemyCampCount; index++) {
    const baseAngle = index / GAME_CONFIG.enemyCampCount * Math.PI * 2 + coordinateRandom(index, state.worldSeed, 17) * .45;
    let site = null;
    for (let attempt = 0; attempt < 32; attempt++) {
      const angle = baseAngle + (attempt - 16) * .045;
      const radius = 36 + coordinateRandom(index, attempt, state.worldSeed * .001) * 11;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      const terrain = sampleTerrain(state, x, z);
      if (!['water', 'river'].includes(terrain.type)) { site = { x, z }; break; }
    }
    if (site) createCampFromSnapshot({ id: `camp-${index + 1}`, faction: factions[index % factions.length], pos: site });
  }
}

function rebuildAndRenderRoads() {
  rebuildRoadNetwork(state);
  renderRoads(sceneCtx, state);
  state.roadsDirty = false;
}

function attachConstructionVisual(job) {
  if (job.mesh) return;
  const group = new THREE.Group();
  const foundation = new THREE.Mesh(
    new THREE.CylinderGeometry(1.02, 1.08, .13, 16),
    new THREE.MeshStandardMaterial({ color: 0xb58b52, transparent: true, opacity: .72, roughness: 1 }),
  );
  foundation.position.y = .07;
  group.add(foundation);
  const poleGeometry = new THREE.CylinderGeometry(.035, .05, 1.25, 5);
  const poleMaterial = new THREE.MeshStandardMaterial({ color: 0x74502f, roughness: 1 });
  [[-.65, -.65], [.65, -.65], [-.65, .65], [.65, .65]].forEach(([x, z]) => {
    const pole = new THREE.Mesh(poleGeometry, poleMaterial);
    pole.position.set(x, .62, z);
    group.add(pole);
  });
  group.position.set(job.x, sampleTerrainHeight(state, job.x, job.z), job.z);
  group.userData.constructionId = job.id;
  sceneCtx.groups.ghosts.add(group);
  job.mesh = group;
}

function removeConstructionVisual(job) {
  if (!job.mesh) return;
  sceneCtx.groups.ghosts.remove(job.mesh);
  job.mesh.traverse((object) => {
    object.geometry?.dispose?.();
    object.material?.dispose?.();
  });
  job.mesh = null;
}

function clearResourcesAt(x, z, radius = 1.4) {
  for (const resource of [...state.trees, ...state.rocks]) {
    if (resource.hp <= 0 || Math.hypot(resource.x - x, resource.z - z) > radius) continue;
    resource.hp = 0;
    resource.depletedUntil = state.worldTime + GAME_CONFIG.resourceRegrowTime;
    setResourceVisible(resource, false);
  }
}

function tryPlaceBuilding(tile, forcedType = null) {
  if (!tile?.pos) return null;
  const type = forcedType || state.selectedBuildType;
  if (!type) return null;
  const x = tile.pos.x;
  const z = tile.pos.z;
  if (!canPlaceBuilding(state, type, x, z)) {
    notify('Место занято, слишком круто или не подходит этому типу здания');
    return null;
  }
  const config = BUILDINGS[type];
  if (!hasCost(state.resources, config.cost)) {
    notify('Недостаточно ресурсов для строительства');
    return null;
  }
  payCost(state.resources, config.cost);
  clearResourcesAt(x, z);
  const job = placeConstruction(state, type, x, z);
  attachConstructionVisual(job);
  state.lastQuickBuildType = type;
  notify(`Начато строительство: ${config.name}`);
  cancelPlacementMode(false);
  closeDrawer();
  updateHud(state);
  refreshConstructionOverlays();
  return job;
}

function openTappedBuildingMenu(tile, building) {
  openBuildingMenu(state, building, tile, {
    upgrade: () => {
      const job = startUpgrade(state, building);
      if (!job) return notify('Не хватает ресурсов, достигнут максимум или улучшение уже идёт');
      attachConstructionVisual(job);
      notify(`Начато улучшение: ${BUILDINGS[building.type].name}`);
      updateHud(state);
      openTappedBuildingMenu(tile, building);
      refreshConstructionOverlays();
    },
    train: () => {
      openTrainMenu(state, () => {});
      bindTrainButtons();
    },
    repair: () => {
      const ok = repairBuilding(state, building);
      notify(ok ? 'Постройка укреплена' : 'Недостаточно ресурсов на ремонт');
      updateHud(state);
      openTappedBuildingMenu(tile, building);
    },
    rally: () => {
      state.placementMode = { type: 'rally', buildingId: building.id };
      closeDrawer();
      updateCommandBanner('Выберите точку сбора и патрулирования');
    },
    assign: () => {
      const workers = state.units
        .filter((unit) => unit.type === 'worker' && !unit.dead && !unit.assignedBuildingId)
        .sort((a, b) => a.pos.distanceToSquared(building.pos) - b.pos.distanceToSquared(building.pos));
      const ok = assignWorkerToBuilding(state, workers[0], building);
      notify(ok ? 'Рабочий направлен к зданию' : 'Нет свободного рабочего или все места заняты');
      openTappedBuildingMenu(tile, building);
    },
    release: () => {
      const ok = releaseWorkerFromBuilding(state, building);
      notify(ok ? 'Рабочий освобождён' : 'В здании нет назначенных рабочих');
      openTappedBuildingMenu(tile, building);
    },
    priority: () => 