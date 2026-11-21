# PROJECT ECLIPSE

原创 3D 科幻第一人称射击游戏。公元 2189 年，日蚀站（ECLIPSE STATION // KEPLER-442）失去联系，
你作为特种作战人员进入基地，突破失控的 AI 防线、恢复能源，并击毁中央守卫 **OMEGA-01**。

- 技术栈：Three.js · TypeScript · Vite · Rapier (WASM) · Web Audio API · HTML/CSS · localStorage
- 所有几何体、PBR 纹理、特效、音效与音乐均为**程序化生成**，没有任何外部素材、远程后端或付费 API
- 一个完整关卡，8 个区域，目标时长 10–15 分钟

## 在线试玩

**https://wuhu404.github.io/project-eclipse/** — 需要桌面浏览器、键盘和鼠标。

## 部署（GitHub Pages）

推送到 `main` 分支后，`.github/workflows/deploy.yml` 会自动安装依赖、类型检查、生产构建并发布到 GitHub Pages；构建失败则不会发布。也可以在仓库的 Actions 页面手动运行 "Deploy to GitHub Pages"。

构建时 CI 通过环境变量 `VITE_BASE` 把资源路径设为 `/<仓库名>/`；本地构建默认使用相对路径，`dist/` 放到任意静态目录都能运行。

## 安装与运行

需要 Node.js 20+ 和支持 WebGL2 的桌面浏览器（建议 Chrome / Edge，使用独立或集成 GPU）。

```bash
npm install
npm run dev        # 开发服务器 → http://localhost:5173/
npm run build      # 类型检查 + 生产构建 → dist/
npm run preview    # 预览生产构建 → http://localhost:4173/
npm run typecheck  # 仅类型检查
npm run test:e2e   # 端到端自动化测试（需要先启动 npm run dev）
```

## 操作

| 按键 | 功能 |
| --- | --- |
| W A S D | 移动 |
| 鼠标 | 瞄准（Pointer Lock） |
| 鼠标左键 / 右键 | 开火 / 开镜 (ADS) |
| Shift | 冲刺 |
| Ctrl | 蹲伏；冲刺中按下为滑铲 |
| Space | 跳跃 |
| R | 换弹 |
| 1 / 2 / 3 | AR-9 / VIPER / HELIX |
| E | 交互（终端、门禁、控制台） |
| Esc | 暂停 |

## 关卡流程

1. 任务简报 → 外围着陆区：移动教学、靶场校准（射击）、终端交互开启机库闸门
2. 机库：哨兵巡逻队；经东侧楼梯上高架走道，在控制室取得 **VIPER** 与 **A 级门禁卡**（触发伏击）
3. 安检通道（存档点）→ 研究实验室：哨兵 + 猎手混编与增援；东翼可取得 **HELIX**
4. 工业区（存档点）→ 机械大厅：重型机器人、猎手、无人机波次
5. 能源控制室（存档点）：激活控制台后坚守 60 秒，EMP 清场
6. 核心通道（存档点）→ 中央核心：三阶段 Boss 战 **OMEGA-01** → 胜利结算与评级

## 已实现功能

**玩家**：Rapier 运动学角色控制器（胶囊碰撞、自动上台阶、贴地）；加速/摩擦/空中控制；冲刺、蹲伏、滑铲、
跳跃（缓冲 + 土狼时间）；镜头摆动、落地反馈、后坐力弹簧；生命 100 + 护甲 100（吸收约 60%）；低血量缓慢恢复。

**武器**（独立第一人称枪模、双手、换弹/开火动画、枪口火焰、弹壳、曳光、弹痕、命中火花、命中标记、动态准星）

| 武器 | 机制 | 关键数值 |
| --- | --- | --- |
| AR-9 突击步枪 | 全自动射线武器，中等后坐力 | 16 伤害，660 RPM，30 发，30–70 m 衰减，爆头 ×2 |
| VIPER 霰弹枪 | 每发 9 颗弹丸，逐发装填 | 9×11 伤害，72 RPM，6 发，8–24 m 衰减 |
| HELIX 能量步枪 | 投射物 + 溅射，无弹药、热量/过热机制 | 34 伤害，85 m/s，2.2 m 溅射，100 热量过热 |

