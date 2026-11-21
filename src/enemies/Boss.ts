import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp, dist2D, pick, rand, randSign, turnToward } from '../core/math';
import { QUERY } from '../physics/Physics';
import { DamageSource, Enemy, EnemySpawnOpts, HitPart } from './Enemy';

export type BossMode = 'dormant' | 'intro' | 'idle' | 'orbs' | 'slam' | 'summon' | 'beam' | 'transition' | 'dying';
type AttackMode = 'orbs' | 'slam' | 'summon' | 'beam';

interface Wave {
  mesh: THREE.Mesh;
  r: number;
  active: boolean;
  hit: boolean;
  delay: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _d = new THREE.Vector3();
const _col = new THREE.Color();
const UPV = new THREE.Vector3(0, 1, 0);
const WHITE = new THREE.Color(5, 5, 5);
const RED = 0xff2d2d;
const ORANGE = 0xff6a1a;
const WAVE_SPEED = 15;
const WAVE_MAX = 28;
const SLAM_RADIUS = 8;

/**
 * OMEGA-01 —— 基地中央 AI 的重型机械守卫。
 *
 * 攻击机制（每种都有明显预警，并在收招时暴露核心作为输出窗口）：
 *  1. 追踪能量球：肩炮蓄能 → 连发缓速追踪球。可绕立柱让其撞毁。
 *  2. 地面冲击：抬身蓄力（红色警示圈）→ 砸地，近身范围伤害 + 向外扩散的冲击波，需要跳跃躲避。
 *  3. 召唤无人机：腹舱开启，传送黄蜂（三阶段追加哨兵）。
 *  4. 扫射光束（二阶段解锁）：核心蓄能并显示瞄准线 → 横扫 110°，必须躲到立柱后。
 * 阶段：100%→66% 一阶段；66%→33% 二阶段（解锁光束、双重冲击波、节奏加快）；
 *       <33% 三阶段（核心常开、三重冲击波、砸地后接能量球连招）。
 */
export class Boss extends Enemy {
  mode: BossMode = 'dormant';
  phase = 1;
  /** 死亡演出是否播放完毕（关卡据此触发胜利） */
  deathDone = false;
  private modeT = 0;
  private step = 0;
  private lastAttack: AttackMode | null = null;
  private combo: AttackMode | null = null;
  private summonT = 14;
  private gap = 2.2;
  private arena = new THREE.Vector3();
  private openAmt = 0;
  private openTarget = 0;
  private bodyLift = -1.4;
  private liftTarget = -1.4;
  private cannonGlow = 0;
  private bellyGlow = 0;
  private waves: Wave[] = [];
  private waveGeo: THREE.PlaneGeometry;
  private waveMat: THREE.MeshBasicMaterial;
  private warn: THREE.Mesh;
  private warnMat: THREE.MeshBasicMaterial;
  private beamYaw = 0;
  private beamDir = 1;
  private beamPitch = 0;
  private beamTick = 0;
  private fxT = 0;
  private shots = 0;
  private dyingT = 0;
  private boomT = 0;

  constructor(ctx: Ctx, x: number, z: number, opts?: EnemySpawnOpts) {
    super(ctx, 'boss', { hp: 4200, speed: 1.5, turn: 0.9, sight: 90, fovDeg: 360, navRadius: 3, reaction: 0, staggerAt: 0 }, x, z, opts);
    this.arena.set(x, 0, z);
    this.state = 'idle';
    this.addBall('body', 2.5, 0, 3.3, 0);
    this.addBall('body', 0.9, -2.3, 4.7, 0.7);
    this.addBall('body', 0.9, 2.3, 4.7, 0.7);
    this.addBall('weak', 0.78, 0, 3.9, 1.95);
    for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      this.addCapsule('armor', 0.6, 0, 3.4, Math.sin(a) * 4.9, Math.cos(a) * 4.9);
    }
    // 冲击波与警示圈（自有网格：需要精确、线性的半径以匹配伤害判定）
    this.waveGeo = new THREE.PlaneGeometry(2, 2);
    this.waveGeo.rotateX(-Math.PI / 2);
    this.waveMat = new THREE.MeshBasicMaterial({ map: ctx.mats.tex.ring, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false, side: THREE.DoubleSide });
    this.waveMat.color.setHex(ORANGE).multiplyScalar(2.6);
    for (let i = 0; i < 3; i++) {
      const mesh = new THREE.Mesh(this.waveGeo, this.waveMat);
      mesh.visible = false;
      mesh.renderOrder = 12;
      ctx.gfx.scene.add(mesh);
      this.waves.push({ mesh, r: 0, active: false, hit: false, delay: 0 });
    }
    this.warnMat = this.waveMat.clone();
    this.warnMat.color.setHex(RED).multiplyScalar(2.4);
    this.warn = new THREE.Mesh(this.waveGeo, this.warnMat);
    this.warn.visible = false;
    this.warn.renderOrder = 12;
    ctx.gfx.scene.add(this.warn);
    this.rig.eyeMat.color.setScalar(0.02);
    this.syncTransform();
  }

