import * as THREE from 'three';
import { rand } from '../core/math';
import { Gfx } from '../render/Gfx';
import { MaterialLibrary } from '../render/Materials';

/**
 * 特效系统：全部基于对象池，运行期不分配 GPU 资源。
 *  - 粒子：两个 THREE.Points（加色火花/能量 + 混合烟雾），CPU 模拟
 *  - 曳光弹：交叉面片池
 *  - 弹痕/焦痕：InstancedMesh 环形缓冲
 *  - 冲击波环、闪光精灵、碎片
 */

const PARTICLE_VS = /* glsl */ `
  attribute vec4 aColor;
  attribute float aSize;
  varying vec4 vColor;
  uniform float uScale;
  void main() {
    vColor = aColor;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * uScale / max(0.1, -mv.z);
    gl_Position = projectionMatrix * mv;
  }`;
const PARTICLE_FS = /* glsl */ `
  uniform sampler2D uMap;
  varying vec4 vColor;
  void main() {
    vec4 t = texture2D(uMap, gl_PointCoord);
    gl_FragColor = vec4(vColor.rgb * t.rgb, vColor.a * t.a);
    #ifdef ADDITIVE
      gl_FragColor.rgb *= gl_FragColor.a;
    #endif
  }`;

interface ParticleOpts {
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.Color;
  colorEnd?: THREE.Color;
  alpha?: number;
  gravity?: number;
  drag?: number;
  bounce?: boolean;
}

class ParticlePool {
  points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private mat: THREE.ShaderMaterial;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private s0: Float32Array;
  private s1: Float32Array;
  private c0: Float32Array;
  private c1: Float32Array;
  private a0: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private bounce: Uint8Array;
  private cursor = 0;
  active = 0;

  constructor(private n: number, map: THREE.Texture, additive: boolean) {
    this.pos = new Float32Array(n * 3);
    this.col = new Float32Array(n * 4);
    this.size = new Float32Array(n);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.s0 = new Float32Array(n);
    this.s1 = new Float32Array(n);
    this.c0 = new Float32Array(n * 3);
    this.c1 = new Float32Array(n * 3);
    this.a0 = new Float32Array(n);
    this.grav = new Float32Array(n);
    this.drag = new Float32Array(n);
    this.bounce = new Uint8Array(n);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map }, uScale: { value: 600 } },
      vertexShader: PARTICLE_VS,
      fragmentShader: PARTICLE_FS,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    if (additive) {
      this.mat.blending = THREE.CustomBlending;
      this.mat.blendSrc = THREE.OneFactor;
      this.mat.blendDst = THREE.OneFactor;
    }
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 12 : 10;
  }

  setScale(v: number): void {
    this.mat.uniforms.uScale.value = v;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, o: ParticleOpts): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.n;
    const i3 = i * 3;
    this.pos[i3] = x;
    this.pos[i3 + 1] = y;
    this.pos[i3 + 2] = z;
    this.vel[i3] = vx;
    this.vel[i3 + 1] = vy;
    this.vel[i3 + 2] = vz;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.s0[i] = o.size;
    this.s1[i] = o.sizeEnd ?? o.size;
    this.c0[i3] = o.color.r;
    this.c0[i3 + 1] = o.color.g;
    this.c0[i3 + 2] = o.color.b;
    const ce = o.colorEnd ?? o.color;
    this.c1[i3] = ce.r;
    this.c1[i3 + 1] = ce.g;
    this.c1[i3 + 2] = ce.b;
    this.a0[i] = o.alpha ?? 1;
    this.grav[i] = o.gravity ?? 0;
    this.drag[i] = o.drag ?? 0;
    this.bounce[i] = o.bounce ? 1 : 0;
  }

  update(dt: number): void {
    let active = 0;
    const { pos, vel, life, maxLife, col, size } = this;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) {
        if (size[i] !== 0) size[i] = 0;
        continue;
      }
      life[i] -= dt;
      const i3 = i * 3;
      const i4 = i * 4;
      if (life[i] <= 0) {
        size[i] = 0;
        col[i4 + 3] = 0;
        continue;
      }
      active++;
      const d = Math.max(0, 1 - this.drag[i] * dt);
      vel[i3] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - this.grav[i] * dt;
      vel[i3 + 2] *= d;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      if (this.bounce[i] && pos[i3 + 1] < 0.03 && vel[i3 + 1] < 0) {
        pos[i3 + 1] = 0.03;
        vel[i3 + 1] *= -0.35;
        vel[i3] *= 0.6;
        vel[i3 + 2] *= 0.6;
      }
      const t = 1 - life[i] / maxLife[i];
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      col[i4] = this.c0[i3] + (this.c1[i3] - this.c0[i3]) * t;
      col[i4 + 1] = this.c0[i3 + 1] + (this.c1[i3 + 1] - this.c0[i3 + 1]) * t;
      col[i4 + 2] = this.c0[i3 + 2] + (this.c1[i3 + 2] - this.c0[i3 + 2]) * t;
      // 快速淡入 + 平滑淡出
      const fadeIn = Math.min(1, t * 12);
      col[i4 + 3] = this.a0[i] * fadeIn * (1 - t) * (1 - t * 0.3);
    }
    this.active = active;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
    this.size.fill(0);
    this.col.fill(0);
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aColor.needsUpdate = true;
  }

  dispose(): void {
    this.geo.dispose();
    this.mat.dispose();
  }
}

