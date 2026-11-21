import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp, dist2D, rand, Spring, turnToward } from '../core/math';
import { G, groups, RAPIER } from '../physics/Physics';
import { WEAPONS, WeaponId } from '../weapons/WeaponDefs';
import { buildEnemyRig, EnemyRig, EnemyType } from './EnemyModels';

export type EnemyState = 'idle' | 'patrol' | 'alert' | 'search' | 'chase' | 'attack' | 'cover' | 'reposition' | 'stagger' | 'dead';
export type DamageSource = WeaponId | 'explosion';
export type HitPart = 'body' | 'head' | 'weak' | 'armor';

export interface HitResult {
  killed: boolean;
  headshot: boolean;
  armor: boolean;
}

export interface EnemySpawnOpts {
  yaw?: number;
  /** 巡逻路线（世界坐标 [x,z]） */
  patrol?: [number, number][];
  /** 生成时即处于交战状态 */
  alerted?: boolean;
  /** 所属遭遇战标识（关卡用于统计清场） */
  encounter?: string;
  /** 生成时的传送特效 */
  warpIn?: boolean;
}

export interface EnemyStats {
  hp: number;
  speed: number;
  /** 转身速度（弧度/秒） */
  turn: number;
  sight: number;
  fovDeg: number;
  navRadius: number;
  /** 发现玩家后的反应时间（秒） */
  reaction: number;
  /** 单次伤害达到该值触发硬直（0 = 不会硬直） */
  staggerAt: number;
}

interface Part {
  collider: RAPIER.Collider;
  ox: number;
  oy: number;
  oz: number;
}

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Color();
const WHITE = new THREE.Color(4, 4, 4);
const EYE_CALM = new THREE.Color(0xff6a2a).multiplyScalar(1.4);
const EYE_ALERT = new THREE.Color(0xffc21a).multiplyScalar(2.6);
const EYE_HOSTILE = new THREE.Color(0xff2d2d).multiplyScalar(3.2);

/**
 * 敌人基类：感知（视野锥 + 视线遮挡 + 听觉）、导航网格寻路、通用状态
 * （巡逻 → 警觉 → 交战 → 搜索 → 返回巡逻、硬直、死亡），子类实现 combat()。
 */
export abstract class Enemy {
  private static nextId = 1;
  readonly id = Enemy.nextId++;
  rig: EnemyRig;
  pos = new THREE.Vector3();
  yaw = 0;
  hp: number;
  maxHp: number;
  alive = true;
  removed = false;
  state: EnemyState = 'patrol';
  stateTime = 0;
  encounter: string;
  radius: number;
  height: number;

  // 感知
  canSee = false;
  dist = 999;
  lastKnown = new THREE.Vector3();
  lastSeen = -99;
  private percT = Math.random() * 0.15;
  private fovCos: number;

  // 导航
  protected path: THREE.Vector3[] | null = null;
  protected pathIdx = 0;
  protected repath = 0;
  private goal = new THREE.Vector3(1e9, 0, 1e9);
  /** 本帧水平移动速度（动画用） */
  protected moveSpeed = 0;
  private moveBlend = 0;
  protected walkPhase = Math.random() * 6;
  private stepSide = 0;

  // 巡逻
  private patrol: THREE.Vector3[] = [];
  private patrolIdx = 0;
  private patrolWait = 0;
  private home = new THREE.Vector3();
  private homeYaw = 0;
  private searchPoint = new THREE.Vector3();
  private searchLeft = 0;

  // 受击
  protected parts: Part[] = [];
  protected hitFlash = 0;
  protected flinch = new Spring(120, 10);
  private staggerDur = 0.4;
  private deathT = 0;
  private deathDir = 1;
  protected bodyBaseY: number;
  private spawnT = 0;