  get coreOpen(): boolean {
    return this.openAmt > 0.5;
  }
  get fighting(): boolean {
    return this.alive && this.mode !== 'dormant' && this.mode !== 'intro';
  }

  /** 由关卡触发：启动 Boss */
  activate(): void {
    if (this.mode !== 'dormant') return;
    this.setMode('intro');
    this.liftTarget = 0;
    this.ctx.audio.servo(this.pos);
  }

  override engage(): void {}
  override hear(): void {}
  override stun(): void {}
  protected override combat(): void {}

  private setMode(m: BossMode): void {
    this.mode = m;
    this.modeT = 0;
    this.step = 0;
    this.shots = 0;
  }

  private corePos(out: THREE.Vector3): THREE.Vector3 {
    return this.muzzlePos(out);
  }

  // ---------- 伤害 ----------
  protected override modifyDamage(part: HitPart, damage: number, _dir: THREE.Vector3, _source: DamageSource): { damage: number; armor: boolean; crit: boolean } {
    if (this.mode === 'dormant' || this.mode === 'intro' || this.mode === 'transition') return { damage: 0, armor: true, crit: false };
    let r: { damage: number; armor: boolean; crit: boolean };
    if (part === 'weak') r = this.coreOpen ? { damage: damage * 2.5, armor: false, crit: true } : { damage: damage * 0.3, armor: true, crit: false };
    else if (part === 'armor') r = { damage: damage * 0.25, armor: true, crit: false };
    else r = { damage: damage * 0.5, armor: true, crit: false };
    // 不允许一次伤害跨过阶段阈值
    const next = this.phase === 1 ? this.maxHp * 0.66 : this.phase === 2 ? this.maxHp * 0.33 : -1e9;
    if (this.hp - r.damage < next) r.damage = Math.max(0, this.hp - next + 0.01);
    return r;
  }

  protected override onDamaged(): void {
    const ctx = this.ctx;
    const frac = this.hp / this.maxHp;
    if ((this.phase === 1 && frac <= 0.661) || (this.phase === 2 && frac <= 0.331)) {
      this.phase++;
      this.setMode('transition');
      this.openTarget = 0;
      this.liftTarget = -0.7;
      for (const w of this.waves) {
        w.active = false;
        w.mesh.visible = false;
      }
      this.warn.visible = false;
      ctx.audio.bossRoar(this.pos);
      ctx.shake(null, 0.8);
      ctx.hud.bossPhase(this.phase);
      ctx.projectiles.clear();
    }
  }

  protected override die(): void {
    const ctx = this.ctx;
    this.alive = false;
    this.state = 'dead';
    this.setMode('dying');
    this.dyingT = 0;
    for (const p of this.parts) ctx.physics.removeCollider(p.collider);
    this.parts.length = 0;
    for (const w of this.waves) {
      w.active = false;
      w.mesh.visible = false;
    }
    this.warn.visible = false;
    ctx.projectiles.clear();
    ctx.stats.kills++;
    ctx.audio.bossRoar(this.pos);
    ctx.enemies.onDeath(this);
  }

