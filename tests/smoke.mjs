import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { chromium } from 'playwright-core';

const baseUrl = process.env.TEST_URL || 'http://127.0.0.1:5173';
const chromePath = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const scratchDir = path.resolve('.scratch/fusheng-paoying');
const screenshotDir = path.join(scratchDir, 'screenshots');
const backgroundFixturePath = path.join(scratchDir, 'test-background.png');
const cubeFixturePath = path.join(scratchDir, 'test-cube-face-256.png');
const imageFixturePath = path.join(scratchDir, 'test-memory.svg');
const videoFixturePath = path.join(scratchDir, 'test-memory.mp4');
const cubeFaceKeys = ['px', 'nx', 'py', 'ny', 'pz', 'nz'];

mkdirSync(screenshotDir, { recursive: true });
writeFileSync(
  imageFixturePath,
  `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="820" viewBox="0 0 1200 820">
    <rect width="1200" height="820" fill="#111d17"/>
    <rect x="84" y="110" width="380" height="560" fill="#a8ffd0"/>
    <rect x="520" y="180" width="520" height="300" fill="#ffbd78"/>
    <text x="92" y="742" font-family="Georgia, serif" font-size="72" font-weight="700" fill="#fff5e8">Test memory</text>
  </svg>`,
);

if (!existsSync(backgroundFixturePath)) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x123329:s=1600x900',
      '-frames:v',
      '1',
      backgroundFixturePath,
    ],
    { stdio: 'ignore' },
  );

  assert.equal(result.status, 0, 'ffmpeg should create a PNG background fixture');
}

if (!existsSync(cubeFixturePath)) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x183a2a:s=256x256',
      '-frames:v',
      '1',
      cubeFixturePath,
    ],
    { stdio: 'ignore' },
  );

  assert.equal(result.status, 0, 'ffmpeg should create a PNG cube face fixture');
}

if (!existsSync(videoFixturePath)) {
  const result = spawnSync(
    'ffmpeg',
    [
      '-y',
      '-f',
      'lavfi',
      '-i',
      'color=c=0x132019:s=320x180:d=1.2',
      '-f',
      'lavfi',
      '-i',
      'sine=frequency=440:duration=1.2',
      '-shortest',
      '-pix_fmt',
      'yuv420p',
      '-c:v',
      'libx264',
      '-c:a',
      'aac',
      '-movflags',
      '+faststart',
      videoFixturePath,
    ],
    { stdio: 'ignore' },
  );

  assert.equal(result.status, 0, 'ffmpeg should create a video fixture');
}

async function clickVisible(page, selector) {
  const locator = page.locator(selector);
  const count = await locator.count();

  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) {
      await candidate.click();
      return;
    }
  }

  throw new Error(`No visible element for selector: ${selector}`);
}

async function hoverAnyBubble(page, viewport) {
  const positions = [
    [viewport.width * 0.5, viewport.height * 0.48],
    [viewport.width * 0.38, viewport.height * 0.42],
    [viewport.width * 0.62, viewport.height * 0.42],
    [viewport.width * 0.46, viewport.height * 0.62],
    [viewport.width * 0.58, viewport.height * 0.58],
  ];

  for (const [x, y] of positions) {
    await page.mouse.move(x, y);
    await page.waitForTimeout(160);
    const visible = await page.locator('#bubble-hint').evaluate((node) => !node.hidden);
    if (visible) return true;
  }

  return false;
}

