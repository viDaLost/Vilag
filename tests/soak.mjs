import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error('Set CHROMIUM_PATH to a Chromium executable');

const browser = await chromium.launch({
  executablePath,
  headless: true,
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--no-zygote', '--single-process', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
});
const context = await browser.newContext({ viewport: { width: 1280, height: 720 } });
const page = await context.newPage();
await page.addInitScript(() => localStorage.clear());
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
await page.goto('http://127.0.0.1:8765/?debug=1', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => window.__EMPIRE_DEBUG__ && getComputedStyle(document.querySelector('#loading-screen')).display === 'none', null, { timeout: 20_000 });
await page.locator('[data-modal-action="0"]').click();

const result = await page.evaluate(() => {
  const debug = window.__EMPIRE_DEBUG__;
  for (let i = 0; i < 3600; i++) debug.stepSimulation(.05);
  const numericValues = [
    ...Object.values(debug.state.resources),
    ...debug.state.units.flatMap((unit) => [unit.hp, unit.pos.x, unit.pos.y, unit.pos.z]),
    ...debug.state.buildings.flatMap((building) => [building.hp, building.pos.x, building.pos.y, building.pos.z]),
  ];
  const capital = debug.state.buildings.find((building) => building.type === 'capital');
  return {
    worldTime: debug.state.worldTime,
    waveIndex: debug.state.aiState.waveIndex,
    unitCount: debug.state.units.length,
    hostileCount: debug.state.units.filter((unit) => unit.hostile).length,
    camps: debug.state.enemyCamps.length,
    capitalHp: capital?.hp || 0,
    finite: numericValues.every(Number.isFinite),
    maxResource: Math.max(...Object.values(debug.state.resources).filter(Number.isFinite)),
  };
});

assert.ok(result.worldTime >= 179);
assert.ok(result.waveIndex >= 1, 'enemy AI should launch at least one raid');
assert.ok(result.unitCount < 80, 'NPC population must remain bounded');
assert.ok(result.hostileCount > 0);
assert.ok(result.camps > 0);
assert.ok(result.capitalHp > 0, 'an unattended settlement should survive long enough for onboarding');
assert.equal(result.finite, true);
assert.ok(result.maxResource < 10_000);
assert.deepEqual(errors, []);

await browser.close();
console.log(`SOAK: ${Math.round(result.worldTime)}s, wave ${result.waveIndex}, ${result.unitCount} units, capital ${Math.round(result.capitalHp)} HP`);
