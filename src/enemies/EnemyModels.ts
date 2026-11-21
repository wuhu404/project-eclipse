import * as THREE from 'three';
import { glowMat, MaterialLibrary } from '../render/Materials';

export type EnemyType = 'sentry' | 'stalker' | 'juggernaut' | 'wasp' | 'boss';

/** 敌人骨架：root 位于脚底，朝向 +Z（root.rotation.y = yaw，前方 = (sin yaw, 0, cos yaw)）。 */
export interface EnemyRig {
  root: THREE.Group;
  body: THREE.Object3D;
  head: THREE.Object3D;
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  muzzle: THREE.Object3D;
  /** 额外可动部件（Boss 的肩炮、装甲板等） */
  extra: THREE.Object3D[];
  eyeMat: THREE.MeshBasicMaterial;
  glowMat: THREE.MeshBasicMaterial;
  height: number;
  radius: number;
  headY: number;
  dispose(): void;
}

// 几何体按参数缓存，所有同类敌人共享（整个游戏生命周期内只创建一次）
const geoCache = new Map<string, THREE.BufferGeometry>();
function boxGeo(w: number, h: number, d: number): THREE.BufferGeometry {
  const k = `b${w}|${h}|${d}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.BoxGeometry(w, h, d)));
  return g;
}
function cylGeo(r1: number, r2: number, h: number, segs: number, axis: 'y' | 'z' | 'x'): THREE.BufferGeometry {
  const k = `c${r1}|${r2}|${h}|${segs}|${axis}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.CylinderGeometry(r1, r2, h, segs);
    if (axis === 'z') g.rotateX(Math.PI / 2);
    if (axis === 'x') g.rotateZ(Math.PI / 2);
    geoCache.set(k, g);
  }
  return g;
}
function sphGeo(r: number, ws = 14, hs = 10): THREE.BufferGeometry {
  const k = `s${r}|${ws}|${hs}`;
  let g = geoCache.get(k);
  if (!g) geoCache.set(k, (g = new THREE.SphereGeometry(r, ws, hs)));
  return g;
}
/** 棱台（上窄下宽的装甲块） */
function wedgeGeo(w: number, h: number, d: number, topScale: number): THREE.BufferGeometry {
  const k = `w${w}|${h}|${d}|${topScale}`;
  let g = geoCache.get(k);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    const p = g.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      if (p.getY(i) > 0) p.setXYZ(i, p.getX(i) * topScale, p.getY(i), p.getZ(i) * topScale);
    }
    g.computeVertexNormals();
    geoCache.set(k, g);
  }
  return g;
}
export function disposeEnemyGeometry(): void {
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}

class B {
  constructor(private cast = true) {}
  m(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.castShadow = this.cast && !(mat instanceof THREE.MeshBasicMaterial);
    parent.add(mesh);
    return mesh;
  }
  g(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }
}

function rig(root: THREE.Group, o: Omit<EnemyRig, 'root' | 'dispose'>): EnemyRig {
  return {
    root,
    ...o,
    dispose() {
      o.eyeMat.dispose();
      o.glowMat.dispose();
    },
  };
}