interface Tracer {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  dir: THREE.Vector3;
  dist: number;
  travelled: number;
  speed: number;
  length: number;
  width: number;
  active: boolean;
  /** 光束模式：整段同时出现并淡出 */
  beamLife: number;
  beamMax: number;
}

interface Ring {
  mesh: THREE.Mesh;
  life: number;
  maxLife: number;
  r0: number;
  r1: number;
  billboard: boolean;
  alpha: number;
  marker: boolean;
}

interface Flash {
  sprite: THREE.Sprite;
  life: number;
  maxLife: number;
  size: number;
  grow: number;
}

interface Debris {
  mesh: THREE.Mesh;
  vel: THREE.Vector3;
  spin: THREE.Vector3;
  life: number;
  rest: boolean;
}

const _c1 = new THREE.Color();
const _c2 = new THREE.Color();
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const Z_AXIS = new THREE.Vector3(0, 0, 1);
const Y_AXIS = new THREE.Vector3(0, 1, 0);

export type ImpactKind = 'metal' | 'energy' | 'enemy' | 'armor' | 'dirt';

export class Fx {
  private add: ParticlePool;
  private smokePool: ParticlePool;
  private tracers: Tracer[] = [];
  private tracerGeo: THREE.BufferGeometry;
  private rings: Ring[] = [];
  private ringGeo: THREE.PlaneGeometry;
  private flashes: Flash[] = [];
  private debrisList: Debris[] = [];
  private debrisGeo: THREE.BufferGeometry[];
  private debrisMats: THREE.Material[];
  private holes: THREE.InstancedMesh;
  private scorches: THREE.InstancedMesh;
  private holeCursor = 0;
  private scorchCursor = 0;
  private root = new THREE.Group();
  private owned: (THREE.Material | THREE.BufferGeometry)[] = [];
  static readonly HOLES = 160;
  static readonly SCORCHES = 48;

