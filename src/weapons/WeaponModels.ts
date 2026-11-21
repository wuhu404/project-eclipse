import * as THREE from 'three';
import { glowMat } from '../render/Materials';
import type { WeaponId } from './WeaponDefs';

/** 第一人称武器视图模型。枪管朝 -Z，+Y 向上，+X 为右；所有网格位于 layer 1。 */
export interface WeaponView {
  id: WeaponId;
  root: THREE.Group;
  /** 枪口位置（本地空间挂点） */
  muzzle: THREE.Object3D;
  /** 弹匣 / 能量电池（换弹动画） */
  mag: THREE.Object3D | null;
  /** AR：拉机柄；Viper：泵动护木（左手挂在其下）；Helix：散热片 */
  bolt: THREE.Object3D | null;
  /** 抛壳口 */
  eject: THREE.Object3D | null;
  /** 随热量变化的发光材质 */
  heatMat: THREE.MeshBasicMaterial | null;
  /** 腰射与开镜时模型在相机空间的位置 */
  hipPos: THREE.Vector3;
  adsPos: THREE.Vector3;
  dispose(): void;
}

/** 武器专用材质：比场景材质更亮、反射更强，保证在昏暗环境里轮廓清晰 */
export interface WeaponMats {
  steel: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  black: THREE.MeshStandardMaterial;
  poly: THREE.MeshStandardMaterial;
  tan: THREE.MeshStandardMaterial;
  orange: THREE.MeshStandardMaterial;
  ceramic: THREE.MeshStandardMaterial;
  brass: THREE.MeshStandardMaterial;
  red: THREE.MeshStandardMaterial;
  glove: THREE.MeshStandardMaterial;
  sleeve: THREE.MeshStandardMaterial;
  plate: THREE.MeshStandardMaterial;
}

export function createWeaponMats(): WeaponMats {
  const m = (color: number, roughness: number, metalness: number, env = 1.6): THREE.MeshStandardMaterial => new THREE.MeshStandardMaterial({ color, roughness, metalness, envMapIntensity: env });
  return {
    steel: m(0x7d8894, 0.34, 0.85, 2.4),
    dark: m(0x3d444d, 0.42, 0.8, 2.2),
    black: m(0x1b1e22, 0.5, 0.6, 1.6),
    poly: m(0x2b3037, 0.62, 0.15, 1.2),
    tan: m(0x8a7a5e, 0.66, 0.1, 1.0),
    orange: m(0xd9661a, 0.5, 0.3, 1.3),
    ceramic: m(0xcfd8e2, 0.3, 0.25, 1.8),
    brass: m(0xc79a3c, 0.3, 0.9, 2.2),
    red: m(0xa82420, 0.45, 0.4, 1.4),
    glove: m(0x22262b, 0.82, 0.05, 0.7),
    sleeve: m(0x39444f, 0.88, 0.0, 0.5),
    plate: m(0x5f6a76, 0.4, 0.7, 1.9),
  };
}

export function disposeWeaponMats(wm: WeaponMats): void {
  for (const k of Object.keys(wm) as (keyof WeaponMats)[]) wm[k].dispose();
}

const ZERO = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

class Builder {
  geos: THREE.BufferGeometry[] = [];
  mats: THREE.Material[] = [];
  constructor(public root: THREE.Object3D) {}

  private addMesh(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    this.geos.push(geo);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.frustumCulled = false;
    parent.add(m);
    return m;
  }

  box(mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number, parent: THREE.Object3D = this.root): THREE.Mesh {
    return this.addMesh(parent, new THREE.BoxGeometry(w, h, d), mat, x, y, z);
  }

  /** 沿 Z 轴的圆柱（r = -Z 端半径，r2 = +Z 端半径） */
  cyl(mat: THREE.Material, r: number, len: number, x: number, y: number, z: number, parent: THREE.Object3D = this.root, segs = 14, r2 = r): THREE.Mesh {
    const g = new THREE.CylinderGeometry(r2, r, len, segs);
    g.rotateX(Math.PI / 2);
    return this.addMesh(parent, g, mat, x, y, z);
  }

