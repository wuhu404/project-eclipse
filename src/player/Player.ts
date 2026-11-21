import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp, Spring } from '../core/math';
import { G, groups, RAPIER } from '../physics/Physics';

const STAND_H = 1.8;
const CROUCH_H = 1.1;
const RADIUS = 0.35;
const EYE_STAND = 1.62;
const EYE_CROUCH = 0.98;
const WALK = 5.2;
const SPRINT = 7.8;
const CROUCH = 2.6;
const ADS_SPEED = 3.4;
const JUMP_V = 7.2;
const GRAVITY = 22;
const SLIDE_SPEED = 10.5;
const SLIDE_TIME = 0.8;

const _wish = new THREE.Vector3();
const _move = { x: 0, y: 0, z: 0 };
const _tmp = new THREE.Vector3();

/**
 * 第一人称角色控制器：Rapier KinematicCharacterController 负责碰撞/台阶/贴地，
 * 这里实现加速度、摩擦、空中控制、冲刺、蹲伏、滑铲、跳跃，以及所有相机反馈。
 */
export class Player {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  health = 100;
  maxHealth = 100;
  armor = 0;
  maxArmor = 100;
  alive = true;
  grounded = false;
  crouching = false;
  sliding = false;
  sprinting = false;
  /** 输入是否生效（过场、死亡时关闭） */
  controlEnabled = true;
  /** 由武器系统设置：0..1 的开镜程度与目标 FOV 缩放 */
  adsAmount = 0;
  adsZoom = 1;
  hasKeycard = false;
  /** 无敌（过场/测试） */
  godMode = false;

  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  private kcc: RAPIER.KinematicCharacterController;
  private height = STAND_H;
  private eye = EYE_STAND;
  private coyote = 0;
  private jumpBuffer = 0;
  private slideTimer = 0;
  private slideCooldown = 0;
  private slideDir = new THREE.Vector3();
  private airTime = 0;
  private bobPhase = 0;
  private bobAmp = 0;
  private stepAcc = 0;
  private lastDamageTime = -99;
  private heartbeatTimer = 0;
  private fovCurrent = 90;
  // 相机反馈
  private landSpring = new Spring(140, 13);
  recoilPitch = new Spring(95, 13);
  recoilYaw = new Spring(95, 13);
  private rollSpring = new Spring(90, 14);
  private trauma = 0;
  private shakeT = 0;
  private hitKickPitch = new Spring(160, 14);
  private hitKickRoll = new Spring(160, 14);
  /** 供武器晃动使用 */
  bobX = 0;
  bobY = 0;
  landOffset = 0;
  speed2D = 0;
  private surface: 'metal' | 'dirt' = 'metal';
  private deathRoll = 0;
  /** 脚下所处区域（由关卡每帧写入） */
  zone = 0;

