import * as THREE from 'three';
import { AudioEngine, MusicMode } from '../audio/AudioEngine';
import { EnemyManager } from '../enemies/EnemyManager';
import { Fx } from '../fx/Fx';
import { Level, Stage, ZONE_NAMES } from '../level/Level01';
import { NavGrid } from '../level/NavGrid';
import { initRapier, Physics } from '../physics/Physics';
import { Player } from '../player/Player';
import { Gfx } from '../render/Gfx';
import { MaterialLibrary } from '../render/Materials';
import { Hud } from '../ui/Hud';
import { Menus } from '../ui/Menus';
import { Projectiles } from '../weapons/Projectiles';
import { WeaponSystem } from '../weapons/WeaponSystem';
import { Ctx, DIFFICULTY, DifficultyTuning } from './Context';
import { Input } from './Input';
import { clamp, damp } from './math';
import { newStats, Quality, RunStats, SaveSystem, Settings } from './Settings';

export type GameState = 'loading' | 'menu' | 'briefing' | 'playing' | 'paused' | 'dead' | 'victory';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const nextFrame = (): Promise<void> => new Promise((r) => requestAnimationFrame(() => r()));

/**
 * 游戏主控：创建并持有全部子系统（同时就是它们共享的 Ctx），驱动状态机与主循环。
 */
export class Game implements Ctx {
  gfx!: Gfx;
  input!: Input;
  settings = new Settings();
  audio = new AudioEngine();
  mats!: MaterialLibrary;
  physics!: Physics;
  nav!: NavGrid;
  fx!: Fx;
  hud!: Hud;
  player!: Player;
  weapons!: WeaponSystem;
  projectiles!: Projectiles;
  enemies!: EnemyManager;
  level!: Level;
  stats: RunStats = newStats();
  tuning: DifficultyTuning = DIFFICULTY.normal;
  time = 0;
  alarm = 0;

  state: GameState = 'loading';
  menus!: Menus;
  /** 测试模式：主循环只渲染，不自动推进模拟（由 step() 手动推进） */
  manual = false;
  private last = 0;
  private hitStopT = 0;
  private hitStopScale = 1;
  private stateT = 0;
  private quality: Quality = 'high';
  private combatHold = 0;
  private music: MusicMode = 'none';
  private fadeEl = document.getElementById('fade') as HTMLElement;
  private deadShown = false;
  private victoryShown = false;
  private wantLock = false;
  private frameMs: number[] = [];
  private raf = 0;

  constructor(private container: HTMLElement) {}