/** 哨兵：反关节双足步行机，单眼传感器头，右臂等离子炮，左臂电击爪 */
function buildSentry(mats: MaterialLibrary): EnemyRig {
  const b = new B();
  const root = new THREE.Group();
  const eyeMat = glowMat(0xff2d2d, 3);
  const glow = glowMat(0xff6a2a, 2);
  const body = b.g(root, 0, 1.02, 0);
  b.m(body, wedgeGeo(0.62, 0.5, 0.5, 0.72), mats.metalMid, 0, 0.12, 0);
  b.m(body, boxGeo(0.5, 0.2, 0.42), mats.metalDark, 0, -0.2, 0);
  b.m(body, boxGeo(0.3, 0.34, 0.2), mats.metalDark, 0, 0.16, -0.3); // 背包
  b.m(body, boxGeo(0.08, 0.24, 0.02), glow, 0, 0.16, -0.405);
  b.m(body, boxGeo(0.34, 0.1, 0.02), mats.metalRed, 0, 0.2, 0.255);
  const head = b.g(body, 0, 0.5, 0.04);
  b.m(head, boxGeo(0.34, 0.24, 0.38), mats.metalLight, 0, 0.06, 0);
  b.m(head, wedgeGeo(0.36, 0.1, 0.4, 0.7), mats.metalDark, 0, 0.22, 0);
  b.m(head, cylGeo(0.075, 0.075, 0.06, 14, 'z'), mats.black, 0, 0.07, 0.19);
  b.m(head, cylGeo(0.05, 0.05, 0.03, 14, 'z'), eyeMat, 0, 0.07, 0.215);
  b.m(head, cylGeo(0.01, 0.01, 0.3, 6, 'y'), mats.metalDark, -0.13, 0.36, -0.1); // 天线
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hip = b.g(root, s * 0.26, 0.92, 0);
    b.m(hip, cylGeo(0.09, 0.09, 0.14, 12, 'x'), mats.metalDark);
    b.m(hip, boxGeo(0.13, 0.5, 0.17), mats.metalMid, 0, -0.2, 0.1, -0.5);
    const knee = b.g(hip, 0, -0.4, 0.22);
    b.m(knee, cylGeo(0.07, 0.07, 0.15, 10, 'x'), mats.metalDark);
    b.m(knee, boxGeo(0.1, 0.52, 0.12), mats.metalLight, 0, -0.24, -0.11, 0.45);
    b.m(knee, boxGeo(0.2, 0.07, 0.36), mats.metalDark, 0, -0.485, -0.16);
    legs.push(hip);
  }
  const arms: THREE.Object3D[] = [];
  const ra = b.g(body, -0.42, 0.18, 0);
  b.m(ra, cylGeo(0.08, 0.08, 0.12, 10, 'x'), mats.metalDark);
  b.m(ra, boxGeo(0.13, 0.15, 0.5), mats.metalMid, 0, -0.08, 0.2);
  b.m(ra, cylGeo(0.04, 0.04, 0.3, 10, 'z'), mats.metalDark, 0, -0.08, 0.55);
  b.m(ra, cylGeo(0.055, 0.055, 0.05, 10, 'z'), glow, 0, -0.08, 0.44);
  const muzzle = b.g(ra, 0, -0.08, 0.72);
  const la = b.g(body, 0.42, 0.18, 0);
  b.m(la, cylGeo(0.08, 0.08, 0.12, 10, 'x'), mats.metalDark);
  b.m(la, boxGeo(0.11, 0.13, 0.42), mats.metalMid, 0, -0.08, 0.16);
  for (const s of [-1, 1]) b.m(la, boxGeo(0.025, 0.05, 0.24), mats.chrome, s * 0.04, -0.08, 0.46, 0, s * 0.2);
  arms.push(ra, la);
  return rig(root, { body, head, legs, arms, muzzle, extra: [], eyeMat, glowMat: glow, height: 1.9, radius: 0.5, headY: 1.6 });
}