  constructor(private ctx: Ctx) {
    const world = ctx.physics.world;
    this.body = world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(0, 2, 0));
    const hh = STAND_H / 2 - RADIUS;
    this.collider = world.createCollider(
      RAPIER.ColliderDesc.capsule(hh, RADIUS).setCollisionGroups(groups(G.PLAYER, G.WORLD | G.PROP)).setFriction(0),
      this.body,
    );
    ctx.physics.tag(this.collider, { kind: 'player' });
    this.kcc = world.createCharacterController(0.02);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.enableAutostep(0.42, 0.25, false);
    this.kcc.enableSnapToGround(0.35);
    this.kcc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.kcc.setMinSlopeSlideAngle((40 * Math.PI) / 180);
    this.kcc.setSlideEnabled(true);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
  }

  get eyeHeight(): number {
    return this.eye;
  }

  /** 身体中心（敌人瞄准用） */
  center(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.height * 0.55, this.pos.z);
  }

  eyePos(out: THREE.Vector3): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.eye, this.pos.z);
  }

  get currentHeight(): number {
    return this.height;
  }
  get radius(): number {
    return RADIUS;
  }

  teleport(x: number, y: number, z: number, yaw: number): void {
    this.pos.set(x, y, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
    this.setHeight(STAND_H);
    this.crouching = false;
    this.sliding = false;
    this.body.setTranslation({ x, y: y + this.height / 2, z }, true);
    this.body.setNextKinematicTranslation({ x, y: y + this.height / 2, z });
    this.eye = EYE_STAND;
    this.landSpring.reset();
    this.recoilPitch.reset();
    this.recoilYaw.reset();
    this.rollSpring.reset();
    this.hitKickPitch.reset();
    this.hitKickRoll.reset();
    this.trauma = 0;
    this.syncCamera(0);
  }

  reset(): void {
    this.health = this.maxHealth;
    this.armor = 0;
    this.alive = true;
    this.hasKeycard = false;
    this.controlEnabled = true;
    this.trauma = 0;
    this.lastDamageTime = -99;
    this.deathRoll = 0;
    this.adsAmount = 0;
  }

  private setHeight(h: number): void {
    if (Math.abs(h - this.height) < 1e-4) return;
    this.height = h;
    this.collider.setHalfHeight(h / 2 - RADIUS);
    // 胶囊高度变化后立刻把刚体中心移到新位置并同步碰撞体，否则本帧胶囊会悬空（滑铲会被判定为离地而中断）
    this.body.setTranslation({ x: this.pos.x, y: this.pos.y + h / 2, z: this.pos.z }, true);
    this.ctx.physics.world.propagateModifiedBodyPositionsToColliders();
  }

  /** 头顶是否有空间站起来 */
  private canStand(): boolean {
    const origin = _tmp.set(this.pos.x, this.pos.y + CROUCH_H - 0.1, this.pos.z);
    const hit = this.ctx.physics.raycast(origin, new THREE.Vector3(0, 1, 0), STAND_H - CROUCH_H + 0.15, groups(0xffff, G.WORLD | G.PROP));
    return !hit;
  }

  addShake(amount: number): void {
    this.trauma = Math.min(1, this.trauma + amount * this.ctx.settings.data.screenShake);
  }

  /** 武器后坐力：向上/水平踢动视角（弹簧自动回正） */
  kick(pitch: number, yaw: number): void {
    this.recoilPitch.impulse(pitch);
    this.recoilYaw.impulse(yaw);
  }

  heal(amount: number): boolean {
    if (this.health >= this.maxHealth) return false;
    this.health = Math.min(this.maxHealth, this.health + amount);
    return true;
  }

  addArmor(amount: number): boolean {
    if (this.armor >= this.maxArmor) return false;
    this.armor = Math.min(this.maxArmor, this.armor + amount);
    return true;
  }

  /** 受到伤害。source 用于 HUD 受击方向指示。 */
  damage(amount: number, source: THREE.Vector3 | null): void {
    if (!this.alive || this.godMode) return;
    const ctx = this.ctx;
    amount *= ctx.tuning.enemyDamage;
    let toArmor = 0;
    if (this.armor > 0) {
      toArmor = Math.min(this.armor, amount * 0.6);
      this.armor -= toArmor;
    }
    const toHealth = amount - toArmor;
    this.health -= toHealth;
    ctx.stats.damageTaken += amount;
    this.lastDamageTime = ctx.time;
    const strength = clamp(amount / 30, 0.25, 1);
    ctx.gfx.fx.damage = Math.min(1, ctx.gfx.fx.damage + strength * 0.75);
    if (toArmor > 0) ctx.gfx.fx.shield = Math.min(1, ctx.gfx.fx.shield + 0.7);
    this.addShake(strength * 0.35);
    this.hitKickPitch.impulse(strength * 1.6 * (Math.random() < 0.5 ? -1 : 1));
    this.hitKickRoll.impulse(strength * 2.4 * (Math.random() < 0.5 ? -1 : 1));
    ctx.audio.playerHurt(toArmor > toHealth);
    if (source) ctx.hud.damageIndicator(source);
    if (this.health <= 0) {
      this.health = 0;
      this.alive = false;
      this.controlEnabled = false;
      ctx.audio.playerDeath();
    }
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const s = ctx.settings.data;
    const control = this.controlEnabled && this.alive;

    // ---------- 视角 ----------
    if (control) {
      const sens = 0.0022 * s.sensitivity * (1 - this.adsAmount + this.adsAmount * s.adsSensitivity / Math.max(1, this.adsZoom * 0.85));
      this.yaw -= input.mouseDX * sens;
      this.pitch -= input.mouseDY * sens * (s.invertY ? -1 : 1);
      this.pitch = clamp(this.pitch, -1.5, 1.5);
    }

    // ---------- 输入方向 ----------
    let ix = 0;
    let iz = 0;
    if (control) {
      if (input.isDown('KeyW')) iz -= 1;
      if (input.isDown('KeyS')) iz += 1;
      if (input.isDown('KeyA')) ix -= 1;
      if (input.isDown('KeyD')) ix += 1;
    }
    const il = Math.hypot(ix, iz);
    if (il > 0) {
      ix /= il;
      iz /= il;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    _wish.set(ix * cos + iz * sin, 0, -ix * sin + iz * cos);

    const wantCrouch = control && (input.isDown('ControlLeft') || input.isDown('KeyC') || input.isDown('ControlRight'));
    const crouchPressed = control && (input.wasPressed('ControlLeft') || input.wasPressed('KeyC') || input.wasPressed('ControlRight'));
    const wantSprint = control && input.isDown('ShiftLeft') && iz < 0 && this.adsAmount < 0.3;

    // ---------- 滑铲 / 蹲伏 ----------
    this.slideCooldown -= dt;
    const hSpeed = Math.hypot(this.vel.x, this.vel.z);
    if (crouchPressed && this.grounded && this.sprinting && hSpeed > WALK * 0.95 && this.slideCooldown <= 0 && !this.sliding) {
      this.sliding = true;
      this.slideTimer = SLIDE_TIME;
      this.slideCooldown = 1.1;
      this.slideDir.set(this.vel.x, 0, this.vel.z).normalize();
      this.vel.x = this.slideDir.x * SLIDE_SPEED;
      this.vel.z = this.slideDir.z * SLIDE_SPEED;
      ctx.audio.slide();
      this.rollSpring.impulse(-3.5);
    }
    if (this.sliding) {
      this.slideTimer -= dt;
      if (this.slideTimer <= 0 || !this.grounded || hSpeed < 2.5 || (!wantCrouch && this.slideTimer < SLIDE_TIME - 0.25)) this.sliding = false;
    }
    if (wantCrouch || this.sliding) this.crouching = true;
    else if (this.crouching && this.canStand()) this.crouching = false;
    this.setHeight(this.crouching ? CROUCH_H : STAND_H);
    this.sprinting = wantSprint && this.grounded && !this.crouching;

    // ---------- 水平速度 ----------
    let maxSpeed = this.crouching ? CROUCH : this.sprinting ? SPRINT : WALK;
    if (this.adsAmount > 0.5 && !this.crouching) maxSpeed = Math.min(maxSpeed, ADS_SPEED);
    if (iz > 0 && !this.crouching) maxSpeed *= 0.82; // 后退略慢
    if (this.sliding) {
      // 滑铲：沿滑行方向保持惯性，带少量转向
      const decel = 6.5 * dt;
      const sp = Math.max(0, Math.hypot(this.vel.x, this.vel.z) - decel); // 用当前速度（含滑铲起步的加速），而不是帧初速度
      this.slideDir.addScaledVector(_wish, dt * 1.6).normalize();
      this.vel.x = this.slideDir.x * sp;
      this.vel.z = this.slideDir.z * sp;
    } else if (this.grounded) {
      // 加速度必须大于「摩擦 x 最高速度」，否则达不到冲刺速度
      const accel = il > 0 ? (this.sprinting ? 96 : 62) : 0;
      const friction = il > 0 ? 9 : 13;
      // 摩擦
      const sp = Math.hypot(this.vel.x, this.vel.z);
      if (sp > 0) {
        const drop = Math.max(sp, 1.6) * friction * dt;
        const k = Math.max(0, sp - drop) / sp;
        this.vel.x *= k;
        this.vel.z *= k;
      }
      // 加速（Quake 式：只在期望方向上补足速度）
      const cur = this.vel.x * _wish.x + this.vel.z * _wish.z;
      const add = clamp(maxSpeed - cur, 0, accel * dt);
      this.vel.x += _wish.x * add;
      this.vel.z += _wish.z * add;
    } else {
      // 空中控制
      const cur = this.vel.x * _wish.x + this.vel.z * _wish.z;
      const airMax = Math.max(maxSpeed * 0.75, 1);
      const add = clamp(airMax - cur, 0, 16 * dt);
      this.vel.x += _wish.x * add;
      this.vel.z += _wish.z * add;
      const sp = Math.hypot(this.vel.x, this.vel.z);
      const cap = Math.max(SLIDE_SPEED, SPRINT * 1.05);
      if (sp > cap) {
        this.vel.x *= cap / sp;
        this.vel.z *= cap / sp;
      }
    }

    // ---------- 跳跃 / 重力 ----------
    this.coyote = this.grounded ? 0.12 : this.coyote - dt;
    this.jumpBuffer = control && input.wasPressed('Space') ? 0.13 : this.jumpBuffer - dt;
    if (this.jumpBuffer > 0 && this.coyote > 0 && (this.canStand() || !this.crouching)) {
      this.vel.y = JUMP_V;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.grounded = false;
      if (this.sliding) {
        this.sliding = false;
      }
      this.crouching = false;
      ctx.audio.jump();
      this.landSpring.impulse(0.9);
    }
    if (!this.grounded) this.vel.y -= GRAVITY * dt;
    else if (this.vel.y < 0) this.vel.y = -2; // 贴地
    this.vel.y = Math.max(this.vel.y, -45);

    // ---------- 碰撞移动 ----------
    _move.x = this.vel.x * dt;
    _move.y = this.vel.y * dt;
    _move.z = this.vel.z * dt;
    const wasGrounded = this.grounded;
    const fallSpeed = -this.vel.y;
    if (this.vel.y > 0.5) this.kcc.disableSnapToGround();
    else this.kcc.enableSnapToGround(0.35);
    this.kcc.computeColliderMovement(this.collider, _move, undefined, groups(G.PLAYER, G.WORLD | G.PROP));
    const m = this.kcc.computedMovement();
    this.grounded = this.kcc.computedGrounded() && this.vel.y <= 0.5;
    // 被墙/天花板挡住时修正速度，避免"贴墙蓄力"
    if (dt > 0) {
      const ax = m.x / dt;
      const az = m.z / dt;
      if (Math.abs(ax) < Math.abs(this.vel.x)) this.vel.x = ax;
      if (Math.abs(az) < Math.abs(this.vel.z)) this.vel.z = az;
      if (this.vel.y > 0 && m.y < _move.y * 0.5) this.vel.y = 0;
    }
    this.pos.x += m.x;
    this.pos.y += m.y;
    this.pos.z += m.z;
    // 防止异常跌出世界
    if (this.pos.y < -30) {
      this.pos.y = 2;
      this.vel.set(0, 0, 0);
      const safe = ctx.nav.nearestWalkable(this.pos.x, this.pos.z, 0.5, 30);
      if (safe) {
        this.pos.x = safe.x;
        this.pos.z = safe.z;
      }
    }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + this.height / 2, z: this.pos.z });

    // ---------- 落地反馈 ----------
    if (!wasGrounded && this.grounded) {
      const impact = clamp((fallSpeed - 3) / 14, 0, 1);
      if (this.airTime > 0.18) {
        this.landSpring.impulse(-(1.4 + impact * 5.5));
        ctx.audio.land(impact);
        if (impact > 0.35) this.addShake(impact * 0.3);
        // 坠落伤害（只在很高处才触发）
        if (fallSpeed > 19) this.damage((fallSpeed - 19) * 5, null);
      }
      this.airTime = 0;
    }
    if (!this.grounded) this.airTime += dt;

    // ---------- 步伐 / 晃动 ----------
    this.speed2D = Math.hypot(this.vel.x, this.vel.z);
    this.surface = this.zone === 0 ? 'dirt' : 'metal';
    const moving = this.grounded && this.speed2D > 0.8 && !this.sliding;
    const targetAmp = moving ? clamp(this.speed2D / SPRINT, 0.25, 1) : 0;
    this.bobAmp = damp(this.bobAmp, targetAmp, 9, dt);
    if (moving) {
      const stride = this.sprinting ? 2.5 : this.crouching ? 1.5 : 2.1;
      this.bobPhase += (this.speed2D / stride) * Math.PI * dt;
      this.stepAcc += (this.speed2D / stride) * dt;
      if (this.stepAcc >= 1) {
        this.stepAcc -= 1;
        ctx.audio.footstep(this.surface, this.sprinting);
      }
    } else {
      this.stepAcc = Math.min(this.stepAcc, 0.6);
    }
    const bobOn = s.viewBob ? 1 : 0.25;
    const adsDamp = 1 - this.adsAmount * 0.75;
    this.bobX = Math.cos(this.bobPhase) * this.bobAmp * bobOn * adsDamp;
    this.bobY = Math.abs(Math.sin(this.bobPhase)) * this.bobAmp * bobOn * adsDamp;

    // ---------- 弹簧 ----------
    this.landSpring.update(dt);
    this.recoilPitch.update(dt);
    this.recoilYaw.update(dt);
    this.hitKickPitch.update(dt);
    this.hitKickRoll.update(dt);
    // 横移倾斜
    const strafe = -(this.vel.x * cos - this.vel.z * sin) / SPRINT;
    this.rollSpring.target = clamp(strafe, -1, 1) * 1.3 + (this.sliding ? -4.5 : 0);
    this.rollSpring.update(dt);
    this.landOffset = this.landSpring.value * 0.035;

    // ---------- 低血量回复 / 心跳 ----------
    if (this.alive && this.health < 30 && ctx.time - this.lastDamageTime > 5) {
      this.health = Math.min(30, this.health + 6 * dt);
    }
    const low = this.alive ? clamp(1 - this.health / 35, 0, 1) : 0;
    ctx.gfx.fx.lowHealth = damp(ctx.gfx.fx.lowHealth, low, 4, dt);
    if (low > 0.2) {
      this.heartbeatTimer -= dt;
      if (this.heartbeatTimer <= 0) {
        ctx.audio.heartbeat();
        this.heartbeatTimer = 1.05 - low * 0.35;
      }
    }

    this.trauma = Math.max(0, this.trauma - dt * 1.5);
    this.syncCamera(dt);
  }

  /** 把玩家状态写入相机（包含所有附加反馈） */
  syncCamera(dt: number): void {
    const ctx = this.ctx;
    const cam = ctx.gfx.camera;
    const targetEye = !this.alive ? 0.38 : this.sliding ? EYE_CROUCH - 0.22 : this.crouching ? EYE_CROUCH : EYE_STAND;
    this.deathRoll = dt > 0 ? damp(this.deathRoll, this.alive ? 0 : 0.55, 3, dt) : this.alive ? 0 : this.deathRoll;
    this.eye = dt > 0 ? damp(this.eye, targetEye, this.alive ? 13 : 4, dt) : targetEye;

    this.shakeT += dt * 38;
    const sh = this.trauma * this.trauma;
    const shakeYaw = sh * 0.035 * Math.sin(this.shakeT * 1.13 + 1.7) * Math.cos(this.shakeT * 0.71);
    const shakePitch = sh * 0.035 * Math.sin(this.shakeT * 0.93 + 0.3);
    const shakeRoll = sh * 0.05 * Math.sin(this.shakeT * 1.31 + 4.1);
    const D2R = Math.PI / 180;

    cam.position.set(
      this.pos.x + Math.cos(this.yaw) * this.bobX * 0.022,
      this.pos.y + this.eye + this.bobY * 0.045 + this.landOffset,
      this.pos.z - Math.sin(this.yaw) * this.bobX * 0.022,
    );
    cam.rotation.set(
      this.pitch + (this.recoilPitch.value + this.hitKickPitch.value) * D2R + shakePitch + this.landSpring.value * 0.004,
      this.yaw + this.recoilYaw.value * D2R + shakeYaw,
      (this.rollSpring.value + this.hitKickRoll.value) * D2R + shakeRoll + this.bobX * 0.0035 + this.deathRoll,
      'YXZ',
    );

    // FOV：冲刺拉宽、开镜收窄
    const base = ctx.settings.data.fov;
    const sprintBoost = this.sprinting ? 7 : this.sliding ? 10 : 0;
    const zoomed = (2 * Math.atan(Math.tan((base * D2R) / 2) / this.adsZoom)) / D2R;
    const target = base + sprintBoost + (zoomed - base) * this.adsAmount;
    this.fovCurrent = dt > 0 ? damp(this.fovCurrent, target, 12, dt) : target;
    if (Math.abs(cam.fov - this.fovCurrent) > 0.01) {
      cam.fov = this.fovCurrent;
      cam.updateProjectionMatrix();
    }
    cam.updateMatrixWorld(true);
  }

  /** 视线方向（不含后坐力以外的抖动） */
  aimDirection(out: THREE.Vector3): THREE.Vector3 {
    return this.ctx.gfx.camera.getWorldDirection(out);
  }

  dispose(): void {
    const world = this.ctx.physics.world;
    world.removeCharacterController(this.kcc);
    this.ctx.physics.removeBody(this.body);
  }
}
