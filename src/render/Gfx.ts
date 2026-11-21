import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { Quality } from '../core/Settings';
import { damp } from '../core/math';
import { LightPool } from './LightPool';
import { Sky } from './Sky';
import { setMaxAnisotropy } from './Textures';

/** 分区环境参数：雾、环境光、主光 */
export interface ZoneEnv {
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** 主光方向（从光源指向场景的反方向，即光源所在方向） */
  sunDir: [number, number, number];
  exposure: number;
  envIntensity: number;
}

const FinalShader = {
  name: 'EclipseFinal',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uExposure: { value: 1 },
    uVignette: { value: 0.42 },
    uDamage: { value: 0 },
    uLowHealth: { value: 0 },
    uAberration: { value: 0.0012 },
    uGrain: { value: 0.035 },
    uFlash: { value: 0 },
    uDesat: { value: 0 },
    uFade: { value: 0 },
    uShield: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uVignette, uDamage, uLowHealth, uAberration, uGrain, uFlash, uDesat, uFade, uShield;
    varying vec2 vUv;

    // ACES 拟合（Narkowicz）
    vec3 aces(vec3 x) {
      const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
      return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
    }
    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // 色差：边缘更强，受伤时加剧
      float ab = (uAberration + uDamage * 0.004) * (0.3 + r2 * 4.0);
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + c * ab).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - c * ab).b;

      col *= uExposure;
      col = aces(col);
      // 轻微的冷暖分离调色：暗部偏青，亮部偏暖
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, col * vec3(0.94, 1.0, 1.07), (1.0 - l) * 0.35);
      col = mix(col, col * vec3(1.05, 1.0, 0.95), l * 0.3);
      col = mix(col, vec3(l), uDesat);

      // 暗角
      float vig = smoothstep(0.85, 0.2, sqrt(r2) * 1.25);
      col *= mix(1.0, vig, uVignette);

      // 受伤红晕 / 低血量脉动
      float edge = smoothstep(0.18, 0.75, sqrt(r2) * 1.3);
      float pulse = 0.6 + 0.4 * sin(uTime * 5.5);
      col = mix(col, vec3(0.75, 0.02, 0.02), edge * clamp(uDamage * 0.75 + uLowHealth * 0.35 * pulse, 0.0, 0.85));
      // 护甲受击青色闪烁
      col += vec3(0.1, 0.5, 0.7) * edge * uShield * 0.5;

      col += vec3(uFlash);
      col = pow(col, vec3(1.0 / 2.2));
      col += (hash(vUv * vec2(1920.0, 1080.0) + uTime * 60.0) - 0.5) * uGrain;
      col *= 1.0 - uFade;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

export class Gfx {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** 第一人称武器独立相机（layer 1），固定 FOV，深度独立，不会穿墙 */
  weaponCamera: THREE.PerspectiveCamera;
  composer!: EffectComposer;
  private worldPass!: RenderPass;
  private weaponPass!: RenderPass;
  private bloomPass!: UnrealBloomPass;
  private finalPass!: ShaderPass;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fog: THREE.FogExp2;
  sky: Sky;
  lights: LightPool;
  weaponKey!: THREE.DirectionalLight;
  weaponRim!: THREE.DirectionalLight;
  /** 枪口闪光灯（复用） */
  muzzleLight: THREE.PointLight;
  /** 爆炸/能量弹等瞬时灯光池 */
  private fxLights: { light: THREE.PointLight; life: number; maxLife: number; intensity: number }[] = [];
  quality: Quality = 'high';
  envTarget: ZoneEnv | null = null;
  private sunDir = new THREE.Vector3(0.3, 1, 0.2).normalize();
  private sunDirTarget = new THREE.Vector3(0.3, 1, 0.2).normalize();
  private envRT: THREE.WebGLRenderTarget | null = null;
  shadowsEnabled = true;
  weaponVisible = true;
  time = 0;