  /**
   * 侧面轮廓（[z, y] 点列，z 为枪身前后方向，负值朝枪口）沿 X 拉伸并倒角。
   * 用于机匣、护木、枪托、握把等主体造型。
   */
  profile(mat: THREE.Material, pts: [number, number][], width: number, x = 0, y = 0, z = 0, parent: THREE.Object3D = this.root, bevel = 0.004): THREE.Mesh {
    const shape = new THREE.Shape();
    pts.forEach(([pz, py], i) => (i === 0 ? shape.moveTo(pz, py) : shape.lineTo(pz, py)));
    shape.closePath();
    const depth = Math.max(0.001, width - bevel * 2);
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -depth / 2);
    // 形状平面 XY → 枪身 ZY：形状的 X 轴映射到枪身 +Z，拉伸方向映射到 X
    g.rotateY(-Math.PI / 2);
    return this.addMesh(parent, g, mat, x, y, z);
  }

  group(x: number, y: number, z: number, parent: THREE.Object3D = this.root): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }

  own<T extends THREE.Material>(m: T): T {
    this.mats.push(m);
    return m;
  }
}

/** 前臂：从手腕 pos 沿 dir（指向肘部）延伸，带护甲板与发光条 */
function forearm(b: Builder, wm: WeaponMats, parent: THREE.Object3D, pos: THREE.Vector3, dir: THREE.Vector3, glow: THREE.Material): void {
  const g = new THREE.Group();
  g.position.copy(pos);
  g.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(dir.clone().normalize(), ZERO, UP)); // 本地 +Z = dir
  parent.add(g);
  b.cyl(wm.glove, 0.04, 0.07, 0, 0, 0.02, g, 10, 0.043); // 手套袖口
  b.cyl(wm.sleeve, 0.041, 0.46, 0, 0, 0.28, g, 10, 0.056);
  b.box(wm.plate, 0.072, 0.02, 0.2, 0, 0.047, 0.22, g);
  b.box(wm.plate, 0.02, 0.07, 0.18, -0.047, 0.0, 0.22, g);
  b.box(glow, 0.01, 0.003, 0.045, 0.02, 0.058, 0.17, g);
  b.cyl(wm.dark, 0.047, 0.03, 0, 0, 0.07, g, 10, 0.048);
}

/**
 * 双手：右手握住握把（grip = 握把中心），左手托住护木（support = 手掌中心，位于护木底面下方）。
 * 手指用若干小盒体表现，从第一人称视角主要看到拇指、手背与前臂。
 */
function hands(b: Builder, wm: WeaponMats, grip: THREE.Vector3, support: THREE.Vector3, supportParent: THREE.Object3D, glow: THREE.Material): void {
  // ----- 右手 -----
  const r = b.group(grip.x, grip.y, grip.z);
  const back = b.box(wm.glove, 0.088, 0.1, 0.05, 0.004, 0.0, 0.062, r);
  back.rotation.x = -0.25;
  b.box(wm.plate, 0.06, 0.05, 0.012, 0.004, 0.012, 0.094, r).rotation.x = -0.25; // 指节护板
  for (let i = 0; i < 3; i++) b.box(wm.glove, 0.094, 0.024, 0.036, 0, 0.012 - i * 0.027, -0.05 + i * 0.006, r);
  b.box(wm.glove, 0.022, 0.026, 0.08, -0.04, 0.05, 0.0, r); // 拇指
  forearm(b, wm, r, new THREE.Vector3(0.006, -0.03, 0.09), new THREE.Vector3(0.2, -0.36, 0.91), glow);
  // ----- 左手 -----
  const l = b.group(support.x, support.y, support.z, supportParent);
  b.box(wm.glove, 0.098, 0.032, 0.115, 0, 0, 0, l); // 手掌
  const thumb = b.box(wm.glove, 0.022, 0.075, 0.034, -0.05, 0.035, -0.02, l);
  thumb.rotation.x = 0.35;
  for (let i = 0; i < 4; i++) b.box(wm.glove, 0.022, 0.066, 0.024, 0.05, 0.035, -0.045 + i * 0.027, l);
  b.box(wm.plate, 0.012, 0.04, 0.07, -0.056, -0.004, 0.02, l);
  b.box(wm.glove, 0.084, 0.05, 0.07, -0.012, -0.014, 0.07, l); // 掌根
  forearm(b, wm, l, new THREE.Vector3(-0.02, -0.02, 0.095), new THREE.Vector3(-0.52, -0.3, 0.8), glow);
}

function finish(view: Omit<WeaponView, 'dispose'>, b: Builder): WeaponView {
  view.root.traverse((o) => {
    o.layers.set(1);
    o.frustumCulled = false;
  });
  return {
    ...view,
    dispose() {
      for (const g of b.geos) g.dispose();
      for (const m of b.mats) m.dispose();
    },
  };
}

