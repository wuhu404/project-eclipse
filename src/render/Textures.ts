import * as THREE from 'three';
import { RNG, clamp01, lerp, smoothstep } from '../core/math';

/**
 * 程序化 PBR 纹理生成。所有贴图都在启动时用 Canvas 生成，
 * 不依赖任何外部图片素材。每套纹理包含 albedo / normal / ORM（G=粗糙度，B=金属度）。
 */
export interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  ormMap: THREE.Texture;
  alphaMap?: THREE.Texture;
}

const SIZE = 512;

// ---------- 可平铺噪声 ----------
function makeLattice(period: number, rng: RNG): Float32Array {
  const l = new Float32Array(period * period);
  for (let i = 0; i < l.length; i++) l[i] = rng.next();
  return l;
}
function valueNoise(l: Float32Array, period: number, x: number, y: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  return lerp(lerp(l[y0 * period + x0], l[y0 * period + x1], u), lerp(l[y1 * period + x0], l[y1 * period + x1], u), v);
}
/** 生成 SIZE×SIZE 的可平铺 fbm 噪声场，值域约 [0,1] */
function fbmField(seed: number, basePeriod: number, octaves: number, gain = 0.5): Float32Array {
  const rng = new RNG(seed);
  const out = new Float32Array(SIZE * SIZE);
  let amp = 1;
  let total = 0;
  let period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    const l = makeLattice(period, rng);
    const scale = period / SIZE;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        out[y * SIZE + x] += valueNoise(l, period, x * scale, y * scale) * amp;
      }
    }
    total += amp;
    amp *= gain;
    period *= 2;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

// ---------- 表面缓冲 ----------
class Surface {
  r = new Float32Array(SIZE * SIZE);
  g = new Float32Array(SIZE * SIZE);
  b = new Float32Array(SIZE * SIZE);
  h = new Float32Array(SIZE * SIZE); // 高度
  rough = new Float32Array(SIZE * SIZE);
  metal = new Float32Array(SIZE * SIZE);
  alpha: Float32Array | null = null;

  fill(r: number, g: number, b: number, rough: number, metal: number, h = 0.5): void {
    this.r.fill(r);
    this.g.fill(g);
    this.b.fill(b);
    this.rough.fill(rough);
    this.metal.fill(metal);
    this.h.fill(h);
  }

  idx(x: number, y: number): number {
    return (((y % SIZE) + SIZE) % SIZE) * SIZE + (((x % SIZE) + SIZE) % SIZE);
  }

  /** 对矩形区域内每个像素执行回调。u,v 为区域内归一化坐标，ex/ey 为到边缘的像素距离 */
  rect(x0: number, y0: number, w: number, hh: number, fn: (i: number, edge: number, u: number, v: number) => void): void {
    for (let y = 0; y < hh; y++) {
      for (let x = 0; x < w; x++) {
        const edge = Math.min(x, y, w - 1 - x, hh - 1 - y);
        fn(this.idx(x0 + x, y0 + y), edge, x / w, y / hh);
      }
    }
  }

  mulColor(i: number, k: number): void {
    this.r[i] *= k;
    this.g[i] *= k;
    this.b[i] *= k;
  }
  setColor(i: number, r: number, g: number, b: number): void {
    this.r[i] = r;
    this.g[i] = g;
    this.b[i] = b;
  }

