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
    priority: () => {
      cycleBuildingPriority(building);
      notify('Приоритет рабочих изменён');
      openTappedBuildingMenu(tile, building);
    },
    demolish: () => {
      if (!destroyBuilding(sceneCtx, state, building)) return;
      spawnCollapse(sceneCtx, building.pos.clone().setY(building.surfaceY + .5));
      state.roadsDirty = true;
      notify(`Постройка снесена: ${BUILDINGS[building.type].name}`);
      closeDrawer();
      state.selected = null;
      updateSelection(state);
    },
  });
}

function onTileSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  const building = tile.buildingId ? state.buildings.find((candidate) => candidate.id === tile.buildingId) : null;

  if (state.placementMode?.type === 'rally') {
    const source = getBuildingById(state, state.placementMode.buildingId);
    if (source && tile.type !== 'water') {
      source.rallyPos = tile.pos.clone();
      notify(`Точка сбора назначена: ${BUILDINGS[source.type].name}`);
    }
    state.placementMode = null;
    updateCommandBanner();
    return;
  }

  if (state.placementMode?.type === 'unit-command') {
    if (tile.type === 'water') return notify('Юниты не могут пройти по глубокой воде');
    issueFormationOrder(tile.pos);
    state.placementMode = null;
    updateCommandBanner();
    updateSelection(state);
    return;
  }

  if (state.selectedBuildType) tryPlaceBuilding(tile);
  else if (building) openTappedBuildingMenu(tile, building);
  updateSelection(state);
}

function onTileDoubleSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  const building = tile.buildingId ? state.buildings.find((candidate) => candidate.id === tile.buildingId) : null;
  if (building) {
    openTappedBuildingMenu(tile, building);
    updateSelection(state);
    return;
  }
  const terrain = sampleTerrain(state, tile.pos.x, tile.pos.z);
  if (!isTileInsideTerritory(state, tile.pos.x, tile.pos.z) || terrain.type === 'water') {
    notify('Земля вне владений или скрыта глубокой водой');
    return;
  }
  if (state.lastQuickBuildType && canPlaceBuilding(state, state.lastQuickBuildType, tile.pos.x, tile.pos.z)) {
    tryPlaceBuilding(tile, state.lastQuickBuildType);
    return;
  }
  openQuickBuildMenu(state, tile, (type) => tryPlaceBuilding(tile, type));
  updateSelection(state);
}

function onUnitSelected(unit, event = null) {
  state.selected = { kind: 'unit', ref: unit };
  state.selectedUnits = unit.hostile ? [] : [unit];
  state.placementMode = null;
  updateCommandBanner();
  if (!unit.hostile) openUnitActionMenu(unit, event);
  highlightSelection();
  updateSelection(state);
}

function onResourceSelected(resource) {
  state.selected = { kind: 'resource', ref: resource };
  closeUnitActionMenu();
  updateSelection(state);
  openDrawer(
    resource.kind === 'tree' ? 'Лесной ресурс' : resource.isGold ? 'Золотоносная порода' : 'Каменный ресурс',
    `Осталось ${Math.round(resource.hp)} из ${resource.maxHp}`,
    `<div class="list-item">${resource.kind === 'tree' ? 'Постройте лесопилку поблизости: назначенный рабочий будет рубить дерево и доставлять древесину.' : 'Постройте шахту на холме или скале: рабочий будет добывать камень и золото.'}</div>`,
  );
}

