import { RESOURCE_META, ERA_DATA, WEATHER_TYPES } from '../config.js';
import { $, $$ } from './dom.js';
import { fmt } from '../utils/helpers.js';

export function setupHud() {
  const top = $('#top-bar');
  top.innerHTML = RESOURCE_META.map(([key, icon, label]) => `
    <div class="res-card">
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
    if (el) el.textContent = fmt(state.resources[key] || 0);
  });

  $('#clock-label').textContent = toClock(state.dayTime);
  $('#weather-label').textContent = WEATHER_TYPES[state.weather].label;
  $('#era-label').textContent = ERA_DATA[state.era].name;
  $('#threat-label').textContent = fmt(state.resources.threat);
  $('#kingdom-text').textContent = kingdomText(state);
  $('#kingdom-badges').innerHTML = [
    `Эпоха: ${ERA_DATA[state.era].name}`,
    `Техи: ${state.techs.size}`,
    `Волны: ${state.stats.raidsDefeated}`,
  ].map((t) => `<span class="badge">${t}</span>`).join('');

  $('#objectives-list').innerHTML = state.objectives.map((o) => {
    let current = 0;
    if (o.metric === 'food') current = state.resources.food;
    if (o.metric === 'roads') current = state.resources.roads;
    if (o.metric === 'armyUnits') current = state.stats.armyUnits;
    if (o.metric === 'wonderBuilt') current = state.stats.wonderBuilt;
    const pct = Math.min(100, Math.round(current / o.target * 100));
    return `<div class="obj-item ${o.done ? 'done' : ''}"><div>${o.done ? '✓' : '•'} ${o.title}</div><div class="drawer-subtitle">${pct}% • награда: ${Object.entries(o.reward).map(([k, v]) => `${v} ${k}`).join(', ')}</div><div class="progress"><div style="width:${pct}%"></div></div></div>`;
  }).join('');
}

function kingdomText(state) {
  if (state.resources.stability < 35) return 'Народ на грани смуты. Укрепляй порядок и пищу.';
  if (state.resources.threat > 45) return 'На рубежах тревожно. Строй башни, нанимай войска.';
  if (state.era === 2) return 'Империя вступила в зрелый золотой век.';
  if (state.techProgress) return `Учёные работают: ${state.techProgress.id}`;
  return 'Ресурсы, строительство и враги обновляются в реальном времени.';
}

function toClock(dayTime) {
  const normalized = (dayTime % 180) / 180;
  const minutes = Math.floor(normalized * 24 * 60);
  const hh = String(Math.floor(minutes / 60)).padStart(2, '0');
  const mm = String(minutes % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}