  constructor(protected ctx: Ctx, public readonly type: EnemyType, public readonly stats: EnemyStats, x: number, z: number, opts: EnemySpawnOpts = {}) {
    this.rig = buildEnemyRig(type, ctx.mats);
    this.radius = this.rig.radius;
    this.height = this.rig.height;
    this.bodyBaseY = this.rig.body.position.y;
    this.maxHp = this.hp = Math.round(stats.hp * ctx.tuning.enemyHealth);
    this.fovCos = Math.cos((stats.fovDeg * Math.PI) / 360);
    this.pos.set(x, 0, z);
    this.yaw = opts.yaw ?? 0;
    this.home.copy(this.pos);
    this.homeYaw = this.yaw;
    this.encounter = opts.encounter ?? '';
    if (opts.patrol && opts.patrol.length > 1) this.patrol = opts.patrol.map(([px, pz]) => new THREE.Vector3(px, 0, pz));
    this.state = this.patrol.length ? 'patrol' : 'idle';
    this.lastKnown.copy(ctx.player.pos);
    if (opts.alerted) {
      this.state = 'chase';
      this.lastSeen = ctx.time;
    }
    if (opts.warpIn) this.spawnT = 0.6;
    ctx.gfx.scene.add(this.rig.root);
    this.syncTransform();
  }

  // ---------- 碰撞体 ----------
  protected addCapsule(part: HitPart, r: number, y0: number, y1: number, ox = 0, oz = 0): RAPIER.Collider {
    const hh = Math.max(0.01, (y1 - y0) / 2 - r);
    return this.addCollider(RAPIER.ColliderDesc.capsule(hh, r), part, ox, (y0 + y1) / 2, oz);
  }
  protected addBall(part: HitPart, r: number, ox: number, oy: number, oz: number): RAPIER.Collider {
    return this.addCollider(RAPIER.ColliderDesc.ball(r), part, ox, oy, oz);
  }
  private addCollider(desc: RAPIER.ColliderDesc, part: HitPart, ox: number, oy: number, oz: number): RAPIER.Collider {
    const c = this.ctx.physics.world.createCollider(desc.setCollisionGroups(groups(G.ENEMY, 0xffff)).setSensor(false));
    this.ctx.physics.tag(c, { kind: 'enemy', id: this.id, part });
    this.parts.push({ collider: c, ox, oy, oz });
    return c;
  }

  protected syncTransform(): void {
    const r = this.rig.root;
    r.position.copy(this.pos);
    r.rotation.y = this.yaw;
    const s = Math.sin(this.yaw);
    const c = Math.cos(this.yaw);
    for (const p of this.parts) {
      p.collider.setTranslation({ x: this.pos.x + p.ox * c + p.oz * s, y: this.pos.y + p.oy, z: this.pos.z - p.ox * s + p.oz * c });
    }
  }