**敌人**（有限状态机：idle / patrol / alert / search / chase / attack / cover / reposition / stagger / dead；
视野锥 + 视线遮挡 + 听觉；导航网格 A* 寻路；警报在同伴间传播）

- 哨兵 Sentry：路线巡逻，三连发等离子弹，贴身电击，横移换位
- 猎手 Stalker：寻找掩体、探头、红色激光预警后高速射击、后撤换位
- 重装 Juggernaut：正面装甲减伤、背部弱点、砸地冲击与迫击炮（带预警圈）
- 黄蜂 Wasp：悬浮无人机，环绕点射
- **OMEGA-01**：4200 HP，三阶段（66% / 33%）。追踪能量球、地面冲击波、召唤黄蜂/哨兵、二阶段解锁扫射光束；
  核心弱点 ×2.5；所有攻击有预警；死亡连环爆炸演出

**关卡与交互**：自动门、上锁/封闭门、门禁卡、终端与控制台、治疗/护甲/弹药/武器拾取、可引爆油桶、教学靶标、
任务目标与导航标记、区域名称、4 个存档点。

**UI**：主菜单（开始/继续/设置/操作说明）、任务简报、HUD（生命/护甲、武器与弹药、热量、动态准星、命中与击杀反馈、
受击方向、目标、导航点、Boss 血条与阶段、坚守进度、字幕、提示）、暂停、死亡重试、胜利结算与评级。

**设置**（localStorage）：鼠标灵敏度、ADS 倍率、FOV、反转 Y、镜头摆动、屏幕震动、主音量/音效/音乐、画质、难度、帧率显示。

**音频**（全部 Web Audio 程序化合成）：三种枪声、换弹、金属脚步、敌人警戒/攻击、受伤、环境机械声、警报、
战斗/Boss 音乐、空间声像。

**渲染**：程序化 PBR 纹理（金属/粗糙度/法线）、程序化天空、合批静态几何、灯光池、阴影、Bloom、色调映射、暗角、
受伤/低血量后期、独立武器相机层。

## 目录结构

```
src/
  core/      Game（主循环与状态机）、Input、Settings/存档、Context、math
  render/    Gfx（相机/后期/灯光）、Materials、Textures（程序化）、Sky、GeoBatch、LightPool
  physics/   Rapier 封装（静态碰撞、射线、视线）
  player/    第一人称控制器
  weapons/   WeaponDefs、WeaponSystem、WeaponModels、Projectiles
  enemies/   Enemy（FSM 基类）、EnemyTypes、Boss、EnemyModels、EnemyManager
  level/     LevelBuilder、LevelGeometry、Level01（任务状态机）、Entities、NavGrid
  fx/        粒子、曳光、弹痕、冲击波（对象池）
  audio/     AudioEngine（程序化音效与音乐）
  ui/        Hud、Menus
tests/       e2e.mjs（端到端）、bot.js（自动游玩机器人）、lib.mjs 及若干诊断脚本
docs/        PROGRESS.md（开发记录）
```

## 测试

`npm run test:e2e` 用 playwright-core 驱动本机 Chrome（可用 `CHROME_PATH` 指定路径，`ECLIPSE_URL` 指定地址），
通过 `window.__ECLIPSE__` 测试钩子注入真实的键鼠输入并推进模拟，实际游玩整个关卡。截图与结果写入 `tests/out/`。

- 场景 A：主菜单 → 简报 → 移动/冲刺/滑铲/蹲伏/跳跃/碰撞 → 射击命中/换弹/ADS → 终端 → 机库战斗 → 门禁卡 →
  安全门 → 实验室 → HELIX 过热 → 工业区 → 坚守 60 秒 → Boss 三阶段 → 胜利结算
- 场景 B：暂停、设置读写、死亡与重试、存档与继续任务、各菜单按钮
- 场景 C：非测试模式下真实点击触发 Pointer Lock、丢失后自动暂停与重新锁定、窗口缩放

`GOD=0 npm run test:e2e` 可关闭机器人的无敌。实测结果与未覆盖项见下节。

## 实测结果与已知限制

见 [docs/TESTING.md](docs/TESTING.md)。
