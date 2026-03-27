import { terrainColor } from '../systems/world.js';

export function drawMinimap(state) {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const size = Math.floor(canvas.clientWidth * dpr);
  if (canvas.width !== size) {
    canvas.width = size;
    canvas.height = size;
  }
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, size, size);
  ctx.fillStyle = '#0f0906';
  ctx.fillRect(0, 0, size, size);

  const cx = size / 2;
  const cy = size / 2;
  const scale = size / 86;

  state.map.forEach((tile) => {
    ctx.fillStyle = '#' + terrainColor(tile.type).toString(16).padStart(6, '0');
    ctx.beginPath();
    ctx.arc(cx + tile.pos.x * scale, cy + tile.pos.z * scale, tile.type === 'water' ? 1.7 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  });

  ctx.strokeStyle = 'rgba(255,214,107,.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, cy, state.territoryRadius * scale, 0, Math.PI * 2);
  ctx.stroke();

  ctx.strokeStyle = 'rgba(212,181,121,.8)';
  state.roads.forEach((road) => {
    const a = state.mapIndex.get(road.a);
    const b = state.mapIndex.get(road.b);
    if (!a || !b) return;
    ctx.beginPath();
    ctx.moveTo(cx + a.pos.x * scale, cy + a.pos.z * scale);
    ctx.lineTo(cx + b.pos.x * scale, cy + b.pos.z * scale);
    ctx.stroke();
  });

  state.enemyCamps.forEach((camp) => {
    ctx.fillStyle = '#ff826d';
    ctx.fillRect(cx + camp.pos.x * scale - 2, cy + camp.pos.z * scale - 2, 4, 4);
  });
  state.buildings.forEach((b) => {
    const tile = state.mapIndex.get(b.tileId);
    if (!tile) return;
    ctx.fillStyle = b.type === 'capital' ? '#ffd66b' : '#ffffff';
    ctx.fillRect(cx + tile.pos.x * scale - 2, cy + tile.pos.z * scale - 2, 4, 4);
  });
}
