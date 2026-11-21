import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp, easeInOut, rand, Spring, spreadDirection } from '../core/math';
import { ColliderTag, QUERY, RayHit } from '../physics/Physics';
import { WeaponDef, WeaponId, WEAPON_ORDER, WEAPONS } from './WeaponDefs';
import { buildWeaponView, createWeaponMats, disposeWeaponMats, WeaponMats, WeaponView } from './WeaponModels';

interface WeaponState {
  owned: boolean;
  mag: number;
  reserve: number;
  heat: number;
  overheat: number;
  lastShot: number;
}

interface Shell {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
}

const D2R = Math.PI / 180;
const _origin = new THREE.Vector3();
const _aim = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _end = new THREE.Vector3();
const _muzzle = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _c = new THREE.Color();
const HEAT_COLD = new THREE.Color(0x35e0ff);
const HEAT_HOT = new THREE.Color(0xff5a1a);

/**
 * 武器系统：射击判定、弹药/热量、换弹、切枪，以及第一人称视图模型的全部程序化动画
 * （后坐力弹簧、鼠标惯性晃动、步伐摆动、开镜、冲刺收枪、换弹分段动作、枪口火焰、抛壳）。
 */
export class WeaponSystem {
  state: Record<WeaponId, WeaponState>;
  current: WeaponId = 'ar9';
  private pending: WeaponId | null = null;
  private views: Record<WeaponId, WeaponView>;
  private pivot = new THREE.Group();
  private flash: THREE.Mesh[] = [];
  private flashMat: THREE.MeshBasicMaterial;
  private flashGeo: THREE.PlaneGeometry;
  private flashTime = 0;
  private shells: Shell[] = [];
  private shellGeo: THREE.CylinderGeometry;
  private wm: WeaponMats;
  private cooldown = 0;
  private spread = 0;
  private ads = 0;
  private switchT = 1; // 0 = 完全放下, 1 = 就绪
  private reloadT = -1; // <0 表示未在换弹
  private reloadStage = 0;
  private pumpT = -1;
  private sprintBlend = 0;
  private kickZ = new Spring(210, 17);
  private kickRot = new Spring(190, 15);
  private kickRoll = new Spring(170, 12);
  private swayX = new Spring(70, 11);
  private swayY = new Spring(70, 11);
  private triggerHeld = false;
  /** 当前准星扩散（度），HUD 读取 */
  crosshairSpread = 1;
  /** 最近一次开火时间（HUD 准星脉冲） */
  lastFireTime = -1;
  enabled = true;