/** 猎手：修长的类人战术机体，长管磁轨步枪，肩部偏转板 */
function buildStalker(mats: MaterialLibrary): EnemyRig {
  const b = new B();
  const root = new THREE.Group();
  const eyeMat = glowMat(0xff2d2d, 3);
  const glow = glowMat(0xff2d2d, 2.4);
  const body = b.g(root, 0, 1.18, 0);
  b.m(body, wedgeGeo(0.36, 0.5, 0.26, 1.25), mats.metalDark, 0, 0.12, 0);
  b.m(body, boxGeo(0.24, 0.3, 0.2), mats.gunmetal, 0, -0.24, 0);
  b.m(body, boxGeo(0.05, 0.3, 0.02), glow, 0, 0.14, 0.14);
  for (const s of [-1, 1]) b.m(body, wedgeGeo(0.2, 0.3, 0.34, 0.6), mats.metalBlue, s * 0.34, 0.3, 0, 0, 0, s * -0.35); // 肩甲
  const head = b.g(body, 0, 0.5, 0.02);
  b.m(head, wedgeGeo(0.2, 0.24, 0.26, 0.75), mats.metalLight, 0, 0.06, 0);
  b.m(head, boxGeo(0.21, 0.035, 0.1), eyeMat, 0, 0.08, 0.1); // 横向视窗
  b.m(head, boxGeo(0.03, 0.2, 0.2), mats.metalDark, 0, 0.2, -0.04);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hip = b.g(root, s * 0.14, 0.92, 0);
    b.m(hip, boxGeo(0.12, 0.48, 0.14), mats.metalDark, 0, -0.22, 0.02);
    const knee = b.g(hip, 0, -0.46, 0.03);
    b.m(knee, boxGeo(0.09, 0.46, 0.1), mats.metalMid, 0, -0.22, -0.02);
    b.m(knee, boxGeo(0.11, 0.06, 0.26), mats.metalDark, 0, -0.44, 0.05);
    b.m(knee, boxGeo(0.13, 0.14, 0.05), mats.metalBlue, 0, -0.02, 0.07);
    legs.push(hip);
  }
  const arms: THREE.Object3D[] = [];
  const ra = b.g(body, -0.3, 0.24, 0);
  b.m(ra, boxGeo(0.09, 0.34, 0.1), mats.metalDark, 0, -0.14, 0);
  b.m(ra, boxGeo(0.08, 0.09, 0.34), mats.metalMid, 0.06, -0.3, 0.16);
  // 步枪（双手持于身前）
  const gun = b.g(ra, 0.26, -0.26, 0.3);
  b.m(gun, boxGeo(0.07, 0.11, 0.6), mats.gunmetal, 0, 0, 0.05);
  b.m(gun, cylGeo(0.022, 0.022, 0.7, 8, 'z'), mats.metalDark, 0, 0.02, 0.66);
  b.m(gun, boxGeo(0.03, 0.05, 0.5), mats.metalDark, 0, -0.04, 0.6);
  b.m(gun, boxGeo(0.075, 0.02, 0.26), glow, 0, 0.066, 0.02);
  b.m(gun, boxGeo(0.06, 0.07, 0.14), mats.metalDark, 0, 0.1, 0.0);
  const muzzle = b.g(gun, 0, 0.02, 1.03);
  const la = b.g(body, 0.3, 0.24, 0);
  b.m(la, boxGeo(0.09, 0.34, 0.1), mats.metalDark, 0, -0.14, 0);
  b.m(la, boxGeo(0.08, 0.09, 0.44), mats.metalMid, -0.12, -0.3, 0.2, 0, -0.5);
  arms.push(ra, la);
  return rig(root, { body, head, legs, arms, muzzle, extra: [], eyeMat, glowMat: glow, height: 2.0, radius: 0.42, headY: 1.75 });
}

