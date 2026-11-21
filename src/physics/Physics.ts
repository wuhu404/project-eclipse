import RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';

/** 碰撞分组（高 16 位 = 所属组，低 16 位 = 可碰撞组） */
export const G = {
  WORLD: 0x0001,
  PLAYER: 0x0002,
  ENEMY: 0x0004,
  PROP: 0x0008,
} as const;

export const groups = (membership: number, filter: number): number => ((membership & 0xffff) << 16) | (filter & 0xffff);

/** 查询用过滤器（查询方视为"属于所有组"，只按 filter 选择目标） */
export const QUERY = {
  WORLD: groups(0xffff, G.WORLD),
  WORLD_PROP: groups(0xffff, G.WORLD | G.PROP),
  PLAYER_SHOT: groups(0xffff, G.WORLD | G.ENEMY | G.PROP),
  ENEMY_SHOT: groups(0xffff, G.WORLD | G.PLAYER | G.PROP),
  ALL: groups(0xffff, 0xffff),
};

export type ColliderTag =
  | { kind: 'world' }
  | { kind: 'enemy'; id: number; part: 'body' | 'head' | 'weak' | 'armor' }
  | { kind: 'player' }
  | { kind: 'prop'; id: number }
  | { kind: 'barrel'; id: number };

export interface RayHit {
  point: THREE.Vector3;
  normal: THREE.Vector3;
  distance: number;
  collider: RAPIER.Collider;
  tag: ColliderTag;
}

const WORLD_TAG: ColliderTag = { kind: 'world' };

let rapierReady: Promise<void> | null = null;
export function initRapier(): Promise<void> {
  if (!rapierReady) rapierReady = RAPIER.init();
  return rapierReady;
}

export class Physics {
  world: RAPIER.World;
  private tags = new Map<number, ColliderTag>();
  private ray = new RAPIER.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 });
  private acc = 0;
  static readonly STEP = 1 / 60;

  constructor() {
    this.world = new RAPIER.World({ x: 0, y: -20, z: 0 });
    this.world.timestep = Physics.STEP;
  }

  step(dt: number): void {
    this.acc += dt;
    let n = 0;
    while (this.acc >= Physics.STEP && n < 4) {
      this.world.step();
      this.acc -= Physics.STEP;
      n++;
    }
    if (this.acc > Physics.STEP) this.acc = 0;
  }

  /** 立即推进一次（关卡搭建/传送后刷新查询结构） */
  flush(): void {
    this.world.step();
  }

  tag(collider: RAPIER.Collider, tag: ColliderTag): void {
    this.tags.set(collider.handle, tag);
  }
  tagOf(collider: RAPIER.Collider): ColliderTag {
    return this.tags.get(collider.handle) ?? WORLD_TAG;
  }

  /** 静态盒体碰撞（关卡结构） */
  addStaticBox(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cuboid(sx / 2, sy / 2, sz / 2)
      .setTranslation(cx, cy, cz)
      .setCollisionGroups(groups(G.WORLD, 0xffff))
      .setFriction(0.8);
    if (rotY !== 0) {
      const h = rotY / 2;
      desc.setRotation({ x: 0, y: Math.sin(h), z: 0, w: Math.cos(h) });
    }
    return this.world.createCollider(desc);
  }

  addStaticCylinder(cx: number, cy: number, cz: number, radius: number, height: number): RAPIER.Collider {
    const desc = RAPIER.ColliderDesc.cylinder(height / 2, radius).setTranslation(cx, cy, cz).setCollisionGroups(groups(G.WORLD, 0xffff));
    return this.world.createCollider(desc);
  }

  removeCollider(c: RAPIER.Collider): void {
    this.tags.delete(c.handle);
    this.world.removeCollider(c, true);
  }

  removeBody(b: RAPIER.RigidBody): void {
    for (let i = 0; i < b.numColliders(); i++) this.tags.delete(b.collider(i).handle);
    this.world.removeRigidBody(b);
  }

  private _hit: RayHit = {
    point: new THREE.Vector3(),
    normal: new THREE.Vector3(),
    distance: 0,
    collider: null as unknown as RAPIER.Collider,
    tag: WORLD_TAG,
  };

  /** 射线检测。返回的对象是复用的，调用方需要立即读取。 */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number, filter: number, exclude?: RAPIER.Collider): RayHit | null {
    this.ray.origin.x = origin.x;
    this.ray.origin.y = origin.y;
    this.ray.origin.z = origin.z;
    this.ray.dir.x = dir.x;
    this.ray.dir.y = dir.y;
    this.ray.dir.z = dir.z;
    const hit = this.world.castRayAndGetNormal(this.ray, maxDist, true, undefined, filter, exclude);
    if (!hit) return null;
    const h = this._hit;
    h.distance = hit.timeOfImpact;
    h.point.copy(origin).addScaledVector(dir, hit.timeOfImpact);
    h.normal.set(hit.normal.x, hit.normal.y, hit.normal.z);
    h.collider = hit.collider;
    h.tag = this.tagOf(hit.collider);
    return h;
  }

  private _d = new THREE.Vector3();
  /** 两点之间是否被静态世界遮挡 */
  lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    this._d.subVectors(b, a);
    const len = this._d.length();
    if (len < 1e-4) return true;
    this._d.multiplyScalar(1 / len);
    this.ray.origin.x = a.x;
    this.ray.origin.y = a.y;
    this.ray.origin.z = a.z;
    this.ray.dir.x = this._d.x;
    this.ray.dir.y = this._d.y;
    this.ray.dir.z = this._d.z;
    return this.world.castRay(this.ray, len, true, undefined, QUERY.WORLD) === null;
  }

  dispose(): void {
    this.world.free();
    this.tags.clear();
  }
}

export { RAPIER };