  // ---------- 主循环 ----------
  override update(dt: number): void {
    const ctx = this.ctx;
    if (!this.alive) {
      this.updateDying(dt);
      return;
    }
    this.stateTime += dt;
    this.modeT += dt;
    this.moveSpeed = 0;
    if (this.mode !== 'dormant') this.perceive(dt);
    const player = ctx.player;
    const p3 = this.phase >= 3;

    switch (this.mode) {
      case 'dormant':
        break;
      case 'intro': {
        if (this.step === 0 && this.modeT > 1.2) {
          this.step = 1;
          ctx.audio.bossRoar(this.pos);
          ctx.shake(null, 0.7);
          this.openTarget = 1;
        }
        if (this.modeT > 3.2) {
          this.state = 'chase';
          this.openTarget = 0;
          this.setMode('idle');
          this.gap = 1.2;
        }
        break;
      }
      case 'idle': {
        this.openTarget = p3 ? 1 : 0;
        this.liftTarget = 0;
        this.roam(dt);
        this.summonT -= dt;
        if (this.modeT > this.gap) this.startAttack(this.chooseAttack());
        break;
      }
      case 'orbs':
        this.updateOrbs(dt);
        break;
      case 'slam':
        this.updateSlam(dt);
        break;
      case 'summon':
        this.updateSummon(dt);
        break;
      case 'beam':
        this.updateBeam(dt);
        break;
      case 'transition': {
        // 阶段转换：短暂瘫痪 + 连环爆炸，随后以召唤开场
        this.boomT -= dt;
        if (this.boomT <= 0) {
          this.boomT = 0.22;
          _a.set(this.pos.x + rand(-2.5, 2.5), rand(2.2, 5), this.pos.z + rand(-2.5, 2.5));
          ctx.fx.explosion(_a, rand(1, 1.8), ORANGE, false);
          ctx.audio.explosion(_a, 0.6);
        }
        if (this.modeT > 1.6) this.liftTarget = 0;
        if (this.modeT > 2.6) {
          this.summonT = 0;
          this.setMode('idle');
          this.gap = 0.4;
          ctx.audio.bossRoar(this.pos);
        }
        break;
      }
    }
    this.updateWaves(dt);
    this.animateBoss(dt);
    this.syncTransform();
    // 玩家贴得太近时把他推开（防止钻到机体下面）
    const d = this.dist;
    if (d < this.radius + 0.6 && player.alive) {
      const k = (this.radius + 0.6 - d) * 14;
      const l = Math.max(0.2, d);
      player.vel.x += ((player.pos.x - this.pos.x) / l) * k * dt * 10;
      player.vel.z += ((player.pos.z - this.pos.z) / l) * k * dt * 10;
    }
  }

  private gapFor(): number {
    return this.phase === 1 ? rand(2.0, 2.6) : this.phase === 2 ? rand(1.4, 1.9) : rand(0.8, 1.2);
  }

  private chooseAttack(): AttackMode {
    if (this.combo) {
      const c = this.combo;
      this.combo = null;
      return c;
    }
    const cap = this.phase === 1 ? 2 : this.phase === 2 ? 3 : 4;
    if (this.summonT <= 0 && this.ctx.enemies.minionCount() < cap) return 'summon';
    if (this.dist < 9 && this.lastAttack !== 'slam') return 'slam';
    const options: AttackMode[] = ['orbs', 'orbs', 'slam'];
    if (this.phase >= 2) options.push('beam', 'beam');
    const filtered = options.filter((o) => o !== this.lastAttack);
    return pick(filtered.length ? filtered : options);
  }

  private startAttack(a: AttackMode): void {
    const ctx = this.ctx;
    this.lastAttack = a;
    this.setMode(a);
    if (a === 'orbs') ctx.audio.enemyCharge(this.pos, 0.9, 0.7);
    else if (a === 'slam') {
      ctx.audio.bossRoar(this.pos);
      this.liftTarget = 1.1;
    } else if (a === 'summon') {
      ctx.audio.servo(this.pos);
      ctx.audio.enemyAlert(this.pos, 0.45);
      ctx.hud.subtitle('OMEGA-01', '部署防御无人机。');
    } else {
      ctx.audio.enemyCharge(this.pos, 1.3, 0.4);
      this.beamDir = randSign();
      const toPlayer = Math.atan2(ctx.player.pos.x - this.pos.x, ctx.player.pos.z - this.pos.z);
      this.beamYaw = toPlayer - this.beamDir * 0.96;
      this.corePos(_a);
      this.beamPitch = Math.atan2(1.0 - _a.y, Math.max(7, this.dist - 2));
    }
  }