  constructor(private gfx: Gfx, private mats: MaterialLibrary) {
    this.root.name = 'fx';
    gfx.scene.add(this.root);
    this.add = new ParticlePool(1600, mats.tex.glow, true);
    this.smokePool = new ParticlePool(420, mats.tex.smoke, false);
    this.root.add(this.smokePool.points, this.add.points);

    // 曳光：两个交叉面片，沿 +Z 单位长度
    const g = new THREE.BufferGeometry();
    const p = [-0.5, 0, 0, 0.5, 0, 0, 0.5, 0, 1, -0.5, 0, 1, 0, -0.5, 0, 0, 0.5, 0, 0, 0.5, 1, 0, -0.5, 1];
    const uv = [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
    this.tracerGeo = g;
    for (let i = 0; i < 40; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uAlpha: { value: 1 } },
        vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
          void main(){ float a = clamp(1.0 - abs(vUv.x - 0.5) * 2.0, 0.0, 1.0); a = a * a;
            float tail = smoothstep(0.0, 0.25, vUv.y) * (1.0 - smoothstep(0.92, 1.0, vUv.y));
            gl_FragColor = vec4(uColor * a * tail * uAlpha, 1.0); }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.owned.push(mat);
      const mesh = new THREE.Mesh(g, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = 13;
      this.root.add(mesh);
      this.tracers.push({ mesh, from: new THREE.Vector3(), dir: new THREE.Vector3(), dist: 0, travelled: 0, speed: 0, length: 0, width: 0.05, active: false, beamLife: 0, beamMax: 0 });
    }

    // 冲击波环
    this.ringGeo = new THREE.PlaneGeometry(2, 2);
    for (let i = 0; i < 20; i++) {
      const mat = new THREE.MeshBasicMaterial({ map: mats.tex.ring, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false, fog: false });
      this.owned.push(mat);
      const mesh = new THREE.Mesh(this.ringGeo, mat);
      mesh.visible = false;
      mesh.renderOrder = 11;
      this.root.add(mesh);
      this.rings.push({ mesh, life: 0, maxLife: 1, r0: 0, r1: 1, billboard: false, alpha: 1, marker: false });
    }

    // 闪光精灵
    for (let i = 0; i < 28; i++) {
      const mat = new THREE.SpriteMaterial({ map: mats.tex.glow, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, fog: false });
      this.owned.push(mat);
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      sprite.renderOrder = 14;
      this.root.add(sprite);
      this.flashes.push({ sprite, life: 0, maxLife: 1, size: 1, grow: 0 });
    }

    // 碎片
    this.debrisGeo = [new THREE.BoxGeometry(0.22, 0.08, 0.3), new THREE.BoxGeometry(0.12, 0.12, 0.34), new THREE.TetrahedronGeometry(0.16), new THREE.CylinderGeometry(0.05, 0.05, 0.36, 6)];
    this.debrisMats = [mats.metalDark, mats.metalMid, mats.gunmetal, mats.metalRed];
    for (let i = 0; i < 56; i++) {
      const mesh = new THREE.Mesh(this.debrisGeo[i % this.debrisGeo.length], this.debrisMats[i % this.debrisMats.length]);
      mesh.visible = false;
      mesh.castShadow = false;
      this.root.add(mesh);
      this.debrisList.push({ mesh, vel: new THREE.Vector3(), spin: new THREE.Vector3(), life: 0, rest: false });
    }

    // 弹痕
    const decalGeo = new THREE.PlaneGeometry(1, 1);
    this.owned.push(decalGeo);
    const holeMat = new THREE.MeshBasicMaterial({ map: mats.tex.bulletHole, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
    const scorchMat = new THREE.MeshBasicMaterial({ map: mats.tex.scorch, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, opacity: 0.85 });
    this.owned.push(holeMat, scorchMat);
    this.holes = new THREE.InstancedMesh(decalGeo, holeMat, Fx.HOLES);
    this.scorches = new THREE.InstancedMesh(decalGeo, scorchMat, Fx.SCORCHES);
    for (const im of [this.holes, this.scorches]) {
      im.frustumCulled = false;
      im.renderOrder = 2;
      _m.makeScale(0, 0, 0);
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, _m);
      im.instanceMatrix.needsUpdate = true;
      this.root.add(im);
    }
  }

  setViewportHeight(h: number, fovDeg: number): void {
    const s = h / (2 * Math.tan((fovDeg * Math.PI) / 360));
    this.add.setScale(s);
    this.smokePool.setScale(s);
  }

  // ---------- 粒子 ----------
  sparks(pos: THREE.Vector3, normal: THREE.Vector3, count: number, color: number, speed = 7, spread = 0.9, life = 0.35): void {
    _c1.setHex(color).multiplyScalar(3.0);
    _c2.setHex(color).multiplyScalar(0.6);
    for (let i = 0; i < count; i++) {
      const sp = speed * rand(0.35, 1);
      const vx = normal.x * sp + rand(-1, 1) * speed * spread * 0.5;
      const vy = normal.y * sp + rand(-1, 1) * speed * spread * 0.5 + 1.2;
      const vz = normal.z * sp + rand(-1, 1) * speed * spread * 0.5;
      this.add.emit(pos.x, pos.y, pos.z, vx, vy, vz, { life: life * rand(0.5, 1.3), size: rand(0.035, 0.08), sizeEnd: 0.01, color: _c1, colorEnd: _c2, gravity: 14, drag: 1.2, bounce: true });
    }
  }

  smoke(pos: THREE.Vector3, count: number, size: number, opts: { rise?: number; spread?: number; life?: number; alpha?: number; color?: number; dir?: THREE.Vector3; speed?: number } = {}): void {
    _c1.setHex(opts.color ?? 0x8c9096);
    _c2.setHex(opts.color ?? 0x4a4d52).multiplyScalar(0.7);
    const sp = opts.spread ?? 0.6;
    for (let i = 0; i < count; i++) {
      let vx = rand(-sp, sp);
      let vy = (opts.rise ?? 0.8) * rand(0.5, 1.2);
      let vz = rand(-sp, sp);
      if (opts.dir) {
        const s = (opts.speed ?? 2) * rand(0.4, 1);
        vx += opts.dir.x * s;
        vy += opts.dir.y * s;
        vz += opts.dir.z * s;
      }
      this.smokePool.emit(pos.x + rand(-0.1, 0.1), pos.y + rand(-0.1, 0.1), pos.z + rand(-0.1, 0.1), vx, vy, vz, {
        life: (opts.life ?? 1.2) * rand(0.7, 1.3),
        size: size * rand(0.5, 0.9),
        sizeEnd: size * rand(1.6, 2.6),
        color: _c1,
        colorEnd: _c2,
        alpha: opts.alpha ?? 0.35,
        drag: 1.6,
      });
    }
  }

  /** 能量粒子（向外迸发后悬浮淡出） */
  energyBurst(pos: THREE.Vector3, color: number, count: number, speed = 5, size = 0.12, life = 0.5): void {
    _c1.setHex(color).multiplyScalar(2.6);
    _c2.setHex(color).multiplyScalar(0.3);
    for (let i = 0; i < count; i++) {
      _v1.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.3, 1));
      this.add.emit(pos.x, pos.y, pos.z, _v1.x, _v1.y, _v1.z, { life: life * rand(0.6, 1.4), size: size * rand(0.5, 1.2), sizeEnd: 0.01, color: _c1, colorEnd: _c2, drag: 3.5, gravity: -0.6 });
    }
  }