function onCampSelected(camp) {
  state.selected = { kind: 'camp', ref: camp };
  state.placementMode = null;
  closeUnitActionMenu();
  updateCommandBanner();
  updateSelection(state);
  const garrison = state.units.filter((unit) => unit.hostile && !unit.dead && unit.homeCampId === camp.id).length;
  openDrawer(
    campFactionLabel(camp),
    `Вражеский лагерь • HP ${Math.round(camp.hp)} / ${Math.round(camp.maxHp)}`,
    `<div class="list-item"><strong>Гарнизон:</strong> ${garrison}<br><strong>Запасы:</strong> пища ${Math.round(camp.stock?.food || 0)} • металл ${Math.round(camp.stock?.metal || 0)}<br>Лагерь снабжает набеги и восстанавливает гарнизон. Его уничтожение ослабит угрозу и принесёт золото.</div><button class="card-btn" data-camp-action="attack"><strong>⚔️ Направить армию</strong><small>Все свободные воины атакуют этот лагерь</small></button>`,
  );
  const attackButton = document.querySelector('[data-camp-action="attack"]');
  if (attackButton) attackButton.onclick = () => {
    state.selectedUnits = state.units.filter((unit) => !unit.hostile && unit.type !== 'worker' && !unit.dead);
    if (!state.selectedUnits.length) return notify('Сначала обучите воинов в столице или казармах');
    issueFormationOrder(camp.pos);
    closeDrawer();
  };
}

function issueFormationOrder(point) {
  const units = state.selectedUnits.filter((unit) => !unit.dead && !unit.hostile);
  const columns = Math.ceil(Math.sqrt(units.length));
  units.forEach((unit, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = point.x + (column - (columns - 1) / 2) * .8;
    const z = point.z + (row - (Math.ceil(units.length / columns) - 1) / 2) * .8;
    const target = findNearestWalkable(state, x, z, 5) || point.clone();
    unit.manualTarget = target.clone();
    unit.commandTarget = target.clone();
    unit.patrolCenter = target.clone();
    unit.path = [];
    unit.pathDestinationKey = null;
    unit.forceJob = false;
    unit.mode = 'move';
  });
  if (units.length) notify(units.length === 1 ? 'Юнит получил приказ' : `Отряд (${units.length}) движется строем`);
}

function highlightSelection() {
  state.buildings.forEach((building) => { if (building.selection) building.selection.material.opacity = 0; });
  if (state.selected?.kind !== 'tile') return;
  const building = getBuildingOnTile(state, state.selected.ref);
  if (building?.selection) building.selection.material.opacity = .7;
}

function ensureUnitActionMenu() {
  let menu = document.getElementById('unit-action-menu');
  if (menu) return menu;
  menu = document.createElement('div');
  menu.id = 'unit-action-menu';
  menu.className = 'glass-panel';
  menu.innerHTML = `
    <div class="panel-title">Команды юнита</div>
    <button class="card-btn" data-unit-action="move"><strong>📍 Двигаться / охранять</strong></button>
    <button class="card-btn" data-unit-action="work"><strong>🧑‍🌾 Найти работу</strong></button>
  `;
  $('#ui-root').appendChild(menu);
  menu.querySelector('[data-unit-action="move"]').onclick = () => {
    const unit = state.selected?.ref;
    if (!unit || unit.hostile) return;
    state.selectedUnits = [unit];
    state.placementMode = { type: 'unit-command' };
    updateCommandBanner('Выберите точку движения или охраны');
    closeUnitActionMenu();
    updateSelection(state);
  };
  menu.querySelector('[data-unit-action="work"]').onclick = () => {
    const unit = state.selected?.ref;
    if (!unit || unit.hostile || unit.type !== 'worker') return notify('Эта команда доступна только рабочему');
    unit.assignedBuildingId = null;
    unit.forceJob = true;
    unit.manualTarget = null;
    unit.commandTarget = null;
    unit.resourceTargetId = null;
    notify('Рабочий ищет свободное место с учётом приоритетов');
    closeUnitActionMenu();
  };
  document.addEventListener('pointerdown', (event) => {
    if (event.target.closest('#unit-action-menu')) return;
    closeUnitActionMenu();
  });
  return menu;
}

