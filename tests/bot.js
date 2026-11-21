// 注入页面的自动游玩机器人（仅用于自动化测试）。通过 __ECLIPSE__ 测试钩子驱动真实的输入 → 模拟循环。
(() => {
  const E = window.__ECLIPSE__;
  const g = E.game;
  const DT = 1 / 30;
  const H = { sentry: 1.05, stalker: 1.1, juggernaut: 1.5, wasp: 0, boss: 3.3 };
  const keys = (m) => { for (const k in m) E.key(k, m[k]); };
  const release = () => keys({ KeyW: false, KeyA: false, KeyD: false, KeyS: false, Mouse0: false, ShiftLeft: false, Space: false });
  const V = (x, y, z) => g.player.pos.clone().set(x, y, z);
  const playing = () => g.state === 'playing';

  function faceXZ(x, z) {
    const p = g.player;
    p.yaw = Math.atan2(-(x - p.pos.x), -(z - p.pos.z));
    p.pitch = 0;
  }

  /** 直线走向目标（不寻路，用于楼梯/走道） */
  function walkTo(x, z, timeout = 12, tol = 0.7) {
    let t = 0;
    while (playing() && t < timeout) {
      const p = g.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) break;
      faceXZ(x, z);
      keys({ KeyW: true, ShiftLeft: true });
      E.step(DT, 1);
      t += DT;
    }
    release();
    return Math.hypot(x - g.player.pos.x, z - g.player.pos.z) < tol + 0.3;
  }

  /** 沿导航网格走向目标 */
  function goTo(x, z, timeout = 40, tol = 0.8) {
    let t = 0;
    let path = null;
    let idx = 0;
    let repath = 0;
    let stuckT = 0;
    let last = g.player.pos.clone();
    while (playing() && t < timeout) {
      const p = g.player.pos;
      if (Math.hypot(x - p.x, z - p.z) < tol) break;
      repath -= DT;
      if (!path || repath <= 0) {
        path = g.nav.findPath(p, V(x, 0, z), 0.42);
        idx = 0;
        repath = 1.0;
      }
      let tx = x;
      let tz = z;
      if (path && path.length) {
        while (idx < path.length - 1 && Math.hypot(path[idx].x - p.x, path[idx].z - p.z) < 0.6) idx++;
        tx = path[idx].x;
        tz = path[idx].z;
      }
      faceXZ(tx, tz);
      keys({ KeyW: true, ShiftLeft: true });
      // 卡住时跳一下
      stuckT += DT;
      if (stuckT > 1) {
        if (p.distanceTo(last) < 0.4) keys({ Space: true });
        last = p.clone();
        stuckT = 0;
      }
      E.step(DT, 1);
      keys({ Space: false });
      t += DT;
    }
    release();
    return Math.hypot(x - g.player.pos.x, z - g.player.pos.z) < tol + 0.4;
  }

  function targetPoint(e) {
    if (e.type === 'boss') {
      if (e.coreOpen) {
        e.rig.root.updateMatrixWorld(true);
        return e.rig.muzzle.getWorldPosition(V(0, 0, 0));
      }
      return V(e.pos.x, 3.3, e.pos.z);
    }
    return V(e.pos.x, e.pos.y + H[e.type], e.pos.z);
  }

  /**
   * 战斗：瞄准可见的最近敌人并射击；看不到敌人时沿导航网格接近。
   * done() 返回 true 时结束。返回耗时（游戏内秒）。
   */
  function fight(done, timeout = 120, filter = () => true) {
    let t = 0;
    let strafe = 1;
    let strafeT = 0;
    let path = null;
    let idx = 0;
    let repath = 0;
    const eye = V(0, 0, 0);
    while (playing() && t < timeout && !done()) {
      const p = g.player;
      p.eyePos(eye);
      let best = null;
      let bestD = 1e9;
      let nearest = null;
      let nearestD = 1e9;
      for (const e of g.enemies.list) {
        if (!e.alive || !filter(e)) continue;
        if (e.type === 'boss' && !e.fighting) continue;
        const d = Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
        if (d < nearestD) { nearestD = d; nearest = e; }
        const tp = targetPoint(e);
        if (d < 70 && g.physics.lineOfSight(eye, tp) && d < bestD) { bestD = d; best = e; }
      }
      release();
      if (best) {
        const tp = targetPoint(best);
        // 对投射物武器做简单的提前量
        E.aimAt(tp.x, tp.y, tp.z);
        const w = g.weapons;
        // 近距离优先霰弹枪；实弹打光后换能量步枪
        const want = bestD < 9 && w.state.viper.owned && w.state.viper.mag + w.state.viper.reserve > 0 ? 'Digit2'
          : w.state.ar9.mag + w.state.ar9.reserve > 0 ? 'Digit1' : w.state.helix.owned ? 'Digit3' : 'Digit1';
        E.key(want, true);
        const fire = !(w.current === 'helix' && w.heat01 > 0.85);
        // 霰弹枪是半自动：每隔一帧松开扳机
        const semi = w.current === 'viper' && Math.floor(t / DT) % 2 === 0;
        E.key('Mouse0', fire && !semi);
        strafeT -= DT;
        if (strafeT <= 0) { strafe = -strafe; strafeT = 0.7 + Math.random() * 0.8; }
        E.key(strafe > 0 ? 'KeyD' : 'KeyA', true);
        if (bestD < 5 && best.type !== 'wasp') E.key('KeyS', true);
        E.step(DT, 1);
        E.key(want, false);
        path = null;
      } else if (nearest) {
        repath -= DT;
        if (!path || repath <= 0) {
          path = g.nav.findPath(p.pos, nearest.pos, 0.42);
          idx = 0;
          repath = 0.8;
        }
        if (path && path.length) {
          while (idx < path.length - 1 && Math.hypot(path[idx].x - p.pos.x, path[idx].z - p.pos.z) < 0.6) idx++;
          faceXZ(path[idx].x, path[idx].z);
        } else faceXZ(nearest.pos.x, nearest.pos.z);
        keys({ KeyW: true });
        E.step(DT, 1);
      } else {
        E.step(DT, 1);
      }
      t += DT;
    }
    release();
    E.step(DT, 1);
    return t;
  }

  function pressE() {
    E.key('KeyE', true);
    E.step(DT, 1);
    E.key('KeyE', false);
    E.step(DT, 4);
  }

  function shootAt(x, y, z, seconds) {
    E.aimAt(x, y, z);
    E.key('Mouse0', true);
    E.step(DT, Math.round(seconds / DT));
    E.key('Mouse0', false);
    E.step(DT, 3);
  }

  const alive = (enc) => g.enemies.aliveCount(enc);
  const info = () => {
    const p = g.player;
    const w = g.weapons;
    return `stage=${g.level.stage} zone=${g.level.zone} cp=${g.level.checkpoint} hp=${Math.round(p.health)} ar=${Math.round(p.armor)} pos=(${p.pos.x.toFixed(1)},${p.pos.y.toFixed(1)},${p.pos.z.toFixed(1)}) kills=${g.stats.kills} t=${g.stats.time.toFixed(0)}s ammo=AR ${w.state.ar9.mag}/${w.state.ar9.reserve} VP ${w.state.viper.mag}/${w.state.viper.reserve} state=${g.state}`;
  };
  window.__BOT__ = { walkTo, goTo, fight, pressE, shootAt, alive, info, release, DT };
})();