/** 重装：宽厚的装甲躯干、巨型液压拳、背负迫击炮，背部外露反应堆（弱点） */
function buildJuggernaut(mats: MaterialLibrary): EnemyRig {
  const b = new B();
  const root = new THREE.Group();
  const eyeMat = glowMat(0xff2d2d, 3);
  const glow = glowMat(0xff8a2a, 2.6);
  const body = b.g(root, 0, 1.65, 0);
  b.m(body, wedgeGeo(1.5, 1.0, 1.05, 0.8), mats.metalRed, 0, 0.2, 0);
  b.m(body, boxGeo(1.0, 0.5, 0.8), mats.metalDark, 0, -0.5, 0);
  b.m(body, wedgeGeo(1.1, 0.62, 0.2, 0.85), mats.metalDark, 0, 0.16, 0.56); // 胸甲
  b.m(body, boxGeo(0.7, 0.08, 0.04), mats.hazard, 0, -0.1, 0.67);
  // 背部反应堆
  b.m(body, cylGeo(0.3, 0.3, 0.26, 16, 'z'), mats.metalDark, 0, 0.2, -0.6);
  b.m(body, cylGeo(0.22, 0.22, 0.1, 16, 'z'), glow, 0, 0.2, -0.72);
  for (const s of [-1, 1]) b.m(body, cylGeo(0.08, 0.08, 0.6, 10, 'y'), mats.pipeCopper, s * 0.45, 0.3, -0.52);
  const head = b.g(body, 0, 0.78, 0.2);
  b.m(head, wedgeGeo(0.5, 0.3, 0.5, 0.7), mats.metalDark, 0, 0.05, 0);
  b.m(head, boxGeo(0.34, 0.07, 0.04), eyeMat, 0, 0.06, 0.24);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const hip = b.g(root, s * 0.48, 1.05, 0);
    b.m(hip, boxGeo(0.4, 0.6, 0.46), mats.metalMid, 0, -0.25, 0);
    const knee = b.g(hip, 0, -0.52, 0);
    b.m(knee, wedgeGeo(0.5, 0.5, 0.6, 0.7), mats.metalRed, 0, -0.24, 0.02);
    b.m(knee, boxGeo(0.54, 0.12, 0.74), mats.metalDark, 0, -0.47, 0.06);
    legs.push(hip);
  }
  const arms: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const arm = b.g(body, s * 0.98, 0.42, 0);
    b.m(arm, sphGeo(0.3), mats.metalDark);
    b.m(arm, wedgeGeo(0.6, 0.34, 0.66, 0.75), mats.metalRed, s * 0.06, 0.26, 0); // 肩甲
    b.m(arm, boxGeo(0.34, 0.7, 0.36), mats.metalMid, 0, -0.45, 0);
    b.m(arm, boxGeo(0.46, 0.5, 0.5), mats.metalDark, 0, -1.0, 0.04); // 液压拳
    b.m(arm, boxGeo(0.48, 0.07, 0.52), mats.hazard, 0, -0.78, 0.04);
    b.m(arm, boxGeo(0.3, 0.05, 0.02), glow, 0, -1.0, 0.3);
    arms.push(arm);
  }
  // 背负迫击炮
  const mortar = b.g(body, 0.42, 0.85, -0.3);
  b.m(mortar, cylGeo(0.16, 0.2, 0.75, 12, 'y'), mats.metalDark, 0, 0.2, 0, -0.35);
  const muzzle = b.g(mortar, 0, 0.6, -0.2);
  return rig(root, { body, head, legs, arms, muzzle, extra: [mortar], eyeMat, glowMat: glow, height: 2.9, radius: 0.95, headY: 2.45 });
}

/** 黄蜂：小型悬浮无人机，双涵道 + 下挂炮 */
function buildWasp(mats: MaterialLibrary): EnemyRig {
  const b = new B(false);
  const root = new THREE.Group();
  const eyeMat = glowMat(0xff2d2d, 3);
  const glow = glowMat(0xff8a2a, 2.2);
  const body = b.g(root, 0, 0, 0);
  b.m(body, sphGeo(0.22, 12, 8), mats.metalMid, 0, 0, 0).scale.set(1, 0.7, 1.3);
  b.m(body, cylGeo(0.07, 0.07, 0.04, 12, 'z'), eyeMat, 0, 0, 0.28);
  b.m(body, boxGeo(0.9, 0.03, 0.1), mats.metalDark, 0, 0.04, 0);
  const legs: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const pod = b.g(body, s * 0.45, 0.04, 0);
    b.m(pod, cylGeo(0.16, 0.16, 0.07, 14, 'y'), mats.metalDark);
    b.m(pod, cylGeo(0.13, 0.13, 0.02, 14, 'y'), glow, 0, -0.04, 0);
    legs.push(pod);
  }
  const head = b.g(body, 0, -0.14, 0.05);
  b.m(head, cylGeo(0.03, 0.03, 0.3, 8, 'z'), mats.metalDark, 0, 0, 0.12);
  const muzzle = b.g(head, 0, 0, 0.3);
  return rig(root, { body, head, legs, arms: [], muzzle, extra: [], eyeMat, glowMat: glow, height: 0.5, radius: 0.45, headY: 0 });
}

/**
 * OMEGA-01：四足重型机械守卫。中央装甲核心（红色独眼 = 弱点）、两门肩部能量炮、
 * 腹部无人机舱。extra = [左肩炮, 右肩炮, 核心装甲上盖, 核心装甲下盖]。
 */
