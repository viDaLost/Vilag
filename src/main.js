import * as THREE from 'three';
import { GAME_CONFIG, BUILDINGS, UNITS } from './config.js';
import { createInitialState } from './state.js';
import { createScene } from './core/scene.js';
import { generateWorld, getNeighbors, isTileInsideTerritory } from './systems/world.js';
import { renderTiles, renderRoads, clearDecorOnTile } from './systems/renderWorld.js';
import { setupHud, updateHud } from './ui/hud.js';
import { drawMinimap } from './ui/minimap.js';
import { notify } from './ui/notifications.js';
import { openBuildMenu, openQuickBuildMenu, openResearchMenu, openTrainMenu, bindDrawerClose, closeDrawer, openBuildingMenu } from './ui/drawer.js';
import { setupModal, openModal, closeModal } from './ui/modal.js';
import { updateSelection } from './ui/selection.js';
import { setupInput } from './core/input.js';
import { canPlaceBuilding, hasCost, payCost, placeConstruction, finishConstruction, getBuildingById, getBuildingOnTile, getCapital, startUpgrade, repairBuilding, destroyBuilding } from './systems/buildings.js';
import { applyRealTimeEconomy, updateConstruction, collectFinishedConstruction, updateEra, updateObjectives, updateResearch } from './systems/economy.js';
import { autoSpawnWorkers, queueTraining, updateTraining, updateUnits } from './systems/units.js';
import { updateDefense, updateProjectiles, spawnCollapse } from './systems/combat.js';
import { maybeChangeWeather, updateEnemyWaves, updateEnvironmentState } from './systems/events.js';
import { saveGame, clearSave } from './systems/persistence.js';
import { $, $$ } from './ui/dom.js';
import { clamp } from './utils/helpers.js';

const state = createInitialState();
const sceneCtx = createScene(document.getElementById('game'));
let ghostMesh = null;
let lastTime = performance.now();
let constructionDustTimer = 0;

function setLoading(percent, text) {
  $('#loading-fill').style.width = `${percent}%`;
  $('#loading-text').textContent = text;
}

async function bootstrap() {
  setupHud();
  setupModal();
  bindDrawerClose();
  hookButtons();

  setLoading(10, 'Генерация рельефа…');
  generateWorld(state);

  setLoading(30, 'Отрисовка земли и окружения…');
  renderTiles(sceneCtx, state);

  setLoading(48, 'Размещение столицы…');
  await spawnCapital();
  createRoadNetworkFromCapital();
  spawnEnemyCamps();
  renderRoads(sceneCtx, state);

  setLoading(66, 'Подготовка интерфейса…');
  updateHud(state);
  drawMinimap(state);
  updateSelection(state);

  setLoading(82, 'Подключение ввода…');
  setupInput(sceneCtx, state, {
    onTile: onTileSelected,
    onTileDouble: onTileDoubleSelected,
    onUnit: onUnitSelected,
    onEmpty: () => { state.selected = null; updateSelection(state); }
  });

  setLoading(100, 'Готово');
  setTimeout(() => {
    $('#loading-screen').style.display = 'none';
    state.timeScale = 1;
    setSpeedButton(1);
    showRules();
    animate();
  }, 260);

  addEventListener('resize', () => {
    sceneCtx.resize();
    drawMinimap(state);
    refreshConstructionOverlays();
  });
}

async function spawnCapital() {
  const center = state.map.filter((t) => t.type !== 'water').sort((a, b) => Math.hypot(a.pos.x, a.pos.z) - Math.hypot(b.pos.x, b.pos.z))[0];
  const job = { type: 'capital', tileId: center.id, progress: 0, buildTime: 0, mode: 'new' };
  const capital = await finishConstruction(sceneCtx, state, job);
  state.capitalId = capital.id;
  center.buildingId = capital.id;
  state.resources.population = 12;
  state.resources.workers = 4;
  capital.level = 1;

  const neighbors = getNeighbors(state, center).filter((t) => t.type !== 'water');
  for (const tile of neighbors) {
    if (!canPlaceBuilding(state, 'wall', tile)) continue;
    const build = placeConstruction(state, 'wall', tile);
    build.progress = build.buildTime;
  }

  const outerRing = [];
  neighbors.forEach((n) => {
    getNeighbors(state, n).forEach((candidate) => {
      if (!candidate || candidate.id === center.id || candidate.buildingId || candidate.type === 'water') return;
      if (!outerRing.some((x) => x.id === candidate.id)) outerRing.push(candidate);
    });
  });

  const starter = [
    ['farm', outerRing.find((t) => ['grass', 'fertile', 'river'].includes(t.type) && !t.buildingId)],
    ['lumber', outerRing.find((t) => ['forest', 'grass'].includes(t.type) && !t.buildingId)],
    ['mine', outerRing.find((t) => ['hill', 'rock'].includes(t.type) && !t.buildingId)],
  ];
  for (const [type, tile] of starter) {
    if (!tile) continue;
    const build = placeConstruction(state, type, tile);
    build.progress = build.buildTime;
  }
  const completed = collectFinishedConstruction(state);
  for (const done of completed) await finishConstruction(sceneCtx, state, done);
}

