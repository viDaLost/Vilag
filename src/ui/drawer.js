import { BUILDINGS, TECHS, UNITS, TERRAIN_TYPES } from '../config.js';
import { $, $$ } from './dom.js';
import { beginResearch, canResearch } from '../systems/economy.js';
import { buildingPriorityLabel, canPlaceBuilding, computeBuildingYield, getBuildingStatus, getBuildingWorkerStatus } from '../systems/buildings.js';

export function closeDrawer() {
  $('#context-drawer').classList.add('hidden');
}

export function openDrawer(title, subtitle, html) {
  $('#drawer-title').textContent = title;
  $('#drawer-subtitle').textContent = subtitle;
  $('#drawer-body').innerHTML = html;
  $('#context-drawer').classList.remove('hidden');
}

export function bindDrawerClose() {
  $('#drawer-close').onclick = closeDrawer;
  document.addEventListener('pointerdown', (e) => {
    const drawer = $('#context-drawer');
    if (drawer.classList.contains('hidden')) return;
    if (e.target.closest('#context-drawer, .action-btn, .speed-btn, #modal-window')) return;
    if (e.target.closest('canvas')) closeDrawer();
  });
}

export function openBuildMenu(state, onChoose) {
  const cards = Object.entries(BUILDINGS)
    .filter(([key]) => key !== 'capital')
    .map(([key, cfg]) => {
      const enabled = state.era >= (cfg.minEra ?? 0);
      return `<button class="card-btn" data-build-type="${key}" ${enabled ? '' : 'disabled'}>
        <strong>${cfg.icon} ${cfg.name}</strong>
        <small>${costText(cfg.cost)} • ${cfg.baseBuildTime}с</small>
        <small>${cfg.desc || categoryLabel(cfg.category)}</small>
      </button>`;
    }).join('');
  openDrawer('Строительство', 'Выберите постройку, затем место на карте. Красный макет означает неподходящую землю.', `<div class="card-grid">${cards}</div>`);
  $$('[data-build-type]').forEach((btn) => {
    btn.onclick = () => onChoose(btn.dataset.buildType);
  });
}

export function openQuickBuildMenu(state, tile, onChoose) {
  const candidates = Object.entries(BUILDINGS)
    .filter(([key]) => key !== 'capital')
    .filter(([key]) => canPlaceBuilding(state, key, tile.pos.x, tile.pos.z))
    .sort((a, b) => scoreCandidate(a[0], tile.type || 'grass') - scoreCandidate(b[0], tile.type || 'grass'))
    .slice(0, innerWidth < 760 ? 8 : 6);

  const cards = candidates.map(([key, cfg]) => `
    <button class="card-btn" data-quick-build="${key}">
      <strong>${cfg.icon} ${cfg.name}</strong>
      <small>${costText(cfg.cost)} • ${cfg.baseBuildTime}с</small>
      <small>${quickHint(key, tile.type)}</small>
    </button>`).join('');

  openDrawer(
    `Быстрая постройка`,
    `${TERRAIN_TYPES[tile.type || 'grass']?.name || 'Равнина'} • двойной тап ставит последнюю постройку, если она подходит`,
    `<div class="card-grid quick-grid">${cards || '<div class="list-item">Для этой клетки пока нет доступных построек.</div>'}</div>`
  );

  $$('[data-quick-build]').forEach((btn) => {
    btn.onclick = () => onChoose(btn.dataset.quickBuild);
  });
}