  disc(cx: number, cy: number, rad: number, fn: (i: number, d: number) => void): void {
    const r = Math.ceil(rad);
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        const d = Math.hypot(x, y) / rad;
        if (d <= 1) fn(this.idx(Math.round(cx) + x, Math.round(cy) + y), d);
      }
    }
  }

  line(x0: number, y0: number, x1: number, y1: number, fn: (i: number) => void): void {
    const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0));
    for (let s = 0; s <= n; s++) {
      const t = s / Math.max(1, n);
      fn(this.idx(Math.round(lerp(x0, x1, t)), Math.round(lerp(y0, y1, t))));
    }
  }

  albedoCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      img.data[i * 4] = clamp01(this.r[i]) * 255;
      img.data[i * 4 + 1] = clamp01(this.g[i]) * 255;
      img.data[i * 4 + 2] = clamp01(this.b[i]) * 255;
      img.data[i * 4 + 3] = this.alpha ? clamp01(this.alpha[i]) * 255 : 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  normalCanvas(strength: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = (this.h[this.idx(x + 1, y)] - this.h[this.idx(x - 1, y)]) * strength;
        const dy = (this.h[this.idx(x, y + 1)] - this.h[this.idx(x, y - 1)]) * strength;
        const inv = 1 / Math.hypot(dx, dy, 1);
        const i = (y * SIZE + x) * 4;
        img.data[i] = (-dx * inv * 0.5 + 0.5) * 255;
        img.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
        img.data[i + 2] = (inv * 0.5 + 0.5) * 255;
        img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  ormCanvas(): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = c.height = SIZE;
    const ctx = c.getContext('2d')!;
    const img = ctx.createImageData(SIZE, SIZE);
    for (let i = 0; i < SIZE * SIZE; i++) {
      img.data[i * 4] = 255;
      img.data[i * 4 + 1] = clamp01(this.rough[i]) * 255;
      img.data[i * 4 + 2] = clamp01(this.metal[i]) * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  toSet(normalStrength: number, paint?: (ctx: CanvasRenderingContext2D) => void): TexSet {
    const ac = this.albedoCanvas();
    if (paint) paint(ac.getContext('2d')!);
    const map = finalize(new THREE.CanvasTexture(ac), true);
    const normalMap = finalize(new THREE.CanvasTexture(this.normalCanvas(normalStrength)), false);
    const ormMap = finalize(new THREE.CanvasTexture(this.ormCanvas()), false);
    return { map, normalMap, ormMap };
  }
}

let maxAniso = 8;
export function setMaxAnisotropy(v: number): void {
  maxAniso = v;
}

function finalize(t: THREE.Texture, srgb: boolean): THREE.Texture {
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = maxAniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.needsUpdate = true;
  return t;
}

/** 通用做旧：污渍、划痕、边缘磨损 */
function weather(s: Surface, seed: number, grime: number, scratches: number): void {
  const n1 = fbmField(seed, 4, 5);
  const n2 = fbmField(seed + 7, 16, 4);
  const rng = new RNG(seed + 99);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const g = smoothstep(0.35, 0.8, n1[i]) * grime;
    s.mulColor(i, 1 - g * 0.45);
    s.rough[i] = clamp01(s.rough[i] + g * 0.25 + (n2[i] - 0.5) * 0.18);
    s.metal[i] = clamp01(s.metal[i] - g * 0.25);
    s.h[i] += (n2[i] - 0.5) * 0.02;
  }
  for (let k = 0; k < scratches; k++) {
    const x = rng.range(0, SIZE);
    const y = rng.range(0, SIZE);
    const a = rng.range(0, Math.PI * 2);
    const len = rng.range(8, 70);
    const bright = rng.range(1.08, 1.35);
    s.line(x, y, x + Math.cos(a) * len, y + Math.sin(a) * len, (i) => {
      s.mulColor(i, bright);
      s.rough[i] = clamp01(s.rough[i] - 0.18);
      s.h[i] -= 0.015;
    });
  }
}

/** 递归切分出不规则面板布局 */
interface PanelRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
function subdivide(rng: RNG, x: number, y: number, w: number, h: number, depth: number, out: PanelRect[], min = 56): void {
  const canX = w >= min * 2;
  const canY = h >= min * 2;
  if (depth <= 0 || (!canX && !canY) || (depth < 3 && rng.next() < 0.22)) {
    out.push({ x, y, w, h });
    return;
  }
  const splitX = canX && (!canY || (w > h ? rng.next() < 0.7 : rng.next() < 0.3));
  if (splitX) {
    const t = Math.round((w * rng.pick([0.33, 0.5, 0.5, 0.66])) / 8) * 8;
    subdivide(rng, x, y, t, h, depth - 1, out, min);
    subdivide(rng, x + t, y, w - t, h, depth - 1, out, min);
  } else {
    const t = Math.round((h * rng.pick([0.33, 0.5, 0.5, 0.66])) / 8) * 8;
    subdivide(rng, x, y, w, t, depth - 1, out, min);
    subdivide(rng, x, y + t, w, h - t, depth - 1, out, min);
  }
}

