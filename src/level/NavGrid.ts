import * as THREE from 'three';

/**
 * 2D 导航网格 + A* 寻路。关卡搭建时把地面区域与障碍物栅格化，
 * 并预计算每个格子到最近障碍的距离（clearance），不同体型的敌人共用同一张图。
 */
export class NavGrid {
  readonly cell = 0.5;
  readonly w: number;
  readonly h: number;
  private floor: Uint8Array;
  private blocked: Uint8Array;
  /** 到最近不可走格子的距离（米） */
  clearance: Float32Array;
  /** 门占用的格子：0 = 无，否则为 doorId + 1 */
  private door: Uint8Array;
  private doorOpen: boolean[] = [];
  // A* 复用缓冲
  private g: Float32Array;
  private f: Float32Array;
  private parent: Int32Array;
  private stamp: Uint32Array;
  private closed: Uint32Array;
  private curStamp = 0;
  private heap: number[] = [];

  constructor(public minX: number, public minZ: number, public maxX: number, public maxZ: number) {
    this.w = Math.ceil((maxX - minX) / this.cell);
    this.h = Math.ceil((maxZ - minZ) / this.cell);
    const n = this.w * this.h;
    this.floor = new Uint8Array(n);
    this.blocked = new Uint8Array(n);
    this.clearance = new Float32Array(n);
    this.door = new Uint8Array(n);
    this.g = new Float32Array(n);
    this.f = new Float32Array(n);
    this.parent = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
  }

  cx(x: number): number {
    return Math.floor((x - this.minX) / this.cell);
  }
  cz(z: number): number {
    return Math.floor((z - this.minZ) / this.cell);
  }
  wx(cx: number): number {
    return this.minX + (cx + 0.5) * this.cell;
  }
  wz(cz: number): number {
    return this.minZ + (cz + 0.5) * this.cell;
  }
  private inBounds(cx: number, cz: number): boolean {
    return cx >= 0 && cz >= 0 && cx < this.w && cz < this.h;
  }

  // ---------- 搭建 ----------
  markFloorRect(x0: number, z0: number, x1: number, z1: number): void {
    const ax = Math.max(0, this.cx(Math.min(x0, x1)));
    const bx = Math.min(this.w - 1, this.cx(Math.max(x0, x1) - 1e-4));
    const az = Math.max(0, this.cz(Math.min(z0, z1)));
    const bz = Math.min(this.h - 1, this.cz(Math.max(z0, z1) - 1e-4));
    for (let z = az; z <= bz; z++) for (let x = ax; x <= bx; x++) this.floor[z * this.w + x] = 1;
  }

  markFloorDisc(cx: number, cz: number, r: number): void {
    const ax = Math.max(0, this.cx(cx - r));
    const bx = Math.min(this.w - 1, this.cx(cx + r));
    const az = Math.max(0, this.cz(cz - r));
    const bz = Math.min(this.h - 1, this.cz(cz + r));
    for (let z = az; z <= bz; z++)
      for (let x = ax; x <= bx; x++) {
        if (Math.hypot(this.wx(x) - cx, this.wz(z) - cz) <= r) this.floor[z * this.w + x] = 1;
      }
  }

  /** 把（可旋转的）盒体的水平投影标记为障碍 */
  blockBox(cx: number, cz: number, sx: number, sz: number, rotY = 0): void {
    const cos = Math.cos(rotY);
    const sin = Math.sin(rotY);
    const hx = sx / 2;
    const hz = sz / 2;
    const ex = Math.abs(hx * cos) + Math.abs(hz * sin);
    const ez = Math.abs(hx * sin) + Math.abs(hz * cos);
    const ax = Math.max(0, this.cx(cx - ex));
    const bx = Math.min(this.w - 1, this.cx(cx + ex));
    const az = Math.max(0, this.cz(cz - ez));
    const bz = Math.min(this.h - 1, this.cz(cz + ez));
    const pad = this.cell * 0.5;
    for (let z = az; z <= bz; z++)
      for (let x = ax; x <= bx; x++) {
        const dx = this.wx(x) - cx;
        const dz = this.wz(z) - cz;
        // 逆旋转到盒体局部坐标
        const lx = dx * cos - dz * sin;
        const lz = dx * sin + dz * cos;
        if (Math.abs(lx) <= hx + pad && Math.abs(lz) <= hz + pad) this.blocked[z * this.w + x] = 1;
      }
  }

  blockDisc(cx: number, cz: number, r: number): void {
    const ax = Math.max(0, this.cx(cx - r));
    const bx = Math.min(this.w - 1, this.cx(cx + r));
    const az = Math.max(0, this.cz(cz - r));
    const bz = Math.min(this.h - 1, this.cz(cz + r));
    for (let z = az; z <= bz; z++)
      for (let x = ax; x <= bx; x++) {
        if (Math.hypot(this.wx(x) - cx, this.wz(z) - cz) <= r + this.cell * 0.5) this.blocked[z * this.w + x] = 1;
      }
  }

