import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { damp, dist2D, rand } from '../core/math';
import type { Enemy } from '../enemies/Enemy';
import type { EnemyType } from '../enemies/EnemyModels';
import type { ZoneEnv } from '../render/Gfx';
import { Barrel, disposeEntityGeometry, Door, HoloTarget, Interactable, Pickup, PickupKind } from './Entities';
import { LevelBuilder } from './LevelBuilder';
import { ARENA, buildGeometry, GeometryRefs } from './LevelGeometry';

/** 关卡阶段（单调递增） */
export const Stage = {
  Landing: 0,
  Range: 1,
  Gate: 2,
  Hangar: 3,
  SecDoor: 4,
  Corridor: 5,
  Lab: 6,
  Industrial: 7,
  Hall: 8,
  Control: 9,
  Defense: 10,
  Core: 11,
  Boss: 12,
  Victory: 13,
} as const;

export const ZONE_NAMES = ['外围着陆区', '机库 01', '安检通道', '研究实验室', '工业区', '能源控制室', '核心通道', '中央核心'];

const ENV: ZoneEnv[] = [
  { fogColor: 0x241a2c, fogDensity: 0.011, hemiSky: 0x6a5a8a, hemiGround: 0x2a1c16, hemiIntensity: 0.85, sunColor: 0xffc49a, sunIntensity: 2.0, sunDir: [0.45, 0.62, 0.5], exposure: 1.0, envIntensity: 0.5 },
  { fogColor: 0x0b1118, fogDensity: 0.013, hemiSky: 0x7a94b8, hemiGround: 0x1a1612, hemiIntensity: 0.5, sunColor: 0xbfd4ff, sunIntensity: 0.7, sunDir: [0.12, 1, 0.1], exposure: 1.05, envIntensity: 0.35 },
  { fogColor: 0x070b10, fogDensity: 0.02, hemiSky: 0x6a8ab0, hemiGround: 0x101214, hemiIntensity: 0.4, sunColor: 0xbfd4ff, sunIntensity: 0.45, sunDir: [0.1, 1, 0.1], exposure: 1.05, envIntensity: 0.3 },
  { fogColor: 0x0c1418, fogDensity: 0.011, hemiSky: 0xbfe0ff, hemiGround: 0x202428, hemiIntensity: 0.65, sunColor: 0xe0f0ff, sunIntensity: 0.85, sunDir: [0.1, 1, 0.12], exposure: 1.0, envIntensity: 0.4 },
  { fogColor: 0x1a0f08, fogDensity: 0.021, hemiSky: 0xb07a50, hemiGround: 0x140c08, hemiIntensity: 0.45, sunColor: 0xffb070, sunIntensity: 0.6, sunDir: [0.12, 1, 0.08], exposure: 1.05, envIntensity: 0.3 },
  { fogColor: 0x070a12, fogDensity: 0.015, hemiSky: 0x5a7ab0, hemiGround: 0x101014, hemiIntensity: 0.4, sunColor: 0x9fc0ff, sunIntensity: 0.5, sunDir: [0.1, 1, 0.1], exposure: 1.05, envIntensity: 0.3 },
  { fogColor: 0x100406, fogDensity: 0.024, hemiSky: 0x8a3030, hemiGround: 0x0a0404, hemiIntensity: 0.35, sunColor: 0xff8a70, sunIntensity: 0.35, sunDir: [0.1, 1, 0.1], exposure: 1.05, envIntensity: 0.25 },
  { fogColor: 0x0c0406, fogDensity: 0.0105, hemiSky: 0x7a4050, hemiGround: 0x0c0608, hemiIntensity: 0.5, sunColor: 0xffb0a0, sunIntensity: 0.8, sunDir: [0.1, 1, 0.05], exposure: 1.0, envIntensity: 0.3 },
];

const AMBIENT: ('exterior' | 'base' | 'industrial' | 'core')[] = ['exterior', 'base', 'base', 'base', 'industrial', 'base', 'core', 'core'];

/** 存档点：重生位置与对应阶段 */
const CHECKPOINTS: { x: number; z: number; yaw: number; stage: number }[] = [
  { x: 0, z: 54.6, yaw: 0, stage: Stage.Landing },
  { x: 0, z: -45, yaw: 0, stage: Stage.Corridor },
  { x: 0, z: -101, yaw: 0, stage: Stage.Industrial },
  { x: 0, z: -146, yaw: 0, stage: Stage.Control },
  { x: 0, z: -171, yaw: 0, stage: Stage.Core },
];

type SpawnDef = [EnemyType, number, number, number?, [number, number][]?];

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