  private endAttack(): void {
    this.setMode('idle');
    this.gap = this.gapFor();
    this.cannonGlow = 0;
    this.bellyGlow = 0;
  }

  /** 空闲时缓慢朝玩家方向踱步，保持在竞技场中心附近 */
  private roam(dt: number): void {
    const player = this.ctx.player;
    this.faceTo(player.pos.x, player.pos.z, dt, this.stats.turn * (this.phase >= 3 ? 1.5 : 1));
    const dx = player.pos.x - this.arena.x;
    const dz = player.pos.z - this.arena.z;
    const d = Math.hypot(dx, dz) || 1;
    const reach = Math.min(6, d * 0.3);
    const tx = this.arena.x + (dx / d) * reach;
    const tz = this.arena.z + (dz / d) * reach;
    const mx = tx - this.pos.x;
    const mz = tz - this.pos.z;
    const md = Math.hypot(mx, mz);
    if (md > 0.6 && this.dist > 8) {
      const sp = this.stats.speed * (this.phase >= 3 ? 1.4 : 1);
      this.pos.x += (mx / md) * sp * dt;
      this.pos.z += (mz / md) * sp * dt;
      this.moveSpeed = sp;
    }
  }

  // ---------- 攻击 1：追踪能量球 ----------
  private updateOrbs(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const p = this.phase;
    this.openTarget = 1;
    this.faceTo(player.pos.x, player.pos.z, dt, 1.4);
    const wind = p === 3 ? 0.6 : 0.9;
    if (this.step === 0) {
      this.cannonGlow = this.modeT / wind;
      if (this.modeT >= wind) {
        this.step = 1;
        this.modeT = 0;
      }
    } else if (this.step === 1) {
      const count = p === 1 ? 3 : p === 2 ? 4 : 6;
      const interval = p === 1 ? 0.5 : p === 2 ? 0.4 : 0.28;
      if (this.modeT >= this.shots * interval) {
        const cannon = this.rig.extra[this.shots % 2];
        this.rig.root.updateMatrixWorld(true);
        cannon.localToWorld(_a.set(0, 0, 2.1));
        _b.set(player.pos.x - _a.x, player.pos.y + 1 - _a.y + 2.5, player.pos.z - _a.z).normalize();
        ctx.projectiles.spawn({
          owner: 'enemy', kind: 'orb', pos: _a, dir: _b, speed: p === 1 ? 12 : p === 2 ? 13.5 : 15, damage: 14, color: 0xff4a2a, size: 0.34,
          life: 5.5, homing: p === 1 ? 1.4 : p === 2 ? 1.7 : 2.0, splash: 2.4, splashDamage: 10,
        });
        ctx.fx.flash(_a, 0xff6a2a, 3.2, 0.12);
        ctx.fx.energyBurst(_a, 0xff6a2a, 8, 5, 0.16, 0.35);
        ctx.gfx.flashLight(_a, 0xff5a2a, 60, 14, 0.2);
        ctx.audio.enemyShot(_a, 'mortar');
        this.flinch.impulse(0.6);
        this.shots++;
        if (this.shots >= count) {
          this.step = 2;
          this.modeT = 0;
        }
      }
      this.cannonGlow = 1;
    } else {
      this.cannonGlow = damp(this.cannonGlow, 0, 4, dt);
      if (this.modeT > (p === 3 ? 0.6 : 1.0)) this.endAttack();
    }
  }