function createRoadNetworkFromCapital() {
  const capital = getBuildingById(state, state.capitalId);
  if (!capital) return;
  const tile = state.mapIndex.get(capital.tileId);
  for (const neighbor of getNeighbors(state, tile)) {
    if (!neighbor || neighbor.type === 'water') continue;
    addRoad(tile.id, neighbor.id);
  }
}

function makeCampMesh(tile, faction) {
  const colors = { clans: 0x7a1711, iron: 0x666d76, beasts: 0x5c3c18 };
  const mesh = new THREE.Group();
  const matDark = new THREE.MeshStandardMaterial({ color: colors[faction] || 0x5a2118, roughness: 1 });
  const base = new THREE.Mesh(new THREE.CylinderGeometry(.76, .94, .42, 6), matDark);
  base.position.y = tile.height + .2;
  base.castShadow = true;
  const tent = new THREE.Mesh(new THREE.ConeGeometry(.54, 1.02, 4), new THREE.MeshStandardMaterial({ color: (colors[faction] || 0x3e1713) - 0x101010, roughness: 1 }));
  tent.position.y = tile.height + .82;
  const fire = new THREE.Mesh(new THREE.OctahedronGeometry(.19), new THREE.MeshStandardMaterial({ color: 0xff9345, emissive: 0xff7836, emissiveIntensity: 1.1 }));
  fire.position.y = tile.height + .48;
  mesh.add(base, tent, fire);
  if (faction === 'iron') {
    const anvil = new THREE.Mesh(new THREE.BoxGeometry(.26, .18, .22), new THREE.MeshStandardMaterial({ color: 0x979a9f, roughness: 1 }));
    anvil.position.set(.22, tile.height + .42, .16);
    mesh.add(anvil);
  } else if (faction === 'beasts') {
    const skull = new THREE.Mesh(new THREE.ConeGeometry(.15, .22, 5), new THREE.MeshStandardMaterial({ color: 0xd2c2a2, roughness: 1 }));
    skull.position.set(.24, tile.height + .58, .14);
    skull.rotation.z = Math.PI;
    mesh.add(skull);
  } else {
    const bannerPole = new THREE.Mesh(new THREE.CylinderGeometry(.025, .025, 1.3, 5), new THREE.MeshStandardMaterial({ color: 0x6d5330, roughness: 1 }));
    bannerPole.position.set(-.26, tile.height + .74, -.16);
    const banner = new THREE.Mesh(new THREE.PlaneGeometry(.32, .42), new THREE.MeshStandardMaterial({ color: colors[faction] || 0x7a1711, roughness: 1, side: THREE.DoubleSide }));
    banner.position.set(-.02, tile.height + 1.0, -.16);
    banner.rotation.y = .15;
    mesh.add(bannerPole, banner);
  }
  mesh.position.set(tile.pos.x, 0, tile.pos.z);
  return mesh;
}

function spawnEnemyCamps() {
  const farTiles = state.map.filter((t) => Math.hypot(t.pos.x, t.pos.z) > state.territoryRadius + 10 && t.type !== 'water');
  farTiles.sort(() => Math.random() - .5);
  const factions = ['clans', 'iron', 'beasts'];
  state.enemyCamps = farTiles.slice(0, GAME_CONFIG.enemyCampCount).map((tile, i) => {
    const faction = factions[i % factions.length];
    const mesh = makeCampMesh(tile, faction);
    sceneCtx.groups.enemyCamps.add(mesh);
    return { id: `camp-${i}`, tileId: tile.id, hp: 120 + (faction === 'iron' ? 30 : 0), pos: tile.pos.clone(), mesh, faction };
  });
}

