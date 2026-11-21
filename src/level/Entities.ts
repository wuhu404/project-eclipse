import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp, dist2D } from '../core/math';
import { G, groups, RAPIER } from '../physics/Physics';
import { glowMat } from '../render/Materials';

// 实体共用几何体（模块级缓存，关卡卸载时统一释放）
const geos = new Map<string, THREE.BufferGeometry>();
function geo(key: string, make: () => THREE.BufferGeometry): THREE.BufferGeometry {
  let g = geos.get(key);
  if (!g) geos.set(key, (g = make()));
  return g;
}
export function disposeEntityGeometry(): void {
  for (const g of geos.values()) g.dispose();
  geos.clear();
}
const box = (w: number, h: number, d: number): THREE.BufferGeometry => geo(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (r: number, h: number, s = 16): THREE.BufferGeometry => geo(`c${r}|${h}|${s}`, () => new THREE.CylinderGeometry(r, r, h, s));

const _a = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

// =====================================================================================
// 门：双扇滑动门。未上锁时玩家或敌人靠近自动开启；上锁时显示红色灯带。
// =====================================================================================
export class Door {
  open = 0;
  locked: boolean;
  /** 强制保持关闭（Boss 战封门等） */
  sealed = false;
  private group = new THREE.Group();
  private panels: THREE.Mesh[] = [];
  private stripMat: THREE.MeshBasicMaterial;
  private collider: RAPIER.Collider;
  private navId: number;
  private wantOpen = false;
  private wasOpen = false;
  private half: number;
  private geo: THREE.BoxGeometry;
  private stripGeo: THREE.BoxGeometry;

  /** axis='x'：门洞开在沿 X 方向延伸的墙上（玩家沿 Z 穿过） */
  constructor(private ctx: Ctx, public x: number, public z: number, public w: number, public h: number, public axis: 'x' | 'z', locked: boolean, parent: THREE.Object3D, public label = '') {
    this.locked = locked;
    this.half = w / 2;
    const thick = 0.32;
    this.geo = new THREE.BoxGeometry(this.half, h, thick);
    this.stripGeo = new THREE.BoxGeometry(0.08, h * 0.7, thick + 0.04);
    this.stripMat = glowMat(locked ? 0xff2d2d : 0x35e0ff, 2.2);
    for (const s of [-1, 1]) {
      const p = new THREE.Mesh(this.geo, ctx.mats.metalDark);
      p.castShadow = true;
      p.receiveShadow = true;
      p.position.set((s * this.half) / 2, h / 2, 0);
      const strip = new THREE.Mesh(this.stripGeo, this.stripMat);
      strip.position.set(-s * (this.half / 2 - 0.12), 0, 0);
      p.add(strip);
      const hz = new THREE.Mesh(box(this.half * 0.8, 0.22, thick + 0.02), ctx.mats.hazard);
      hz.position.set(0, -h / 2 + 0.4, 0);
      p.add(hz);
      this.group.add(p);
      this.panels.push(p);
    }
    this.group.position.set(x, 0, z);
    if (axis === 'z') this.group.rotation.y = Math.PI / 2;
    parent.add(this.group);
    const sx = axis === 'x' ? w : thick;
    const sz = axis === 'x' ? thick : w;
    this.collider = ctx.physics.addStaticBox(x, h / 2, z, sx, h, sz);
    this.navId = axis === 'x' ? ctx.nav.addDoor(x - w / 2, z - 0.5, x + w / 2, z + 0.5) : ctx.nav.addDoor(x - 0.5, z - w / 2, x + 0.5, z + w / 2);
    ctx.nav.setDoorOpen(this.navId, !locked);
  }

  setLocked(locked: boolean, silent = false): void {
    if (this.locked === locked) return;
    this.locked = locked;
    this.stripMat.color.setHex(locked ? 0xff2d2d : 0x35e0ff).multiplyScalar(2.2);
    this.ctx.nav.setDoorOpen(this.navId, !locked && !this.sealed);
    if (!silent && !locked) this.ctx.audio.terminal(true);
  }

  /** 立即关闭并封锁（玩家进入 Boss 房后） */
  seal(): void {
    this.sealed = true;
    this.locked = true;
    this.stripMat.color.setHex(0xff2d2d).multiplyScalar(2.6);
    this.ctx.nav.setDoorOpen(this.navId, false);
  }

  /** 关卡（重新）开始时恢复初始状态 */
  reset(locked: boolean): void {
    this.sealed = false;
    this.locked = locked;
    this.open = 0;
    this.wantOpen = false;
    this.wasOpen = false;
    this.collider.setEnabled(true);
    this.stripMat.color.setHex(locked ? 0xff2d2d : 0x35e0ff).multiplyScalar(2.2);
    this.ctx.nav.setDoorOpen(this.navId, !locked);
    this.panels[0].position.x = -this.half / 2;
    this.panels[1].position.x = this.half / 2;
  }

  /** 玩家距离门的平面距离 */
  distTo(x: number, z: number): number {
    return dist2D(x, z, this.x, this.z);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const p = ctx.player.pos;
    let want = false;
    if (!this.locked && !this.sealed) {
      const range = Math.max(3.4, this.w * 0.75);
      want = this.distTo(p.x, p.z) < range;
      if (!want) {
        for (const e of ctx.enemies.list) {
          if (e.alive && e.type !== 'boss' && this.distTo(e.pos.x, e.pos.z) < range * 0.8) {
            want = true;
            break;
          }
        }
      }
    }
    if (want !== this.wantOpen) {
      this.wantOpen = want;
      _a.set(this.x, this.h / 2, this.z);
      ctx.audio.door(_a, want);
    }
    const speed = this.w > 5 ? 0.9 : 2.4;
    this.open = clamp(this.open + (want ? dt : -dt) * speed, 0, 1);
    const e = this.open * this.open * (3 - 2 * this.open);
    this.panels[0].position.x = -this.half / 2 - e * (this.half - 0.06);
    this.panels[1].position.x = this.half / 2 + e * (this.half - 0.06);
    const isOpen = this.open > 0.35;
    if (isOpen !== this.wasOpen) {
      this.wasOpen = isOpen;
      this.collider.setEnabled(!isOpen);
    }
  }

  dispose(): void {
    this.group.removeFromParent();
    this.geo.dispose();
    this.stripGeo.dispose();
    this.stripMat.dispose();
    this.ctx.physics.removeCollider(this.collider);
  }
}

// =====================================================================================
// 可交互对象（终端/控制台）：由关卡统一检测"靠近 + 朝向"，按 E 触发
// =====================================================================================
export interface Interactable {
  id: string;
  pos: THREE.Vector3;
  radius: number;
  prompt: string;
  enabled: boolean;
  onUse: () => void;
}

// =====================================================================================
// 拾取物
// =====================================================================================
export type PickupKind = 'health' | 'armor' | 'ammo_ar' | 'ammo_viper' | 'ammo' | 'weapon_viper' | 'weapon_helix' | 'keycard';

const PICKUP_COLOR: Record<PickupKind, number> = {
  health: 0x4dff9a,
  armor: 0x35e0ff,
  ammo_ar: 0xffb347,
  ammo_viper: 0xff8a2a,
  ammo: 0xffb347,
  weapon_viper: 0xff8a2a,
  weapon_helix: 0x35e0ff,
  keycard: 0xffe14a,
};

export class Pickup {
  taken = false;
  private group = new THREE.Group();
  private glow: THREE.Sprite;
  private glowMat: THREE.SpriteMaterial;
  private accent: THREE.MeshBasicMaterial;
  private t = Math.random() * 6;
  private radius = 1.3;
  /** 掉落物在一段时间后消失；<0 表示永久 */
  ttl = -1;

  constructor(private ctx: Ctx, public kind: PickupKind, public x: number, public y: number, public z: number, parent: THREE.Object3D, public secret = false) {
    const m = ctx.mats;
    const color = PICKUP_COLOR[kind];
    this.accent = glowMat(color, 2.4);
    const add = (g: THREE.BufferGeometry, mat: THREE.Material, px = 0, py = 0, pz = 0, rx = 0, ry = 0, rz = 0): THREE.Mesh => {
      const mesh = new THREE.Mesh(g, mat);
      mesh.position.set(px, py, pz);
      mesh.rotation.set(rx, ry, rz);
      this.group.add(mesh);
      return mesh;
    };
    switch (kind) {
      case 'health':
        add(box(0.34, 0.24, 0.2), m.metalLight);
        add(box(0.2, 0.06, 0.21), this.accent);
        add(box(0.06, 0.2, 0.21), this.accent);
        add(box(0.16, 0.04, 0.06), m.metalDark, 0, 0.14, 0);
        break;
      case 'armor':
        add(geo('armor', () => new THREE.CylinderGeometry(0.2, 0.13, 0.3, 6)), m.metalBlue);
        add(box(0.3, 0.05, 0.02), this.accent, 0, 0.02, 0.175);
        add(box(0.05, 0.2, 0.02), this.accent, 0, 0.02, 0.18);
        break;
      case 'ammo_ar':
      case 'ammo':
        add(box(0.36, 0.2, 0.22), m.crateOlive);
        add(box(0.37, 0.04, 0.23), this.accent, 0, 0.03, 0);
        add(box(0.3, 0.03, 0.16), m.metalDark, 0, 0.11, 0);
        break;
      case 'ammo_viper':
        add(box(0.3, 0.16, 0.22), m.crateOrange);
        for (let i = 0; i < 4; i++) add(cyl(0.028, 0.09, 10), m.metalRed, -0.1 + i * 0.066, 0.12, 0);
        add(box(0.31, 0.03, 0.23), this.accent, 0, -0.02, 0);
        break;
      case 'weapon_viper':
        add(box(0.07, 0.1, 0.5), m.gunmetal, 0, 0, 0.1);
        add(geo('wbar', () => new THREE.CylinderGeometry(0.024, 0.024, 0.6, 10).rotateX(Math.PI / 2)), m.metalDark, 0, 0.03, -0.35);
        add(geo('wbar', () => new THREE.CylinderGeometry(0.024, 0.024, 0.6, 10).rotateX(Math.PI / 2)), m.metalDark, 0, -0.02, -0.33);
        add(box(0.08, 0.07, 0.2), m.polymer, 0, -0.03, -0.3);
        add(box(0.06, 0.12, 0.3), m.polymer, 0, -0.04, 0.45, 0.2);
        add(box(0.075, 0.02, 0.2), this.accent, 0, 0.055, 0.1);
        break;
      case 'weapon_helix':
        add(box(0.07, 0.13, 0.46), m.metalLight, 0, 0, 0.12);
        add(box(0.04, 0.025, 0.5), m.gunmetal, 0, 0.045, -0.34);
        add(box(0.04, 0.025, 0.5), m.gunmetal, 0, -0.03, -0.34);
        add(box(0.015, 0.04, 0.48), this.accent, 0, 0.008, -0.33);
        add(box(0.06, 0.1, 0.24), m.polymer, 0, -0.03, 0.45, 0.15);
        break;
      case 'keycard':
        add(box(0.3, 0.19, 0.015), m.metalLight);
        add(box(0.26, 0.05, 0.02), this.accent, 0, 0.04, 0);
        add(box(0.08, 0.06, 0.02), m.metalOrange, -0.08, -0.04, 0);
        break;
    }
    const big = kind === 'weapon_viper' || kind === 'weapon_helix' || kind === 'keycard';
    if (big) {
      this.group.scale.setScalar(1.25);
      this.radius = 2.6; // 武器/门禁卡常放在展台或桌面上，需要更大的拾取范围
    }
    this.glowMat = new THREE.SpriteMaterial({ map: m.tex.glow, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55, toneMapped: false, fog: false });
    this.glow = new THREE.Sprite(this.glowMat);
    this.glow.scale.setScalar(big ? 1.9 : 1.15);
    this.group.add(this.glow);
    this.group.position.set(x, y + 0.7, z);
    parent.add(this.group);
  }

  /** 返回 true 表示已被拾取 */
  update(dt: number): boolean {
    if (this.taken) return false;
    this.t += dt;
    this.group.rotation.y = this.t * 1.5;
    this.group.position.y = this.y + 0.7 + Math.sin(this.t * 2.2) * 0.08;
    this.glowMat.opacity = 0.45 + Math.sin(this.t * 3.1) * 0.12;
    if (this.ttl > 0) {
      this.ttl -= dt;
      if (this.ttl < 3) this.group.visible = Math.sin(this.ttl * 18) > -0.3;
      if (this.ttl <= 0) {
        this.remove();
        return false;
      }
    }
    const p = this.ctx.player;
    if (!p.alive) return false;
    if (dist2D(p.pos.x, p.pos.z, this.x, this.z) < this.radius && Math.abs(p.pos.y - this.y) < 2) return this.tryTake();
    return false;
  }

  private tryTake(): boolean {
    const ctx = this.ctx;
    const w = ctx.weapons;
    const mul = ctx.tuning.pickupMul;
    let ok = false;
    let text = '';
    let sound: 'ammo' | 'health' | 'armor' | 'weapon' | 'key' = 'ammo';
    switch (this.kind) {
      case 'health':
        ok = ctx.player.heal(Math.round(35 * mul));
        text = '医疗包 +' + Math.round(35 * mul);
        sound = 'health';
        break;
      case 'armor':
        ok = ctx.player.addArmor(Math.round(50 * mul));
        text = '护甲板 +' + Math.round(50 * mul);
        sound = 'armor';
        break;
      case 'ammo_ar':
        ok = w.addAmmo('ar9', Math.round(80 * mul));
        text = 'AR-9 弹药 +' + Math.round(80 * mul);
        break;
      case 'ammo_viper':
        ok = w.state.viper.owned && w.addAmmo('viper', Math.round(12 * mul));
        text = 'VIPER 霰弹 +' + Math.round(12 * mul);
        break;
      case 'ammo': {
        // 敌人掉落：为已持有的实弹武器各补充一些
        const a = w.addAmmo('ar9', Math.round(30 * mul));
        const b = w.state.viper.owned && w.addAmmo('viper', Math.round(5 * mul));
        ok = a || b;
        text = '弹药补给';
        break;
      }
      case 'weapon_viper':
        if (w.state.viper.owned) {
          ok = w.addAmmo('viper', 12);
          text = 'VIPER 霰弹 +12';
          break;
        }
        w.give('viper');
        ok = true;
        text = '获得 VIPER 霰弹枪 — 按 2 切换';
        sound = 'weapon';
        break;
      case 'weapon_helix':
        if (w.state.helix.owned) return false; // 已持有：能量武器无需弹药，留在原地
        w.give('helix');
        ok = true;
        text = '获得 HELIX 能量步枪 — 按 3 切换';
        sound = 'weapon';
        break;
      case 'keycard':
        ctx.player.hasKeycard = true;
        ok = true;
        text = '获得 A 级门禁卡';
        sound = 'key';
        break;
    }
    if (!ok) return false;
    ctx.audio.pickup(sound);
    ctx.hud.toast(text);
    ctx.hud.pickupFlash(PICKUP_COLOR[this.kind]);
    if (this.secret) {
      ctx.stats.secrets++;
      ctx.hud.toast('发现隐藏补给');
    }
    _a.set(this.x, this.y + 0.7, this.z);
    ctx.fx.energyBurst(_a, PICKUP_COLOR[this.kind], 8, 2.5, 0.08, 0.4);
    this.remove();
    return true;
  }

  private remove(): void {
    this.taken = true;
    this.group.removeFromParent();
  }

  dispose(): void {
    this.group.removeFromParent();
    this.glowMat.dispose();
    this.accent.dispose();
  }
}

// =====================================================================================
// 爆炸桶：可被任何伤害引爆，连锁反应带短暂延迟
// =====================================================================================
export class Barrel {
  hp = 30;
  dead = false;
  private fuse = -1;
  private mesh: THREE.Group;
  private collider: RAPIER.Collider;

  constructor(private ctx: Ctx, public id: number, public x: number, public z: number, parent: THREE.Object3D, public y = 0) {
    const m = ctx.mats;
    this.mesh = new THREE.Group();
    const body = new THREE.Mesh(cyl(0.36, 1.1, 14), m.metalRed);
    body.castShadow = true;
    body.position.y = 0.55;
    this.mesh.add(body);
    for (const yy of [0.2, 0.55, 0.9]) {
      const ring = new THREE.Mesh(cyl(0.385, 0.05, 14), m.metalDark);
      ring.position.y = yy;
      this.mesh.add(ring);
    }
    const band = new THREE.Mesh(cyl(0.368, 0.2, 14), m.hazard);
    band.position.y = 0.72;
    this.mesh.add(band);
    const cap = new THREE.Mesh(cyl(0.1, 0.06, 10), m.glowOrange);
    cap.position.set(0.15, 1.12, 0);
    this.mesh.add(cap);
    this.mesh.position.set(x, y, z);
    parent.add(this.mesh);
    this.collider = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cylinder(0.55, 0.37).setTranslation(x, y + 0.55, z).setCollisionGroups(groups(G.PROP, 0xffff)));
    ctx.physics.tag(this.collider, { kind: 'barrel', id });
  }

  damage(amount: number, delay = 0): void {
    if (this.dead) return;
    this.hp -= amount;
    if (this.hp <= 0 && this.fuse < 0) this.fuse = delay > 0 ? delay : 0.0001;
  }

  update(dt: number): void {
    if (this.dead || this.fuse < 0) return;
    this.fuse -= dt;
    if (this.fuse <= 0) this.explode();
    else if (Math.random() < dt * 40) {
      _a.set(this.x, this.y + 1.1, this.z);
      this.ctx.fx.sparks(_a, UPV, 2, 0xffb060, 3, 1, 0.2);
    }
  }

  private explode(): void {
    this.dead = true;
    this.mesh.removeFromParent();
    this.ctx.physics.removeCollider(this.collider);
    _a.set(this.x, this.y + 0.6, this.z);
    this.ctx.explode(_a, 5.5, 110, 'world', 0xff8a2a);
  }

  dispose(): void {
    this.mesh.removeFromParent();
    if (!this.dead) this.ctx.physics.removeCollider(this.collider);
  }
}

