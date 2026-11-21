import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp, dist2D, rand, randSign } from '../core/math';
import { QUERY } from '../physics/Physics';
import { DamageSource, Enemy, EnemySpawnOpts, EnemyState, HitPart } from './Enemy';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);
const COL_PLASMA = 0xff5a2a;
const COL_RAIL = 0xff2d3a;

// =====================================================================================
// 哨兵：巡逻 → 追击 → 中距离三连发等离子弹 → 横移换位；贴身时电击
// =====================================================================================
export class Sentry extends Enemy {
  private phase: 'aim' | 'burst' | 'recover' | 'meleeWind' | 'meleeRecover' = 'aim';
  private phaseT = 0;
  private shots = 0;
  private cooldown = rand(0.2, 1);
  private strafeDir = randSign();
  private repo = new THREE.Vector3();
  private armRaise = 0;

  constructor(ctx: Ctx, x: number, z: number, opts?: EnemySpawnOpts) {
    super(ctx, 'sentry', { hp: 80, speed: 3.6, turn: 5, sight: 30, fovDeg: 110, navRadius: 0.4, reaction: 0.55, staggerAt: 34 }, x, z, opts);
    this.addCapsule('body', 0.42, 0.1, 1.5);
    this.addBall('head', 0.27, 0, 1.62, 0.04);
  }

  protected override onEnter(s: EnemyState): void {
    if (s === 'attack') {
      this.phase = 'aim';
      this.phaseT = 0;
    }
    if (s === 'reposition') {
      // 在玩家周围 7~13m 的环上找一个横向偏移的点
      const p = this.ctx.player.pos;
      let best = false;
      for (let i = 0; i < 6 && !best; i++) {
        const ang = Math.atan2(this.pos.x - p.x, this.pos.z - p.z) + this.strafeDir * rand(0.4, 1.0);
        const r = rand(7, 13);
        _a.set(p.x + Math.sin(ang) * r, 0, p.z + Math.cos(ang) * r);
        if (this.ctx.nav.isWalkable(_a.x, _a.z, this.stats.navRadius) && this.ctx.nav.lineWalkable(this.pos.x, this.pos.z, _a.x, _a.z, this.stats.navRadius)) {
          this.repo.copy(_a);
          best = true;
        }
      }
      if (!best) {
        this.strafeDir *= -1;
        const q = this.ctx.nav.randomPointNear(this.pos.x, this.pos.z, 2, 5, this.stats.navRadius, _a);
        this.repo.copy(q ?? this.pos);
      }
    }
  }

