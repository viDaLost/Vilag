import { chromium } from 'playwright';

const executablePath = process.env.CHROMIUM_PATH;
if (!executablePath) throw new Error('CHROMIUM_PATH is required');

const profiles = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false },
  { name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'tablet', viewport: { width: 1024, height: 768 }, isMobile: true, hasTouch: true },
];

const results = [];
for (const profile of profiles) {
  const browser = await chromium.launch({
    executablePath,
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--no-zygote',
      '--single-process',
      '--use-gl=angle',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
    ],
  });
  const context = await browser.newContext({
    viewport: profile.viewport,
    isMobile: profile.isMobile,
    hasTouch: profile.hasTouch,
    ignoreHTTPSErrors: true,
  });
  const page = await context.newPage();
  const errors = [];
  const failedRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', (request) => failedRequests.push(`${request.method()} ${request.url()} — ${request.failure()?.errorText}`));

  const startedAt = Date.now();
  await page.goto('http://127.0.0.1:8765/', { waitUntil: 'domcontentloaded', timeout: 30_000 });
  let loadingReleased = true;
  try {
    await page.waitForFunction(() => getComputedStyle(document.querySelector('#loading-screen')).display === 'none', null, { timeout: 15_000 });
  } catch {
    loadingReleased = false;
  }
  const loadMs = Date.now() - startedAt;
  if (loadingReleased) await page.locator('[data-modal-action="0"]').click({ timeout: 10_000 });
  await page.waitForTimeout(2500);

  const snapshot = await page.evaluate(() => ({
    canvas: document.querySelector('#game')?.getBoundingClientRect().toJSON(),
    topBar: document.querySelector('#top-bar')?.getBoundingClientRect().toJSON(),
    bottomDock: document.querySelector('#bottom-dock')?.getBoundingClientRect().toJSON(),
    drawerVisible: getComputedStyle(document.querySelector('#context-drawer')).display !== 'none',
    resourceCards: [...document.querySelectorAll('.res-card')].filter((el) => getComputedStyle(el).display !== 'none').length,
    buttons: [...document.querySelectorAll('[data-action]')].map((el) => ({ label: el.textContent.trim(), rect: el.getBoundingClientRect().toJSON() })),
    webgl: Boolean(document.querySelector('#game')?.getContext('webgl2') || document.querySelector('#game')?.getContext('webgl')),
    memory: performance.memory ? {
      usedJSHeapSize: performance.memory.usedJSHeapSize,
      totalJSHeapSize: performance.memory.totalJSHeapSize,
    } : null,
  }));

  await page.screenshot({ path: `/tmp/vilageses-${profile.name}-baseline.png`, fullPage: true });
  results.push({ name: profile.name, loadMs, loadingReleased, errors, failedRequests, snapshot });
  await context.close();
  await browser.close();
}

console.log(JSON.stringify(results, null, 2));