function openUnitActionMenu(unit, event) {
  const menu = ensureUnitActionMenu();
  const workButton = menu.querySelector('[data-unit-action="work"]');
  workButton.style.display = unit.type === 'worker' ? '' : 'none';
  const x = event?.clientX ?? window.innerWidth * .5;
  const y = event?.clientY ?? window.innerHeight * .55;
  menu.style.left = `${Math.min(window.innerWidth - 230, Math.max(8, x - 24))}px`;
  menu.style.top = `${Math.min(window.innerHeight - 175, Math.max(110, y - 18))}px`;
  menu.classList.add('visible');
}

function closeUnitActionMenu() {
  document.getElementById('unit-action-menu')?.classList.remove('visible');
}

function hookButtons() {
  $$('[data-action]').forEach((button) => { button.onclick = () => handleAction(button.dataset.action); });
  $$('[data-speed]').forEach((button) => {
    button.onclick = () => setSimulationSpeed(Number(button.dataset.speed));
  });
  updateSpeedButtons();
}

function handleAction(action) {
  if (action === 'focus-capital') focusCapital();
  if (action === 'build-menu') {
    openBuildMenu(state, (type) => {
      state.selectedBuildType = type;
      state.placementMode = { type: 'building', buildingType: type };
      closeDrawer();
      showGhost(type);
      updateCommandBanner(`Выберите место: ${BUILDINGS[type].name}`);
    });
  }
  if (action === 'train-menu') {
    openTrainMenu(state, () => {});
    bindTrainButtons();
  }
  if (action === 'research-menu') openResearchMenu(state, notify);
  if (action === 'select-all-army') {
    state.selectedUnits = state.units.filter((unit) => !unit.hostile && unit.type !== 'worker' && !unit.dead);
    state.placementMode = state.selectedUnits.length ? { type: 'unit-command' } : null;
    if (state.selectedUnits.length) updateCommandBanner(`Выбрана армия: ${state.selectedUnits.length}. Укажите точку.`);
    else notify('В державе пока нет воинов');
  }
  if (action === 'game-menu') showGameMenu();
  if (action === 'cancel-mode') cancelPlacementMode();
}

function focusCapital() {
  const capital = getBuildingById(state, state.capitalId);
  if (!capital) return;
  const y = capital.surfaceY || 0;
  sceneCtx.controls.target.set(capital.pos.x, y, capital.pos.z);
  const distance = window.innerWidth < 700 ? 18 : 24;
  sceneCtx.camera.position.set(capital.pos.x + distance * .72, y + distance * .82, capital.pos.z + distance * .64);
  closeDrawer();
}

function bindTrainButtons() {
  $$('[data-unit-type]').forEach((button) => {
    button.onclick = () => {
      const building = getBuildingById(state, button.dataset.trainBuilding);
      const unitType = button.dataset.unitType;
      const unit = UNITS[unitType];
      if (!building || !unit) return;
      if (state.era < (unit.minEra ?? 0)) return notify('Тип войск ещё не открыт этой эпохой');
      const queuedPopulation = state.buildings.reduce((sum, item) => sum + (item.trainQueue?.length || 0), 0);
      if (state.resources.population + queuedPopulation >= state.resources.populationCap) return notify('Нет места для новых жителей: улучшите столицу или амбар');
      if (!hasCost(state.resources, unit.cost)) return notify('Недостаточно ресурсов на обучение');
      payCost(state.resources, unit.cost);
      queueTraining(building, unitType);
      notify(`Добавлен в очередь: ${unit.name}`);
      updateHud(state);
      openTrainMenu(state, () => {});
      bindTrainButtons();
    };
  });
}

function setSimulationSpeed(speed) {
  if (speed === 0) {
    if (state.timeScale > 0) lastKnownSpeed = state.timeScale;
    state.paused = true;
    state.timeScale = 0;
  } else {
    lastKnownSpeed = speed;
    state.timeScale = speed;
    state.paused = false;
  }
  updateSpeedButtons();
}

function updateSpeedButtons() {
  $$('[data-speed]').forEach((button) => {
    const speed = Number(button.dataset.speed);
    button.classList.toggle('active', state.paused ? speed === 0 : speed === state.timeScale);
  });
}