  protected override combat(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    this.cooldown -= dt;
    switch (this.state) {
      case 'chase': {
        if (this.canSee && this.dist < 2.4) {
          this.setState('attack');
          this.phase = 'meleeWind';
          break;
        }
        if (this.canSee && this.dist < 17 && this.cooldown <= 0) {
          this.setState('attack');
          break;
        }
        const tx = this.canSee ? player.pos.x : this.lastKnown.x;
        const tz = this.canSee ? player.pos.z : this.lastKnown.z;
        if (this.canSee && this.dist < 9) {
          // 冷却中：保持距离并横移，而不是贴脸
          this.faceTo(player.pos.x, player.pos.z, dt);
          const fx = Math.sin(this.yaw);
          const fz = Math.cos(this.yaw);
          if (!this.slide(fz * this.strafeDir, -fx * this.strafeDir, this.stats.speed * 0.6, dt)) this.strafeDir *= -1;
        } else if (this.navigate(tx, tz, this.stats.speed, dt) && !this.canSee) {
          this.checkLost(1.5);
        }
        this.checkLost();
        break;
      }
      case 'attack': {
        this.phaseT += dt;
        this.faceTo(player.pos.x, player.pos.z, dt, this.stats.turn * 1.3);
        if (this.phase === 'aim') {
          if (this.phaseT === dt) ctx.audio.enemyCharge(this.pos, 0.4, 1.3);
          this.rig.glowMat.color.setHex(COL_PLASMA).multiplyScalar(2 + this.phaseT * 9);
          if (!this.canSee && this.phaseT > 0.5) this.setState('chase');
          else if (this.dist < 2.4) {
            this.phase = 'meleeWind';
            this.phaseT = 0;
          } else if (this.phaseT > 0.42 && this.angleToPlayer() < 0.35) {
            this.phase = 'burst';
            this.phaseT = 0;
            this.shots = 0;
          }
        } else if (this.phase === 'burst') {
          if (this.phaseT >= this.shots * 0.14) {
            this.shots++;
            // 轻微提前量 + 散布：横向移动可以躲开
            player.center(_c).addScaledVector(player.vel, (this.dist / 32) * 0.55);
            this.shootAt(_c, 'bolt', 32, 6, COL_PLASMA, 2.4, 0.075);
            ctx.audio.enemyShot(this.pos, 'bolt');
            this.flinch.impulse(0.25);
            if (this.shots >= 3) {
              this.phase = 'recover';
              this.phaseT = 0;
            }
          }
        } else if (this.phase === 'recover') {
          this.rig.glowMat.color.setHex(COL_PLASMA).multiplyScalar(2);
          if (this.phaseT > 0.45) {
            this.cooldown = rand(1.0, 1.9);
            this.setState(Math.random() < 0.6 ? 'reposition' : 'chase');
          }
        } else if (this.phase === 'meleeWind') {
          this.armRaise = damp(this.armRaise, 1, 14, dt);
          if (this.phaseT === dt) ctx.audio.enemyCharge(this.pos, 0.4, 1.8);
          if (this.phaseT > 0.42) {
            this.phase = 'meleeRecover';
            this.phaseT = 0;
            ctx.audio.enemyMelee(this.pos);
            this.center(_a).addScaledVector(this.forward(_b), 0.9);
            ctx.fx.energyBurst(_a, 0x7fd8ff, 10, 5, 0.1, 0.3);
            ctx.fx.flash(_a, 0x7fd8ff, 1.6, 0.1);
            if (this.dist < 3.0 && this.angleToPlayer() < 0.9 && Math.abs(player.pos.y - this.pos.y) < 1.6) {
              player.damage(16, this.pos);
              ctx.shake(null, 0.35);
            }
          }
        } else {
          this.armRaise = damp(this.armRaise, 0, 8, dt);
          if (this.phaseT > 0.7) {
            this.cooldown = 0.3;
            this.setState('chase');
          }
        }
        break;
      }
      case 'reposition': {
        const arrived = this.navigate(this.repo.x, this.repo.z, this.stats.speed * 1.1, dt, false);
        this.faceTo(player.pos.x, player.pos.z, dt);
        if (arrived || this.stateTime > 2.2 || this.dist < 2.6) this.setState(this.canSee ? 'attack' : 'chase');
        break;
      }
    }
  }

  protected override animateArms(dt: number, pitch: number): void {
    const [gun, claw] = this.rig.arms;
    gun.rotation.x = damp(gun.rotation.x, -pitch, 10, dt);
    claw.rotation.x = damp(claw.rotation.x, -pitch - this.armRaise * 1.3, 16, dt);
    if (this.state !== 'attack') this.armRaise = damp(this.armRaise, 0, 8, dt);
  }

  protected override onStep(): void {
    if (this.dist < 26) this.ctx.audio.heavyStep(this.pos, 0.35);
  }
}

// =====================================================================================
// 猎手：远程战术单位。寻找掩体 → 隐蔽 → 探头激光瞄准 → 高速射击 → 回到掩体/转移。
// 玩家逼近或绕侧时主动后撤换位。
// =====================================================================================
export class Stalker extends Enemy {
  private coverPos = new THREE.Vector3();
  private peekPos = new THREE.Vector3();
  private hasCover = false;
  private hideTime = 1;
  private phase: 'move' | 'aim' | 'fire' = 'move';
  private phaseT = 0;
  private aimPt = new THREE.Vector3();
  private shotsLeft = 1;
  private crouch = 0;
  private strafeDir = randSign();
  private coverFails = 0;

  constructor(ctx: Ctx, x: number, z: number, opts?: EnemySpawnOpts) {
    super(ctx, 'stalker', { hp: 70, speed: 4.4, turn: 6, sight: 42, fovDeg: 120, navRadius: 0.35, reaction: 0.45, staggerAt: 28 }, x, z, opts);
    this.addCapsule('body', 0.3, 0.05, 1.62);
    this.addBall('head', 0.21, 0, 1.78, 0.02);
  }