function addRoad(aId, bId) {
  const key = [aId, bId].sort().join('|');
  if (state.roads.some((r) => r.key === key)) return false;
  state.roads.push({ key, a: aId, b: bId });
  state.resources.roads = state.roads.length;
  return true;
}

async function tryPlaceBuilding(tile, forcedType = null) {
  const type = forcedType || state.selectedBuildType;
  if (!type) return;
  if (!canPlaceBuilding(state, type, tile)) {
    notify('Эту постройку нельзя разместить на выбранной клетке');
    return;
  }
  const cfg = BUILDINGS[type];
  if (!hasCost(state.resources, cfg.cost)) {
    notify('Недостаточно ресурсов');
    return;
  }
  payCost(state.resources, cfg.cost);
  clearDecorOnTile(sceneCtx, tile);
  const job = placeConstruction(state, type, tile);
  state.lastQuickBuildType = type;
  notify(`Начато строительство: ${cfg.name}`);
  closeDrawer();
  state.selectedBuildType = null;
  removeGhost();
  updateHud(state);
  updateSelection(state);
  refreshConstructionOverlays();
  return job;
}

function openTappedBuildingMenu(tile, building) {
  openBuildingMenu(state, building, tile, {
    upgrade: () => {
      const job = startUpgrade(state, building);
      if (!job) return notify('Не хватает ресурсов или уже идёт улучшение');
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
    demolish: () => {
      destroyBuilding(sceneCtx, state, building);
      spawnCollapse(sceneCtx, tile.pos.clone().add(new THREE.Vector3(0, tile.height + .5, 0)));
      notify(`Постройка снесена: ${BUILDINGS[building.type].name}`);
      closeDrawer();
      updateHud(state);
      updateSelection(state);
      renderRoads(sceneCtx, state);
    },
  });
}

function onTileSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  const building = getBuildingOnTile(state, tile);
  if (state.selectedBuildType) {
    tryPlaceBuilding(tile);
  } else if (building) {
    openTappedBuildingMenu(tile, building);
    updateSelection(state);
  } else {
    updateSelection(state);
  }
}

function onTileDoubleSelected(tile) {
  state.selected = { kind: 'tile', ref: tile };
  highlightSelection();
  const building = getBuildingOnTile(state, tile);
  if (building) {
    openTappedBuildingMenu(tile, building);
    updateSelection(state);
    return;
  }
  if (!isTileInsideTerritory(state, tile) || tile.type === 'water') {
    notify('Эта сота пока не подходит для строительства');
    return;
  }
  if (state.lastQuickBuildType && canPlaceBuilding(state, state.lastQuickBuildType, tile)) {
    tryPlaceBuilding(tile, state.lastQuickBuildType);
    return;
  }
  openQuickBuildMenu(state, tile, (type) => tryPlaceBuilding(tile, type));
  updateSelection(state);
}

function onUnitSelected(unit) {
  state.selected = { kind: 'unit', ref: unit };
  highlightSelection();
  updateSelection(state);
}

function highlightSelection() {
  state.buildings.forEach((b) => { if (b.selection) b.selection.material.opacity = 0; });
  const sel = state.selected;
  if (sel?.kind === 'tile') {
    const building = getBuildingOnTile(state, sel.ref);
    if (building?.selection) building.selection.material.opacity = .65;
  }
}

function hookButtons() {
  $$('.speed-btn').forEach((btn) => {
    btn.onclick = () => {
      const speed = Number(btn.dataset.speed);
      if (speed === 0) {
        state.paused = true;
        state.timeScale = 0;
      } else {
        state.paused = false;
        state.timeScale = speed;
      }
      setSpeedButton(speed);
    };
  });

  $$('[data-action]').forEach((btn) => {
    btn.onclick = () => handleAction(btn.dataset.action);
  });
}

function setSpeedButton(speed) {
  $$('.speed-btn').forEach((btn) => btn.classList.toggle('active', Number(btn.dataset.speed) === speed));
}