  /** 单个加色粒子（拖尾等） */
  glow(pos: THREE.Vector3, color: number, size: number, life: number, vx = 0, vy = 0, vz = 0, intensity = 2): void {
    _c1.setHex(color).multiplyScalar(intensity);
    this.add.emit(pos.x, pos.y, pos.z, vx, vy, vz, { life, size, sizeEnd: size * 0.2, color: _c1, drag: 2 });
  }

  /** 火焰团（爆炸核心） */
  fire(pos: THREE.Vector3, count: number, radius: number, color = 0xff8a2a): void {
    _c1.setHex(0xfff0c0).multiplyScalar(2.6);
    _c2.setHex(color).multiplyScalar(0.8);
    for (let i = 0; i < count; i++) {
      _v1.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(radius * rand(0.8, 3.2));
      this.add.emit(pos.x, pos.y, pos.z, _v1.x, _v1.y, _v1.z, { life: rand(0.25, 0.6), size: radius * rand(0.35, 0.8), sizeEnd: radius * 0.15, color: _c1, colorEnd: _c2, drag: 4, gravity: -2, alpha: 0.9 });
    }
  }

  // ---------- 组合效果 ----------
  impact(pos: THREE.Vector3, normal: THREE.Vector3, kind: ImpactKind, scale = 1): void {
    _v3.copy(pos).addScaledVector(normal, 0.03);
    switch (kind) {
      case 'metal':
        this.sparks(_v3, normal, Math.round(7 * scale), 0xffc27a, 7.5);
        this.smoke(_v3, 1, 0.22, { dir: normal, speed: 1.2, life: 0.5, alpha: 0.22, rise: 0.3 });
        this.flash(_v3, 0xffd9a0, 0.35 * scale, 0.06);
        this.decal(pos, normal, rand(0.11, 0.16) * scale);
        break;
      case 'dirt':
        this.smoke(_v3, 3, 0.3, { dir: normal, speed: 2.2, life: 0.7, alpha: 0.4, color: 0x8d7466, rise: 0.6 });
        this.sparks(_v3, normal, 2, 0xffc27a, 4);
        this.decal(pos, normal, rand(0.12, 0.18) * scale);
        break;
      case 'energy':
        this.energyBurst(_v3, 0x35e0ff, Math.round(10 * scale), 5, 0.14);
        this.flash(_v3, 0x7af0ff, 1.5 * scale, 0.12);
        this.ring(_v3, 0x35e0ff, 0.1, 1.1 * scale, 0.22, normal);
        this.scorch(pos, normal, 0.7 * scale);
        break;
      case 'enemy':
        this.sparks(_v3, normal, Math.round(9 * scale), 0xffe2a8, 8.5, 1.0, 0.4);
        this.sparks(_v3, normal, Math.round(4 * scale), 0xff5a3a, 5, 1.2, 0.3);
        this.flash(_v3, 0xffe0b0, 0.6 * scale, 0.07);
        break;
      case 'armor':
        this.sparks(_v3, normal, Math.round(5 * scale), 0xbfe8ff, 9, 1.4, 0.25);
        this.flash(_v3, 0xbfe8ff, 0.4 * scale, 0.05);
        break;
    }
  }

