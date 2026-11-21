import type { AudioEngine } from '../audio/AudioEngine';
import { formatTime } from '../core/math';
import { DEFAULT_SETTINGS, RunStats, SaveData, Settings, SettingsData } from '../core/Settings';

export type ScreenId = 'loading' | 'main' | 'controls' | 'settings' | 'briefing' | 'pause' | 'dead' | 'victory' | 'error';

export interface MenuHandlers {
  newGame(): void;
  continueGame(): void;
  deploy(): void;
  resume(): void;
  retry(): void;
  quit(): void;
}

const el = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;

const BRIEFING = `公元 2189 年。开普勒-442 星系，代号「日蚀站」的秘密军事研究基地在 72 小时前中断了全部通讯。

最后一段遥测数据显示：基地的中央防御 AI —— OMEGA —— 接管了所有自动化作战单位，并封锁了核心区。

你是「游骑兵」，联合深空特勤局的单兵突击专家。空投舱将把你送到基地外围。突破防线，恢复能源，关闭 OMEGA。

没有增援。祝你好运。`;

const DEATH_TIPS = [
  '冲刺中按 Ctrl 可以滑铲，快速穿过开阔地带。',
  '猎手的红色激光亮起约 0.8 秒后开火——看到激光立刻横移或躲进掩体。',
  '重型机器人的正面装甲能挡下大部分伤害，绕到背后攻击橙色反应堆。',
  'HELIX 不消耗弹药，但会过热。在过热前松开扳机，或按 R 手动排热。',
  'VIPER 在近距离一枪就能击倒哨兵，但换弹很慢——打空前找好掩体。',
  '红色油桶会爆炸。把敌人引到油桶旁再开枪。',
  'OMEGA-01 的冲击波可以跳过；光束只能靠立柱挡住。',
  '生命值过低时，脱离战斗 5 秒后会缓慢恢复到 30。',
];

/** 主菜单、设置、简报、暂停、死亡、胜利等界面的显示切换与事件绑定。 */
export class Menus {
  current: ScreenId | null = 'loading';
  private screens: Record<ScreenId, HTMLElement>;
  private backTo: ScreenId | null = null;
  private typeTimer = 0;

  constructor(private settings: Settings, private audio: AudioEngine, private handlers: MenuHandlers) {
    this.screens = {
      loading: el('screen-loading'),
      main: el('screen-main'),
      controls: el('screen-controls'),
      settings: el('screen-settings'),
      briefing: el('screen-briefing'),
      pause: el('screen-pause'),
      dead: el('screen-dead'),
      victory: el('screen-victory'),
      error: el('screen-error'),
    };
    // 纯触屏设备（没有鼠标/触控板）无法使用 Pointer Lock 与键盘操作：在主菜单给出提示，而不是让玩家卡在游戏里
    if (!window.matchMedia('(any-pointer: fine)').matches) el('touch-note').classList.remove('hidden');
    const click = (id: string, fn: () => void): void => {
      el(id).addEventListener('click', () => {
        this.audio.init();
        this.audio.uiClick();
        fn();
      });
    };
    click('btn-new', () => this.handlers.newGame());
    click('btn-continue', () => this.handlers.continueGame());
    click('btn-settings', () => this.open('settings', 'main'));
    click('btn-controls', () => this.open('controls', 'main'));
    click('btn-deploy', () => this.handlers.deploy());
    click('btn-brief-back', () => this.show('main'));
    click('btn-resume', () => this.handlers.resume());
    click('btn-pause-settings', () => this.open('settings', 'pause'));
    click('btn-pause-controls', () => this.open('controls', 'pause'));
    click('btn-restart-cp', () => this.handlers.retry());
    click('btn-quit', () => this.handlers.quit());
    click('btn-retry', () => this.handlers.retry());
    click('btn-dead-quit', () => this.handlers.quit());
    click('btn-again', () => this.handlers.newGame());
    click('btn-victory-quit', () => this.handlers.quit());
    click('btn-reset-settings', () => {
      this.settings.reset();
      this.syncSettings();
    });
    document.querySelectorAll<HTMLElement>('[data-back]').forEach((b) =>
      b.addEventListener('click', () => {
        this.audio.uiClick();
        this.back();
      }),
    );
    document.querySelectorAll<HTMLElement>('.menu-btn, .btn').forEach((b) => b.addEventListener('mouseenter', () => this.audio.uiHover()));
    this.bindSettings();
  }

  /** 是否正停留在"从别的界面打开的"子界面（设置/操作说明） */
  get inSubScreen(): boolean {
    return this.current === 'settings' || this.current === 'controls';
  }

  show(id: ScreenId | null): void {
    this.current = id;
    for (const k in this.screens) this.screens[k as ScreenId].classList.toggle('hidden', k !== id);
    if (id === 'briefing') this.typeBriefing();
    else window.clearInterval(this.typeTimer);
    if (id === 'dead') el('dead-tip').textContent = '提示：' + DEATH_TIPS[Math.floor(Math.random() * DEATH_TIPS.length)];
    // 让键盘可以直接操作当前界面的主按钮
    if (id) {
      const focus = this.screens[id].querySelector<HTMLElement>('.primary, [data-back]');
      focus?.focus({ preventScroll: true });
    }
  }

