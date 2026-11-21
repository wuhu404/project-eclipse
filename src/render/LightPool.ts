import * as THREE from 'three';
import { damp } from '../core/math';

/**
 * 固定数量的点光源池。关卡中有上百个"灯位"（LightSocket），但同时只有离玩家最近的
 * N 个真正发光。因为灯的数量恒定，Three.js 不会因为灯光增减而重新编译着色器，
 * 既保证了动态照明的丰富度，也避免了卡顿。
 */
export interface LightSocket {
  pos: THREE.Vector3;
  color: THREE.Color;
  intensity: number;
  distance: number;
  /** 所在分区索引，用于按分区开关 */
  zone: number;
  /** 闪烁类型：0 无；1 故障闪烁；2 警报脉冲 */
  flicker: number;
  enabled: boolean;
  /** 运行时：当前被哪个池位占用（-1 表示无） */
  slot: number;
}

interface Slot {
  light: THREE.PointLight;
  socket: LightSocket | null;
  fade: number; // 0..1
}

export class LightPool {
  sockets: LightSocket[] = [];
  private slots: Slot[] = [];
  private timer = 0;
  private scored: { s: LightSocket; d: number }[] = [];

  constructor(private scene: THREE.Scene, count: number) {
    this.resize(count);
  }

  resize(count: number): void {
    for (const s of this.slots) {
      if (s.socket) s.socket.slot = -1;
      this.scene.remove(s.light);
      s.light.dispose();
    }
    this.slots = [];
    for (let i = 0; i < count; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 18, 1.6);
      light.layers.enable(1);
      light.castShadow = false;
      this.scene.add(light);
      this.slots.push({ light, socket: null, fade: 0 });
    }
  }

  addSocket(x: number, y: number, z: number, color: number, intensity: number, distance: number, zone: number, flicker = 0): LightSocket {
    const s: LightSocket = {
      pos: new THREE.Vector3(x, y, z),
      color: new THREE.Color(color),
      intensity,
      distance,
      zone,
      flicker,
      enabled: true,
      slot: -1,
    };
    this.sockets.push(s);
    return s;
  }

  clearSockets(): void {
    for (const s of this.slots) {
      s.socket = null;
      s.fade = 0;
      s.light.intensity = 0;
    }
    this.sockets = [];
  }

  update(dt: number, time: number, focus: THREE.Vector3, forward: THREE.Vector3, alarm: number): void {
    this.timer -= dt;
    if (this.timer <= 0) {
      this.timer = 0.2;
      this.reassign(focus, forward);
    }
    for (let i = 0; i < this.slots.length; i++) {
      const slot = this.slots[i];
      const sock = slot.socket;
      const wanted = sock !== null && sock.enabled && sock.slot === i;
      slot.fade = damp(slot.fade, wanted ? 1 : 0, wanted ? 5 : 9, dt);
      if (!sock) {
        slot.light.intensity = 0;
        continue;
      }
      let k = 1;
      if (sock.flicker === 1) {
        const n = Math.sin(time * 31 + sock.pos.x * 3.1) * Math.sin(time * 17.3 + sock.pos.z);
        k = n > 0.55 ? 0.15 : 1;
      } else if (sock.flicker === 2) {
        k = 0.2 + alarm * (0.3 + 0.9 * Math.pow(0.5 + 0.5 * Math.sin(time * 5.2), 2));
      }
      slot.light.intensity = sock.intensity * slot.fade * k;
      if (!wanted && slot.fade < 0.02) {
        if (sock.slot === i) sock.slot = -1;
        slot.socket = null;
        slot.light.intensity = 0;
      }
    }
  }

  private reassign(focus: THREE.Vector3, forward: THREE.Vector3): void {
    const scored = this.scored;
    scored.length = 0;
    for (const s of this.sockets) {
      if (!s.enabled) continue;
      const dx = s.pos.x - focus.x;
      const dy = s.pos.y - focus.y;
      const dz = s.pos.z - focus.z;
      let d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > 46) continue;
      // 视线前方的灯优先；已经点亮的灯给予滞回，避免来回切换
      const dot = (dx * forward.x + dz * forward.z) / (d + 0.001);
      d *= dot > 0 ? 0.8 : 1.25;
      if (s.slot >= 0) d *= 0.8;
      scored.push({ s, d });
    }
    scored.sort((a, b) => a.d - b.d);
    const n = Math.min(this.slots.length, scored.length);
    const desired = new Set<LightSocket>();
    for (let i = 0; i < n; i++) desired.add(scored[i].s);
    // 释放不再需要的
    for (const slot of this.slots) {
      if (slot.socket && !desired.has(slot.socket) && slot.socket.slot >= 0) {
        slot.socket.slot = -1; // 标记为淡出
      }
    }
    // 分配新的
    for (const s of desired) {
      if (s.slot >= 0) continue;
      const free = this.slots.findIndex((sl) => sl.socket === null);
      if (free < 0) break;
      const slot = this.slots[free];
      slot.socket = s;
      s.slot = free;
      slot.fade = 0;
      slot.light.position.copy(s.pos);
      slot.light.color.copy(s.color);
      slot.light.distance = s.distance;
    }
  }

  dispose(): void {
    for (const s of this.slots) {
      this.scene.remove(s.light);
      s.light.dispose();
    }
    this.slots = [];
    this.sockets = [];
  }
}
