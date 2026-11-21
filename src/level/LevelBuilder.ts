import * as THREE from 'three';
import { RNG } from '../core/math';
import { Physics, RAPIER } from '../physics/Physics';
import { GeoBatch, BoxOpts } from '../render/GeoBatch';
import { Gfx } from '../render/Gfx';
import { MaterialLibrary } from '../render/Materials';
import { NavGrid } from './NavGrid';

export interface SolidOpts extends BoxOpts {
  /** 是否阻挡导航；默认按高度自动判断 */
  nav?: boolean;
  /** 是否生成碰撞体（默认 true） */
  collide?: boolean;
}

export interface Opening {
  /** 开口中心（沿墙方向的坐标） */
  c: number;
  w: number;
  h: number;
}

function shaftMaterial(color: number, strength: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uColor: { value: new THREE.Color(color) }, uStrength: { value: strength } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        vUv = uv;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor; uniform float uStrength;
      varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      void main() {
        // 注意：MSAA 下 varying 会外插到 [0,1] 之外；pow(负数) 在真实 GPU 上是 NaN，会被 Bloom 扩散成黑块
        float rim = pow(clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 2.2);
        float fade = pow(clamp(vUv.y, 0.0, 1.0), 1.6);
        gl_FragColor = vec4(uColor * rim * fade * uStrength, 1.0);
      }`,
  });
}

/**
 * 模块化关卡搭建套件：结构（地板/墙/天花板）、灯具、管线、道具。
 * 所有静态几何按"分区 × 材质"合批，并同步生成 Rapier 碰撞体与导航障碍。
 */
export class LevelBuilder {
  zoneGroups: THREE.Group[] = [];
  /** 用于在关卡卸载时释放 */
  private ownedGeometries: THREE.BufferGeometry[] = [];
  private ownedMaterials: THREE.Material[] = [];
  private ownedTextures: THREE.Texture[] = [];
  private batch = new GeoBatch();
  zone = 0;
  private receiveShadow = true;
  rng = new RNG(20891);
  shafts: Record<'white' | 'cyan' | 'warm' | 'red', THREE.ShaderMaterial>;

  constructor(public gfx: Gfx, public physics: Physics, public mats: MaterialLibrary, public nav: NavGrid) {
    this.shafts = {
      white: shaftMaterial(0xbfd8ff, 0.16),
      cyan: shaftMaterial(0x35e0ff, 0.16),
      warm: shaftMaterial(0xffb070, 0.17),
      red: shaftMaterial(0xff3020, 0.15),
    };
    this.ownedMaterials.push(...Object.values(this.shafts));
  }

  beginZone(index: number): THREE.Group {
    this.zone = index;
    const g = new THREE.Group();
    g.name = 'zone' + index;
    this.zoneGroups[index] = g;
    this.gfx.scene.add(g);
    return g;
  }

  endZone(): void {
    const meshes = this.batch.build(this.zoneGroups[this.zone], this.receiveShadow);
    for (const m of meshes) this.ownedGeometries.push(m.geometry);
  }

  group(): THREE.Group {
    return this.zoneGroups[this.zone];
  }

  own<T extends THREE.BufferGeometry | THREE.Material | THREE.Texture>(r: T): T {
    if (r instanceof THREE.BufferGeometry) this.ownedGeometries.push(r);
    else if (r instanceof THREE.Material) this.ownedMaterials.push(r);
    else this.ownedTextures.push(r as THREE.Texture);
    return r;
  }

  // ---------- 基础体 ----------
  deco(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: BoxOpts = {}): void {
    this.batch.box(mat, cx, cy, cz, sx, sy, sz, opts);
  }

  collider(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0, nav?: boolean): RAPIER.Collider {
    const c = this.physics.addStaticBox(cx, cy, cz, sx, sy, sz, rotY);
    const bottom = cy - sy / 2;
    const top = cy + sy / 2;
    const blocks = nav ?? (bottom < 1.7 && top > 0.35);
    if (blocks) this.nav.blockBox(cx, cz, sx, sz, rotY);
    return c;
  }

  solid(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: SolidOpts = {}): void {
    this.batch.box(mat, cx, cy, cz, sx, sy, sz, opts);
    if (opts.collide !== false) this.collider(cx, cy, cz, sx, sy, sz, opts.rotY ?? 0, opts.nav);
  }

  /** 以最小/最大角定义的盒体（搭建结构更直观） */
  block(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, opts: SolidOpts = {}): void {
    this.solid(mat, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), opts);
  }

  mesh(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, cast = false, scale: number | [number, number, number] = 1): void {
    this.batch.add(mat, geo, x, y, z, rx, ry, rz, cast, scale);
  }

  floor(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y = 0, nav = true): void {
    this.batch.box(mat, (x0 + x1) / 2, y - 0.5, (z0 + z1) / 2, Math.abs(x1 - x0), 1, Math.abs(z1 - z0), { skip: ['-y'] });
    this.physics.addStaticBox((x0 + x1) / 2, y - 0.5, (z0 + z1) / 2, Math.abs(x1 - x0), 1, Math.abs(z1 - z0));
    if (nav) this.nav.markFloorRect(x0, z0, x1, z1);
  }

  ceiling(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number): void {
    this.batch.box(mat, (x0 + x1) / 2, y + 0.5, (z0 + z1) / 2, Math.abs(x1 - x0), 1, Math.abs(z1 - z0), { skip: ['+y'] });
    this.physics.addStaticBox((x0 + x1) / 2, y + 0.5, (z0 + z1) / 2, Math.abs(x1 - x0), 1, Math.abs(z1 - z0));
  }

  /** 沿 X 方向的墙（位于 z，厚度向 ±z 各一半）。openings 的 c 为 x 坐标。 */
  wallX(mat: THREE.Material, z: number, x0: number, x1: number, y0: number, h: number, thick: number, openings: Opening[] = [], opts: SolidOpts = {}): void {
    const segs = this.splitWall(Math.min(x0, x1), Math.max(x0, x1), openings);
    for (const [a, b] of segs) this.block(mat, a, y0, z - thick / 2, b, y0 + h, z + thick / 2, opts);
    for (const o of openings) {
      if (o.h < h) this.block(mat, o.c - o.w / 2, y0 + o.h, z - thick / 2, o.c + o.w / 2, y0 + h, z + thick / 2, opts);
    }
  }

  /** 沿 Z 方向的墙（位于 x）。openings 的 c 为 z 坐标。 */
  wallZ(mat: THREE.Material, x: number, z0: number, z1: number, y0: number, h: number, thick: number, openings: Opening[] = [], opts: SolidOpts = {}): void {
    const segs = this.splitWall(Math.min(z0, z1), Math.max(z0, z1), openings);
    for (const [a, b] of segs) this.block(mat, x - thick / 2, y0, a, x + thick / 2, y0 + h, b, opts);
    for (const o of openings) {
      if (o.h < h) this.block(mat, x - thick / 2, y0 + o.h, o.c - o.w / 2, x + thick / 2, y0 + h, o.c + o.w / 2, opts);
    }
  }

  private splitWall(a: number, b: number, openings: Opening[]): [number, number][] {
    const sorted = [...openings].sort((p, q) => p.c - q.c);
    const out: [number, number][] = [];
    let cur = a;
    for (const o of sorted) {
      const s = o.c - o.w / 2;
      const e = o.c + o.w / 2;
      if (s > cur + 1e-3) out.push([cur, s]);
      cur = e;
    }
    if (b > cur + 1e-3) out.push([cur, b]);
    return out;
  }

  /** 门框：发光边条 + 厚重门楣，统一门的视觉语言 */
  doorFrame(x: number, z: number, w: number, h: number, axis: 'x' | 'z', depth: number, glow: THREE.Material): void {
    const m = this.mats;
    const t = 0.35;
    if (axis === 'x') {
      this.deco(m.trim, x - w / 2 - t / 2, h / 2, z, t, h, depth + 0.3, { castShadow: false });
      this.deco(m.trim, x + w / 2 + t / 2, h / 2, z, t, h, depth + 0.3);
      this.deco(m.trim, x, h + t / 2, z, w + t * 2, t, depth + 0.3);
      this.deco(m.hazard, x, h + t + 0.15, z, w + t * 2, 0.3, depth + 0.34);
      for (const s of [-1, 1]) {
        this.deco(glow, x - w / 2 - t / 2, h / 2, z + s * (depth / 2 + 0.16), 0.08, h * 0.8, 0.03);
        this.deco(glow, x + w / 2 + t / 2, h / 2, z + s * (depth / 2 + 0.16), 0.08, h * 0.8, 0.03);
      }
    } else {
      this.deco(m.trim, x, h / 2, z - w / 2 - t / 2, depth + 0.3, h, t);
      this.deco(m.trim, x, h / 2, z + w / 2 + t / 2, depth + 0.3, h, t);
      this.deco(m.trim, x, h + t / 2, z, depth + 0.3, t, w + t * 2);
      this.deco(m.hazard, x, h + t + 0.15, z, depth + 0.34, 0.3, w + t * 2);
      for (const s of [-1, 1]) {
        this.deco(glow, x + s * (depth / 2 + 0.16), h / 2, z - w / 2 - t / 2, 0.03, h * 0.8, 0.08);
        this.deco(glow, x + s * (depth / 2 + 0.16), h / 2, z + w / 2 + t / 2, 0.03, h * 0.8, 0.08);
      }
    }
  }

  // ---------- 灯具 ----------
  /** 吊顶灯：灯体 + 发光面 + 光柱 + 灯位 */
  ceilingLamp(x: number, y: number, z: number, color: number, intensity: number, distance: number, opts: { glow?: THREE.Material; shaft?: keyof LevelBuilder['shafts'] | null; size?: number; flicker?: number; shaftH?: number } = {}): void {
    const m = this.mats;
    const s = opts.size ?? 1.2;
    const glow = opts.glow ?? m.glowWhite;
    this.deco(m.metalDark, x, y - 0.1, z, s + 0.25, 0.2, s * 0.55 + 0.25);
    this.deco(glow, x, y - 0.215, z, s, 0.04, s * 0.5);
    const shaft = opts.shaft === undefined ? 'white' : opts.shaft;
    if (shaft) {
      const hh = opts.shaftH ?? Math.min(y - 0.3, 7);
      const geo = new THREE.CylinderGeometry(s * 0.35, s * 0.35 + hh * 0.42, hh, 14, 1, true);
      this.batch.add(this.shafts[shaft], geo, x, y - 0.25 - hh / 2, z);
    }
    this.gfx.lights.addSocket(x, y - 0.9, z, color, intensity, distance, this.zone, opts.flicker ?? 0);
  }

  /** 细长灯带（沿 X 或 Z） */
  strip(mat: THREE.Material, x: number, y: number, z: number, len: number, axis: 'x' | 'z', thick = 0.08): void {
    if (axis === 'x') this.deco(mat, x, y, z, len, thick, thick);
    else this.deco(mat, x, y, z, thick, thick, len);
  }

  /** 仅添加灯位（配合已有的发光几何） */
  socket(x: number, y: number, z: number, color: number, intensity: number, distance: number, flicker = 0): void {
    this.gfx.lights.addSocket(x, y, z, color, intensity, distance, this.zone, flicker);
  }

  // ---------- 管线 / 圆柱 ----------
  pipe(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, cast = false): void {
    const a = new THREE.Vector3(x0, y0, z0);
    const b = new THREE.Vector3(x1, y1, z1);
    const len = a.distanceTo(b);
    const geo = new THREE.CylinderGeometry(r, r, len, 12, 1, true);
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    const mtx = new THREE.Matrix4().compose(mid, q, new THREE.Vector3(1, 1, 1));
    this.batch.geo(mat, geo, mtx, cast, Math.max(1, Math.round(len / 2)));
    geo.dispose();
    // 法兰
    const n = Math.max(1, Math.floor(len / 3));
    for (let i = 0; i <= n; i++) {
      const p = a.clone().lerp(b, n === 0 ? 0.5 : i / n);
      const fg = new THREE.CylinderGeometry(r * 1.25, r * 1.25, 0.12, 12);
      this.batch.geo(this.mats.metalDark, fg, new THREE.Matrix4().compose(p, q, new THREE.Vector3(1, 1, 1)), false);
      fg.dispose();
    }
  }

  cylinder(mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, opts: { collide?: boolean; cast?: boolean; segs?: number; rTop?: number } = {}): void {
    const geo = new THREE.CylinderGeometry(opts.rTop ?? r, r, h, opts.segs ?? 20);
    this.batch.add(mat, geo, x, y + h / 2, z, 0, 0, 0, opts.cast ?? true);
    if (opts.collide !== false) {
      this.physics.addStaticCylinder(x, y + h / 2, z, r, h);
      if (y < 1.7 && y + h > 0.35) this.nav.blockDisc(x, z, r);
    }
  }

  // ---------- 道具 ----------
  crate(x: number, z: number, size: number, mat?: THREE.Material, y = 0, rotY = 0, hScale = 1): void {
    const m = mat ?? this.rng.pick([this.mats.crateOlive, this.mats.crateOlive, this.mats.crateBlue, this.mats.crateOrange]);
    const h = size * hScale;
    this.solid(m, x, y + h / 2, z, size, h, size, { rotY, tile: 0, castShadow: true });
  }

  /** 货箱堆：以 (x,z) 为中心生成 n 个略带随机的箱子（可叠放） */
  crateCluster(x: number, z: number, layout: [number, number, number, number?][]): void {
    for (const [dx, dz, size, level] of layout) {
      const y = (level ?? 0) * size;
      this.crate(x + dx, z + dz, size, undefined, y, this.rng.range(-0.08, 0.08));
    }
  }

  /** 发光屏幕（独立 Mesh，方便做全息闪烁） */
  screen(tex: THREE.Texture, x: number, y: number, z: number, w: number, h: number, rotY: number, intensity = 1.5, tiltX = 0): THREE.Mesh {
    this.own(tex);
    const mat = this.own(new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(intensity, intensity, intensity), toneMapped: false, fog: false }));
    const geo = this.own(new THREE.PlaneGeometry(w, h));
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(tiltX, rotY, 0, 'YXZ');
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group().add(mesh);
    return mesh;
  }

  /** 墙面喷涂标识 */
  sign(tex: THREE.Texture, x: number, y: number, z: number, w: number, h: number, rotY: number, opacity = 0.85): void {
    this.own(tex);
    const mat = this.own(new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, color: 0x9aa4ae }));
    const mesh = new THREE.Mesh(this.own(new THREE.PlaneGeometry(w, h)), mat);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    this.group().add(mesh);
  }

  /** 程序化岩石：噪声位移的二十面体 */
  rock(x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number, collide = true): void {
    const geo = new THREE.IcosahedronGeometry(1, 3);
    const pos = geo.getAttribute('position');
    const rng = new RNG(seed);
    const ph = [rng.range(0, 9), rng.range(0, 9), rng.range(0, 9)];
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const n =
        Math.sin(v.x * 2.3 + ph[0]) * Math.cos(v.y * 2.9 + ph[1]) * 0.22 +
        Math.sin(v.z * 4.1 + ph[2] + v.x * 1.7) * 0.12 +
        Math.sin(v.y * 7.3 + v.z * 5.1 + ph[0]) * 0.05;
      const flat = v.y < -0.3 ? 0.6 : 1;
      v.multiplyScalar((1 + n) * flat);
      // 棱角化
      v.x = Math.round(v.x * 3.2) / 3.2 * 0.35 + v.x * 0.65;
      v.y = Math.round(v.y * 2.6) / 2.6 * 0.4 + v.y * 0.6;
      pos.setXYZ(i, v.x, v.y, v.z);
    }
    geo.computeVertexNormals();
    const mtx = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.2, 0.2), rng.range(0, 6.28), rng.range(-0.2, 0.2))),
      new THREE.Vector3(sx, sy, sz),
    );
    this.batch.geo(this.mats.rock, geo, mtx, true, Math.max(1, Math.round(Math.max(sx, sz) / 2.5)));
    geo.dispose();
    if (collide) this.collider(x, y, z, sx * 1.5, sy * 1.7, sz * 1.5, 0, true);
  }

  /** 栏杆（沿 X 或 Z），带碰撞 */
  railing(x0: number, z0: number, x1: number, z1: number, y: number): void {
    const m = this.mats;
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    const sx = alongX ? len : 0.06;
    const sz = alongX ? 0.06 : len;
    this.deco(m.metalMid, cx, y + 1.05, cz, sx, 0.07, sz);
    this.deco(m.metalMid, cx, y + 0.55, cz, sx * (alongX ? 1 : 0.6), 0.04, sz * (alongX ? 0.6 : 1));
    const n = Math.max(1, Math.round(len / 1.6));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      this.deco(m.metalDark, x0 + (x1 - x0) * t, y + 0.53, z0 + (z1 - z0) * t, 0.07, 1.06, 0.07);
    }
    this.collider(cx, y + 0.55, cz, alongX ? len : 0.12, 1.1, alongX ? 0.12 : len, 0, false);
  }

  dispose(): void {
    for (const g of this.zoneGroups) {
      if (!g) continue;
      this.gfx.scene.remove(g);
    }
    for (const g of this.ownedGeometries) g.dispose();
    for (const m of this.ownedMaterials) m.dispose();
    for (const t of this.ownedTextures) t.dispose();
    this.zoneGroups = [];
  }
}
