import * as THREE from 'three';
import {
  TexSet,
  texBrushed,
  texConcrete,
  texCrate,
  texFloor,
  texGrate,
  texHazard,
  texPipe,
  texRock,
  texWallPanel,
  texGlow,
  texSmoke,
  texMuzzle,
  texRing,
  texBulletHole,
  texScorch,
} from './Textures';

/**
 * 统一的材质库。美术语言：
 *  - 冷调钢蓝为基底；青色 = 基地系统/友方；橙色 = 工业/警示；红色只留给失控 AI 与敌人。
 *  - 所有发光材质使用 HDR 颜色（>1），配合 Bloom 阈值 1.0，保证只有"真正发光"的表面溢光。
 */
export const PALETTE = {
  cyan: 0x35e0ff,
  cyanDeep: 0x0a8fb5,
  orange: 0xff8a2a,
  amber: 0xffb347,
  red: 0xff2d2d,
  redDeep: 0xb00c0c,
  white: 0xdcecff,
  green: 0x4dff9a,
  violet: 0x9a6bff,
  steel: 0x8a94a0,
};

function std(set: TexSet, color: number, opts: THREE.MeshStandardMaterialParameters = {}, tile = 4): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({
    map: set.map,
    normalMap: set.normalMap,
    roughnessMap: set.ormMap,
    metalnessMap: set.ormMap,
    color,
    roughness: 1,
    metalness: 1,
    ...opts,
  });
  m.userData.tile = tile;
  return m;
}

export function glowMat(color: number, intensity = 2.2): THREE.MeshBasicMaterial {
  const c = new THREE.Color(color).multiplyScalar(intensity);
  const m = new THREE.MeshBasicMaterial({ color: c, toneMapped: false, fog: false });
  m.userData.tile = 1;
  m.userData.baseColor = new THREE.Color(color);
  m.userData.intensity = intensity;
  return m;
}

export class MaterialLibrary {
  readonly tex: {
    panel: TexSet;
    floor: TexSet;
    brushed: TexSet;
    concrete: TexSet;
    rock: TexSet;
    hazard: TexSet;
    crate: TexSet;
    grate: TexSet;
    pipe: TexSet;
    glow: THREE.Texture;
    smoke: THREE.Texture;
    muzzle: THREE.Texture;
    ring: THREE.Texture;
    bulletHole: THREE.Texture;
    scorch: THREE.Texture;
  };

  // 结构
  wall: THREE.MeshStandardMaterial;
  wallDark: THREE.MeshStandardMaterial;
  wallLab: THREE.MeshStandardMaterial;
  wallRust: THREE.MeshStandardMaterial;
  floor: THREE.MeshStandardMaterial;
  floorDark: THREE.MeshStandardMaterial;
  floorLab: THREE.MeshStandardMaterial;
  ceiling: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  ground: THREE.MeshStandardMaterial;
  hazard: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  // 道具
  metalDark: THREE.MeshStandardMaterial;
  metalMid: THREE.MeshStandardMaterial;
  metalLight: THREE.MeshStandardMaterial;
  metalRed: THREE.MeshStandardMaterial;
  metalOrange: THREE.MeshStandardMaterial;
  metalBlue: THREE.MeshStandardMaterial;
  gunmetal: THREE.MeshStandardMaterial;
  polymer: THREE.MeshStandardMaterial;
  rubber: THREE.MeshStandardMaterial;
  crateOlive: THREE.MeshStandardMaterial;
  crateOrange: THREE.MeshStandardMaterial;
  crateBlue: THREE.MeshStandardMaterial;
  pipe: THREE.MeshStandardMaterial;
  pipeCopper: THREE.MeshStandardMaterial;
  grate: THREE.MeshStandardMaterial;
  glass: THREE.MeshStandardMaterial;
  glassTank: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  // 发光
  glowCyan: THREE.MeshBasicMaterial;
  glowCyanSoft: THREE.MeshBasicMaterial;
  glowOrange: THREE.MeshBasicMaterial;
  glowRed: THREE.MeshBasicMaterial;
  glowWhite: THREE.MeshBasicMaterial;
  glowWarm: THREE.MeshBasicMaterial;
  glowGreen: THREE.MeshBasicMaterial;
  glowViolet: THREE.MeshBasicMaterial;
  /** 警报灯：强度随时间脉动 */
  glowAlarm: THREE.MeshBasicMaterial;
  black: THREE.MeshBasicMaterial;

