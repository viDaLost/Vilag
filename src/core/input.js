import * as THREE from 'three';
import { MOUSE } from 'three';
import { GAME_CONFIG } from '../config.js';
import { closeDrawer } from '../ui/drawer.js';
import { closeModal } from '../ui/modal.js';

export function setupInput(sceneCtx, state, handlers) {
  const { camera, renderer, groups, controls } = sceneCtx;
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hitPoint = new THREE.Vector3();
  let down = { x: 0, y: 0, t: 0 };

  controls.mouseButtons.LEFT = MOUSE.ROTATE;
  controls.mouseButtons.MIDDLE = MOUSE.PAN;
  controls.mouseButtons.RIGHT = MOUSE.ROTATE;

  const closeTransientUi = (target) => {
    if (target.closest('#context-drawer, #bottom-dock, #top-bar, #hud-strip, #side-panels, #modal-window')) return;
    closeDrawer();
    closeModal();
  };

  const updatePointer = (e) => {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  };

  const findNearestTile = () => {
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return null;
    let best = null;
    let bestDist = Infinity;
    for (const tile of state.map) {
      const dx = hitPoint.x - tile.pos.x;
      const dz = hitPoint.z - tile.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < bestDist) {
        bestDist = dist;
        best = tile;
      }
    }
    return bestDist <= GAME_CONFIG.hexSize * 1.15 ? best : null;
  };

  const dispatchTile = (tile) => {
    const now = performance.now();
    const isDoubleTap = state.lastTapTileId === tile.id && (now - state.lastTapAt) <= GAME_CONFIG.doubleTapMs;
    state.lastTapTileId = tile.id;
    state.lastTapAt = now;
    if (isDoubleTap && handlers.onTileDouble) handlers.onTileDouble(tile);
    else handlers.onTile(tile);
  };

  renderer.domElement.addEventListener('pointerdown', (e) => {
    down = { x: e.clientX, y: e.clientY, t: performance.now() };
    state.dragging = false;
  }, { passive: true });

  renderer.domElement.addEventListener('pointermove', (e) => {
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) state.dragging = true;
  }, { passive: true });

  renderer.domElement.addEventListener('wheel', (e) => {
    if ('ontouchstart' in window) return;
    updatePointer(e);
    if (!raycaster.ray.intersectPlane(groundPlane, hitPoint)) return;
    const target = new THREE.Vector3(hitPoint.x, Math.max(0, hitPoint.y), hitPoint.z);
    controls.target.lerp(target, .22);
  }, { passive: true });

  renderer.domElement.addEventListener('pointerup', (e) => {
    if (state.dragging) return;
    if (performance.now() - down.t > 420) return;

    updatePointer(e);
    closeTransientUi(e.target);

    const unitHits = raycaster.intersectObjects(groups.units.children, true);
    if (unitHits.length) {
      const unitObj = unitHits[0].object;
      const unit = state.units.find((u) => u.mesh === unitObj.parent || u.mesh === unitObj || u.mesh.children.includes(unitObj));
      if (unit) return handlers.onUnit(unit);
    }

    const buildingHits = raycaster.intersectObjects(groups.buildings.children, true);
    if (buildingHits.length) {
      let obj = buildingHits[0].object;
      while (obj && !obj.userData.tileId && obj.parent) obj = obj.parent;
      const tileId = obj?.userData?.tileId;
      const tile = tileId ? state.mapIndex.get(tileId) : null;
      if (tile) return dispatchTile(tile);
    }

    const hits = raycaster.intersectObjects(groups.overlays.children, false);
    if (hits.length) {
      const tile = state.map.find((t) => t.mesh === hits[0].object);
      if (tile) return dispatchTile(tile);
    }

    const fallbackTile = findNearestTile();
    if (fallbackTile) return dispatchTile(fallbackTile);

    state.selected = null;
    handlers.onEmpty?.();
  });
}