  explosion(pos: THREE.Vector3, radius: number, color = 0xff8a2a, withScorch = true): void {
    this.fire(pos, Math.round(14 + radius * 3), radius * 0.55, color);
    this.sparks(pos, Y_AXIS, Math.round(18 + radius * 4), 0xffc27a, 9 + radius * 1.5, 1.8, 0.8);
    this.smoke(pos, Math.round(6 + radius), radius * 0.6, { spread: radius * 0.5, rise: 1.6, life: 2.2, alpha: 0.42, color: 0x3a3a3e });
    this.flash(pos, 0xffe2b0, radius * 2.6, 0.16);
    this.ring(pos, color, 0.3, radius * 1.25, 0.35, null);
    _v2.set(pos.x, Math.max(0.03, pos.y - 1.2), pos.z);
    if (pos.y < 2.2) this.ring(_v2.setY(0.06), color, 0.3, radius * 1.3, 0.45, Y_AXIS);
    this.gfx.flashLight(pos, color, 60 + radius * 14, radius * 4.5, 0.35);
    if (withScorch && pos.y < 2.5) this.scorch(_v2.set(pos.x, 0, pos.z), Y_AXIS, radius * 1.1);
  }

  // ---------- 曳光 / 光束 ----------
  tracer(from: THREE.Vector3, to: THREE.Vector3, color: number, width = 0.045, speed = 240, length = 7): void {
    const t = this.tracers.find((x) => !x.active) ?? this.tracers[0];
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 0.5) return;
    t.dir.multiplyScalar(1 / t.dist);
    t.travelled = Math.min(t.dist * 0.5, 1.2);
    t.speed = speed;
    t.length = length;
    t.width = width;
    t.active = true;
    t.beamLife = 0;
    const m = t.mesh.material as THREE.ShaderMaterial;
    (m.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(2.4);
    m.uniforms.uAlpha.value = 1;
    t.mesh.quaternion.setFromUnitVectors(Z_AXIS, t.dir);
    t.mesh.visible = true;
    this.placeTracer(t);
  }