function bolt(s: Surface, x: number, y: number, rad = 3.2): void {
  s.disc(x, y, rad, (i, d) => {
    s.h[i] += (1 - d * d) * 0.14;
    s.mulColor(i, 1.12 - d * 0.25);
    s.rough[i] = 0.32;
    s.metal[i] = 1;
  });
}

// ---------- 具体纹理 ----------

/** 科幻墙面装甲板：不规则分缝、螺栓、散热槽 */
export function texWallPanel(seed = 11): TexSet {
  const s = new Surface();
  const rng = new RNG(seed);
  s.fill(0.62, 0.64, 0.67, 0.5, 0.75, 0.5);
  const panels: PanelRect[] = [];
  subdivide(rng, 0, 0, SIZE, SIZE, 4, panels, 64);
  for (const p of panels) {
    const tone = rng.range(0.86, 1.06);
    const rough = rng.range(0.38, 0.58);
    const kind = rng.next();
    s.rect(p.x, p.y, p.w, p.h, (i, edge, u, v) => {
      const bevel = smoothstep(0, 5, edge);
      s.h[i] = 0.35 + bevel * 0.3;
      s.mulColor(i, tone * (0.45 + 0.55 * smoothstep(0, 2.5, edge)));
      s.rough[i] = rough + (1 - bevel) * 0.3;
      // 内嵌阶梯
      if (edge > 12 && edge < 15 && p.w > 100 && p.h > 100) {
        s.h[i] -= 0.08;
        s.mulColor(i, 0.8);
      }
      if (kind < 0.16 && p.w >= 96 && p.h >= 64) {
        // 散热槽
        if (u > 0.18 && u < 0.82 && v > 0.25 && v < 0.75) {
          const slat = Math.sin(v * p.h * 0.7) > 0.1;
          if (slat) {
            s.h[i] -= 0.22;
            s.mulColor(i, 0.35);
            s.rough[i] = 0.85;
          }
        }
      }
    });
    if (p.w >= 64 && p.h >= 64) {
      const m = 9;
      bolt(s, p.x + m, p.y + m);
      bolt(s, p.x + p.w - m, p.y + m);
      bolt(s, p.x + m, p.y + p.h - m);
      bolt(s, p.x + p.w - m, p.y + p.h - m);
    }
  }
  weather(s, seed + 1, 0.55, 90);
  return s.toSet(3.2);
}

/** 地面金属板：大块地砖 + 防滑条纹 */
export function texFloor(seed = 23): TexSet {
  const s = new Surface();
  const rng = new RNG(seed);
  s.fill(0.5, 0.52, 0.55, 0.55, 0.7, 0.5);
  const T = SIZE / 2;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const tone = rng.range(0.85, 1.05);
      const pattern = (tx + ty) % 2 === 0;
      s.rect(tx * T, ty * T, T, T, (i, edge, u, v) => {
        const bevel = smoothstep(0, 4, edge);
        s.h[i] = 0.3 + bevel * 0.3;
        s.mulColor(i, tone * (0.4 + 0.6 * smoothstep(0, 2, edge)));
        if (edge > 18) {
          if (pattern) {
            // 菱形防滑纹
            const px = u * T;
            const py = v * T;
            const a = (px + py) % 22;
            const b = (px - py + 880) % 22;
            const cell = Math.floor((px + py) / 22) + Math.floor((px - py + 880) / 22);
            const on = cell % 2 === 0 ? a > 8 && a < 14 && b > 3 && b < 19 : b > 8 && b < 14 && a > 3 && a < 19;
            if (on) {
              s.h[i] += 0.12;
              s.mulColor(i, 1.12);
              s.rough[i] = 0.4;
            }
          } else {
            // 细密横纹
            const stripe = Math.sin(v * T * 0.55) > 0.55;
            if (stripe) {
              s.h[i] -= 0.07;
              s.mulColor(i, 0.82);
            }
          }
        }
      });
      const m = 9;
      for (const [bx, by] of [
        [m, m],
        [T - m, m],
        [m, T - m],
        [T - m, T - m],
      ]) {
        bolt(s, tx * T + bx, ty * T + by, 3.6);
      }
    }
  }
  weather(s, seed + 3, 0.7, 140);
  return s.toSet(3.0);
}

