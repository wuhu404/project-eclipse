import { launch, startNewGame, step } from './lib.mjs';
const { browser, page } = await launch();
await startNewGame(page);
await step(page, 0.5);
const out = await page.evaluate(() => {
  const e = window.__ECLIPSE__;
  const p = e.game.player;
  e.teleport(11.5, 56, 0);
  e.step(1 / 60, 20);
  e.key('KeyW', true); e.key('ShiftLeft', true);
  e.step(1 / 60, 60);
  const log = [`pre sprint=${p.sprinting} g=${p.grounded} v=${p.speed2D.toFixed(2)}`];
  e.key('ControlLeft', true);
  for (let i = 0; i < 6; i++) { e.step(1 / 60, 1); log.push(`f${i} slide=${p.sliding} crouch=${p.crouching} g=${p.grounded} v=${p.speed2D.toFixed(2)} y=${p.pos.y.toFixed(3)}`); }
  return log;
});
console.log(out.join('\n'));
await browser.close();