  constructor() {
    this.tex = {
      panel: texWallPanel(),
      floor: texFloor(),
      brushed: texBrushed(),
      concrete: texConcrete(),
      rock: texRock(),
      hazard: texHazard(),
      crate: texCrate(),
      grate: texGrate(),
      pipe: texPipe(),
      glow: texGlow(),
      smoke: texSmoke(),
      muzzle: texMuzzle(),
      ring: texRing(),
      bulletHole: texBulletHole(),
      scorch: texScorch(),
    };
    const t = this.tex;
    const ns = (v: number) => new THREE.Vector2(v, v);

    this.wall = std(t.panel, 0x8d98a6, { normalScale: ns(1.1), envMapIntensity: 0.8 }, 4);
    this.wallDark = std(t.panel, 0x4b535e, { normalScale: ns(1.2), envMapIntensity: 0.7 }, 4);
    this.wallLab = std(t.panel, 0xc9d3dc, { normalScale: ns(0.8), envMapIntensity: 0.9 }, 4);
    this.wallRust = std(t.panel, 0x7a5c4a, { normalScale: ns(1.3), envMapIntensity: 0.6 }, 4);
    this.floor = std(t.floor, 0x77808a, { normalScale: ns(1.0), envMapIntensity: 0.9 }, 4);
    this.floorDark = std(t.floor, 0x474d55, { normalScale: ns(1.2), envMapIntensity: 0.9 }, 4);
    this.floorLab = std(t.floor, 0xaab4bd, { normalScale: ns(0.7), envMapIntensity: 1.0 }, 4);
    this.ceiling = std(t.panel, 0x39404a, { normalScale: ns(1.0), envMapIntensity: 0.5 }, 6);
    this.concrete = std(t.concrete, 0x8a8f96, { metalness: 0.0, normalScale: ns(1.2), envMapIntensity: 0.3 }, 6);
    this.rock = std(t.rock, 0xa58b7c, { metalness: 0.0, normalScale: ns(1.6), envMapIntensity: 0.25 }, 7);
    this.ground = std(t.rock, 0x8d7466, { metalness: 0.0, normalScale: ns(1.2), envMapIntensity: 0.2 }, 9);
    this.hazard = std(t.hazard, 0xffffff, { envMapIntensity: 0.6 }, 2);
    this.trim = std(t.brushed, 0x2c3138, { envMapIntensity: 0.9 }, 2);

    this.metalDark = std(t.brushed, 0x2a2e35, { envMapIntensity: 1.0 }, 2);
    this.metalMid = std(t.brushed, 0x5c636d, { envMapIntensity: 1.0 }, 2);
    this.metalLight = std(t.brushed, 0xa9b2bd, { envMapIntensity: 1.0 }, 2);
    this.metalRed = std(t.brushed, 0x8f1f1c, { envMapIntensity: 0.9 }, 2);
    this.metalOrange = std(t.brushed, 0xc8651b, { envMapIntensity: 0.9 }, 2);
    this.metalBlue = std(t.brushed, 0x2c5578, { envMapIntensity: 0.9 }, 2);
    this.gunmetal = std(t.brushed, 0x30343b, { envMapIntensity: 1.3, normalScale: ns(0.5) }, 0.35);
    this.polymer = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.72, metalness: 0.1, envMapIntensity: 0.6 });
    this.polymer.userData.tile = 1;
    this.rubber = new THREE.MeshStandardMaterial({ color: 0x0c0d0f, roughness: 0.95, metalness: 0.0, envMapIntensity: 0.2 });
    this.rubber.userData.tile = 1;
    this.crateOlive = std(t.crate, 0x6f7a5c, { envMapIntensity: 0.7 }, 0);
    this.crateOrange = std(t.crate, 0xc46a22, { envMapIntensity: 0.7 }, 0);
    this.crateBlue = std(t.crate, 0x3d6a8e, { envMapIntensity: 0.7 }, 0);
    this.pipe = std(t.pipe, 0x7b838c, { envMapIntensity: 1.0 }, 2);
    this.pipeCopper = std(t.pipe, 0xb06a3c, { envMapIntensity: 1.1 }, 2);
    this.grate = std(t.grate, 0x8a929b, { alphaTest: 0.5, side: THREE.DoubleSide, envMapIntensity: 0.8 }, 2);
    this.grate.alphaMap = null;
    this.glass = new THREE.MeshStandardMaterial({
      color: 0x9fd8e8,
      roughness: 0.06,
      metalness: 0.2,
      transparent: true,
      opacity: 0.22,
      envMapIntensity: 1.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.glass.userData.tile = 1;
    this.glassTank = new THREE.MeshStandardMaterial({
      color: 0x58ffd0,
      emissive: 0x0b5a48,
      emissiveIntensity: 0.9,
      roughness: 0.08,
      metalness: 0.1,
      transparent: true,
      opacity: 0.3,
      envMapIntensity: 1.4,
      depthWrite: false,
    });
    this.glassTank.userData.tile = 1;
    this.chrome = new THREE.MeshStandardMaterial({ color: 0xd8dde4, roughness: 0.12, metalness: 1.0, envMapIntensity: 1.5 });
    this.chrome.userData.tile = 1;

    this.glowCyan = glowMat(PALETTE.cyan, 2.6);
    this.glowCyanSoft = glowMat(PALETTE.cyan, 1.15);
    this.glowOrange = glowMat(PALETTE.orange, 2.4);
    this.glowRed = glowMat(PALETTE.red, 2.8);
    this.glowWhite = glowMat(PALETTE.white, 2.4);
    this.glowWarm = glowMat(0xffd9a8, 2.2);
    this.glowGreen = glowMat(PALETTE.green, 2.0);
    this.glowViolet = glowMat(PALETTE.violet, 2.4);
    this.glowAlarm = glowMat(PALETTE.red, 3.0);
    this.black = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.black.userData.tile = 1;
  }

  /** 每帧更新带动画的共享材质 */
  update(time: number, alarm: number): void {
    const pulse = 0.25 + 0.75 * Math.pow(0.5 + 0.5 * Math.sin(time * 5.2), 2.0);
    const base = this.glowAlarm.userData.baseColor as THREE.Color;
    this.glowAlarm.color.copy(base).multiplyScalar(0.15 + alarm * pulse * 3.2);
  }

  dispose(): void {
    for (const v of Object.values(this as unknown as Record<string, unknown>)) {
      if (v instanceof THREE.Material) v.dispose();
    }
    for (const t of Object.values(this.tex)) {
      if (t instanceof THREE.Texture) t.dispose();
      else {
        t.map.dispose();
        t.normalMap.dispose();
        t.ormMap.dispose();
        t.alphaMap?.dispose();
      }
    }
  }
}
