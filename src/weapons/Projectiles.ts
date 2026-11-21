import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { rand } from '../core/math';
import { QUERY } from '../physics/Physics';

export type ProjectileKind = 'helix' | 'bolt' | 'rifle' | 'orb' | 'mortar' | 'wasp';

export interface ProjectileOpts {
  owner: 'player' | 'enemy';
  kind: ProjectileKind;
  pos: THREE.Vector3;
  dir: THREE.Vector3;
  speed: number;
  damage: number;
  color: number;
  size?: number;
  life?: number;
  /** 爆炸半径与溅射伤害（0 表示无） */
  splash?: number;
  splashDamage?: number;
  /** 追踪转向速率（弧度/秒） */
  homing?: number;
  gravity?: number;
}

interface Projectile {
  active: boolean;
  owner: 'player' | 'enemy';
  kind: ProjectileKind;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  damage: number;
  color: number;
  size: number;
  life: number;
  age: number;
  splash: number;
  splashDamage: number;
  homing: number;
  gravity: number;
  mesh: THREE.Mesh;
  glow: THREE.Sprite;
  trailAcc: number;
}

const _dir = new THREE.Vector3();
const _next = new THREE.Vector3();
const _pc = new THREE.Vector3();
const _n = new THREE.Vector3();
const _to = new THREE.Vector3();
const Z = new THREE.Vector3(0, 0, 1);

/** 点 P 到线段 AB 的最近距离平方，并返回参数 t */
function segPointDist2(a: THREE.Vector3, b: THREE.Vector3, px: number, py: number, pz: number): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const abz = b.z - a.z;
  const l2 = abx * abx + aby * aby + abz * abz;
  let t = l2 > 0 ? ((px - a.x) * abx + (py - a.y) * aby + (pz - a.z) * abz) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = a.x + abx * t - px;
  const dy = a.y + aby * t - py;
  const dz = a.z + abz * t - pz;
  return dx * dx + dy * dy + dz * dz;
}

/** 投射物对象池：玩家的 Helix 能量弹与全部敌方弹丸。 */
export class Projectiles {
  private pool: Projectile[] = [];
  private geo: THREE.SphereGeometry;
  private root = new THREE.Group();
  private mats: THREE.Material[] = [];