function handleAction(action) {
  if (action === 'focus-capital') {
    const capital = getBuildingById(state, state.capitalId);
    if (!capital) return;
    const tile = state.mapIndex.get(capital.tileId);
    sceneCtx.controls.target.set(tile.pos.x, tile.height, tile.pos.z);
    sceneCtx.camera.position.set(tile.pos.x + 18, tile.height + 19, tile.pos.z + 14);
    closeDrawer();
  }
  if (action === 'build-menu') {
    openBuildMenu(state, (type) => {
      state.selectedBuildType = type;
      showGhost(type);
      notify(`Режим строительства: ${BUILDINGS[type].name}`);
    });
  }
  if (action === 'train-menu') {
    openTrainMenu(state, () => {});
    bindTrainButtons();
  }
  if (action === 'research-menu') {
    openResearchMenu(state, notify);
  }
  if (action === 'rules') {
    showRules();
  }
}

function bindTrainButtons() {
  document.querySelectorAll('[data-unit-type]').forEach((btn) => {
    btn.onclick = () => {
      const building = getBuildingById(state, btn.dataset.trainBuilding);
      const unitType = btn.dataset.unitType;
      if (!building || !unitType) return;
      const unit = UNITS[unitType];
      const ok = Object.entries(unit.cost).every(([k, v]) => (state.resources[k] || 0) >= v);
      if (!ok) return notify('Недостаточно ресурсов на обучение');
      Object.entries(unit.cost).forEach(([k, v]) => state.resources[k] -= v);
      queueTraining(building, unitType);
      notify(`В очереди: ${unit.name}`);
      updateHud(state);
      openTrainMenu(state, () => {});
      bindTrainButtons();
    };
  });
}

function showRules() {
  openModal(
    'Летопись правителя',
    'Веб-RTS с живым временем и двойным тапом по сотам',
    `
      <p><strong>Главная идея:</strong> ресурсы, строительство, обучение войск, враги, день и погода обновляются непрерывно. Кнопка хода заменена скоростью симуляции.</p>
      <p><strong>Управление на телефоне:</strong> один тап выбирает соту, юнита или здание. <strong>Двойной тап по пустой соте</strong> ставит последнюю постройку либо открывает нижнюю панель быстрой стройки. Тап вне окна теперь закрывает окна.</p>
      <p><strong>Подсказки стройки:</strong> над строящейся сотой появляется обратный отсчёт и пыль работ. Когда здание строится, декорации на этой соте убираются.</p>
      <p><strong>Смысл партии:</strong> расширяй границы, удерживай еду и порядок, развивай логистику дорог, обучай войска и переживай всё более сложные набеги разных фракций. Цель — провести державу от основания к золотому веку.</p>
    `,
    [
      { label: 'Начать', primary: true, onClick: closeModal },
      { label: 'Стереть сохранение', onClick: () => { clearSave(); closeModal(); notify('Локальное сохранение очищено'); } },
    ]
  );
}

function showGhost(type) {
  removeGhost();
  const geo = new THREE.CylinderGeometry(1.28, 1.28, .16, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffd66b, transparent: true, opacity: .28 });
  ghostMesh = new THREE.Mesh(geo, mat);
  ghostMesh.rotation.y = Math.PI / 6;
  sceneCtx.groups.ghosts.add(ghostMesh);
  sceneCtx.renderer.domElement.addEventListener('pointermove', pointerGhostMove);
}

function pointerGhostMove(e) {
  if (!ghostMesh) return;
  const rect = sceneCtx.renderer.domElement.getBoundingClientRect();
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
  raycaster.setFromCamera(pointer, sceneCtx.camera);
  const hits = raycaster.intersectObjects(sceneCtx.groups.tiles.children, false);
  if (!hits.length) return;
  const tile = state.map.find((t) => t.mesh === hits[0].object);
  if (!tile) return;
  ghostMesh.position.set(tile.pos.x, tile.height + .16, tile.pos.z);
  ghostMesh.material.color.set(canPlaceBuilding(state, state.selectedBuildType, tile) ? 0xb3ff84 : 0xff7b6f);
}

function removeGhost() {
  if (!ghostMesh) return;
  sceneCtx.groups.ghosts.remove(ghostMesh);
  ghostMesh.geometry.dispose?.();
  ghostMesh.material.dispose?.();
  ghostMesh = null;
  sceneCtx.renderer.domElement.removeEventListener('pointermove', pointerGhostMove);
}