/** 全息瞄具：细框 + 淡色镜片 + 发光准星（位于 y=cy 的高度） */
function holoSight(b: Builder, wm: WeaponMats, cy: number, z: number, color: number, w = 0.044, h = 0.04): void {
  const base = cy - h / 2 - 0.008;
  b.box(wm.dark, w + 0.008, 0.012, 0.075, 0, base, z);
  b.box(wm.black, 0.005, h + 0.006, 0.05, -w / 2, cy, z);
  b.box(wm.black, 0.005, h + 0.006, 0.05, w / 2, cy, z);
  b.box(wm.black, w + 0.005, 0.005, 0.056, 0, cy + h / 2 + 0.003, z);
  b.box(wm.steel, 0.012, 0.012, 0.03, w / 2 + 0.008, cy - 0.01, z + 0.012); // 调节旋钮
  const lens = b.own(new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.07, depthWrite: false }));
  b.box(lens, w - 0.004, h, 0.001, 0, cy, z - 0.012);
  const dot = b.own(glowMat(color, 3));
  dot.transparent = true;
  dot.depthTest = false;
  dot.depthWrite = false;
  const ringGeo = new THREE.RingGeometry(0.0062, 0.0074, 28);
  const dotGeo = new THREE.CircleGeometry(0.0013, 12);
  b.geos.push(ringGeo, dotGeo);
  for (const g of [ringGeo, dotGeo]) {
    const m = new THREE.Mesh(g, dot);
    m.position.set(0, cy, z - 0.013);
    m.renderOrder = 30;
    b.root.add(m);
  }
  for (const [dx, dy] of [[0.0105, 0], [-0.0105, 0], [0, -0.0105]] as const) {
    const tick = b.box(dot, dx ? 0.005 : 0.0009, dx ? 0.0009 : 0.005, 0.0005, dx, cy + dy, z - 0.013);
    tick.renderOrder = 30;
  }
}