function buildBoss(mats: MaterialLibrary): EnemyRig {
  const b = new B();
  const root = new THREE.Group();
  const eyeMat = glowMat(0xff2d2d, 3.2);
  const glow = glowMat(0xff5a1a, 2.6);
  const body = b.g(root, 0, 3.4, 0);
  b.m(body, wedgeGeo(4.2, 1.8, 4.0, 0.72), mats.metalDark, 0, 0.3, 0);
  b.m(body, cylGeo(2.3, 2.6, 0.7, 8, 'y'), mats.metalMid, 0, -0.8, 0);
  b.m(body, cylGeo(1.2, 1.5, 0.5, 8, 'y'), mats.metalDark, 0, -1.35, 0);
  b.m(body, cylGeo(1.0, 1.0, 0.08, 8, 'y'), glow, 0, -1.62, 0); // 腹部无人机舱
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    b.m(body, boxGeo(0.5, 0.12, 0.05), glow, Math.sin(a) * 2.42, -0.8, Math.cos(a) * 2.42, 0, a);
  }
  b.m(body, boxGeo(2.6, 0.16, 0.06), mats.hazard, 0, -0.35, 2.0);
  // 核心（头部）
  const head = b.g(body, 0, 0.5, 1.5);
  b.m(head, cylGeo(0.95, 0.95, 0.9, 16, 'z'), mats.gunmetal, 0, 0, 0);
  b.m(head, cylGeo(0.62, 0.62, 0.2, 20, 'z'), mats.black, 0, 0, 0.42);
  b.m(head, sphGeo(0.5, 18, 12), eyeMat, 0, 0, 0.36).scale.set(1, 1, 0.5);
  const lidTop = b.g(head, 0, 0.62, 0.3);
  b.m(lidTop, wedgeGeo(1.9, 0.5, 1.0, 0.8), mats.metalRed, 0, 0.1, 0);
  const lidBot = b.g(head, 0, -0.62, 0.3);
  b.m(lidBot, wedgeGeo(1.9, 0.4, 1.0, 1.2), mats.metalRed, 0, -0.1, 0);
  // 肩炮
  const cannons: THREE.Object3D[] = [];
  for (const s of [-1, 1]) {
    const c = b.g(body, s * 2.3, 1.3, 0.2);
    b.m(c, boxGeo(1.0, 0.9, 1.6), mats.metalMid, 0, 0, 0);
    b.m(c, cylGeo(0.3, 0.3, 1.5, 12, 'z'), mats.metalDark, 0, 0, 1.2);
    b.m(c, cylGeo(0.36, 0.36, 0.2, 12, 'z'), mats.metalRed, 0, 0, 1.9);
    b.m(c, cylGeo(0.22, 0.22, 0.06, 12, 'z'), glow, 0, 0, 1.98);
    b.m(c, boxGeo(1.04, 0.1, 0.9), mats.hazard, 0, 0.42, -0.1);
    cannons.push(c);
  }
  const muzzle = b.g(head, 0, 0, 0.7);
  // 四足
  const legs: THREE.Object3D[] = [];
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    const hip = b.g(root, Math.sin(a) * 2.2, 2.9, Math.cos(a) * 2.2);
    hip.rotation.y = a;
    b.m(hip, sphGeo(0.6, 12, 8), mats.metalDark);
    b.m(hip, boxGeo(0.7, 0.7, 2.4), mats.metalMid, 0, 0.5, 1.0, -0.5);
    const knee = b.g(hip, 0, 1.1, 2.0);
    b.m(knee, sphGeo(0.5, 12, 8), mats.metalDark);
    b.m(knee, wedgeGeo(0.8, 3.9, 0.9, 0.7), mats.metalRed, 0, -1.95, 0.4, 0.2, 0, Math.PI);
    b.m(knee, cylGeo(0.75, 0.9, 0.3, 10, 'y'), mats.metalDark, 0, -3.85, 0.8);
    b.m(knee, boxGeo(0.84, 0.14, 0.08), glow, 0, -1.2, 0.72);
    legs.push(hip);
  }
  return rig(root, { body, head, legs, arms: [], muzzle, extra: [cannons[0], cannons[1], lidTop, lidBot], eyeMat, glowMat: glow, height: 5.6, radius: 3.0, headY: 3.9 });
}

export function buildEnemyRig(type: EnemyType, mats: MaterialLibrary): EnemyRig {
  switch (type) {
    case 'sentry':
      return buildSentry(mats);
    case 'stalker':
      return buildStalker(mats);
    case 'juggernaut':
      return buildJuggernaut(mats);
    case 'wasp':
      return buildWasp(mats);
    case 'boss':
      return buildBoss(mats);
  }
}