async function processFinishedConstruction() {
  const done = collectFinishedConstruction(state);
  for (const job of done) {
    const entity = await finishConstruction(sceneCtx, state, job);
    if (entity) {
      notify(job.mode === 'upgrade' ? `Улучшено: ${BUILDINGS[entity.type].name} ур. ${entity.level}` : `Построено: ${BUILDINGS[job.type].name}`);
      const tile = state.mapIndex.get(job.tileId);
      connectRoadsForTile(tile);
    }
  }
  if (done.length) refreshConstructionOverlays();
  renderRoads(sceneCtx, state);
}

function connectRoadsForTile(tile) {
  const neighbors = getNeighbors(state, tile).filter((n) => n.type !== 'water' && (n.buildingId || isTileInsideTerritory(state, n)));
  neighbors.forEach((n) => addRoad(tile.id, n.id));
}

function updateDayNightVisual(dt) {
  const t = (state.dayTime % GAME_CONFIG.dayDuration) / GAME_CONFIG.dayDuration;
  const ang = t * Math.PI * 2;
  sceneCtx.sun.position.set(Math.cos(ang) * 40, Math.max(8, Math.sin(ang) * 34), Math.sin(ang) * 20 - 8);
  const lightMul = { clear: 1, rain: .92, mist: .8, dust: .84 }[state.weather];
  sceneCtx.sun.intensity = clamp(Math.sin(ang) * 1.08 + .88, .42, 1.66) * lightMul;
  sceneCtx.hemi.intensity = .52 + sceneCtx.sun.intensity * .40;
  sceneCtx.ambient.intensity = .28 + sceneCtx.sun.intensity * .08;
  sceneCtx.stars.visible = sceneCtx.sun.position.y < 12;
  sceneCtx.sky.material.uniforms.topColor.value.setHex(sceneCtx.sun.position.y > 14 ? 0x9ad5ff : 0x243260);
  sceneCtx.sky.material.uniforms.bottomColor.value.setHex(sceneCtx.sun.position.y > 14 ? 0xffd29a : 0x6a3d1f);
  sceneCtx.scene.fog.color.setHex(sceneCtx.sun.position.y > 14 ? 0x7a5a3d : 0x171425);
  sceneCtx.cloudLayer.children.forEach((cloud, i) => {
    cloud.rotation.y += dt * cloud.userData.drift * .1;
    cloud.position.x += Math.sin((state.worldTime * .03) + i) * dt * .1;
    cloud.position.z += Math.cos((state.worldTime * .02) + i) * dt * .08;
  });
  state.buildings.forEach((b) => {
    if (b.glow) b.glow.intensity = (b.type === 'capital' || b.type === 'temple' || b.type === 'tower' ? 1.0 : 0.48) + b.hitFlash * 1.5;
    if (b.hitFlash) {
      b.hitFlash = Math.max(0, b.hitFlash - dt * 3.5);
      b.mesh.scale.setScalar(1 + b.hitFlash * .08);
    } else {
      b.mesh.scale.setScalar(1);
    }
  });
}

function maybeAutoSave(dt) {
  state.autosaveTimer += dt;
  if (state.autosaveTimer < GAME_CONFIG.autosaveEvery) return;
  state.autosaveTimer = 0;
  saveGame(state);
}

function checkStateMilestones() {
  if (state.gameEnded) return;
  const capital = getCapital(state);
  if (!capital || state.resources.stability <= 0 || capital.hp <= 0) {
    state.gameEnded = true;
    state.paused = true;
    state.timeScale = 0;
    setSpeedButton(0);
    openModal('Держава пала', 'Власть рассыпалась', '<p>Нужно удерживать порядок, пищу и защиту. Попробуй начать снова и раньше строить амбары, храмы, башни и улучшать столицу.</p>', [{ label: 'Понятно', primary: true, onClick: closeModal }]);
    return;
  }
  const allObjectives = state.objectives.every((o) => o.done);
  if (allObjectives && state.era >= 2 && state.resources.stability >= 65) {
    state.gameEnded = true;
    openModal('Золотой век', 'Империя добилась величия', '<p>Ты выполнил стратегические цели, пережил набеги и вывел державу в зрелую эпоху. Можно продолжать строить или начать новую партию.</p>', [{ label: 'Продолжить', primary: true, onClick: closeModal }]);
  }
}