// =====================================================================================
// AR-9 突击步枪：军用制式外观——钢灰机匣、聚合物护木、橙色识别件、全息瞄具
// =====================================================================================
function buildAR9(wm: WeaponMats): WeaponView {
  const root = new THREE.Group();
  const b = new Builder(root);
  const glow = b.own(glowMat(0xff8a2a, 1.3));
  // 上机匣
  b.profile(wm.steel, [[0.16, 0.0], [0.16, 0.044], [0.14, 0.06], [-0.33, 0.06], [-0.36, 0.048], [-0.36, 0.012], [-0.34, 0.0]], 0.05);
  // 下机匣 + 弹匣井
  b.profile(wm.dark, [[0.16, 0.002], [0.16, -0.034], [0.06, -0.05], [-0.1, -0.05], [-0.14, -0.03], [-0.14, 0.002]], 0.046);
  // 顶部导轨
  b.box(wm.black, 0.026, 0.006, 0.48, 0, 0.063, -0.1);
  for (let i = 0; i < 16; i++) b.box(wm.dark, 0.03, 0.007, 0.011, 0, 0.068, 0.125 - i * 0.03);
  // 护木：聚合物外壳 + 散热孔 + 左右导轨条
  b.profile(wm.poly, [[-0.14, 0.05], [-0.14, -0.042], [-0.2, -0.052], [-0.44, -0.052], [-0.47, -0.034], [-0.47, 0.05]], 0.06);
  for (let i = 0; i < 6; i++) {
    b.box(wm.black, 0.064, 0.012, 0.028, 0, 0.012, -0.19 - i * 0.045);
    b.box(wm.black, 0.064, 0.008, 0.028, 0, -0.022, -0.19 - i * 0.045);
  }
  b.box(wm.orange, 0.063, 0.01, 0.07, 0, 0.04, -0.435); // 前端识别带
  b.box(wm.steel, 0.066, 0.02, 0.02, 0, 0.0, -0.475);
  // 枪管、导气箍、消焰器
  b.cyl(wm.dark, 0.012, 0.22, 0, 0.022, -0.57);
  b.box(wm.steel, 0.03, 0.05, 0.03, 0, 0.034, -0.56);
  b.cyl(wm.steel, 0.019, 0.075, 0, 0.022, -0.695, root, 8);
  for (let i = 0; i < 3; i++) b.box(wm.black, 0.042, 0.007, 0.011, 0, 0.022, -0.672 - i * 0.02);
  b.cyl(wm.black, 0.009, 0.002, 0, 0.022, -0.7335);
  // 前准星（折叠）
  b.box(wm.dark, 0.012, 0.018, 0.03, 0, 0.076, -0.43);
  // 握把
  b.profile(wm.poly, [[0.05, -0.044], [0.085, -0.172], [0.136, -0.172], [0.116, -0.044]], 0.04);
  b.box(wm.steel, 0.012, 0.005, 0.085, 0, -0.088, 0.0); // 扳机护圈
  b.box(wm.steel, 0.012, 0.04, 0.005, 0, -0.068, -0.042);
  b.box(wm.brass, 0.006, 0.026, 0.01, 0, -0.064, 0.018).rotation.x = 0.3; // 扳机
  // 枪托
  b.profile(wm.poly, [[0.16, 0.05], [0.16, -0.02], [0.3, -0.02], [0.42, -0.086], [0.47, -0.086], [0.47, 0.05]], 0.044);
  b.box(wm.steel, 0.03, 0.03, 0.14, 0, 0.03, 0.24);
  b.box(wm.black, 0.05, 0.14, 0.02, 0, -0.018, 0.48);
  // 左侧细节：快慢机（发光指示）、空仓挂机、铭牌
  b.cyl(wm.steel, 0.008, 0.006, -0.0265, 0.012, 0.085).rotation.y = Math.PI / 2;
  b.box(glow, 0.002, 0.006, 0.014, -0.0262, 0.026, 0.07);
  b.box(wm.steel, 0.004, 0.022, 0.03, -0.026, 0.02, -0.02);
  b.box(wm.orange, 0.002, 0.018, 0.06, -0.0258, 0.036, -0.08);
  b.box(wm.black, 0.003, 0.02, 0.07, 0.0262, 0.034, 0.05); // 抛壳窗（右侧）
  // 全息瞄具
  holoSight(b, wm, 0.108, 0.03, 0xff3a2a);
  // 弹匣
  const mag = b.group(0, -0.05, -0.045);
  b.profile(wm.dark, [[0.035, 0.03], [0.012, -0.165], [-0.05, -0.15], [-0.035, 0.03]], 0.028, 0, 0, 0, mag);
  b.box(wm.orange, 0.03, 0.05, 0.004, 0, -0.07, -0.046, mag).rotation.x = -0.09;
  b.box(wm.black, 0.032, 0.012, 0.064, 0, -0.158, -0.02, mag).rotation.x = -0.24;
  // 拉机柄
  const bolt = b.group(0.0, 0.05, 0.15);
  b.box(wm.dark, 0.06, 0.012, 0.022, 0, 0, 0, bolt);
  const eject = b.group(0.03, 0.04, 0.05);
  const muzzle = b.group(0, 0.022, -0.74);
  hands(b, wm, new THREE.Vector3(0, -0.105, 0.095), new THREE.Vector3(0, -0.07, -0.3), root, glow);
  return finish({ id: 'ar9', root, muzzle, mag, bolt, eject, heatMat: null, hipPos: new THREE.Vector3(0.165, -0.19, -0.56), adsPos: new THREE.Vector3(0, -0.108, -0.36) }, b);
}