  /** 注册一扇门占用的区域，返回 doorId */
  addDoor(x0: number, z0: number, x1: number, z1: number): number {
    const id = this.doorOpen.length;
    this.doorOpen.push(false);
    const ax = Math.max(0, this.cx(Math.min(x0, x1)));
    const bx = Math.min(this.w - 1, this.cx(Math.max(x0, x1) - 1e-4));
    const az = Math.max(0, this.cz(Math.min(z0, z1)));
    const bz = Math.min(this.h - 1, this.cz(Math.max(z0, z1) - 1e-4));
    for (let z = az; z <= bz; z++)
      for (let x = ax; x <= bx; x++) {
        const i = z * this.w + x;
        this.door[i] = id + 1;
        this.floor[i] = 1;
        this.blocked[i] = 0;
      }
    return id;
  }

  setDoorOpen(id: number, open: boolean): void {
    this.doorOpen[id] = open;
  }

  /** 预计算 clearance（两遍 chamfer 距离变换） */
  bake(): void {
    const { w, h, cell } = this;
    const c = this.clearance;
    const INF = 1e6;
    for (let i = 0; i < c.length; i++) c[i] = this.floor[i] && !this.blocked[i] ? INF : 0;
    const D1 = cell;
    const D2 = cell * Math.SQRT2;
    for (let z = 0; z < h; z++)
      for (let x = 0; x < w; x++) {
        const i = z * w + x;
        if (c[i] === 0) continue;
        let v = c[i];
        if (x > 0) v = Math.min(v, c[i - 1] + D1);
        else v = Math.min(v, D1);
        if (z > 0) {
          v = Math.min(v, c[i - w] + D1);
          if (x > 0) v = Math.min(v, c[i - w - 1] + D2);
          if (x < w - 1) v = Math.min(v, c[i - w + 1] + D2);
        } else v = Math.min(v, D1);
        c[i] = v;
      }
    for (let z = h - 1; z >= 0; z--)
      for (let x = w - 1; x >= 0; x--) {
        const i = z * w + x;
        if (c[i] === 0) continue;
        let v = c[i];
        if (x < w - 1) v = Math.min(v, c[i + 1] + D1);
        else v = Math.min(v, D1);
        if (z < h - 1) {
          v = Math.min(v, c[i + w] + D1);
          if (x < w - 1) v = Math.min(v, c[i + w + 1] + D2);
          if (x > 0) v = Math.min(v, c[i + w - 1] + D2);
        } else v = Math.min(v, D1);
        c[i] = v;
      }
  }

  // ---------- 查询 ----------
  private okIdx(i: number, radius: number): boolean {
    if (this.clearance[i] < radius) return false;
    const d = this.door[i];
    return d === 0 || this.doorOpen[d - 1];
  }

  isWalkable(x: number, z: number, radius: number): boolean {
    const cx = this.cx(x);
    const cz = this.cz(z);
    if (!this.inBounds(cx, cz)) return false;
    return this.okIdx(cz * this.w + cx, radius);
  }