function updateCommandBanner(message = '') {
  const banner = $('#command-banner');
  const mode = state.selectedBuildType || state.placementMode;
  if (!mode) {
    banner.classList.add('hidden');
    return;
  }
  $('#command-text').textContent = message || (state.selectedBuildType ? `Разместите: ${BUILDINGS[state.selectedBuildType].name}` : 'Выберите точку');
  banner.classList.remove('hidden');
}

function cancelPlacementMode(showNotice = true) {
  state.selectedBuildType = null;
  state.placementMode = null;
  removeGhost();
  updateCommandBanner();
  if (showNotice) notify('Режим команды отменён');
}

async function showGhost(type) {
  removeGhost();
  const group = new THREE.Group();
  const fallback = new THREE.Mesh(new THREE.CylinderGeometry(1.12, 1.12, .12, 16), new THREE.MeshBasicMaterial({ color: 0xb3ff84, transparent: true, opacity: .32 }));
  group.add(fallback);
  ghostMesh = group;
  sceneCtx.groups.ghosts.add(group);
  try {
    const model = await createGhostBuildingMesh(type);
    if (model && ghostMesh === group) group.add(model);
  } catch { /* the footprint remains available */ }
  sceneCtx.renderer.domElement.addEventListener('pointermove', pointerGhostMove);
}

function pointerGhostMove(event) {
  if (!ghostMesh || !state.selectedBuildType) return;
  const rect = sceneCtx.renderer.domElement.getBoundingClientRect();
  const pointer = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(pointer, sceneCtx.camera);
  const hit = raycaster.intersectObject(sceneCtx.groups.tiles, true).find((candidate) => candidate.object.name === 'terrain-mesh');
  if (!hit) return;
  ghostMesh.position.copy(hit.point);
  const valid = canPlaceBuilding(state, state.selectedBuildType, hit.point.x, hit.point.z);
  ghostMesh.traverse((object) => {
    if (!object.isMesh || !object.material) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    materials.forEach((material) => material.color?.setHex(valid ? 0xb3ff84 : 0xff786b));
  });
}

function removeGhost() {
  if (!ghostMesh) return;
  sceneCtx.groups.ghosts.remove(ghostMesh);
  ghostMesh = null;
  sceneCtx.renderer.domElement.removeEventListener('pointermove', pointerGhostMove);
}

function showPrologue() {
  openModal(
    'Клятва Великой Реки',
    CAMPAIGN_CHAPTERS[0].name,
    `<p>Поселенцы нашли долину, где река кормит поля, лес даёт древесину, а восточные холмы скрывают камень. Но по окраинам уже горят костры вражеских лагерей.</p><p><strong>Первая задача:</strong> наладьте три промысла, запасите пищу и увеличьте поселение. Дальнейшие главы откроются последовательно.</p>`,
    [{ label: 'Принять клятву', primary: true, onClick: closeModal }, { label: 'Как играть', onClick: showRules }],
  );
}

function showContinueMessage() {
  const chapter = CAMPAIGN_CHAPTERS[state.campaign.chapter] || CAMPAIGN_CHAPTERS[0];
  openModal(
    'Держава восстановлена',
    chapter.name,
    `<p>Сохранение загружено. Мир, постройки, очереди, рабочие назначения, лагеря и ход кампании восстановлены.</p><p>${chapter.desc}</p>`,
    [{ label: 'Продолжить', primary: true, onClick: closeModal }, { label: 'Новая кампания', onClick: confirmNewGame }],
  );
}

