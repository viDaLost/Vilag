import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

function makeCloudCluster() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xf8f1db, transparent: true, opacity: .2, roughness: 1 });
  for (let i = 0; i < 4; i++) {
    const puff = new THREE.Mesh(new THREE.SphereGeometry(4 + Math.random() * 3, 10, 10), mat);
    puff.scale.y = .45 + Math.random() * .15;
    puff.position.set((Math.random() - .5) * 18, Math.random() * 1.8, (Math.random() - .5) * 10);
    group.add(puff);
  }
  return group;
}

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 900 ? 1.6 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x1c120b, 34, 140);

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, .1, 800);
  camera.position.set(24, 26, 22);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .06;
  controls.maxDistance = 72;
  controls.minDistance = 10;
  controls.maxPolarAngle = Math.PI / 2.1;
  controls.minPolarAngle = Math.PI / 5;
  controls.enablePan = false;
  controls.target.set(0, 1, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), innerWidth < 800 ? .1 : .14, .35, .92));

  const hemi = new THREE.HemisphereLight(0xe8f4ff, 0x5a3818, .95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xffedc8, 1.25);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  scene.add(sun);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 28, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0x83c3ff) },
        bottomColor: { value: new THREE.Color(0xf5d8a3) },
        offset: { value: 20 },
        exponent: { value: .7 }
      },
      vertexShader: `varying vec3 vWorldPosition; void main(){ vec4 worldPosition = modelMatrix * vec4(position, 1.0); vWorldPosition = worldPosition.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main(){ float h = normalize(vWorldPosition + offset).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0); }`
    })
  );
  scene.add(sky);

  const stars = new THREE.Group();
  const starGeo = new THREE.SphereGeometry(.14, 6, 6);
  const starMat = new THREE.MeshBasicMaterial({ color: 0xfff6db });
  for (let i = 0; i < 160; i++) {
    const star = new THREE.Mesh(starGeo, starMat);
    const radius = 120 + Math.random() * 100;
    const angle = Math.random() * Math.PI * 2;
    const y = 15 + Math.random() * 90;
    star.position.set(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
    stars.add(star);
  }
  scene.add(stars);

  const world = new THREE.Group();
  scene.add(world);

  const cloudLayer = new THREE.Group();
  for (let i = 0; i < 10; i++) {
    const cloud = makeCloudCluster();
    const angle = (i / 10) * Math.PI * 2;
    const radius = 42 + Math.random() * 34;
    cloud.position.set(Math.cos(angle) * radius, 18 + Math.random() * 6, Math.sin(angle) * radius);
    cloud.userData.drift = .2 + Math.random() * .18;
    cloudLayer.add(cloud);
  }
  scene.add(cloudLayer);

  const worldBase = new THREE.Mesh(
    new THREE.CylinderGeometry(54, 64, 8, 48),
    new THREE.MeshStandardMaterial({ color: 0x3c2b18, roughness: 1 })
  );
  worldBase.position.y = -5.6;
  worldBase.receiveShadow = true;
  scene.add(worldBase);

  const groups = {
    tiles: new THREE.Group(),
    decor: new THREE.Group(),
    roads: new THREE.Group(),
    buildings: new THREE.Group(),
    ghosts: new THREE.Group(),
    units: new THREE.Group(),
    effects: new THREE.Group(),
    enemyCamps: new THREE.Group(),
    overlays: new THREE.Group(),
    backdrop: new THREE.Group(),
  };
  Object.values(groups).forEach((g) => world.add(g));

  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 900 ? 1.6 : 2));
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  }

  return { renderer, scene, camera, controls, composer, hemi, sun, sky, stars, cloudLayer, world, worldBase, groups, effectBursts: [], resize };
}
