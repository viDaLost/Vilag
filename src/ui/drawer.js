import { BUILDINGS, TECHS, UNITS } from '../config.js';
import { $, $$ } from './dom.js';
import { canPlaceBuilding, hasCost } from '../systems/buildings.js';
import { beginResearch, canResearch } from '../systems/economy.js';
import { queueTraining } from '../systems/units.js';

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
}

export function openBuildMenu(state, onChoose) {
  const cards = Object.entries(BUILDINGS)
    .filter(([key, cfg]) => key !== 'capital')
    .map(([key, cfg]) => {
      const enabled = state.era >= (cfg.minEra ?? 0);
      return `<button class="card-btn" data-build-type="${key}" ${enabled ? '' : 'disabled'}>
        <strong>${cfg.icon} ${cfg.name}</strong>
        <small>${costText(cfg.cost)} • ${cfg.baseBuildTime}с</small>
        <small>${cfg.category}</small>
      </button>`;
    }).join('');
  openDrawer('Строительство', 'Выбери тип, затем коснись клетки', `<div class="card-grid">${cards}</div>`);
  $$('[data-build-type]').forEach((btn) => {
    btn.onclick = () => onChoose(btn.dataset.buildType);
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
      const disabled = state.era < (unit.minEra ?? 0);
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

function costText(cost = {}) {
  return Object.entries(cost).map(([k, v]) => `${v} ${k}`).join(', ');
}
