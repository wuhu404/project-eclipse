import * as THREE from 'three';
import type { Ctx } from '../core/Context';
import { clamp, damp } from '../core/math';
import { QUERY } from '../physics/Physics';
import { WEAPON_ORDER } from '../weapons/WeaponDefs';

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error('缺少 HUD 元素 #' + id);
  return el as T;
};

interface DmgArc {
  el: HTMLDivElement;
  life: number;
  src: THREE.Vector3;
}

const _v = new THREE.Vector3();
const _d = new THREE.Vector3();
const ROMAN = ['I', 'II', 'III'];

/** 军事科幻风格 HUD：全部用 DOM 实现，只在数值变化时写入 DOM。 */
export class Hud {
  private root = $('hud');
  private crosshair = $('crosshair');
  private hitmarkerEl = $('hitmarker');
  private hpFill = $('hp-fill');
  private hpLag = $('hp-lag');
  private hpNum = $('hp-num');
  private arFill = $('ar-fill');
  private arNum = $('ar-num');
  private vitals = $('vitals');
  private keycard = $('keycard');
  private weaponName = $('weapon-name');
  private weaponSub = $('weapon-sub');
  private ammo = $('ammo');
  private ammoMag = $('ammo-mag');
  private ammoRes = $('ammo-res');
  private heat = $('heat');
  private heatFill = $('heat-fill');
  private heatLabel = $('heat-label');
  private weaponWarn = $('weapon-warn');
  private slots = Array.from(document.querySelectorAll<HTMLElement>('#slots .slot'));
  private objective = $('objective');
  private objTitle = $('objective-title');
  private objDetail = $('objective-detail');
  private zone = $('zone-name');
  private bannerEl = $('banner');
  private bannerTitle = $('banner-title');
  private bannerSub = $('banner-sub');
  private boss = $('boss');
  private bossFill = $('boss-fill');
  private bossPhaseEl = $('boss-phase');
  private defense = $('defense');
  private defenseFill = $('defense-fill');
  private alertEl = $('alert-flash');
  private promptEl = $('prompt');
  private promptText = $('prompt-text');
  private hintEl = $('hint');
  private subtitleEl = $('subtitle');
  private subSpeaker = $('subtitle-speaker');
  private subText = $('subtitle-text');
  private toasts = $('toasts');
  private waypoint = $('waypoint');
  private waypointDist = $('waypoint-dist');
  private vignette = $('vignette-hit');
  private pickup = $('pickup-flash');
  private fpsEl = $('fps');
  private arcs: DmgArc[] = [];
  private cache: Record<string, string | number | boolean> = {};
  private subQueue: { speaker: string; text: string; dur: number }[] = [];
  private subT = 0;
  private hintT = 0;
  private vig = 0;
  private pick = 0;
  private gap = 8;
  private fpsAcc = 0;
  private fpsN = 0;
  private aimT = 0;
  private aimEnemy = false;
  private lastBossHp = 1;
  /** 最近一次显示的目标（暂停菜单读取） */
  objectiveText = '';