function showRules() {
  openModal(
    'Совет правителю',
    'Управление и игровые системы',
    `<h3>Кампания</h3><p>Четыре главы ведут от первого хозяйства к финальному выбору: Чудо света или уничтожение всех лагерей. Текущие цели показаны слева на ПК и в меню на мобильном.</p><h3>Экономика</h3><p>Фермы производят пищу. Рабочие лесопилок и шахт ходят к конечным ресурсам и доставляют добычу. Рынки и порты усиливаются дорогами. Амбары увеличивают вместимость и население.</p><h3>Бой и NPC</h3><p>Воины охраняют точку приказа, сами замечают врагов и используют строй. Рабочие убегают от опасности. Вражеские лагеря копят припасы, держат гарнизон, совершают набеги и отступают для лечения.</p><h3>Управление</h3><p>Касание выбирает объект; перетаскивание двигает камеру; два пальца меняют масштаб и угол. На ПК используйте правую кнопку для вращения и колесо для масштаба. Миникарта переносит камеру.</p>`,
    [{ label: 'Понятно', primary: true, onClick: closeModal }],
  );
}

function showGameMenu() {
  const chapter = CAMPAIGN_CHAPTERS[state.campaign.chapter];
  openModal(
    'Меню державы',
    `${chapter?.name || 'Кампания'} • графика: ${sceneCtx.quality.name}`,
    `<p>${chapter?.desc || ''}</p><p>Автосохранение выполняется каждые ${GAME_CONFIG.autosaveEvery} секунд и при сворачивании вкладки.</p>`,
    [
      { label: 'Продолжить', primary: true, onClick: closeModal },
      { label: 'Сохранить сейчас', onClick: () => { notify(saveGame(state) ? 'Игра сохранена' : 'Не удалось сохранить игру'); closeModal(); } },
      { label: 'Правила', onClick: showRules },
      { label: 'Новая кампания', onClick: confirmNewGame },
    ],
  );
}

function confirmNewGame() {
  openModal(
    'Начать заново?',
    'Текущее локальное сохранение будет удалено',
    '<p>Это действие нельзя отменить. Будет создана новая карта с другим расположением долины и ресурсов.</p>',
    [
      { label: 'Отмена', primary: true, onClick: showGameMenu },
      { label: 'Удалить и начать', onClick: () => { clearSave(); window.location.reload(); } },
    ],
  );
}

function processFinishedConstruction() {
  const done = collectFinishedConstruction(state);
  for (const job of done) {
    removeConstructionVisual(job);
    const entity = finishConstruction(sceneCtx, state, job);
    if (!entity) continue;
    notify(job.mode === 'upgrade' ? `Улучшено: ${BUILDINGS[entity.type].name}, уровень ${entity.level}` : `Построено: ${BUILDINGS[entity.type].name}`);
    state.roadsDirty = true;
  }
  if (done.length) {
    refreshConstructionOverlays();
    updateTerritoryOverlay(sceneCtx, state);
  }
}

function handleCampaignEvent(event) {
  event.completed.forEach((objective) => notify(`Цель выполнена: ${objective.title}`));
  if (event.chapterAdvanced) {
    const chapter = CAMPAIGN_CHAPTERS[state.campaign.chapter];
    openModal(`Открыта глава`, chapter.name, `<p>${chapter.desc}</p>`, [{ label: 'Продолжить', primary: true, onClick: closeModal }]);
  }
  if (event.victory && !state.gameEnded) {
    state.gameEnded = true;
    const peaceful = event.victory === 'wonder';
    openModal(
      peaceful ? 'Чудо Великой Реки' : 'Хозяин долины',
      peaceful ? 'Мирное наследие завершено' : 'Военное наследие завершено',
      `<p>${peaceful ? 'Народы долины признали величие Чуда, и караваны понесли славу державы за горизонт.' : 'Последний лагерь пал. Дороги долины безопасны, а границы державы больше некому оспаривать.'}</p><p>Победа достигнута. Игру можно продолжать без ограничения.</p>`,
      [{ label: 'Продолжить мир', primary: true, onClick: closeModal }],
    );
  }
}

function checkDefeat() {
  if (state.gameEnded) return;
  const capital = getCapital(state);
  if (capital && capital.hp > 0) return;
  state.gameEnded = true;
  setSimulationSpeed(0);
  openModal(
    'Держава пала',
    'Столица разрушена',
    '<p>Вражеский штурм уничтожил столицу. Начните новую кампанию или перезагрузите последнее сохранение.</p>',
    [{ label: 'Новая кампания', primary: true, onClick: confirmNewGame }],
  );
}