async function assertCanvasNonBlank(page, label) {
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#memory-canvas');
    const gl = canvas?.getContext('webgl2') || canvas?.getContext('webgl');
    if (!canvas || !gl || gl.drawingBufferWidth <= 0 || gl.drawingBufferHeight <= 0) return false;

    const width = Math.min(40, gl.drawingBufferWidth);
    const height = Math.min(40, gl.drawingBufferHeight);
    const x = Math.max(0, Math.floor((gl.drawingBufferWidth - width) / 2));
    const y = Math.max(0, Math.floor((gl.drawingBufferHeight - height) / 2));
    const pixels = new Uint8Array(width * height * 4);
    gl.readPixels(x, y, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);

    let visiblePixels = 0;
    for (let index = 0; index < pixels.length; index += 4) {
      const alpha = pixels[index + 3];
      const brightness = pixels[index] + pixels[index + 1] + pixels[index + 2];
      if (alpha > 0 && brightness > 12) visiblePixels += 1;
    }

    return visiblePixels > width * height * 0.03;
  }, null, { timeout: 5000 }).catch((error) => {
    throw new Error(`${label} canvas should render nonblank: ${error.message}`);
  });
}

async function assertNoHorizontalOverflow(page, label) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));

  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 2,
    `${label} should not create horizontal overflow (${metrics.scrollWidth} > ${metrics.clientWidth})`,
  );
}

async function openSettings(page) {
  await clickVisible(page, '[data-action="settings"]');
  await page.waitForSelector('#settings-panel:not([hidden])');
}

async function runViewport(browser, name, viewport) {
  const errors = [];
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
    isMobile: viewport.width < 700,
    hasTouch: viewport.width < 700,
  });

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#memory-canvas');
  await page.waitForSelector('#empty-state:not([hidden])');
  await assertCanvasNonBlank(page, `${name} empty`);
  await assertNoHorizontalOverflow(page, `${name} empty`);
  await page.screenshot({
    path: path.join(screenshotDir, `${name}-empty.png`),
    fullPage: true,
  });

  await page.click('#empty-state [data-action="sample"]');
  await page.waitForFunction(() =>
    !document.querySelector('#memory-count')?.textContent?.startsWith('0 '),
  );

  if (viewport.width >= 700) {
    const hovered = await hoverAnyBubble(page, viewport);
    assert.ok(hovered, 'desktop hover should reveal the bubble hint');
  }

  await page.setInputFiles('#file-input', [imageFixturePath, videoFixturePath]);
  await page.waitForFunction(() =>
    document.querySelector('#memory-count')?.textContent?.startsWith('2 '),
  );

  await openSettings(page);
  await page.locator('#bubble-size').evaluate((input) => {
    input.value = '160';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() =>
    document.querySelector('#bubble-size-value')?.textContent === '1.6x',
  );
  await page.click('#background-button');
  await page.waitForSelector('#background-modal:not([hidden])');
  assert.equal(await page.locator('[data-background-mode="cube"]').count(), 1);
  assert.equal(await page.locator('[data-background-mode]').count(), 4);
  await page.click('[data-background-mode="cube"]');
  for (const faceKey of cubeFaceKeys) {
    await page.click(`[data-cube-face="${faceKey}"]`);
    await page.setInputFiles('#cube-background-input', cubeFixturePath);
    await page.waitForFunction(
      (key) => Boolean(document.querySelector(`[data-cube-face="${key}"] img`)),
      faceKey,
    );
  }
  await page.waitForFunction(() => !document.querySelector('#background-apply')?.disabled);
  await page.click('#background-apply');
  await page.waitForFunction(() =>
    document.querySelector('#status-line')?.textContent?.includes('Cube 背景已启用'),
  );
  await page.waitForFunction(() => document.querySelector('#background-modal')?.hidden === true);
  await openSettings(page);
  await page.click('#background-button');
  await page.waitForSelector('#background-modal:not([hidden])');
  await page.click('[data-background-mode="flat"]');
  await page.setInputFiles('#background-input', backgroundFixturePath);
  await page.waitForFunction(() => !document.querySelector('#background-apply')?.disabled);
  await page.click('#background-apply');
  await page.waitForFunction(() =>
    document.querySelector('#status-line')?.textContent?.includes('普通背景已更新'),
  );
  await page.waitForFunction(() => document.querySelector('#background-modal')?.hidden === true);
  await page.waitForTimeout(900);
  await assertCanvasNonBlank(page, `${name} browsing`);
  await assertNoHorizontalOverflow(page, `${name} browsing`);
  await page.screenshot({
    path: path.join(screenshotDir, `${name}-space.png`),
    fullPage: true,
  });

  await clickVisible(page, '[data-action="random"]');
  await page.waitForSelector('#focus-view:not([hidden]) .focused-media');

  const mediaBox = await page.locator('.focused-media').boundingBox();
  assert.ok(mediaBox, 'focused media should have a bounding box');
  assert.ok(mediaBox.width > 120, 'focused media should be visible');
  assert.ok(mediaBox.height > 90, 'focused media should be visible');

  const title = await page.textContent('#focus-title');
  assert.ok(title && title.trim().length > 0, 'focused memory title should render');

  await page.screenshot({
    path: path.join(screenshotDir, `${name}-focus.png`),
    fullPage: true,
  });

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#focus-view')?.hidden === true);

  await page.locator('[data-memory-open]').nth(1).evaluate((button) => button.click());
  await page.waitForSelector('#focus-view:not([hidden]) video.focused-media');
  await page.click('#focus-view [data-audio-toggle]');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-audio-toggle]')).every(
      (button) => button.getAttribute('aria-pressed') === 'true',
    ),
  );
  await page.click('#focus-view [data-audio-toggle]');
  await page.waitForFunction(() =>
    Array.from(document.querySelectorAll('[data-audio-toggle]')).every(
      (button) => button.getAttribute('aria-pressed') === 'false',
    ),
  );
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#focus-view')?.hidden === true);

  await openSettings(page);
  await page.click('#parallax-button');
  await page.waitForTimeout(250);
  await page.click('#parallax-button');
  await page.click('#reset-button');
  await page.waitForFunction(() => document.querySelector('#reset-button')?.disabled === true);

  assert.deepEqual(errors, []);
  await page.close();
}

