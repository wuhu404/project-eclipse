// 开发用：验证 Bloom 前的 HDR 清洗通道。向光柱 shader 注入 NaN / Inf / 负值，比较清洗通道开/关时最终 HDR 缓冲里的坏像素数。
import { launch, startNewGame, shot } from './lib.mjs';
const { browser, page, errors } = await launch();
await startNewGame(page);
await page.setViewportSize({ width: 640, height: 360 });
await page.waitForTimeout(500);
const r = await page.evaluate(() => {
  const e = window.__ECLIPSE__;
  const g = e.game;
  e.god(true);
  const scanRT = (rt) => {
    const buf = new Uint16Array(rt.width * rt.height * 4);
    g.gfx.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
    let nan = 0, inf = 0, neg = 0;
    for (let i = 0; i < buf.length; i += 4) for (let c = 0; c < 3; c++) {
      const v = buf[i + c]; const ex = (v >> 10) & 31; const m = v & 1023;
      if (ex === 31) { if (m) nan++; else inf++; } else if (v >> 15 && (ex > 0)) neg++;
    }
    return `nan=${nan} inf=${inf} neg=${neg}`;
  };
  // 送入最终合成通道的缓冲：清洗通道开启时发生两次交换（清洗 + 最终），关闭时一次
  const count = () => {
    g.gfx.render(); g.gfx.render();
    const c = g.gfx.composer;
    return scanRT(g.gfx.sanitizePass.enabled ? c.writeBuffer : c.readBuffer);
  };
  const out = {};
  e.teleport(0, 6, 0); e.look(0, 0.25); g.level.playerHidden = true; e.step(1 / 30, 10);
  out.normal = count();
  const shafts = g.level.builder.shafts;
  const inject = (expr) => {
    for (const k in shafts) {
      const m = shafts[k];
      m.uniforms.uStrength.value = 0;
      m.fragmentShader = `uniform vec3 uColor; uniform float uStrength; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ float z = uStrength; gl_FragColor = vec4(vec3(${expr}), 1.0); }`;
      m.needsUpdate = true;
    }
  };
  for (const [name, expr] of [['NaN', 'z / z'], ['Inf', '1.0 / z'], ['negative', 'z - 5.0']]) {
    inject(expr);
    g.gfx.sanitizePass.enabled = false;
    count();
    out[name + ' — 清洗关'] = count();
    g.gfx.sanitizePass.enabled = true;
    out[name + ' — 清洗开'] = count();
  }
  inject('z / z');
  g.gfx.sanitizePass.enabled = false; g.gfx.render(); g.gfx.render();
  return out;
});
for (const k in r) console.log(k.padEnd(18), r[k]);
await shot(page, 'nan-injected-off');
await page.evaluate(() => { const g = window.__ECLIPSE__.game; g.gfx.sanitizePass.enabled = true; g.gfx.render(); });
await shot(page, 'nan-injected-on');
console.log('errors', errors.length, errors.slice(0, 2).join('|').slice(0, 300));
await browser.close();