function stepSimulation(dt) {
  updateEnvironmentState(state, dt);
  applyRealTimeEconomy(state, dt);
  updateConstruction(state, dt);
  processFinishedConstruction();
  updateEra(state);
  const completedTech = updateResearch(state, dt);
  if (completedTech) notify('Исследование завершено');
  updateTraining(sceneCtx, state, dt, notify);
  updateDefense(sceneCtx, state, dt);
  updateUnits(sceneCtx, state, dt, notify);
  updateProjectiles(sceneCtx, state, dt);
  updateEnemyWaves(sceneCtx, state, dt, notify);
  updateResourceRegrowth(state);
  handleCampaignEvent(updateObjectives(state));

  if (state.resources.population >= state.territoryGrowthAt) {
    state.territoryGrowthAt += 7;
    state.territoryRadius += .85;
    updateTerritoryOverlay(sceneCtx, state);
    notify('Границы державы расширились вместе с населением');
  }
  autoSpawnWorkers(sceneCtx, state, dt, notify);
  if (state.seasonTime >= GAME_CONFIG.seasonDuration) {
    state.seasonTime = 0;
    const weather = maybeChangeWeather(state);
    notify(`Погода изменилась: ${WEATHER_TYPES[weather]?.name || weather}`);
  }
  if (state.roadsDirty) rebuildAndRenderRoads();
  spawnConstructionDust(dt);
  maybeAutoSave(dt);
  checkDefeat();
}

function maybeAutoSave(dt) {
  state.autosaveTimer += dt;
  if (state.autosaveTimer < GAME_CONFIG.autosaveEvery) return;
  state.autosaveTimer = 0;
  saveGame(state);
}

function updateDayNightVisual(dt) {
  const progress = (state.dayTime % GAME_CONFIG.dayDuration) / GAME_CONFIG.dayDuration;
  const angle = progress * Math.PI * 2 - Math.PI * .35;
  const daylight = clamp(Math.sin(angle) * .72 + .5, .08, 1);
  sceneCtx.sun.position.set(Math.cos(angle) * 42, 8 + Math.max(0, Math.sin(angle)) * 34, Math.sin(angle) * 22 - 8);
  const weatherLight = ({ clear: 1, rain: .78, mist: .72, dust: .7, snow: .82 })[state.weather] || 1;
  sceneCtx.sun.intensity = (.45 + daylight * 1.75) * weatherLight;
  sceneCtx.hemi.intensity = .65 + daylight * 1.15;
  sceneCtx.ambient.intensity = .45 + daylight * .55;
  sceneCtx.fill.intensity = .35 + daylight * .55;
  sceneCtx.stars.visible = daylight < .38;
  sceneCtx.sky.material.uniforms.topColor.value.setHex(daylight > .42 ? 0x9dd0ee : 0x26345c);
  sceneCtx.sky.material.uniforms.bottomColor.value.setHex(daylight > .42 ? 0xf3d3a0 : 0x6b3f2e);
  sceneCtx.scene.fog.color.setHex(daylight > .42 ? 0xb8cad0 : 0x312d3c);
  sceneCtx.cloudLayer.children.forEach((cloud, index) => {
    cloud.rotation.y += dt * cloud.userData.drift * .08;
    cloud.position.x += Math.sin(state.worldTime * .025 + index) * dt * .07;
    cloud.position.z += Math.cos(state.worldTime * .02 + index) * dt * .06;
  });
  state.buildings.forEach((building) => {
    if (building.glow) building.glow.intensity = (['capital', 'temple', 'tower'].includes(building.type) ? .85 : .35) + building.hitFlash * 1.4;
    building.hitFlash = Math.max(0, building.hitFlash - dt * 3.5);
    building.mesh.scale.setScalar(1 + building.hitFlash * .06);
  });
  state.enemyCamps.forEach((camp) => {
    camp.hitFlash = Math.max(0, (camp.hitFlash || 0) - dt * 3);
    const material = camp.mesh.userData.fallback?.material;
    if (material) material.emissive?.setHex(camp.hitFlash > 0 ? 0x7b1d14 : 0x000000);
  });
}

