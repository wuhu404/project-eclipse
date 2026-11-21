export type WeaponId = 'ar9' | 'viper' | 'helix';

export interface WeaponDef {
  id: WeaponId;
  name: string;
  subtitle: string;
  slot: number;
  /** 伤害（每发/每颗弹丸） */
  damage: number;
  headMul: number;
  pellets: number;
  rpm: number;
  auto: boolean;
  /** 弹匣容量（0 = 使用热量系统） */
  magSize: number;
  reserveStart: number;
  reserveMax: number;
  reloadTime: number;
  /** 逐发装填（霰弹枪） */
  shellReload: boolean;
  /** 腰射散布（度）：基础 / 最大 / 每发增长 / 每秒恢复 */
  spreadBase: number;
  spreadMax: number;
  spreadPerShot: number;
  spreadRecover: number;
  /** 开镜散布系数 */
  adsSpreadMul: number;
  /** 移动/空中散布惩罚（度） */
  moveSpread: number;
  /** 伤害衰减：起始距离、结束距离、最小系数 */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  range: number;
  /** 后坐力：垂直（度）、水平随机范围（度）、武器模型后退量（米）、上扬（弧度） */
  recoilPitch: number;
  recoilYaw: number;
  kickBack: number;
  kickRot: number;
  adsZoom: number;
  adsTime: number;
  /** 投射物速度（0 = 即时命中） */
  projectileSpeed: number;
  splash: number;
  splashDamage: number;
  /** 热量：每发、冷却速度、冷却延迟、过热惩罚时间 */
  heatPerShot: number;
  heatCool: number;
  heatDelay: number;
  overheatTime: number;
  tracerColor: number;
  muzzleColor: number;
  shake: number;
  /** 对装甲部位的伤害系数 */
  armorMul: number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  ar9: {
    id: 'ar9',
    name: 'AR-9',
    subtitle: '突击步枪',
    slot: 1,
    damage: 16,
    headMul: 2.0,
    pellets: 1,
    rpm: 660,
    auto: true,
    magSize: 30,
    reserveStart: 150,
    reserveMax: 240,
    reloadTime: 1.9,
    shellReload: false,
    spreadBase: 0.55,
    spreadMax: 3.4,
    spreadPerShot: 0.42,
    spreadRecover: 6.5,
    adsSpreadMul: 0.22,
    moveSpread: 1.3,
    falloffStart: 30,
    falloffEnd: 70,
    falloffMin: 0.6,
    range: 160,
    recoilPitch: 0.62,
    recoilYaw: 0.34,
    kickBack: 0.045,
    kickRot: 0.035,
    adsZoom: 1.38,
    adsTime: 0.17,
    projectileSpeed: 0,
    splash: 0,
    splashDamage: 0,
    heatPerShot: 0,
    heatCool: 0,
    heatDelay: 0,
    overheatTime: 0,
    tracerColor: 0xffc27a,
    muzzleColor: 0xffb060,
    shake: 0.07,
    armorMul: 0.45,
  },
  viper: {
    id: 'viper',
    name: 'VIPER',
    subtitle: '霰弹枪',
    slot: 2,
    damage: 11,
    headMul: 1.5,
    pellets: 9,
    rpm: 72,
    auto: false,
    magSize: 6,
    reserveStart: 18,
    reserveMax: 48,
    reloadTime: 0.52,
    shellReload: true,
    spreadBase: 4.2,
    spreadMax: 5.4,
    spreadPerShot: 1.2,
    spreadRecover: 3.5,
    adsSpreadMul: 0.72,
    moveSpread: 0.6,
    falloffStart: 8,
    falloffEnd: 24,
    falloffMin: 0.22,
    range: 60,
    recoilPitch: 4.2,
    recoilYaw: 1.3,
    kickBack: 0.16,
    kickRot: 0.2,
    adsZoom: 1.15,
    adsTime: 0.2,
    projectileSpeed: 0,
    splash: 0,
    splashDamage: 0,
    heatPerShot: 0,
    heatCool: 0,
    heatDelay: 0,
    overheatTime: 0,
    tracerColor: 0xffd9a0,
    muzzleColor: 0xffa040,
    shake: 0.3,
    armorMul: 0.5,
  },
  helix: {
    id: 'helix',
    name: 'HELIX',
    subtitle: '能量步枪',
    slot: 3,
    damage: 34,
    headMul: 1.6,
    pellets: 1,
    rpm: 300,
    auto: true,
    magSize: 0,
    reserveStart: 0,
    reserveMax: 0,
    reloadTime: 1.2,
    shellReload: false,
    spreadBase: 0.35,
    spreadMax: 1.6,
    spreadPerShot: 0.3,
    spreadRecover: 4,
    adsSpreadMul: 0.15,
    moveSpread: 0.8,
    falloffStart: 999,
    falloffEnd: 1000,
    falloffMin: 1,
    range: 200,
    recoilPitch: 0.95,
    recoilYaw: 0.25,
    kickBack: 0.07,
    kickRot: 0.05,
    adsZoom: 1.6,
    adsTime: 0.2,
    projectileSpeed: 85,
    splash: 2.2,
    splashDamage: 14,
    heatPerShot: 11,
    heatCool: 30,
    heatDelay: 0.45,
    overheatTime: 2.2,
    tracerColor: 0x35e0ff,
    muzzleColor: 0x35e0ff,
    shake: 0.11,
    armorMul: 1.0,
  },
};

export const WEAPON_ORDER: WeaponId[] = ['ar9', 'viper', 'helix'];
