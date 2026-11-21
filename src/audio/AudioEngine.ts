import * as THREE from 'three';
import { clamp, rand } from '../core/math';

/**
 * 全程序化音频：所有音效由振荡器、滤波噪声和包络实时合成，不加载任何外部文件。
 * 信号链：声音 → (可选 3D Panner) → sfx/music 总线 → 压缩器 → 输出；另有卷积混响送出。
 */
interface ToneOpts {
  type?: OscillatorType;
  freq: number;
  freqEnd?: number;
  dur: number;
  gain: number;
  attack?: number;
  delay?: number;
  detune?: number;
  curve?: 'exp' | 'lin';
}
interface NoiseOpts {
  dur: number;
  gain: number;
  filter?: BiquadFilterType;
  freq?: number;
  freqEnd?: number;
  q?: number;
  attack?: number;
  delay?: number;
  rate?: number;
}

export type MusicMode = 'none' | 'menu' | 'explore' | 'combat' | 'boss' | 'victory';

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private music!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private volumes = { master: 0.8, sfx: 0.9, music: 0.6 };
  private listenerPos = new THREE.Vector3();
  private ambient: { gain: GainNode; nodes: AudioNode[] } | null = null;
  private alarm: { gain: GainNode; osc: OscillatorNode; lfo: OscillatorNode } | null = null;
  private alarmLevel = 0;
  private heat: { gain: GainNode; osc: OscillatorNode } | null = null;
  // 音乐
  private musicMode: MusicMode = 'none';
  private nextNoteTime = 0;
  private step = 0;
  private musicLayer!: GainNode;
  private pad: { gain: GainNode; oscs: OscillatorNode[]; filter: BiquadFilterNode } | null = null;
  private lastPlay = new Map<string, number>();
  muted = false;

  /** 必须在用户手势之后调用 */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch {
      this.ctx = null;
      return;
    }
    const ctx = this.ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 5;
    comp.attack.value = 0.003;
    comp.release.value = 0.18;
    this.master = ctx.createGain();
    this.master.connect(comp);
    comp.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.music = ctx.createGain();
    this.music.connect(this.master);
    this.musicLayer = ctx.createGain();
    this.musicLayer.connect(this.music);

    // 噪声缓冲
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // 程序化混响脉冲：指数衰减噪声（金属大空间感）
    const rl = Math.floor(ctx.sampleRate * 1.9);
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = ir.getChannelData(ch);
      for (let i = 0; i < rl; i++) {
        const t = i / rl;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) * (i < 400 ? i / 400 : 1);
      }
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.22;
    this.reverbSend.connect(this.reverb);
    this.reverb.connect(this.sfx);
    this.applyVolumes();
  }

  get ready(): boolean {
    return !!this.ctx;
  }

  setVolumes(master: number, sfx: number, music: number): void {
    this.volumes = { master, sfx, music };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volumes.master, t, 0.03);
    this.sfx.gain.setTargetAtTime(this.volumes.sfx, t, 0.03);
    this.music.gain.setTargetAtTime(this.volumes.music * 0.8, t, 0.03);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }
  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }

  setListener(pos: THREE.Vector3, forward: THREE.Vector3): void {
    this.listenerPos.copy(pos);
    if (!this.ctx) return;
    const l = this.ctx.listener;
    if (l.positionX) {
      l.positionX.value = pos.x;
      l.positionY.value = pos.y;
      l.positionZ.value = pos.z;
      l.forwardX.value = forward.x;
      l.forwardY.value = forward.y;
      l.forwardZ.value = forward.z;
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      (l as unknown as { setPosition(x: number, y: number, z: number): void }).setPosition(pos.x, pos.y, pos.z);
      (l as unknown as { setOrientation(...a: number[]): void }).setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  // ---------- 合成基础 ----------
  /** 创建一个声音的输出节点（可选 3D 定位 + 混响） */
  private out(pos?: THREE.Vector3 | null, reverb = 0.25, maxDist = 60): AudioNode | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const g = ctx.createGain();
    if (pos) {
      if (pos.distanceToSquared(this.listenerPos) > maxDist * maxDist) return null;
      const p = ctx.createPanner();
      p.panningModel = 'equalpower';
      p.distanceModel = 'inverse';
      p.refDistance = 4;
      p.maxDistance = maxDist;
      p.rolloffFactor = 1.1;
      p.positionX.value = pos.x;
      p.positionY.value = pos.y;
      p.positionZ.value = pos.z;
      g.connect(p);
      p.connect(this.sfx);
      if (reverb > 0) {
        const s = ctx.createGain();
        s.gain.value = reverb;
        p.connect(s);
        s.connect(this.reverbSend);
      }
    } else {
      g.connect(this.sfx);
      if (reverb > 0) {
        const s = ctx.createGain();
        s.gain.value = reverb;
        g.connect(s);
        s.connect(this.reverbSend);
      }
    }
    return g;
  }

  private tone(dest: AudioNode, o: ToneOpts): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(1, o.freq), t0);
    if (o.freqEnd !== undefined) {
      if (o.curve === 'lin') osc.frequency.linearRampToValueAtTime(Math.max(1, o.freqEnd), t0 + o.dur);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqEnd), t0 + o.dur);
    }
    if (o.detune) osc.detune.value = o.detune;
    const g = ctx.createGain();
    const a = o.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g);
    g.connect(dest);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.03);
  }

  private noise(dest: AudioNode, o: NoiseOpts): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.playbackRate.value = o.rate ?? 1;
    const f = ctx.createBiquadFilter();
    f.type = o.filter ?? 'lowpass';
    f.frequency.setValueAtTime(o.freq ?? 2000, t0);
    if (o.freqEnd !== undefined) f.frequency.exponentialRampToValueAtTime(Math.max(20, o.freqEnd), t0 + o.dur);
    f.Q.value = o.q ?? 0.7;
    const g = ctx.createGain();
    const a = o.attack ?? 0.001;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(f);
    f.connect(g);
    g.connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + o.dur + 0.03);
  }

  /** 限制同名音效的触发频率，避免瞬间叠加爆音 */
  private throttle(key: string, minGap: number): boolean {
    const now = performance.now();
    const last = this.lastPlay.get(key) ?? 0;
    if (now - last < minGap * 1000) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  // ---------- 武器 ----------
  fireRifle(): void {
    const d = this.out(null, 0.3);
    if (!d) return;
    const p = rand(0.95, 1.05);
    this.noise(d, { dur: 0.16, gain: 0.85, filter: 'bandpass', freq: 1900 * p, freqEnd: 500, q: 0.6 });
    this.noise(d, { dur: 0.05, gain: 0.7, filter: 'highpass', freq: 3800 });
    this.tone(d, { type: 'square', freq: 210 * p, freqEnd: 60, dur: 0.11, gain: 0.5 });
    this.tone(d, { type: 'sine', freq: 120, freqEnd: 42, dur: 0.16, gain: 0.75 });
    this.noise(d, { dur: 0.45, gain: 0.12, filter: 'lowpass', freq: 900, freqEnd: 200, delay: 0.04 });
  }

  fireShotgun(): void {
    const d = this.out(null, 0.45);
    if (!d) return;
    this.noise(d, { dur: 0.38, gain: 1.25, filter: 'lowpass', freq: 3200, freqEnd: 260, q: 0.4 });
    this.noise(d, { dur: 0.08, gain: 0.9, filter: 'highpass', freq: 2600 });
    this.tone(d, { type: 'sine', freq: 150, freqEnd: 32, dur: 0.34, gain: 1.25 });
    this.tone(d, { type: 'sawtooth', freq: 95, freqEnd: 40, dur: 0.2, gain: 0.5 });
    this.noise(d, { dur: 0.9, gain: 0.2, filter: 'lowpass', freq: 700, freqEnd: 120, delay: 0.06 });
  }

  shotgunPump(): void {
    const d = this.out(null, 0.15);
    if (!d) return;
    this.noise(d, { dur: 0.07, gain: 0.4, filter: 'bandpass', freq: 1500, q: 2.2 });
    this.tone(d, { type: 'square', freq: 320, freqEnd: 180, dur: 0.05, gain: 0.13 });
    this.noise(d, { dur: 0.08, gain: 0.45, filter: 'bandpass', freq: 2100, q: 2.2, delay: 0.14 });
    this.tone(d, { type: 'square', freq: 240, freqEnd: 420, dur: 0.05, gain: 0.13, delay: 0.14 });
  }

  fireHelix(heat: number): void {
    const d = this.out(null, 0.35);
    if (!d) return;
    const p = 1 + heat * 0.35;
    this.tone(d, { type: 'sawtooth', freq: 1500 * p, freqEnd: 190, dur: 0.2, gain: 0.34 });
    this.tone(d, { type: 'square', freq: 760 * p, freqEnd: 110, dur: 0.24, gain: 0.26, detune: 14 });
    this.tone(d, { type: 'sine', freq: 95, freqEnd: 48, dur: 0.2, gain: 0.7 });
    this.noise(d, { dur: 0.2, gain: 0.4, filter: 'bandpass', freq: 5200, freqEnd: 900, q: 1.4 });
  }

  helixOverheat(): void {
    const d = this.out(null, 0.3);
    if (!d) return;
    this.noise(d, { dur: 1.6, gain: 0.55, filter: 'highpass', freq: 2400, freqEnd: 6000, attack: 0.03 });
    this.tone(d, { type: 'square', freq: 880, dur: 0.09, gain: 0.25 });
    this.tone(d, { type: 'square', freq: 880, dur: 0.09, gain: 0.25, delay: 0.16 });
    this.tone(d, { type: 'square', freq: 660, dur: 0.14, gain: 0.25, delay: 0.32 });
  }

  helixVentDone(): void {
    const d = this.out(null, 0.2);
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 420, freqEnd: 980, dur: 0.16, gain: 0.25 });
    this.noise(d, { dur: 0.06, gain: 0.3, filter: 'bandpass', freq: 2400, q: 3, delay: 0.1 });
  }

  dryFire(): void {
    if (!this.throttle('dry', 0.12)) return;
    const d = this.out(null, 0.05);
    if (!d) return;
    this.noise(d, { dur: 0.03, gain: 0.35, filter: 'bandpass', freq: 3200, q: 4 });
    this.tone(d, { type: 'square', freq: 1400, freqEnd: 700, dur: 0.025, gain: 0.1 });
  }

  /** 换弹的分段声音：magOut / magIn / bolt / shell */
  reload(part: 'magOut' | 'magIn' | 'bolt' | 'shell' | 'cell'): void {
    const d = this.out(null, 0.12);
    if (!d) return;
    switch (part) {
      case 'magOut':
        this.noise(d, { dur: 0.06, gain: 0.4, filter: 'bandpass', freq: 2600, q: 3 });
        this.tone(d, { type: 'triangle', freq: 500, freqEnd: 260, dur: 0.07, gain: 0.16 });
        this.noise(d, { dur: 0.12, gain: 0.14, filter: 'lowpass', freq: 800, delay: 0.05 });
        break;
      case 'magIn':
        this.noise(d, { dur: 0.05, gain: 0.5, filter: 'bandpass', freq: 1800, q: 2.5 });
        this.tone(d, { type: 'square', freq: 240, freqEnd: 150, dur: 0.07, gain: 0.2 });
        this.noise(d, { dur: 0.04, gain: 0.4, filter: 'highpass', freq: 3600, delay: 0.06 });
        break;
      case 'bolt':
        this.noise(d, { dur: 0.05, gain: 0.5, filter: 'bandpass', freq: 3000, q: 2 });
        this.noise(d, { dur: 0.06, gain: 0.6, filter: 'bandpass', freq: 2100, q: 2, delay: 0.09 });
        this.tone(d, { type: 'square', freq: 190, freqEnd: 110, dur: 0.06, gain: 0.2, delay: 0.09 });
        break;
      case 'shell':
        this.noise(d, { dur: 0.05, gain: 0.4, filter: 'bandpass', freq: 1300, q: 3 });
        this.tone(d, { type: 'triangle', freq: 300, freqEnd: 460, dur: 0.06, gain: 0.2 });
        break;
      case 'cell':
        this.tone(d, { type: 'sine', freq: 300, freqEnd: 900, dur: 0.25, gain: 0.2 });
        this.noise(d, { dur: 0.2, gain: 0.2, filter: 'highpass', freq: 5000 });
        break;
    }
  }

  weaponSwitch(): void {
    const d = this.out(null, 0.1);
    if (!d) return;
    this.noise(d, { dur: 0.1, gain: 0.25, filter: 'bandpass', freq: 900, freqEnd: 2400, q: 1.2 });
    this.noise(d, { dur: 0.04, gain: 0.35, filter: 'bandpass', freq: 2800, q: 3, delay: 0.16 });
  }

  adsIn(): void {
    const d = this.out(null, 0);
    if (!d) return;
    this.noise(d, { dur: 0.09, gain: 0.08, filter: 'bandpass', freq: 1200, freqEnd: 2600, q: 1 });
  }

  // ---------- 命中反馈 ----------
  hitMarker(headshot: boolean): void {
    if (!this.throttle('hit', 0.035)) return;
    const d = this.out(null, 0);
    if (!d) return;
    if (headshot) {
      this.tone(d, { type: 'triangle', freq: 2100, freqEnd: 2600, dur: 0.07, gain: 0.3 });
      this.tone(d, { type: 'sine', freq: 3150, dur: 0.1, gain: 0.16 });
    } else {
      this.tone(d, { type: 'triangle', freq: 1250, freqEnd: 900, dur: 0.045, gain: 0.26 });
    }
    this.noise(d, { dur: 0.025, gain: 0.16, filter: 'highpass', freq: 4000 });
  }

  killConfirm(): void {
    const d = this.out(null, 0.1);
    if (!d) return;
    this.tone(d, { type: 'triangle', freq: 880, dur: 0.08, gain: 0.26 });
    this.tone(d, { type: 'triangle', freq: 1320, dur: 0.14, gain: 0.26, delay: 0.07 });
  }

  impact(pos: THREE.Vector3, kind: 'metal' | 'energy' | 'flesh'): void {
    if (!this.throttle('imp' + kind, 0.04)) return;
    const d = this.out(pos, 0.2, 45);
    if (!d) return;
    if (kind === 'metal') {
      this.noise(d, { dur: 0.05, gain: 0.5, filter: 'bandpass', freq: rand(2400, 5200), q: 5 });
      this.tone(d, { type: 'triangle', freq: rand(1800, 3600), freqEnd: 900, dur: 0.09, gain: 0.14 });
    } else if (kind === 'energy') {
      this.noise(d, { dur: 0.16, gain: 0.5, filter: 'bandpass', freq: 3000, freqEnd: 500, q: 1.2 });
      this.tone(d, { type: 'sine', freq: 520, freqEnd: 90, dur: 0.16, gain: 0.34 });
    } else {
      this.noise(d, { dur: 0.06, gain: 0.55, filter: 'bandpass', freq: 1500, q: 2 });
      this.tone(d, { type: 'square', freq: 330, freqEnd: 140, dur: 0.06, gain: 0.2 });
    }
  }

  // ---------- 玩家 ----------
  footstep(surface: 'metal' | 'dirt', sprint: boolean): void {
    const d = this.out(null, 0.18);
    if (!d) return;
    const g = sprint ? 0.34 : 0.24;
    if (surface === 'metal') {
      this.noise(d, { dur: 0.07, gain: g, filter: 'bandpass', freq: rand(650, 900), q: 1.6 });
      this.tone(d, { type: 'triangle', freq: rand(170, 215), freqEnd: 90, dur: 0.09, gain: g * 0.9 });
      this.tone(d, { type: 'sine', freq: rand(1500, 2100), dur: 0.05, gain: g * 0.12 });
    } else {
      this.noise(d, { dur: 0.1, gain: g * 1.2, filter: 'lowpass', freq: rand(700, 1000), q: 0.6 });
      this.noise(d, { dur: 0.05, gain: g * 0.4, filter: 'highpass', freq: 3000, delay: 0.02 });
    }
  }

  jump(): void {
    const d = this.out(null, 0.1);
    if (!d) return;
    this.noise(d, { dur: 0.1, gain: 0.2, filter: 'bandpass', freq: 500, freqEnd: 1100, q: 0.8 });
  }

  land(strength: number): void {
    const d = this.out(null, 0.2);
    if (!d) return;
    const g = clamp(0.25 + strength * 0.5, 0.2, 0.9);
    this.noise(d, { dur: 0.14, gain: g, filter: 'lowpass', freq: 700, freqEnd: 180 });
    this.tone(d, { type: 'sine', freq: 110, freqEnd: 45, dur: 0.16, gain: g });
    this.tone(d, { type: 'triangle', freq: 260, freqEnd: 120, dur: 0.08, gain: g * 0.4 });
  }

  slide(): void {
    const d = this.out(null, 0.15);
    if (!d) return;
    this.noise(d, { dur: 0.6, gain: 0.3, filter: 'bandpass', freq: 1600, freqEnd: 500, q: 0.8, attack: 0.04 });
  }

  playerHurt(armor: boolean): void {
    if (!this.throttle('hurt', 0.08)) return;
    const d = this.out(null, 0.1);
    if (!d) return;
    if (armor) {
      this.tone(d, { type: 'square', freq: 1500, freqEnd: 500, dur: 0.11, gain: 0.2 });
      this.noise(d, { dur: 0.09, gain: 0.4, filter: 'bandpass', freq: 2800, q: 1.4 });
    } else {
      this.tone(d, { type: 'sine', freq: 190, freqEnd: 65, dur: 0.2, gain: 0.7 });
      this.noise(d, { dur: 0.12, gain: 0.45, filter: 'lowpass', freq: 1100 });
    }
  }

  heartbeat(): void {
    const d = this.out(null, 0);
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 62, freqEnd: 40, dur: 0.13, gain: 0.6 });
    this.tone(d, { type: 'sine', freq: 56, freqEnd: 38, dur: 0.13, gain: 0.42, delay: 0.19 });
  }

  playerDeath(): void {
    const d = this.out(null, 0.5);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', freq: 300, freqEnd: 34, dur: 1.5, gain: 0.5 });
    this.noise(d, { dur: 1.3, gain: 0.5, filter: 'lowpass', freq: 2400, freqEnd: 80 });
  }

  // ---------- 交互 / UI ----------
  pickup(kind: 'ammo' | 'health' | 'armor' | 'weapon' | 'key'): void {
    const d = this.out(null, 0.12);
    if (!d) return;
    if (kind === 'ammo') {
      this.noise(d, { dur: 0.05, gain: 0.35, filter: 'bandpass', freq: 2200, q: 3 });
      this.tone(d, { type: 'triangle', freq: 620, freqEnd: 900, dur: 0.08, gain: 0.2, delay: 0.03 });
    } else if (kind === 'health') {
      this.tone(d, { type: 'sine', freq: 520, dur: 0.12, gain: 0.26 });
      this.tone(d, { type: 'sine', freq: 780, dur: 0.2, gain: 0.26, delay: 0.09 });
    } else if (kind === 'armor') {
      this.tone(d, { type: 'triangle', freq: 330, freqEnd: 660, dur: 0.2, gain: 0.26 });
      this.noise(d, { dur: 0.16, gain: 0.16, filter: 'highpass', freq: 4500 });
    } else if (kind === 'weapon') {
      this.noise(d, { dur: 0.07, gain: 0.45, filter: 'bandpass', freq: 1800, q: 2 });
      this.tone(d, { type: 'square', freq: 220, freqEnd: 440, dur: 0.14, gain: 0.16, delay: 0.05 });
      this.tone(d, { type: 'triangle', freq: 880, dur: 0.2, gain: 0.2, delay: 0.16 });
    } else {
      this.tone(d, { type: 'sine', freq: 990, dur: 0.1, gain: 0.26 });
      this.tone(d, { type: 'sine', freq: 1320, dur: 0.1, gain: 0.26, delay: 0.1 });
      this.tone(d, { type: 'sine', freq: 1980, dur: 0.26, gain: 0.26, delay: 0.2 });
    }
  }

  uiHover(): void {
    if (!this.throttle('hover', 0.05)) return;
    const d = this.out(null, 0);
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 1500, dur: 0.035, gain: 0.07 });
  }

  uiClick(): void {
    const d = this.out(null, 0.05);
    if (!d) return;
    this.tone(d, { type: 'triangle', freq: 700, freqEnd: 1250, dur: 0.07, gain: 0.2 });
    this.noise(d, { dur: 0.03, gain: 0.12, filter: 'highpass', freq: 5000 });
  }

  terminal(ok: boolean): void {
    const d = this.out(null, 0.15);
    if (!d) return;
    if (ok) {
      for (let i = 0; i < 4; i++) this.tone(d, { type: 'square', freq: 660 + i * 220, dur: 0.07, gain: 0.14, delay: i * 0.075 });
    } else {
      this.tone(d, { type: 'square', freq: 220, dur: 0.14, gain: 0.2 });
      this.tone(d, { type: 'square', freq: 165, dur: 0.22, gain: 0.2, delay: 0.16 });
    }
  }

  objective(): void {
    const d = this.out(null, 0.3);
    if (!d) return;
    const notes = [523, 659, 784, 1046];
    notes.forEach((f, i) => this.tone(d, { type: 'triangle', freq: f, dur: 0.3, gain: 0.2, delay: i * 0.09 }));
  }

  checkpoint(): void {
    const d = this.out(null, 0.25);
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 660, dur: 0.16, gain: 0.2 });
    this.tone(d, { type: 'sine', freq: 990, dur: 0.3, gain: 0.2, delay: 0.12 });
  }

  door(pos: THREE.Vector3, open: boolean): void {
    const d = this.out(pos, 0.4, 50);
    if (!d) return;
    this.noise(d, { dur: 0.9, gain: 0.5, filter: 'bandpass', freq: open ? 300 : 700, freqEnd: open ? 900 : 240, q: 1.2, attack: 0.05 });
    this.tone(d, { type: 'sawtooth', freq: open ? 70 : 110, freqEnd: open ? 120 : 60, dur: 0.85, gain: 0.3, attack: 0.05 });
    this.noise(d, { dur: 0.1, gain: 0.7, filter: 'lowpass', freq: 500, delay: 0.85 });
    this.tone(d, { type: 'sine', freq: 80, freqEnd: 40, dur: 0.2, gain: 0.6, delay: 0.85 });
  }

  doorDenied(pos: THREE.Vector3): void {
    if (!this.throttle('denied', 0.5)) return;
    const d = this.out(pos, 0.2, 30);
    if (!d) return;
    this.tone(d, { type: 'square', freq: 196, dur: 0.12, gain: 0.26 });
    this.tone(d, { type: 'square', freq: 147, dur: 0.2, gain: 0.26, delay: 0.14 });
  }

  // ---------- 敌人 ----------
  enemyAlert(pos: THREE.Vector3, pitch = 1): void {
    if (!this.throttle('alert', 0.15)) return;
    const d = this.out(pos, 0.3, 55);
    if (!d) return;
    this.tone(d, { type: 'square', freq: 520 * pitch, freqEnd: 1240 * pitch, dur: 0.12, gain: 0.3 });
    this.tone(d, { type: 'square', freq: 1240 * pitch, freqEnd: 880 * pitch, dur: 0.16, gain: 0.3, delay: 0.13 });
    this.tone(d, { type: 'sawtooth', freq: 180 * pitch, dur: 0.28, gain: 0.14 });
  }

  enemyShot(pos: THREE.Vector3, kind: 'bolt' | 'rifle' | 'mortar' | 'wasp'): void {
    if (!this.throttle('eshot' + kind, 0.05)) return;
    const d = this.out(pos, 0.35, 70);
    if (!d) return;
    if (kind === 'bolt') {
      this.tone(d, { type: 'sawtooth', freq: 980, freqEnd: 230, dur: 0.16, gain: 0.34 });
      this.noise(d, { dur: 0.1, gain: 0.3, filter: 'bandpass', freq: 3000, freqEnd: 800, q: 1 });
    } else if (kind === 'rifle') {
      this.tone(d, { type: 'square', freq: 2400, freqEnd: 300, dur: 0.22, gain: 0.34 });
      this.noise(d, { dur: 0.24, gain: 0.6, filter: 'bandpass', freq: 2200, freqEnd: 400, q: 0.7 });
      this.tone(d, { type: 'sine', freq: 130, freqEnd: 50, dur: 0.2, gain: 0.6 });
    } else if (kind === 'mortar') {
      this.tone(d, { type: 'sine', freq: 140, freqEnd: 50, dur: 0.3, gain: 0.9 });
      this.noise(d, { dur: 0.3, gain: 0.7, filter: 'lowpass', freq: 1200, freqEnd: 200 });
    } else {
      this.tone(d, { type: 'square', freq: 1700, freqEnd: 700, dur: 0.08, gain: 0.2 });
    }
  }

  enemyCharge(pos: THREE.Vector3, dur: number, pitch = 1): void {
    const d = this.out(pos, 0.3, 70);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', freq: 110 * pitch, freqEnd: 880 * pitch, dur, gain: 0.3, attack: dur * 0.6 });
    this.tone(d, { type: 'sine', freq: 220 * pitch, freqEnd: 1760 * pitch, dur, gain: 0.16, attack: dur * 0.7 });
  }

  enemyMelee(pos: THREE.Vector3): void {
    const d = this.out(pos, 0.2, 40);
    if (!d) return;
    this.noise(d, { dur: 0.2, gain: 0.7, filter: 'bandpass', freq: 3000, freqEnd: 600, q: 0.9 });
    this.tone(d, { type: 'sawtooth', freq: 90, freqEnd: 300, dur: 0.14, gain: 0.34 });
  }

  enemyHit(pos: THREE.Vector3): void {
    if (!this.throttle('ehit', 0.06)) return;
    const d = this.out(pos, 0.15, 45);
    if (!d) return;
    this.noise(d, { dur: 0.05, gain: 0.4, filter: 'bandpass', freq: rand(1800, 3000), q: 3.5 });
    this.tone(d, { type: 'square', freq: rand(380, 520), freqEnd: 200, dur: 0.06, gain: 0.14 });
  }

  enemyDeath(pos: THREE.Vector3, big: boolean): void {
    const d = this.out(pos, 0.5, 80);
    if (!d) return;
    this.noise(d, { dur: big ? 0.9 : 0.5, gain: big ? 1.1 : 0.8, filter: 'lowpass', freq: 2600, freqEnd: 140 });
    this.tone(d, { type: 'sine', freq: big ? 100 : 150, freqEnd: 30, dur: big ? 0.7 : 0.4, gain: 1 });
    this.tone(d, { type: 'square', freq: 1400, freqEnd: 90, dur: 0.34, gain: 0.2 });
    this.noise(d, { dur: 0.3, gain: 0.3, filter: 'bandpass', freq: 4200, q: 4, delay: 0.1 });
  }

  explosion(pos: THREE.Vector3, size = 1): void {
    const d = this.out(pos, 0.6, 110);
    if (!d) return;
    this.noise(d, { dur: 0.9 * size, gain: 1.4, filter: 'lowpass', freq: 3400, freqEnd: 90, q: 0.3 });
    this.tone(d, { type: 'sine', freq: 95, freqEnd: 24, dur: 0.8 * size, gain: 1.5 });
    this.noise(d, { dur: 0.1, gain: 0.9, filter: 'highpass', freq: 2000 });
    this.noise(d, { dur: 1.6 * size, gain: 0.3, filter: 'lowpass', freq: 500, freqEnd: 60, delay: 0.1 });
  }

  heavyStep(pos: THREE.Vector3, size = 1): void {
    const d = this.out(pos, 0.4, 60);
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 70 / size, freqEnd: 30, dur: 0.24, gain: 0.9 });
    this.noise(d, { dur: 0.16, gain: 0.5, filter: 'lowpass', freq: 500 });
    this.noise(d, { dur: 0.06, gain: 0.2, filter: 'bandpass', freq: 2400, q: 3, delay: 0.02 });
  }

  servo(pos: THREE.Vector3): void {
    if (!this.throttle('servo', 0.2)) return;
    const d = this.out(pos, 0.15, 30);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', freq: rand(260, 340), freqEnd: rand(420, 520), dur: 0.12, gain: 0.05 });
  }

  bossRoar(pos: THREE.Vector3): void {
    const d = this.out(pos, 0.7, 160);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', freq: 58, freqEnd: 120, dur: 1.5, gain: 0.8, attack: 0.3 });
    this.tone(d, { type: 'square', freq: 61, freqEnd: 30, dur: 1.9, gain: 0.5, attack: 0.2 });
    this.tone(d, { type: 'sawtooth', freq: 233, freqEnd: 110, dur: 1.4, gain: 0.3, attack: 0.4, detune: 30 });
    this.noise(d, { dur: 1.8, gain: 0.6, filter: 'bandpass', freq: 400, freqEnd: 1600, q: 0.8, attack: 0.4 });
  }

  bossSlam(pos: THREE.Vector3): void {
    const d = this.out(pos, 0.7, 160);
    if (!d) return;
    this.tone(d, { type: 'sine', freq: 80, freqEnd: 20, dur: 1.2, gain: 1.8 });
    this.noise(d, { dur: 1.1, gain: 1.4, filter: 'lowpass', freq: 1800, freqEnd: 70 });
    this.noise(d, { dur: 0.2, gain: 0.8, filter: 'bandpass', freq: 3000, q: 1 });
  }

  beamLoop(pos: THREE.Vector3, dur: number): void {
    const d = this.out(pos, 0.3, 120);
    if (!d) return;
    this.tone(d, { type: 'sawtooth', freq: 190, freqEnd: 240, dur, gain: 0.34, attack: 0.1, curve: 'lin' });
    this.tone(d, { type: 'square', freq: 1140, freqEnd: 1300, dur, gain: 0.1, attack: 0.1, curve: 'lin' });
    this.noise(d, { dur, gain: 0.34, filter: 'bandpass', freq: 3800, q: 2, attack: 0.1 });
  }

  // ---------- 循环氛围 ----------
  /** 环境机械底噪：kind 决定音色（exterior 风声 / base 机械嗡鸣 / industrial 低频轰鸣 / core 能量脉动） */
  setAmbient(kind: 'none' | 'exterior' | 'base' | 'industrial' | 'core'): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.ambient) {
      const old = this.ambient;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
      setTimeout(() => {
        for (const n of old.nodes) {
          try {
            (n as OscillatorNode).stop?.();
          } catch {
            /* 已停止 */
          }
          n.disconnect();
        }
        old.gain.disconnect();
      }, 2500);
      this.ambient = null;
    }
    if (kind === 'none') return;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.sfx);
    const nodes: AudioNode[] = [];
    const addNoise = (type: BiquadFilterType, freq: number, q: number, vol: number, lfoRate = 0, lfoDepth = 0) => {
      const src = ctx.createBufferSource();
      src.buffer = this.noiseBuf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(f);
      f.connect(g);
      g.connect(gain);
      src.start();
      nodes.push(src, f, g);
      if (lfoRate > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoRate;
        const lg = ctx.createGain();
        lg.gain.value = lfoDepth;
        lfo.connect(lg);
        lg.connect(f.frequency);
        lfo.start();
        nodes.push(lfo, lg);
      }
    };
    const addOsc = (type: OscillatorType, freq: number, vol: number, lfoRate = 0) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g);
      g.connect(gain);
      o.start();
      nodes.push(o, g);
      if (lfoRate > 0) {
        const lfo = ctx.createOscillator();
        lfo.frequency.value = lfoRate;
        const lg = ctx.createGain();
        lg.gain.value = vol * 0.6;
        lfo.connect(lg);
        lg.connect(g.gain);
        lfo.start();
        nodes.push(lfo, lg);
      }
    };
    if (kind === 'exterior') {
      addNoise('bandpass', 420, 0.6, 0.34, 0.13, 220);
      addNoise('lowpass', 160, 0.5, 0.4);
      addOsc('sine', 55, 0.05, 0.07);
    } else if (kind === 'base') {
      addOsc('sawtooth', 50, 0.035);
      addOsc('sine', 100.5, 0.06, 0.21);
      addNoise('lowpass', 240, 0.5, 0.26);
      addNoise('bandpass', 2600, 6, 0.012, 0.31, 600);
    } else if (kind === 'industrial') {
      addOsc('sawtooth', 41, 0.06);
      addOsc('square', 82.4, 0.02, 1.7);
      addNoise('lowpass', 320, 0.8, 0.38, 0.5, 90);
      addNoise('bandpass', 1300, 3, 0.03, 3.1, 300);
    } else {
      addOsc('sine', 46, 0.12, 0.5);
      addOsc('sawtooth', 69, 0.03, 0.25);
      addOsc('sine', 276, 0.016, 0.33);
      addNoise('lowpass', 200, 0.6, 0.3);
    }
    gain.gain.setTargetAtTime(1, ctx.currentTime, 0.8);
    this.ambient = { gain, nodes };
  }

  /** 警报：0 关闭，1 全开 */
  setAlarm(level: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.alarmLevel = level;
    if (level > 0 && !this.alarm) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 520;
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 0.83;
      const lg = ctx.createGain();
      lg.gain.value = 190;
      lfo.connect(lg);
      lg.connect(osc.frequency);
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 800;
      f.Q.value = 1.2;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(f);
      f.connect(gain);
      gain.connect(this.sfx);
      const send = ctx.createGain();
      send.gain.value = 0.8;
      gain.connect(send);
      send.connect(this.reverbSend);
      osc.start();
      lfo.start();
      this.alarm = { gain, osc, lfo };
    }
    if (this.alarm) this.alarm.gain.gain.setTargetAtTime(level * 0.055, ctx.currentTime, 0.4);
  }

  /** Helix 过热时的持续啸叫（0..1） */
  setHeatWhine(heat: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.heat) {
      if (heat <= 0.02) return;
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(gain);
      gain.connect(this.sfx);
      osc.start();
      this.heat = { gain, osc };
    }
    this.heat.osc.frequency.setTargetAtTime(500 + heat * 1700, ctx.currentTime, 0.05);
    this.heat.gain.gain.setTargetAtTime(heat > 0.25 ? (heat - 0.25) * 0.05 : 0, ctx.currentTime, 0.05);
  }

  // ---------- 自适应音乐 ----------
  setMusic(mode: MusicMode): void {
    if (mode === this.musicMode) return;
    this.musicMode = mode;
    const ctx = this.ctx;
    if (!ctx) return;
    this.step = 0;
    this.nextNoteTime = ctx.currentTime + 0.1;
    // 铺底 Pad
    if (this.pad) {
      const old = this.pad;
      old.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
      setTimeout(() => {
        for (const o of old.oscs) {
          try {
            o.stop();
          } catch {
            /* 已停止 */
          }
          o.disconnect();
        }
        old.filter.disconnect();
        old.gain.disconnect();
      }, 4000);
      this.pad = null;
    }
    if (mode === 'none') return;
    const chord: Record<Exclude<MusicMode, 'none'>, number[]> = {
      menu: [55, 82.4, 110, 164.8, 196],
      explore: [49, 73.4, 110, 146.8],
      combat: [55, 82.4, 110, 130.8],
      boss: [46.2, 69.3, 92.5, 110, 138.6],
      victory: [65.4, 98, 130.8, 164.8, 196, 261.6],
    };
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = mode === 'boss' ? 900 : mode === 'victory' ? 1800 : 600;
    filter.Q.value = 1.2;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    filter.connect(gain);
    gain.connect(this.music);
    const oscs: OscillatorNode[] = [];
    for (const f of chord[mode]) {
      for (const det of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.045;
        o.connect(g);
        g.connect(filter);
        o.start();
        oscs.push(o);
      }
    }
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lg = ctx.createGain();
    lg.gain.value = 260;
    lfo.connect(lg);
    lg.connect(filter.frequency);
    lfo.start();
    oscs.push(lfo);
    gain.gain.setTargetAtTime(mode === 'menu' || mode === 'victory' ? 0.9 : mode === 'explore' ? 0.55 : 0.5, ctx.currentTime, 1.2);
    this.pad = { gain, oscs, filter };
  }

  private musicNote(time: number, freq: number, dur: number, gain: number, type: OscillatorType, cutoff: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, time);
    f.frequency.exponentialRampToValueAtTime(Math.max(80, cutoff * 0.25), time + dur);
    f.Q.value = 4;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime(gain, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    o.connect(f);
    f.connect(g);
    g.connect(this.musicLayer);
    o.start(time);
    o.stop(time + dur + 0.05);
  }

  private musicDrum(time: number, kind: 'kick' | 'snare' | 'hat', gain: number): void {
    const ctx = this.ctx!;
    if (kind === 'kick') {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(150, time);
      o.frequency.exponentialRampToValueAtTime(38, time + 0.16);
      const g = ctx.createGain();
      g.gain.setValueAtTime(gain, time);
      g.gain.exponentialRampToValueAtTime(0.0001, time + 0.24);
      o.connect(g);
      g.connect(this.musicLayer);
      o.start(time);
      o.stop(time + 0.3);
      return;
    }
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = kind === 'hat' ? 'highpass' : 'bandpass';
    f.frequency.value = kind === 'hat' ? 7000 : 1700;
    f.Q.value = kind === 'hat' ? 0.7 : 0.9;
    const g = ctx.createGain();
    const dur = kind === 'hat' ? 0.04 : 0.16;
    g.gain.setValueAtTime(gain, time);
    g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.musicLayer);
    src.start(time, Math.random());
    src.stop(time + dur + 0.02);
  }

  /** 每帧调用：按拍调度战斗/Boss 音序 */
  updateMusic(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const mode = this.musicMode;
    if (mode !== 'combat' && mode !== 'boss' && mode !== 'explore' && mode !== 'menu') return;
    const bpm = mode === 'boss' ? 138 : mode === 'combat' ? 118 : 72;
    const stepDur = 60 / bpm / 4;
    if (this.nextNoteTime < ctx.currentTime - 0.3) this.nextNoteTime = ctx.currentTime + 0.05;
    while (this.nextNoteTime < ctx.currentTime + 0.12) {
      const t = this.nextNoteTime;
      const s = this.step % 64;
      const bar = Math.floor(s / 16);
      const b = s % 16;
      if (mode === 'combat') {
        const root = [55, 55, 65.4, 49][bar];
        const pat = [1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1];
        if (pat[b]) this.musicNote(t, root * (b % 8 === 7 ? 1.5 : 1), stepDur * 0.9, 0.26, 'sawtooth', 700 + (b % 4 === 0 ? 500 : 0));
        if (b % 8 === 0) this.musicDrum(t, 'kick', 0.6);
        if (b % 8 === 4) this.musicDrum(t, 'snare', 0.24);
        if (b % 2 === 0) this.musicDrum(t, 'hat', 0.05);
        if (b === 0 && bar % 2 === 0) this.musicNote(t, root * 4, stepDur * 10, 0.05, 'square', 1400);
      } else if (mode === 'boss') {
        const root = [46.2, 46.2, 55, 51.9][bar];
        const pat = [1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0];
        if (pat[b]) this.musicNote(t, root * (b === 14 ? 2 : b % 4 === 3 ? 1.5 : 1), stepDur * 0.85, 0.3, 'sawtooth', 900 + (b % 4 === 0 ? 800 : 0));
        if (b % 4 === 0) this.musicDrum(t, 'kick', 0.75);
        if (b % 8 === 4) this.musicDrum(t, 'snare', 0.34);
        this.musicDrum(t, 'hat', b % 2 === 0 ? 0.07 : 0.035);
        const lead = [0, 3, 7, 10, 12, 10, 7, 3];
        if (b % 2 === 0 && bar >= 2) this.musicNote(t, root * 4 * Math.pow(2, lead[(b / 2) % 8] / 12), stepDur * 1.7, 0.06, 'square', 2600);
        if (b === 0) this.musicNote(t, root * 2, stepDur * 14, 0.1, 'sawtooth', 500);
      } else if (mode === 'explore') {
        // 稀疏的脉冲与回声式音符，保持紧张感但不抢戏
        if (b === 0) this.musicNote(t, 55, stepDur * 6, 0.2, 'sine', 300);
        if (b === 10 && bar % 2 === 1) this.musicNote(t, 110 * Math.pow(2, [0, 3, 7, 5][bar] / 12), stepDur * 8, 0.05, 'triangle', 900);
        if (b === 6 && bar === 3) this.musicNote(t, 440 * Math.pow(2, 3 / 12), stepDur * 12, 0.02, 'sine', 1800);
      } else {
        const arp = [0, 7, 12, 15, 19, 15, 12, 7];
        if (b % 2 === 0) this.musicNote(t, 110 * Math.pow(2, (arp[(b / 2) % 8] + [0, 0, -4, -2][bar]) / 12), stepDur * 3.2, 0.06, 'triangle', 1500);
        if (b === 0) this.musicNote(t, 55 * Math.pow(2, [0, 0, -4, -2][bar] / 12), stepDur * 15, 0.2, 'sine', 400);
      }
      this.nextNoteTime += stepDur;
      this.step++;
    }
  }

  victorySting(): void {
    const d = this.out(null, 0.5);
    if (!d) return;
    const notes = [261.6, 329.6, 392, 523.2, 659.2, 784];
    notes.forEach((f, i) => {
      this.tone(d, { type: 'triangle', freq: f, dur: 1.2, gain: 0.22, delay: i * 0.14 });
      this.tone(d, { type: 'sine', freq: f * 2, dur: 0.9, gain: 0.08, delay: i * 0.14 });
    });
  }

  stopAllLoops(): void {
    this.setAmbient('none');
    this.setAlarm(0);
    this.setHeatWhine(0);
  }
}
