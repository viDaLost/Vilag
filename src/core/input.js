import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { closeDrawer } from '../ui/drawer.js';
import { closeModal } from '../ui/modal.js';
import { sampleTerrain } from '../systems/world.js';

export function setupInput(sceneCtx, state, handlers) {
  const { camera, renderer, groups, controls } = sceneCtx;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  let down = { x: 0, y: 0, t: 0 };

  const closeTransientUi = (target) => {
    if (target.closest('#context-drawer, #bottom-dock, #top-bar, #hud-strip, #side-panels, #modal-window, #unit-action-menu')) return;
    closeDrawer();
    closeModal();
  };

  const updatePointer = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  };

  const makeTileFromPoint = (hitPoint, extra = {}) => {
    const terrain = sampleTerrain(state, hitPoint.x, hitPoint.z);
    return {
      isTile: true,
      pos: new THREE.Vector3(hitPoint.x, hitPoint.y ?? terrain.height ?? 0, hitPoint.z),
      surfaceY: hitPoint.y ?? terrain.height ?? 0,
      height: hitPoint.y ?? terrain.height ?? 0,
      type: terrain.type || 'grass',
      ...extra,
    };
  };

  const dispatchTile = (hitPoint, extra = {}) => {
    const point = hitPoint?.isVector3 ? hitPoint : hitPoint?.pos;
    if (!point?.isVector3) return;

    const now = performance.now();
    const tile = makeTileFromPoint(point, extra);

    // Fallback: check double tap based on position proximity
    const isDoubleTap = state.lastTapPos && point.distanceTo(state.lastTapPos) < 2.0 && (now - state.lastTapAt) <= GAME_CONFIG.doubleTapMs;

    state.lastTapPos = point.clone();
    state.lastTapAt = now;

    if (isDoubleTap && handlers.onTileDouble) handlers.onTileDouble(tile);
    else handlers.onTile(tile);
  };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return; // Only process left click for interaction
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    state.dragging = false;
  }, { passive: true });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) state.dragging = true;
  }, { passive: true });

  renderer.domElement.addEventListener('wheel', (e) => {
    if ('ontouchstart' in window) return;
    updatePointer(e);
    const hits = raycaster.intersectObject(groups.tiles, true);
    if (hits.length) {
      const p = hits[0].point;
      const target = new THREE.Vector3(p.x, Math.max(0, p.y), p.z);
      controls.target.lerp(target, .22);
    }
  }, { passive: true });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (e.button !== 0) return; // Only process left click for interaction
    if (state.dragging) return;
    if (performance.now() - down.t > 420) return;

    updatePointer(e);
    closeTransientUi(e.target);

    // 1. Check Units
    const unitHits = raycaster.intersectObjects(groups.units.children, true);
    if (unitHits.length) {
      let unitObj = unitHits[0].object;
      while (unitObj && !unitObj.userData.unitId && unitObj.parent) unitObj = unitObj.parent;
      const unitId = unitObj?.userData?.unitId;
      const unit = unitId ? state.units.find((u) => u.id === unitId) : state.units.find((u) => u.mesh === unitObj);
      if (unit) return handlers.onUnit(unit, e);
    }

    // 2. Check Buildings
    const buildingHits = raycaster.intersectObjects(groups.buildings.children, true);
    if (buildingHits.length) {
      let obj = buildingHits[0].object;
      while (obj && !obj.userData.buildingId && obj.parent) obj = obj.parent;
      const buildingId = obj?.userData?.buildingId;
      const building = state.buildings.find(b => b.id === buildingId);

      // If we clicked a building, we can synthesize a tile object representing the building's footprint
      if (building) {
        return dispatchTile(building.pos.clone().setY(building.surfaceY || building.pos.y || 0), { buildingId: building.id });
      }
    }

    // 3. Check enemy camps
    const campHits = raycaster.intersectObjects(groups.enemyCamps.children, true);
    if (campHits.length) {
      let campObject = campHits[0].object;
      while (campObject && !campObject.userData.campId && campObject.parent) campObject = campObject.parent;
      const camp = state.enemyCamps.find((candidate) => candidate.id === campObject?.userData?.campId);
      if (camp) return handlers.onCamp?.(camp, e);
    }

    // 4. Check Resource nodes (Decor)
    const decorHits = raycaster.intersectObjects(groups.decor.children, true);
    if (decorHits.length) {
      const hit = decorHits.find((candidate) => candidate.object?.userData?.resourceKind || candidate.object?.parent?.userData?.resourceKind);
      if (hit) {
        let obj = hit.object;
        while (obj && !obj.userData.resourceKind && obj.parent) obj = obj.parent;
        const list = obj?.userData?.resourceKind === 'tree' ? state.trees : state.rocks;
        const resource = Number.isInteger(hit.instanceId) ? list[hit.instanceId] : null;
        if (resource?.hp > 0) return handlers.onResource?.(resource, e);
      }
    }

    // 5. Check Terrain
    const hits = raycaster.intersectObject(sceneCtx.groups.tiles, true);
    const terrainHit = hits.find(h => h.object.name === 'terrain-mesh');

    if (terrainHit) {
        return dispatchTile(terrainHit.point);
    }

    state.selected = null;
    handlers.onEmpty?.();
  });

  renderer.domElement.addEventListener('pointercancel', () => {
    state.dragging = false;
  }, { passive: true });
}
