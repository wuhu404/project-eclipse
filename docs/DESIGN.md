# PROJECT ECLIPSE — 设计与架构笔记

## 坐标与关卡布局（单位：米；玩家向 -Z 推进；所有可战斗地面 y=0）
| 分区 | 名称 | 范围 | 高度 | 内容 |
|---|---|---|---|---|
| 0 | 外围着陆区 LZ | x[-26,26] z[12,70] | 露天 | 空投舱(0,58)、教学（移动/射击靶标×3/闸门终端 (5.2,13.5)）、基地外墙 z[10,12]，机库闸门 x[-4,4] 高5.5 |
| 1 | 机库 | x[-22,22] z[-40,10] | 14 | 运输机(-9,-8)、货箱掩体、东侧走道 y=4.2 (x[17,22] z[-38,-6])、楼梯 z[2→-6]、控制室 NE (x[14,22] z[-40,-32]) 有门禁卡+Viper；西侧怪物间 (x[-29,-23] z[-23,-17]) 增援；北墙安全门 x[-2,2] |
| 2 | 安检通道 | x[-3,3] z[-56,-41] | 4 | 存档点1、补给 |
| 3 | 研究实验室 | x[-20,20] z[-97,-57] | 6 | 中庭全息台(0,-77)、培养罐、隔墙 x=±11（开口 z=-64,-90）、东翼 Helix (16,-77)、西翼隐藏补给；清场后北门解锁 |
| 4 | 工业区 | 走廊 x[-3,3] z[-110,-98]；机械大厅 x[-18,18] z[-142,-110] | 4 / 9 | 两座涡轮机组 x[-12,-5]/[5,12] z[-131,-121]、重型机器人、爆炸桶；清场后北门解锁 |
| 5 | 能源控制室 | x[-13,13] z[-167,-143] | 7 | 中央控制台(0,-155)，激活后坚守 60s（3 波），完成后 EMP 清场；两侧怪物间 |
| 6 | 核心通道 | x[-3,3] z[-182,-168] | 4 | 补给、存档点4 |
| 7 | 核心竞技场 | 圆心(0,-210) 半径26 | 24 | 6 根掩体立柱(r=15)，OMEGA-01 |

导航网格范围 x[-30,30] z[-238,72]，格子 0.5m。

## 存档点
0 着陆区 → 1 安检通道 → 2 工业走廊 → 3 能源室入口 → 4 核心通道

## 模块
- core: Game(状态机/主循环)、Input、Settings/SaveSystem、Events、math
- render: Gfx(渲染器/后期/主光)、LightPool(固定数量点光池)、Sky、Textures(程序化PBR)、Materials、GeoBatch(静态合批)
- physics: Physics(Rapier 封装、碰撞分组、射线)
- level: NavGrid(A*)、LevelBuilder(模块化搭建套件)、Level01(布局/任务/触发器)、Doors/Interactables/Pickups
- player: Player(KCC 角色控制器、相机反馈)
- weapons: WeaponDefs、WeaponModels(程序化枪模)、WeaponSystem(射击/换弹/过热/视图模型动画)、Projectiles
- enemies: Enemy(FSM 基类)、Sentry/Stalker/Juggernaut/Wasp、Boss(OMEGA-01)、EnemyModels、EnemyManager
- fx: Particles(对象池)、Decals、Tracers、Debris
- audio: AudioEngine(Web Audio 程序化合成/空间音频)、Music(自适应音序器)
- ui: HUD、Menus

## 美术语言
冷调钢蓝基底；青色=基地系统/玩家；橙色=工业/警示；红色只属于失控 AI/敌人。发光材质用 HDR 颜色 + Bloom 阈值 1.0。
