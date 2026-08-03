import * as THREE from 'three';
import { TERRAIN_TYPES, GAME_CONFIG } from '../config.js';
import { sampleTerrain } from './world.js';

let terrainMesh = null;
let waterMesh = null;
let terrainMaterial = null;
let waterMaterial = null;

const raycaster = new THREE.Raycaster();
const down = new THREE.Vector3(0, -1, 0);

function makeCanvas(size) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

function makeRepeatingTexture(drawFn, repeatX = 12, repeatY = 12) {
  const canvas = makeCanvas(512);
  const ctx = canvas.getContext('2d');
  drawFn(ctx, canvas.width, canvas.height);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeGrassTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = '#658a3e';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 400; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 10 + Math.random() * 30;
      const isLight = Math.random() > 0.5;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, isLight ? 'rgba(125, 168, 79, 0.15)' : 'rgba(78, 107, 47, 0.15)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 10, 10);
}

function makeGrassNormalTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 500; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const r = 5 + Math.random() * 15;
      const c = 128 + (Math.random() - 0.5) * 40;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, `rgba(${c},${c},255, 0.3)`);
      grad.addColorStop(1, 'rgba(128,128,255,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 10, 10);
}

function makeWaterTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = '#2d7a9d';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 300; i++) {
      const x = Math.random() * w;
      const y = Math.random() * h;
      const rw = 15 + Math.random() * 40;
      const rh = 3 + Math.random() * 8;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, rw);
      grad.addColorStop(0, 'rgba(130, 210, 240, 0.2)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(x, y, rw, rh, Math.random() * 0.2 - 0.1, 0, Math.PI * 2);
      ctx.fill();
    }
  }, 6, 6);
}

function makeWaterNormalTexture() {
  return makeRepeatingTexture((ctx, w, h) => {
    ctx.fillStyle = 'rgb(128,128,255)';
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 200; i++) {
        const x = Math.random() * w;
        const y = Math.random() * h;
        ctx.fillStyle = `rgba(140, 140, 255, 0.4)`;
        ctx.beginPath();
        ctx.ellipse(x, y, 20 + Math.random() * 20, 5 + Math.random() * 10, 0, 0, Math.PI * 2);
        ctx.fill();
    }
  }, 6, 6);
}

function ensureTerrainMaterials() {
  if (!terrainMaterial) {
    terrainMaterial = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.85,
      metalness: 0.05,
      map: makeGrassTexture(),
      normalMap: makeGrassNormalTexture(),
      normalScale: new THREE.Vector2(0.6, 0.6),
      envMapIntensity: 0.3,
      flatShading: false
    });
  }
  if (!waterMaterial) {
    waterMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x4fb4e3,
      transparent: true,
      opacity: 0.9,
      roughness: 0.1,
      metalness: 0.1,
      clearcoat: 0.8,
      reflectivity: 0.5,
      map: makeWaterTexture(),
      normalMap: makeWaterNormalTexture(),
      normalScale: new THREE.Vector2(0.7, 0.7),
      envMapIntensity: 0.8,
      depthWrite: false
    });
  }
}

export function sampleTerrainHeight(state, x, z) {
    const terrain = sampleTerrain(state, x, z);
    return terrain.height;
}

function colorFor(type, h, x, z, steepness) {
  const baseColorHex = TERRAIN_TYPES[type]?.color || 0x6e8e45;
  const c = new THREE.Color(baseColorHex);
  
  if (type === 'water') {
    c.setHex(0x2f88b7);
  }

  if (type === 'river') {
    c.lerp(new THREE.Color(0x6f9e6d), 0.35);
  }

  if (type === 'fertile') {
    c.lerp(new THREE.Color(0x9c8b53), 0.12);
  }
  
  if (steepness > 0.45 || type === 'rock') {
    c.lerp(new THREE.Color(0x7a7770), Math.min(1, 0.2 + steepness * 1.5));
  }
  
  if (type !== 'river' && h > 1.4) {
      c.lerp(new THREE.Color(0xffffff), Math.min(1, (h - 1.4) * 0.8));
  }
  
  if (type === 'forest') {
    c.lerp(new THREE.Color(0x3a5423), 0.25);
  }
  return c;
}

export function buildTerrain(sceneCtx, state) {
  const { groups } = sceneCtx;
  if (terrainMesh) {
    groups.tiles.remove(terrainMesh);
    terrainMesh.geometry?.dispose?.();
  }
  if (waterMesh) {
    groups.tiles.remove(waterMesh);
    waterMesh.geometry?.dispose?.();
  }
  ensureTerrainMaterials();

  const size = GAME_CONFIG.worldRadius * 2.18;
  const segments = sceneCtx.quality?.terrainSegments || 128;
  let geo = new THREE.PlaneGeometry(size, size, segments, segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const samples = new Array(pos.count);

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const terrain = sampleTerrain(state, x, z);
    samples[i] = terrain;
    let h = terrain.height;
    if (terrain.type === 'water') h = Math.min(h, GAME_CONFIG.terrain.waterLevel - 0.22);
    pos.setY(i, h);
  }

  geo.computeVertexNormals();
  const normals = geo.attributes.normal;
  const colors = [];
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const steepness = 1 - Math.abs(normals.getY(i));
    const terrain = samples[i];
    const c = colorFor(terrain.type, y, x, z, steepness);
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));

  terrainMesh = new THREE.Mesh(geo, terrainMaterial);
  terrainMesh.receiveShadow = true;
  terrainMesh.castShadow = false;
  terrainMesh.name = 'terrain-mesh';
  groups.tiles.add(terrainMesh);

  const waterGeo = new THREE.CircleGeometry(size * .52, sceneCtx.quality?.name === 'mobile' ? 40 : 64);
  waterGeo.rotateX(-Math.PI / 2);

  waterMesh = new THREE.Mesh(waterGeo, waterMaterial);
  waterMesh.position.y = GAME_CONFIG.terrain.waterLevel + .018;
  waterMesh.receiveShadow = true;
  waterMesh.name = 'water-surfaces';
  waterMesh.renderOrder = 2;
  groups.tiles.add(waterMesh);

  return terrainMesh;
}

export function updateTerrainVisuals(state, time = 0) {
  if (waterMaterial?.map) {
    waterMaterial.map.offset.x = (time * 0.0002) % 1;
    waterMaterial.map.offset.y = (time * 0.0001) % 1;
  }
  if (waterMaterial?.normalMap) {
    waterMaterial.normalMap.offset.x = (-time * 0.0003) % 1;
    waterMaterial.normalMap.offset.y = (time * 0.00015) % 1;
  }
}

export function getTerrainPoint(x, z) {
  if (!terrainMesh) return new THREE.Vector3(x, 0, z);
  raycaster.set(new THREE.Vector3(x, 250, z), down);
  const hits = raycaster.intersectObject(terrainMesh, false);
  return hits.length ? hits[0].point.clone() : new THREE.Vector3(x, 0, z);
}

export function getTerrainY(x, z) { return getTerrainPoint(x, z).y; }
export function getTerrainMesh() { return terrainMesh; }