  // ---------- 攻击 2：地面冲击 ----------
  private updateSlam(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const p = this.phase;
    const wind = p === 3 ? 0.95 : 1.25;
    if (this.step === 0) {
      this.openTarget = p === 3 ? 1 : 0;
      this.faceTo(player.pos.x, player.pos.z, dt, 0.6);
      // 警示圈：半径 = 近身伤害范围，越接近砸地越亮
      const k = this.modeT / wind;
      this.warn.visible = true;
      this.warn.position.set(this.pos.x, 0.07, this.pos.z);
      this.warn.scale.setScalar((SLAM_RADIUS / 0.9) * (1 + 0.03 * Math.sin(this.modeT * 22)));
      this.warnMat.opacity = 0.35 + 0.65 * k;
      this.bellyGlow = k;
      if (this.modeT >= wind) {
        this.step = 1;
        this.modeT = 0;
        this.liftTarget = -0.9;
        this.warn.visible = false;
        _a.set(this.pos.x, 0.1, this.pos.z);
        ctx.fx.ring(_a, 0xffe0b0, 1, SLAM_RADIUS * 1.1, 0.4, UPV, 1);
        ctx.fx.smoke(_a, 16, 1.6, { life: 1.6, alpha: 0.35, spread: 6, rise: 0.8 });
        ctx.fx.debris(_a, 16, 12, 1.5);
        ctx.fx.scorch(_a, UPV, 5);
        ctx.gfx.flashLight(_a.setY(1.5), ORANGE, 140, 26, 0.4);
        ctx.audio.bossSlam(this.pos);
        ctx.shake(null, 1.0);
        if (this.dist < SLAM_RADIUS && player.alive) {
          player.damage(36, this.pos);
          const l = Math.max(1, this.dist);
          player.vel.x += ((player.pos.x - this.pos.x) / l) * 11;
          player.vel.z += ((player.pos.z - this.pos.z) / l) * 11;
          player.vel.y = Math.max(player.vel.y, 4);
        }
        const n = p;
        for (let i = 0; i < n; i++) {
          const w = this.waves[i];
          w.active = true;
          w.hit = false;
          w.r = 3.5;
          w.delay = i * 0.6;
          w.mesh.position.set(this.pos.x, 0.09, this.pos.z);
        }
      }
    } else {
      // 收招：机体"过载散热"，核心暴露
      this.bellyGlow = damp(this.bellyGlow, 0, 3, dt);
      if (this.modeT > 0.5) {
        this.openTarget = 1;
        this.liftTarget = 0;
      }
      if (this.modeT > (p === 3 ? 1.1 : 1.9)) {
        if (p === 3) this.combo = 'orbs';
        this.endAttack();
        if (p === 3) this.gap = 0.25;
      }
    }
  }

  private updateWaves(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    for (const w of this.waves) {
      if (!w.active) continue;
      if (w.delay > 0) {
        w.delay -= dt;
        w.mesh.visible = false;
        continue;
      }
      const prev = w.r;
      w.r += WAVE_SPEED * dt;
      w.mesh.visible = true;
      w.mesh.scale.setScalar(w.r / 0.9);
      // 波前火花
      for (let i = 0; i < 3; i++) {
        const a = rand(0, Math.PI * 2);
        _a.set(w.mesh.position.x + Math.sin(a) * w.r, 0.15, w.mesh.position.z + Math.cos(a) * w.r);
        ctx.fx.glow(_a, ORANGE, 0.5, 0.3, 0, rand(1, 3), 0, 2);
      }
      if (!w.hit && player.alive) {
        const d = dist2D(player.pos.x, player.pos.z, w.mesh.position.x, w.mesh.position.z);
        // 波前在本帧扫过玩家所在半径，且玩家双脚离地不足 0.45m → 命中
        if (d >= prev - 0.5 && d <= w.r + 0.5) {
          w.hit = true;
          if (player.pos.y < 0.45) {
            player.damage(24, w.mesh.position);
            player.vel.y = Math.max(player.vel.y, 3.5);
            ctx.shake(null, 0.4);
          }
        }
      }
      if (w.r > WAVE_MAX) {
        w.active = false;
        w.mesh.visible = false;
      }
    }
    this.waveMat.opacity = 0.9;
  }