async function runResponsiveProbe(browser, name, viewport) {
  const errors = [];
  const page = await browser.newPage({
    viewport,
    deviceScaleFactor: 1,
    isMobile: true,
    hasTouch: true,
  });

  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForSelector('#empty-state:not([hidden])');
  await assertCanvasNonBlank(page, `${name} empty`);
  await assertNoHorizontalOverflow(page, `${name} empty`);
  await page.screenshot({
    path: path.join(screenshotDir, `${name}-empty.png`),
    fullPage: true,
  });

  await page.click('#empty-state [data-action="sample"]');
  await page.waitForFunction(() =>
    !document.querySelector('#memory-count')?.textContent?.startsWith('0 '),
  );
  await assertCanvasNonBlank(page, `${name} browsing`);
  await clickVisible(page, '[data-action="random"]');
  await page.waitForSelector('#focus-view:not([hidden]) .focused-media');
  await assertNoHorizontalOverflow(page, `${name} focus`);
  await page.screenshot({
    path: path.join(screenshotDir, `${name}-focus.png`),
    fullPage: true,
  });
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#focus-view')?.hidden === true);

  assert.deepEqual(errors, []);
  await page.close();
}

async function runReducedMotion(browser) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.body.classList.contains('reduced-motion'));
  await page.click('#empty-state [data-action="sample"]');
  await page.waitForFunction(() =>
    !document.querySelector('#memory-count')?.textContent?.startsWith('0 '),
  );
  await clickVisible(page, '[data-action="random"]');
  await page.waitForSelector('#focus-view:not([hidden]) .focused-media');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => document.querySelector('#focus-view')?.hidden === true);
  await page.close();
}

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu-sandbox', '--disable-dev-shm-usage'],
});

try {
  await runViewport(browser, 'desktop', { width: 1440, height: 920 });
  await runViewport(browser, 'mobile', { width: 390, height: 844 });
  await runResponsiveProbe(browser, 'android', { width: 412, height: 915 });
  await runResponsiveProbe(browser, 'landscape', { width: 844, height: 390 });
  await runReducedMotion(browser);
  console.log(`Smoke screenshots saved to ${screenshotDir}`);
} finally {
  await browser.close();
}