export function openTrainMenu(state, onTrain) {
  const barracks = state.buildings.filter((b) => ['capital', 'barracks'].includes(b.type));
  if (!barracks.length) {
    openDrawer('Войска', 'Нет зданий для обучения', '<div class="list-item">Построй столицу или казармы.</div>');
    return;
  }
  const cards = barracks.map((building) => {
    const available = (BUILDINGS[building.type].train || []).map((unitType) => {
      const unit = UNITS[unitType];
      const disabled = state.era < (unit.minEra ?? 0) || state.resources.population + state.buildings.reduce((sum, item) => sum + (item.trainQueue?.length || 0), 0) >= state.resources.populationCap;
      return `<button class="card-btn" data-train-building="${building.id}" data-unit-type="${unitType}" ${disabled ? 'disabled' : ''}>
        <strong>${unit.icon} ${unit.name}</strong>
        <small>${costText(unit.cost)} • ${unit.trainTime}с</small>
        <small>Очередь: ${building.trainQueue.length}</small>
      </button>`;
    }).join('');
    return `<div class="list-item"><strong>${BUILDINGS[building.type].name}</strong><div class="card-grid" style="margin-top:8px">${available}</div></div>`;
  }).join('');
  openDrawer('Войска', 'Обучение идёт в реальном времени', cards);
  $$('[data-unit-type]').forEach((btn) => {
    btn.onclick = () => onTrain(btn.dataset.trainBuilding, btn.dataset.unitType);
  });
}

export function openResearchMenu(state, notify) {
  const cards = TECHS.map((tech) => {
    const learned = state.techs.has(tech.id);
    const allowed = canResearch(state, tech);
    return `<button class="card-btn" data-tech-id="${tech.id}" ${allowed ? '' : 'disabled'}>
      <strong>${learned ? '✓' : '🔬'} ${tech.name}</strong>
      <small>${tech.desc}</small>
      <small>${learned ? 'Изучено' : `Стоимость: ${tech.cost} знания`}</small>
    </button>`;
  }).join('');
  const progress = state.techProgress ? `<div class="list-item">Текущее исследование: <strong>${state.techProgress.id}</strong><div class="progress"><div style="width:${Math.round(state.techProgress.progress / state.techProgress.duration * 100)}%"></div></div></div>` : '';
  openDrawer('Знания', 'Технологии открывают долгие бонусы', `${progress}<div class="card-grid">${cards}</div>`);
  $$('[data-tech-id]').forEach((btn) => {
    btn.onclick = () => {
      const ok = beginResearch(state, btn.dataset.techId);
      notify(ok ? 'Исследование начато' : 'Недостаточно знания или эпоха ещё не открыта');
    };
  });
}