  /** 瞬时光束（整段出现后淡出），用于瞄准激光、Boss 扫射残影等 */
  beam(from: THREE.Vector3, to: THREE.Vector3, color: number, width: number, life: number, intensity = 2.4): void {
    const t = this.tracers.find((x) => !x.active) ?? this.tracers[1];
    t.from.copy(from);
    t.dir.subVectors(to, from);
    t.dist = t.dir.length();
    if (t.dist < 0.05) return;
    t.dir.multiplyScalar(1 / t.dist);
    t.active = true;
    t.beamLife = life;
    t.beamMax = life;
    t.width = width;
    const m = t.mesh.material as THREE.ShaderMaterial;
    (m.uniforms.uColor.value as THREE.Color).setHex(color).multiplyScalar(intensity);
    m.uniforms.uAlpha.value = 1;
    t.mesh.quaternion.setFromUnitVectors(Z_AXIS, t.dir);
    t.mesh.position.copy(from);
    t.mesh.scale.set(width, width, t.dist);
    t.mesh.visible = true;
  }

  private placeTracer(t: Tracer): void {
    const head = Math.min(t.travelled, t.dist);
    const tail = Math.max(0, head - t.length);
    t.mesh.position.copy(t.from).addScaledVector(t.dir, tail);
    t.mesh.scale.set(t.width, t.width, Math.max(0.01, head - tail));
  }

  // ---------- 环 / 闪光 ----------
  /** marker=true：线性缩放、亮度随时间增强（用于攻击落点/范围预警） */
  ring(pos: THREE.Vector3, color: number, r0: number, r1: number, life: number, normal: THREE.Vector3 | null, alpha = 1, marker = false): void {
    const r = this.rings.find((x) => x.life <= 0) ?? this.rings[0];
    r.life = life;
    r.maxLife = life;
    r.r0 = r0;
    r.r1 = r1;
    r.alpha = alpha;
    r.marker = marker;
    r.billboard = normal === null;
    r.mesh.position.copy(pos);
    if (normal) r.mesh.quaternion.setFromUnitVectors(Z_AXIS, normal);
    const m = r.mesh.material as THREE.MeshBasicMaterial;
    m.color.setHex(color).multiplyScalar(2.2);
    m.opacity = alpha;
    r.mesh.scale.setScalar(r0);
    r.mesh.visible = true;
  }

  flash(pos: THREE.Vector3, color: number, size: number, life: number, grow = 0.6): void {
    const f = this.flashes.find((x) => x.life <= 0) ?? this.flashes[0];
    f.life = life;
    f.maxLife = life;
    f.size = size;
    f.grow = grow;
    f.sprite.position.copy(pos);
    f.sprite.material.color.setHex(color).multiplyScalar(2.2);
    f.sprite.material.opacity = 1;
    f.sprite.scale.setScalar(size);
    f.sprite.visible = true;
  }

  // ---------- 贴花 ----------
  private setDecal(im: THREE.InstancedMesh, index: number, pos: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    _q.setFromUnitVectors(Z_AXIS, normal);
    _v1.copy(pos).addScaledVector(normal, 0.012);
    const spin = new THREE.Quaternion().setFromAxisAngle(Z_AXIS, rand(0, 6.28));
    _q.multiply(spin);
    _m.compose(_v1, _q, _s.set(size, size, size));
    im.setMatrixAt(index, _m);
    im.instanceMatrix.needsUpdate = true;
  }

  decal(pos: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    this.setDecal(this.holes, this.holeCursor, pos, normal, size);
    this.holeCursor = (this.holeCursor + 1) % Fx.HOLES;
  }

  scorch(pos: THREE.Vector3, normal: THREE.Vector3, size: number): void {
    this.setDecal(this.scorches, this.scorchCursor, pos, normal, size);
    this.scorchCursor = (this.scorchCursor + 1) % Fx.SCORCHES;
  }

  // ---------- 碎片 ----------
  debris(pos: THREE.Vector3, count: number, speed: number, scale = 1): void {
    let spawned = 0;
    for (const d of this.debrisList) {
      if (spawned >= count) break;
      if (d.life > 0 && !d.rest) continue;
      d.life = rand(3.5, 6);
      d.rest = false;
      d.mesh.visible = true;
      d.mesh.position.copy(pos).add(_v1.set(rand(-0.3, 0.3), rand(-0.2, 0.4), rand(-0.3, 0.3)));
      d.mesh.scale.setScalar(scale * rand(0.7, 1.4));
      d.mesh.rotation.set(rand(0, 6), rand(0, 6), rand(0, 6));
      d.vel.set(rand(-1, 1), rand(0.4, 1.4), rand(-1, 1)).multiplyScalar(speed * rand(0.5, 1));
      d.spin.set(rand(-9, 9), rand(-9, 9), rand(-9, 9));
      spawned++;
    }
  }

