import * as THREE from 'three';

/**
 * 原创天空：开普勒-442 的黄昏，被巨行星遮蔽的恒星（日蚀）悬在基地上空。
 * 用天空球着色器实现，避免使用 scene.background（会干扰武器层的二次渲染）。
 */
export class Sky {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** 日蚀方向（单位向量，指向天空中的日蚀） */
  static readonly ECLIPSE_DIR = new THREE.Vector3(-0.38, 0.47, -0.8).normalize();

  constructor() {
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
      uniforms: {
        uTime: { value: 0 },
        uSunDir: { value: Sky.ECLIPSE_DIR.clone() },
        uIntensity: { value: 1 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          vec4 mv = modelViewMatrix * vec4(position, 1.0);
          gl_Position = projectionMatrix * mv;
          gl_Position.z = gl_Position.w; // 永远在最远处
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vDir;
        uniform float uTime;
        uniform vec3 uSunDir;
        uniform float uIntensity;

        float hash(vec3 p) {
          p = fract(p * 0.3183099 + 0.1);
          p *= 17.0;
          return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
        }
        float noise(vec3 x) {
          vec3 i = floor(x);
          vec3 f = fract(x);
          f = f * f * (3.0 - 2.0 * f);
          return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x),
                         mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                     mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                         mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
        }
        float fbm(vec3 p) {
          float a = 0.5, s = 0.0;
          for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; }
          return s;
        }

        void main() {
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          // 大气渐变：地平线橙红 → 高空深青紫
          vec3 horizon = vec3(0.85, 0.32, 0.16);
          vec3 mid = vec3(0.20, 0.10, 0.22);
          vec3 zenith = vec3(0.012, 0.022, 0.05);
          vec3 col = mix(horizon, mid, smoothstep(-0.05, 0.22, h));
          col = mix(col, zenith, smoothstep(0.15, 0.75, h));

          float cosA = dot(d, uSunDir);
          // 日蚀周围的大气辉光
          col += vec3(1.0, 0.45, 0.2) * pow(max(cosA, 0.0), 6.0) * 0.55;
          col += vec3(1.0, 0.7, 0.45) * pow(max(cosA, 0.0), 40.0) * 0.6;

          // 星空
          vec3 sp = d * 220.0;
          float st = hash(floor(sp));
          float star = step(0.9965, st) * smoothstep(0.1, 0.5, h);
          star *= 0.6 + 0.4 * sin(uTime * 2.0 + st * 100.0);
          col += vec3(0.8, 0.9, 1.0) * star * 1.6;

          // 高空流云
          float cl = fbm(vec3(d.xz / (abs(d.y) + 0.25) * 1.3, uTime * 0.01));
          cl = smoothstep(0.5, 0.85, cl) * smoothstep(0.0, 0.3, h) * (1.0 - smoothstep(0.5, 0.9, h));
          col = mix(col, vec3(0.5, 0.22, 0.2) + vec3(0.6, 0.3, 0.15) * pow(max(cosA, 0.0), 3.0), cl * 0.45);

          // 日蚀：黑色圆盘 + 日冕
          float ang = acos(clamp(cosA, -1.0, 1.0));
          float R = 0.105;
          float disc = smoothstep(R, R - 0.004, ang);
          // 日冕射线
          vec3 up = normalize(cross(uSunDir, vec3(0.0, 1.0, 0.0)));
          vec3 rt = cross(up, uSunDir);
          float az = atan(dot(d, up), dot(d, rt));
          float rays = 0.6 + 0.4 * noise(vec3(az * 6.0, uTime * 0.05, 1.0)) + 0.25 * noise(vec3(az * 22.0, 3.0, uTime * 0.08));
          float corona = exp(-(ang - R) * 16.0) * rays * step(R - 0.004, ang);
          float rim = exp(-abs(ang - R) * 260.0);
          col += vec3(1.0, 0.62, 0.3) * corona * 2.4;
          col += vec3(1.0, 0.9, 0.75) * rim * 6.0;
          // 钻石环
          vec3 bead = normalize(uSunDir + up * R * 0.72 + rt * R * 0.72);
          col += vec3(1.0, 0.95, 0.85) * pow(max(dot(d, bead), 0.0), 9000.0) * 14.0;
          col = mix(col, vec3(0.004, 0.004, 0.008), disc);

          // 远处的环状行星
          vec3 pDir = normalize(vec3(0.62, 0.36, 0.55));
          float pa = acos(clamp(dot(d, pDir), -1.0, 1.0));
          float pr = 0.045;
          if (pa < pr) {
            float lit = clamp(dot(normalize(d - pDir), normalize(uSunDir - pDir)) * 0.7 + 0.35, 0.0, 1.0);
            vec3 pc = mix(vec3(0.05, 0.04, 0.08), vec3(0.75, 0.5, 0.42), lit);
            pc *= 0.8 + 0.2 * sin(d.y * 900.0);
            col = mix(col, pc, smoothstep(pr, pr - 0.003, pa));
          }

          // 地平线以下压暗
          col *= smoothstep(-0.2, 0.0, d.y) * 0.85 + 0.15;
          gl_FragColor = vec4(col * uIntensity, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1000;
    this.mesh.matrixAutoUpdate = true;
  }

  update(camPos: THREE.Vector3, time: number): void {
    this.mesh.position.copy(camPos);
    this.material.uniforms.uTime.value = time;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