  // ---------- 攻击 3：召唤 ----------
  private updateSummon(dt: number): void {
    const ctx = this.ctx;
    this.faceTo(ctx.player.pos.x, ctx.player.pos.z, dt, 0.6);
    if (this.step === 0) {
      this.bellyGlow = this.modeT / 1.1;
      this.liftTarget = 0.5;
      if (this.modeT > 1.1) {
        this.step = 1;
        this.modeT = 0;
        const n = this.phase === 1 ? 2 : 3;
        const base = rand(0, Math.PI * 2);
        for (let i = 0; i < n; i++) {
          const a = base + (i / n) * Math.PI * 2;
          const x = this.pos.x + Math.sin(a) * 7.5;
          const z = this.pos.z + Math.cos(a) * 7.5;
          const type = this.phase === 3 && i === 0 ? 'sentry' : 'wasp';
          ctx.enemies.spawn(type, x, z, { alerted: true, warpIn: true, encounter: 'boss-minion', yaw: a });
          _a.set(x, 1.5, z);
          ctx.fx.energyBurst(_a, 0xff5a2a, 14, 6, 0.18, 0.5);
          ctx.fx.ring(_a.setY(0.08), 0xff5a2a, 0.3, 2.4, 0.5, UPV);
          this.muzzlePos(_b).setY(1.9);
          ctx.fx.beam(_b, _a.setY(1.5), 0xff5a2a, 0.12, 0.3, 2.5);
        }
        ctx.audio.terminal(false);
        this.summonT = this.phase === 1 ? 26 : this.phase === 2 ? 22 : 18;
      }
    } else {
      this.bellyGlow = damp(this.bellyGlow, 0, 3, dt);
      this.liftTarget = 0;
      this.openTarget = 1;
      if (this.modeT > 0.9) this.endAttack();
    }
  }

