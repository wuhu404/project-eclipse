// 开发用：检查暂停/设置/死亡界面是否真正可见
import { launch, shot, startNewGame, step } from './lib.mjs';
const { browser, page } = await launch();
await startNewGame(page);
await step(page, 0.5);
await page.keyboard.press('Escape');
await page.waitForTimeout(900);
await shot(page, 'ui-pause');
const info = await page.evaluate(() => {
  const el = document.querySelector('#screen-pause .dialog');
  const r = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const f = getComputedStyle(document.getElementById('fade'));
  return { rect: [r.x, r.y, r.width, r.height], opacity: cs.opacity, display: cs.display, fade: f.opacity, screenCls: document.getElementById('screen-pause').className };
});
console.log(JSON.stringify(info));
await browser.close();