  // 后期参数（由 Game 驱动）
  fx = { damage: 0, lowHealth: 0, flash: 0, desat: 0, fade: 0, shield: 0, exposureMul: 1 };
  private exposure = 1;

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', stencil: false, alpha: false });
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // 最终通道里手动做色调映射与 gamma
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.domElement.id = 'game-canvas';
    container.appendChild(this.renderer.domElement);
    setMaxAnisotropy(Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));

    this.scene = new THREE.Scene();
    this.fog = new THREE.FogExp2(0x0a0d12, 0.012);
    this.scene.fog = this.fog;

    this.camera = new THREE.PerspectiveCamera(90, 1, 0.06, 900);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.weaponCamera = new THREE.PerspectiveCamera(58, 1, 0.01, 10);
    this.weaponCamera.layers.set(1);
    this.scene.add(this.weaponCamera);

    this.hemi = new THREE.HemisphereLight(0x8fb4ff, 0x1a1410, 0.5);
    this.hemi.layers.enable(1);
    this.scene.add(this.hemi);

    this.sun = new THREE.DirectionalLight(0xffffff, 1);
    this.sun.layers.enable(1);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -30;
    sc.right = 30;
    sc.top = 30;
    sc.bottom = -30;
    sc.near = 1;
    sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // 第一人称武器专用补光（仅 layer 1）：保证枪模在任何环境下都清晰可读
    this.weaponKey = new THREE.DirectionalLight(0xe6efff, 1.5);
    this.weaponKey.layers.set(1);
    this.weaponKey.position.set(-0.7, 1.0, 0.5);
    this.weaponKey.target.position.set(0.1, -0.1, -1);
    this.weaponCamera.add(this.weaponKey, this.weaponKey.target);
    this.weaponRim = new THREE.DirectionalLight(0x35e0ff, 0.5);
    this.weaponRim.layers.set(1);
    this.weaponRim.position.set(1.0, 0.2, -0.8);
    this.weaponRim.target.position.set(0, -0.1, -0.5);
    this.weaponCamera.add(this.weaponRim, this.weaponRim.target);

    this.sky = new Sky();
    this.scene.add(this.sky.mesh);

    this.lights = new LightPool(this.scene, 8);

    this.muzzleLight = new THREE.PointLight(0xffc37a, 0, 14, 1.8);
    this.muzzleLight.layers.enable(1);
    this.scene.add(this.muzzleLight);
    for (let i = 0; i < 3; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 16, 1.8);
      light.layers.enable(1);
      this.scene.add(light);
      this.fxLights.push({ light, life: 0, maxLife: 1, intensity: 0 });
    }

    this.buildEnvironment();
    this.buildComposer();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  /** 程序化生成环境反射贴图：冷色顶灯 + 青/橙条形灯，给金属表面提供统一的反射基调 */
  private buildEnvironment(): void {
    const envScene = new THREE.Scene();
    const room = new THREE.Mesh(new THREE.BoxGeometry(20, 10, 20), new THREE.MeshBasicMaterial({ color: 0x0b0e13, side: THREE.BackSide }));
    envScene.add(room);
    const addPanel = (color: number, k: number, x: number, y: number, z: number, w: number, h: number, ry: number, rx = 0): void => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), side: THREE.DoubleSide }));
      m.position.set(x, y, z);
      m.rotation.set(rx, ry, 0);
      envScene.add(m);
    };
    addPanel(0xcfe4ff, 5, 0, 4.9, 0, 9, 3, 0, Math.PI / 2);
    addPanel(0xcfe4ff, 3, 0, 4.9, -6, 12, 1, 0, Math.PI / 2);
    addPanel(0x35e0ff, 4, -9.9, 0.5, 0, 10, 0.6, Math.PI / 2);
    addPanel(0xff8a2a, 4, 9.9, -1, 2, 8, 0.6, -Math.PI / 2);
    addPanel(0x9ab8ff, 1.5, 0, 0, -9.9, 12, 3, 0);
    addPanel(0x2a3340, 1.0, 0, -4.9, 0, 20, 20, 0, -Math.PI / 2);
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envRT = pmrem.fromScene(envScene, 0.04);
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    envScene.traverse((o) => {
      if (o instanceof THREE.Mesh) {
        o.geometry.dispose();
        (o.material as THREE.Material).dispose();
      }
    });
  }

  private buildComposer(): void {
    const q = this.quality;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: THREE.HalfFloatType,
      samples: q === 'high' ? 4 : q === 'medium' ? 2 : 0,
    });
    if (this.composer) this.composer.dispose();
    this.composer = new EffectComposer(this.renderer, rt);
    this.worldPass = new RenderPass(this.scene, this.camera);
    this.weaponPass = new RenderPass(this.scene, this.weaponCamera);
    this.weaponPass.clear = false;
    this.weaponPass.clearDepth = true;
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.62, 1.0);
    this.bloomPass.enabled = q !== 'low';
    this.finalPass = new ShaderPass(FinalShader);
    this.composer.addPass(this.worldPass);
    this.composer.addPass(this.weaponPass);
    this.composer.addPass(this.bloomPass);
    this.composer.addPass(this.finalPass);
  }

  setQuality(q: Quality): void {
    this.quality = q;
    const dpr = window.devicePixelRatio || 1;
    const ratio = q === 'high' ? Math.min(dpr, 1.5) : q === 'medium' ? Math.min(dpr, 1) : Math.min(dpr, 1) * 0.75;
    this.renderer.setPixelRatio(ratio);
    this.shadowsEnabled = q !== 'low';
    this.sun.castShadow = this.shadowsEnabled;
    const ms = q === 'high' ? 2048 : 1024;
    if (this.sun.shadow.mapSize.x !== ms) {
      this.sun.shadow.mapSize.set(ms, ms);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    this.lights.resize(q === 'high' ? 8 : q === 'medium' ? 6 : 4);
    this.buildComposer();
    this.resize();
  }

  resize(): void {
    const w = Math.max(1, this.container.clientWidth || window.innerWidth);
    const h = Math.max(1, this.container.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.weaponCamera.aspect = w / h;
    this.weaponCamera.updateProjectionMatrix();
  }

  /** 立即应用环境参数（重生/切换存档点时避免渐变） */
  applyEnvImmediate(env: ZoneEnv): void {
    this.envTarget = env;
    this.fog.color.setHex(env.fogColor);
    this.fog.density = env.fogDensity;
    this.hemi.color.setHex(env.hemiSky);
    this.hemi.groundColor.setHex(env.hemiGround);
    this.hemi.intensity = env.hemiIntensity;
    this.sun.color.setHex(env.sunColor);
    this.sun.intensity = env.sunIntensity;
    this.sunDir.set(...env.sunDir).normalize();
    this.sunDirTarget.copy(this.sunDir);
    this.exposure = env.exposure;
    this.scene.environmentIntensity = env.envIntensity;
  }

  private static _c = new THREE.Color();
  private updateEnv(dt: number): void {
    const env = this.envTarget;
    if (!env) return;
    const k = 1 - Math.exp(-2.2 * dt);
    const c = Gfx._c;
    this.fog.color.lerp(c.setHex(env.fogColor), k);
    this.fog.density = damp(this.fog.density, env.fogDensity, 2.2, dt);
    this.hemi.color.lerp(c.setHex(env.hemiSky), k);
    this.hemi.groundColor.lerp(c.setHex(env.hemiGround), k);
    this.hemi.intensity = damp(this.hemi.intensity, env.hemiIntensity, 2.2, dt);
    this.sun.color.lerp(c.setHex(env.sunColor), k);
    this.sun.intensity = damp(this.sun.intensity, env.sunIntensity, 2.2, dt);
    this.sunDirTarget.set(...env.sunDir).normalize();
    this.sunDir.lerp(this.sunDirTarget, k).normalize();
    this.exposure = damp(this.exposure, env.exposure, 2.2, dt);
    this.scene.environmentIntensity = damp(this.scene.environmentIntensity, env.envIntensity, 2.2, dt);
  }

  /** 触发一次瞬时点光（爆炸、能量弹命中等） */
  flashLight(pos: THREE.Vector3, color: number, intensity: number, distance: number, life: number): void {
    let best = this.fxLights[0];
    for (const f of this.fxLights) {
      if (f.life <= 0) {
        best = f;
        break;
      }
      if (f.life / f.maxLife < best.life / best.maxLife) best = f;
    }
    best.light.position.copy(pos);
    best.light.color.setHex(color);
    best.light.distance = distance;
    best.intensity = intensity;
    best.life = life;
    best.maxLife = life;
  }

  private _fwd = new THREE.Vector3();
  update(dt: number, alarm: number): void {
    this.time += dt;
    this.updateEnv(dt);
    this.camera.getWorldDirection(this._fwd);
    this.lights.update(dt, this.time, this.camera.position, this._fwd, alarm);
    for (const f of this.fxLights) {
      if (f.life > 0) {
        f.life -= dt;
        const t = Math.max(0, f.life / f.maxLife);
        f.light.intensity = f.intensity * t * t;
      } else f.light.intensity = 0;
    }
    this.muzzleLight.intensity = Math.max(0, this.muzzleLight.intensity - dt * 900);
    // 阴影相机跟随玩家，并对齐到纹素网格，避免移动时阴影闪烁
    const focus = this.camera.position;
    const texel = 60 / this.sun.shadow.mapSize.x;
    const fx = Math.round(focus.x / texel) * texel;
    const fz = Math.round(focus.z / texel) * texel;
    this.sun.target.position.set(fx, 0, fz);
    this.sun.position.set(fx, 0, fz).addScaledVector(this.sunDir, 60);
    this.sun.target.updateMatrixWorld();
    this.sky.update(this.camera.position, this.time);
  }

  render(): void {
    // 武器相机跟随主相机
    this.weaponCamera.position.copy(this.camera.position);
    this.weaponCamera.quaternion.copy(this.camera.quaternion);
    this.weaponCamera.updateMatrixWorld(true);
    this.weaponPass.enabled = this.weaponVisible;
    const u = this.finalPass.uniforms;
    u.uTime.value = this.time;
    u.uExposure.value = this.exposure * this.fx.exposureMul;
    u.uDamage.value = this.fx.damage;
    u.uLowHealth.value = this.fx.lowHealth;
    u.uFlash.value = this.fx.flash;
    u.uDesat.value = this.fx.desat;
    u.uFade.value = this.fx.fade;
    u.uShield.value = this.fx.shield;
    this.renderer.shadowMap.needsUpdate = this.shadowsEnabled;
    this.composer.render();
  }

  dispose(): void {
    this.lights.dispose();
    this.sky.dispose();
    this.envRT?.dispose();
    this.composer.dispose();
    this.renderer.dispose();
  }
}
