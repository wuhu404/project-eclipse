// 开发用：传送到各个位置截图，检查画面
import { frames, launch, shot, snap, startNewGame, step } from './lib.mjs';
const views = {
  lz: [0, 54.6, 0, 0, 0],
  gate: [0, 26, 0, 0.05, 0],
  hangar: [0, 6, 0, 0.05, 0],
  hangar2: [14, -6, 0.9, 0.1, 0],
  catwalk: [19.5, -12, 0.6, -0.25, 4.25],
  control: [19.5, -33, 0.5, -0.1, 4.25],
  corridor: [0, -43, 0, 0, 0],
  lab: [0, -59, 0, 0, 0],
  labE: [8, -70, -1.2, 0, 0],
  hall: [0, -112, 0, 0.1, 0],
  hall2: [-15, -140, -2.3, 0.1, 0],
  power: [0, -145, 0, 0.05, 0],
  core: [0, -170, 0, 0, 0],
  arena: [0, -187, 0, 0.15, 0],
  arena2: [18, -200, 1.2, 0.2, 0],
};
const want = process.argv.slice(2);
const { browser, page, errors } = await launch();
await startNewGame(page);
await page.evaluate(() => window.__ECLIPSE__.god(true));
for (const [name, [x, z, yaw, pitch, y]] of Object.entries(views)) {
  if (want.length && !want.includes(name)) continue;
  await page.evaluate(([x, z, yaw, pitch, y]) => {
    const e = window.__ECLIPSE__;
    e.teleport(x, z, yaw, y + 0.02);
    e.look(yaw, pitch);
    e.game.level.playerHidden = true;
  }, [x, z, yaw, pitch, y]);
  await step(page, 1.2);
  await frames(page, 3);
  await shot(page, 'view-' + name);
  const s = await snap(page);
  console.log(name, 'zone', s.zone, 'pos', s.player.x.toFixed(1), s.player.y.toFixed(2), s.player.z.toFixed(1), 'grounded', s.player.grounded);
}
console.log('perf', JSON.stringify(await page.evaluate(() => window.__ECLIPSE__.perf())));
console.log('errors:', errors.length, errors.slice(0, 8).join('\n---\n').slice(0, 3000));
await browser.close();