function spawnConstructionDust(dt) {
  constructionDustTimer += dt;
  const interval = sceneCtx.quality.name === 'mobile' ? .48 : .24;
  if (constructionDustTimer < interval || sceneCtx.effectBursts.length > 70) return;
  constructionDustTimer = 0;
  for (const job of state.construction.slice(0, sceneCtx.quality.name === 'mobile' ? 4 : 8)) {
    const dust = new THREE.Mesh(new THREE.SphereGeometry(.08, 4, 4), new THREE.MeshBasicMaterial({ color: 0xb79862, transparent: true, opacity: .4 }));
    const height = sampleTerrainHeight(state, job.x, job.z);
    dust.position.set(job.x + (Math.random() - .5) * .8, height + .35, job.z + (Math.random() - .5) * .8);
    sceneCtx.groups.effects.add(dust);
    sceneCtx.effectBursts.push({
      id: `dust-${performance.now()}-${Math.random()}`,
      mesh: dust,
      vel: new THREE.Vector3((Math.random() - .5) * .22, .32, (Math.random() - .5) * .22),
      life: .55,
      kind: 'burst',
    });
  }
}

function refreshConstructionOverlays() {
  const wrapper = $('#construction-overlays');
  if (!wrapper) return;
  wrapper.innerHTML = '';
  state.construction.forEach((job) => {
    const element = document.createElement('div');
    element.className = 'construction-timer';
    element.dataset.jobId = job.id;
    wrapper.appendChild(element);
  });
}

function updateConstructionOverlays() {
  const wrapper = $('#construction-overlays');
  if (!wrapper) return;
  if (wrapper.children.length !== state.construction.length) refreshConstructionOverlays();
  state.construction.forEach((job) => {
    const element = wrapper.querySelector(`[data-job-id="${job.id}"]`);
    if (!element) return;
    const point = new THREE.Vector3(job.x, sampleTerrainHeight(state, job.x, job.z) + 2.25, job.z).project(sceneCtx.camera);
    const x = (point.x * .5 + .5) * window.innerWidth;
    const y = (point.y * -.5 + .5) * window.innerHeight;
    const offscreen = point.z < -1 || point.z > 1 || x < -40 || x > window.innerWidth + 40 || y < -40 || y > window.innerHeight + 40;
    element.style.display = offscreen ? 'none' : 'block';
    element.style.transform = `translate(${x}px, ${y}px)`;
    element.textContent = `${Math.max(0, Math.ceil(job.buildTime - job.progress))}с`;
    if (job.mesh) job.mesh.rotation.y += .002;
  });
}

function ensureHealthElement(id) {
  const wrapper = $('#health-overlays');
  let element = wrapper.querySelector(`[data-health-id="${id}"]`);
  if (element) return element;
  element = document.createElement('div');
  element.className = 'health-bar';
  element.dataset.healthId = id;
  element.innerHTML = '<div class="health-caption"></div><div class="health-track"><div class="health-fill"></div></div>';
  wrapper.appendChild(element);
  return element;
}

