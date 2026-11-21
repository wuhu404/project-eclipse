import * as THREE from 'three';
import { Game } from './core/Game';
import './styles.css';

const container = document.getElementById('viewport') as HTMLElement;
const game = new Game(container);
const params = new URLSearchParams(location.search);
// ?test=1：自动化测试模式——主循环只渲染，模拟由 __ECLIPSE__.step() 手动推进
game.manual = params.has('test');

/** 自动化测试与调试接口（不影响正常游玩） */
const api = {
  game,
  ready: false,
  error: '' as string,
  snapshot() {
    const g = game;
    const p = g.player;
    const w = g.weapons;
    return {
      state: g.state,
      screen: g.menus.current,
      stage: g.level.stage,
      zone: g.level.zone,
      checkpoint: g.level.checkpoint,
      objective: g.hud.objectiveText,
      prompt: g.level.prompt,
      time: g.time,
      locked: g.input.locked,
      player: {
        x: p.pos.x, y: p.pos.y, z: p.pos.z, yaw: p.yaw, pitch: p.pitch, hp: p.health, armor: p.armor, alive: p.alive,
        grounded: p.grounded, crouching: p.crouching, sliding: p.sliding, sprinting: p.sprinting, speed: p.speed2D, keycard: p.hasKeycard,
      },
      weapon: { id: w.current, mag: w.cur.mag, reserve: w.cur.reserve, heat: w.state.helix.heat, overheated: w.overheated, reloading: w.reloading, ads: w.adsAmount, owned: Object.keys(w.state).filter((k) => w.state[k as 'ar9'].owned) },
      enemies: g.enemies.list.filter((e) => e.type !== 'boss').map((e) => ({ id: e.id, type: e.type, state: e.state, hp: e.hp, alive: e.alive, x: e.pos.x, y: e.pos.y, z: e.pos.z, dist: e.dist, canSee: e.canSee, encounter: e.encounter })),
      boss: g.enemies.boss ? { hp: g.enemies.boss.hp, maxHp: g.enemies.boss.maxHp, phase: g.enemies.boss.phase, mode: g.enemies.boss.mode, alive: g.enemies.boss.alive, coreOpen: g.enemies.boss.coreOpen, x: g.enemies.boss.pos.x, z: g.enemies.boss.pos.z, yaw: g.enemies.boss.yaw } : null,
      stats: { ...g.stats },
    };
  },
  step: (dt = 1 / 60, n = 1) => game.step(dt, n),
  key: (code: string, down: boolean) => game.input.simulate(code, down),
  mouse: (dx: number, dy: number) => {
    game.input.mouseDX += dx;
    game.input.mouseDY += dy;
  },
  look: (yaw: number, pitch: number) => {
    game.player.yaw = yaw;
    game.player.pitch = pitch;
    game.player.syncCamera(0);
  },
  /** 让视角对准世界坐标点 */
  aimAt: (x: number, y: number, z: number) => {
    const p = game.player;
    const eye = p.eyePos(new THREE.Vector3());
    const dx = x - eye.x;
    const dy = y - eye.y;
    const dz = z - eye.z;
    p.yaw = Math.atan2(-dx, -dz);
    p.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    p.syncCamera(0);
  },
  teleport: (x: number, z: number, yaw = 0, y = 0.02) => {
    game.player.teleport(x, y, z, yaw);
    game.physics.flush();
  },
  virtualLock: (on: boolean) => {
    game.input.virtualLock = on;
  },
  god: (on: boolean) => {
    game.player.godMode = on;
  },
  interact: (id: string) => game.level.interact(id),
  perf: () => game.perf(),
};
(window as unknown as { __ECLIPSE__: typeof api }).__ECLIPSE__ = api;

game
  .init()
  .then(() => {
    api.ready = true;
  })
  .catch((err: unknown) => {
    console.error(err);
    api.error = err instanceof Error ? err.message : String(err);
    const text = document.getElementById('error-text');
    const screen = document.getElementById('screen-error');
    document.getElementById('screen-loading')?.classList.add('hidden');
    if (text) text.textContent = '初始化失败：' + api.error + '。请确认浏览器支持 WebGL2 并已启用硬件加速。';
    screen?.classList.remove('hidden');
  });