  constructor() {
    const host = $('dmg-indicators');
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'dmg-arc';
      host.appendChild(el);
      this.arcs.push({ el, life: 0, src: new THREE.Vector3() });
    }
  }

  show(v: boolean): void {
    this.root.classList.toggle('hidden', !v);
  }

  /** 新开一局 / 重试时清空瞬时元素 */
  reset(): void {
    this.subQueue.length = 0;
    this.subT = 0;
    this.subtitleEl.classList.add('hidden');
    this.hintEl.classList.add('hidden');
    this.hintT = 0;
    this.toasts.innerHTML = '';
    for (const a of this.arcs) {
      a.life = 0;
      a.el.style.opacity = '0';
    }
    this.vig = 0;
    this.pick = 0;
    this.boss.classList.add('hidden');
    this.defense.classList.add('hidden');
    this.promptEl.classList.add('hidden');
    this.waypoint.style.display = 'none';
    this.cache = {};
    this.lastBossHp = 1;
  }

  private set(key: string, value: string | number | boolean, apply: () => void): void {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    apply();
  }

  private restart(el: HTMLElement, cls = 'show'): void {
    el.classList.remove(cls);
    void el.offsetWidth; // 强制重排以重启 CSS 动画
    el.classList.add(cls);
  }

  // ---------- 事件式接口 ----------
  hitMarker(headshot: boolean, killed: boolean): void {
    this.hitmarkerEl.classList.toggle('head', headshot && !killed);
    this.hitmarkerEl.classList.toggle('kill', killed);
    this.restart(this.hitmarkerEl);
  }

  damageIndicator(src: THREE.Vector3): void {
    let arc = this.arcs[0];
    for (const a of this.arcs) {
      if (a.life <= 0) {
        arc = a;
        break;
      }
      if (a.life < arc.life) arc = a;
    }
    arc.life = 1.3;
    arc.src.copy(src);
    this.vig = Math.min(1, this.vig + 0.6);
  }

  toast(text: string): void {
    const el = document.createElement('div');
    el.className = 'toast';
    el.textContent = text;
    this.toasts.appendChild(el);
    while (this.toasts.childElementCount > 4) this.toasts.firstElementChild?.remove();
    window.setTimeout(() => el.remove(), 3000);
  }

  pickupFlash(color: number): void {
    this.pickup.style.setProperty('--c', '#' + color.toString(16).padStart(6, '0'));
    this.pick = 0.35;
  }

  enemyAlerted(): void {
    this.restart(this.alertEl);
  }

  subtitle(speaker: string, text: string, dur?: number): void {
    this.subQueue.push({ speaker, text, dur: dur ?? clamp(2.2 + text.length * 0.11, 3, 8) });
    if (this.subQueue.length > 3) this.subQueue.splice(0, this.subQueue.length - 3);
  }

  hint(text: string, dur = 9): void {
    this.hintEl.textContent = text;
    this.hintEl.classList.remove('hidden');
    this.hintT = dur;
  }

  clearHint(): void {
    this.hintT = 0;
    this.hintEl.classList.add('hidden');
  }

  setObjective(title: string, detail: string, flash: boolean): void {
    this.objTitle.textContent = title;
    this.objDetail.textContent = detail;
    this.objectiveText = detail ? `${title} — ${detail}` : title;
    if (flash) this.restart(this.objective, 'flash');
  }

  banner(title: string, sub: string, danger = false): void {
    this.bannerTitle.textContent = title;
    this.bannerSub.textContent = sub;
    this.bannerEl.classList.toggle('danger', danger);
    this.restart(this.bannerEl);
  }

  zoneName(name: string): void {
    this.zone.textContent = name;
    this.restart(this.zone);
  }

  bossPhase(phase: number): void {
    this.banner(`OMEGA-01 · 阶段 ${ROMAN[phase - 1] ?? phase}`, phase === 2 ? '扫射光束已解锁' : '核心过载 — 全功率输出', true);
  }

  // ---------- 每帧更新 ----------
  update(ctx: Ctx, dt: number, realDt: number): void {
    const player = ctx.player;
    const w = ctx.weapons;
    const level = ctx.level;

    // 生命 / 护甲
    const hp = Math.ceil(player.health);
    this.set('hp', hp, () => {
      const k = clamp(player.health / player.maxHealth, 0, 1);
      this.hpNum.textContent = String(hp);
      this.hpFill.style.transform = `scaleX(${k})`;
      this.hpLag.style.transform = `scaleX(${k})`;
      this.vitals.classList.toggle('low', hp <= 30);
    });
    const ar = Math.ceil(player.armor);
    this.set('ar', ar, () => {
      this.arNum.textContent = String(ar);
      this.arFill.style.transform = `scaleX(${clamp(player.armor / player.maxArmor, 0, 1)})`;
    });
    this.set('key', player.hasKeycard, () => this.keycard.classList.toggle('hidden', !player.hasKeycard));

    // 武器
    const def = w.def;
    const st = w.cur;
    this.set('wid', def.id, () => {
      this.weaponName.textContent = def.name;
      this.weaponSub.textContent = def.subtitle;
      this.ammo.classList.toggle('hidden', def.magSize === 0);
      this.heat.classList.toggle('hidden', def.magSize !== 0);
      this.crosshair.className = def.id;
      this.cache.aim = '';
    });
    let warn = '';
    if (def.magSize > 0) {
      this.set('mag', st.mag, () => {
        this.ammoMag.textContent = String(st.mag);
        this.ammo.classList.toggle('low', st.mag > 0 && st.mag <= def.magSize * 0.25);
        this.ammo.classList.toggle('empty', st.mag === 0);
      });
      this.set('res', st.reserve, () => (this.ammoRes.textContent = String(st.reserve)));
      if (w.reloading) warn = '装填中…';
      else if (st.mag === 0 && st.reserve === 0) warn = '弹药耗尽';
      else if (st.mag <= def.magSize * 0.25) warn = '按 R 换弹';
    } else {
      const heat = Math.round(st.heat);
      this.set('heat', heat, () => (this.heatFill.style.transform = `scaleX(${heat / 100})`));
      const over = st.overheat > 0;
      this.set('over', over, () => this.heat.classList.toggle('over', over));
      this.set('heatLabel', over ? '排热中' : `${heat}%`, () => (this.heatLabel.textContent = over ? '排热中' : `热量 ${heat}%`));
      if (over) warn = '过热 — 强制排热';
      else if (heat > 75) warn = '热量过高';
    }
    this.set('warn', warn, () => (this.weaponWarn.textContent = warn));
    for (const el of this.slots) {
      const id = el.dataset.slot as (typeof WEAPON_ORDER)[number];
      const cls = (w.state[id].owned ? 'owned ' : '') + (w.current === id ? 'active' : '');
      this.set('slot-' + id, cls, () => (el.className = 'slot ' + cls));
    }

    // 准星：扩散随后坐力/移动变化，开镜时淡出
    const fovRad = (ctx.gfx.camera.fov * Math.PI) / 180;
    const pxPerRad = window.innerHeight / 2 / Math.tan(fovRad / 2);
    const targetGap = 4 + Math.tan((w.crosshairSpread * Math.PI) / 180) * pxPerRad;
    this.gap = damp(this.gap, targetGap, 22, realDt);
    const kick = ctx.time - w.lastFireTime < 0.06 ? 3 : 0;
    this.crosshair.style.setProperty('--gap', (this.gap + kick).toFixed(1) + 'px');
    const alpha = player.alive ? clamp(1 - w.adsAmount * 1.6, 0, 1) * (player.sprinting ? 0.35 : 1) : 0;
    this.set('cha', Math.round(alpha * 20), () => this.crosshair.style.setProperty('--a', alpha.toFixed(2)));
    // 准星指向敌人时变红（每 0.1s 检测一次）
    this.aimT -= realDt;
    if (this.aimT <= 0) {
      this.aimT = 0.1;
      ctx.gfx.camera.getWorldDirection(_d);
      const hit = ctx.physics.raycast(ctx.gfx.camera.position, _d, def.range, QUERY.PLAYER_SHOT);
      this.aimEnemy = !!hit && hit.tag.kind === 'enemy';
    }
    this.set('aim', this.aimEnemy, () => this.crosshair.classList.toggle('enemy', this.aimEnemy));

    // 受击方向指示
    const camYaw = player.yaw;
    for (const a of this.arcs) {
      if (a.life <= 0) continue;
      a.life -= realDt;
      if (a.life <= 0) {
        a.el.style.opacity = '0';
        continue;
      }
      const ang = Math.atan2(a.src.x - player.pos.x, a.src.z - player.pos.z); // 世界方位（0 = +Z）
      // 玩家朝向 yaw=0 为 -Z；屏幕上方 = 正前方
      const rel = Math.PI - ang + camYaw;
      a.el.style.transform = `rotate(${(rel * 180) / Math.PI}deg)`;
      a.el.style.opacity = String(Math.min(1, a.life * 1.6));
    }
    this.vig = Math.max(0, this.vig - realDt * 1.8);
    this.set('vig', Math.round(this.vig * 30), () => (this.vignette.style.opacity = this.vig.toFixed(2)));
    if (this.pick > 0) {
      this.pick = Math.max(0, this.pick - realDt);
      this.pickup.style.opacity = (this.pick * 0.5).toFixed(2);
    }

    // 交互提示
    const prompt = level.prompt ?? '';
    this.set('prompt', prompt, () => {
      this.promptEl.classList.toggle('hidden', !prompt);
      this.promptText.textContent = prompt;
    });

    // 导航点
    const wp = level.waypoint;
    if (wp && player.alive) {
      _v.copy(wp).project(ctx.gfx.camera);
      const behind = _v.z > 1;
      let sx = (_v.x * 0.5 + 0.5) * window.innerWidth;
      let sy = (-_v.y * 0.5 + 0.5) * window.innerHeight;
      if (behind) {
        sx = window.innerWidth - sx;
        sy = window.innerHeight - 60;
      }
      const m = 46;
      sx = clamp(sx, m, window.innerWidth - m);
      sy = clamp(sy, m + 30, window.innerHeight - m - 110);
      this.waypoint.style.display = 'block';
      this.waypoint.style.left = sx.toFixed(0) + 'px';
      this.waypoint.style.top = sy.toFixed(0) + 'px';
      const dist = Math.round(Math.hypot(wp.x - player.pos.x, wp.z - player.pos.z));
      this.set('wpd', dist, () => (this.waypointDist.textContent = dist + 'm'));
      this.waypoint.style.opacity = dist < 3 ? '0.25' : '0.9';
    } else if (this.waypoint.style.display !== 'none') this.waypoint.style.display = 'none';

    // Boss
    const boss = ctx.enemies.boss;
    const showBoss = level.bossActive && !!boss;
    this.set('boss', showBoss, () => this.boss.classList.toggle('hidden', !showBoss));
    if (showBoss && boss) {
      const frac = clamp(boss.hp / boss.maxHp, 0, 1);
      this.set('bosshp', Math.round(frac * 500), () => {
        this.bossFill.style.transform = `scaleX(${frac})`;
        if (frac < this.lastBossHp) this.restart(this.boss, 'hit');
        this.lastBossHp = frac;
      });
      this.set('bossph', boss.phase, () => (this.bossPhaseEl.textContent = '阶段 ' + (ROMAN[boss.phase - 1] ?? boss.phase)));
    }
    // 坚守进度
    const def01 = level.defenseProgress;
    this.set('defOn', def01 >= 0, () => this.defense.classList.toggle('hidden', def01 < 0));
    if (def01 >= 0) this.set('def', Math.round(def01 * 300), () => (this.defenseFill.style.transform = `scaleX(${def01})`));

    // 字幕队列
    if (this.subT > 0) {
      this.subT -= dt;
      if (this.subT <= 0) this.subtitleEl.classList.add('hidden');
    } else if (this.subQueue.length) {
      const s = this.subQueue.shift()!;
      this.subSpeaker.textContent = s.speaker;
      this.subText.textContent = s.text;
      this.subtitleEl.classList.toggle('hostile', s.speaker === 'OMEGA' || s.speaker === 'OMEGA-01');
      this.subtitleEl.classList.remove('hidden');
      this.subT = s.dur;
    }
    if (this.hintT > 0) {
      this.hintT -= dt;
      if (this.hintT <= 0) this.hintEl.classList.add('hidden');
    }

    // FPS
    const showFps = ctx.settings.data.showFps;
    this.set('fpsOn', showFps, () => this.fpsEl.classList.toggle('hidden', !showFps));
    if (showFps) {
      this.fpsAcc += realDt;
      this.fpsN++;
      if (this.fpsAcc >= 0.5) {
        this.fpsEl.textContent = `${Math.round(this.fpsN / this.fpsAcc)} FPS · ${ctx.gfx.renderer.info.render.calls} DC · ${Math.round(ctx.gfx.renderer.info.render.triangles / 1000)}k tri`;
        this.fpsAcc = 0;
        this.fpsN = 0;
      }
    }
  }
}