/**
 * 第一关「日蚀降临」：静态场景 + 门/终端/拾取物/爆炸桶 + 任务阶段状态机 + 遭遇战编排。
 */
export class Level {
  builder: LevelBuilder;
  stage: number = Stage.Landing;
  zone = 0;
  checkpoint = 0;
  /** 过场中敌人看不到玩家 */
  playerHidden = false;
  /** 当前可交互提示（HUD 显示），null 表示没有 */
  prompt: string | null = null;
  /** 任务导航点 */
  waypoint: THREE.Vector3 | null = null;
  /** 坚守进度 0..1（-1 表示未在坚守） */
  defenseProgress = -1;
  bossActive = false;
  completed = false;
  /** 由 Game 注入 */
  onCheckpoint: (index: number) => void = () => {};
  onVictory: () => void = () => {};

  private refs: GeometryRefs;
  private entityRoot = new THREE.Group();
  private doors: Record<'gate' | 'security' | 'lab' | 'labNorth' | 'hallNorth' | 'controlNorth' | 'arena' | 'closet' | 'sideW' | 'sideE', Door>;
  private interactables: Interactable[] = [];
  private pickups: Pickup[] = [];
  private barrels: Barrel[] = [];
  private targets: HoloTarget[] = [];
  private targetsLeft = 0;
  private flags = new Set<string>();
  private stageT = 0;
  private defenseT = 0;
  private powered = false;
  private alarmTarget = 0;
  private lastZone = -1;
  private ventT = 0;
  private wp = new THREE.Vector3();
  private objectiveKey = '';
  private hintT = 0;
  private active: Interactable | null = null;
  private arenaPickups: { kind: PickupKind; x: number; z: number; pickup: Pickup }[] = [];
  private resupplyT = 0;

  constructor(private ctx: Ctx) {
    this.builder = new LevelBuilder(ctx.gfx, ctx.physics, ctx.mats, ctx.nav);
    this.refs = buildGeometry(ctx, this.builder);
    ctx.gfx.scene.add(this.entityRoot);
    const D = (x: number, z: number, w: number, h: number, axis: 'x' | 'z'): Door => new Door(ctx, x, z, w, h, axis, true, this.entityRoot);
    this.doors = {
      gate: D(0, 11, 8, 5.5, 'x'),
      security: D(0, -40.5, 4, 3.4, 'x'),
      lab: D(0, -56.5, 4, 3.4, 'x'),
      labNorth: D(0, -97.5, 4, 3.4, 'x'),
      hallNorth: D(0, -142.5, 4, 3.4, 'x'),
      controlNorth: D(0, -167.5, 4, 3.4, 'x'),
      arena: D(0, ARENA.z + ARENA.r + 0.5, 4.5, 3.6, 'x'),
      closet: D(-22.5, -20, 3.4, 3.4, 'z'),
      sideW: D(-13.5, -155, 3, 3.2, 'z'),
      sideE: D(13.5, -155, 3, 3.2, 'z'),
    };
    ctx.nav.bake();
    ctx.physics.flush();
    this.interactables = [
      { id: 'gate', pos: new THREE.Vector3(5.2, 1.3, 13.1), radius: 2.6, prompt: '开启机库闸门', enabled: false, onUse: () => this.useGate() },
      { id: 'security', pos: new THREE.Vector3(2.9, 1.3, -39.3), radius: 2.6, prompt: '刷卡开启安全门', enabled: false, onUse: () => this.useSecurity() },
      { id: 'console', pos: new THREE.Vector3(0, 1.3, -152.2), radius: 2.8, prompt: '激活能源控制台', enabled: false, onUse: () => this.useConsole() },
    ];
  }

  // =================================================================================
  // 开始 / 重新开始
  // =================================================================================
  spawnPoint(cp: number): { x: number; z: number; yaw: number } {
    return CHECKPOINTS[Math.max(0, Math.min(CHECKPOINTS.length - 1, cp))];
  }