  constructor(private ctx: Ctx, count = 72) {
    this.geo = new THREE.SphereGeometry(1, 10, 8);
    ctx.gfx.scene.add(this.root);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
      const sm = new THREE.SpriteMaterial({ map: ctx.mats.tex.glow, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false, fog: false });
      this.mats.push(mat, sm);
      const mesh = new THREE.Mesh(this.geo, mat);
      const glow = new THREE.Sprite(sm);
      mesh.visible = false;
      glow.visible = false;
      glow.renderOrder = 13;
      this.root.add(mesh, glow);
      this.pool.push({
        active: false, owner: 'enemy', kind: 'bolt', pos: new THREE.Vector3(), vel: new THREE.Vector3(), damage: 0, color: 0, size: 0.1,
        life: 0, age: 0, splash: 0, splashDamage: 0, homing: 0, gravity: 0, mesh, glow, trailAcc: 0,
      });
    }
  }

  spawn(o: ProjectileOpts): void {
    const p = this.pool.find((x) => !x.active);
    if (!p) return;
    p.active = true;
    p.owner = o.owner;
    p.kind = o.kind;
    p.pos.copy(o.pos);
    p.vel.copy(o.dir).normalize().multiplyScalar(o.speed);
    p.damage = o.damage;
    p.color = o.color;
    p.size = o.size ?? 0.09;
    p.life = o.life ?? 4;
    p.age = 0;
    p.splash = o.splash ?? 0;
    p.splashDamage = o.splashDamage ?? 0;
    p.homing = o.homing ?? 0;
    p.gravity = o.gravity ?? 0;
    p.trailAcc = 0;
    (p.mesh.material as THREE.MeshBasicMaterial).color.setHex(o.color).multiplyScalar(0.6).addScalar(1.6);
    p.glow.material.color.setHex(o.color).multiplyScalar(2.2);
    const stretch = p.kind === 'orb' || p.kind === 'mortar' ? 1 : 4.5;
    p.mesh.scale.set(p.size, p.size, p.size * stretch);
    p.glow.scale.setScalar(p.size * (p.kind === 'orb' ? 7 : 1.4));
    p.mesh.visible = true;
    p.glow.visible = true;
    this.place(p);
  }

  /** 以抛物线方式发射到指定落点（迫击炮） */
  spawnMortar(from: THREE.Vector3, target: THREE.Vector3, flight: number, damage: number, splash: number, color: number): void {
    const g = 18;
    _dir.set((target.x - from.x) / flight, (target.y - from.y) / flight + 0.5 * g * flight, (target.z - from.z) / flight);
    const speed = _dir.length();
    this.spawn({ owner: 'enemy', kind: 'mortar', pos: from, dir: _dir, speed, damage: 0, color, size: 0.22, life: flight + 2, splash, splashDamage: damage, gravity: g });
  }

  private place(p: Projectile): void {
    p.mesh.position.copy(p.pos);
    p.glow.position.copy(p.pos);
    if (p.vel.lengthSq() > 1e-6) p.mesh.quaternion.setFromUnitVectors(Z, _dir.copy(p.vel).normalize());
  }

  private kill(p: Projectile): void {
    p.active = false;
    p.mesh.visible = false;
    p.glow.visible = false;
  }

  private detonate(p: Projectile, point: THREE.Vector3, normal: THREE.Vector3): void {
    const ctx = this.ctx;
    if (p.kind === 'mortar') {
      ctx.explode(point, p.splash, p.splashDamage, 'enemy', 0xff6a2a);
    } else if (p.kind === 'orb') {
      ctx.fx.energyBurst(point, p.color, 16, 7, 0.2, 0.5);
      ctx.fx.flash(point, p.color, 3, 0.18);
      ctx.fx.ring(point, p.color, 0.2, p.splash > 0 ? p.splash : 1.6, 0.3, null);
      ctx.gfx.flashLight(point, p.color, 40, 12, 0.25);
      ctx.audio.impact(point, 'energy');
      if (p.splash > 0) ctx.explode(point, p.splash, p.splashDamage, 'enemy', p.color);
    } else if (p.owner === 'player') {
      ctx.fx.impact(point, normal, 'energy', 1);
      ctx.gfx.flashLight(point, p.color, 26, 9, 0.2);
      ctx.audio.impact(point, 'energy');
    } else {
      ctx.fx.sparks(point, normal, 5, p.color, 5, 1.1, 0.25);
      ctx.fx.flash(point, p.color, 0.7, 0.08);
      ctx.fx.scorch(point, normal, 0.3);
      ctx.audio.impact(point, 'energy');
    }
    this.kill(p);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    for (const p of this.pool) {
      if (!p.active) continue;
      p.age += dt;
      p.life -= dt;
      if (p.life <= 0) {
        if (p.kind === 'orb') this.detonate(p, p.pos, _n.set(0, 1, 0));
        else this.kill(p);
        continue;
      }
      // 追踪：有限转向速率，玩家可以横移或绕柱甩开
      if (p.homing > 0 && player.alive) {
        const speed = p.vel.length();
        player.center(_pc);
        _to.subVectors(_pc, p.pos).normalize();
        _dir.copy(p.vel).multiplyScalar(1 / speed);
        const angle = Math.acos(Math.min(1, Math.max(-1, _dir.dot(_to))));
        if (angle > 1e-3) {
          const k = Math.min(1, (p.homing * dt) / angle);
          _dir.lerp(_to, k).normalize();
          p.vel.copy(_dir).multiplyScalar(speed);
        }
      }
      if (p.gravity) p.vel.y -= p.gravity * dt;
      const speed = p.vel.length();
      const step = speed * dt;
      _dir.copy(p.vel).multiplyScalar(1 / Math.max(1e-6, speed));
      _next.copy(p.pos).addScaledVector(_dir, step);

      if (p.owner === 'player') {
        const hit = ctx.physics.raycast(p.pos, _dir, step + p.size, QUERY.PLAYER_SHOT);
        if (hit) {
          const point = hit.point.clone();
          const normal = hit.normal.clone();
          ctx.weapons.resolveHit(hit, p.damage, _dir, 'helix');
          if (p.splash > 0) ctx.weapons.splash(point, p.splash, p.splashDamage, hit.tag);
          this.detonate(p, point, normal);
          continue;
        }
      } else {
        // 先检测玩家（解析胶囊），再检测世界
        let hitPlayer = false;
        if (player.alive) {
          const h = player.currentHeight;
          const r = player.radius + p.size + 0.05;
          // 胶囊近似为三个采样球
          for (const f of [0.2, 0.5, 0.82]) {
            if (segPointDist2(p.pos, _next, player.pos.x, player.pos.y + h * f, player.pos.z) < r * r) {
              hitPlayer = true;
              break;
            }
          }
        }
        const hit = ctx.physics.raycast(p.pos, _dir, step + p.size * 0.5, QUERY.WORLD_PROP);
        if (hitPlayer && (!hit || hit.distance > Math.sqrt(p.pos.distanceToSquared(player.center(_pc))) - player.radius)) {
          if (p.damage > 0) player.damage(p.damage, _to.copy(p.pos).addScaledVector(_dir, -6));
          player.center(_pc);
          this.detonate(p, _pc.addScaledVector(_dir, -0.3), _n.copy(_dir).negate());
          continue;
        }
        if (hit) {
          const point = hit.point.clone();
          const normal = hit.normal.clone();
          if (hit.tag.kind === 'barrel') ctx.level.damageBarrel(hit.tag.id, p.damage * 0.5 + p.splashDamage);
          this.detonate(p, point, normal);
          continue;
        }
      }
      p.pos.copy(_next);
      this.place(p);
      // 拖尾
      p.trailAcc += dt;
      const interval = p.kind === 'orb' ? 0.03 : p.kind === 'mortar' ? 0.025 : 0.02;
      if (p.trailAcc >= interval) {
        p.trailAcc = 0;
        if (p.kind === 'mortar') ctx.fx.smoke(p.pos, 1, 0.3, { life: 0.6, alpha: 0.3, rise: 0.2, spread: 0.1 });
        ctx.fx.glow(p.pos, p.color, p.size * (p.kind === 'orb' ? 5 : 3.2), p.kind === 'orb' ? 0.35 : 0.16, rand(-0.3, 0.3), rand(-0.3, 0.3), rand(-0.3, 0.3), 1.4);
      }
      // 光晕在出膛瞬间较小，随后放大——避免玩家自己的能量弹贴脸时糊满屏幕
      const ramp = Math.min(1, 0.15 + p.age * 5);
      p.glow.scale.setScalar(p.size * (p.kind === 'orb' ? 7 + Math.sin(p.age * 30) * 1.2 : 9 * ramp));
    }
  }

  clear(): void {
    for (const p of this.pool) this.kill(p);
  }

  dispose(): void {
    this.ctx.gfx.scene.remove(this.root);
    this.geo.dispose();
    for (const m of this.mats) m.dispose();
  }
}
