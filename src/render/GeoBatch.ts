import * as THREE from 'three';

/**
 * 静态几何合批：把同一材质的大量盒体/自定义几何体合并成一个 Mesh，
 * 将数百个 draw call 压缩到每个分区十几个。UV 按世界尺寸生成，保证贴图密度一致。
 */
interface Bucket {
  material: THREE.Material;
  pos: number[];
  nor: number[];
  uv: number[];
  idx: number[];
  castShadow: boolean;
  receiveShadow: boolean;
}

export interface BoxOpts {
  rotY?: number;
  /** 0 表示每个面 UV 0..1；否则为贴图铺设的世界尺寸（米） */
  tile?: number;
  castShadow?: boolean;
  /** 跳过的面：'+x' '-x' '+y' '-y' '+z' '-z' */
  skip?: string[];
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export class GeoBatch {
  private buckets = new Map<string, Bucket>();

  private bucket(material: THREE.Material, castShadow: boolean): Bucket {
    const key = material.uuid + (castShadow ? ':s' : ':n');
    let b = this.buckets.get(key);
    if (!b) {
      b = { material, pos: [], nor: [], uv: [], idx: [], castShadow, receiveShadow: true };
      this.buckets.set(key, b);
    }
    return b;
  }

  /** 以中心 + 尺寸添加盒体 */
  box(material: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: BoxOpts = {}): void {
    const b = this.bucket(material, opts.castShadow ?? false);
    const tile = opts.tile ?? (material.userData.tile as number | undefined) ?? 4;
    const rot = opts.rotY ?? 0;
    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const hx = sx / 2;
    const hy = sy / 2;
    const hz = sz / 2;
    const skip = opts.skip;
    // 每个面：法线、两个切向轴（u,v）、面尺寸
    const faces: [string, number, number, number, number, number, number, number, number, number][] = [
      // name, nx,ny,nz, ux,uy,uz, vx,vy,vz
      ['+x', 1, 0, 0, 0, 0, -1, 0, 1, 0],
      ['-x', -1, 0, 0, 0, 0, 1, 0, 1, 0],
      ['+y', 0, 1, 0, 1, 0, 0, 0, 0, -1],
      ['-y', 0, -1, 0, 1, 0, 0, 0, 0, 1],
      ['+z', 0, 0, 1, 1, 0, 0, 0, 1, 0],
      ['-z', 0, 0, -1, -1, 0, 0, 0, 1, 0],
    ];
    for (const [name, nx, ny, nz, ux, uy, uz, vx, vy, vz] of faces) {
      if (skip && skip.includes(name)) continue;
      const base = b.pos.length / 3;
      for (let k = 0; k < 4; k++) {
        const su = k === 0 || k === 3 ? -1 : 1;
        const sv = k < 2 ? -1 : 1;
        // 局部坐标
        const lx = nx * hx + ux * su * hx + vx * sv * hx;
        const ly = ny * hy + uy * su * hy + vy * sv * hy;
        const lz = nz * hz + uz * su * hz + vz * sv * hz;
        const wx = cx + lx * cos + lz * sin;
        const wz = cz - lx * sin + lz * cos;
        const wy = cy + ly;
        b.pos.push(wx, wy, wz);
        b.nor.push(nx * cos + nz * sin, ny, -nx * sin + nz * cos);
        if (tile > 0) {
          // 世界尺度 UV（用局部坐标 + 中心偏移，旋转后仍连续）
          const pu = (ux !== 0 ? (cx + lx) * ux : 0) + (uz !== 0 ? (cz + lz) * uz : 0);
          const pv = vy !== 0 ? cy + ly : (cz + lz) * vz;
          b.uv.push(pu / tile, pv / tile);
        } else {
          b.uv.push(su * 0.5 + 0.5, sv * 0.5 + 0.5);
        }
      }
      b.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
  }

  /** 合并任意几何体（会应用矩阵）。几何体在合并后可立即 dispose。 */
  geo(material: THREE.Material, geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, castShadow = false, uvScale = 1): void {
    const b = this.bucket(material, castShadow);
    const pos = geometry.getAttribute('position');
    const nor = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    const base = b.pos.length / 3;
    _nm.getNormalMatrix(matrix);
    for (let i = 0; i < pos.count; i++) {
      _v.fromBufferAttribute(pos, i).applyMatrix4(matrix);
      b.pos.push(_v.x, _v.y, _v.z);
      if (nor) {
        _n.fromBufferAttribute(nor, i).applyMatrix3(_nm).normalize();
        b.nor.push(_n.x, _n.y, _n.z);
      } else b.nor.push(0, 1, 0);
      if (uv) b.uv.push(uv.getX(i) * uvScale, uv.getY(i) * uvScale);
      else b.uv.push(0, 0);
    }
    const index = geometry.getIndex();
    if (index) {
      for (let i = 0; i < index.count; i++) b.idx.push(base + index.getX(i));
    } else {
      for (let i = 0; i < pos.count; i++) b.idx.push(base + i);
    }
  }

  /** 便捷：位置/旋转/缩放添加几何体，并在之后销毁它 */
  add(
    material: THREE.Material,
    geometry: THREE.BufferGeometry,
    x: number,
    y: number,
    z: number,
    rx = 0,
    ry = 0,
    rz = 0,
    castShadow = false,
    scale: number | [number, number, number] = 1,
  ): void {
    const s = typeof scale === 'number' ? ([scale, scale, scale] as [number, number, number]) : scale;
    _m.compose(_v.set(x, y, z).clone(), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...s));
    this.geo(material, geometry, _m, castShadow);
    geometry.dispose();
  }

  /** 生成最终 Mesh 列表 */
  build(parent: THREE.Object3D, receiveShadow = true): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const b of this.buckets.values()) {
      if (b.pos.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setIndex(b.pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(b.idx, 1) : new THREE.Uint16BufferAttribute(b.idx, 1));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const mesh = new THREE.Mesh(g, b.material);
      mesh.castShadow = b.castShadow;
      mesh.receiveShadow = receiveShadow && !(b.material instanceof THREE.MeshBasicMaterial);
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      parent.add(mesh);
      out.push(mesh);
    }
    this.buckets.clear();
    return out;
  }
}