function updateHealthOverlays() {
  const wrapper = $('#health-overlays');
  if (!wrapper) return;
  const active = new Set();
  const items = [
    ...state.buildings.map((building) => ({ id: `building-${building.id}`, hp: building.hp, maxHp: building.maxHp, pos: new THREE.Vector3(building.pos.x, building.surfaceY + 2.1, building.pos.z) })),
    ...state.units.map((unit) => ({ id: `unit-${unit.id}`, hp: unit.hp, maxHp: unit.maxHp, pos: unit.pos.clone().setY(unit.pos.y + 1.45) })),
    ...state.enemyCamps.map((camp) => ({ id: `camp-${camp.id}`, hp: camp.hp, maxHp: camp.maxHp, pos: camp.pos.clone().setY(camp.pos.y + 2.2) })),
  ].filter((item) => item.hp < item.maxHp && item.maxHp > 0).slice(0, 36);
  items.forEach((item) => {
    active.add(item.id);
    const element = ensureHealthElement(item.id);
    const ratio = clamp(item.hp / item.maxHp, 0, 1);
    const point = item.pos.clone().project(sceneCtx.camera);
    const x = (point.x * .5 + .5) * window.innerWidth;
    const y = (point.y * -.5 + .5) * window.innerHeight;
    const offscreen = point.z < -1 || point.z > 1 || x < -70 || x > window.innerWidth + 70 || y < -70 || y > window.innerHeight + 70;
    element.style.display = offscreen ? 'none' : 'block';
    element.style.transform = `translate(${x}px, ${y}px)`;
    element.querySelector('.health-fill').style.width = `${ratio * 100}%`;
    element.querySelector('.health-caption').textContent = `${Math.round(item.hp)} / ${Math.round(item.maxHp)}`;
    element.classList.toggle('low', ratio < .35);
  });
  wrapper.querySelectorAll('.health-bar').forEach((element) => {
    if (!active.has(element.dataset.healthId)) element.remove();
  });
}

function animate(now) {
  requestAnimationFrame(animate);
  const rawDt = Math.min(.1, Math.max(0, (now - lastTime) / 1000));
  lastTime = now;
  if (!state.paused && state.timeScale > 0) {
    logicAccumulator += rawDt * state.timeScale;
    let iterations = 0;
    while (logicAccumulator >= GAME_CONFIG.logicTick && iterations < 8) {
      stepSimulation(GAME_CONFIG.logicTick);
      logicAccumulator -= GAME_CONFIG.logicTick;
      iterations += 1;
    }
    if (iterations === 8) logicAccumulator = Math.min(logicAccumulator, GAME_CONFIG.logicTick * 2);
  }

  hudAccumulator += rawDt;
  minimapAccumulator += rawDt;
  overlayAccumulator += rawDt;
  if (hudAccumulator >= GAME_CONFIG.hudRefresh) {
    hudAccumulator = 0;
    updateHud(state);
    updateSelection(state);
  }
  if (minimapAccumulator >= GAME_CONFIG.minimapRefresh) {
    minimapAccumulator = 0;
    drawMinimap(state, sceneCtx);
  }
  if (overlayAccumulator >= .1) {
    overlayAccumulator = 0;
    updateConstructionOverlays();
    updateHealthOverlays();
  }
  updateDayNightVisual(rawDt * Math.max(state.timeScale || lastKnownSpeed, .25));
  updateTerrainVisuals(state, now);
  sceneCtx.controls.update();
  performanceGovernor.sample(rawDt);
  sceneCtx.render();
}

function hookLifecycle() {
  window.addEventListener('resize', () => {
    sceneCtx.resize();
    refreshConstructionOverlays();
  }, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) return;
    saveGame(state);
    if (!state.paused) {
      lastKnownSpeed = state.timeScale || 1;
      state.paused = true;
      state.timeScale = 0;
      updateSpeedButtons();
    }
  });
  window.addEventListener('beforeunload', () => saveGame(state));
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || window.location.protocol === 'file:') return;
  navigator.serviceWorker.register('./sw.js').catch((error) => console.warn('Service worker unavailable', error));
}

window.setTimeout(() => {
  if (!loadingReleased) emergencyRelease();
}, 12_000);

if (new URLSearchParams(window.location.search).has('debug')) {
  window.__EMPIRE_DEBUG__ = {
    state,
    sceneCtx,
    stepSimulation,
    tryPlaceBuilding,
    save: () => saveGame(state),
  };
}

bootstrap().catch(emergencyRelease);