  /**
   * 掩体评估：候选点自身被遮挡（玩家看不到），且旁边 1.3m 内存在一个能看到玩家的探头点。
   * minDist 用于"后撤"时要求离玩家更远。
   */
  private findCover(minDist: number): boolean {
    const ctx = this.ctx;
    const nav = ctx.nav;
    const player = ctx.player;
    const r = this.stats.navRadius;
    player.eyePos(_b);
    let bestScore = -1e9;
    let found = false;
    for (let i = 0; i < 16; i++) {
      const c = nav.randomPointNear(this.pos.x, this.pos.z, 1.5, 13, r, _a, 4);
      if (!c) continue;
      const dp = dist2D(c.x, c.z, player.pos.x, player.pos.z);
      if (dp < minDist || dp > 34) continue;
      _c.set(c.x, 1.0, c.z);
      if (ctx.physics.lineOfSight(_c, _b)) continue; // 不是掩体
      // 探头点：垂直于玩家方向左右各试一次
      const dx = player.pos.x - c.x;
      const dz = player.pos.z - c.z;
      const l = Math.hypot(dx, dz) || 1;
      let peekOk = false;
      for (const s of [1, -1]) {
        const px = c.x + (dz / l) * 1.3 * s;
        const pz = c.z - (dx / l) * 1.3 * s;
        if (!nav.isWalkable(px, pz, r)) continue;
        _c.set(px, 1.65, pz);
        if (ctx.physics.lineOfSight(_c, _b)) {
          const score = -dist2D(c.x, c.z, this.pos.x, this.pos.z) * 0.7 - Math.abs(dp - 19) * 0.45 + rand(0, 1.5);
          if (score > bestScore) {
            bestScore = score;
            this.coverPos.set(c.x, 0, c.z);
            this.peekPos.set(px, 0, pz);
            found = true;
          }
          peekOk = true;
          break;
        }
      }
      if (!peekOk) continue;
    }
    this.hasCover = found;
    return found;
  }

  protected override onEnter(s: EnemyState): void {
    if (s === 'attack') {
      this.phase = 'move';
      this.phaseT = 0;
      this.shotsLeft = Math.random() < 0.4 ? 2 : 1;
    }
    if (s === 'cover') this.hideTime = rand(0.7, 1.5);
  }

  protected override onDamaged(damage: number): void {
    // 在掩体外被打中 → 有概率放弃当前射击，立即换位
    if (this.state === 'attack' && this.phase !== 'fire' && damage > 12 && Math.random() < 0.5) {
      if (this.findCover(6)) this.setState('reposition');
    }
  }

