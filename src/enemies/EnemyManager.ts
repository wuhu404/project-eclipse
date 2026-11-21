import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { dist2D } from '../core/math';
import type { ColliderTag } from '../physics/Physics';
import { Boss } from './Boss';
import { DamageSource, Enemy, EnemySpawnOpts, HitResult } from './Enemy';
import { disposeEnemyGeometry, EnemyType } from './EnemyModels';
import { Juggernaut, Sentry, Stalker, Wasp } from './EnemyTypes';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const NO_HIT: HitResult = { killed: false, headshot: false, armor: false };

/** 敌人的创建、更新、互相推挤、范围伤害与警报传播。 */
export class EnemyManager {
  list: Enemy[] = [];
  boss: Boss | null = null;
  private byId = new Map<number, Enemy>();
  private pathBudget = 0;

  constructor(private ctx: Ctx) {}

  spawn(type: EnemyType, x: number, z: number, opts: EnemySpawnOpts = {}): Enemy {
    const ctx = this.ctx;
    let e: Enemy;
    switch (type) {
      case 'sentry':
        e = new Sentry(ctx, x, z, opts);
        break;
      case 'stalker':
        e = new Stalker(ctx, x, z, opts);
        break;
      case 'juggernaut':
        e = new Juggernaut(ctx, x, z, opts);
        break;
      case 'wasp':
        e = new Wasp(ctx, x, z, opts);
        break;
      case 'boss':
        e = this.boss = new Boss(ctx, x, z, opts);
        break;
    }
    this.list.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  /** 每帧寻路预算，避免多个敌人同一帧执行 A* */
  takePathBudget(): boolean {
    if (this.pathBudget <= 0) return false;
    this.pathBudget--;
    return true;
  }

  applyHit(tag: ColliderTag, damage: number, point: THREE.Vector3, dir: THREE.Vector3, source: DamageSource): HitResult {
    if (tag.kind !== 'enemy') return NO_HIT;
    const e = this.byId.get(tag.id);
    if (!e) return NO_HIT;
    return e.applyHit(tag.part, damage, point, dir, source);
  }

  /** 范围伤害（带距离衰减与遮挡判定）。返回 [命中数, 击杀数] */
  damageInRadius(point: THREE.Vector3, radius: number, damage: number, source: DamageSource, excludeId = -1): [number, number] {
    let hits = 0;
    let kills = 0;
    for (const e of this.list) {
      if (!e.alive || e.id === excludeId) continue;
      e.center(_a);
      const d = Math.max(0, _a.distanceTo(point) - e.radius);
      if (d > radius) continue;
      _b.copy(point);
      _b.y += 0.25;
      if (!this.ctx.physics.lineOfSight(_b, _a)) continue;
      const k = 1 - 0.65 * (d / radius);
      const dir = _b.subVectors(_a, point).normalize();
      const res = e.applyHit('body', damage * k, _a, dir, source);
      hits++;
      if (res.killed) kills++;
    }
    return [hits, kills];
  }

  /** 枪声等噪音：范围内未警觉的敌人会前来调查 */
  alertNear(pos: THREE.Vector3, radius: number): void {
    for (const e of this.list) {
      if (!e.alive || e.engaged) continue;
      if (dist2D(e.pos.x, e.pos.z, pos.x, pos.z) < radius) e.hear(pos);
    }
  }

  /** 同伴呼叫：附近的敌人直接进入交战 */
  alertAllies(from: Enemy, radius: number): void {
    for (const e of this.list) {
      if (e === from || !e.alive || e.engaged) continue;
      if (dist2D(e.pos.x, e.pos.z, from.pos.x, from.pos.z) < radius) e.engage();
    }
  }

  /** 让某个遭遇战的全部敌人进入交战 */
  engageEncounter(encounter: string): void {
    for (const e of this.list) if (e.alive && e.encounter === encounter) e.engage();
  }

  aliveCount(encounter?: string): number {
    let n = 0;
    for (const e of this.list) if (e.alive && e.type !== 'boss' && (encounter === undefined || e.encounter === encounter)) n++;
    return n;
  }

  minionCount(): number {
    return this.aliveCount('boss-minion');
  }

  /** 是否有敌人正在与玩家交战（音乐/警报用） */
  engagedCount(): number {
    let n = 0;
    for (const e of this.list) if (e.alive && e.engaged && e.type !== 'boss') n++;
    return n;
  }

  onDeath(e: Enemy): void {
    if (e.type === 'boss') this.killAll('boss-minion');
    this.ctx.level.onEnemyKilled(e);
  }

  killAll(encounter?: string): void {
    for (const e of [...this.list]) if (e.alive && e.type !== 'boss' && (encounter === undefined || e.encounter === encounter)) e.kill();
  }

  stunAll(dur: number): void {
    for (const e of this.list) e.stun(dur);
  }

  damageBarrelsNear(pos: THREE.Vector3, radius: number): void {
    this.ctx.level.damageBarrelsNear(pos, radius, 60);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    const player = ctx.player;
    this.pathBudget = 3;
    for (const e of this.list) {
      // 远处且未警觉的敌人降频更新
      if (e.alive && !e.engaged && e.type !== 'boss' && e.dist > 70) {
        e.dist = dist2D(e.pos.x, e.pos.z, player.pos.x, player.pos.z);
        continue;
      }
      e.update(dt);
    }
    // 互相推挤
    const n = this.list.length;
    for (let i = 0; i < n; i++) {
      const a = this.list[i];
      if (!a.alive || a.type === 'boss') continue;
      for (let j = i + 1; j < n; j++) {
        const b = this.list[j];
        if (!b.alive || b.type === 'boss') continue;
        if ((a.type === 'wasp') !== (b.type === 'wasp')) continue;
        const dx = b.pos.x - a.pos.x;
        const dz = b.pos.z - a.pos.z;
        const min = a.radius + b.radius + 0.15;
        const d2 = dx * dx + dz * dz;
        if (d2 >= min * min) continue;
        const d = Math.sqrt(d2) || 0.01;
        const push = (min - d) * 0.5;
        const ux = d2 > 1e-6 ? dx / d : 1;
        const uz = d2 > 1e-6 ? dz / d : 0;
        // 重型单位更难被推动
        const wa = a.type === 'juggernaut' ? 0.15 : 1;
        const wb = b.type === 'juggernaut' ? 0.15 : 1;
        a.push(-ux * push * wa, -uz * push * wa);
        b.push(ux * push * wb, uz * push * wb);
      }
      // 与玩家：轻型敌人被挤开，重型敌人把玩家顶开
      if (a.type !== 'wasp' && player.alive) {
        const dx = a.pos.x - player.pos.x;
        const dz = a.pos.z - player.pos.z;
        const min = a.radius + player.radius + 0.1;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && Math.abs(player.pos.y - a.pos.y) < a.height) {
          const d = Math.sqrt(d2) || 0.01;
          const over = min - d;
          if (a.type === 'juggernaut') {
            player.vel.x -= (dx / d) * over * 30 * dt * 10;
            player.vel.z -= (dz / d) * over * 30 * dt * 10;
          } else {
            a.push((dx / d) * over * 0.6, (dz / d) * over * 0.6);
            player.vel.x -= (dx / d) * over * 12 * dt * 10;
            player.vel.z -= (dz / d) * over * 12 * dt * 10;
          }
        }
      }
    }
    // 回收
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i];
      if (e.removed) {
        e.dispose();
        this.byId.delete(e.id);
        this.list.splice(i, 1);
      }
    }
  }

  clear(): void {
    for (const e of this.list) e.dispose();
    this.list.length = 0;
    this.byId.clear();
    this.boss = null;
  }

  dispose(): void {
    this.clear();
    disposeEnemyGeometry();
  }
}