  // ---------- 基础查询 ----------
  get engaged(): boolean {
    return this.state === 'chase' || this.state === 'attack' || this.state === 'cover' || this.state === 'reposition' || this.state === 'stagger';
  }
  eyePos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.rig.headY, this.pos.z);
  }
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.height * 0.5, this.pos.z);
  }
  forward(out: THREE.Vector3): THREE.Vector3 {
    return out.set(Math.sin(this.yaw), 0, Math.cos(this.yaw));
  }
  /** 朝向与玩家方向的夹角（弧度） */
  protected angleToPlayer(): number {
    const p = this.ctx.player.pos;
    const want = Math.atan2(p.x - this.pos.x, p.z - this.pos.z);
    let d = want - this.yaw;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    return Math.abs(d);
  }

  setState(s: EnemyState): void {
    if (this.state === s) return;
    this.onExit(this.state);
    this.state = s;
    this.stateTime = 0;
    if (s === 'alert') {
      this.ctx.audio.enemyAlert(this.pos, this.type === 'juggernaut' ? 0.6 : this.type === 'stalker' ? 1.25 : 1);
      this.ctx.hud.enemyAlerted();
    }
    this.onEnter(s);
  }
  protected onEnter(_s: EnemyState): void {}
  protected onExit(_s: EnemyState): void {}

  // ---------- 感知 ----------
  protected perceive(dt: number): void {
    const player = this.ctx.player;
    this.dist = dist2D(this.pos.x, this.pos.z, player.pos.x, player.pos.z);
    this.percT -= dt;
    if (this.percT > 0) return;
    this.percT = 0.1 + Math.random() * 0.06;
    let visible = false;
    if (player.alive && !this.ctx.level.playerHidden) {
      const engaged = this.engaged || this.state === 'alert' || this.state === 'search';
      const range = this.stats.sight * (engaged ? 1.6 : player.crouching ? 0.7 : 1);
      if (this.dist < range) {
        const dx = player.pos.x - this.pos.x;
        const dz = player.pos.z - this.pos.z;
        const dot = (dx * Math.sin(this.yaw) + dz * Math.cos(this.yaw)) / Math.max(0.001, this.dist);
        // 交战中拥有全向感知；未警觉时只看视野锥，近身（脚步声）也会被察觉
        const near = this.dist < (player.crouching ? 1.6 : player.sprinting ? 6 : 3.2);
        if (engaged || dot > this.fovCos || near) {
          this.eyePos(_a);
          visible = this.ctx.physics.lineOfSight(_a, player.eyePos(_b)) || this.ctx.physics.lineOfSight(_a, player.center(_b));
        }
      }
    }
    this.canSee = visible;
    if (visible) {
      this.lastKnown.copy(player.pos);
      this.lastSeen = this.ctx.time;
    }
  }

  /** 听到声音（枪声/同伴警报） */
  hear(pos: THREE.Vector3): void {
    if (!this.alive) return;
    if (this.state === 'idle' || this.state === 'patrol') {
      this.lastKnown.copy(pos);
      this.setState('alert');
    } else if (this.state === 'search') {
      this.lastKnown.copy(pos);
      this.searchLeft = 2;
      this.searchPoint.copy(pos);
    }
  }

  /** 直接进入交战（被击中、同伴呼叫、脚本触发） */
  engage(): void {
    if (!this.alive || this.engaged) return;
    this.lastKnown.copy(this.ctx.player.pos);
    this.lastSeen = this.ctx.time;
    this.setState('chase');
  }

  // ---------- 导航 ----------
  protected faceTo(x: number, z: number, dt: number, rate = this.stats.turn): void {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    if (dx * dx + dz * dz < 1e-4) return;
    this.yaw = turnToward(this.yaw, Math.atan2(dx, dz), rate * dt);
  }

  protected tryMove(nx: number, nz: number): boolean {
    const nav = this.ctx.nav;
    const r = this.stats.navRadius;
    if (nav.isWalkable(nx, nz, r) || !nav.isWalkable(this.pos.x, this.pos.z, r)) {
      this.pos.x = nx;
      this.pos.z = nz;
      return true;
    }
    if (nav.isWalkable(nx, this.pos.z, r)) {
      this.pos.x = nx;
      return true;
    }
    if (nav.isWalkable(this.pos.x, nz, r)) {
      this.pos.z = nz;
      return true;
    }
    this.repath = 0;
    return false;
  }

  /** 沿导航网格走向目标。到达返回 true。 */
  protected navigate(tx: number, tz: number, speed: number, dt: number, face = true): boolean {
    if (dist2D(tx, tz, this.pos.x, this.pos.z) < 0.3) return true;
    this.repath -= dt;
    const goalMoved = dist2D(tx, tz, this.goal.x, this.goal.z) > 1.2;
    if ((!this.path || this.repath <= 0 || (goalMoved && this.repath < 0.8)) && this.ctx.enemies.takePathBudget()) {
      this.goal.set(tx, 0, tz);
      this.path = this.ctx.nav.findPath(this.pos, this.goal, this.stats.navRadius);
      this.pathIdx = 0;
      this.repath = rand(1.0, 1.5);
    }
    if (!this.path || this.path.length === 0) return false;
    let wp = this.path[this.pathIdx];
    let dx = wp.x - this.pos.x;
    let dz = wp.z - this.pos.z;
    let d = Math.hypot(dx, dz);
    while (d < 0.3 && this.pathIdx < this.path.length - 1) {
      wp = this.path[++this.pathIdx];
      dx = wp.x - this.pos.x;
      dz = wp.z - this.pos.z;
      d = Math.hypot(dx, dz);
    }
    if (d < 0.3) {
      this.path = null;
      return true;
    }
    const step = Math.min(d, speed * dt);
    if (this.tryMove(this.pos.x + (dx / d) * step, this.pos.z + (dz / d) * step)) this.moveSpeed = speed;
    if (face) this.faceTo(wp.x, wp.z, dt);
    return false;
  }

  /** 直线挪动（横移/后撤），受导航网格约束 */
  protected slide(dirX: number, dirZ: number, speed: number, dt: number): boolean {
    const l = Math.hypot(dirX, dirZ);
    if (l < 1e-4) return false;
    const ok = this.tryMove(this.pos.x + (dirX / l) * speed * dt, this.pos.z + (dirZ / l) * speed * dt);
    if (ok) this.moveSpeed = speed;
    return ok;
  }

  /** 被其他单位挤开 */
  push(dx: number, dz: number): void {
    const nav = this.ctx.nav;
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;
    if (nav.isWalkable(nx, nz, this.stats.navRadius)) {
      this.pos.x = nx;
      this.pos.z = nz;
    }
  }

  // ---------- 开火辅助 ----------
  protected muzzlePos(out: THREE.Vector3): THREE.Vector3 {
    this.rig.root.updateMatrixWorld(true);
    return this.rig.muzzle.getWorldPosition(out);
  }

  /** 向目标点发射弹丸，带与难度相关的散布 */
  protected shootAt(target: THREE.Vector3, kind: 'bolt' | 'rifle' | 'wasp' | 'orb', speed: number, damage: number, color: number, spreadDeg: number, size = 0.08, extra: { homing?: number; splash?: number; splashDamage?: number; life?: number } = {}): void {
    const ctx = this.ctx;
    this.muzzlePos(_a);
    // 枪口若探进了墙体，则改为从眼睛位置发射，避免隔墙射击
    this.eyePos(_b);
    if (!ctx.physics.lineOfSight(_b, _a)) _a.copy(_b);
    const dir = _b.subVectors(target, _a).normalize();
    const sp = (spreadDeg * Math.PI) / 180 / ctx.tuning.enemyAccuracy;
    dir.x += rand(-sp, sp);
    dir.y += rand(-sp, sp) * 0.6;
    dir.z += rand(-sp, sp);
    dir.normalize();
    ctx.projectiles.spawn({ owner: 'enemy', kind, pos: _a, dir, speed, damage, color, size, ...extra });
    ctx.fx.flash(_a, color, kind === 'orb' ? 2.2 : 0.8, 0.07);
  }

  // ---------- 受击 ----------
  /** 子类可覆写以实现装甲/弱点 */
  protected modifyDamage(part: HitPart, damage: number, _dir: THREE.Vector3, source: DamageSource): { damage: number; armor: boolean; crit: boolean } {
    if (part === 'head') return { damage: damage * (source === 'explosion' ? 1 : WEAPONS[source].headMul), armor: false, crit: true };
    if (part === 'weak') return { damage: damage * 2, armor: false, crit: true };
    if (part === 'armor') return { damage: damage * (source === 'explosion' ? 0.6 : WEAPONS[source].armorMul), armor: true, crit: false };
    return { damage, armor: false, crit: false };
  }

  applyHit(part: HitPart, damage: number, point: THREE.Vector3, dir: THREE.Vector3, source: DamageSource): HitResult {
    if (!this.alive || this.spawnT > 0.3) return { killed: false, headshot: false, armor: false };
    const m = this.modifyDamage(part, damage, dir, source);
    this.hp -= m.damage;
    this.hitFlash = 1;
    this.flinch.impulse(clamp(m.damage / 30, 0.3, 1.6) * (m.armor ? 0.4 : 1));
    this.onDamaged(m.damage, part, point);
    if (this.hp <= 0) {
      this.die(dir);
      return { killed: true, headshot: m.crit, armor: m.armor };
    }
    if (!this.engaged) {
      this.engage();
      this.ctx.enemies.alertAllies(this, 22);
    }
    if (this.stats.staggerAt > 0 && m.damage >= this.stats.staggerAt && this.state !== 'stagger') {
      this.staggerDur = clamp(m.damage / 90, 0.3, 0.75);
      this.setState('stagger');
    }
    return { killed: false, headshot: m.crit, armor: m.armor };
  }
  protected onDamaged(_damage: number, _part: HitPart, _point: THREE.Vector3): void {}

  /** 外部强制硬直（EMP 等） */
  stun(dur: number): void {
    if (!this.alive) return;
    this.staggerDur = dur;
    this.stateTime = 0;
    if (this.state !== 'stagger') this.setState('stagger');
  }

  kill(): void {
    if (this.alive) {
      this.hp = 0;
      this.die(_a.set(0, 0, 1));
    }
  }

  protected die(dir: THREE.Vector3): void {
    const ctx = this.ctx;
    this.alive = false;
    this.onExit(this.state);
    this.state = 'dead';
    this.stateTime = 0;
    this.deathT = 0;
    this.deathDir = dir.x * Math.sin(this.yaw) + dir.z * Math.cos(this.yaw) > 0 ? 1 : -1;
    for (const p of this.parts) ctx.physics.removeCollider(p.collider);
    this.parts.length = 0;
    this.center(_a);
    this.deathFx(_a);
    ctx.stats.kills++;
    ctx.enemies.onDeath(this);
  }

  protected deathFx(c: THREE.Vector3): void {
    const ctx = this.ctx;
    const big = this.type === 'juggernaut';
    ctx.fx.explosion(c, big ? 3.2 : 1.5, 0xff8a2a, false);
    ctx.fx.debris(c, big ? 12 : 6, big ? 8 : 6, big ? 1.6 : 1);
    ctx.fx.sparks(c, _b.set(0, 1, 0), 18, 0xffc27a, 8, 1.4, 0.6);
    ctx.gfx.flashLight(c, 0xff8a2a, big ? 90 : 45, big ? 16 : 10, 0.35);
    ctx.audio.enemyDeath(c, big);
    ctx.shake(c, big ? 0.5 : 0.2, big ? 24 : 12);
  }

  // ---------- 主更新 ----------
  update(dt: number): void {
    if (!this.alive) {
      this.updateDead(dt);
      return;
    }
    this.stateTime += dt;
    this.moveSpeed = 0;
    if (this.spawnT > 0) {
      this.spawnT -= dt;
      const k = clamp(1 - this.spawnT / 0.6, 0.05, 1);
      this.rig.root.scale.set(k, 0.2 + k * 0.8, k);
      if (this.spawnT <= 0) this.rig.root.scale.setScalar(1);
    }
    this.perceive(dt);
    switch (this.state) {
      case 'idle':
      case 'patrol':
        this.updatePatrol(dt);
        if (this.canSee) this.setState('alert');
        break;
      case 'alert':
        this.faceTo(this.lastKnown.x, this.lastKnown.z, dt, this.stats.turn * 1.4);
        if (this.stateTime > this.stats.reaction) {
          if (this.canSee || this.ctx.time - this.lastSeen < 1) {
            this.setState('chase');
            this.ctx.enemies.alertAllies(this, 20);
          } else {
            this.searchLeft = 2;
            this.searchPoint.copy(this.lastKnown);
            this.setState('search');
          }
        }
        break;
      case 'search':
        this.updateSearch(dt);
        break;
      case 'stagger':
        if (this.stateTime > this.staggerDur) this.setState('chase');
        break;
      default:
        this.combat(dt);
    }
    this.animate(dt);
    this.syncTransform();
  }

  protected abstract combat(dt: number): void;

  /** 交战中丢失目标时调用：长时间看不到玩家则转入搜索 */
  protected checkLost(timeout = 6): boolean {
    if (!this.canSee && this.ctx.time - this.lastSeen > timeout) {
      this.searchLeft = 3;
      this.searchPoint.copy(this.lastKnown);
      this.setState('search');
      return true;
    }
    return false;
  }

  private updatePatrol(dt: number): void {
    if (this.patrol.length === 0) {
      // 站岗：缓慢左右张望；若离岗则走回去
      if (dist2D(this.pos.x, this.pos.z, this.home.x, this.home.z) > 0.8) this.navigate(this.home.x, this.home.z, this.stats.speed * 0.5, dt);
      else this.yaw = turnToward(this.yaw, this.homeYaw + Math.sin(this.ctx.time * 0.5 + this.id) * 0.8, dt * 0.8);
      return;
    }
    if (this.patrolWait > 0) {
      this.patrolWait -= dt;
      this.yaw += Math.sin(this.ctx.time * 0.9 + this.id) * dt * 0.7;
      return;
    }
    const wp = this.patrol[this.patrolIdx];
    if (this.navigate(wp.x, wp.z, this.stats.speed * 0.42, dt)) {
      this.patrolIdx = (this.patrolIdx + 1) % this.patrol.length;
      this.patrolWait = rand(1.2, 2.8);
    }
  }

  private updateSearch(dt: number): void {
    if (this.canSee && this.stateTime > 0.25) {
      this.setState('chase');
      this.ctx.enemies.alertAllies(this, 16);
      return;
    }
    if (this.navigate(this.searchPoint.x, this.searchPoint.z, this.stats.speed * 0.7, dt)) {
      // 到达可疑点：原地张望，然后换一个附近的点
      this.patrolWait += dt;
      this.yaw += dt * 1.6 * (this.id % 2 ? 1 : -1);
      if (this.patrolWait > 1.6) {
        this.patrolWait = 0;
        this.searchLeft--;
        const p = this.ctx.nav.randomPointNear(this.lastKnown.x, this.lastKnown.z, 3, 9, this.stats.navRadius, _a);
        if (p) this.searchPoint.copy(p);
      }
    }
    if (this.searchLeft <= 0 || this.stateTime > 16) {
      this.patrolWait = 0;
      this.setState(this.patrol.length ? 'patrol' : 'idle');
    }
  }

  // ---------- 动画 ----------
  protected animate(dt: number): void {
    const rig = this.rig;
    const ctx = this.ctx;
    this.flinch.update(dt);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 7);
    this.moveBlend = damp(this.moveBlend, this.moveSpeed > 0.05 ? 1 : 0, 10, dt);
    const stride = this.type === 'juggernaut' ? 1.6 : 1.9;
    const prev = this.walkPhase;
    this.walkPhase += this.moveSpeed * stride * dt;
    if (this.type !== 'wasp' && this.type !== 'boss') {
      const amp = (this.type === 'juggernaut' ? 0.42 : 0.6) * this.moveBlend;
      for (let i = 0; i < rig.legs.length; i++) rig.legs[i].rotation.x = Math.sin(this.walkPhase + i * Math.PI) * amp;
      const stagger = this.state === 'stagger' ? Math.min(1, this.stateTime * 8) : 0;
      rig.body.position.y = this.bodyBaseY + Math.abs(Math.sin(this.walkPhase)) * 0.045 * this.moveBlend - stagger * 0.12 + this.bodyDrop(dt);
      rig.body.rotation.x = -this.flinch.value * 0.16 + this.moveBlend * 0.06 + stagger * 0.3;
      rig.body.rotation.z = Math.sin(this.walkPhase) * 0.035 * this.moveBlend;
      // 脚步声
      const side = Math.sin(this.walkPhase) > 0 ? 1 : 0;
      if (this.moveSpeed > 0.05 && side !== this.stepSide && Math.floor(prev / Math.PI) !== Math.floor(this.walkPhase / Math.PI)) {
        this.onStep();
      }
      this.stepSide = side;
      // 头部/武器俯仰跟随玩家
      let pitch = 0;
      if (this.engaged || this.state === 'alert') {
        const tgtY = ctx.player.pos.y + ctx.player.currentHeight * 0.6;
        pitch = clamp(Math.atan2(tgtY - (this.pos.y + rig.headY), Math.max(1, this.dist)), -0.7, 0.7);
      }
      rig.head.rotation.x = damp(rig.head.rotation.x, -pitch, 8, dt);
      this.animateArms(dt, pitch);
    }
    // 传感器颜色：反映 AI 状态
    const target = this.state === 'idle' || this.state === 'patrol' ? EYE_CALM : this.state === 'alert' || this.state === 'search' ? EYE_ALERT : EYE_HOSTILE;
    const pulse = this.state === 'alert' || this.state === 'search' ? 0.7 + 0.3 * Math.sin(ctx.time * 14) : this.state === 'stagger' ? 0.3 + 0.3 * Math.sin(ctx.time * 40) : 1;
    _c.copy(target).multiplyScalar(pulse);
    if (this.hitFlash > 0) _c.lerp(WHITE, this.hitFlash);
    rig.eyeMat.color.copy(_c);
  }
  protected bodyDrop(_dt: number): number {
    return 0;
  }
  protected animateArms(dt: number, pitch: number): void {
    for (const a of this.rig.arms) a.rotation.x = damp(a.rotation.x, -pitch, 8, dt);
  }
  protected onStep(): void {}

  private updateDead(dt: number): void {
    this.deathT += dt;
    const rig = this.rig;
    const t = this.deathT;
    if (this.type === 'wasp') {
      this.pos.y = Math.max(0.2, this.pos.y - (2 + t * 14) * dt);
      rig.root.rotation.z += dt * 6;
      rig.root.rotation.x += dt * 3;
      rig.root.position.copy(this.pos);
      if (t > 1.2) this.removed = true;
    } else {
      // 倒地：先跪后倒
      const fall = clamp(t / 0.55, 0, 1);
      const e = fall * fall;
      rig.root.rotation.x = e * 1.45 * this.deathDir;
      rig.root.position.y = this.pos.y - e * (this.type === 'juggernaut' ? 0.5 : 0.25);
      for (let i = 0; i < rig.legs.length; i++) rig.legs[i].rotation.x = e * (i % 2 ? 0.9 : -0.5);
      if (fall >= 1 && t - dt < 0.55) {
        this.center(_a);
        _a.y = 0.1;
        this.ctx.fx.smoke(_a, 4, 0.7, { life: 1.2, alpha: 0.25, spread: 0.8 });
        this.ctx.audio.heavyStep(this.pos, this.type === 'juggernaut' ? 1.4 : 0.6);
      }
      if (t < 3 && Math.random() < dt * 5) {
        this.center(_a);
        _a.y = 0.4;
        this.ctx.fx.sparks(_a, _b.set(0, 1, 0), 3, 0x7fd8ff, 3, 1.2, 0.3);
      }
      rig.eyeMat.color.multiplyScalar(Math.max(0, 1 - dt * 4));
      rig.glowMat.color.multiplyScalar(Math.max(0, 1 - dt * 2));
      // 残骸停留一段时间后沉入地面并回收
      if (t > 9) rig.root.position.y -= (t - 9) * 0.9;
      if (t > 10.5) this.removed = true;
    }
  }

  dispose(): void {
    for (const p of this.parts) this.ctx.physics.removeCollider(p.collider);
    this.parts.length = 0;
    this.ctx.gfx.scene.remove(this.rig.root);
    this.rig.dispose();
  }
}
