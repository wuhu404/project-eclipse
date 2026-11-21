// 开发用：记录工业大厅遭遇战中玩家受到的每一次伤害
import { launch, startNewGame, step } from './lib.mjs';
import fs from 'node:fs';
const { browser, page, errors } = await launch();
await startNewGame(page);
await page.evaluate(fs.readFileSync(new URL('./bot.js', import.meta.url), 'utf8'));
const out = await page.evaluate(() => {
  const e = window.__ECLIPSE__;
  const g = e.game;
  const p = g.player;
  g.resetWorld(2);
  g.weapons.give('viper', false); g.weapons.give('helix', false);
  p.health = Number(new URLSearchParams(location.search).get('hp') || 66);
  e.step(1 / 30, 10);
  const start = `stage=${g.level.stage} pos=${p.pos.z.toFixed(1)} enemies=${g.enemies.list.filter((x) => x.alive).map((x) => x.type + '@' + x.encounter).join(',')}`;
  const log = [];
  const orig = p.damage.bind(p);
  p.damage = (amt, src) => {
    let who = '?';
    if (src) { let bd = 1e9; for (const en of g.enemies.list) { const d = en.pos.distanceTo(src); if (d < bd) { bd = d; who = en.type + ':' + en.state + (bd > 3 ? '(~' + bd.toFixed(0) + 'm)' : ''); } } }
    const h0 = p.health;
    orig(amt, src);
    log.push(`t=${g.time.toFixed(2)} dmg=${amt.toFixed(1)} hp ${h0.toFixed(0)}→${p.health.toFixed(0)} by ${who} dist=${src ? src.distanceTo(p.pos).toFixed(1) : '-'}`);
  };
  const t0 = g.time;
  window.__BOT__.goTo(0, -113, 20);
  const t = window.__BOT__.fight(() => g.level.stage >= 9, 240, (en) => en.encounter === 'hall');
  return { start, log: log.slice(0, 60), n: log.length, t, t0, state: g.state, stage: g.level.stage, hp: p.health, enemies: g.enemies.list.filter((x) => x.alive).map((x) => x.type + ':' + x.state) };
});
console.log(out.log.join('\n'));
console.log(JSON.stringify({ ...out, log: undefined }), 'errors', errors.length);
await browser.close();