  /** 从指定存档点（重新）开始：重建全部动态实体并设置阶段。 */
  start(cp: number): void {
    const ctx = this.ctx;
    cp = Math.max(0, Math.min(CHECKPOINTS.length - 1, cp));
    this.checkpoint = cp;
    this.clearEntities();
    ctx.enemies.clear();
    ctx.projectiles.clear();
    ctx.fx.clear();
    this.flags.clear();
    this.stage = CHECKPOINTS[cp].stage;
    this.stageT = 0;
    this.defenseT = 0;
    this.resupplyT = 0;
    this.defenseProgress = -1;
    this.bossActive = false;
    this.completed = false;
    this.alarmTarget = 0;
    ctx.alarm = 0;
    this.lastZone = -1;
    this.objectiveKey = '';
    this.prompt = null;
    this.active = null;
    const st = this.stage;
    const d = this.doors;
    d.gate.reset(st < Stage.Hangar);
    d.security.reset(st < Stage.Corridor);
    d.lab.reset(false);
    d.labNorth.reset(st < Stage.Industrial);
    d.hallNorth.reset(st < Stage.Control);
    d.controlNorth.reset(st < Stage.Core);
    d.arena.reset(false);
    d.closet.reset(true);
    d.sideW.reset(true);
    d.sideE.reset(true);
    this.setPower(st >= Stage.Core);
    for (const it of this.interactables) it.enabled = false;
    this.interactables[2].enabled = st === Stage.Control;
    this.createPickups();
    this.createBarrels();
    // 遭遇战：生成"下一场"及之后需要预先存在的敌人
    if (st <= Stage.Hangar) {
      this.spawnTargets();
      this.spawnGroup('hangar', [
        ['sentry', 3, -3, Math.PI, [[-3, -2], [9, -2], [9, -18], [-3, -18]]],
        ['sentry', 12, -24, 0, [[13, -23], [-12, -23], [-12, -35], [13, -35]]],
        ['sentry', 0, -36.5, 0],
      ]);
    }
    if (st === Stage.Corridor) this.spawnLab();
    if (st === Stage.Industrial) this.spawnHall();
    ctx.enemies.spawn('boss', ARENA.x, ARENA.z, { yaw: 0 });
    if (st >= Stage.Hangar) ctx.player.hasKeycard = st >= Stage.SecDoor || ctx.player.hasKeycard;
    this.updateZone(true);
  }

  private clearEntities(): void {
    for (const p of this.pickups) p.dispose();
    for (const b of this.barrels) b.dispose();
    for (const t of this.targets) t.dispose();
    this.pickups.length = 0;
    this.barrels.length = 0;
    this.targets.length = 0;
  }

  private addPickup(kind: PickupKind, x: number, z: number, y = 0, secret = false): Pickup {
    const p = new Pickup(this.ctx, kind, x, y, z, this.entityRoot, secret);
    this.pickups.push(p);
    return p;
  }

  private createPickups(): void {
    const P = (kind: PickupKind, x: number, z: number, y = 0, secret = false): Pickup => this.addPickup(kind, x, z, y, secret);
    // 机库
    P('health', -18, -36);
    P('ammo_ar', 15, 6.5);
    P('ammo_ar', -17, -9);
    P('armor', 15.5, -34, 4.2);
    P('weapon_viper', 16.4, -34.2, 4.75);
    P('keycard', 20.5, -37.6, 4.2);
    P('ammo_viper', 19.5, -34, 4.2);
    P('armor', -27.5, -20, 0, true);
    // 安检通道
    P('ammo_ar', -2, -50);
    P('health', 2, -50);
    // 实验室
    P('weapon_helix', 16, -77, 0.75);
    P('ammo_ar', -16, -61);
    P('health', 17, -94);
    P('ammo_viper', -7, -95);
    P('health', -3, -59);
    P('armor', -18.6, -95.4, 0, true);
    P('ammo_ar', -18.6, -93.6);
    // 工业区
    P('health', 2, -104);
    P('ammo_ar', -2, -104);
    P('ammo_viper', 2, -107);
    P('health', -16, -140);
    P('ammo_ar', 16, -112);
    P('armor', 0, -126);
    P('ammo_viper', -16, -112.5);
    P('ammo_ar', 3, -139.5);
    // 控制室
    P('health', -11, -144.5);
    P('health', 11, -165.5);
    P('ammo_ar', 11, -144.5);
    P('ammo_ar', -11, -165.5);
    P('ammo_viper', -11.5, -151);
    P('armor', 11.5, -151);
    P('ammo_viper', 4.5, -165.5);
    // 核心通道
    P('health', -2, -172);
    P('armor', 2, -172);
    P('ammo_ar', -2, -176);
    P('ammo_ar', 2, -180);
    P('ammo_viper', 2, -176);
    P('health', -2, -180);
    // 竞技场外圈
    const ring: [PickupKind, number][] = [['ammo_viper', 25], ['health', 60], ['ammo_ar', 120], ['ammo_viper', 150], ['armor', 180], ['health', 210], ['ammo_ar', 240], ['health', 300], ['ammo_ar', 335]];
    this.arenaPickups = ring.map(([kind, deg]) => {
      const a = (deg * Math.PI) / 180;
      const x = ARENA.x + Math.sin(a) * 22.5;
      const z = ARENA.z + Math.cos(a) * 22.5;
      return { kind, x, z, pickup: P(kind, x, z) };
    });
    // 保底：错过实验室的 HELIX 时，核心通道的武器柜里还有一把（能量武器不耗弹药，保证 Boss 战不会弹尽粮绝）
    P('weapon_helix', -2, -178.2);
  }

