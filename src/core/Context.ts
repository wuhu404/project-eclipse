import type * as THREE from 'three';
import type { AudioEngine } from '../audio/AudioEngine';
import type { EnemyManager } from '../enemies/EnemyManager';
import type { Fx } from '../fx/Fx';
import type { Level } from '../level/Level01';
import type { NavGrid } from '../level/NavGrid';
import type { Physics } from '../physics/Physics';
import type { Player } from '../player/Player';
import type { Gfx } from '../render/Gfx';
import type { MaterialLibrary } from '../render/Materials';
import type { Hud } from '../ui/Hud';
import type { Projectiles } from '../weapons/Projectiles';
import type { WeaponSystem } from '../weapons/WeaponSystem';
import type { Input } from './Input';
import type { RunStats, Settings } from './Settings';

/** 难度系数 */
export interface DifficultyTuning {
  enemyDamage: number;
  enemyHealth: number;
  enemyAccuracy: number;
  pickupMul: number;
}

export const DIFFICULTY: Record<'easy' | 'normal' | 'hard', DifficultyTuning> = {
  easy: { enemyDamage: 0.6, enemyHealth: 0.8, enemyAccuracy: 0.7, pickupMul: 1.3 },
  normal: { enemyDamage: 1.0, enemyHealth: 1.0, enemyAccuracy: 1.0, pickupMul: 1.0 },
  hard: { enemyDamage: 1.45, enemyHealth: 1.25, enemyAccuracy: 1.25, pickupMul: 0.8 },
};

/**
 * 各系统共享的运行时上下文。Game 负责创建并在关卡重建时替换其中的成员。
 * 系统之间只通过它互相访问，避免循环依赖。
 */
export interface Ctx {
  gfx: Gfx;
  input: Input;
  settings: Settings;
  audio: AudioEngine;
  mats: MaterialLibrary;
  physics: Physics;
  nav: NavGrid;
  fx: Fx;
  hud: Hud;
  player: Player;
  weapons: WeaponSystem;
  projectiles: Projectiles;
  enemies: EnemyManager;
  level: Level;
  stats: RunStats;
  tuning: DifficultyTuning;
  /** 游戏内时间（暂停时不走） */
  time: number;
  /** 全局警报强度 0..1 */
  alarm: number;
  /** 屏幕震动（位置, 强度, 半径）——按距离衰减后施加给玩家相机 */
  shake(pos: THREE.Vector3 | null, amount: number, radius?: number): void;
  /** 范围爆炸伤害（对玩家、敌人、油桶） */
  explode(pos: THREE.Vector3, radius: number, damage: number, source: 'player' | 'enemy' | 'world', color?: number): void;
  /** 短暂的命中停顿（时间缩放），增强打击感 */
  hitStop(duration: number, scale?: number): void;
}
