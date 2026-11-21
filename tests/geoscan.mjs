// 开发用：扫描场景内所有几何体，查找 NaN 顶点 / 零长度法线（真实 GPU 上 normalize(0) = NaN，会在光照里产生坏像素）。
import { launch, startNewGame } from './lib.mjs';
const { browser, page, errors } = await launch();
await startNewGame(page);
const r = await page.evaluate(() => {
  const g = window.__ECLIPSE__.game;
  const bad = [];
  let meshes = 0;
  const seen = new Set();
  const scan = (root, tag) => root.traverse((o) => {
    const geo = o.geometry;
    if (!geo || seen.has(geo)) return;
    seen.add(geo); meshes++;
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    const lit = mat && (mat.isMeshStandardMaterial || mat.isMeshPhysicalMaterial || mat.isMeshLambertMaterial || mat.isMeshPhongMaterial);
    const p = geo.attributes.position, n = geo.attributes.normal;
    let nanP = 0, nanN = 0, zeroN = 0;
    if (p) for (let i = 0; i < p.array.length; i++) if (!Number.isFinite(p.array[i])) nanP++;
    if (n) for (let i = 0; i < n.count; i++) {
      const x = n.getX(i), y = n.getY(i), z = n.getZ(i);
      if (!Number.isFinite(x + y + z)) nanN++; else if (x * x + y * y + z * z < 1e-6) zeroN++;
    }
    const m = o.matrixWorld.elements; let nanM = 0;
    for (let i = 0; i < 16; i++) if (!Number.isFinite(m[i])) nanM++;
    if (nanP || nanN || nanM || (lit && (zeroN || !n)))
      bad.push(`${tag}:${o.name || o.type} mat=${mat?.type} verts=${p?.count} nanP=${nanP} nanN=${nanN} zeroN=${zeroN} noNormal=${!n} nanM=${nanM}`);
  });
  scan(g.gfx.scene, 'scene');
  return { meshes, bad };
});
console.log('geometries', r.meshes, 'bad', r.bad.length);
for (const b of r.bad) console.log('  ', b);
console.log('errors', errors.length);
await browser.close();