  protected override combat(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    switch (this.state) {
      case 'chase': {
        if (this.canSee && this.dist < 34) {
          if (this.coverFails < 3 && this.findCover(this.dist < 8 ? 10 : 7)) this.setState('reposition');
          else {
            this.coverFails = 0;
            this.hasCover = false;
            this.setState('attack');
          }
          if (!this.hasCover) this.coverFails++;
          break;
        }
        if (this.navigate(this.lastKnown.x, this.lastKnown.z, this.stats.speed, dt) && !this.canSee) this.checkLost(1.5);
        this.checkLost();
        break;
      }
      case 'reposition': {
        const arrived = this.navigate(this.coverPos.x, this.coverPos.z, this.stats.speed * 1.2, dt);
        if (arrived) this.setState('cover');
        else if (this.stateTime > 5) this.setState('attack');
        break;
      }
      case 'cover': {
        this.faceTo(this.lastKnown.x, this.lastKnown.z, dt);
        // 被绕侧（在掩体里却被玩家近距离看到）→ 后撤换位
        if (this.canSee && this.dist < 9 && this.stateTime > 0.3) {
          if (this.findCover(11)) {
            this.setState('reposition');
            break;
          }
        }
        if (this.stateTime > this.hideTime) {
          if (ctx.time - this.lastSeen > 7) this.setState('chase');
          else this.setState('attack');
        }
        break;
      }
      case 'attack': {
        this.phaseT += dt;
        if (this.phase === 'move') {
          // 走到探头点；没有掩体时在开阔地横移
          let ready = false;
          if (this.hasCover) {
            ready = this.navigate(this.peekPos.x, this.peekPos.z, this.stats.speed * 0.9, dt, false) || (this.canSee && this.phaseT > 0.5);
          } else {
            const fx = Math.sin(this.yaw);
            const fz = Math.cos(this.yaw);
            if (!this.slide(fz * this.strafeDir, -fx * this.strafeDir, this.stats.speed * 0.7, dt)) this.strafeDir *= -1;
            // 距离过近时边横移边后退
            if (this.dist < 8) this.slide(-fx, -fz, this.stats.speed * 0.6, dt);
            ready = this.phaseT > 0.6;
          }
          this.faceTo(player.pos.x, player.pos.z, dt);
          if (ready && this.canSee) {
            this.phase = 'aim';
            this.phaseT = 0;
            player.center(this.aimPt);
            ctx.audio.enemyCharge(this.pos, 0.75, 2.2);
          } else if (this.phaseT > 2.4) this.setState('chase');
        } else if (this.phase === 'aim') {
          // 激光瞄准：瞄准点滞后跟随玩家，最后 0.18s 锁定不再移动——玩家看到红线后横移即可躲开
          this.faceTo(player.pos.x, player.pos.z, dt, this.stats.turn * 1.5);
          const aimTime = 0.78;
          if (this.phaseT < aimTime - 0.18) {
            player.center(_a);
            const k = 1 - Math.exp(-7 * dt);
            this.aimPt.lerp(_a, k);
          }
          this.muzzlePos(_a);
          _b.subVectors(this.aimPt, _a).normalize();
          const hit = ctx.physics.raycast(_a, _b, 60, QUERY.WORLD);
          _c.copy(_a).addScaledVector(_b, hit ? hit.distance : 60);
          const lock = this.phaseT / aimTime;
          ctx.fx.beam(_a, _c, COL_RAIL, 0.012 + lock * 0.02, dt * 1.6, 1.2 + lock * 2.5);
          this.rig.glowMat.color.setHex(COL_RAIL).multiplyScalar(2 + lock * 5);
          if (!this.canSee && this.phaseT > 0.3) {
            this.phase = 'move';
            this.phaseT = 1.2;
          } else if (this.phaseT >= aimTime) {
            this.phase = 'fire';
            this.phaseT = 0;
            this.shootAt(this.aimPt, 'rifle', 80, 20, COL_RAIL, 0.35, 0.07);
            ctx.audio.enemyShot(this.pos, 'rifle');
            this.flinch.impulse(0.9);
            this.shotsLeft--;
          }
        } else {
          this.rig.glowMat.color.setHex(COL_RAIL).multiplyScalar(2.4);
          if (this.phaseT > 0.45) {
            if (this.shotsLeft > 0 && this.canSee) {
              this.phase = 'aim';
              this.phaseT = 0;
              player.center(this.aimPt);
              ctx.audio.enemyCharge(this.pos, 0.75, 2.2);
            } else if (this.dist < 8 || Math.random() < 0.4 || !this.hasCover) {
              // 换一个新掩体（太近则后撤）
              if (this.findCover(this.dist < 8 ? 11 : 7)) this.setState('reposition');
              else this.setState('attack');
            } else this.setState('reposition'); // 回到原掩体
          }
        }
        break;
      }
    }
  }

  protected override bodyDrop(dt: number): number {
    this.crouch = damp(this.crouch, this.state === 'cover' ? 1 : 0, 9, dt);
    for (const leg of this.rig.legs) leg.position.y = 0.92 - this.crouch * 0.32;
    return -this.crouch * 0.42;
  }

  protected override onStep(): void {
    if (this.dist < 18) this.ctx.audio.heavyStep(this.pos, 0.2);
  }
}

// =====================================================================================
// 重装：缓慢推进。正面装甲减伤 60%，背部反应堆为弱点。
// 近距离：砸地范围冲击（1.1s 前摇 + 地面警示环）；中远距离：三连迫击炮（落点标记）。
// =====================================================================================
export class Juggernaut extends Enemy {
  private phase: 'slamWind' | 'slamRecover' | 'mortarWind' | 'mortarFire' | 'mortarRecover' = 'slamWind';
  private phaseT = 0;
  private slamCd = 1;
  private mortarCd = rand(2, 4);
  private shots = 0;
  private armRaise = 0;
  private weakDamage = 0;
  private ringT = 0;