  /** 两点间直线是否全程可走 */
  lineWalkable(ax: number, az: number, bx: number, bz: number, radius: number): boolean {
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    const steps = Math.max(1, Math.ceil(len / (this.cell * 0.5)));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      if (!this.isWalkable(ax + dx * t, az + dz * t, radius)) return false;
    }
    return true;
  }

  /** 螺旋搜索最近的可走点 */
  nearestWalkable(x: number, z: number, radius: number, maxRange = 6, out = new THREE.Vector3()): THREE.Vector3 | null {
    const cx = this.cx(x);
    const cz = this.cz(z);
    if (this.inBounds(cx, cz) && this.okIdx(cz * this.w + cx, radius)) return out.set(x, 0, z);
    const maxR = Math.ceil(maxRange / this.cell);
    for (let r = 1; r <= maxR; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dz = -r; dz <= r; dz++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const nx = cx + dx;
          const nz = cz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const i = nz * this.w + nx;
          if (!this.okIdx(i, radius)) continue;
          const d = dx * dx + dz * dz;
          if (d < bestD) {
            bestD = d;
            best = i;
          }
        }
      if (best >= 0) return out.set(this.wx(best % this.w), 0, this.wz(Math.floor(best / this.w)));
    }
    return null;
  }

  /** 在环形范围内随机取一个可走点 */
  randomPointNear(x: number, z: number, rMin: number, rMax: number, radius: number, out = new THREE.Vector3(), tries = 12): THREE.Vector3 | null {
    for (let i = 0; i < tries; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = rMin + Math.random() * (rMax - rMin);
      const px = x + Math.cos(a) * r;
      const pz = z + Math.sin(a) * r;
      if (this.isWalkable(px, pz, radius)) return out.set(px, 0, pz);
    }
    return null;
  }

  // ---------- A* ----------
  private heapPush(i: number): void {
    const heap = this.heap;
    const f = this.f;
    heap.push(i);
    let c = heap.length - 1;
    while (c > 0) {
      const p = (c - 1) >> 1;
      if (f[heap[p]] <= f[heap[c]]) break;
      const t = heap[p];
      heap[p] = heap[c];
      heap[c] = t;
      c = p;
    }
  }
  private heapPop(): number {
    const heap = this.heap;
    const f = this.f;
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length > 0) {
      heap[0] = last;
      let p = 0;
      for (;;) {
        const l = p * 2 + 1;
        const r = l + 1;
        let m = p;
        if (l < heap.length && f[heap[l]] < f[heap[m]]) m = l;
        if (r < heap.length && f[heap[r]] < f[heap[m]]) m = r;
        if (m === p) break;
        const t = heap[p];
        heap[p] = heap[m];
        heap[m] = t;
        p = m;
      }
    }
    return top;
  }

  private _s = new THREE.Vector3();
  private _e = new THREE.Vector3();

  /** 寻路。返回平滑后的路径点（不含起点），失败返回 null。 */
  findPath(from: THREE.Vector3, to: THREE.Vector3, radius: number, maxExpand = 12000): THREE.Vector3[] | null {
    const s = this.nearestWalkable(from.x, from.z, radius, 4, this._s);
    const e = this.nearestWalkable(to.x, to.z, radius, 5, this._e);
    if (!s || !e) return null;
    if (this.lineWalkable(s.x, s.z, e.x, e.z, radius)) return [new THREE.Vector3(e.x, 0, e.z)];
    const w = this.w;
    const sx = this.cx(s.x);
    const sz = this.cz(s.z);
    const ex = this.cx(e.x);
    const ez = this.cz(e.z);
    const start = sz * w + sx;
    const goal = ez * w + ex;
    const stamp = ++this.curStamp;
    this.heap.length = 0;
    this.g[start] = 0;
    this.f[start] = 0;
    this.parent[start] = -1;
    this.stamp[start] = stamp;
    this.heapPush(start);
    let expanded = 0;
    let found = false;
    const cell = this.cell;
    while (this.heap.length > 0 && expanded < maxExpand) {
      const cur = this.heapPop();
      if (cur === goal) {
        found = true;
        break;
      }
      if (this.closed[cur] === stamp) continue;
      this.closed[cur] = stamp;
      expanded++;
      const cxx = cur % w;
      const czz = (cur - cxx) / w;
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dz === 0) continue;
          const nx = cxx + dx;
          const nz = czz + dz;
          if (!this.inBounds(nx, nz)) continue;
          const ni = nz * w + nx;
          if (this.closed[ni] === stamp || !this.okIdx(ni, radius)) continue;
          if (dx !== 0 && dz !== 0) {
            // 禁止切角
            if (!this.okIdx(czz * w + nx, radius) || !this.okIdx(nz * w + cxx, radius)) continue;
          }
          // 轻微惩罚贴墙，使路径更自然
          const wallPenalty = this.clearance[ni] < radius + 0.6 ? 0.6 : 0;
          const ng = this.g[cur] + (dx !== 0 && dz !== 0 ? 1.4142 : 1) * cell + wallPenalty * cell;
          if (this.stamp[ni] !== stamp || ng < this.g[ni]) {
            this.stamp[ni] = stamp;
            this.g[ni] = ng;
            const hx = Math.abs(nx - ex);
            const hz = Math.abs(nz - ez);
            this.f[ni] = ng + (Math.max(hx, hz) + 0.4142 * Math.min(hx, hz)) * cell;
            this.parent[ni] = cur;
            this.heapPush(ni);
          }
        }
    }
    if (!found) return null;
    // 回溯
    const raw: THREE.Vector3[] = [];
    let n = goal;
    while (n !== -1 && n !== start) {
      const x = n % w;
      raw.push(new THREE.Vector3(this.wx(x), 0, this.wz((n - x) / w)));
      n = this.parent[n];
    }
    raw.reverse();
    if (raw.length > 0) raw[raw.length - 1].set(e.x, 0, e.z);
    // 拉直：贪心视线简化
    const out: THREE.Vector3[] = [];
    let ax = s.x;
    let az = s.z;
    let i = 0;
    while (i < raw.length) {
      let j = Math.min(raw.length - 1, i + 40);
      while (j > i && !this.lineWalkable(ax, az, raw[j].x, raw[j].z, radius)) j--;
      out.push(raw[j]);
      ax = raw[j].x;
      az = raw[j].z;
      i = j + 1;
    }
    return out;
  }
}
