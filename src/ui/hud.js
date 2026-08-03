import { RESOURCE_META, ERA_DATA, WEATHER_TYPES, CAMPAIGN_CHAPTERS, GAME_CONFIG } from '../config.js';
import { $ } from './dom.js';
import { fmt } from '../utils/helpers.js';
import { objectiveMetric } from '../systems/economy.js';

const PRIMARY_RESOURCES = new Set(['gold', 'food', 'wood', 'stone', 'population', 'workers', 'army', 'prestige', 'knowledge']);

export function setupHud() {
  const top = $('#top-bar');
  top.innerHTML = RESOURCE_META.filter(([key]) => PRIMARY_RESOURCES.has(key)).map(([key, icon, label]) => `
    <div class="res-card res-card-${key}">
      <div class="res-icon">${icon}</div>
      <div class="res-meta">
        <div class="res-value" data-res-value="${key}">0</div>
        <div class="res-label">${label}</div>
      </div>
    </div>
  `).join('');
}

export function updateHud(state) {
  RESOURCE_META.forEach(([key]) => {
    const el = document.querySelector(`[data-res-value="${key}"]`);
    if (!el) return;
    el.textContent = key === 'population'
      ? `${fmt(state.resources.population || 0)}/${fmt(state.resources.populationCap || 0)}`
      : fmt(state.resources[key] || 0);
  });

  $('#clock-label').textContent = toClock(state.dayTime);
  $('#weather-label').textContent = WEATHER_TYPES[state.weather].label;
  $('#era-label').textContent = ERA_DATA[state.era].name;
  $('#threat-label').textContent = fmt(state.resources.threat);
  $('#chapter-label').textContent = CAMPAIGN_CHAPTERS[state.campaign.chapter]?.name || 'Наследие';
  $('#kingdom-text').textContent = kingdomText(state);
  $('#kingdom-badges').innerHTML = [
    `Эпоха: ${ERA_DATA[state.era].name}`,
    `Технологии: ${state.techs.size}/6`,
    `Лагеря: ${state.enemyCamps.length}`,
    `Порядок: ${fmt(state.resources.stability)}`,
  ].map((t) => `<span class="badge">${t}</span>`).join('');

  const active = state.objectives.filter((objective) => objective.chapter === state.campaign.chapter);
  $('#objectives-list').innerHTML = active.map((objective) => {
    const current = objectiveMetric(state, objective.metric);
    const pct = objective.comparator === 'lte'
      ? Math.min(100, Math.round((1 - current / Math.max(1, GAME_CONFIG.enemyCampCount)) * 100))
      : Math.min(100, Math.round(current / Math.max(1, objective.target) * 100));
    const rewards = Object.entries(objective.reward).map(([key, value]) => `${resourceName(key)} +${value}`).join(' • ');
    return `<div class="obj-item ${objective.done ? 'done' : ''}"><div>${objective.done ? '✓' : objective.branch ? '◇' : '•'} ${objective.title}</div><div class="drawer-subtitle">${objective.done ? 'Выполнено' : `${fmt(current)} / ${objective.target}`} • ${rewards}</div><div class="progress"><div style="width:${pct}%"></div></div></div>`;
  }).join('');
}

function kingdomText(state) {
  if (state.victory) return 'Наследие создано. Мир продолжает жить — можно укреплять державу дальше.';
  if (state.resources.stability < 35) return 'Народ на грани смуты. Укрепляй порядок и пищу.';
  if (state.resources.food < state.resources.population * 2.5) return 'Запасы пищи тают. Усиль фермы и амбары.';
  if (state.resources.threat > 45) return 'Рубежи тревожны. Башни и войска нужны уже сейчас.';
  if (state.placementMode?.type === 'unit-command') return 'Укажите точку: отряд построится вокруг неё и будет охранять район.';
  if (state.selectedBuildType) return `Режим строительства: выберите подходящую сушу для постройки.`;
  if (state.construction.length) return 'Свободные рабочие ускоряют стройку; при нехватке людей сроки растут.';
  if (state.campaign.chapter === 0) return 'Освойте плодородную землю, лес и каменные холмы долины.';
  if (state.campaign.chapter === 1) return 'Вражеские лагеря на окраинах копят припасы. Подготовьте рубеж.';
  if (state.campaign.chapter === 2) return 'Дороги автоматически связывают поселение, торговлю и знания.';
  if (state.campaign.chapter === 3) return 'Последний выбор: Чудо света или полное покорение долины.';
  if (state.era === 2) return 'Империя вступила в зрелый золотой век.';
  if (state.techProgress) return `Учёные работают: ${state.techProgress.id}`;
  return 'Двойной тап по свободной соте открывает нижнюю быструю постройку.';
}

function toClock(dayTime) {
  const normalized = (dayTime % GAME_CONFIG.dayDuration) / GAME_CONFIG.dayDuration;
  const minutes = Math.floor(normalized * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function resourceName(key) {
  return ({ gold: 'золото', food: 'еда', wood: 'дерево', stone: 'камень', prestige: 'престиж', stability: 'порядок', knowledge: 'знание' })[key] || key;
}
