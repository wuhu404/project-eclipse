// 开发用：逐扇门从两侧走近并开门，开门全过程扫描 Bloom 之前的 HDR 缓冲（NaN / Inf / 负值），并截图。
import { launch, startNewGame, shot } from './lib.mjs';
const { browser, page, errors } = await launch();
await startNewGame(page);
await page.waitForTimeout(500);
const names = await page.evaluate(() => {
  const e = window.__ECLIPSE__;
  e.god(true);
  e.game.level.playerHidden = true;
  return Object.keys(e.game.level.doors);
});
let total = 0;
for (const name of names) {
  for (const side of [1, -1]) {
    const res = await page.evaluate(([name, side]) => {
      const e = window.__ECLIPSE__, g = e.game, d = g.level.doors[name];
      d.setLocked(false, true); d.sealed = false;
      const off = 2.6 * side;
      if (d.axis === 'x') e.teleport(d.x, d.z + off, side > 0 ? 0 : Math.PI);
      else e.teleport(d.x + off, d.z, side > 0 ? Math.PI / 2 : -Math.PI / 2);
      e.look(g.player.yaw, 0.05);
      const scan = () => {
        g.gfx.render();
        const rt = g.gfx.composer.readBuffer; // 清洗开启时 = 清洗之前的原始场景
        const buf = new Uint16Array(rt.width * rt.height * 4);
        g.gfx.renderer.readRenderTargetPixels(rt, 0, 0, rt.width, rt.height, buf);
        let bad = 0;
        for (let i = 0; i < buf.length; i += 4) for (let c = 0; c < 3; c++) {
          const v = buf[i + c]; const ex = (v >> 10) & 31;
          if (ex === 31 || ((v >> 15) && ex > 0)) bad++;
        }
        return bad;
      };
      let bad = 0, maxOpen = 0;
      for (let i = 0; i < 16; i++) { e.step(1 / 30, 6); bad += scan(); maxOpen = Math.max(maxOpen, d.open); }
      return { bad, maxOpen };
    }, [name, side]);
    total += res.bad;
    console.log(`${name.padEnd(13)} side=${side > 0 ? '+' : '-'} open=${res.maxOpen.toFixed(2)} badPixels=${res.bad}`);
    if (['gate', 'security', 'lab', 'hallNorth'].includes(name)) { await page.waitForTimeout(300); await shot(page, `door-${name}-${side > 0 ? 'a' : 'b'}`); }
  }
}
console.log('total bad', total, 'errors', errors.length, errors.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();
