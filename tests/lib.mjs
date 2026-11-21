// 测试公共工具：启动 headless Chrome（SwiftShader 软件渲染）并打开游戏
import { chromium } from 'playwright-core';
import fs from 'node:fs';

export const URL = process.env.ECLIPSE_URL || 'http://localhost:5173/';
export const OUT = new globalThis.URL('./out/', import.meta.url).pathname;

function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/.devin/chrome/chrome/linux-156.0.8078.47/chrome-linux64/chrome',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('找不到 Chrome，可通过 CHROME_PATH 指定');
}

export async function launch({ width = 1280, height = 720, query = '?test=1' } = {}) {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({
    executablePath: findChrome(),
    headless: true,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--enable-webgl', '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--no-sandbox', `--window-size=${width},${height}`],
  });
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message + '\n' + (e.stack || '')));
  await page.goto(URL + query, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__ECLIPSE__ && (window.__ECLIPSE__.ready || window.__ECLIPSE__.error), null, { timeout: 180000 });
  const err = await page.evaluate(() => window.__ECLIPSE__.error);
  if (err) throw new Error('游戏初始化失败: ' + err + '\n' + errors.join('\n'));
  return { browser, page, errors };
}

export const snap = (page) => page.evaluate(() => window.__ECLIPSE__.snapshot());
export const shot = (page, name) => page.screenshot({ path: OUT + name + '.png' });

/** 等待渲染若干帧（manual 模式下 RAF 仍在渲染） */
export const frames = (page, n = 2) =>
  page.evaluate(
    (n) =>
      new Promise((res) => {
        const f = () => (--n <= 0 ? res() : requestAnimationFrame(f));
        requestAnimationFrame(f);
      }),
    n,
  );

/** 从主菜单开始新游戏，进入 playing 状态 */
export async function startNewGame(page) {
  await page.evaluate(() => window.__ECLIPSE__.virtualLock(true));
  await page.click('#btn-new');
  await page.click('#btn-deploy');
  await page.waitForFunction(() => window.__ECLIPSE__.snapshot().state === 'playing', null, { timeout: 20000 });
}

export const step = (page, seconds, dt = 1 / 60) => page.evaluate(([s, dt]) => window.__ECLIPSE__.step(dt, Math.round(s / dt)), [seconds, dt]);
