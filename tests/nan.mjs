// 开发用：扫描 HDR 帧缓冲中的 NaN / Inf / 负值（真机上会被 Bloom 扩散成黑块）
import { launch, startNewGame, step, shot, frames } from './lib.mjs';
const { browser, page, errors } = await launch();
await startNewGame(page);
await page.setViewportSize({ width: 640, height: 360 });
await page.waitForTimeout(500);
await page.evaluate(() => {
  const e = window.__ECLIPSE__;
  const g = e.game;
  e.god(true);
  window.__scan = (label) => {
    const gfx = g.gfx;
    gfx.render();
    const r = gfx.renderer;
    const rt = gfx.composer.readBuffer;
    const w = rt.width, h = rt.height;
    const buf = new Uint16Array(w * h * 4);
    r.readRenderTargetPixels(rt, 0, 0, w, h, buf);
    let nan = 0, inf = 0, neg = 0, max = 0, big = 0;
    let fx = -1, fy = -1;
    for (let i = 0; i < buf.length; i += 4) {
      for (let c = 0; c < 3; c++) {
        const v = buf[i + c];
        const ex = (v >> 10) & 31, m = v & 1023, s = v >> 15;
        if (ex === 31) { if (m) nan++; else inf++; if (fx < 0) { fx = (i / 4) % w; fy = Math.floor(i / 4 / w); } continue; }
        const f = (ex === 0 ? m / 1024 * 2 ** -14 : (1 + m / 1024) * 2 ** (ex - 15));
        if (s && f > 1e-4) neg++;
        if (f > max) max = f;
        if (f > 1000) big++;
      }
    }
    return `${label}: nan=${nan} inf=${inf} neg=${neg} max=${max.toFixed(1)} >1000:${big}` + (fx >= 0 ? ` first@(${fx},${h - fy})/${w}x${h}` : '');
  };
});
const scan = async (label) => { const r = await page.evaluate((l) => window.__scan(l), label); if (!/nan=0 inf=0 neg=0/.test(r)) console.log('!! ' + r); return r; };
const out = [];
const views = { lz: [0, 54.6, 0, 0, 0], gate: [0, 26, 0, 0.05, 0], hangar: [0, 6, 0, 0.05, 0], hangar2: [14, -6, 0.9, 0.1, 0], catwalk: [19.5, -12, 0.6, -0.25, 4.25], control: [19.5, -33, 0.5, -0.1, 4.25], corridor: [0, -43, 0, 0, 0], lab: [0, -59, 0, 0, 0], labE: [8, -70, -1.2, 0, 0], hall: [0, -112, 0, 0.1, 0], hall2: [-15, -140, -2.3, 0.1, 0], power: [0, -145, 0, 0.05, 0], core: [0, -170, 0, 0, 0], arena: [0, -187, 0, 0.15, 0], arena2: [18, -200, 1.2, 0.2, 0] };
for (const [name, [x, z, yaw, pitch, y]] of Object.entries(views)) {
  await page.evaluate(([x, z, yaw, pitch, y]) => { const e = window.__ECLIPSE__; e.teleport(x, z, yaw, y + 0.02); e.look(yaw, pitch); e.game.level.playerHidden = true; }, [x, z, yaw, pitch, y]);
  await step(page, 0.6);
  out.push(await scan(name));
  console.log(out[out.length - 1]);
  // 原地环视一圈
  for (let k = 1; k < 4; k++) {
    await page.evaluate(([yaw, k]) => { window.__ECLIPSE__.look(yaw + k * Math.PI / 2, (k % 3 - 1) * 0.5); window.__ECLIPSE__.step(1 / 30, 2); }, [yaw, k]);
    out.push(await scan(name + ' rot' + k));
  }
}
console.log(out.filter((l) => !/nan=0 inf=0 neg=0/.test(l)).join('\n') || 'static views clean');
console.log('max values:', out.map((l) => l.replace(/:.*max=([\d.]+).*/, '=$1')).join(' '));
// 开火：三把枪
const fire = [];
await page.evaluate(() => { const e = window.__ECLIPSE__; const g = e.game; g.level.playerHidden = false; g.weapons.give('viper', false); g.weapons.give('helix', false); e.teleport(0, 6, 0); e.look(0, 0); e.step(1 / 30, 10); });
for (const k of ['Digit1', 'Digit2', 'Digit3']) {
  await page.evaluate((k) => { const e = window.__ECLIPSE__; e.key(k, true); e.step(1 / 30, 2); e.key(k, false); e.step(1 / 30, 25); e.key('Mouse0', true); }, k);
  for (let i = 0; i < 14; i++) { await page.evaluate(() => window.__ECLIPSE__.step(1 / 60, 1)); fire.push(await scan(k + ' f' + i)); }
  await page.evaluate(() => { window.__ECLIPSE__.key('Mouse0', false); window.__ECLIPSE__.step(1 / 30, 20); });
}
// 爆炸
await page.evaluate(() => { const e = window.__ECLIPSE__; const g = e.game; const p = g.player.pos.clone(); p.z -= 6; p.y = 0.6; g.explode(p, 5, 0, 'world'); });
for (let i = 0; i < 12; i++) { await page.evaluate(() => window.__ECLIPSE__.step(1 / 60, 1)); fire.push(await scan('explosion f' + i)); }
await shot(page, 'nan-explosion');
console.log(fire.filter((l) => !/nan=0 inf=0 neg=0/.test(l)).join('\n') || 'fire/explosion clean');
console.log('fire max:', fire.map((l) => l.replace(/:.*max=([\d.]+).*/, '=$1')).join(' ').slice(0, 900));
console.log('errors', errors.length);
await browser.close();
