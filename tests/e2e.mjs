import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error('Set CHROMIUM_PATH to a Chromium executable');

const launchArgs = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote',
  '--single-process', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
];

async function launch() {
  return chromium.launch({ executablePath, headless: true, args: launchArgs });
}

async function openGame(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto('http://127.0.0.1:8765/?debug=1', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.waitForFunction(() => window.__EMPIRE_DEBUG__ && getComputedStyle(document.querySelector('#loading-screen')).display === 'none', null, { timeout: 20_000 });
  await page.locator('[data-modal-action="0"]').click();
  return errors;
}

{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  const errors = await openGame(page);

  const initial = await page.evaluate(() => {
    const { state } = window.__EMPIRE_DEBUG__;
    return {
      buildings: state.buildings.map((building) => building.type),
      workers: state.units.filter((unit) => unit.type === 'worker').length,
      hostile: state.units.filter((unit) => unit.hostile).length,
      camps: state.enemyCamps.length,
      trees: state.trees.length,
      rocks: state.rocks.length,
      roads: state.roads.length,
      food: state.resources.food,
    };
  });
  assert.deepEqual(new Set(initial.buildings), new Set(['capital', 'farm', 'lumber', 'mine']));
  assert.equal(initial.workers, 3);
  assert.equal(initial.camps, 4);
  assert.ok(initial.hostile >= 4);
  assert.ok(initial.trees + initial.rocks >= 35);
  assert.equal(initial.roads, 3);

  const campScreenPoint = await page.evaluate(() => {
    const { state, sceneCtx } = window.__EMPIRE_DEBUG__;
    const camp = state.enemyCamps[0];
    sceneCtx.controls.target.copy(camp.pos);
    sceneCtx.camera.position.set(camp.pos.x + 8, camp.pos.y + 9, camp.pos.z + 8);
    sceneCtx.camera.lookAt(camp.pos);
    sceneCtx.controls.update();
    sceneCtx.render();
    const projected = camp.pos.clone().setY(camp.pos.y + .28).project(sceneCtx.camera);
    return {
      x: (projected.x * .5 + .5) * innerWidth,
      y: (projected.y * -.5 + .5) * innerHeight,
    };
  });
  await page.mouse.click(campScreenPoint.x, campScreenPoint.y);
  assert.equal(await page.locator('[data-camp-action="attack"]').count(), 1);
  assert.match(await page.locator('#drawer-title').textContent(), /кланы|мятежники|всадники/i);
  await page.locator('#drawer-close').click();

  const simulated = await page.evaluate(() => {
    const debug = window.__EMPIRE_DEBUG__;
    const beforeFood = debug.state.resources.food;
    const capital = debug.state.buildings.find((building) => building.type === 'capital');
    capital.trainQueue.push({ type: 'worker', progress: 0, trainTime: 8 });
    for (let i = 0; i < 240; i++) debug.stepSimulation(.05);
    return {
      beforeFood,
      afterFood: debug.state.resources.food,
      workers: debug.state.units.filter((unit) => unit.type === 'worker').length,
      population: debug.state.resources.population,
    };
  });
  assert.ok(simulated.afterFood > simulated.beforeFood);
  assert.equal(simulated.workers, 4);
  assert.equal(simulated.population, 5);

  const placed = await page.evaluate(() => {
    const debug = window.__EMPIRE_DEBUG__;
    let job = null;
    for (let radius = 8; radius <= debug.state.territoryRadius && !job; radius += 1.4) {
      for (let i = 0; i < 24 && !job; i++) {
        const angle = i / 24 * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        job = debug.tryPlaceBuilding({ pos: { x, z } }, 'market');
      }
    }
    if (!job) return false;
    for (let i = 0; i < 420; i++) debug.stepSimulation(.05);
    return debug.state.buildings.some((building) => building.type === 'market');
  });
  assert.equal(placed, true);

  await page.locator('[data-action="build-menu"]').click();
  assert.equal(await page.locator('[data-build-type]').count(), 12);
  await page.locator('#drawer-close').click();
  await page.locator('[data-speed="0"]').click();
  assert.equal(await page.locator('[data-speed="0"]').getAttribute('class'), 'speed-btn active');
  await page.evaluate(() => window.__EMPIRE_DEBUG__.save());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__EMPIRE_DEBUG__ && getComputedStyle(document.querySelector('#loading-screen')).display === 'none', null, { timeout: 20_000 });
  const restored = await page.evaluate(() => ({
    market: window.__EMPIRE_DEBUG__.state.buildings.some((building) => building.type === 'market'),
    workers: window.__EMPIRE_DEBUG__.state.units.filter((unit) => unit.type === 'worker').length,
  }));
  assert.equal(restored.market, true);
  assert.ok(restored.workers >= 4);
  assert.deepEqual(errors, []);
  await browser.close();
}

{
  const browser = await launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.addInitScript(() => localStorage.clear());
  const errors = await openGame(page);
  await page.locator('[data-action="build-menu"]').click();
  const layout = await page.evaluate(() => {
    const drawer = document.querySelector('#context-drawer').getBoundingClientRect();
    const dock = document.querySelector('#bottom-dock').getBoundingClientRect();
    const cards = [...document.querySelectorAll('.res-card')].filter((element) => getComputedStyle(element).display !== 'none');
    return { drawerBottom: drawer.bottom, dockTop: dock.top, cards: cards.length, bodyWidth: document.body.scrollWidth };
  });
  assert.ok(layout.drawerBottom <= layout.dockTop + 1, `mobile drawer must not be hidden by the action dock: ${JSON.stringify(layout)}`);
  assert.equal(layout.cards, 9);
  assert.equal(layout.bodyWidth, 390);
  assert.deepEqual(errors, []);
  await browser.close();
}

console.log('E2E: desktop simulation, save/restore and mobile layout passed');