  constructor(ctx: Ctx, x: number, z: number, opts?: EnemySpawnOpts) {
    super(ctx, 'juggernaut', { hp: 520, speed: 1.9, turn: 1.9, sight: 40, fovDeg: 130, navRadius: 0.8, reaction: 0.8, staggerAt: 0 }, x, z, opts);
    this.addCapsule('body', 0.85, 0.05, 2.35);
    this.addBall('head', 0.33, 0, 2.48, 0.2);
    this.addBall('weak', 0.38, 0, 1.85, -0.78);
  }

  protected override modifyDamage(part: HitPart, damage: number, dir: THREE.Vector3, source: DamageSource): { damage: number; armor: boolean; crit: boolean } {
    if (part === 'weak') {
      this.weakDamage += damage * 2.2;
      if (this.weakDamage > 170) {
        this.weakDamage = 0;
        this.stun(1.7);
        this.center(_a);
        this.ctx.fx.energyBurst(_a, 0xff8a2a, 14, 6, 0.16, 0.5);
        this.ctx.audio.enemyDeath(this.pos, false);
      }
      return { damage: damage * 2.2, armor: false, crit: true };
    }
    if (part === 'head') return { damage: damage * 1.4, armor: false, crit: true };
    // 正面装甲：子弹方向与朝向相对时生效
    const facing = dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw);
    if (facing < -0.2 && source !== 'explosion') return { damage: damage * (source === 'helix' ? 0.6 : 0.4), armor: true, crit: false };
    return { damage, armor: false, crit: false };
  }

  protected override onEnter(s: EnemyState): void {
    if (s === 'attack') this.phaseT = 0;
  }

  protected override combat(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    this.slamCd -= dt;
    this.mortarCd -= dt;
    if (this.state === 'chase') {
      if (this.canSee && this.dist < 5.4 && this.slamCd <= 0) {
        this.phase = 'slamWind';
        this.setState('attack');
        ctx.audio.enemyCharge(this.pos, 1.1, 0.5);
        this.ringT = 0;
        return;
      }
      if (this.canSee && this.dist > 9 && this.dist < 36 && this.mortarCd <= 0) {
        this.phase = 'mortarWind';
        this.setState('attack');
        ctx.audio.servo(this.pos);
        return;
      }
      const tx = this.canSee ? player.pos.x : this.lastKnown.x;
      const tz = this.canSee ? player.pos.z : this.lastKnown.z;
      if (this.dist > 3.2 || !this.canSee) {
        if (this.navigate(tx, tz, this.stats.speed, dt) && !this.canSee) this.checkLost(2);
      } else this.faceTo(player.pos.x, player.pos.z, dt);
      this.checkLost(9);
      return;
    }
    if (this.state !== 'attack') {
      this.setState('chase');
      return;
    }
    this.phaseT += dt;
    switch (this.phase) {
      case 'slamWind': {
        this.faceTo(player.pos.x, player.pos.z, dt, 0.9);
        this.armRaise = damp(this.armRaise, 1, 5, dt);
        this.rig.glowMat.color.setHex(0xff5a1a).multiplyScalar(2.6 + this.phaseT * 6);
        // 地面警示环：每 0.28s 一道，范围与实际伤害半径一致
        this.ringT -= dt;
        if (this.ringT <= 0) {
          this.ringT = 0.28;
          _a.set(this.pos.x, 0.06, this.pos.z);
          ctx.fx.ring(_a, 0xff2d2d, 7.2, 7.0, 0.3, UPV, 0.9, true);
        }
        if (this.phaseT >= 1.1) {
          this.phase = 'slamRecover';
          this.phaseT = 0;
          this.armRaise = -0.35;
          this.forward(_b);
          _a.set(this.pos.x + _b.x * 1.3, 0.08, this.pos.z + _b.z * 1.3);
          ctx.fx.ring(_a, 0xff8a2a, 0.5, 6.5, 0.45, UPV, 1);
          ctx.fx.ring(_a, 0xffe0b0, 0.3, 4.5, 0.3, UPV, 1);
          ctx.fx.smoke(_a, 10, 1.2, { life: 1.3, alpha: 0.35, spread: 3.2, rise: 0.6 });
          ctx.fx.debris(_a, 10, 9, 1.2);
          ctx.fx.scorch(_a, UPV, 3.2);
          ctx.gfx.flashLight(_a, 0xff8a2a, 80, 16, 0.3);
          ctx.audio.bossSlam(this.pos);
          ctx.shake(this.pos, 0.9, 26);
          const d = dist2D(_a.x, _a.z, player.pos.x, player.pos.z);
          if (d < 6.5 && player.pos.y < 1.3) {
            player.center(_c);
            _a.y = 1.0;
            if (ctx.physics.lineOfSight(_a, _c)) {
              player.damage(48 * (1 - 0.55 * (d / 6.5)), this.pos);
              // 击退
              const k = 7 * (1 - d / 8);
              const l = Math.max(0.5, d);
              player.vel.x += ((player.pos.x - _a.x) / l) * k;
              player.vel.z += ((player.pos.z - _a.z) / l) * k;
            }
          }
          ctx.enemies.damageBarrelsNear(_a, 6.5);
        }
        break;
      }
      case 'slamRecover':
        this.armRaise = damp(this.armRaise, 0, 3, dt);
        this.rig.glowMat.color.setHex(0xff8a2a).multiplyScalar(2.6);
        if (this.phaseT > 1.3) {
          this.slamCd = 2.2;
          this.setState('chase');
        }
        break;
      case 'mortarWind':
        this.faceTo(player.pos.x, player.pos.z, dt);
        this.rig.extra[0].rotation.x = damp(this.rig.extra[0].rotation.x, 0.5, 5, dt);
        if (this.phaseT > 0.8) {
          this.phase = 'mortarFire';
          this.phaseT = 0;
          this.shots = 0;
        }
        break;
      case 'mortarFire':
        if (this.phaseT >= this.shots * 0.42) {
          const flight = 1.25;
          // 预判玩家走位：第一发打当前位置，后续打预测位置
          _c.set(player.pos.x + player.vel.x * flight * 0.55 * this.shots + rand(-1.2, 1.2), 0.05, player.pos.z + player.vel.z * flight * 0.55 * this.shots + rand(-1.2, 1.2));
          this.muzzlePos(_a);
          ctx.projectiles.spawnMortar(_a, _c, flight, 30, 3.6, 0xff6a2a);
          ctx.fx.ring(_c, 0xff2d2d, 4.0, 0.4, flight, UPV, 1, true);
          ctx.fx.ring(_c, 0xff8a2a, 4.0, 3.95, flight, UPV, 0.7, true);
          ctx.fx.smoke(_a, 3, 0.5, { life: 0.8, alpha: 0.3, rise: 1.5 });
          ctx.fx.flash(_a, 0xff8a2a, 2, 0.1);
          ctx.audio.enemyShot(this.pos, 'mortar');
          this.flinch.impulse(1.2);
          this.shots++;
          if (this.shots >= 3) {
            this.phase = 'mortarRecover';
            this.phaseT = 0;
          }
        }
        break;
      case 'mortarRecover':
        this.rig.extra[0].rotation.x = damp(this.rig.extra[0].rotation.x, 0, 4, dt);
        if (this.phaseT > 0.9) {
          this.mortarCd = rand(5, 7.5);
          this.setState('chase');
        }
        break;
    }
  }

  protected override animateArms(dt: number): void {
    const sway = Math.sin(this.walkPhase) * 0.25;
    this.rig.arms[0].rotation.x = damp(this.rig.arms[0].rotation.x, -this.armRaise * 2.5 + sway, 12, dt);
    this.rig.arms[1].rotation.x = damp(this.rig.arms[1].rotation.x, -this.armRaise * 2.5 - sway, 12, dt);
    if (this.state !== 'attack') this.armRaise = damp(this.armRaise, 0, 4, dt);
  }

  protected override onStep(): void {
    this.ctx.audio.heavyStep(this.pos, 1.2);
    this.ctx.shake(this.pos, 0.16, 14);
    _a.set(this.pos.x, 0.05, this.pos.z);
    this.ctx.fx.smoke(_a, 1, 0.5, { life: 0.7, alpha: 0.15, spread: 0.5 });
  }
}

