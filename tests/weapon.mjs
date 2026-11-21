// 开发用：截取三把武器的腰射 / 开镜 / 开火画面
import { frames, launch, shot, startNewGame, step } from './lib.mjs';
const where = process.argv[2] || 'lz';
const { browser, page, errors } = await launch();
const E = (fn, arg) => page.evaluate(fn, arg);
await startNewGame(page);
await E((where) => {
  const e = window.__ECLIPSE__;
  e.god(true);
  e.game.level.playerHidden = true;
  e.game.weapons.give('viper', false);
  e.game.weapons.give('helix', false);
  if (where === 'hangar') e.teleport(0, 4, 0);
  else e.teleport(0, 40, 0);
  e.look(0.5, 0.0);
  document.getElementById('subtitle').style.display = 'none';
}, where);
for (const [key, id] of [['Digit1', 'ar9'], ['Digit2', 'viper'], ['Digit3', 'helix']]) {
  await E((k) => window.__ECLIPSE__.key(k, true), key);
  await step(page, 1 / 60, 1 / 60);
  await E((k) => window.__ECLIPSE__.key(k, false), key);
  await step(page, 1.0);
  await frames(page, 2);
  await shot(page, `w-${id}-hip`);
  await E(() => window.__ECLIPSE__.key('Mouse2', true));
  await step(page, 0.6);
  await frames(page, 2);
  await shot(page, `w-${id}-ads`);
  await E(() => window.__ECLIPSE__.key('Mouse2', false));
  await step(page, 0.5);
  await E(() => window.__ECLIPSE__.key('Mouse0', true));
  await step(page, 1 / 60, 2 / 60);
  await frames(page, 2);
  await shot(page, `w-${id}-fire`);
  await E(() => window.__ECLIPSE__.key('Mouse0', false));
  await step(page, 0.8);
}
console.log('errors:', errors.length, errors.slice(0, 5).join('\n').slice(0, 2500));
await browser.close();