/** 拉丝深色金属：武器、机器人、道具 */
export function texBrushed(seed = 37): TexSet {
  const s = new Surface();
  const rng = new RNG(seed);
  s.fill(0.7, 0.7, 0.72, 0.42, 0.9, 0.5);
  const n = fbmField(seed, 8, 4);
  for (let y = 0; y < SIZE; y++) {
    const rowTone = 0.92 + rng.next() * 0.16;
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const streak = valueStreak(x, y, seed);
      s.mulColor(i, rowTone * (0.9 + streak * 0.2));
      s.rough[i] = 0.36 + streak * 0.2 + (n[i] - 0.5) * 0.2;
      s.h[i] = 0.5 + (streak - 0.5) * 0.05;
    }
  }
  weather(s, seed + 5, 0.3, 60);
  return s.toSet(1.6);
}
function valueStreak(x: number, y: number, seed: number): number {
  // 水平方向拉伸的哈希噪声
  const xi = Math.floor(x / 24);
  const f = (x / 24) % 1;
  const h = (a: number, b: number): number => {
    const t = Math.sin(a * 127.1 + b * 311.7 + seed * 17.3) * 43758.5453;
    return t - Math.floor(t);
  };
  const wrap = Math.ceil(SIZE / 24);
  return lerp(h(xi % wrap, y), h((xi + 1) % wrap, y), f * f * (3 - 2 * f));
}

/** 外部混凝土 / 复合装甲 */
export function texConcrete(seed = 41): TexSet {
  const s = new Surface();
  s.fill(0.52, 0.5, 0.48, 0.88, 0.02, 0.5);
  const n1 = fbmField(seed, 4, 6);
  const n2 = fbmField(seed + 1, 32, 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const k = 0.75 + n1[i] * 0.5;
    s.mulColor(i, k);
    s.h[i] = 0.5 + (n1[i] - 0.5) * 0.25 + (n2[i] - 0.5) * 0.12;
    s.rough[i] = 0.8 + (n2[i] - 0.5) * 0.25;
  }
  // 模板接缝
  for (let k = 0; k < 2; k++) {
    for (let x = 0; x < SIZE; x++) {
      for (let w = -1; w <= 1; w++) {
        const i = s.idx(x, k * 256 + w);
        s.h[i] -= 0.2;
        s.mulColor(i, 0.6);
        const j = s.idx(k * 256 + w, x);
        s.h[j] -= 0.2;
        s.mulColor(j, 0.6);
      }
    }
  }
  const rng = new RNG(seed + 4);
  for (let k = 0; k < 4; k++) bolt(s, rng.pick([32, 224, 288, 480]), rng.pick([32, 224, 288, 480]), 6);
  return s.toSet(4.0);
}

/** 外星地表岩石 */
export function texRock(seed = 53): TexSet {
  const s = new Surface();
  s.fill(0.42, 0.3, 0.26, 0.92, 0.0, 0.5);
  const n1 = fbmField(seed, 4, 7, 0.55);
  const n2 = fbmField(seed + 9, 8, 5);
  for (let i = 0; i < SIZE * SIZE; i++) {
    const ridge = 1 - Math.abs(n1[i] * 2 - 1);
    const k = 0.55 + ridge * 0.7;
    s.r[i] *= k * (0.9 + n2[i] * 0.3);
    s.g[i] *= k * (0.85 + n2[i] * 0.25);
    s.b[i] *= k * (0.8 + n2[i] * 0.4);
    s.h[i] = ridge * 0.7 + n2[i] * 0.3;
    s.rough[i] = 0.82 + n2[i] * 0.18;
  }
  return s.toSet(5.0);
}

/** 黄黑警示条纹 */
export function texHazard(seed = 61): TexSet {
  const s = new Surface();
  s.fill(0.9, 0.68, 0.08, 0.55, 0.3, 0.5);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      if ((x + y) % 128 < 64) {
        s.setColor(i, 0.06, 0.06, 0.07);
        s.rough[i] = 0.5;
      }
    }
  }
  weather(s, seed, 0.9, 160);
  return s.toSet(1.5);
}