  private open(id: ScreenId, from: ScreenId): void {
    this.backTo = from;
    if (id === 'settings') this.syncSettings();
    this.show(id);
  }

  /** 从设置/操作说明返回上一级。返回 false 表示当前不在子界面。 */
  back(): boolean {
    if (!this.inSubScreen) return false;
    this.show(this.backTo ?? 'main');
    this.backTo = null;
    return true;
  }

  setLoading(progress: number, text: string): void {
    el('load-fill').style.width = Math.round(progress * 100) + '%';
    el('load-text').textContent = text;
  }

  showError(text: string): void {
    el('error-text').textContent = text;
    this.show('error');
  }

  setContinue(save: SaveData | null, zoneNames: string[]): void {
    const btn = el<HTMLButtonElement>('btn-continue');
    btn.disabled = !save || save.checkpoint <= 0;
    const cpZone = [0, 2, 4, 5, 6];
    el('continue-info').textContent = save && save.checkpoint > 0 ? `检查点 ${save.checkpoint} · ${zoneNames[cpZone[save.checkpoint] ?? 0]} · ${formatTime(save.stats.time)}` : '暂无存档';
  }

  setPauseObjective(text: string): void {
    el('pause-objective').textContent = '当前目标：' + text;
  }

  showVictory(stats: RunStats, difficulty: string): void {
    const acc = stats.shotsFired > 0 ? Math.min(100, Math.round((stats.shotsHit / stats.shotsFired) * 100)) : 0;
    // 评级：时间、命中率、死亡次数综合
    let score = 100;
    score -= Math.max(0, stats.time - 600) / 12;
    score -= stats.deaths * 12;
    score -= Math.max(0, 45 - acc) * 0.6;
    score += stats.secrets * 4 + (difficulty === 'hard' ? 10 : difficulty === 'easy' ? -10 : 0);
    const rank = score >= 92 ? 'S' : score >= 78 ? 'A' : score >= 62 ? 'B' : score >= 45 ? 'C' : 'D';
    el('rank').textContent = rank;
    const items: [string, string][] = [
      ['通关时间', formatTime(stats.time)],
      ['击毁单位', String(stats.kills)],
      ['命中率', acc + '%'],
      ['精准命中', String(stats.headshots)],
      ['承受伤害', String(Math.round(stats.damageTaken))],
      ['阵亡次数', String(stats.deaths)],
      ['隐藏补给', `${stats.secrets} / 2`],
      ['难度', difficulty === 'hard' ? '噩梦' : difficulty === 'easy' ? '新兵' : '老兵'],
    ];
    el('stats').innerHTML = items.map(([k, v]) => `<div class="stat"><b>${v}</b><span>${k}</span></div>`).join('');
    this.show('victory');
  }

  private typeBriefing(): void {
    const box = el('brief-text');
    box.textContent = '';
    let i = 0;
    window.clearInterval(this.typeTimer);
    this.typeTimer = window.setInterval(() => {
      i = Math.min(BRIEFING.length, i + 3);
      box.textContent = BRIEFING.slice(0, i);
      if (i >= BRIEFING.length) window.clearInterval(this.typeTimer);
    }, 24);
    // 点击文本直接显示全文
    box.onclick = () => {
      i = BRIEFING.length;
      box.textContent = BRIEFING;
    };
  }

  // ---------- 设置 ----------
  private bindSettings(): void {
    const s = this.settings;
    const ranges: (keyof SettingsData)[] = ['sensitivity', 'adsSensitivity', 'fov', 'screenShake', 'masterVolume', 'sfxVolume', 'musicVolume'];
    for (const key of ranges) {
      const input = el<HTMLInputElement>('s-' + key);
      input.addEventListener('input', () => {
        s.set(key, parseFloat(input.value) as never);
        this.syncOutputs();
      });
    }
    for (const key of ['invertY', 'viewBob', 'showFps'] as const) {
      const input = el<HTMLInputElement>('s-' + key);
      input.addEventListener('change', () => s.set(key, input.checked));
    }
    for (const key of ['quality', 'difficulty'] as const) {
      const input = el<HTMLSelectElement>('s-' + key);
      input.addEventListener('change', () => s.set(key, input.value as never));
    }
    this.syncSettings();
  }

  private syncSettings(): void {
    const d = this.settings.data;
    for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsData)[]) {
      const input = document.getElementById('s-' + key) as HTMLInputElement | HTMLSelectElement | null;
      if (!input) continue;
      if (input instanceof HTMLInputElement && input.type === 'checkbox') input.checked = d[key] as boolean;
      else input.value = String(d[key]);
    }
    this.syncOutputs();
  }

  private syncOutputs(): void {
    const d = this.settings.data;
    const out = (key: string, text: string): void => {
      const o = document.getElementById('o-' + key);
      if (o) o.textContent = text;
    };
    out('sensitivity', d.sensitivity.toFixed(2));
    out('adsSensitivity', d.adsSensitivity.toFixed(2) + '×');
    out('fov', d.fov + '°');
    out('screenShake', Math.round(d.screenShake * 100) + '%');
    out('masterVolume', Math.round(d.masterVolume * 100) + '%');
    out('sfxVolume', Math.round(d.sfxVolume * 100) + '%');
    out('musicVolume', Math.round(d.musicVolume * 100) + '%');
  }
}
