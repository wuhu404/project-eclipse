import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { G, groups, RAPIER } from '../physics/Physics';
import type { LightSocket } from '../render/LightPool';
import { glowMat } from '../render/Materials';
import { texScreen, texSign } from '../render/Textures';
import type { LevelBuilder, Opening } from './LevelBuilder';

export interface GeometryRefs {
  /** 需要每帧旋转的全息体 */
  spinners: THREE.Object3D[];
  /** 能源恢复后才点亮的灯位 / 恢复前的应急灯位 */
  powerSockets: LightSocket[];
  emergencySockets: LightSocket[];
  /** 能源恢复后变亮的发光材质（控制室与核心通道的导能管） */
  powerMat: THREE.MeshBasicMaterial;
  /** 工业区蒸汽喷口 */
  vents: THREE.Vector3[];
}

export const ARENA = { x: 0, z: -210, r: 26, h: 24 };
const PI = Math.PI;

/** 按 DESIGN.md 的分区布局搭建第一关全部静态几何、碰撞与导航地面。 */
export function buildGeometry(ctx: Ctx, b: LevelBuilder): GeometryRefs {
  const m = ctx.mats;
  const nav = ctx.nav;
  const refs: GeometryRefs = { spinners: [], powerSockets: [], emergencySockets: [], powerMat: b.own(glowMat(0x35e0ff, 0.12)), vents: [] };
  const T = 1; // 墙厚

  // ---------- 通用小工具 ----------
  const scr = (kind: Parameters<typeof texScreen>[0], seed: number, x: number, y: number, z: number, w: number, h: number, rotY: number, accent = '#35e0ff', intensity = 1.5, tilt = 0): THREE.Mesh =>
    b.screen(texScreen(kind, seed, accent), x, y, z, w, h, rotY, intensity, tilt);
  const sign = (text: string, sub: string, x: number, y: number, z: number, w: number, h: number, rotY: number, color?: string): void => b.sign(texSign(text, sub, color), x, y, z, w, h, rotY);

  /** 标准房间：地板 + 天花板 + 四面墙（墙体位于内部空间之外）。z0 为北（更小的 z）。 */
  const room = (o: {
    x0: number; x1: number; z0: number; z1: number; h: number;
    floor: THREE.Material; wall: THREE.Material; ceil?: THREE.Material;
    n?: Opening[] | null; s?: Opening[] | null; e?: Opening[] | null; w?: Opening[] | null;
  }): void => {
    b.floor(o.floor, o.x0, o.z0, o.x1, o.z1);
    b.ceiling(o.ceil ?? m.ceiling, o.x0 - T, o.z0 - T, o.x1 + T, o.z1 + T, o.h);
    if (o.n !== null) b.wallX(o.wall, o.z0 - T / 2, o.x0 - T, o.x1 + T, 0, o.h, T, o.n ?? []);
    if (o.s !== null) b.wallX(o.wall, o.z1 + T / 2, o.x0 - T, o.x1 + T, 0, o.h, T, o.s ?? []);
    if (o.w !== null) b.wallZ(o.wall, o.x0 - T / 2, o.z0, o.z1, 0, o.h, T, o.w ?? []);
    if (o.e !== null) b.wallZ(o.wall, o.x1 + T / 2, o.z0, o.z1, 0, o.h, T, o.e ?? []);
  };

  /** 墙面立柱（带灯带），打破大面积墙体的单调 */
  const pilaster = (x: number, z: number, h: number, axis: 'x' | 'z', glow: THREE.Material = m.glowCyanSoft, inward = 1): void => {
    const sx = axis === 'x' ? 0.9 : 0.5;
    const sz = axis === 'x' ? 0.5 : 0.9;
    b.solid(m.trim, x, h / 2, z, sx, h, sz);
    // 灯带贴在朝向房间内侧的一面：axis='z' 时按 x 的符号判断，axis='x' 时由 inward 指定（+1 = 朝 +z）
    if (axis === 'z') b.deco(glow, x - Math.sign(x) * 0.26, Math.min(h * 0.5, 2.4), z, 0.03, Math.min(h * 0.6, 2.6), 0.1);
    else b.deco(glow, x, Math.min(h * 0.5, 2.4), z + inward * 0.26, 0.1, Math.min(h * 0.6, 2.6), 0.03);
  };

  /** 操作台：底座 + 斜面屏幕 */
  const desk = (x: number, z: number, w: number, faceZ: 1 | -1, seed: number, accent = '#35e0ff', y = 0): void => {
    b.solid(m.metalDark, x, y + 0.45, z, w, 0.9, 0.8, { castShadow: true });
    b.deco(m.trim, x, y + 0.93, z, w + 0.1, 0.06, 0.9);
    scr(seed % 2 ? 'data' : 'graph', seed, x, y + 1.25, z - faceZ * 0.15, w * 0.85, 0.55, faceZ > 0 ? 0 : PI, accent, 1.4, -0.35);
    b.deco(m.metalDark, x, y + 1.25, z - faceZ * 0.22, w * 0.9, 0.62, 0.06);
  };

  /** 服务器机柜 */
  const rack = (x: number, z: number, faceX: 1 | -1 | 0, faceZ: 1 | -1 | 0, glow: THREE.Material = m.glowCyan): void => {
    b.solid(m.metalDark, x, 1.15, z, 1, 2.3, 1, { castShadow: true });
    for (let i = 0; i < 5; i++) b.deco(i % 2 ? glow : m.glowGreen, x + faceX * 0.51, 0.5 + i * 0.36, z + faceZ * 0.51, faceX ? 0.02 : 0.7, 0.05, faceZ ? 0.02 : 0.7);
  };

  // =================================================================================
  // 分区 0：外围着陆区（露天）
  // =================================================================================
  b.beginZone(0);
  b.floor(m.ground, -46, 10, 46, 86, 0, false);
  nav.markFloorRect(-26, 12, 26, 70);
  nav.markFloorRect(-4, 10, 4, 12);
  // 不可见边界
  b.collider(-27, 4, 41, 1, 8, 62, 0, true);
  b.collider(27, 4, 41, 1, 8, 62, 0, true);
  b.collider(0, 4, 71, 56, 8, 1, 0, true);
  // 岩石环绕
  const rocks: [number, number, number, number, number][] = [
    [-31, 62, 6, 5, 5], [-33, 48, 7, 7, 6], [-31, 34, 5, 4, 6], [-33, 21, 7, 8, 6], [31, 60, 6, 6, 5], [33, 45, 7, 5, 7], [31, 31, 6, 7, 5], [33, 19, 6, 5, 6],
    [-20, 75, 7, 5, 5], [-6, 77, 8, 6, 5], [9, 76, 7, 4, 5], [22, 75, 7, 6, 6],
  ];
  rocks.forEach(([x, z, sx, sy, sz], i) => b.rock(x, sy * 0.25, z, sx, sy, sz, 100 + i * 7, false));
  // 场内掩体岩石（带碰撞）
  b.rock(-14, 0.5, 40, 2.2, 1.6, 1.8, 311);
  b.rock(15, 0.4, 47, 1.8, 1.3, 2.2, 317);
  b.rock(-19, 0.6, 24, 2.4, 1.9, 2.0, 331);
  b.rock(20, 0.5, 27, 2.0, 1.5, 2.4, 337);
  // 空投舱 (0,58)：玩家从舱门（朝 -Z）走出
  b.cylinder(m.metalMid, 0, 0.5, 58.6, 1.7, 3.0, { segs: 10 });
  b.cylinder(m.metalDark, 0, 3.5, 58.6, 1.7, 1.1, { segs: 10, rTop: 0.7, collide: false });
  b.cylinder(m.metalDark, 0, 0, 58.6, 2.0, 0.5, { segs: 10, rTop: 1.7 });
  b.deco(m.glowCyan, 0, 2.9, 56.88, 1.2, 0.08, 0.05);
  b.deco(m.black, 0, 1.5, 56.9, 1.1, 2.0, 0.06);
  b.deco(m.hazard, 0, 0.45, 56.85, 1.5, 0.12, 0.06);
  for (const a of [0.8, 2.35, 3.9, 5.5]) {
    b.solid(m.metalDark, Math.sin(a) * 2.5, 0.35, 58.6 + Math.cos(a) * 2.5, 0.5, 0.7, 0.5, { rotY: a, castShadow: true });
    b.pipe(m.metalMid, Math.sin(a) * 1.6, 1.6, 58.6 + Math.cos(a) * 1.6, Math.sin(a) * 2.5, 0.6, 58.6 + Math.cos(a) * 2.5, 0.09, true);
  }
  b.deco(m.hazard, 0, 0.02, 55.6, 1.6, 0.03, 2.2);
  b.socket(0, 2.6, 56.2, 0x35e0ff, 26, 12);
  // 引导信标：一路通向闸门
  for (const z of [50, 42, 34, 26, 18]) {
    for (const s of [-1, 1]) {
      b.solid(m.metalDark, s * 4.6, 0.55, z, 0.22, 1.1, 0.22, { castShadow: true });
      b.deco(m.glowCyan, s * 4.6, 1.16, z, 0.26, 0.1, 0.26);
    }
    b.socket(0, 1.6, z, 0x35e0ff, 9, 9);
  }
  // 跳跃教学：混凝土路障（两侧可绕行）
  for (const x of [-3, 0, 3]) b.solid(m.concrete, x, 0.42, 45, 2.7, 0.84, 0.7, { castShadow: true, tile: 2 });
  b.deco(m.hazard, 0, 0.86, 45, 8.7, 0.05, 0.72);
  // 靶场围栏与沙袋掩体
  b.solid(m.concrete, -8, 0.5, 31, 5, 1.0, 0.8, { castShadow: true, tile: 2 });
  b.solid(m.concrete, 8, 0.5, 31, 5, 1.0, 0.8, { castShadow: true, tile: 2 });
  b.crateCluster(-11, 15.5, [[0, 0, 1.4], [1.5, 0.2, 1.2], [0.4, 0, 1.0, 1]]);
  b.crateCluster(13, 16, [[0, 0, 1.4], [-1.5, 0.3, 1.1], [0, 1.5, 1.2]]);
  // 通信天线
  b.cylinder(m.metalDark, -21, 0, 52, 0.25, 9, { segs: 8 });
  b.deco(m.metalMid, -21, 8.2, 52, 3.2, 0.12, 0.12);
  b.deco(m.metalMid, -21, 7.2, 52, 2.2, 0.1, 0.1);
  b.deco(m.glowRed, -21, 9.1, 52, 0.18, 0.18, 0.18);
  b.socket(-21, 9.2, 52, 0xff2d2d, 14, 14, 2);
  // 基地外立面（z[10,12]）
  b.wallX(m.wallDark, 11, -46, 46, 0, 18, 2, [{ c: 0, w: 8, h: 5.5 }], { castShadow: true });
  b.doorFrame(0, 11, 8, 5.5, 'x', 2, m.glowCyan);
  for (const x of [-34, -24, -14, 14, 24, 34]) {
    b.solid(m.trim, x, 9, 12.3, 1.6, 18, 0.9, { castShadow: true });
    b.deco(m.glowOrange, x, 5, 12.77, 0.12, 6, 0.03);
  }
  b.deco(m.hazard, 0, 6.6, 12.05, 12, 0.5, 0.1);
  b.deco(m.metalDark, 0, 14, 12.2, 92, 1.2, 0.5);
  b.deco(m.glowCyanSoft, 0, 13.2, 12.5, 60, 0.08, 0.05);
  sign('HANGAR 01', 'ECLIPSE STATION // KEPLER-442', 0, 9.3, 12.04, 11, 4.2, 0, '#dfe8f0');
  sign('01', 'LANDING ZONE', -9.5, 3.2, 12.04, 5, 2.5, 0);
  // 闸门终端 (5.2, 13.5)
  b.solid(m.metalDark, 5.2, 0.6, 12.45, 1.1, 1.2, 0.7, { castShadow: true });
  scr('status', 3, 5.2, 1.5, 12.62, 0.95, 0.6, 0, '#35e0ff', 1.8, -0.3);
  b.deco(m.glowCyan, 5.2, 1.1, 12.81, 0.9, 0.04, 0.02);
  // 泛光灯
  for (const x of [-9, 9]) {
    b.deco(m.metalDark, x, 7.6, 12.4, 1.4, 0.4, 0.8);
    b.deco(m.glowWarm, x, 7.38, 12.5, 1.2, 0.05, 0.6);
    b.socket(x, 6.6, 15, 0xffd9a8, 90, 26);
  }
  b.socket(0, 5, 14.5, 0x35e0ff, 30, 14);
  b.endZone();

  // =================================================================================
  // 分区 1：机库
  // =================================================================================
  b.beginZone(1);
  const H1 = 14;
  b.floor(m.floor, -22, -40, 22, 10);
  b.ceiling(m.ceiling, -23, -41, 23, 10, H1);
  b.wallZ(m.wall, -22.5, -41, 10, 0, H1, T, [{ c: -20, w: 3.4, h: 3.4 }]);
  b.wallZ(m.wall, 22.5, -41, 10, 0, H1, T);
  b.wallX(m.wall, -40.5, -22, 22, 0, H1, T, [{ c: 0, w: 4, h: 3.4 }]);
  b.floor(m.floorDark, -2, -41, 2, -40);
  b.doorFrame(0, -40.5, 4, 3.4, 'x', T, m.glowRed);
  b.doorFrame(-22.5, -20, 3.4, 3.4, 'z', T, m.glowOrange);
  // 地面标线
  for (const [x, z, sx, sz] of [[-9, -1.2, 9, 0.25], [-9, -14.8, 9, 0.25], [-13.4, -8, 0.25, 13.8], [-4.6, -8, 0.25, 13.8], [0, 6, 8, 0.2], [0, -36, 6, 0.2]] as const) b.deco(m.hazard, x, 0.012, z, sx, 0.02, sz);
  for (const z of [0, -10, -20, -30]) b.deco(m.glowCyanSoft, 0, 0.012, z - 3, 0.12, 0.02, 4);
  // 墙面立柱与高处管线
  for (const z of [-34, -26, -14, -6, 2]) {
    pilaster(-21.75, z, H1, 'z');
    pilaster(21.75, z, H1, 'z');
  }
  for (const x of [-16, -8, 8]) pilaster(x, -39.75, H1, 'x');
  b.pipe(m.pipe, -21.2, 8.5, -40, -21.2, 8.5, 9.5, 0.35);
  b.pipe(m.pipeCopper, -21.3, 7.6, -40, -21.3, 7.6, 9.5, 0.16);
  b.pipe(m.pipe, -22, 11, -39.3, 22, 11, -39.3, 0.4);
  // 吊灯阵列（带体积光柱）
  for (const x of [-12, 0, 12]) for (const z of [-32, -20, -8, 4]) b.ceilingLamp(x, 10.6, z, 0xcfe2ff, 150, 24, { size: 1.8, shaftH: 8 });
  for (const x of [-12, 0, 12]) for (const z of [-32, -20, -8, 4]) b.deco(m.metalDark, x, 12.3, z, 0.1, 3.4, 0.1);
  // 顶部桁架
  for (const z of [-36, -24, -12, 0]) b.deco(m.trim, 0, 13.3, z, 44, 0.7, 0.5);
  // 运输机 (-9,-8)，机头朝南
  b.block(m.metalMid, -11.4, 1.3, -14, -6.6, 4.1, -3, { castShadow: true, tile: 3 });
  b.block(m.metalLight, -10.8, 1.5, -3, -7.2, 3.7, -0.6, { castShadow: true });
  b.block(m.metalDark, -10.2, 1.9, -0.6, -7.8, 3.2, 0.8, { castShadow: true });
  b.deco(m.glass, -9, 3.3, -0.1, 2.2, 0.7, 1.6);
  b.block(m.metalDark, -15.5, 2.6, -11.5, -11.4, 3.0, -6, { castShadow: true, nav: false });
  b.block(m.metalDark, -6.6, 2.6, -11.5, -2.5, 3.0, -6, { castShadow: true, nav: false });
  b.pipe(m.gunmetal, -14.2, 2.2, -12.5, -14.2, 2.2, -5.5, 0.85, true);
  b.pipe(m.gunmetal, -3.8, 2.2, -12.5, -3.8, 2.2, -5.5, 0.85, true);
  b.deco(m.glowOrange, -14.2, 2.2, -12.56, 1.1, 1.1, 0.04);
  b.deco(m.glowOrange, -3.8, 2.2, -12.56, 1.1, 1.1, 0.04);
  b.block(m.metalDark, -10.4, 4.1, -13.6, -7.6, 5.6, -11.8, { castShadow: true });
  b.deco(m.hazard, -9, 2.7, -14.02, 3.6, 0.3, 0.05);
  b.deco(m.metalOrange, -9, 2.4, -6, 4.84, 0.5, 6);
  for (const [x, z] of [[-10.8, -12.5], [-7.2, -12.5], [-10.8, -4.5], [-7.2, -4.5]] as const) b.solid(m.metalDark, x, 0.65, z, 0.5, 1.3, 0.8, { castShadow: true, nav: false });
  // 尾部跳板
  b.deco(m.metalDark, -9, 0.7, -15.2, 3.2, 0.14, 2.8);
  sign('ES-07', 'DROPSHIP', -6.58, 2.9, -8.5, 3.6, 1.8, PI / 2);
  // 货箱掩体
  b.crateCluster(4.5, -4, [[0, 0, 1.6], [1.8, 0.2, 1.4], [0.3, 0, 1.2, 1], [-0.2, 1.8, 1.4]]);
  b.crateCluster(11, -15, [[0, 0, 1.8], [-1.9, 0.1, 1.4], [0, 0, 1.2, 1], [0.2, -1.9, 1.5]]);
  b.crateCluster(-2.5, -23, [[0, 0, 1.6], [1.7, 0, 1.6], [0.8, 0, 1.2, 1]]);
  b.crateCluster(7.5, -29, [[0, 0, 1.7], [0, 1.8, 1.4], [-1.8, 0.3, 1.5], [0, 0.2, 1.1, 1]]);
  b.crateCluster(-14, -30, [[0, 0, 1.8], [1.9, 0, 1.5], [0.2, -1.9, 1.5], [0.3, 0, 1.2, 1]]);
  b.crateCluster(-17, 3, [[0, 0, 1.6], [0.2, 1.8, 1.6], [1.8, 0.4, 1.3]]);
  b.crateCluster(11, 5, [[0, 0, 1.5], [1.7, 0.2, 1.5], [0.6, 0.1, 1.2, 1]]);
  b.crateCluster(-16, -19, [[0, 0, 1.6], [0.1, -1.8, 1.4]]);
  // 油料车
  b.solid(m.metalOrange, 4, 0.9, -34.5, 3.4, 1.2, 1.6, { castShadow: true });
  b.pipe(m.metalLight, 2.6, 1.9, -34.5, 5.4, 1.9, -34.5, 0.55, true);
  // 东侧高架走道 y=4.2
  b.block(m.metalDark, 17, 3.9, -32, 22, 4.2, -6, { nav: false, castShadow: true, tile: 2 });
  b.deco(m.grate, 19.5, 4.215, -19, 4.6, 0.02, 25.6);
  b.deco(m.hazard, 17.08, 4.05, -19, 0.06, 0.3, 26);
  for (const z of [-30, -22, -14, -6.6]) b.block(m.trim, 17, 0, z - 0.2, 17.4, 3.9, z + 0.2, { castShadow: true });
  b.railing(17.06, -32, 17.06, -6.05, 4.2);
  b.railing(17, -6.05, 19, -6.05, 4.2);
  b.deco(m.glowCyanSoft, 17.02, 3.86, -19, 0.04, 0.06, 26);
  // 楼梯 z[2 → -6]：视觉为台阶，碰撞为斜坡
  for (let i = 0; i < 14; i++) b.deco(m.metalDark, 20.5, (i + 1) * 0.15, 2 - (i + 0.5) * (8 / 14), 3, (i + 1) * 0.3, 8 / 14 + 0.01, { castShadow: i % 3 === 0 });
  for (let i = 0; i < 14; i++) b.deco(m.hazard, 20.5, (i + 1) * 0.3 + 0.005, 2 - i * (8 / 14) - 0.06, 3, 0.012, 0.1);
  {
    const th = Math.atan2(4.2, 8);
    const len = Math.hypot(4.2, 8);
    const desc = RAPIER.ColliderDesc.cuboid(1.5, 0.15, len / 2 + 0.1)
      .setTranslation(20.5, 2.1 - Math.cos(th) * 0.15, -2 - Math.sin(th) * 0.15)
      .setRotation({ x: Math.sin(th / 2), y: 0, z: 0, w: Math.cos(th / 2) })
      .setCollisionGroups(groups(G.WORLD, 0xffff));
    ctx.physics.world.createCollider(desc);
    nav.blockBox(20.5, -2, 3, 8);
    b.collider(18.95, 2.6, -2, 0.1, 5.2, 8, 0, false); // 楼梯内侧挡板
    b.deco(m.metalMid, 18.95, 2.4, -2, 0.06, 4.8, 8);
  }
  // 控制室（上层 x[14,22] z[-40,-32]，地面 y=4.2）
  b.block(m.wallDark, 14, 0, -40, 22, 3.9, -32, { castShadow: true });
  b.block(m.metalDark, 13.85, 3.9, -40, 22, 4.2, -32, { nav: false });
  b.block(m.wallDark, 13.85, 8.2, -40, 22, 8.6, -31.85, { nav: false, castShadow: true });
  b.wallX(m.wallDark, -31.92, 13.85, 22, 4.2, 4, 0.3, [{ c: 19.5, w: 3, h: 2.8 }], { nav: false });
  b.block(m.wallDark, 13.85, 4.2, -40, 14.15, 5.3, -32, { nav: false });
  b.block(m.wallDark, 13.85, 7.2, -40, 14.15, 8.2, -32, { nav: false });
  b.deco(m.glass, 14, 6.25, -36, 0.05, 1.9, 7.6);
  b.deco(m.glowCyan, 13.8, 5.32, -36, 0.03, 0.05, 8);
  b.deco(m.glowCyan, 13.8, 7.18, -36, 0.03, 0.05, 8);
  sign('CONTROL', 'ACCESS LEVEL A', 13.8, 2.4, -36, 5, 2.5, -PI / 2);
  desk(16, -39.2, 3, 1, 5, '#35e0ff', 4.2);
  desk(20, -39.2, 2.6, 1, 6, '#ffb347', 4.2);
  scr('map', 7, 18, 6.6, -39.95, 5, 1.6, 0, '#35e0ff', 1.2);
  b.solid(m.metalDark, 16.4, 4.2 + 0.45, -34.2, 1.4, 0.9, 0.7, { nav: false }); // 武器架
  b.deco(m.glowOrange, 16.4, 5.13, -34.2, 1.3, 0.03, 0.6);
  b.socket(18, 7.4, -36, 0x9fd8ff, 40, 12);
  b.deco(m.glowWhite, 18, 8.17, -36, 2.4, 0.04, 0.6);
  // 北门警示灯与读卡器
  b.deco(m.glowAlarm, -3.2, 4.3, -39.9, 0.5, 0.3, 0.2);
  b.deco(m.glowAlarm, 3.2, 4.3, -39.9, 0.5, 0.3, 0.2);
  b.socket(0, 4.4, -38.6, 0xff2d2d, 40, 14, 2);
  b.solid(m.metalDark, 2.9, 0.65, -39.75, 0.6, 1.3, 0.4);
  scr('status', 9, 2.9, 1.45, -39.52, 0.5, 0.4, 0, '#ff5a3a', 1.8, -0.3);
  sign('02', 'RESEARCH WING', -6.5, 3.4, -39.98, 5, 2.5, 0);
  sign('CAUTION', 'AUTOMATED DEFENSE ACTIVE', 9, 3.2, -39.98, 5, 2.5, 0, '#ff8a4a');
  scr('warning', 11, -21.98, 3.5, -8, 3.2, 2, PI / 2, '#ff5a3a', 1.2);
  scr('data', 12, -21.98, 3.5, -30, 3.2, 2, PI / 2, '#35e0ff', 1.2);
  // 西侧怪物间 x[-29,-23] z[-23,-17]
  b.floor(m.floorDark, -29, -23, -22, -17);
  b.ceiling(m.ceiling, -30, -24, -22, -16, 4);
  b.wallX(m.wallDark, -23.5, -30, -23, 0, 4, T);
  b.wallX(m.wallDark, -16.5, -30, -23, 0, 4, T);
  b.wallZ(m.wallDark, -29.5, -23, -17, 0, 4, T);
  b.socket(-26, 3, -20, 0xff5a2a, 22, 9, 1);
  b.deco(m.glowOrange, -26, 3.96, -20, 1.2, 0.04, 0.4);
  rack(-28.4, -22.3, 1, 0, m.glowOrange);
  rack(-28.4, -17.7, 1, 0, m.glowOrange);
  b.endZone();

  // =================================================================================
  // 分区 2：安检通道 x[-3,3] z[-56,-41]
  // =================================================================================
  b.beginZone(2);
  room({ x0: -3, x1: 3, z0: -56, z1: -41, h: 4, floor: m.floorDark, wall: m.wallDark, n: null, s: null });
  b.floor(m.floorDark, -2, -57, 2, -56);
  b.doorFrame(0, -56.5, 4, 3.4, 'x', T, m.glowCyan);
  for (const z of [-45, -52]) b.ceilingLamp(0, 4, z, 0xbfe0ff, 50, 12, { shaft: null, size: 1.4 });
  for (const s of [-1, 1]) {
    b.strip(m.glowCyanSoft, s * 2.97, 0.35, -48.5, 15, 'z', 0.05);
    b.strip(m.glowCyanSoft, s * 2.97, 3.2, -48.5, 15, 'z', 0.05);
    for (const z of [-44, -48.5, -53]) b.solid(m.trim, s * 2.8, 2, z, 0.4, 4, 0.6);
  }
  scr('map', 21, -2.96, 2, -46.2, 2.6, 1.5, PI / 2, '#35e0ff', 1.3);
  scr('warning', 22, 2.96, 2, -50.7, 2.6, 1.5, -PI / 2, '#ff5a3a', 1.3);
  sign('SECURITY', 'CHECKPOINT 02', 2.96, 2.1, -46.2, 2.6, 1.3, -PI / 2);
  b.solid(m.crateOlive, -2.3, 0.4, -54.6, 1.1, 0.8, 1.1, { castShadow: true, tile: 0 });
  b.endZone();

  // =================================================================================
  // 分区 3：研究实验室 x[-20,20] z[-97,-57]
  // =================================================================================
  b.beginZone(3);
  const H3 = 6;
  room({ x0: -20, x1: 20, z0: -97, z1: -57, h: H3, floor: m.floorLab, wall: m.wallLab, n: [{ c: 0, w: 4, h: 3.4 }], s: [{ c: 0, w: 4, h: 3.4 }] });
  b.floor(m.floorDark, -2, -98, 2, -97);
  b.doorFrame(0, -97.5, 4, 3.4, 'x', T, m.glowRed);
  // 隔墙 x=±11：门洞 z=-64/-90，中段为观察窗（矮墙 1.1m 可作掩体）
  for (const s of [-1, 1]) {
    const x = s * 11;
    b.wallZ(m.wallLab, x, -97, -86, 0, H3, 0.5, [{ c: -90, w: 3, h: 3.2 }]);
    b.wallZ(m.wallLab, x, -68, -57, 0, H3, 0.5, [{ c: -64, w: 3, h: 3.2 }]);
    b.block(m.wallLab, x - 0.25, 0, -86, x + 0.25, 1.1, -68);
    b.block(m.wallLab, x - 0.25, 3.3, -86, x + 0.25, H3, -68, { nav: false });
    for (const z of [-80, -74]) b.block(m.trim, x - 0.3, 1.1, z - 0.2, x + 0.3, 3.3, z + 0.2);
    b.deco(m.glass, x, 2.2, -77, 0.04, 2.2, 18);
    b.deco(m.glowCyanSoft, x - s * 0.27, 1.13, -77, 0.03, 0.05, 18);
    b.deco(m.trim, x, 1.13, -77, 0.6, 0.08, 18.2);
  }
  // 灯光：冷白实验室照明
  for (const x of [-15.5, 0, 15.5]) for (const z of [-64, -77, -90]) b.ceilingLamp(x, H3, z, 0xdff0ff, 85, 15, { size: 1.6, shaft: x === 0 ? 'white' : null, shaftH: 5 });
  for (const x of [-6, 6]) for (const z of [-70, -84]) b.deco(m.glowWhite, x, H3 - 0.03, z, 0.3, 0.04, 5);
  // 中庭全息台 (0,-77)
  b.cylinder(m.metalDark, 0, 0, -77, 2.2, 0.9, { segs: 24 });
  b.cylinder(m.trim, 0, 0.9, -77, 1.9, 0.12, { segs: 24, collide: false });
  b.cylinder(m.glowCyan, 0, 1.02, -77, 1.5, 0.03, { segs: 24, collide: false, cast: false });
  b.socket(0, 2.6, -77, 0x35e0ff, 60, 13);
  {
    const holoMat = b.own(glowMat(0x35e0ff, 1.5));
    holoMat.wireframe = true;
    holoMat.transparent = true;
    holoMat.opacity = 0.8;
    holoMat.blending = THREE.AdditiveBlending;
    holoMat.depthWrite = false;
    const planet = new THREE.Mesh(b.own(new THREE.IcosahedronGeometry(1.15, 2)), holoMat);
    planet.position.set(0, 2.5, -77);
    const ringMat = b.own(glowMat(0xff8a2a, 1.6));
    ringMat.transparent = true;
    ringMat.opacity = 0.7;
    ringMat.side = THREE.DoubleSide;
    ringMat.blending = THREE.AdditiveBlending;
    ringMat.depthWrite = false;
    const ring = new THREE.Mesh(b.own(new THREE.RingGeometry(1.6, 1.68, 48)), ringMat);
    ring.rotation.x = 1.25;
    planet.add(ring);
    b.group().add(planet);
    refs.spinners.push(planet);
    const cone = new THREE.Mesh(b.own(new THREE.CylinderGeometry(1.3, 0.3, 1.3, 20, 1, true)), b.shafts.cyan);
    cone.position.set(0, 1.7, -77);
    b.group().add(cone);
  }
  // 培养罐
  for (const [x, z, glow] of [[-6, -67, m.glowGreen], [6, -67, m.glowViolet], [-6, -87, m.glowViolet], [6, -87, m.glowGreen]] as const) {
    b.cylinder(m.metalDark, x, 0, z, 1.15, 0.5, { segs: 16 });
    b.cylinder(m.glassTank, x, 0.5, z, 0.95, 3.1, { segs: 16, cast: false });
    b.cylinder(glow, x, 0.6, z, 0.35, 2.6, { segs: 8, collide: false, cast: false });
    b.cylinder(m.metalDark, x, 3.6, z, 1.15, 0.5, { segs: 16, collide: false });
    b.pipe(m.pipe, x, 4.1, z, x, H3, z, 0.25);
    b.socket(x, 2.2, z + (z > -77 ? -1.6 : 1.6), glow === m.glowGreen ? 0x4dff9a : 0x9a6bff, 26, 8);
  }
  // 实验台与设备（掩体）
  for (const [x, z, w, d] of [[-4.5, -61.5, 3, 1.2], [4.5, -61.5, 3, 1.2], [-4.5, -93, 3, 1.2], [4.5, -93, 3, 1.2], [15.5, -68, 1.3, 4], [15.5, -86, 1.3, 4], [-15.5, -70, 1.3, 4]] as const) {
    b.solid(m.metalLight, x, 0.5, z, w, 1.0, d, { castShadow: true });
    b.deco(m.trim, x, 1.03, z, w + 0.1, 0.06, d + 0.1);
    b.deco(m.glowCyanSoft, x, 0.2, z + (d < 2 ? d / 2 + 0.01 : 0), d < 2 ? w * 0.8 : 0.02, 0.04, 0.02);
  }
  desk(16, -96.2, 3, 1, 31);
  desk(-16, -57.8, 3, -1, 32, '#4dff9a');
  // 东翼：HELIX 展台 (16,-77)
  b.cylinder(m.metalDark, 16, 0, -77, 0.9, 0.9, { segs: 12 });
  b.cylinder(m.glowCyan, 16, 0.9, -77, 0.7, 0.04, { segs: 12, collide: false, cast: false });
  b.socket(16, 2.8, -77, 0x35e0ff, 45, 10);
  scr('graph', 33, 19.96, 2.6, -77, 4.5, 2.2, -PI / 2, '#35e0ff', 1.3);
  sign('PROTOTYPE', 'HELIX ENERGY RIFLE', 19.96, 4.4, -77, 4, 1.4, -PI / 2);
  scr('data', 34, 19.96, 2.4, -63, 3, 1.8, -PI / 2, '#35e0ff', 1.1);
  scr('warning', 35, 19.96, 2.4, -91, 3, 1.8, -PI / 2, '#ff5a3a', 1.1);
  // 西翼：服务器阵列，西北角藏有补给
  for (const z of [-93.2, -90.2, -87.2]) rack(-13.6, z, -1, 0);
  for (const z of [-93.2, -90.2]) rack(-16.6, z, 1, 0, m.glowViolet);
  for (const z of [-66, -63, -60]) rack(-18.9, z, 1, 0);
  rack(-17.2, -92.9, 0, 1, m.glowViolet);
  scr('graph', 36, -19.96, 2.6, -77, 4.5, 2.2, PI / 2, '#9a6bff', 1.2);
  sign('03', 'XENOBIOLOGY LAB', -5.5, 4.4, -57.03, 5, 2.4, PI);
  sign('04', 'INDUSTRIAL SECTOR', 5.5, 4.2, -96.97, 5, 2.4, 0, '#ffb070');
  b.socket(0, 4.2, -95, 0xff2d2d, 30, 12, 2);
  b.endZone();

  // =================================================================================
  // 分区 4：工业区（走廊 + 机械大厅）
  // =================================================================================
  b.beginZone(4);
  // 走廊 x[-3,3] z[-110,-98]
  b.floor(m.grate, -3, -110, 3, -98);
  b.ceiling(m.ceiling, -4, -110, 4, -97, 4);
  b.wallZ(m.wallRust, -3.5, -110, -98, 0, 4, T);
  b.wallZ(m.wallRust, 3.5, -110, -98, 0, 4, T);
  b.pipe(m.pipeCopper, -2.7, 3.3, -110, -2.7, 3.3, -98, 0.22);
  b.pipe(m.pipe, 2.6, 3.4, -110, 2.6, 3.4, -98, 0.3);
  b.pipe(m.pipe, 2.7, 0.5, -110, 2.7, 0.5, -98, 0.18);
  b.ceilingLamp(0, 4, -101, 0xffb070, 40, 11, { glow: m.glowWarm, shaft: null, size: 1.2, flicker: 1 });
  b.ceilingLamp(0, 4, -107, 0xffb070, 40, 11, { glow: m.glowWarm, shaft: null, size: 1.2 });
  sign('DANGER', 'HEAVY MACHINERY', -2.97, 2.1, -104, 3, 1.5, PI / 2, '#ff8a4a');
  // 机械大厅 x[-18,18] z[-142,-110]
  const H4 = 9;
  b.floor(m.floorDark, -18, -142, 18, -110);
  b.ceiling(m.ceiling, -19, -143, 19, -110, H4);
  b.wallX(m.wallRust, -110.5 + 0.0, -19, 19, 0, H4, T, [{ c: 0, w: 6, h: 4 }]);
  b.wallX(m.wallRust, -142.5, -19, 19, 0, H4, T, [{ c: 0, w: 4, h: 3.4 }]);
  b.wallZ(m.wallRust, -18.5, -142, -111, 0, H4, T);
  b.wallZ(m.wallRust, 18.5, -142, -111, 0, H4, T);
  b.floor(m.floorDark, -2, -143, 2, -142);
  b.doorFrame(0, -142.5, 4, 3.4, 'x', T, m.glowRed);
  nav.markFloorRect(-3, -111, 3, -110);
  // 涡轮机组 x[-12,-5] / [5,12]，z[-131,-121]
  for (const s of [-1, 1]) {
    const cx = s * 8.5;
    b.block(m.metalDark, cx - 3.5, 0, -131, cx + 3.5, 3.6, -121, { castShadow: true, tile: 3 });
    b.block(m.wallRust, cx - 3.0, 3.6, -130.4, cx + 3.0, 4.4, -121.6, { castShadow: true, nav: false });
    b.cylinder(m.metalMid, cx, 4.4, -126, 2.3, 2.6, { segs: 20, collide: false });
    b.cylinder(m.metalDark, cx, 7.0, -126, 1.2, 2.0, { segs: 14, collide: false });
    b.cylinder(m.glowOrange, cx, 5.3, -126, 2.34, 0.25, { segs: 20, collide: false, cast: false });
    b.deco(m.hazard, cx, 0.5, -120.97, 7, 0.4, 0.05);
    b.deco(m.hazard, cx, 0.5, -131.03, 7, 0.4, 0.05);
    for (const z of [-129, -126, -123]) {
      b.deco(m.black, cx - s * 3.52, 1.9, z, 0.05, 1.6, 1.8);
      b.deco(m.glowOrange, cx - s * 3.54, 1.9, z, 0.03, 0.12, 1.5);
      b.deco(m.glowOrange, cx - s * 3.54, 1.4, z, 0.03, 0.12, 1.5);
      b.deco(m.glowOrange, cx - s * 3.54, 2.4, z, 0.03, 0.12, 1.5);
    }
    scr('graph', 41 + s, cx, 2.2, -120.96, 2.4, 1.3, 0, '#ffb347', 1.3);
    b.pipe(m.pipe, cx + s * 3.5, 2.8, -126, s * 18, 2.8, -126, 0.45, true);
    b.pipe(m.pipeCopper, cx, 4.0, -131, cx, 4.0, -142, 0.3);
    b.pipe(m.pipe, cx - s * 1.5, 6.5, -121.6, cx - s * 1.5, 6.5, -110.5, 0.35);
    b.socket(cx - s * 5, 2.4, -126, 0xff8a2a, 70, 14);
    b.socket(cx, 6.6, -119.5, 0xff8a2a, 45, 12);
    refs.vents.push(new THREE.Vector3(cx - s * 3.7, 3.4, -123), new THREE.Vector3(cx - s * 3.7, 3.4, -129));
  }
  // 中央吊装轨与管廊
  b.deco(m.trim, 0, H4 - 0.5, -126, 1.0, 0.6, 32);
  b.deco(m.hazard, 0, H4 - 0.85, -126, 1.04, 0.12, 32);
  b.deco(m.metalDark, 0, H4 - 1.6, -133, 1.6, 1.4, 2.2);
  b.pipe(m.metalMid, 0, H4 - 2.3, -133, 0, H4 - 4.2, -133, 0.08);
  b.pipe(m.pipe, -18, 7.6, -141.2, 18, 7.6, -141.2, 0.5);
  b.pipe(m.pipeCopper, -18, 6.6, -141.4, 18, 6.6, -141.4, 0.22);
  b.pipe(m.pipe, -17.4, 5.5, -142, -17.4, 5.5, -111, 0.4);
  b.pipe(m.pipe, 17.4, 5.5, -142, 17.4, 5.5, -111, 0.4);
  for (const [x, z] of [[-14, -114], [14, -114], [-14, -138], [14, -138]] as const) {
    b.solid(m.trim, x, H4 / 2, z, 1.2, H4, 1.2, { castShadow: true });
    b.deco(m.glowOrange, x, 2, z + 0.61, 0.1, 2.2, 0.02);
    b.deco(m.glowOrange, x, 2, z - 0.61, 0.1, 2.2, 0.02);
  }
  for (const [x, z] of [[-10, -116], [10, -116], [0, -121], [0, -137], [-10, -136], [10, -136]] as const) b.ceilingLamp(x, H4, z, 0xffa860, 75, 16, { glow: m.glowWarm, shaft: 'warm', size: 1.3, shaftH: 6, flicker: x === 10 && z === -116 ? 1 : 0 });
  b.crateCluster(-4.5, -114.5, [[0, 0, 1.5], [0.2, -1.7, 1.3]]);
  b.crateCluster(5.5, -117, [[0, 0, 1.6], [1.7, 0.2, 1.3], [0.5, 0, 1.1, 1]]);
  b.crateCluster(-3.5, -139, [[0, 0, 1.6], [-1.8, 0, 1.4]]);
  b.crateCluster(15.5, -124, [[0, 0, 1.5], [0, -1.7, 1.5], [0, -0.8, 1.2, 1]]);
  b.crateCluster(-15.8, -131, [[0, 0, 1.6], [0.2, 1.8, 1.3]]);
  b.solid(m.concrete, 0, 0.55, -130.5, 4.2, 1.1, 0.8, { castShadow: true, tile: 2 });
  b.solid(m.concrete, 0, 0.55, -121.5, 4.2, 1.1, 0.8, { castShadow: true, tile: 2 });
  sign('05', 'POWER CONTROL', -6, 4.6, -141.97, 5, 2.4, 0, '#ffb070');
  b.socket(0, 4.3, -140.5, 0xff2d2d, 30, 12, 2);
  refs.vents.push(new THREE.Vector3(-17.2, 0.4, -118), new THREE.Vector3(17.2, 0.4, -134));
  b.endZone();

  // =================================================================================
  // 分区 5：能源控制室 x[-13,13] z[-167,-143]
  // =================================================================================
  b.beginZone(5);
  const H5 = 7;
  room({
    x0: -13, x1: 13, z0: -167, z1: -143, h: H5, floor: m.floorDark, wall: m.wall,
    n: [{ c: 0, w: 4, h: 3.4 }], s: null, w: [{ c: -155, w: 3, h: 3.2 }], e: [{ c: -155, w: 3, h: 3.2 }],
  });
  b.floor(m.floorDark, -2, -168, 2, -167);
  b.doorFrame(0, -167.5, 4, 3.4, 'x', T, m.glowRed);
  b.doorFrame(-13.5, -155, 3, 3.2, 'z', T, m.glowOrange);
  b.doorFrame(13.5, -155, 3, 3.2, 'z', T, m.glowOrange);
  // 两侧怪物间 x[-20,-14] / [14,20]，z[-158,-152]
  for (const s of [-1, 1]) {
    const x0 = s < 0 ? -20 : 14;
    b.floor(m.floorDark, s < 0 ? -20 : 13, -158, s < 0 ? -13 : 20, -152);
    b.ceiling(m.ceiling, x0 - 1, -159, x0 + 7, -151, 4);
    b.wallX(m.wallDark, -158.5, x0 - (s < 0 ? 1 : 0), x0 + 6 + (s > 0 ? 1 : 0), 0, 4, T);
    b.wallX(m.wallDark, -151.5, x0 - (s < 0 ? 1 : 0), x0 + 6 + (s > 0 ? 1 : 0), 0, 4, T);
    b.wallZ(m.wallDark, s * 20.5, -158, -152, 0, 4, T);
    b.deco(m.glowOrange, s * 17, 3.96, -155, 1.2, 0.04, 0.4);
    b.socket(s * 17, 3, -155, 0xff5a2a, 22, 9, 1);
  }
  // 中央控制台平台 (0,-155)
  b.cylinder(m.metalDark, 0, 0, -155, 4.2, 0.1, { segs: 28, collide: false, cast: false });
  b.cylinder(m.trim, 0, 0, -155, 1.5, 1.3, { segs: 16 });
  b.cylinder(refs.powerMat, 0, 1.3, -155, 1.35, 0.05, { segs: 16, collide: false, cast: false });
  b.cylinder(m.metalDark, 0, 1.35, -155, 0.5, 5.65, { segs: 12, collide: false });
  for (const y of [2.2, 3.4, 4.6, 5.8]) b.cylinder(refs.powerMat, 0, y, -155, 0.56, 0.12, { segs: 12, collide: false, cast: false });
  b.solid(m.metalDark, 0, 0.55, -152.6, 2.4, 1.1, 0.7, { castShadow: true });
  scr('status', 51, 0, 1.62, -152.5, 2.1, 0.7, 0, '#35e0ff', 1.8, -0.4);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2;
    b.deco(refs.powerMat, Math.sin(a) * 3.9, 0.11, -155 + Math.cos(a) * 3.9, 1.6, 0.02, 0.1, { rotY: a });
  }
  // 地面导能槽：从控制台通向北门
  b.deco(refs.powerMat, 0, 0.012, -163, 0.3, 0.02, 8);
  for (const s of [-1, 1]) b.deco(refs.powerMat, s * 8.5, 0.012, -155, 9, 0.02, 0.2);
  // 北墙大屏
  scr('map', 52, 0, 4.9, -166.96, 9, 2.6, 0, '#35e0ff', 1.2);
  scr('graph', 53, -8.5, 3.6, -166.96, 4.5, 2.4, 0, '#ffb347', 1.1);
  scr('warning', 54, 8.5, 3.6, -166.96, 4.5, 2.4, 0, '#ff5a3a', 1.1);
  // 阶梯式操作席（掩体）
  for (const [x, z, f] of [[-7.5, -148.5, 1], [7.5, -148.5, 1], [-7.5, -161.5, -1], [7.5, -161.5, -1]] as const) desk(x, z, 4.5, f as 1 | -1, Math.round(Math.abs(55 + x * 3 + z)));
  for (const [x, z] of [[-11.5, -146], [11.5, -146], [-11.5, -164.5], [11.5, -164.5]] as const) rack(x, z, x < 0 ? 1 : -1, 0);
  for (const x of [-12.75, 12.75]) for (const z of [-149, -161]) pilaster(x, z, H5, 'z', refs.powerMat);
  // 应急灯（红）与主照明（能源恢复后）
  for (const [x, z] of [[-8, -148], [8, -148], [-8, -162], [8, -162]] as const) {
    b.deco(m.glowAlarm, x, H5 - 0.1, z, 0.6, 0.2, 0.6);
    refs.emergencySockets.push(ctx.gfx.lights.addSocket(x, H5 - 1, z, 0xff3a2a, 55, 14, 5, 2));
    b.deco(refs.powerMat, x, H5 - 0.03, z + 2.2, 2.6, 0.04, 0.5);
    refs.powerSockets.push(ctx.gfx.lights.addSocket(x, H5 - 1, z + 2.2, 0xbfe6ff, 85, 16, 5, 0));
  }
  refs.emergencySockets.push(ctx.gfx.lights.addSocket(0, 2.2, -152, 0x35e0ff, 16, 7, 5, 0));
  refs.powerSockets.push(ctx.gfx.lights.addSocket(0, 3.6, -155, 0x35e0ff, 110, 18, 5, 0));
  b.endZone();

  // =================================================================================
  // 分区 6：核心通道 x[-3,3] z[-183,-168]
  // =================================================================================
  b.beginZone(6);
  b.floor(m.grate, -3, -183, 3, -168);
  b.ceiling(m.ceiling, -4, -183, 4, -168, 4);
  b.wallZ(m.wallDark, -3.5, -183, -168, 0, 4, T);
  b.wallZ(m.wallDark, 3.5, -183, -168, 0, 4, T);
  for (const s of [-1, 1]) {
    b.strip(m.glowRed, s * 2.97, 0.3, -175.5, 15, 'z', 0.05);
    b.strip(refs.powerMat, s * 2.97, 3.3, -175.5, 15, 'z', 0.06);
    for (const z of [-171, -175.5, -180]) b.solid(m.trim, s * 2.8, 2, z, 0.4, 4, 0.7);
  }
  for (const z of [-171.5, -179.5]) b.ceilingLamp(0, 4, z, 0xff5a4a, 36, 11, { glow: m.glowRed, shaft: null, size: 1.2, flicker: z < -175 ? 1 : 0 });
  sign('OMEGA', 'CENTRAL CORE // AUTHORIZED ONLY', -2.96, 2.1, -175.5, 4, 2, PI / 2, '#ff5a4a');
  scr('warning', 61, 2.96, 2.1, -175.5, 3, 1.7, -PI / 2, '#ff3a2a', 1.4);
  b.endZone();

  // =================================================================================
  // 分区 7：核心竞技场 圆心(0,-210) 半径 26
  // =================================================================================
  b.beginZone(7);
  const A = ARENA;
  b.floor(m.floorDark, -28.5, A.z - 28.5, 28.5, -184, 0, false);
  b.floor(m.floorDark, -2.25, -184, 2.25, -183, 0, false);
  nav.markFloorDisc(A.x, A.z, A.r - 0.4);
  nav.markFloorRect(-2.25, -185, 2.25, -183);
  b.ceiling(m.ceiling, -28.5, A.z - 28.5, 28.5, -183, A.h);
  const SEG = 24;
  const segLen = 2 * (A.r + 0.5) * Math.tan(PI / SEG) + 0.25;
  for (let i = 0; i < SEG; i++) {
    const a = (i / SEG) * PI * 2;
    const cx = A.x + Math.sin(a) * (A.r + 0.5);
    const cz = A.z + Math.cos(a) * (A.r + 0.5);
    if (i === 0) {
      // 南侧入口
      const side = (segLen - 4.5) / 2;
      b.solid(m.wallDark, -2.25 - side / 2, A.h / 2, cz, side, A.h, T);
      b.solid(m.wallDark, 2.25 + side / 2, A.h / 2, cz, side, A.h, T);
      b.solid(m.wallDark, 0, 3.6 + (A.h - 3.6) / 2, cz, 4.5, A.h - 3.6, T, { nav: false });
      b.doorFrame(0, cz, 4.5, 3.6, 'x', T, m.glowRed);
      continue;
    }
    b.solid(m.wallDark, cx, A.h / 2, cz, segLen, A.h, T, { rotY: a, tile: 4 });
    // 内侧灯带与立肋
    const ix = A.x + Math.sin(a) * (A.r - 0.03);
    const iz = A.z + Math.cos(a) * (A.r - 0.03);
    b.deco(m.glowRed, ix, 3.2, iz, segLen * 0.7, 0.08, 0.04, { rotY: a });
    b.deco(m.glowRed, ix, 11, iz, segLen * 0.5, 0.06, 0.04, { rotY: a });
    b.deco(m.trim, A.x + Math.sin(a + PI / SEG) * (A.r - 0.2), A.h / 2, A.z + Math.cos(a + PI / SEG) * (A.r - 0.2), 0.7, A.h, 0.6, { rotY: a + PI / SEG });
    if (i % 4 === 2) b.socket(A.x + Math.sin(a) * (A.r - 2.5), 5, A.z + Math.cos(a) * (A.r - 2.5), 0xff4a3a, 80, 22);
    if (i % 4 === 0) b.socket(A.x + Math.sin(a) * (A.r - 2.5), 4, A.z + Math.cos(a) * (A.r - 2.5), 0x9fc4ff, 70, 20);
  }
  // 六根掩体立柱 r=15
  for (let i = 0; i < 6; i++) {
    const a = PI / 6 + (i * PI) / 3;
    const x = A.x + Math.sin(a) * 15;
    const z = A.z + Math.cos(a) * 15;
    b.cylinder(m.trim, x, 0, z, 1.7, A.h, { segs: 10 });
    b.cylinder(m.metalDark, x, 0, z, 2.1, 0.6, { segs: 10, collide: false });
    b.cylinder(m.metalDark, x, 4.6, z, 1.9, 0.4, { segs: 10, collide: false });
    for (let k = 0; k < 5; k++) {
      const ka = a + (k / 5) * PI * 2;
      b.deco(m.glowCyanSoft, x + Math.sin(ka) * 1.66, 2.6, z + Math.cos(ka) * 1.66, 0.12, 3.6, 0.04, { rotY: ka });
    }
    b.socket(x + Math.sin(a) * 2.6, 3, z + Math.cos(a) * 2.6, 0x35e0ff, 34, 11);
  }
  // 地面同心环纹与辐射线
  for (const [r, n, mat] of [[9, 28, m.glowRed], [20.5, 48, m.glowCyanSoft]] as const) {
    const len = 2 * r * Math.tan(PI / n) + 0.02;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * PI * 2;
      b.deco(mat, A.x + Math.sin(a) * r, 0.012, A.z + Math.cos(a) * r, len, 0.02, 0.12, { rotY: a });
    }
  }
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * PI * 2 + PI / 12;
    b.deco(m.hazard, A.x + Math.sin(a) * 14.7, 0.011, A.z + Math.cos(a) * 14.7, 0.35, 0.02, 11, { rotY: a });
  }
  // 顶部核心反应堆
  b.cylinder(m.metalDark, A.x, A.h - 5, A.z, 5.5, 5, { segs: 16, collide: false, rTop: 7 });
  b.cylinder(m.glowRed, A.x, A.h - 5.4, A.z, 3.2, 0.4, { segs: 16, collide: false, cast: false });
  b.cylinder(m.trim, A.x, A.h - 8, A.z, 1.2, 2.6, { segs: 10, collide: false });
  for (let i = 0; i < 6; i++) {
    const a = (i * PI) / 3;
    b.pipe(m.pipe, A.x + Math.sin(a) * 5.2, A.h - 2.5, A.z + Math.cos(a) * 5.2, A.x + Math.sin(a) * 25.5, A.h - 1.2, A.z + Math.cos(a) * 25.5, 0.45);
  }
  b.socket(A.x, A.h - 9, A.z, 0xff3a2a, 260, 34);
  {
    const shaft = new THREE.Mesh(b.own(new THREE.CylinderGeometry(3, 8, A.h - 6, 20, 1, true)), b.shafts.red);
    shaft.position.set(A.x, (A.h - 6) / 2, A.z);
    b.group().add(shaft);
  }
  b.endZone();

  return refs;
}