// =====================================================================================
// VIPER 霰弹枪：粗壮的泵动式——散热罩、管式弹仓、橙色识别带、左侧备弹
// =====================================================================================
function buildViper(wm: WeaponMats): WeaponView {
  const root = new THREE.Group();
  const b = new Builder(root);
  const glow = b.own(glowMat(0x4dff9a, 2.4));
  const cuff = b.own(glowMat(0xff8a2a, 1.3));
  // 机匣
  b.profile(wm.dark, [[0.2, 0.0], [0.2, 0.06], [0.16, 0.08], [-0.2, 0.08], [-0.23, 0.064], [-0.23, -0.036], [0.1, -0.046], [0.18, -0.03]], 0.066);
  b.box(wm.orange, 0.068, 0.014, 0.12, 0, 0.046, 0.06); // 识别带
  b.box(wm.steel, 0.07, 0.012, 0.1, 0, -0.02, -0.06);
  // 枪管 + 弹仓管
  b.cyl(wm.steel, 0.02, 0.53, 0, 0.048, -0.48, root, 16);
  b.cyl(wm.dark, 0.019, 0.46, 0, 0.004, -0.44, root, 16);
  b.cyl(wm.black, 0.0165, 0.004, 0, 0.048, -0.746, root, 16);
  b.cyl(wm.steel, 0.021, 0.02, 0, 0.004, -0.675, root, 12);
  b.box(wm.dark, 0.052, 0.088, 0.026, 0, 0.026, -0.65); // 前管箍
  b.box(wm.dark, 0.052, 0.088, 0.026, 0, 0.026, -0.255);
  // 散热罩：顶部一排开孔钢片
  b.box(wm.black, 0.03, 0.004, 0.34, 0, 0.0715, -0.45);
  for (let i = 0; i < 9; i++) b.box(wm.steel, 0.048, 0.006, 0.02, 0, 0.074, -0.29 - i * 0.04);
  b.box(wm.steel, 0.004, 0.03, 0.36, -0.024, 0.056, -0.45);
  b.box(wm.steel, 0.004, 0.03, 0.36, 0.024, 0.056, -0.45);
  // 泵动护木
  const bolt = b.group(0, 0.0, -0.4);
  b.profile(wm.tan, [[0.1, -0.03], [0.1, 0.028], [-0.1, 0.028], [-0.1, -0.03], [-0.08, -0.044], [0.08, -0.044]], 0.072, 0, 0, 0, bolt);
  for (let i = 0; i < 7; i++) b.box(wm.poly, 0.076, 0.046, 0.01, 0, -0.006, 0.078 - i * 0.026, bolt);
  // 握把 + 枪托
  b.profile(wm.poly, [[0.1, -0.04], [0.14, -0.172], [0.19, -0.172], [0.176, -0.03]], 0.044);
  b.profile(wm.tan, [[0.2, 0.06], [0.2, -0.02], [0.3, -0.03], [0.44, -0.1], [0.49, -0.1], [0.49, 0.046], [0.3, 0.06]], 0.05);
  b.box(wm.black, 0.056, 0.15, 0.022, 0, -0.028, 0.5);
  b.box(wm.steel, 0.012, 0.005, 0.1, 0, -0.088, 0.05);
  // 左侧备弹
  b.box(wm.black, 0.006, 0.05, 0.15, -0.035, 0.024, 0.07);
  for (let i = 0; i < 5; i++) {
    const s = b.cyl(wm.red, 0.0105, 0.052, -0.046, 0.022, 0.012 + i * 0.027, root, 10);
    s.rotation.z = Math.PI / 2;
    s.rotation.set(Math.PI / 2, 0, 0);
    const c = b.cyl(wm.brass, 0.011, 0.012, -0.046, 0.054, 0.012 + i * 0.027, root, 10);
    c.rotation.set(Math.PI / 2, 0, 0);
  }
  // 瞄具：后缺口 + 绿色光纤准星
  b.box(wm.black, 0.034, 0.014, 0.02, 0, 0.087, 0.15);
  b.box(wm.black, 0.008, 0.012, 0.02, -0.013, 0.098, 0.15);
  b.box(wm.black, 0.008, 0.012, 0.02, 0.013, 0.098, 0.15);
  b.box(wm.dark, 0.01, 0.016, 0.014, 0, 0.082, -0.72);
  b.box(glow, 0.005, 0.006, 0.012, 0, 0.094, -0.72);
  const eject = b.group(0.036, 0.04, 0.04);
  const muzzle = b.group(0, 0.048, -0.76);
  hands(b, wm, new THREE.Vector3(0, -0.1, 0.145), new THREE.Vector3(0, -0.062, 0.0), bolt, cuff);
  return finish({ id: 'viper', root, muzzle, mag: null, bolt, eject, heatMat: null, hipPos: new THREE.Vector3(0.175, -0.2, -0.54), adsPos: new THREE.Vector3(0, -0.097, -0.38) }, b);
}