export function openBuildingMenu(state, building, tile, handlers) {
  const status = getBuildingStatus(state, building);
  const yields = computeBuildingYield(state, building);
  const worker = getBuildingWorkerStatus(state, building);
  const queue = building.trainQueue?.length ? `<div class="list-item"><strong>Очередь обучения:</strong> ${building.trainQueue.map((x) => UNITS[x.type]?.name || x.type).join(', ')}</div>` : '';
  const currentJob = state.construction.find((job) => job.buildingId === building.id);
  const actions = [];
  if (status.canUpgrade) {
    actions.push(`<button class="card-btn" data-building-action="upgrade"><strong>⬆️ Улучшить до ${building.level + 1}</strong><small>${costText(status.upgradeCost)} • ${status.upgradeTime}с</small><small>Доход и прочность вырастут</small></button>`);
  }
  if (currentJob?.mode === 'upgrade') {
    actions.push(`<div class="list-item"><strong>Улучшение в процессе</strong><div class="progress"><div style="width:${Math.round(currentJob.progress / currentJob.buildTime * 100)}%"></div></div></div>`);
  }
  if ((BUILDINGS[building.type].train || []).length) {
    actions.push(`<button class="card-btn" data-building-action="train"><strong>⚔️ Обучать войска</strong><small>Открыть локальную очередь здания</small></button>`);
    actions.push(`<button class="card-btn" data-building-action="rally"><strong>🛡️ Назначить точку сбора</strong><small>${building.rallyPos ? 'Точка уже задана — можно сменить' : 'Войска будут охранять выбранный район'}</small></button>`);
  }
  if (worker.demand) {
    actions.push(`<button class="card-btn" data-building-action="assign"><strong>🧑‍🌾 Назначить рабочего</strong><small>Свободных: ${state.resources.workers || 0}</small></button>`);
    actions.push(`<button class="card-btn" data-building-action="release"><strong>↩ Освободить рабочего</strong><small>Сейчас занято: ${worker.assigned} / ${worker.demand}</small></button>`);
    actions.push(`<button class="card-btn" data-building-action="priority"><strong>⚑ Приоритет: ${buildingPriorityLabel(building)}</strong><small>Высокий приоритет получает свободных рабочих первым</small></button>`);
  }
  if (status.repairNeeded) {
    actions.push(`<button class="card-btn" data-building-action="repair"><strong>🛠️ Починить</strong><small>Вернуть часть прочности</small></button>`);
  }
  if (building.type !== 'capital') {
    actions.push(`<button class="card-btn danger-card" data-building-action="demolish"><strong>💥 Снести</strong><small>Вернётся часть дерева и камня</small></button>`);
  }

  openDrawer(
    `${status.cfg.icon} ${status.cfg.name} • ур. ${building.level}`,
    `${TERRAIN_TYPES[tile.type || 'grass']?.name || 'Равнина'} • HP ${Math.round(building.hp)} / ${Math.round(building.maxHp)}`,
    `
      <div class="list-item"><strong>${status.cfg.desc || ''}</strong><br><span class="drawer-subtitle">Эффект в секунду: ${Object.entries(yields).map(([k, v]) => `${resourceLabel(k)} ${Math.round(v * 100) / 100}`).join(' • ') || 'нет прямого дохода'}</span></div>
      <div class="list-item"><strong>Рабочие</strong><br>${worker.demand ? `${worker.assigned} / ${worker.demand} занято • приоритет: ${buildingPriorityLabel(building)}` : 'Не требуются'}${building.rallyPos ? `<br>Точка сбора назначена` : ''}</div>
      ${queue}
      <div class="card-grid">${actions.join('')}</div>
    `
  );
  $$('[data-building-action]').forEach((btn) => {
    btn.onclick = () => handlers[btn.dataset.buildingAction]?.();
  });
}

function costText(cost = {}) {
  return Object.entries(cost).map(([k, v]) => `${resourceLabel(k)} ${v}`).join(' • ');
}

function resourceLabel(key) {
  return ({ gold: '💰', food: '🌾', wood: '🪵', stone: '🪨', prestige: '👑', stability: '🕊️', knowledge: '🔬', populationCap: '👥', defense: '🛡️', army: '⚔️' })[key] || key;
}

function categoryLabel(key) {
  return ({ economy: 'Экономика', military: 'Оборона', culture: 'Культура', core: 'Центр' })[key] || key;
}

function scoreCandidate(type, terrain) {
  const preferred = {
    fertile: ['farm', 'granary', 'market', 'temple'],
    river: ['farm', 'harbor', 'market', 'granary'],
    forest: ['lumber', 'tower', 'wall'],
    hill: ['mine', 'tower', 'barracks'],
    rock: ['mine', 'temple', 'tower'],
    sacred: ['temple', 'academy', 'wonder'],
    grass: ['farm', 'market', 'barracks', 'granary']
  };
  const list = preferred[terrain] || [];
  const idx = list.indexOf(type);
  return idx === -1 ? 99 : idx;
}

function quickHint(type, terrain) {
  if (type === 'farm' && (terrain === 'river' || terrain === 'fertile')) return 'Лучший урожай на этой земле';
  if (type === 'lumber' && terrain === 'forest') return 'Лес рядом ускоряет добычу';
  if (type === 'mine' && (terrain === 'hill' || terrain === 'rock')) return 'Хорошее место для руды и камня';
  if (type === 'temple' && terrain === 'sacred') return 'Священная зона усиливает престиж';
  if (type === 'harbor' && terrain === 'river') return 'Торговля у воды особенно сильна';
  return 'Подходит для текущей зоны';
}