  private createBarrels(): void {
    const spots: [number, number][] = [
      [6, -20], [7, -20.8], [-6, -33], [12, -9], [9, -58.6], [-9.5, -95.5],
      [-2.8, -132.4], [2.9, -133], [16, -130], [-16.5, -124], [8.5, -139.5], [-9, -112], [-12, -166], [12, -144.4],
    ];
    spots.forEach(([x, z], i) => this.barrels.push(new Barrel(this.ctx, i, x, z, this.entityRoot)));
  }

  private spawnTargets(): void {
    const spots: [number, number, number][] = [[-7, 1.7, 18.5], [-10, 2.4, 24], [8, 1.6, 19.5]];
    spots.forEach(([x, y, z], i) => this.targets.push(new HoloTarget(this.ctx, 1000 + i, x, y, z, this.entityRoot)));
    this.targetsLeft = spots.length;
  }

  private spawnGroup(encounter: string, defs: SpawnDef[], alerted = false, warpIn = false): Enemy[] {
    return defs.map(([type, x, z, yaw, patrol]) => this.ctx.enemies.spawn(type, x, z, { yaw: yaw ?? 0, patrol, encounter, alerted, warpIn }));
  }

  private spawnLab(): void {
    this.spawnGroup('lab', [
      ['sentry', -6, -62, 0, [[-7, -60], [7, -60], [7, -94], [-7, -94]]],
      ['sentry', -15, -84, 0],
      ['sentry', 15.5, -62, 0],
      ['stalker', 14, -90, 0],
      ['stalker', -15, -66, 0],
    ]);
  }

  private spawnHall(): void {
    this.spawnGroup('hall', [
      ['juggernaut', 0, -134, 0],
      ['sentry', -14.5, -126, 0, [[-15, -116], [-15, -136]]],
      ['sentry', 15, -118, 0, [[15, -113], [15, -133]]],
      ['stalker', 12, -139, 0],
    ]);
  }

  // =================================================================================
  // 查询 / 外部接口
  // =================================================================================
  zoneAt(z: number): number {
    if (z > 11) return 0;
    if (z > -40.5) return 1;
    if (z > -56.5) return 2;
    if (z > -97.5) return 3;
    if (z > -142.5) return 4;
    if (z > -167.5) return 5;
    if (z > -183.5) return 6;
    return 7;
  }

  damageBarrel(id: number, damage: number): void {
    this.barrels[id]?.damage(damage);
  }

  damageBarrelsNear(pos: THREE.Vector3, radius: number, damage: number): void {
    for (const b of this.barrels) {
      if (b.dead) continue;
      if (dist2D(b.x, b.z, pos.x, pos.z) < radius + 0.4) b.damage(damage, rand(0.12, 0.3));
    }
  }

  hitProp(id: number, damage: number, _point: THREE.Vector3): void {
    const t = this.targets[id - 1000];
    if (t && t.hit(damage)) {
      this.targetsLeft--;
      this.ctx.stats.kills += 0;
    }
  }

  onEnemyKilled(e: Enemy): void {
    const ctx = this.ctx;
    if (e.type === 'boss') return;
    const needHealth = ctx.player.health < 45;
    const r = Math.random();
    let kind: PickupKind | null = null;
    if (e.type === 'juggernaut') {
      this.drop('armor', e.pos.x + 0.8, e.pos.z);
      this.drop('health', e.pos.x - 0.8, e.pos.z);
      kind = 'ammo';
    } else if (e.encounter === 'boss-minion') {
      kind = r < (needHealth ? 0.4 : 0.2) ? 'health' : r < 0.7 ? 'ammo' : null;
    } else if (e.type === 'wasp') {
      kind = r < 0.3 ? 'ammo' : r < (needHealth ? 0.6 : 0.4) ? 'health' : null;
    } else {
      kind = r < (needHealth ? 0.34 : 0.16) ? 'health' : r < 0.68 ? 'ammo' : null;
    }
    if (kind) this.drop(kind, e.pos.x, e.pos.z);
  }

  private drop(kind: PickupKind, x: number, z: number): void {
    const p = this.ctx.nav.nearestWalkable(x, z, 0.3, 3, _a);
    const pk = this.addPickup(kind, p ? p.x : x, p ? p.z : z);
    pk.ttl = 40;
  }