function refreshConstructionOverlays() {
  const wrap = $('#construction-overlays');
  if (!wrap) return;
  wrap.innerHTML = '';
  state.construction.forEach((job) => {
    const tile = state.mapIndex.get(job.tileId);
    if (!tile) return;
    const el = document.createElement('div');
    el.className = 'construction-timer';
    el.dataset.jobId = job.id;
    el.textContent = `${Math.max(0, Math.ceil(job.buildTime - job.progress))}с`;
    wrap.appendChild(el);
  });
}

function updateConstructionOverlays() {
  const wrap = $('#construction-overlays');
  if (!wrap) return;
  if (wrap.children.length !== state.construction.length) refreshConstructionOverlays();
  state.construction.forEach((job) => {
    const tile = state.mapIndex.get(job.tileId);
    const el = wrap.querySelector(`[data-job-id="${job.id}"]`);
    if (!tile || !el) return;
    const world = tile.pos.clone();
    world.y = tile.height + 2.7;
    world.project(sceneCtx.camera);
    const x = (world.x * .5 + .5) * innerWidth;
    const y = (world.y * -.5 + .5) * innerHeight;
    const offscreen = world.z > 1 || x < -50 || x > innerWidth + 50 || y < -50 || y > innerHeight + 50;
    el.style.display = offscreen ? 'none' : 'block';
    el.style.transform = `translate(${x}px, ${y}px)`;
    el.textContent = `${Math.max(0, Math.ceil(job.buildTime - job.progress))}с`;
  });
}

function spawnConstructionDust(dt) {
  constructionDustTimer += dt;
  if (constructionDustTimer < 0.18) return;
  constructionDustTimer = 0;
  state.construction.forEach((job) => {
    const tile = state.mapIndex.get(job.tileId);
    if (!tile) return;
    for (let i = 0; i < 2; i++) {
      const dust = new THREE.Mesh(new THREE.SphereGeometry(.08 + Math.random() * .05, 5, 5), new THREE.MeshBasicMaterial({ color: 0xb79862, transparent: true, opacity: .42 }));
      dust.position.set(tile.pos.x + (Math.random() - .5) * .9, tile.height + .38 + Math.random() * .35, tile.pos.z + (Math.random() - .5) * .9);
      sceneCtx.groups.effects.add(dust);
      sceneCtx.effectBursts.push({
        id: `dust-${performance.now()}-${Math.random()}`,
        mesh: dust,
        vel: new THREE.Vector3((Math.random() - .5) * .3, .32 + Math.random() * .18, (Math.random() - .5) * .3),
        life: .5 + Math.random() * .35,
        kind: 'burst'
      });
    }
  });
}

async function stepSimulation(dt) {
  updateEnvironmentState(state, dt);
  applyRealTimeEconomy(state, dt);
  updateConstruction(state, dt);
  await processFinishedConstruction();
  updateEra(state);
  const completedTech = updateResearch(state, dt);
  if (completedTech) notify(`Изучено: ${completedTech}`);
  updateTraining(sceneCtx, state, dt, notify);
  updateDefense(sceneCtx, state, dt);
  updateUnits(sceneCtx, state, dt, notify);
  updateProjectiles(sceneCtx, state, dt);
  updateEnemyWaves(sceneCtx, state, dt, notify);
  updateObjectives(state);
  spawnConstructionDust(dt);

  state.workerSpawnTimer -= dt;
  if (state.workerSpawnTimer <= 0) {
    state.workerSpawnTimer = GAME_CONFIG.workerSpawnEvery;
    autoSpawnWorkers(sceneCtx, state, notify);
  }
  if (state.seasonTime >= GAME_CONFIG.seasonDuration) {
    state.seasonTime = 0;
    maybeChangeWeather(state);
    notify(`Погода изменилась: ${state.weather}`);
  }
  checkStateMilestones();
  maybeAutoSave(dt);
}

async function animate(now = performance.now()) {
  requestAnimationFrame(animate);
  const rawDt = Math.min(.05, (now - lastTime) / 1000);
  lastTime = now;
  const dt = rawDt * state.timeScale;

  if (!state.paused && state.timeScale > 0) {
    await stepSimulation(dt);
    updateSelection(state);
    updateHud(state);
    drawMinimap(state);
  }

  updateConstructionOverlays();
  updateDayNightVisual(rawDt * Math.max(state.timeScale, .3));
  sceneCtx.controls.update();
  sceneCtx.composer.render();
}

bootstrap();