// =====================================================================================
// 黄蜂：小型悬浮无人机，绕玩家盘旋并点射。由 OMEGA-01 与部分遭遇战召唤。
// =====================================================================================
export class Wasp extends Enemy {
  private orbit = rand(0, Math.PI * 2);
  private orbitDir = randSign();
  private orbitR = rand(6, 9.5);
  private hover = rand(1.9, 2.8);
  private fireCd = rand(0.8, 2);
  private windT = -1;
  private velX = 0;
  private velZ = 0;

  constructor(ctx: Ctx, x: number, z: number, opts?: EnemySpawnOpts) {
    super(ctx, 'wasp', { hp: 28, speed: 6.5, turn: 7, sight: 45, fovDeg: 360, navRadius: 0.3, reaction: 0.3, staggerAt: 0 }, x, z, opts);
    this.pos.y = this.hover;
    this.addBall('body', 0.42, 0, 0, 0);
  }

  protected override combat(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    const t = ctx.time;
    if (this.state !== 'chase' && this.state !== 'attack') this.setState('chase');
    this.orbit += this.orbitDir * dt * 0.55;
    const tx = (this.canSee ? player.pos.x : this.lastKnown.x) + Math.sin(this.orbit) * this.orbitR;
    const tz = (this.canSee ? player.pos.z : this.lastKnown.z) + Math.cos(this.orbit) * this.orbitR;
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    const sp = Math.min(this.stats.speed, d * 2.5);
    this.velX = damp(this.velX, d > 0.01 ? (dx / d) * sp : 0, 3, dt);
    this.velZ = damp(this.velZ, d > 0.01 ? (dz / d) * sp : 0, 3, dt);
    const nav = ctx.nav;
    const nx = this.pos.x + this.velX * dt;
    const nz = this.pos.z + this.velZ * dt;
    if (nav.isWalkable(nx, nz, 0.3) || !nav.isWalkable(this.pos.x, this.pos.z, 0.3)) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      // 撞墙：反向盘旋并缩小半径
      this.orbitDir *= -1;
      this.orbitR = Math.max(3.5, this.orbitR - 1);
      this.velX *= -0.4;
      this.velZ *= -0.4;
    }
    this.pos.y = damp(this.pos.y, this.hover + Math.sin(t * 2.3 + this.id) * 0.25, 4, dt);
    this.faceTo(player.pos.x, player.pos.z, dt);
    // 机身随速度倾斜
    this.rig.body.rotation.z = clamp(-(this.velX * Math.cos(this.yaw) - this.velZ * Math.sin(this.yaw)) * 0.06, -0.5, 0.5);
    this.rig.body.rotation.x = -this.flinch.value * 0.3;

