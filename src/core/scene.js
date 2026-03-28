import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

function makeCloudCluster() {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xfaf3e1, transparent: true, opacity: .28, roughness: 1 });
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
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 900 ? 1.5 : 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = innerWidth < 760 ? 1.45 : 1.35;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xded7c8, 95, 250);

  const camera = new THREE.PerspectiveCamera(innerWidth < 760 ? 52 : 50, innerWidth / innerHeight, .1, 800);
  camera.position.set(innerWidth < 760 ? 18 : 22, innerWidth < 760 ? 21 : 26, innerWidth < 760 ? 18 : 21);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = .065;
  controls.maxDistance = innerWidth < 760 ? 56 : 108;
  controls.minDistance = innerWidth < 760 ? 11 : 5;
  controls.maxPolarAngle = Math.PI / 2.08;
  controls.minPolarAngle = Math.PI / 4.9;
  controls.enablePan = !('ontouchstart' in window);
  controls.screenSpacePanning = false;
  controls.panSpeed = .9;
  controls.zoomSpeed = 1.18;
  if ('zoomToCursor' in controls) controls.zoomToCursor = true;
  controls.target.set(0, 1.4, 0);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), innerWidth < 800 ? .11 : .09, .35, .96));

  const hemi = new THREE.HemisphereLight(0xf8f7f2, 0xbba98a, 2.0);
  scene.add(hemi);
  const ambient = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambient);
  const fill = new THREE.DirectionalLight(0xfff8ea, 0.9);
  fill.position.set(-26, 28, 16);
  scene.add(fill);

  const sun = new THREE.DirectionalLight(0xfff2d6, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -70;
  sun.shadow.camera.right = 70;
  sun.shadow.camera.top = 70;
  sun.shadow.camera.bottom = -70;
  sun.shadow.bias = -0.00014;
  scene.add(sun);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(320, 28, 18),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        topColor: { value: new THREE.Color(0xbfd8ef) },
        bottomColor: { value: new THREE.Color(0xf6f0e4) },
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
    new THREE.MeshStandardMaterial({ color: 0x5a4129, roughness: 1 })
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
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, innerWidth < 900 ? 1.5 : 2));
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
  }

  return { renderer, scene, camera, controls, composer, hemi, ambient, fill, sun, sky, stars, cloudLayer, world, worldBase, groups, effectBursts: [], resize };
}
