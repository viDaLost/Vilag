import { sampleTerrain } from '../systems/world.js';
import { GAME_CONFIG, TERRAIN_TYPES } from '../config.js';

let cachedBase = null;
let cachedKey = '';

function buildBase(state, size) {
  const key = `${state.worldSeed}:${size}`;
  if (cachedBase && cachedKey === key) return cachedBase;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const radius = GAME_CONFIG.worldRadius;
  const scale = size / (radius * 2.12);
  const center = size / 2;
  ctx.fillStyle = '#100c08';
  ctx.fillRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(center, center, radius * scale, 0, Math.PI * 2);
  ctx.clip();
  const step = Math.max(1.8, radius * 2 / 44);
  for (let x = -radius; x <= radius; x += step) {
    for (let z = -radius; z <= radius; z += step) {
      if (Math.hypot(x, z) > radius) continue;
      const terrain = sampleTerrain(state, x, z);
      ctx.fillStyle = `#${(TERRAIN_TYPES[terrain.type]?.color || 0x000000).toString(16).padStart(6, '0')}`;
      ctx.fillRect(center + x * scale - step * scale * .58, center + z * scale - step * scale * .58, step * scale * 1.18, step * scale * 1.18);
    }
  }
  ctx.restore();
  cachedBase = canvas;
  cachedKey = key;
  return canvas;
}

export function drawMinimap(state, sceneCtx = null) {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 1.5);
  const size = Math.max(80, Math.floor(canvas.clientWidth * dpr));
  if (canvas.width !== size || canvas.height !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.drawImage(buildBase(state, size), 0, 0);
  const center = size / 2;
  const scale = size / (GAME_CONFIG.worldRadius * 2.12);

  ctx.strokeStyle = 'rgba(255,214,107,.78)';
  ctx.lineWidth = Math.max(1, dpr);
  ctx.beginPath();
  ctx.arc(center, center, state.territoryRadius * scale, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(218,179,109,.58)';
  ctx.lineWidth = Math.max(1, dpr * .8);
  for (const road of state.roads || []) {
    if (!road.points?.length) continue;
    ctx.beginPath();
    road.points.forEach((point, index) => {
      const x = center + point.x * scale;
      const y = center + point.z * scale;
      if (index) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    });
    ctx.stroke();
  }

  for (const camp of state.enemyCamps) {
    ctx.fillStyle = '#ff6f60';
    ctx.beginPath();
    ctx.arc(center + camp.pos.x * scale, center + camp.pos.z * scale, 2.5 * dpr, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const building of state.buildings) {
    ctx.fillStyle = building.type === 'capital' ? '#ffd66b' : building.type === 'tower' ? '#8fc8ff' : '#f7eee0';
    const radius = building.type === 'capital' ? 2.2 * dpr : 1.35 * dpr;
    ctx.fillRect(center + building.pos.x * scale - radius, center + building.pos.z * scale - radius, radius * 2, radius * 2);
  }
  for (const unit of state.units) {
    ctx.fillStyle = unit.hostile ? '#ff826d' : unit.type === 'worker' ? '#8ed2ff' : '#ffe39a';
    ctx.fillRect(center + unit.pos.x * scale - 1, center + unit.pos.z * scale - 1, 2.2 * dpr, 2.2 * dpr);
  }

  if (sceneCtx) {
    const target = sceneCtx.controls.target;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(center + target.x * scale, center + target.z * scale, 3 * dpr, 0, Math.PI * 2);
    ctx.stroke();
  }
}

export function setupMinimapInteraction(state, sceneCtx) {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  canvas.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const radius = GAME_CONFIG.worldRadius;
    const x = ((event.clientX - rect.left) / rect.width - .5) * radius * 2.12;
    const z = ((event.clientY - rect.top) / rect.height - .5) * radius * 2.12;
    if (Math.hypot(x, z) > radius) return;
    const terrain = sampleTerrain(state, x, z);
    sceneCtx.controls.target.set(x, terrain.height, z);
  });
}