  update(dt: number, camera: THREE.Camera): void {
    this.add.update(dt);
    this.smokePool.update(dt);

    for (const t of this.tracers) {
      if (!t.active) continue;
      const m = t.mesh.material as THREE.ShaderMaterial;
      if (t.beamMax > 0 && t.beamLife > 0) {
        t.beamLife -= dt;
        const k = Math.max(0, t.beamLife / t.beamMax);
        m.uniforms.uAlpha.value = k;
        t.mesh.scale.x = t.mesh.scale.y = t.width * (0.4 + 0.6 * k);
        if (t.beamLife <= 0) {
          t.active = false;
          t.beamMax = 0;
          t.mesh.visible = false;
        }
        continue;
      }
      t.travelled += t.speed * dt;
      if (t.travelled - t.length >= t.dist) {
        t.active = false;
        t.mesh.visible = false;
        continue;
      }
      this.placeTracer(t);
    }

    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      if (r.life <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const t = 1 - r.life / r.maxLife;
      const e = r.marker ? t : 1 - Math.pow(1 - t, 2.5);
      r.mesh.scale.setScalar(r.r0 + (r.r1 - r.r0) * e);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = r.marker ? r.alpha * (0.3 + 0.7 * t) : r.alpha * (1 - t) * (1 - t);
      if (r.billboard) r.mesh.quaternion.copy(camera.quaternion);
    }

    for (const f of this.flashes) {
      if (f.life <= 0) continue;
      f.life -= dt;
      if (f.life <= 0) {
        f.sprite.visible = false;
        continue;
      }
      const t = 1 - f.life / f.maxLife;
      f.sprite.scale.setScalar(f.size * (1 + f.grow * t));
      f.sprite.material.opacity = (1 - t) * (1 - t);
    }

    for (const d of this.debrisList) {
      if (d.life <= 0) continue;
      d.life -= dt;
      if (d.life <= 0) {
        d.mesh.visible = false;
        continue;
      }
      if (d.life < 0.6) d.mesh.scale.multiplyScalar(Math.max(0, 1 - dt * 3));
      if (d.rest) continue;
      d.vel.y -= 20 * dt;
      d.mesh.position.addScaledVector(d.vel, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < 0.06 && d.vel.y < 0) {
        d.mesh.position.y = 0.06;
        if (Math.abs(d.vel.y) < 1.5) {
          d.rest = true;
          d.mesh.rotation.x = 0;
          d.mesh.rotation.z = 0;
        } else {
          d.vel.y *= -0.35;
          d.vel.x *= 0.55;
          d.vel.z *= 0.55;
          d.spin.multiplyScalar(0.5);
        }
      }
    }
  }

  /** 重开/读档时清空所有瞬时效果 */
  clear(): void {
    this.add.clear();
    this.smokePool.clear();
    for (const t of this.tracers) {
      t.active = false;
      t.beamMax = 0;
      t.mesh.visible = false;
    }
    for (const r of this.rings) {
      r.life = 0;
      r.mesh.visible = false;
    }
    for (const f of this.flashes) {
      f.life = 0;
      f.sprite.visible = false;
    }
    for (const d of this.debrisList) {
      d.life = 0;
      d.mesh.visible = false;
    }
    _m.makeScale(0, 0, 0);
    for (const im of [this.holes, this.scorches]) {
      for (let i = 0; i < im.count; i++) im.setMatrixAt(i, _m);
      im.instanceMatrix.needsUpdate = true;
    }
  }

  get activeParticles(): number {
    return this.add.active + this.smokePool.active;
  }

  dispose(): void {
    this.gfx.scene.remove(this.root);
    this.add.dispose();
    this.smokePool.dispose();
    this.tracerGeo.dispose();
    this.ringGeo.dispose();
    for (const g of this.debrisGeo) g.dispose();
    for (const o of this.owned) o.dispose();
    this.holes.dispose();
    this.scorches.dispose();
  }
}