  private has(flag: string): boolean {
    return this.flags.has(flag);
  }
  /** 第一次调用返回 true */
  private once(flag: string): boolean {
    if (this.flags.has(flag)) return false;
    this.flags.add(flag);
    return true;
  }

  private setStage(s: number): void {
    if (s <= this.stage) return;
    this.stage = s;
    this.stageT = 0;
    this.ctx.audio.objective();
    this.ctx.hud.clearHint();
  }

  private saveCheckpoint(i: number): void {
    if (i <= this.checkpoint) return;
    this.checkpoint = i;
    this.onCheckpoint(i);
    this.ctx.audio.checkpoint();
    this.ctx.hud.banner('检查点已保存', ZONE_NAMES[this.zone]);
  }

  private setPower(on: boolean): void {
    this.powered = on;
    this.refs.powerMat.color.setHex(0x35e0ff).multiplyScalar(on ? 2.4 : 0.12);
    this.lastZone = -1; // 触发灯位刷新
  }

  // =================================================================================
  // 交互
  // =================================================================================
  private useGate(): void {
    const ctx = this.ctx;
    this.interactables[0].enabled = false;
    this.doors.gate.setLocked(false);
    ctx.audio.terminal(true);
    ctx.hud.subtitle('指挥部', '闸门已解锁。机库内探测到多个敌对信号——保持警惕，游骑兵。');
    this.setStage(Stage.Hangar);
  }

  private useSecurity(): void {
    const ctx = this.ctx;
    if (!ctx.player.hasKeycard) {
      ctx.audio.doorDenied(this.interactables[1].pos);
      ctx.hud.toast('拒绝访问 — 需要 A 级门禁卡');
      if (this.once('denied')) ctx.hud.subtitle('指挥部', '安全门需要 A 级门禁卡。扫描显示东侧高架控制室里有一张。');
      return;
    }
    this.interactables[1].enabled = false;
    this.doors.security.setLocked(false);
    ctx.audio.terminal(true);
    ctx.hud.subtitle('指挥部', '权限确认。前方是研究区——基地的防御 AI 就是在那里失控的。');
    this.spawnLab();
    this.setStage(Stage.Corridor);
  }

  private useConsole(): void {
    const ctx = this.ctx;
    this.interactables[2].enabled = false;
    ctx.audio.terminal(true);
    ctx.hud.subtitle('OMEGA', '检测到未授权的能源重启。部署全部防御单位。');
    this.defenseT = 0;
    this.defenseProgress = 0;
    this.doors.sideW.setLocked(false, true);
    this.doors.sideE.setLocked(false, true);
    this.alarmTarget = 1;
    this.setStage(Stage.Defense);
  }

  private updateInteraction(): void {
    const ctx = this.ctx;
    const player = ctx.player;
    let best: Interactable | null = null;
    let bestD = 1e9;
    if (player.alive && player.controlEnabled) {
      player.eyePos(_a);
      ctx.gfx.camera.getWorldDirection(_b);
      for (const it of this.interactables) {
        if (!it.enabled) continue;
        const dx = it.pos.x - _a.x;
        const dy = it.pos.y - _a.y;
        const dz = it.pos.z - _a.z;
        const d = Math.hypot(dx, dy, dz);
        if (d > it.radius) continue;
        const dot = (dx * _b.x + dy * _b.y + dz * _b.z) / Math.max(0.01, d);
        if (dot < 0.55 && d > 1.0) continue;
        if (d < bestD) {
          bestD = d;
          best = it;
        }
      }
    }
    this.active = best;
    this.prompt = best ? best.prompt : null;
    if (best && ctx.input.wasPressed('KeyE')) best.onUse();
  }

  /** 测试钩子：直接触发当前可用的交互 */
  interact(id: string): boolean {
    const it = this.interactables.find((x) => x.id === id);
    if (!it || !it.enabled) return false;
    it.onUse();
    return true;
  }

