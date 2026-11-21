import * as THREE from 'three';

export const TAU = Math.PI * 2;
export const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const invLerp = (a: number, b: number, v: number): number => clamp01((v - a) / (b - a));
export const smoothstep = (a: number, b: number, v: number): number => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
/** 帧率无关的指数趋近。lambda 越大越快。 */
export const damp = (a: number, b: number, lambda: number, dt: number): number =>
  lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (a = 0, b = 1): number => a + Math.random() * (b - a);
export const randInt = (a: number, b: number): number => Math.floor(rand(a, b + 1));
export const randSign = (): number => (Math.random() < 0.5 ? -1 : 1);
export const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)];
export const easeOutCubic = (t: number): number => 1 - Math.pow(1 - t, 3);
export const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export const easeOutBack = (t: number): number => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};

/** 把角度差规整到 [-PI, PI] */
export const angleDelta = (from: number, to: number): number => {
  let d = (to - from) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
};
export const turnToward = (from: number, to: number, maxStep: number): number => {
  const d = angleDelta(from, to);
  if (Math.abs(d) <= maxStep) return to;
  return from + Math.sign(d) * maxStep;
};

/** 可复现的伪随机数（程序化纹理与关卡布置用） */
export class RNG {
  private s: number;
  constructor(seed = 1337) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + this.next() * (b - a);
  }
  int(a: number, b: number): number {
    return Math.floor(this.range(a, b + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

/** 临界阻尼附近的二阶弹簧，用于后坐力、武器晃动、落地反馈。 */
export class Spring {
  value = 0;
  velocity = 0;
  target = 0;
  constructor(public stiffness = 120, public damping = 14) {}
  update(dt: number): number {
    // 半隐式欧拉，子步保证大 dt 时稳定
    const steps = dt > 1 / 90 ? Math.ceil(dt * 90) : 1;
    const h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const a = (this.target - this.value) * this.stiffness - this.velocity * this.damping;
      this.velocity += a * h;
      this.value += this.velocity * h;
    }
    return this.value;
  }
  impulse(v: number): void {
    this.velocity += v;
  }
  reset(v = 0): void {
    this.value = v;
    this.target = v;
    this.velocity = 0;
  }
}

export class Spring3 {
  x = new Spring();
  y = new Spring();
  z = new Spring();
  constructor(stiffness = 120, damping = 14) {
    for (const s of [this.x, this.y, this.z]) {
      s.stiffness = stiffness;
      s.damping = damping;
    }
  }
  update(dt: number): void {
    this.x.update(dt);
    this.y.update(dt);
    this.z.update(dt);
  }
  impulse(x: number, y: number, z: number): void {
    this.x.impulse(x);
    this.y.impulse(y);
    this.z.impulse(z);
  }
  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

export const V3 = (x = 0, y = 0, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
export const UP = new THREE.Vector3(0, 1, 0);

export function dist2D(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/** 在以 dir 为轴的圆锥内取随机方向（spread 为弧度半角）。写入 out。 */
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
export function spreadDirection(dir: THREE.Vector3, spread: number, out: THREE.Vector3): THREE.Vector3 {
  if (spread <= 0) return out.copy(dir);
  // 构造正交基
  _a.set(0, 1, 0);
  if (Math.abs(dir.y) > 0.99) _a.set(1, 0, 0);
  _b.crossVectors(dir, _a).normalize();
  _a.crossVectors(_b, dir).normalize();
  const r = Math.sqrt(Math.random()) * Math.tan(spread);
  const t = Math.random() * TAU;
  return out
    .copy(dir)
    .addScaledVector(_b, Math.cos(t) * r)
    .addScaledVector(_a, Math.sin(t) * r)
    .normalize();
}

export function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}