// =====================================================================================
// HELIX 能量步枪：白色陶瓷外壳 + 外露的双轨加速器，发光能量通道随热量由青变橙
// =====================================================================================
function buildHelix(wm: WeaponMats): WeaponView {
  const root = new THREE.Group();
  const b = new Builder(root);
  const heat = b.own(glowMat(0x35e0ff, 2.4));
  const cuff = b.own(glowMat(0x35e0ff, 1.3));
  // 机匣：深色骨架 + 两侧白色陶瓷护板
  b.profile(wm.dark, [[0.2, -0.02], [0.2, 0.05], [0.12, 0.08], [-0.2, 0.08], [-0.26, 0.05], [-0.26, -0.02], [-0.16, -0.05], [0.12, -0.05]], 0.052);
  for (const s of [-1, 1]) {
    b.profile(wm.ceramic, [[0.18, -0.012], [0.18, 0.04], [0.11, 0.066], [-0.17, 0.066], [-0.23, 0.04], [-0.23, -0.012], [-0.15, -0.036], [0.1, -0.036]], 0.008, s * 0.03, 0, 0);
    b.box(heat, 0.002, 0.006, 0.2, s * 0.0345, 0.02, -0.03);
  }
  b.box(wm.black, 0.03, 0.006, 0.34, 0, 0.083, -0.03); // 顶部导轨
  for (let i = 0; i < 10; i++) b.box(wm.dark, 0.032, 0.006, 0.012, 0, 0.088, 0.11 - i * 0.03);
  // 双轨加速器：上下各一对细导轨，中间的能量通道从上方可见
  for (const s of [-1, 1]) {
    b.box(wm.steel, 0.01, 0.018, 0.47, s * 0.015, 0.062, -0.485);
    b.box(wm.steel, 0.01, 0.018, 0.47, s * 0.015, -0.012, -0.485);
    b.box(wm.ceramic, 0.006, 0.05, 0.3, s * 0.027, 0.025, -0.42);
  }
  b.box(heat, 0.012, 0.03, 0.45, 0, 0.025, -0.48);
  b.box(heat, 0.014, 0.004, 0.45, 0, 0.066, -0.48);
  for (let i = 0; i < 5; i++) {
    b.box(wm.dark, 0.056, 0.104, 0.014, 0, 0.025, -0.3 - i * 0.085); // 线圈环
    b.box(heat, 0.06, 0.01, 0.005, 0, 0.025, -0.3 - i * 0.085);
    b.box(heat, 0.022, 0.108, 0.005, 0, 0.025, -0.3 - i * 0.085);
  }
  b.box(wm.dark, 0.05, 0.112, 0.03, 0, 0.025, -0.715);
  b.box(heat, 0.014, 0.05, 0.004, 0, 0.025, -0.732);
  // 螺旋能量腔：机匣下方的发光电池
  const mag = b.group(0, -0.035, 0.0);
  b.cyl(wm.dark, 0.031, 0.15, 0, 0, 0, mag, 12);
  b.cyl(heat, 0.033, 0.03, 0, 0, -0.03, mag, 12);
  b.cyl(heat, 0.033, 0.03, 0, 0, 0.03, mag, 12);
  b.cyl(wm.steel, 0.034, 0.014, 0, 0, -0.07, mag, 12);
  b.cyl(wm.steel, 0.034, 0.014, 0, 0, 0.07, mag, 12);
  // 散热片（过热时弹起）
  const bolt = b.group(0, 0.1, 0.08);
  for (let i = 0; i < 3; i++) b.box(wm.dark, 0.046, 0.01, 0.026, 0, 0, 0.04 - i * 0.04, bolt);
  b.box(heat, 0.03, 0.004, 0.12, 0, -0.007, 0, bolt);
  // 握把 + 枪托
  b.profile(wm.poly, [[0.06, -0.045], [0.1, -0.172], [0.15, -0.172], [0.13, -0.045]], 0.042);
  b.profile(wm.poly, [[0.2, 0.05], [0.2, -0.02], [0.36, -0.06], [0.47, -0.06], [0.47, 0.03], [0.4, 0.05]], 0.046);
  b.box(wm.dark, 0.05, 0.02, 0.2, 0, 0.046, 0.33);
  b.box(heat, 0.052, 0.005, 0.12, 0, 0.0, 0.33);
  b.box(wm.steel, 0.012, 0.005, 0.085, 0, -0.088, 0.0);
  holoSight(b, wm, 0.127, -0.06, 0x35e0ff, 0.046, 0.042);
  const eject = b.group(0, 0.11, 0);
  const muzzle = b.group(0, 0.025, -0.75);
  hands(b, wm, new THREE.Vector3(0, -0.105, 0.105), new THREE.Vector3(0, -0.045, -0.36), root, cuff);
  return finish({ id: 'helix', root, muzzle, mag, bolt, eject, heatMat: heat, hipPos: new THREE.Vector3(0.17, -0.2, -0.56), adsPos: new THREE.Vector3(0, -0.127, -0.3) }, b);
}

export function buildWeaponView(id: WeaponId, wm: WeaponMats): WeaponView {
  return id === 'ar9' ? buildAR9(wm) : id === 'viper' ? buildViper(wm) : buildHelix(wm);
}