  // =================================================================================
  // 主更新
  // =================================================================================
  private updateZone(force = false): void {
    const ctx = this.ctx;
    const z = this.zoneAt(ctx.player.pos.z);
    this.zone = z;
    ctx.player.zone = z;
    if (z === this.lastZone && !force) return;
    const first = this.lastZone < 0;
    this.lastZone = z;
    if (force) ctx.gfx.applyEnvImmediate(ENV[z]);
    else ctx.gfx.envTarget = ENV[z];
    ctx.audio.setAmbient(AMBIENT[z]);
    // 分区可见性剔除与灯位开关：只保留当前与相邻分区
    this.builder.zoneGroups.forEach((g, i) => {
      if (g) g.visible = Math.abs(i - z) <= 1;
    });
    const power = new Set(this.refs.powerSockets);
    const emergency = new Set(this.refs.emergencySockets);
    for (const s of ctx.gfx.lights.sockets) {
      let on = Math.abs(s.zone - z) <= 1;
      if (power.has(s)) on = on && this.powered;
      else if (emergency.has(s)) on = on && !this.powered;
      s.enabled = on;
    }
    if (!first && !force) ctx.hud.zoneName(ZONE_NAMES[z]);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const pz = player.pos.z;
    const en = ctx.enemies;
    this.stageT += dt;
    this.updateZone();
    for (const k in this.doors) this.doors[k as keyof Level['doors']].update(dt);
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
      p.update(dt);
      if (p.taken) {
        p.dispose();
        this.pickups.splice(i, 1);
      }
    }
    for (const b of this.barrels) b.update(dt);
    for (const t of this.targets) t.update(dt);
    for (const s of this.refs.spinners) s.rotation.y += dt * 0.35;
    this.updateInteraction();

    // 工业区蒸汽
    if (this.zone === 4) {
      this.ventT -= dt;
      if (this.ventT <= 0) {
        this.ventT = 0.09;
        const v = this.refs.vents[Math.floor(Math.random() * this.refs.vents.length)];
        if (Math.sin(ctx.time * 0.9 + v.x) > -0.2) ctx.fx.smoke(v, 1, 0.5, { life: 1.6, alpha: 0.22, rise: 1.6, spread: 0.25, color: 0xd8d0c8 });
      }
    }

