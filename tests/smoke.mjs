import { launch, shot, snap } from './lib.mjs';
const t0 = Date.now();
const { browser, page, errors } = await launch();
console.log('ready in', Date.now() - t0, 'ms');
await page.waitForTimeout(1500);
await shot(page, 'menu');
console.log(JSON.stringify(await snap(page)).slice(0, 600));
console.log('errors:', errors.length, errors.slice(0, 10).join('\n---\n').slice(0, 4000));
await browser.close();
