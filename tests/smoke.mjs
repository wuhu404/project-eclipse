// 部署冒烟测试：ECLIPSE_URL=https://<user>.github.io/<repo>/ node tests/smoke.mjs
// 检查：资源无 404 / 加载失败、无控制台错误、能进入游戏并开火、刷新后正常、小窗口与触屏设备的界面。
import { launch, startNewGame, shot, snap, URL } from './lib.mjs';
let failed = 0;
const check = (name, ok, detail = '') => { if (!ok) failed++; console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`); };
const watch = (page, bad) => {
  page.on('response', (r) => { if (r.status() >= 400) bad.push(`${r.status()} ${r.url()}`); });
  page.on('requestfailed', (r) => bad.push(`FAILED ${r.url()} ${r.failure()?.errorText}`));
};
console.log('URL', URL);
const { browser, page, errors } = await launch({ query: '' });
const bad = [];
watch(page, bad);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__ECLIPSE__?.ready, null, { timeout: 180000 });
const res = await page.evaluate(() => performance.getEntriesByType('resource').map((r) => r.name.split('/').slice(-1)[0]));
check('刷新后页面重新加载完成，主菜单可见', await page.isVisible('#btn-new'), res.join(', '));
check('所有资源请求成功（无 404 / MIME / 跨域失败）', bad.length === 0, bad.join(' | '));
await startNewGame(page);
const s0 = await snap(page);
check('点击"开始新任务 → 部署"后进入游戏', s0.state === 'playing');
await page.waitForTimeout(3000);
await page.mouse.down(); await page.waitForTimeout(1200); await page.mouse.up();
await page.keyboard.down('w'); await page.waitForTimeout(1500); await page.keyboard.up('w');
const s1 = await snap(page);
console.log('    ·', JSON.stringify(s1).slice(0, 400));
await shot(page, 'smoke-desktop');
check('实时主循环在运行（非测试模式）', JSON.stringify(s0) !== JSON.stringify(s1));
check('无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
// 小窗口：简报按钮必须可点
const small = await browser.newPage({ viewport: { width: 640, height: 360 } });
await small.goto(URL, { waitUntil: 'load' });
await small.waitForFunction(() => window.__ECLIPSE__?.ready, null, { timeout: 180000 });
await small.click('#btn-new');
let ok = true;
try { await small.click('#btn-brief-back', { timeout: 40000 }); } catch { ok = false; }
check('640×360 小窗口下简报界面按钮可点击', ok);
await small.close();
// 触屏手机
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const m = await ctx.newPage();
const mErr = [];
m.on('pageerror', (e) => mErr.push(e.message));
await m.goto(URL, { waitUntil: 'load' });
await m.waitForFunction(() => window.__ECLIPSE__?.ready || window.__ECLIPSE__?.error, null, { timeout: 180000 });
await m.waitForTimeout(1200);
await m.screenshot({ path: new globalThis.URL('./out/smoke-mobile.png', import.meta.url).pathname });
check('手机视口：主菜单加载且显示"需要键盘鼠标"提示', await m.isVisible('#touch-note') && await m.isVisible('#btn-new'), mErr.join(' | '));
const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
check('手机视口：页面无横向溢出', overflow <= 0, `overflow=${overflow}px`);
await browser.close();
console.log(failed ? `失败 ${failed} 项` : '全部通过');
process.exit(failed ? 1 : 0);