  constructor(private ctx: Ctx) {
    const mk = (id: WeaponId): WeaponState => ({ owned: false, mag: WEAPONS[id].magSize, reserve: WEAPONS[id].reserveStart, heat: 0, overheat: 0, lastShot: -9 });
    this.state = { ar9: mk('ar9'), viper: mk('viper'), helix: mk('helix') };
    this.state.ar9.owned = true;
    ctx.gfx.weaponCamera.add(this.pivot);
    this.wm = createWeaponMats();
    this.views = { ar9: buildWeaponView('ar9', this.wm), viper: buildWeaponView('viper', this.wm), helix: buildWeaponView('helix', this.wm) };
    for (const id of WEAPON_ORDER) {
      this.views[id].root.visible = id === this.current;
      this.pivot.add(this.views[id].root);
    }
    // 枪口火焰：两个交叉面片 + 一个正对相机的面片
    this.flashGeo = new THREE.PlaneGeometry(1, 1);
    this.flashMat = new THREE.MeshBasicMaterial({ map: ctx.mats.tex.muzzle, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, depthTest: false, side: THREE.DoubleSide, toneMapped: false, fog: false });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(this.flashGeo, this.flashMat);
      m.layers.set(1);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 40;
      ctx.gfx.weaponCamera.add(m);
      this.flash.push(m);
    }
    this.shellGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.022, 6);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(this.shellGeo, this.wm.brass);
      mesh.layers.set(1);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.pivot.add(mesh);
      this.shells.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0 });
    }
  }

  get def(): WeaponDef {
    return WEAPONS[this.current];
  }
  get cur(): WeaponState {
    return this.state[this.current];
  }
  get reloading(): boolean {
    return this.reloadT >= 0;
  }
  get adsAmount(): number {
    return this.ads;
  }
  get heat01(): number {
    return this.state.helix.heat / 100;
  }
  get overheated(): boolean {
    return this.state.helix.overheat > 0;
  }

  // ---------- 持有 / 弹药 ----------
  give(id: WeaponId, autoSwitch = true): void {
    const s = this.state[id];
    if (!s.owned) {
      s.owned = true;
      s.mag = WEAPONS[id].magSize;
      s.reserve = Math.max(s.reserve, WEAPONS[id].reserveStart);
      if (autoSwitch) this.switchTo(id);
    } else this.addAmmo(id, WEAPONS[id].magSize * 2);
  }

  addAmmo(id: WeaponId, amount: number): boolean {
    const s = this.state[id];
    const d = WEAPONS[id];
    if (d.magSize === 0 || s.reserve >= d.reserveMax) return false;
    s.reserve = Math.min(d.reserveMax, s.reserve + amount);
    return true;
  }

  exportState(): { weapons: string[]; ammo: Record<string, { mag: number; reserve: number }> } {
    const weapons = WEAPON_ORDER.filter((id) => this.state[id].owned);
    const ammo: Record<string, { mag: number; reserve: number }> = {};
    for (const id of WEAPON_ORDER) ammo[id] = { mag: this.state[id].mag, reserve: this.state[id].reserve };
    return { weapons, ammo };
  }

  importState(weapons: string[], ammo: Record<string, { mag: number; reserve: number }>): void {
    for (const id of WEAPON_ORDER) {
      const s = this.state[id];
      s.owned = weapons.includes(id) || id === 'ar9';
      s.mag = ammo[id]?.mag ?? WEAPONS[id].magSize;
      s.reserve = ammo[id]?.reserve ?? WEAPONS[id].reserveStart;
      s.heat = 0;
      s.overheat = 0;
    }
    this.setCurrent(this.state[this.current].owned ? this.current : 'ar9');
  }

  reset(): void {
    this.importState(['ar9'], {});
    this.setCurrent('ar9');
  }

  private setCurrent(id: WeaponId): void {
    this.current = id;
    this.pending = null;
    this.switchT = 0;
    this.reloadT = -1;
    this.pumpT = -1;
    this.cooldown = 0.25;
    for (const w of WEAPON_ORDER) this.views[w].root.visible = w === id;
    for (const s of [this.kickZ, this.kickRot, this.kickRoll]) s.reset();
  }

  switchTo(id: WeaponId): void {
    if (!this.state[id].owned || id === this.current || this.pending === id) return;
    this.pending = id;
    this.reloadT = -1;
    this.ctx.audio.weaponSwitch();
  }

  // ---------- 命中处理（玩家的所有伤害来源统一经过这里） ----------
  resolveHit(hit: RayHit, damage: number, dir: THREE.Vector3, source: WeaponId): void {
    const ctx = this.ctx;
    const tag = hit.tag;
    if (tag.kind === 'enemy') {
      const res = ctx.enemies.applyHit(tag, damage, hit.point, dir, source);
      ctx.fx.impact(hit.point, hit.normal, res.armor ? 'armor' : 'enemy', source === 'viper' ? 0.7 : 1);
      ctx.audio.enemyHit(hit.point);
      ctx.hud.hitMarker(res.headshot, res.killed);
      ctx.audio.hitMarker(res.headshot);
      ctx.stats.shotsHit++;
      if (res.headshot) ctx.stats.headshots++;
      if (res.killed) {
        ctx.audio.killConfirm();
        ctx.hitStop(0.05, 0.25);
      }
    } else if (tag.kind === 'barrel') {
      ctx.level.damageBarrel(tag.id, damage);
      ctx.fx.impact(hit.point, hit.normal, 'metal');
      ctx.audio.impact(hit.point, 'metal');
      ctx.hud.hitMarker(false, false);
    } else if (tag.kind === 'prop') {
      ctx.level.hitProp(tag.id, damage, hit.point);
      ctx.fx.impact(hit.point, hit.normal, 'energy', 0.6);
      ctx.hud.hitMarker(false, false);
      ctx.audio.hitMarker(false);
      ctx.stats.shotsHit++;
    } else if (source !== 'helix') {
      const dirt = ctx.player.zone === 0 && hit.normal.y > 0.7 && hit.point.y < 0.3;
      ctx.fx.impact(hit.point, hit.normal, dirt ? 'dirt' : 'metal', source === 'viper' ? 0.75 : 1);
      ctx.audio.impact(hit.point, 'metal');
    }
  }

  /** Helix 溅射 */
  splash(point: THREE.Vector3, radius: number, damage: number, exclude: ColliderTag): void {
    this.ctx.enemies.damageInRadius(point, radius, damage, 'helix', exclude.kind === 'enemy' ? exclude.id : -1);
  }

  private worldMuzzle(out: THREE.Vector3): THREE.Vector3 {
    const cam = this.ctx.gfx.camera;
    _right.setFromMatrixColumn(cam.matrixWorld, 0);
    _up.setFromMatrixColumn(cam.matrixWorld, 1);
    cam.getWorldDirection(_aim);
    const side = 0.14 * (1 - this.ads);
    return out.copy(cam.position).addScaledVector(_right, side).addScaledVector(_up, -0.11 + this.ads * 0.04).addScaledVector(_aim, 0.75);
  }

  private fire(): void {
    const ctx = this.ctx;
    const d = this.def;
    const s = this.cur;
    const player = ctx.player;
    this.cooldown = 60 / d.rpm;
    s.lastShot = ctx.time;
    this.lastFireTime = ctx.time;
    ctx.stats.shotsFired++;
    if (d.magSize > 0) s.mag--;
    else {
      s.heat += d.heatPerShot;
      if (s.heat >= 100) {
        s.heat = 100;
        s.overheat = d.overheatTime;
        ctx.audio.helixOverheat();
      }
    }

    const cam = ctx.gfx.camera;
    _origin.copy(cam.position);
    cam.getWorldDirection(_aim);
    const moving = clamp(player.speed2D / 5.2, 0, 1) * d.moveSpread + (player.grounded ? 0 : d.moveSpread * 1.5);
    const spreadDeg = (this.spread + moving) * (1 - this.ads + this.ads * d.adsSpreadMul) * (player.crouching ? 0.75 : 1);
    this.worldMuzzle(_muzzle);

    if (d.projectileSpeed > 0) {
      spreadDirection(_aim, spreadDeg * D2R, _dir);
      // 让能量弹从枪口飞出但汇聚到准星指向的点
      const hit = ctx.physics.raycast(_origin, _dir, d.range, QUERY.PLAYER_SHOT);
      _end.copy(_origin).addScaledVector(_dir, hit ? Math.max(hit.distance, 3) : 80);
      _dir.subVectors(_end, _muzzle).normalize();
      ctx.projectiles.spawn({ owner: 'player', kind: 'helix', pos: _muzzle, dir: _dir, speed: d.projectileSpeed, damage: d.damage, color: d.tracerColor, size: 0.085, life: 3, splash: d.splash, splashDamage: d.splashDamage });
      ctx.fx.energyBurst(_end.copy(_muzzle).addScaledVector(_dir, 0.5), d.muzzleColor, 4, 2.5, 0.035, 0.18);
    } else {
      for (let i = 0; i < d.pellets; i++) {
        spreadDirection(_aim, spreadDeg * D2R * (d.pellets > 1 ? Math.sqrt(Math.random()) : 1), _dir);
        const hit = ctx.physics.raycast(_origin, _dir, d.range, QUERY.PLAYER_SHOT);
        if (hit) {
          _end.copy(hit.point);
          const fall = d.falloffMin + (1 - d.falloffMin) * (1 - clamp((hit.distance - d.falloffStart) / (d.falloffEnd - d.falloffStart), 0, 1));
          this.resolveHit(hit, d.damage * fall, _dir, d.id);
        } else _end.copy(_origin).addScaledVector(_dir, d.range);
        if (d.pellets === 1 || i % 2 === 0) ctx.fx.tracer(_muzzle, _end, d.tracerColor, d.pellets > 1 ? 0.03 : 0.045, 260, d.pellets > 1 ? 4 : 8);
      }
    }

    // ----- 反馈 -----
    this.spread = Math.min(d.spreadMax, this.spread + d.spreadPerShot);
    const adsK = 1 - this.ads * 0.45;
    player.kick(d.recoilPitch * adsK * rand(0.85, 1.15), rand(-d.recoilYaw, d.recoilYaw) * adsK);
    this.kickZ.impulse(d.kickBack * 26 * (1 - this.ads * 0.35));
    this.kickRot.impulse(d.kickRot * 24 * (1 - this.ads * 0.5));
    this.kickRoll.impulse(rand(-1, 1) * d.kickRot * 9);
    player.addShake(d.shake);
    this.flashTime = d.id === 'helix' ? 0.07 : 0.045;
    const fm = this.flashMat;
    fm.color.setHex(d.muzzleColor).multiplyScalar(1.5);
    const fs = (d.id === 'viper' ? 0.15 : d.id === 'helix' ? 0.1 : 0.12) * (1 - this.ads * 0.35);
    this.flash.forEach((m, i) => {
      m.visible = true;
      m.scale.setScalar(fs * rand(0.8, 1.25));
      m.rotation.set(0, i === 2 ? 0 : Math.PI / 2, rand(0, 6.28));
      if (i === 1) m.rotation.set(Math.PI / 2, 0, rand(0, 6.28));
    });
    const ml = ctx.gfx.muzzleLight;
    ml.color.setHex(d.muzzleColor);
    ml.intensity = d.id === 'viper' ? 34 : 20;
    ml.position.copy(_muzzle);
    if (d.id === 'ar9') {
      ctx.audio.fireRifle();
      this.ejectShell(0);
    } else if (d.id === 'viper') {
      ctx.audio.fireShotgun();
      this.pumpT = 0;
      ctx.fx.smoke(_end.copy(_muzzle).addScaledVector(_aim, 0.6), 2, 0.2, { dir: _aim, speed: 3, life: 0.5, alpha: 0.12 });
    } else ctx.audio.fireHelix(s.heat / 100);
    ctx.enemies.alertNear(player.pos, d.id === 'helix' ? 26 : 38);
  }

  private ejectShell(kind: number): void {
    const v = this.views[this.current];
    if (!v.eject) return;
    const sh = this.shells.find((x) => x.life <= 0) ?? this.shells[0];
    sh.life = 0.7;
    sh.mesh.visible = true;
    v.eject.getWorldPosition(_end);
    this.pivot.worldToLocal(_end);
    sh.mesh.position.copy(_end);
    sh.mesh.scale.setScalar(kind === 1 ? 2.1 : 1);
    sh.vel.set(rand(0.9, 1.5), rand(0.9, 1.5), rand(0.1, 0.5));
    sh.spin.set(rand(-25, 25), rand(-25, 25), rand(-25, 25));
  }

  private startReload(): void {
    const d = this.def;
    const s = this.cur;
    if (this.reloading || this.pending) return;
    if (d.magSize === 0) {
      // Helix：手动排热
      if (s.heat > 15 && s.overheat <= 0) {
        s.overheat = d.reloadTime;
        this.ctx.audio.reload('cell');
      }
      return;
    }
    if (s.mag >= d.magSize || s.reserve <= 0) return;
    this.reloadT = 0;
    this.reloadStage = 0;
  }

  private updateReload(dt: number): void {
    const d = this.def;
    const s = this.cur;
    const audio = this.ctx.audio;
    this.reloadT += dt;
    const t = this.reloadT / d.reloadTime;
    if (d.shellReload) {
      if (this.reloadStage === 0 && t > 0.45) {
        this.reloadStage = 1;
        s.mag++;
        s.reserve--;
        audio.reload('shell');
      }
      if (t >= 1) {
        if (s.mag < d.magSize && s.reserve > 0) {
          this.reloadT = 0;
          this.reloadStage = 0;
        } else {
          this.reloadT = -1;
          this.pumpT = 0;
          audio.shotgunPump();
          this.cooldown = 0.4;
        }
      }
      return;
    }
    if (this.reloadStage === 0 && t > 0.14) {
      this.reloadStage = 1;
      audio.reload('magOut');
    } else if (this.reloadStage === 1 && t > 0.56) {
      this.reloadStage = 2;
      audio.reload('magIn');
    } else if (this.reloadStage === 2 && t > 0.8) {
      this.reloadStage = 3;
      audio.reload('bolt');
      const need = d.magSize - s.mag;
      const take = Math.min(need, s.reserve);
      s.mag += take;
      s.reserve -= take;
    }
    if (t >= 1) this.reloadT = -1;
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const player = ctx.player;
    const active = this.enabled && player.alive && player.controlEnabled;
    let d = this.def;
    let s = this.cur;

    // ---------- 切枪 ----------
    if (active) {
      if (input.wasPressed('Digit1')) this.switchTo('ar9');
      if (input.wasPressed('Digit2')) this.switchTo('viper');
      if (input.wasPressed('Digit3')) this.switchTo('helix');
      if (input.wheel !== 0 || input.wasPressed('KeyQ')) {
        const owned = WEAPON_ORDER.filter((id) => this.state[id].owned);
        const i = owned.indexOf(this.pending ?? this.current);
        this.switchTo(owned[(i + (input.wheel < 0 ? -1 : 1) + owned.length) % owned.length]);
      }
    }
    if (this.pending) {
      this.switchT -= dt / 0.16;
      if (this.switchT <= 0) {
        this.setCurrent(this.pending);
        d = this.def;
        s = this.cur;
      }
    } else if (this.switchT < 1) this.switchT = Math.min(1, this.switchT + dt / 0.24);
    const ready = this.switchT >= 1 && !this.pending;

    // ---------- 热量（所有武器在后台冷却） ----------
    const hs = this.state.helix;
    const hd = WEAPONS.helix;
    if (hs.overheat > 0) {
      hs.overheat -= dt;
      hs.heat = Math.max(0, hs.heat - (100 / hd.overheatTime) * dt * 1.05);
      if (this.current === 'helix' && Math.random() < dt * 30) {
        this.worldMuzzle(_muzzle);
        ctx.fx.smoke(_muzzle.addScaledVector(_aim, -0.35), 1, 0.16, { life: 0.5, alpha: 0.22, rise: 1.2, spread: 0.2, color: 0xbfe8ff });
      }
      if (hs.overheat <= 0) {
        hs.heat = 0;
        ctx.audio.helixVentDone();
      }
    } else if (ctx.time - hs.lastShot > hd.heatDelay) hs.heat = Math.max(0, hs.heat - hd.heatCool * dt);
    ctx.audio.setHeatWhine(this.current === 'helix' ? hs.heat / 100 : 0);

    // ---------- 开镜 ----------
    const wantAds = active && ready && input.isDown('Mouse2') && !this.reloading && !player.sprinting && !(this.current === 'helix' && hs.overheat > 0);
    const prevAds = this.ads;
    this.ads = clamp(this.ads + (wantAds ? dt : -dt) / d.adsTime, 0, 1);
    if (prevAds === 0 && this.ads > 0) ctx.audio.adsIn();
    player.adsAmount = easeInOut(this.ads);
    player.adsZoom = d.adsZoom;

    // ---------- 射击 / 换弹 ----------
    this.cooldown -= dt;
    this.spread = Math.max(d.spreadBase, this.spread - d.spreadRecover * dt);
    const trigger = active && input.isDown('Mouse0');
    const pressed = trigger && !this.triggerHeld;
    this.triggerHeld = trigger;
    if (active && ready) {
      if (input.wasPressed('KeyR')) this.startReload();
      const canShoot = !player.sprinting || this.sprintBlend < 0.5;
      if (trigger && (d.auto || pressed) && this.cooldown <= 0 && canShoot) {
        if (d.magSize > 0) {
          if (this.reloading && d.shellReload && s.mag > 0) this.reloadT = -1; // 霰弹枪可打断装填
          if (!this.reloading) {
            if (s.mag > 0) this.fire();
            else if (s.reserve > 0) this.startReload();
            else if (pressed) {
              ctx.audio.dryFire();
              ctx.hud.toast('弹药耗尽 — 切换武器');
              // 自动切到还能用的武器
              const alt = WEAPON_ORDER.find((id) => id !== this.current && this.state[id].owned && (WEAPONS[id].magSize === 0 || this.state[id].mag + this.state[id].reserve > 0));
              if (alt) this.switchTo(alt);
            }
          }
        } else if (s.overheat <= 0) this.fire();
        else if (pressed) ctx.audio.dryFire();
      }
      if (this.reloading) this.updateReload(dt);
      else if (d.magSize > 0 && s.mag === 0 && s.reserve > 0 && this.cooldown <= 0 && !trigger) this.startReload();
    }
    const moving = clamp(player.speed2D / 5.2, 0, 1) * d.moveSpread + (player.grounded ? 0 : d.moveSpread * 1.5);
    this.crosshairSpread = (this.spread + moving) * (player.crouching ? 0.75 : 1);

    this.animate(dt, d, s);
  }

  /** 视图模型动画 */
  private animate(dt: number, d: WeaponDef, s: WeaponState): void {
    const ctx = this.ctx;
    const input = ctx.input;
    const player = ctx.player;
    const v = this.views[this.current];
    const adsE = easeInOut(this.ads);

    this.swayX.target = clamp(-input.mouseDX * 0.0009, -0.03, 0.03);
    this.swayY.target = clamp(input.mouseDY * 0.0009, -0.03, 0.03);
    this.swayX.update(dt);
    this.swayY.update(dt);
    this.kickZ.update(dt);
    this.kickRot.update(dt);
    this.kickRoll.update(dt);
    this.sprintBlend = damp(this.sprintBlend, player.sprinting && !this.reloading ? 1 : 0, 10, dt);
    const sp = this.sprintBlend * (1 - adsE);
    const swayK = 1 - adsE * 0.8;

    const p = this.pivot.position;
    p.copy(v.hipPos).lerp(v.adsPos, adsE);
    p.x += this.swayX.value * swayK + player.bobX * 0.011 * swayK + sp * -0.05;
    p.y += this.swayY.value * swayK - player.bobY * 0.012 * swayK + player.landOffset * 0.5 - sp * 0.05 - (1 - easeInOut(this.switchT)) * 0.32;
    p.z += this.kickZ.value * 0.04 + sp * 0.03;
    // 空中/下落时武器略微上浮
    p.y += clamp(player.vel.y * 0.004, -0.03, 0.03) * (player.grounded ? 0 : 1);

    let rx = this.kickRot.value * 0.04 + this.swayY.value * 1.4 * swayK + (1 - easeInOut(this.switchT)) * -0.9;
    let ry = this.swayX.value * 2.2 * swayK + sp * 0.75;
    let rz = this.kickRoll.value * 0.04 + this.swayX.value * -2.5 * swayK + sp * -0.25 + player.bobX * 0.012 * swayK;
    rx += sp * -0.18;

    // ----- 换弹 / 排热 -----
    if (v.mag) v.mag.position.y = this.current === 'ar9' ? -0.05 : -0.035;
    if (v.bolt && this.current !== 'viper') v.bolt.position.z = this.current === 'ar9' ? 0.15 : 0.08;
    if (this.reloading) {
      const t = clamp(this.reloadT / d.reloadTime, 0, 1);
      if (d.shellReload) {
        const dip = Math.sin(t * Math.PI);
        rx += 0.32 + dip * 0.06;
        rz += -0.35;
        p.y += -0.03 + dip * 0.012;
      } else {
        const inOut = Math.min(1, t / 0.14) * (1 - clamp((t - 0.86) / 0.14, 0, 1));
        rx += inOut * 0.38;
        rz += inOut * 0.42;
        p.y -= inOut * 0.035;
        if (v.mag) {
          const drop = clamp((t - 0.14) / 0.16, 0, 1);
          const back = clamp((t - 0.42) / 0.14, 0, 1);
          v.mag.position.y -= (drop - back * drop) * 0.3;
        }
        if (v.bolt && t > 0.8) v.bolt.position.z += Math.sin(clamp((t - 0.8) / 0.14, 0, 1) * Math.PI) * 0.05;
        if (t > 0.56 && t < 0.62) rx -= 0.05;
      }
    }
    // 霰弹枪泵动
    if (this.current === 'viper' && v.bolt) {
      let pz = -0.4;
      if (this.pumpT >= 0) {
        this.pumpT += dt;
        const t = this.pumpT / 0.5;
        if (t > 0.3) {
          const k = Math.sin(clamp((t - 0.3) / 0.7, 0, 1) * Math.PI);
          pz += k * 0.09;
          rx += k * 0.05;
          if (this.reloadStage !== 9 && t > 0.45 && this.pumpT - dt <= 0.45 * 0.5) {
            this.ejectShell(1);
            if (!this.reloading) ctx.audio.shotgunPump();
          }
        }
        if (t >= 1) this.pumpT = -1;
      }
      v.bolt.position.z = pz;
    }
    // Helix 热量外观
    if (v.heatMat) {
      const h = s.heat / 100;
      const over = s.overheat > 0;
      _c.copy(HEAT_COLD).lerp(HEAT_HOT, clamp(h * 1.15, 0, 1));
      const pulse = over ? 0.6 + 0.4 * Math.sin(ctx.time * 30) : 1;
      v.heatMat.color.copy(_c).multiplyScalar((1.6 + h * 2.4) * pulse);
      if (v.bolt) v.bolt.position.y = damp(v.bolt.position.y, over ? 0.125 : 0.1, 14, dt);
      if (over) {
        rx += 0.16;
        rz += 0.2;
      }
    }
    this.pivot.rotation.set(rx, ry, rz);

    // 枪口火焰
    if (this.flashTime > 0) {
      this.flashTime -= dt;
      v.muzzle.getWorldPosition(_end);
      this.pivot.parent!.worldToLocal(_end);
      for (const m of this.flash) m.position.copy(_end);
      if (this.flashTime <= 0) for (const m of this.flash) m.visible = false;
    }
    // 抛壳
    for (const sh of this.shells) {
      if (sh.life <= 0) continue;
      sh.life -= dt;
      if (sh.life <= 0) {
        sh.mesh.visible = false;
        continue;
      }
      sh.vel.y -= 6 * dt;
      sh.mesh.position.addScaledVector(sh.vel, dt);
      sh.mesh.rotation.x += sh.spin.x * dt;
      sh.mesh.rotation.z += sh.spin.z * dt;
    }
  }

  setVisible(v: boolean): void {
    this.ctx.gfx.weaponVisible = v;
  }

  dispose(): void {
    this.ctx.gfx.weaponCamera.remove(this.pivot);
    for (const m of this.flash) this.ctx.gfx.weaponCamera.remove(m);
    for (const id of WEAPON_ORDER) this.views[id].dispose();
    this.flashGeo.dispose();
    this.flashMat.dispose();
    this.shellGeo.dispose();
    disposeWeaponMats(this.wm);
  }
}