    // ---------- 阶段状态机 ----------
    switch (this.stage) {
      case Stage.Landing:
        if (this.stageT > 1.2 && this.once('s0')) ctx.hud.subtitle('指挥部', '游骑兵，你已抵达日蚀站外围。基地在 72 小时前失联。先去靶场校准武器。');
        if (this.stageT > 3 && this.once('h-move')) ctx.hud.hint('WASD 移动 · 鼠标瞄准 · Shift 冲刺 · Space 跳跃 · Ctrl 蹲伏（冲刺中按下为滑铲）');
        if (pz < 38) this.setStage(Stage.Range);
        break;
      case Stage.Range:
        if (this.once('h-shoot')) ctx.hud.hint('左键射击 · 右键瞄准 · R 换弹 — 击毁前方 3 个全息靶标');
        if (this.targetsLeft <= 0) {
          this.interactables[0].enabled = true;
          this.setStage(Stage.Gate);
        }
        break;
      case Stage.Gate:
        if (this.once('h-gate')) {
          ctx.hud.hint('靠近闸门右侧的终端，按 E 交互');
          ctx.hud.subtitle('指挥部', '武器校准完成。用闸门旁的终端打开机库。');
        }
        this.interactables[0].enabled = true;
        break;
      case Stage.Hangar:
        this.interactables[1].enabled = true;
        if (pz < 6 && this.once('s-hangar')) ctx.hud.subtitle('指挥部', '哨兵机器人在巡逻。它们的传感器呈琥珀色时还没发现你——红色就是开火。');
        if (player.hasKeycard) this.setStage(Stage.SecDoor);
        break;
      case Stage.SecDoor:
        this.interactables[1].enabled = true;
        break;
      case Stage.Corridor:
        if (pz < -44) this.saveCheckpoint(1);
        if (pz < -58.5) {
          this.setStage(Stage.Lab);
          ctx.hud.subtitle('指挥部', '注意猎手型机器人：它们会躲在掩体后用磁轨步枪狙击。看到红色激光就立刻横移。');
        }
        break;
      case Stage.Lab: {
        const left = en.aliveCount('lab');
        if (!this.has('lab2') && left <= 1 && this.stageT > 2) {
          this.flags.add('lab2');
          this.doors.labNorth.setLocked(false, true);
          this.spawnGroup('lab', [['sentry', -1.5, -101, 0], ['sentry', 1.5, -103, 0], ['stalker', 0, -106, 0]], true);
          this.alarmTarget = 1;
          ctx.hud.subtitle('OMEGA', '入侵者位于研究区。增援单位已派出。');
        }
        if (this.has('lab2') && left === 0) {
          this.alarmTarget = 0;
          this.spawnHall();
          this.setStage(Stage.Industrial);
          ctx.hud.subtitle('指挥部', '实验室已肃清。北门通向工业区——能源控制室就在它后面。');
        }
        break;
      }
      case Stage.Industrial:
        if (pz < -100) this.saveCheckpoint(2);
        if (pz < -111.5) {
          this.setStage(Stage.Hall);
          en.engageEncounter('hall');
          ctx.hud.subtitle('指挥部', '重型装甲单位！正面装甲几乎打不穿——绕到背后攻击它的反应堆，或者引爆油桶。');
        }
        break;
      case Stage.Hall: {
        const left = en.aliveCount('hall');
        if (!this.has('hall2') && left <= 1 && this.stageT > 2) {
          this.flags.add('hall2');
          this.spawnGroup('hall', [['wasp', -8, -116, 0], ['wasp', 8, -116, 0], ['wasp', 0, -138, 0]], true, true);
          ctx.hud.subtitle('指挥部', '无人机群！它们很脆，但别让它们包围你。');
        }
        if (this.has('hall2') && left === 0) {
          this.doors.hallNorth.setLocked(false);
          this.interactables[2].enabled = true;
          this.setStage(Stage.Control);
          ctx.hud.subtitle('指挥部', '大厅已肃清。进入控制室，重启基地能源，我们才能打开核心区的大门。');
        }
        break;
      }
      case Stage.Control:
        this.interactables[2].enabled = true;
        if (pz < -145) this.saveCheckpoint(3);
        break;
      case Stage.Defense:
        this.updateDefense(dt);
        break;
      case Stage.Core:
        if (pz < -170) this.saveCheckpoint(4);
        if (pz < -173 && this.once('s-core')) ctx.hud.subtitle('OMEGA', '你无权进入中央核心。OMEGA-01 守卫协议——启动。');
        if (pz < -189) {
          this.doors.arena.seal();
          this.bossActive = true;
          this.alarmTarget = 0.6;
          en.boss?.activate();
          this.setStage(Stage.Boss);
          ctx.hud.hint('攻击 OMEGA-01 发光的核心 · 用立柱躲避光束 · 跳跃躲避冲击波');
        }
        break;
      case Stage.Boss: {
        const boss = en.boss;
        // 竞技场外圈补给每 40 秒重生一次
        this.resupplyT += dt;
        if (this.resupplyT >= 40 && boss && boss.alive) {
          this.resupplyT = 0;
          let n = 0;
          for (const ap of this.arenaPickups) {
            if (!ap.pickup.taken) continue;
            ap.pickup = this.addPickup(ap.kind, ap.x, ap.z);
            n++;
          }
          if (n > 0) ctx.hud.toast('竞技场补给已重新投放');
        }
        if (boss && !boss.alive && this.once('boss-dying')) {
          this.alarmTarget = 0;
          ctx.hud.subtitle('指挥部', '核心正在崩溃——干得漂亮，游骑兵！');
        }
        if (boss && boss.deathDone) {
          this.bossActive = false;
          this.setStage(Stage.Victory);
          this.completed = true;
          this.onVictory();
        }
        break;
      }
    }
    // 拿到门禁卡 → 伏击（与阶段无关，只触发一次）
    if (player.hasKeycard && this.stage <= Stage.SecDoor && this.once('ambush')) {
      this.doors.closet.setLocked(false, true);
      this.spawnGroup('hangar', [['sentry', -26, -20, Math.PI / 2], ['sentry', -27.5, -21.5, Math.PI / 2], ['stalker', -27.5, -18.5, Math.PI / 2]], true);
      this.alarmTarget = 1;
      ctx.hud.subtitle('OMEGA', '检测到门禁卡被未授权人员取走。封锁机库。');
    }
    if (this.has('ambush') && this.stage <= Stage.SecDoor && this.alarmTarget > 0 && en.aliveCount('hangar') === 0) this.alarmTarget = 0;