    this.fireCd -= dt;
    if (this.windT >= 0) {
      this.windT += dt;
      this.rig.glowMat.color.setHex(0xff3a2a).multiplyScalar(2 + this.windT * 14);
      if (this.windT > 0.35) {
        this.windT = -1;
        this.rig.glowMat.color.setHex(0xff8a2a).multiplyScalar(2.2);
        if (this.canSee) {
          player.center(_c).addScaledVector(player.vel, (this.dist / 28) * 0.4);
          this.shootAt(_c, 'wasp', 28, 6, 0xff7a2a, 2.2, 0.06);
          ctx.audio.enemyShot(this.pos, 'wasp');
        }
      }
    } else if (this.fireCd <= 0 && this.canSee && this.dist < 26) {
      this.fireCd = rand(1.3, 2.2);
      this.windT = 0;
    }
    if (!this.canSee && ctx.time - this.lastSeen > 12) {
      this.lastKnown.copy(player.pos); // 无人机不会放弃：直接飞向玩家
    }
  }

  protected override deathFx(c: THREE.Vector3): void {
    const ctx = this.ctx;
    ctx.fx.explosion(c, 1.0, 0xff8a2a, false);
    ctx.fx.debris(c, 3, 5, 0.6);
    ctx.gfx.flashLight(c, 0xff8a2a, 30, 8, 0.25);
    ctx.audio.enemyDeath(c, false);
  }
}