/** 货箱表面：加强筋 + 喷码 */
export function texCrate(seed = 71): TexSet {
  const s = new Surface();
  s.fill(0.6, 0.62, 0.6, 0.6, 0.55, 0.5);
  s.rect(0, 0, SIZE, SIZE, (i, edge, u, v) => {
    const frame = edge < 44;
    const bevel = smoothstep(0, 6, edge);
    s.h[i] = 0.3 + bevel * 0.25 + (frame ? 0.22 : 0);
    if (frame) s.mulColor(i, 0.62);
    else {
      // 竖向加强筋
      const rib = Math.abs(((u * 8) % 1) - 0.5) < 0.16;
      if (rib) {
        s.h[i] += 0.12;
        s.mulColor(i, 1.08);
      } else s.mulColor(i, 0.9);
    }
    if (edge > 44 && edge < 48) {
      s.h[i] -= 0.12;
      s.mulColor(i, 0.5);
    }
    void v;
  });
  for (const [x, y] of [
    [22, 22],
    [490, 22],
    [22, 490],
    [490, 490],
    [256, 22],
    [256, 490],
    [22, 256],
    [490, 256],
  ]) {
    bolt(s, x, y, 7);
  }
  weather(s, seed, 0.6, 120);
  return s.toSet(3.0, (ctx) => {
    ctx.save();
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = '#e8ecef';
    ctx.font = 'bold 44px "Arial Narrow", Arial, sans-serif';
    ctx.fillText('ECL-7', 70, 130);
    ctx.font = 'bold 20px monospace';
    ctx.fillText('HELIOS DYNAMICS', 70, 160);
    ctx.fillText('MASS 240KG // CLASS-C', 70, 430);
    ctx.fillStyle = '#ffb020';
    ctx.fillRect(70, 176, 150, 8);
    // 条码
    for (let i = 0; i < 26; i++) {
      const w = 2 + ((i * 7) % 5);
      ctx.fillStyle = '#e8ecef';
      ctx.fillRect(300 + i * 5.5, 380, w > 4 ? 4 : 2, 54);
    }
    ctx.restore();
  });
}

/** 镂空格栅（走道） */
export function texGrate(seed = 83): TexSet {
  const s = new Surface();
  s.fill(0.45, 0.46, 0.48, 0.5, 0.9, 0.5);
  s.alpha = new Float32Array(SIZE * SIZE);
  const cell = 32;
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const cx = x % cell;
      const cy = y % cell;
      const bar = cx < 7 || cy < 7;
      const frame = x < 12 || y < 12 || x >= SIZE - 12 || y >= SIZE - 12;
      s.alpha[i] = bar || frame ? 1 : 0;
      s.h[i] = bar || frame ? 0.7 : 0.2;
      if (cx < 7 && cy < 7) s.mulColor(i, 1.15);
    }
  }
  weather(s, seed, 0.5, 60);
  const set = s.toSet(2.5);
  return set;
}

/** 管道/储罐：环向接缝 */
export function texPipe(seed = 97): TexSet {
  const s = new Surface();
  s.fill(0.66, 0.66, 0.68, 0.45, 0.85, 0.5);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const band = y % 256;
      if (band < 18) {
        s.h[i] += 0.2 * Math.sin((band / 18) * Math.PI);
        s.mulColor(i, 0.8);
        if (x % 32 > 12 && x % 32 < 20 && band > 5 && band < 13) {
          s.h[i] += 0.15;
          s.mulColor(i, 1.3);
        }
      }
    }
  }
  weather(s, seed, 0.75, 80);
  return s.toSet(2.5);
}

// ---------- 发光屏幕 / 标识 ----------
export type ScreenKind = 'data' | 'graph' | 'warning' | 'map' | 'logo' | 'status';