    ctx.alarm = damp(ctx.alarm, this.alarmTarget, 2, dt);
    ctx.audio.setAlarm(ctx.alarm);
    this.updateObjective();
  }

  private updateDefense(dt: number): void {
    const ctx = this.ctx;
    const en = ctx.enemies;
    const DURATION = 60;
    this.defenseT += dt;
    this.defenseProgress = Math.min(1, this.defenseT / DURATION);
    const W: SpawnDef[] = [['sentry', -17, -155], ['sentry', -18, -153.6], ['sentry', -18, -156.4]];
    const E: SpawnDef[] = [['sentry', 17, -155], ['stalker', 18, -153.6], ['stalker', 18, -156.4]];
    if (this.defenseT > 2 && this.once('d1')) {
      this.spawnGroup('defense', [W[0], W[1], E[0]], true);
    }
    if (this.defenseT > 22 && this.once('d2')) {
      this.spawnGroup('defense', [E[1], E[2], W[2]], true);
      this.spawnGroup('defense', [['wasp', -6, -148], ['wasp', 6, -162]], true, true);
      ctx.hud.subtitle('指挥部', '能源重启 35%。坚持住！');
    }
    if (this.defenseT > 42 && this.once('d3')) {
      this.spawnGroup('defense', [['juggernaut', -17.5, -155], E[0], ['sentry', 18, -156.4]], true);
      this.spawnGroup('defense', [['wasp', 6, -148], ['wasp', -6, -162]], true, true);
      ctx.hud.subtitle('指挥部', '重型单位进场！再撑 20 秒，EMP 就能充能完毕。');
    }
    if (this.defenseT >= DURATION) {
      // 能源恢复：EMP 清场
      this.defenseProgress = -1;
      this.setPower(true);
      _a.set(0, 2.5, -155);
      ctx.fx.ring(_a, 0x35e0ff, 1, 34, 0.9, UPV, 1);
      ctx.fx.ring(_a, 0xdcecff, 1, 26, 0.6, null, 1);
      ctx.fx.energyBurst(_a, 0x35e0ff, 40, 16, 0.25, 1);
      ctx.gfx.flashLight(_a, 0x35e0ff, 300, 40, 0.9);
      ctx.gfx.fx.flash = Math.max(ctx.gfx.fx.flash, 0.7);
      ctx.audio.explosion(_a, 1.4);
      ctx.audio.terminal(true);
      ctx.shake(null, 0.6);
      en.killAll('defense');
      this.alarmTarget = 0;
      this.doors.controlNorth.setLocked(false);
      this.doors.sideW.setLocked(true, true);
      this.doors.sideE.setLocked(true, true);
      this.setStage(Stage.Core);
      ctx.hud.subtitle('指挥部', '能源已恢复，EMP 清除了所有单位。核心区大门已开启——去关掉 OMEGA。');
    }
  }

  /** 根据阶段刷新 HUD 目标与导航点 */
  private updateObjective(): void {
    const ctx = this.ctx;
    const en = ctx.enemies;
    let title = '';
    let detail = '';
    let wp: [number, number, number] | null = null;
    switch (this.stage) {
      case Stage.Landing:
        title = '前往基地外的靶场';
        wp = [0, 1.4, 36];
        break;
      case Stage.Range:
        title = `击毁校准靶标 (${3 - this.targetsLeft}/3)`;
        break;
      case Stage.Gate:
        title = '使用终端开启机库闸门';
        wp = [5.2, 1.6, 12.9];
        break;
      case Stage.Hangar:
        title = '找到 A 级门禁卡';
        detail = '东侧楼梯 → 高架控制室';
        wp = this.zone === 0 ? [0, 2, 9] : [20.5, 5.2, -37.6];
        break;
      case Stage.SecDoor:
        title = '使用门禁卡开启北侧安全门';
        detail = en.aliveCount('hangar') > 0 ? `机库内剩余敌人：${en.aliveCount('hangar')}` : '';
        wp = [2.9, 1.6, -39.4];
        break;
      case Stage.Corridor:
        title = '前往研究实验室';
        wp = [0, 1.6, -57];
        break;
      case Stage.Lab:
        title = '肃清研究实验室';
        detail = `剩余敌人：${en.aliveCount('lab')}` + (ctx.weapons.state.helix.owned ? '' : ' · 东翼有原型武器');
        break;
      case Stage.Industrial:
        title = '穿过工业区';
        wp = [0, 1.6, -110];
        break;
      case Stage.Hall:
        title = '肃清机械大厅';
        detail = `剩余敌人：${en.aliveCount('hall')}`;
        break;
      case Stage.Control:
        title = '激活能源控制台';
        wp = [0, 1.6, -152.6];
        break;
      case Stage.Defense:
        title = '坚守控制室';
        detail = `能源重启 ${Math.floor(Math.max(0, this.defenseProgress) * 100)}%`;
        break;
      case Stage.Core:
        title = '进入中央核心';
        wp = [0, 1.8, -184];
        break;
      case Stage.Boss:
        title = '摧毁 OMEGA-01';
        detail = '攻击发光的核心';
        break;
      case Stage.Victory:
        title = '任务完成';
        break;
    }
    this.waypoint = wp ? this.wp.set(wp[0], wp[1], wp[2]) : null;
    const key = title + '|' + detail;
    if (key !== this.objectiveKey) {
      const titleChanged = key.split('|')[0] !== this.objectiveKey.split('|')[0];
      this.objectiveKey = key;
      ctx.hud.setObjective(title, detail, titleChanged);
    }
  }

  dispose(): void {
    this.clearEntities();
    for (const k in this.doors) this.doors[k as keyof Level['doors']].dispose();
    this.ctx.gfx.scene.remove(this.entityRoot);
    this.ctx.gfx.lights.clearSockets();
    this.builder.dispose();
    disposeEntityGeometry();
  }
}
