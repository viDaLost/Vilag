import { BUILDINGS, UNITS, TERRAIN_TYPES } from '../config.js';
import { getBuildingOnTile } from '../systems/buildings.js';
import { isTileInsideTerritory } from '../systems/world.js';
import { fmt } from '../utils/helpers.js';
import { $ } from './dom.js';

export function updateSelection(state) {
  const title = $('#selection-title');
  const body = $('#selection-content');
  const sel = state.selected;
  if (!sel) {
    title.textContent = 'Выбор';
    body.innerHTML = 'Коснись клетки, здания или юнита.';
    return;
  }
  if (sel.kind === 'tile') {
    const tile = sel.ref;
    const building = getBuildingOnTile(state, tile);
    title.textContent = building ? BUILDINGS[building.type].name : TERRAIN_TYPES[tile.type].name;
    body.innerHTML = `
      <div>Земля: <strong>${TERRAIN_TYPES[tile.type].name}</strong></div>
      <div>Высота: <strong>${fmt(tile.height)}</strong></div>
      <div>Зона: <strong>${isTileInsideTerritory(state, tile) ? 'Во владениях' : 'Вне владений'}</strong></div>
      ${building ? `<div>Здание: <strong>${BUILDINGS[building.type].name}</strong></div><div>Прочность: <strong>${fmt(building.hp)} / ${fmt(building.maxHp)}</strong></div>` : '<div>Свободная клетка</div>'}
    `;
  }
  if (sel.kind === 'unit') {
    const unit = sel.ref;
    title.textContent = UNITS[unit.type].name;
    body.innerHTML = `<div>HP: <strong>${fmt(unit.hp)} / ${fmt(unit.maxHp)}</strong></div><div>Скорость: <strong>${fmt(unit.speed)}</strong></div><div>${unit.hostile ? 'Вражеский' : 'Свой'} юнит</div>`;
  }
}