export function texScreen(kind: ScreenKind, seed = 1, accent = '#35e0ff'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 320;
  const ctx = c.getContext('2d')!;
  const rng = new RNG(seed * 31 + 5);
  ctx.fillStyle = '#020608';
  ctx.fillRect(0, 0, c.width, c.height);
  // 网格底
  ctx.strokeStyle = 'rgba(80,200,230,0.08)';
  ctx.lineWidth = 1;
  for (let x = 0; x < c.width; x += 32) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, c.height);
    ctx.stroke();
  }
  for (let y = 0; y < c.height; y += 32) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(c.width, y);
    ctx.stroke();
  }
  ctx.strokeStyle = accent;
  ctx.fillStyle = accent;
  ctx.lineWidth = 2;
  ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
  ctx.font = 'bold 18px monospace';
  if (kind === 'data' || kind === 'status') {
    ctx.fillText(kind === 'data' ? 'SYS.LOG // NODE-' + rng.int(10, 99) : 'REACTOR STATUS', 22, 36);
    ctx.font = '13px monospace';
    for (let i = 0; i < 13; i++) {
      const w = rng.range(120, 420);
      ctx.globalAlpha = rng.range(0.35, 0.95);
      if (rng.next() < 0.15) ctx.fillStyle = '#ff9a2e';
      else ctx.fillStyle = accent;
      ctx.fillRect(22, 54 + i * 19, w, 7);
      ctx.fillRect(22 + w + 10, 54 + i * 19, rng.range(10, 40), 7);
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'graph') {
    ctx.fillText('ENERGY FLUX', 22, 36);
    ctx.beginPath();
    for (let x = 0; x < 460; x += 6) {
      const y = 180 + Math.sin(x * 0.04 + seed) * 50 + Math.sin(x * 0.11) * 22 + rng.range(-8, 8);
      if (x === 0) ctx.moveTo(26 + x, y);
      else ctx.lineTo(26 + x, y);
    }
    ctx.stroke();
    ctx.globalAlpha = 0.5;
    for (let i = 0; i < 20; i++) {
      const hgt = rng.range(10, 70);
      ctx.fillRect(28 + i * 23, 296 - hgt, 14, hgt);
    }
    ctx.globalAlpha = 1;
  } else if (kind === 'warning') {
    ctx.fillStyle = '#ff3b30';
    ctx.strokeStyle = '#ff3b30';
    ctx.strokeRect(8, 8, c.width - 16, c.height - 16);
    ctx.font = 'bold 54px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('⚠ LOCKDOWN', 256, 150);
    ctx.font = 'bold 22px monospace';
    ctx.fillText('DEFENSE GRID: HOSTILE', 256, 200);
    ctx.fillText('AI CORE // OMEGA PROTOCOL', 256, 232);
    for (let x = 20; x < 490; x += 40) {
      ctx.beginPath();
      ctx.moveTo(x, 270);
      ctx.lineTo(x + 20, 270);
      ctx.lineTo(x + 8, 296);
      ctx.lineTo(x - 12, 296);
      ctx.fill();
    }
    ctx.textAlign = 'left';
  } else if (kind === 'map') {
    ctx.fillText('FACILITY MAP — KEPLER STATION', 22, 36);
    ctx.globalAlpha = 0.9;
    const rooms: [number, number, number, number][] = [
      [200, 250, 110, 50],
      [180, 180, 150, 64],
      [230, 150, 50, 30],
      [170, 96, 170, 54],
      [300, 110, 80, 30],
      [380, 70, 90, 80],
    ];
    for (const [x, y, w, h] of rooms) ctx.strokeRect(x, y, w, h);
    ctx.fillStyle = '#ff9a2e';
    ctx.beginPath();
    ctx.arc(425, 110, 9, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  } else {
    ctx.textAlign = 'center';
    ctx.font = 'bold 60px sans-serif';
    ctx.beginPath();
    ctx.arc(256, 130, 62, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(276, 118, 50, 0, Math.PI * 2);
    ctx.fillStyle = '#020608';
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = accent;
    ctx.font = 'bold 34px sans-serif';
    ctx.fillText('HELIOS DYNAMICS', 256, 250);
    ctx.font = '16px monospace';
    ctx.fillText('KEPLER-442 RESEARCH DIVISION', 256, 280);
    ctx.textAlign = 'left';
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 墙面喷涂标识（区域编号等），带透明通道 */
export function texSign(text: string, sub: string, color = '#e9eef2'): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext('2d')!;
  ctx.clearRect(0, 0, 512, 256);
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.9;
  // 自动缩放字号，保证长文本不会被裁切
  let size = 150;
  ctx.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
  const tw = ctx.measureText(text).width;
  if (tw > 476) size = Math.floor((size * 476) / tw);
  ctx.font = `bold ${size}px "Arial Narrow", Arial, sans-serif`;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 18, 105 + (150 - size) * 0.22);
  let subSize = 30;
  ctx.font = `bold ${subSize}px monospace`;
  const sw = ctx.measureText(sub).width;
  if (sw > 472) subSize = Math.floor((subSize * 472) / sw);
  ctx.font = `bold ${subSize}px monospace`;
  ctx.fillText(sub, 20, 215);
  ctx.fillRect(20, 180, 472, 6);
  // 磨损
  ctx.globalCompositeOperation = 'destination-out';
  const rng = new RNG(text.length * 13 + sub.length);
  for (let i = 0; i < 500; i++) {
    ctx.globalAlpha = rng.range(0.2, 0.9);
    ctx.fillRect(rng.range(0, 512), rng.range(0, 256), rng.range(1, 9), rng.range(1, 3));
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// ---------- 粒子 / 特效贴图 ----------
function radialCanvas(size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function texGlow(): THREE.Texture {
  return radialCanvas(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.2, 'rgba(255,255,255,0.75)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function texSmoke(): THREE.Texture {
  return radialCanvas(128, (ctx, s) => {
    const rng = new RNG(5);
    for (let i = 0; i < 26; i++) {
      const x = s / 2 + rng.range(-s * 0.2, s * 0.2);
      const y = s / 2 + rng.range(-s * 0.2, s * 0.2);
      const r = rng.range(s * 0.12, s * 0.3);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,0.16)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}

export function texMuzzle(): THREE.Texture {
  return radialCanvas(256, (ctx, s) => {
    const rng = new RNG(3);
    ctx.translate(s / 2, s / 2);
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, s * 0.3);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.4, 'rgba(255,230,170,0.7)');
    g.addColorStop(1, 'rgba(255,160,60,0)');
    ctx.fillStyle = g;
    ctx.fillRect(-s / 2, -s / 2, s, s);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rng.range(-0.25, 0.25);
      const len = rng.range(s * 0.28, s * 0.48);
      const w = rng.range(0.1, 0.2);
      const gg = ctx.createLinearGradient(0, 0, Math.cos(a) * len, Math.sin(a) * len);
      gg.addColorStop(0, 'rgba(255,245,210,0.95)');
      gg.addColorStop(1, 'rgba(255,150,40,0)');
      ctx.fillStyle = gg;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a - w) * 10, Math.sin(a - w) * 10);
      ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
      ctx.lineTo(Math.cos(a + w) * 10, Math.sin(a + w) * 10);
      ctx.fill();
    }
  });
}

export function texRing(): THREE.Texture {
  return radialCanvas(256, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, s * 0.3, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.72, 'rgba(255,255,255,0.15)');
    g.addColorStop(0.9, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
  });
}

export function texBulletHole(): THREE.Texture {
  return radialCanvas(64, (ctx, s) => {
    const rng = new RNG(8);
    const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    g.addColorStop(0, 'rgba(0,0,0,1)');
    g.addColorStop(0.22, 'rgba(8,8,10,0.95)');
    g.addColorStop(0.4, 'rgba(60,60,64,0.6)');
    g.addColorStop(0.75, 'rgba(20,20,22,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(190,195,205,0.5)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 9; i++) {
      const a = rng.range(0, Math.PI * 2);
      ctx.beginPath();
      ctx.moveTo(s / 2 + Math.cos(a) * 7, s / 2 + Math.sin(a) * 7);
      ctx.lineTo(s / 2 + Math.cos(a) * rng.range(11, 20), s / 2 + Math.sin(a) * rng.range(11, 20));
      ctx.stroke();
    }
  });
}

export function texScorch(): THREE.Texture {
  return radialCanvas(128, (ctx, s) => {
    const rng = new RNG(21);
    for (let i = 0; i < 40; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(0, s * 0.22);
      const x = s / 2 + Math.cos(a) * d;
      const y = s / 2 + Math.sin(a) * d;
      const r = rng.range(s * 0.08, s * 0.26);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, 'rgba(0,0,0,0.22)');
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, s, s);
    }
  });
}
