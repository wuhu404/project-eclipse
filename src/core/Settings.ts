/** 游戏设置与进度存档（localStorage）。 */
export type Quality = 'low' | 'medium' | 'high';
export type Difficulty = 'easy' | 'normal' | 'hard';

export interface SettingsData {
  sensitivity: number; // 0.2 ~ 3
  adsSensitivity: number; // 0.3 ~ 1.5
  invertY: boolean;
  fov: number; // 70 ~ 110
  masterVolume: number;
  sfxVolume: number;
  musicVolume: number;
  quality: Quality;
  difficulty: Difficulty;
  showFps: boolean;
  viewBob: boolean;
  screenShake: number; // 0 ~ 1
}

export const DEFAULT_SETTINGS: SettingsData = {
  sensitivity: 1,
  adsSensitivity: 0.75,
  invertY: false,
  fov: 90,
  masterVolume: 0.8,
  sfxVolume: 0.9,
  musicVolume: 0.6,
  quality: 'high',
  difficulty: 'normal',
  showFps: false,
  viewBob: true,
  screenShake: 1,
};

const SETTINGS_KEY = 'project-eclipse.settings.v1';
const SAVE_KEY = 'project-eclipse.save.v1';

export interface SaveData {
  checkpoint: number;
  weapons: string[];
  ammo: Record<string, { mag: number; reserve: number }>;
  health: number;
  armor: number;
  hasKeycard: boolean;
  stats: RunStats;
  savedAt: number;
}

export interface RunStats {
  time: number;
  kills: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  damageTaken: number;
  deaths: number;
  secrets: number;
}

export const newStats = (): RunStats => ({
  time: 0,
  kills: 0,
  shotsFired: 0,
  shotsHit: 0,
  headshots: 0,
  damageTaken: 0,
  deaths: 0,
  secrets: 0,
});

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function safeSet(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* 隐私模式下忽略 */
  }
}

export class Settings {
  data: SettingsData;
  private listeners = new Set<(d: SettingsData) => void>();

  constructor() {
    this.data = { ...DEFAULT_SETTINGS };
    const raw = safeGet(SETTINGS_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as Partial<SettingsData>;
        for (const k of Object.keys(DEFAULT_SETTINGS) as (keyof SettingsData)[]) {
          if (parsed[k] !== undefined && typeof parsed[k] === typeof DEFAULT_SETTINGS[k]) {
            (this.data as unknown as Record<string, unknown>)[k] = parsed[k];
          }
        }
      } catch {
        /* 损坏的存档直接忽略 */
      }
    }
  }

  set<K extends keyof SettingsData>(key: K, value: SettingsData[K]): void {
    this.data[key] = value;
    safeSet(SETTINGS_KEY, JSON.stringify(this.data));
    for (const l of this.listeners) l(this.data);
  }

  reset(): void {
    this.data = { ...DEFAULT_SETTINGS };
    safeSet(SETTINGS_KEY, JSON.stringify(this.data));
    for (const l of this.listeners) l(this.data);
  }

  onChange(fn: (d: SettingsData) => void): void {
    this.listeners.add(fn);
  }
}

export const SaveSystem = {
  load(): SaveData | null {
    const raw = safeGet(SAVE_KEY);
    if (!raw) return null;
    try {
      const d = JSON.parse(raw) as SaveData;
      if (typeof d.checkpoint !== 'number' || !Array.isArray(d.weapons)) return null;
      return d;
    } catch {
      return null;
    }
  },
  save(d: SaveData): void {
    safeSet(SAVE_KEY, JSON.stringify(d));
  },
  clear(): void {
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* ignore */
    }
  },
};
