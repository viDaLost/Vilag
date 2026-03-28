import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SkeletonUtils } from 'three/addons/utils/SkeletonUtils.js';
import { getModelCandidates } from '../data/modelPaths.js';

const loader = new GLTFLoader();
const cache = new Map();

async function loadFirst(paths) {
  let lastError = null;
  for (const path of paths) {
    try {
      const gltf = await loader.loadAsync(path);
      return { gltf, path };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error('Model not found');
}

function prepareScene(scene) {
  scene.traverse((obj) => {
    if (obj.isMesh) {
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.frustumCulled = true;
      if (Array.isArray(obj.material)) {
        obj.material.forEach((m) => {
          if (!m) return;
          m.depthWrite = true;
          if ('envMapIntensity' in m) m.envMapIntensity = 0.78;
        });
      } else if (obj.material) {
        obj.material.depthWrite = true;
        if ('envMapIntensity' in obj.material) obj.material.envMapIntensity = 0.78;
      }
    }
  });
  return scene;
}

function cloneUnitAsset(entry) {
  const scene = SkeletonUtils.clone(entry.scene);
  const animations = entry.animations.map((clip) => clip.clone());
  prepareScene(scene);
  return { scene, animations };
}

function cloneStaticScene(scene) {
  const cloned = scene.clone(true);
  prepareScene(cloned);
  return cloned;
}

async function loadModelEntry(filename, root = 'buildings') {
  if (!filename) return null;
  const key = `${root}:${filename}`;
  if (cache.has(key)) return cache.get(key);
  const { gltf } = await loadFirst(getModelCandidates(filename, root));
  prepareScene(gltf.scene);
  const entry = {
    scene: gltf.scene,
    animations: gltf.animations || []
  };
  cache.set(key, entry);
  return entry;
}

export async function loadBuildingModel(filename) {
  const entry = await loadModelEntry(filename, 'buildings');
  return cloneStaticScene(entry.scene);
}

export async function loadDecorModel(filename) {
  const entry = await loadModelEntry(filename, 'decor');
  return cloneStaticScene(entry.scene);
}

export async function loadUnitModel(filename) {
  const entry = await loadModelEntry(filename, 'units');
  return cloneUnitAsset(entry);
}

export function makeFallbackMesh(color = 0xb4873e) {
  const group = new THREE.Group();
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 1, 1.2),
    new THREE.MeshStandardMaterial({ color, roughness: .86, metalness: .06 })
  );
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return group;
}
