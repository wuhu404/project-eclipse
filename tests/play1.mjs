// 开发用：脚本化验证基础玩法（移动、跳跃、射击、换弹、切枪、靶标、闸门）
import { frames, launch, shot, snap, startNewGame, step } from './lib.mjs';
const { browser, page, errors } = await launch();
const E = (fn, arg) => page.evaluate(fn, arg);
const log = (...a) => console.log(...a);
await startNewGame(page);
let s = await snap(page);
log('start', s.state, s.player.z.toFixed(2), 'grounded', s.player.grounded);
await step(page, 0.5);
// 前进 2 秒
await E(() => window.__ECLIPSE__.key('KeyW', true));
await step(page, 2);
s = await snap(page);
log('walk 2s -> z', s.player.z.toFixed(2), 'speed', s.player.speed.toFixed(2));
// 冲刺 1 秒
await E(() => window.__ECLIPSE__.key('ShiftLeft', true));
await step(page, 1);
s = await snap(page);
log('sprint -> z', s.player.z.toFixed(2), 'speed', s.player.speed.toFixed(2), 'sprinting', s.player.sprinting);
// 跳跃
await E(() => window.__ECLIPSE__.key('Space', true));
await step(page, 1 / 60, 1 / 60);
await E(() => window.__ECLIPSE__.key('Space', false));
let maxY = 0;
for (let i = 0; i < 40; i++) {
  await step(page, 1 / 60, 1 / 60);
  s = await snap(page);
  maxY = Math.max(maxY, s.player.y);
}
log('jump maxY', maxY.toFixed(2), 'z', s.player.z.toFixed(2), 'stage', s.stage);
await E(() => { const e = window.__ECLIPSE__; e.key('KeyW', false); e.key('ShiftLeft', false); });
await step(page, 0.6);
s = await snap(page);
log('stop -> speed', s.player.speed.toFixed(2), 'z', s.player.z.toFixed(2), 'stage', s.stage, 'obj', s.objective);
// 射击靶标
const targets = [[-7, 1.7, 18.5], [-10, 2.4, 24], [8, 1.6, 19.5]];
await E(() => window.__ECLIPSE__.teleport(0, 30, 0));
await step(page, 0.3);
for (const t of targets) {
  await E((t) => window.__ECLIPSE__.aimAt(t[0], t[1], t[2]), t);
  await E(() => window.__ECLIPSE__.key('Mouse0', true));
  await step(page, 0.5);
  await E(() => window.__ECLIPSE__.key('Mouse0', false));
  await step(page, 0.3);
  s = await snap(page);
  log('target', t, '-> obj', s.objective, 'mag', s.weapon.mag, 'shots', s.stats.shotsFired, 'hits', s.stats.shotsHit);
}
await frames(page, 2);
await shot(page, 'p1-range');
// 换弹
await E(() => window.__ECLIPSE__.key('KeyR', true));
await step(page, 1 / 60, 1 / 60);
await E(() => window.__ECLIPSE__.key('KeyR', false));
s = await snap(page);
log('reloading', s.weapon.reloading);
await step(page, 2.2);
s = await snap(page);
log('after reload mag', s.weapon.mag, 'reserve', s.weapon.reserve, 'stage', s.stage);
// 闸门终端
await E(() => { const e = window.__ECLIPSE__; e.teleport(5.2, 14.6, 0); e.aimAt(5.2, 1.3, 13.1); });
await step(page, 0.2);
s = await snap(page);
log('prompt', s.prompt);
await E(() => window.__ECLIPSE__.key('KeyE', true));
await step(page, 1 / 60, 1 / 60);
await E(() => window.__ECLIPSE__.key('KeyE', false));
await step(page, 0.5);
s = await snap(page);
log('after E: stage', s.stage, 'obj', s.objective);
// 走进机库
await E(() => { const e = window.__ECLIPSE__; e.teleport(0, 16, 0); e.look(0, 0); e.key('KeyW', true); });
await step(page, 3.5);
await E(() => window.__ECLIPSE__.key('KeyW', false));
s = await snap(page);
log('through gate z', s.player.z.toFixed(2), 'zone', s.zone, 'enemies', s.enemies.map((e) => `${e.type}:${e.state}:${e.dist.toFixed(0)}`).join(' '));
await frames(page, 2);
await shot(page, 'p1-hangar');
log('errors:', errors.length, errors.slice(0, 5).join('\n').slice(0, 2500));
await browser.close();