  // ---------- 攻击 4：扫射光束 ----------
  private updateBeam(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const p3 = this.phase >= 3;
    const wind = 1.3;
    const sweep = p3 ? 2.0 : 2.6;
    const arc = 1.92; // 110°
    this.openTarget = 1;
    if (this.step === 0) {
      // 转向起始角，并用细瞄准线提示光束将从哪里开始、往哪边扫
      this.yaw = turnToward(this.yaw, this.beamYaw, 2.6 * dt);
      this.syncTransform();
      this.corePos(_a);
      this.beamVector(_b);
      const hit = ctx.physics.raycast(_a, _b, 70, QUERY.WORLD);
      _c.copy(_a).addScaledVector(_b, hit ? hit.distance : 70);
      const k = this.modeT / wind;
      ctx.fx.beam(_a, _c, RED, 0.03 + k * 0.05, dt * 1.6, 1 + k * 3);
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = 0.05;
        ctx.fx.glow(_d.copy(_a).add(_c.set(rand(-1.4, 1.4), rand(-1.4, 1.4), rand(-1.4, 1.4))), RED, 0.4, 0.25, -_c.x * 4, -_c.y * 4, -_c.z * 4, 2.5);
      }
      if (this.modeT >= wind) {
        this.step = 1;
        this.modeT = 0;
        this.beamTick = 0;
        ctx.audio.beamLoop(this.pos, sweep);
      }
    } else if (this.step === 1) {
      this.yaw += this.beamDir * (arc / sweep) * dt;
      this.syncTransform();
      this.corePos(_a);
      this.beamVector(_b);
      const hit = ctx.physics.raycast(_a, _b, 70, QUERY.WORLD);
      const len = hit ? hit.distance : 70;
      _c.copy(_a).addScaledVector(_b, len);
      ctx.fx.beam(_a, _c, 0xff3a1a, 0.5, dt * 1.6, 3.2);
      ctx.fx.beam(_a, _c, 0xfff0d0, 0.16, dt * 1.6, 4);
      this.fxT -= dt;
      if (this.fxT <= 0) {
        this.fxT = 0.045;
        if (hit) {
          ctx.fx.sparks(_c, hit.normal, 6, 0xffb060, 8, 1.2, 0.4);
          ctx.fx.scorch(_c, hit.normal, 0.9);
          ctx.fx.smoke(_c, 1, 0.5, { life: 0.8, alpha: 0.25, rise: 1 });
        }
        ctx.gfx.flashLight(_c, 0xff4a1a, 50, 12, 0.12);
      }
      ctx.shake(null, 0.06);
      // 伤害：玩家胶囊（三个采样点）到光束线段的距离
      this.beamTick -= dt;
      if (this.beamTick <= 0 && player.alive) {
        const h = player.currentHeight;
        for (const f of [0.25, 0.55, 0.85]) {
          _d.set(player.pos.x, player.pos.y + h * f, player.pos.z).sub(_a);
          const t = clamp(_d.dot(_b), 0, len);
          const dx = _d.x - _b.x * t;
          const dy = _d.y - _b.y * t;
          const dz = _d.z - _b.z * t;
          if (dx * dx + dy * dy + dz * dz < 0.62 * 0.62) {
            player.damage(15, this.pos);
            this.beamTick = 0.11;
            break;
          }
        }
      }
      if (this.modeT >= sweep) {
        this.step = 2;
        this.modeT = 0;
      }
    } else {
      this.faceTo(player.pos.x, player.pos.z, dt, 0.8);
      if (this.modeT > (p3 ? 0.7 : 1.2)) this.endAttack();
    }
  }

  private beamVector(out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.beamPitch);
    return out.set(Math.sin(this.yaw) * c, Math.sin(this.beamPitch), Math.cos(this.yaw) * c);
  }

  // ---------- 动画 ----------
  private animateBoss(dt: number): void {
    const rig = this.rig;
    const t = this.ctx.time;
    this.flinch.update(dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
    this.openAmt = damp(this.openAmt, this.openTarget, this.openTarget > this.openAmt ? 7 : 3.5, dt);
    this.bodyLift = damp(this.bodyLift, this.liftTarget, this.liftTarget < this.bodyLift ? 16 : 3, dt);
    this.walkPhase += this.moveSpeed * 1.3 * dt;
    const moving = this.moveSpeed > 0 ? 1 : 0;
    rig.body.position.y = this.bodyBaseY + this.bodyLift + Math.sin(t * 1.3) * 0.06 + Math.abs(Math.sin(this.walkPhase)) * 0.12 * moving;
    rig.body.rotation.x = -this.flinch.value * 0.02 + (this.mode === 'slam' && this.step === 0 ? -0.12 : 0) + (this.mode === 'transition' ? Math.sin(t * 31) * 0.03 : 0);
    rig.body.rotation.z = this.mode === 'transition' ? Math.sin(t * 23) * 0.04 : Math.sin(this.walkPhase) * 0.02 * moving;
    for (let i = 0; i < rig.legs.length; i++) {
      // 四足步态：对角腿同相；身体升降时腿部相应屈伸
      rig.legs[i].rotation.x = Math.sin(this.walkPhase + (i % 2) * Math.PI) * 0.07 * moving - this.bodyLift * 0.09;
    }
    rig.extra[2].position.y = 0.2 + 0.42 * this.openAmt;
    rig.extra[3].position.y = -0.15 - 0.47 * this.openAmt;
    // 肩炮俯仰对准玩家
    const pitch = clamp(Math.atan2(4.7 - 1.2, Math.max(4, this.dist)), 0, 0.6);
    for (let i = 0; i < 2; i++) rig.extra[i].rotation.x = damp(rig.extra[i].rotation.x, this.mode === 'orbs' ? -0.25 : pitch * 0.6, 4, dt);
    // 发光：核心亮度 = 是否可被击伤；肩炮/腹舱 = 攻击预警
    const live = this.mode === 'dormant' ? 0.02 : this.mode === 'intro' ? Math.min(1, this.modeT / 1.5) : 1;
    const corePulse = this.coreOpen ? 3.4 + Math.sin(t * 9) * 0.8 : 1.0;
    _col.setHex(this.mode === 'beam' ? 0xff5a2a : RED).multiplyScalar(corePulse * live * (this.mode === 'beam' && this.step === 0 ? 1 + this.modeT * 1.5 : 1));
    if (this.hitFlash > 0) _col.lerp(WHITE, this.hitFlash * 0.7);
    rig.eyeMat.color.copy(_col);
    const g = 0.6 + Math.max(this.cannonGlow, this.bellyGlow) * 5 + (this.phase - 1) * 0.5;
    rig.glowMat.color.setHex(this.phase >= 3 ? 0xff3a1a : ORANGE).multiplyScalar(g * live);
  }

  // ---------- 死亡演出 ----------
  private updateDying(dt: number): void {
    const ctx = this.ctx;
    const rig = this.rig;
    this.dyingT += dt;
    const t = this.dyingT;
    if (t < 4.0) {
      this.boomT -= dt;
      if (this.boomT <= 0) {
        this.boomT = Math.max(0.08, 0.3 - t * 0.055);
        _a.set(this.pos.x + rand(-3, 3), rand(1.5, 5.5), this.pos.z + rand(-3, 3));
        ctx.fx.explosion(_a, rand(1.2, 2.6), Math.random() < 0.5 ? ORANGE : 0xffd9a0, false);
        ctx.fx.debris(_a, 3, 9, 1.3);
        ctx.audio.explosion(_a, rand(0.5, 1));
        ctx.shake(null, 0.25 + t * 0.08);
      }
      rig.body.position.y = this.bodyBaseY - t * 0.3 + Math.sin(t * 40) * 0.05;
      rig.body.rotation.z = Math.sin(t * 17) * 0.06 + t * 0.03;
      rig.body.rotation.x = Math.sin(t * 13) * 0.05;
      rig.eyeMat.color.setHex(RED).multiplyScalar(Math.random() < 0.3 ? 5 : 0.6);
      rig.glowMat.color.setHex(ORANGE).multiplyScalar(1 + t * 1.5);
      this.openAmt = damp(this.openAmt, 1, 5, dt);
      rig.extra[2].position.y = 0.2 + 0.42 * this.openAmt;
      rig.extra[3].position.y = -0.15 - 0.47 * this.openAmt;
    } else if (this.step === 0) {
      // 核心殉爆
      this.step = 1;
      this.center(_a);
      _a.y = 3.5;
      ctx.fx.explosion(_a, 10, 0xffe0b0, true);
      ctx.fx.explosion(_a, 6, ORANGE, false);
      ctx.fx.ring(_a.clone().setY(0.1), 0xffe0b0, 2, 30, 1.2, UPV, 1);
      ctx.fx.ring(_a, 0xffffff, 1, 22, 0.8, null, 1);
      ctx.fx.debris(_a, 30, 16, 2);
      ctx.fx.energyBurst(_a, 0xffd9a0, 40, 14, 0.3, 1.2);
      ctx.gfx.flashLight(_a, 0xffe0b0, 400, 60, 1.2);
      ctx.gfx.fx.flash = 1;
      ctx.audio.explosion(_a, 2);
      ctx.audio.bossSlam(this.pos);
      ctx.shake(null, 1);
      // 残骸：机体砸落、熄灭
      rig.body.position.y = this.bodyBaseY - 1.9;
      rig.body.rotation.set(0.12, 0, 0.2);
      rig.eyeMat.color.setScalar(0);
      rig.glowMat.color.setScalar(0);
      for (let i = 0; i < rig.legs.length; i++) rig.legs[i].rotation.x = 0.18;
      rig.extra[0].rotation.x = 0.5;
      rig.extra[1].rotation.x = 0.7;
    } else {
      if (Math.random() < dt * 6) {
        _a.set(this.pos.x + rand(-2, 2), rand(1.5, 3), this.pos.z + rand(-2, 2));
        ctx.fx.smoke(_a, 1, 1.4, { life: 2.5, alpha: 0.3, rise: 1.4, spread: 0.6 });
        if (Math.random() < 0.4) ctx.fx.sparks(_a, UPV, 4, 0x7fd8ff, 4, 1.3, 0.4);
      }
      if (t > 5.6) this.deathDone = true;
    }
  }

  override dispose(): void {
    const scene = this.ctx.gfx.scene;
    for (const w of this.waves) scene.remove(w.mesh);
    scene.remove(this.warn);
    this.waveGeo.dispose();
    this.waveMat.dispose();
    this.warnMat.dispose();
    super.dispose();
  }
}
