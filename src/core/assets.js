import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { getModelCandidates } from '../data/modelPaths.js';

const gltfLoader = new GLTFLoader();
const fbxLoader = new FBXLoader();
const cache = new Map();
const loadQueue = [];
let activeLoads = 0;
const MAX_CONCURRENT_LOADS = 2;

function runQueue() {
  while (activeLoads < MAX_CONCURRENT_LOADS && loadQueue.length) {
    const job = loadQueue.shift();
    activeLoads++;
    job().finally(() => {
      activeLoads--;
      runQueue();
    });
  }
}

function enqueue(task) {
  return new Promise((resolve, reject) => {
    loadQueue.push(() => task().then(resolve, reject));
    runQueue();
  });
}

function withTimeout(promise, ms = 12000) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Asset load timeout')), ms))
  ]);
}

async function loadAny(path) {
  if (path.toLowerCase().endsWith('.fbx') || path.toLowerCase().includes('.fbx?')) {
    const scene = await withTimeout(fbxLoader.loadAsync(path), 12000);
    return { scene, animations: scene.animations || [] };
  }
  const gltf = await withTimeout(gltfLoader.loadAsync(path), 12000);
  return { scene: gltf.scene, animations: gltf.animations || [] };
}

async function loadFirst(paths) {
  let lastError = null;
  for (const path of paths) {
    try {
      return await enqueue(() => loadAny(path));
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Model not found');
}

function tuneMaterial(material) {
  if (!material) return;
  material.depthWrite = true;
  if ('envMapIntensity' in material) material.envMapIntensity = 0.75;
  if ('shadowSide' in material) material.shadowSide = THREE.FrontSide;
}

function prepareScene(scene) {
  scene.traverse((obj) => {
    if (obj.isMesh || obj.isSkinnedMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = true;
      if (Array.isArray(obj.material)) obj.material.forEach(tuneMaterial); else tuneMaterial(obj.material);
    }
  });
  return scene;
}

async function loadModelEntry(filename, root = 'buildings') {
  if (!filename) return null;
  const key = `${root}:${filename}`;
  if (cache.has(key)) return cache.get(key);
  const pending = loadFirst(getModelCandidates(filename, root)).then((entry) => {
    prepareScene(entry.scene);
    cache.set(key, entry);
    return entry;
  }).catch((error) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}


function fitSceneToHeight(scene, targetHeight = 1) {
  if (!scene || !targetHeight) return;
  const box = new THREE.Box3().setFromObject(scene);
  const size = new THREE.Vector3();
  box.getSize(size);
  if (!size.y || !Number.isFinite(size.y)) return;
  const scale = targetHeight / size.y;
  scene.scale.multiplyScalar(scale);
  const groundedBox = new THREE.Box3().setFromObject(scene);
  scene.position.y += -(groundedBox.min.y) + 0.001;
}

function cloneSceneEntry(entry) {
  const scene = SkeletonUtils.clone(entry.scene);
  prepareScene(scene);
  return { scene, animations: entry.animations || [] };
}

export async function loadBuildingModel(filename) {
  const entry = await loadModelEntry(filename, 'buildings');
  return cloneSceneEntry(entry).scene;
}

export async function loadDecorModel(filename, root = 'decor') {
  const entry = await loadModelEntry(filename, root);
  return cloneSceneEntry(entry).scene;
}

export async function loadUnitModel(filename) {
  const entry = await loadModelEntry(filename, 'units');
  return cloneSceneEntry(entry);
}

export async function attachUnitModel(group, mapping) {
  if (!mapping?.file) return null;
  try {
    const { scene, animations } = await loadUnitModel(mapping.file);
    scene.scale.setScalar(mapping.scale || 1);
    if (mapping.targetHeight) fitSceneToHeight(scene, mapping.targetHeight);
    scene.position.y += mapping.y || 0;
    scene.rotation.y = mapping.rotY || 0;
    scene.traverse((obj) => {
      if (obj.isMesh || obj.isSkinnedMesh) {
        obj.castShadow = true;
        obj.receiveShadow = true;
      }
    });
    group.add(scene);
    group.userData.gltf = scene;
    return { model: scene, animations };
  } catch (err) {
    console.warn('Unit model failed', mapping.file, err);
    return null;
  }
}

export function groundScene(scene, floorOffset = 0.001) {
  if (!scene) return scene;
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  if (!Number.isFinite(box.min.y)) return scene;
  scene.position.y += -box.min.y + floorOffset;
  return scene;
}

export function makeFallbackMesh(color = 0xb4873e) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1, 1.2),
    new THREE.MeshStandardMaterial({ color, roughness: .86, metalness: .06 })
  );
  // BoxGeometry is centered by default; lift it so fallback buildings never sink below terrain.
  mesh.position.y = 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}

export function playAnim(mesh, animName, dt) {
  if (mesh.userData.mixer) mesh.userData.mixer.update(dt);
}