  // =================================================================================
  // 初始化
  // =================================================================================
  async init(): Promise<void> {
    this.menus = new Menus(this.settings, this.audio, {
      newGame: () => this.openBriefing(),
      continueGame: () => this.continueGame(),
      deploy: () => this.startRun(0, true),
      resume: () => this.resume(),
      retry: () => this.retry(),
      quit: () => this.quitToMenu(),
    });
    const load = async (p: number, text: string): Promise<void> => {
      this.menus.setLoading(p, text);
      await nextFrame();
    };
    await load(0.05, '加载物理引擎…');
    await initRapier();
    await load(0.2, '初始化渲染管线…');
    this.gfx = new Gfx(this.container);
    this.quality = this.settings.data.quality;
    this.gfx.setQuality(this.quality);
    this.input = new Input(this.gfx.renderer.domElement);
    await load(0.35, '生成程序化材质…');
    this.mats = new MaterialLibrary();
    await load(0.55, '构建物理世界…');
    this.physics = new Physics();
    this.nav = new NavGrid(-30, -238, 30, 72);
    this.fx = new Fx(this.gfx, this.mats);
    this.hud = new Hud();
    this.player = new Player(this);
    this.weapons = new WeaponSystem(this);
    this.projectiles = new Projectiles(this);
    this.enemies = new EnemyManager(this);
    await load(0.7, '搭建日蚀站…');
    this.level = new Level(this);
    this.level.onCheckpoint = (i) => this.saveCheckpoint(i);
    this.level.onVictory = () => this.onVictory();
    await load(0.9, '校准传感器…');
    this.applySettings();
    this.settings.onChange(() => this.applySettings());
    this.bindEvents();
    this.resetWorld(0);
    // 预热：编译着色器，避免首次开火/爆炸时卡顿
    this.gfx.weaponVisible = true;
    this.gfx.renderer.compile(this.gfx.scene, this.gfx.camera);
    this.gfx.render();
    await load(1, '就绪');
    this.enterMenu();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private applySettings(): void {
    const d = this.settings.data;
    this.tuning = DIFFICULTY[d.difficulty];
    this.audio.setVolumes(d.masterVolume, d.sfxVolume, d.musicVolume);
    if (d.quality !== this.quality) {
      this.quality = d.quality;
      this.gfx.setQuality(d.quality);
    }
    this.fx.setViewportHeight(this.gfx.renderer.domElement.height, d.fov);
  }

  private bindEvents(): void {
    const input = this.input;
    input.onLockChange = (locked) => {
      if (locked) {
        this.wantLock = false;
        if (this.state === 'paused') this.setPlaying();
      } else if (this.state === 'playing' && !this.manual) this.pause();
    };
    input.onLockError = () => {
      // 浏览器拒绝锁定（例如 Esc 后 1 秒内）：保持暂停，等待下一次点击
      this.wantLock = false;
    };
    this.gfx.renderer.domElement.addEventListener('click', () => {
      this.audio.init();
      if (this.state === 'playing' && !input.isLocked()) input.requestLock();
    });
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'Escape') return;
      // 指针锁定状态下浏览器会吞掉 Esc 并解除锁定（由 onLockChange 处理）；这里处理未锁定的情况
      if (this.menus.back()) return;
      if (this.state === 'playing' && !input.locked) this.pause();
      else if (this.state === 'paused') this.resume();
      else if (this.state === 'briefing') this.enterMenu();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing' && !this.manual) this.pause();
        this.audio.suspend();
      } else if (this.state !== 'paused') this.audio.resume();
    });
    window.addEventListener('blur', () => {
      if (this.state === 'playing' && !this.manual) this.pause();
    });
    window.addEventListener('resize', () => this.fx.setViewportHeight(this.gfx.renderer.domElement.height, this.settings.data.fov));
  }

  // =================================================================================
  // Ctx 实现
  // =================================================================================
  shake(pos: THREE.Vector3 | null, amount: number, radius = 18): void {
    if (!pos) {
      this.player.addShake(amount);
      return;
    }
    const d = pos.distanceTo(this.player.pos);
    const k = clamp(1 - d / radius, 0, 1);
    if (k > 0) this.player.addShake(amount * k);
  }

  explode(pos: THREE.Vector3, radius: number, damage: number, source: 'player' | 'enemy' | 'world', color = 0xff8a2a): void {
    const p = _a.copy(pos);
    this.fx.explosion(p, radius * 0.55, color, true);
    this.audio.explosion(p, clamp(radius / 4.5, 0.5, 1.6));
    this.gfx.flashLight(p, color, 130, radius * 3.2, 0.4);
    this.shake(p, 0.85, radius * 4);
    const player = this.player;
    if (player.alive) {
      player.center(_b);
      const d = Math.max(0, _b.distanceTo(p) - player.radius);
      if (d < radius) {
        const from = new THREE.Vector3(p.x, p.y + 0.3, p.z);
        if (this.physics.lineOfSight(from, _b)) {
          const k = 1 - 0.7 * (d / radius);
          player.damage(damage * k * (source === 'enemy' ? 1 : 0.45), p);
          if (d > 0.01) {
            const push = 6 * k;
            player.vel.x += ((_b.x - p.x) / (d + player.radius)) * push;
            player.vel.z += ((_b.z - p.z) / (d + player.radius)) * push;
          }
        }
      }
    }
    if (source !== 'enemy') {
      const [hits, kills] = this.enemies.damageInRadius(p, radius, damage, 'explosion');
      if (hits > 0) this.hud.hitMarker(false, kills > 0);
      this.enemies.alertNear(p, 34);
    }
    this.level.damageBarrelsNear(p, radius, 100);
  }

  hitStop(duration: number, scale = 0.2): void {
    this.hitStopT = Math.max(this.hitStopT, duration);
    this.hitStopScale = scale;
  }

  // =================================================================================
  // 状态切换
  // =================================================================================
  private fade(opacity: number, instant = false): void {
    this.fadeEl.style.transition = instant ? 'none' : '';
    this.fadeEl.style.opacity = String(opacity);
    if (instant) void this.fadeEl.offsetWidth;
  }

  private setState(s: GameState): void {
    this.state = s;
    this.stateT = 0;
  }

  /** 重置世界到某个存档点（不改变游戏状态） */
  private resetWorld(cp: number): void {
    const sp = this.level.spawnPoint(cp);
    this.player.teleport(sp.x, 0.02, sp.z, sp.yaw);
    this.level.start(cp);
    this.physics.flush();
    this.gfx.fx.damage = 0;
    this.gfx.fx.flash = 0;
    this.gfx.fx.desat = 0;
    this.gfx.fx.shield = 0;
    this.gfx.fx.lowHealth = 0;
    this.hitStopT = 0;
    this.combatHold = 0;
    this.hud.reset();
  }

  private enterMenu(): void {
    this.setState('menu');
    this.hud.show(false);
    this.gfx.weaponVisible = false;
    this.level.playerHidden = true;
    this.menus.setContinue(SaveSystem.load(), ZONE_NAMES);
    this.menus.show('main');
    this.fade(0);
    this.setMusic('menu');
    this.audio.setAlarm(0);
    this.audio.setHeatWhine(0);
  }

  private openBriefing(): void {
    this.setState('briefing');
    this.menus.show('briefing');
  }

  private continueGame(): void {
    const save = SaveSystem.load();
    if (!save) return;
    this.startRun(save.checkpoint, false);
  }

  /** 开始一局：fresh=true 为全新开始，否则从存档恢复 */
  private startRun(cp: number, fresh: boolean): void {
    const save = fresh ? null : SaveSystem.load();
    if (fresh) SaveSystem.clear();
    this.stats = save ? { ...save.stats } : newStats();
    this.player.reset();
    this.weapons.reset();
    if (save) {
      this.weapons.importState(save.weapons, save.ammo);
      this.player.health = Math.max(60, save.health);
      this.player.armor = save.armor;
      this.player.hasKeycard = save.hasKeycard;
      cp = save.checkpoint;
    }
    this.fade(1, true);
    this.resetWorld(cp);
    this.level.playerHidden = false;
    this.deadShown = false;
    this.victoryShown = false;
    this.menus.show(null);
    this.hud.show(true);
    this.gfx.weaponVisible = true;
    this.setPlaying();
    this.requestLock();
    window.setTimeout(() => this.fade(0), 60);
    if (cp === 0) {
      // 空降着陆
      this.audio.land(1);
      this.audio.explosion(this.player.pos, 0.8);
      this.player.addShake(0.9);
      _a.set(0, 0.3, 57);
      this.fx.smoke(_a, 14, 1.6, { life: 2.4, alpha: 0.3, spread: 3, rise: 0.5 });
      this.hud.zoneName(ZONE_NAMES[0]);
    } else this.hud.banner('从检查点继续', ZONE_NAMES[this.level.zone]);
  }

  private requestLock(): void {
    if (this.manual) return;
    this.wantLock = true;
    this.input.requestLock();
  }

  private setPlaying(): void {
    this.setState('playing');
    this.menus.show(null);
    this.audio.resume();
    this.last = performance.now();
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.setState('paused');
    this.input.clearAll();
    this.menus.setPauseObjective(this.hud.objectiveText);
    this.menus.show('pause');
    this.audio.suspend();
    this.input.exitLock();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.audio.init();
    if (this.manual || this.input.virtualLock || this.input.locked) {
      this.setPlaying();
      return;
    }
    // 先请求锁定；锁定成功后由 onLockChange 切回 playing。
    // 若浏览器因 Esc 冷却而拒绝，则直接恢复游戏，玩家点击画面即可重新锁定。
    this.requestLock();
    window.setTimeout(() => {
      if (this.state === 'paused' && this.menus.current === null) this.setPlaying();
    }, 400);
    this.menus.show(null);
  }

  private saveCheckpoint(index: number): void {
    const w = this.weapons.exportState();
    SaveSystem.save({
      checkpoint: index,
      weapons: w.weapons,
      ammo: w.ammo,
      health: this.player.health,
      armor: this.player.armor,
      hasKeycard: this.player.hasKeycard,
      stats: { ...this.stats },
      savedAt: Date.now(),
    });
  }

  /** 死亡或暂停菜单中：从最近的检查点重新开始 */
  retry(): void {
    const stats = { ...this.stats };
    const save = SaveSystem.load();
    const cp = save ? save.checkpoint : 0;
    this.player.reset();
    this.weapons.reset();
    if (save) {
      this.weapons.importState(save.weapons, save.ammo);
      this.player.health = Math.max(70, save.health);
      this.player.armor = save.armor;
      this.player.hasKeycard = save.hasKeycard;
    }
    // 保底弹药：避免在弹尽粮绝的存档里反复死亡
    const ar = this.weapons.state.ar9;
    ar.reserve = Math.max(ar.reserve, 90);
    this.stats = stats;
    this.fade(1, true);
    this.resetWorld(cp);
    this.level.playerHidden = false;
    this.deadShown = false;
    this.hud.show(true);
    this.gfx.weaponVisible = true;
    this.audio.init();
    this.setPlaying();
    this.requestLock();
    window.setTimeout(() => this.fade(0), 60);
    this.hud.banner('从检查点继续', ZONE_NAMES[this.level.zone]);
  }

  quitToMenu(): void {
    this.audio.resume();
    this.audio.stopAllLoops();
    this.input.exitLock();
    this.player.reset();
    this.weapons.reset();
    this.resetWorld(0);
    this.enterMenu();
  }

  private onDeath(): void {
    this.setState('dead');
    this.stats.deaths++;
    this.deadShown = false;
    this.gfx.weaponVisible = false;
    this.setMusic('none');
    this.audio.setHeatWhine(0);
  }

  private onVictory(): void {
    this.setState('victory');
    this.victoryShown = false;
    this.player.controlEnabled = false;
    this.player.godMode = true;
    this.audio.victorySting();
    this.setMusic('victory');
    SaveSystem.clear();
  }

  private setMusic(mode: MusicMode): void {
    if (mode === this.music) return;
    this.music = mode;
    this.audio.setMusic(mode);
  }

  // =================================================================================
  // 主循环
  // =================================================================================
  private frame = (now: number): void => {
    this.raf = requestAnimationFrame(this.frame);
    const realDt = clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    this.frameMs.push(realDt * 1000);
    if (this.frameMs.length > 240) this.frameMs.shift();
    if (!this.manual) this.tick(realDt);
    else if (this.state === 'menu' || this.state === 'briefing') this.updateMenuScene(realDt);
    this.gfx.render();
    this.input.endFrame();
  };

  /** 按当前状态推进一帧 */
  tick(realDt: number): void {
    this.stateT += realDt;
    switch (this.state) {
      case 'menu':
      case 'briefing':
        this.updateMenuScene(realDt);
        break;
      case 'playing': {
        let scale = 1;
        if (this.hitStopT > 0) {
          this.hitStopT -= realDt;
          scale = this.hitStopScale;
        }
        // 低帧率时把一帧拆成多个子步，保证物理与 AI 的稳定
        let remain = Math.min(realDt, 0.1) * scale;
        const maxStep = 1 / 30;
        let first = true;
        while (remain > 1e-5) {
          const dt = Math.min(maxStep, remain);
          remain -= dt;
          this.simulate(dt, first);
          first = false;
        }
        this.present(realDt * scale, realDt);
        if (!this.player.alive) this.onDeath();
        break;
      }
      case 'dead':
        // 死亡后世界以慢动作继续运转
        this.simulate(Math.min(realDt, 1 / 30) * 0.35, true);
        this.present(realDt * 0.35, realDt);
        this.gfx.fx.desat = damp(this.gfx.fx.desat, 0.85, 2, realDt);
        if (this.stateT > 1.6 && !this.deadShown) {
          this.deadShown = true;
          this.input.exitLock();
          this.hud.show(false);
          this.menus.show('dead');
        }
        break;
      case 'victory':
        this.simulate(Math.min(realDt, 1 / 30) * 0.6, true);
        this.present(realDt * 0.6, realDt);
        if (this.stateT > 3.2 && !this.victoryShown) {
          this.victoryShown = true;
          this.input.exitLock();
          this.hud.show(false);
          this.gfx.weaponVisible = false;
          this.menus.showVictory(this.stats, this.settings.data.difficulty);
        }
        break;
      case 'paused':
      case 'loading':
        break;
    }
  }

  /** 一个模拟子步 */
  private simulate(dt: number, firstSubstep: boolean): void {
    this.time += dt;
    if (this.state === 'playing') this.stats.time += dt;
    // 鼠标位移只在第一个子步生效
    if (!firstSubstep) {
      this.input.mouseDX = 0;
      this.input.mouseDY = 0;
    }
    this.player.update(dt);
    this.weapons.update(dt);
    this.projectiles.update(dt);
    this.enemies.update(dt);
    this.level.update(dt);
    this.physics.step(dt);
    if (!firstSubstep) return;
    // 一次性按键只在第一个子步被消费
    this.inputConsumed();
  }

  private inputConsumed(): void {
    // 留空：pressed/released 集合在帧尾由 Input.endFrame 清理；多子步时在这里提前清理，避免重复触发
    (this.input as unknown as { pressed: Set<string>; released: Set<string> }).pressed.clear();
    (this.input as unknown as { pressed: Set<string>; released: Set<string> }).released.clear();
    this.input.wheel = 0;
  }

  /** 表现层更新（特效、音频、后期、HUD）——每个渲染帧一次 */
  private present(dt: number, realDt: number): void {
    const gfx = this.gfx;
    const cam = gfx.camera;
    this.fx.update(dt, cam);
    this.mats.update(this.time, this.alarm);
    gfx.update(dt, this.alarm);
    const f = gfx.fx;
    f.damage = Math.max(0, f.damage - realDt * 1.6);
    f.flash = Math.max(0, f.flash - realDt * 1.1);
    f.shield = Math.max(0, f.shield - realDt * 2.2);
    cam.getWorldDirection(_a);
    this.audio.setListener(cam.position, _a);
    // 音乐：Boss > 战斗 > 探索
    if (this.state === 'playing') {
      const boss = this.enemies.boss;
      const inCombat = this.enemies.engagedCount() > 0 || this.level.stage === Stage.Defense;
      this.combatHold = inCombat ? 5 : Math.max(0, this.combatHold - realDt);
      this.setMusic(this.level.bossActive && boss && boss.alive ? 'boss' : this.combatHold > 0 ? 'combat' : 'explore');
    }
    this.audio.updateMusic();
    this.hud.update(this, dt, realDt);
  }

  /** 主菜单背景：镜头在着陆区缓慢游移，凝视基地外立面 */
  private updateMenuScene(realDt: number): void {
    const gfx = this.gfx;
    const t = performance.now() / 1000;
    const cam = gfx.camera;
    cam.position.set(Math.sin(t * 0.07) * 11 - 5, 4.2 + Math.sin(t * 0.11) * 0.8, 44 + Math.cos(t * 0.07) * 5);
    cam.fov = 62;
    cam.updateProjectionMatrix();
    cam.lookAt(3, 6.5, 11);
    cam.updateMatrixWorld(true);
    this.fx.update(realDt, cam);
    this.mats.update(t, 0);
    gfx.update(realDt, 0);
    const f = gfx.fx;
    f.damage = 0;
    f.flash = Math.max(0, f.flash - realDt);
    this.audio.updateMusic();
  }

  // =================================================================================
  // 测试 / 调试接口
  // =================================================================================
  /** 手动推进模拟（测试用）。返回推进后的状态。 */
  step(dt: number, n = 1): GameState {
    for (let i = 0; i < n; i++) {
      if (this.state === 'playing' || this.state === 'dead' || this.state === 'victory') {
        this.tick(dt);
        this.input.endFrame();
      }
    }
    return this.state;
  }

  perf(): { avgMs: number; fps: number; calls: number; triangles: number; particles: number } {
    const avg = this.frameMs.length ? this.frameMs.reduce((a, b) => a + b, 0) / this.frameMs.length : 0;
    const info = this.gfx.renderer.info;
    return { avgMs: avg, fps: avg > 0 ? 1000 / avg : 0, calls: info.render.calls, triangles: info.render.triangles, particles: this.fx.activeParticles };
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.level.dispose();
    this.enemies.dispose();
    this.projectiles.dispose();
    this.weapons.dispose();
    this.player.dispose();
    this.fx.dispose();
    this.mats.dispose();
    this.physics.dispose();
    this.gfx.dispose();
  }
}