// =====================================================================================
// 全息靶标（教学用）
// =====================================================================================
export class HoloTarget {
  dead = false;
  private group = new THREE.Group();
  private mat: THREE.MeshBasicMaterial;
  private collider: RAPIER.Collider;
  private hp = 30;
  private flash = 0;
  private t = Math.random() * 5;

  constructor(private ctx: Ctx, public id: number, public x: number, public y: number, public z: number, parent: THREE.Object3D) {
    this.mat = glowMat(0x35e0ff, 1.8);
    this.mat.transparent = true;
    this.mat.opacity = 0.75;
    this.mat.side = THREE.DoubleSide;
    this.mat.depthWrite = false;
    for (const [r0, r1] of [[0.48, 0.55], [0.28, 0.33], [0, 0.1]] as const) {
      const ring = new THREE.Mesh(geo(`ring${r0}`, () => new THREE.RingGeometry(r0, r1, 32)), this.mat);
      this.group.add(ring);
    }
    const base = new THREE.Mesh(cyl(0.16, 0.08, 12), ctx.mats.metalDark);
    base.position.y = -y + 0.04;
    this.group.add(base);
    const beam = new THREE.Mesh(cyl(0.012, 1, 6), this.mat);
    beam.scale.y = y - 0.6;
    beam.position.y = -(y - 0.6) / 2 - 0.56;
    this.group.add(beam);
    this.group.position.set(x, y, z);
    parent.add(this.group);
    this.collider = ctx.physics.world.createCollider(RAPIER.ColliderDesc.cuboid(0.55, 0.55, 0.08).setTranslation(x, y, z).setCollisionGroups(groups(G.PROP, 0xffff)));
    ctx.physics.tag(this.collider, { kind: 'prop', id });
  }

  /** 返回 true 表示被击毁 */
  hit(damage: number): boolean {
    if (this.dead) return false;
    this.hp -= damage;
    this.flash = 1;
    if (this.hp > 0) return false;
    this.dead = true;
    _a.set(this.x, this.y, this.z);
    this.ctx.fx.energyBurst(_a, 0x35e0ff, 22, 6, 0.12, 0.6);
    this.ctx.fx.ring(_a, 0x35e0ff, 0.3, 1.8, 0.35, null);
    this.ctx.audio.terminal(true);
    this.group.removeFromParent();
    this.ctx.physics.removeCollider(this.collider);
    return true;
  }

  update(dt: number): void {
    if (this.dead) return;
    this.t += dt;
    this.flash = Math.max(0, this.flash - dt * 6);
    this.mat.color.setHex(0x35e0ff).multiplyScalar(1.8 + this.flash * 4);
    this.mat.opacity = damp(this.mat.opacity, 0.7 + Math.sin(this.t * 3) * 0.1, 8, dt);
    this.group.position.y = this.y + Math.sin(this.t * 1.4) * 0.05;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.mat.dispose();
    if (!this.dead) this.ctx.physics.removeCollider(this.collider);
  }
}
