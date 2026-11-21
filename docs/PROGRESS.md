# 开发进度笔记（内部，交付前删除或并入 README）

环境：`source ~/.nvm/nvm.sh`（node 24）；项目 ~/repos/project-eclipse；three 0.187、rapier3d-compat 0.21、vite 8、TS 7、playwright-core。
VM 无 GPU（SwiftShader 2-8FPS）：测试用 playwright-core 启动 headless chrome（/home/ubuntu/.local/bin/google-chrome），通过 window.__ECLIPSE__ 手动 step 游戏循环；CJK 截图用独立 headless 实例。

## 已写完（未编译验证）
- core/math.ts (clamp/lerp/damp/Spring/Spring3/RNG/spreadDirection/angleDelta/turnToward/formatTime)
- core/Events.ts (Emitter)、core/Settings.ts (Settings, SaveSystem, SaveData, RunStats/newStats, Quality, Difficulty)、core/Input.ts (isDown/wasPressed/simulate/virtualLock/requestLock/canRelock/endFrame; 鼠标键 code 为 'Mouse0'/'Mouse2')
- render/Textures.ts（TexSet + texScreen(kind,seed,accent)/texSign(text,sub) + 粒子贴图）、render/Materials.ts（MaterialLibrary: wall/wallDark/wallLab/wallRust/floor/floorDark/floorLab/ceiling/concrete/rock/ground/hazard/trim/metalDark/Mid/Light/Red/Orange/Blue/gunmetal/polymer/rubber/crate*/pipe/pipeCopper/grate/glass/glassTank/chrome/glow*(Cyan,CyanSoft,Orange,Red,White,Warm,Green,Violet,Alarm)/black; PALETTE; glowMat(color,intensity); update(time, alarm)）
- render/GeoBatch.ts（box/geo/add/build）、render/Sky.ts（Sky.ECLIPSE_DIR）、render/LightPool.ts（addSocket(x,y,z,color,intensity,distance,zone,flicker)，socket.enabled）
- render/Gfx.ts（renderer/scene/camera/weaponCamera(layer1, fov58)/composer：world pass→weapon pass(clearDepth)→bloom→final(ACES+暗角+色差+受伤)；sun/hemi/fog；ZoneEnv + applyEnvImmediate/envTarget；flashLight(pos,color,intensity,dist,life)；muzzleLight；fx{damage,lowHealth,flash,desat,fade,shield,exposureMul}；setQuality；update(dt, alarm)；render()；weaponVisible）
  - 所有灯需 layers.enable(1) 才能照到武器；武器网格放 layer 1，挂在 gfx.weaponCamera 下。
- physics/Physics.ts（G 分组、groups()、QUERY.{WORLD,WORLD_PROP,PLAYER_SHOT,ENEMY_SHOT,ALL}、ColliderTag、raycast(origin,dir,max,filter,exclude)→复用 RayHit、lineOfSight(a,b)、addStaticBox/Cylinder、tag/tagOf、step(dt)/flush、removeCollider/removeBody、initRapier()）
- level/NavGrid.ts（markFloorRect/Disc、blockBox/Disc、addDoor→id、setDoorOpen、bake、isWalkable(x,z,r)、lineWalkable、nearestWalkable、randomPointNear、findPath(from,to,radius)→Vector3[]|null）
- level/LevelBuilder.ts（beginZone/endZone、deco/solid/block/collider/mesh/floor/ceiling/wallX/wallZ(openings{c,w,h})/doorFrame/ceilingLamp/strip/socket/pipe/cylinder/crate/crateCluster/screen/sign/rock/railing/own/dispose；zoneGroups）

- fx/Fx.ts（已编译通过）：new Fx(gfx,mats)；sparks(pos,normal,count,color,speed,spread,life)、smoke(pos,count,size,{rise,spread,life,alpha,color,dir,speed})、energyBurst(pos,color,count,speed,size,life)、glow(pos,color,size,life,vx,vy,vz,intensity)、fire(pos,count,radius,color)、impact(pos,normal,kind:'metal'|'energy'|'enemy'|'armor'|'dirt',scale)、explosion(pos,radius,color,withScorch)、tracer(from,to,color,width,speed,length)、beam(from,to,color,width,life,intensity)、ring(pos,color,r0,r1,life,normal|null,alpha)、flash(pos,color,size,life,grow)、decal/scorch(pos,normal,size)、debris(pos,count,speed,scale)、update(dt,camera)、clear()、setViewportHeight(h,fov)、dispose()
- audio/AudioEngine.ts（已编译通过）：init()(需用户手势)、setVolumes(m,s,mu)、suspend/resume、setListener(pos,fwd)、fireRifle/fireShotgun/shotgunPump/fireHelix(heat01)/helixOverheat/helixVentDone/dryFire/reload('magOut'|'magIn'|'bolt'|'shell'|'cell')/weaponSwitch/adsIn、hitMarker(headshot)/killConfirm/impact(pos,'metal'|'energy'|'flesh')、footstep('metal'|'dirt',sprint)/jump/land(strength)/slide/playerHurt(armor)/heartbeat/playerDeath、pickup('ammo'|'health'|'armor'|'weapon'|'key')/uiHover/uiClick/terminal(ok)/objective/checkpoint/door(pos,open)/doorDenied(pos)、enemyAlert(pos,pitch)/enemyShot(pos,'bolt'|'rifle'|'mortar'|'wasp')/enemyCharge(pos,dur,pitch)/enemyMelee/enemyHit/enemyDeath(pos,big)/explosion(pos,size)/heavyStep(pos,size)/servo/bossRoar/bossSlam/beamLoop(pos,dur)、setAmbient('none'|'exterior'|'base'|'industrial'|'core')、setAlarm(0..1)、setHeatWhine(0..1)、setMusic('none'|'menu'|'explore'|'combat'|'boss'|'victory')、updateMusic()、victorySting()、stopAllLoops()
- 全部已有文件 `npx tsc --noEmit` 通过（截至 Fx+Audio）。
- Rapier 0.21 类型在 node_modules/@dimforge/rapier3d-compat/dist/**；KCC: world.createCharacterController(offset)、enableAutostep(maxH,minW,dyn)、enableSnapToGround(d)、computeColliderMovement(collider,delta,flags?,groups?,pred?)、computedMovement()、computedGrounded()；collider.setEnabled/setShape/setHalfHeight/setTranslation({x,y,z})
- 敌人碰撞体：无刚体的 collider，groups(G.ENEMY,0xffff)，每帧 setTranslation；玩家 KCC 过滤组 groups(G.PLAYER, G.WORLD|G.PROP)（不与敌人碰撞，软推开）；敌方弹丸对玩家用解析胶囊检测。

## 设计数值（已定）
- 玩家：胶囊 r0.35 高1.8(蹲1.1) 眼高1.62/1.0；走5.2 冲刺7.8 蹲2.6 ADS3.4；跳7.2 重力22；滑铲初速10.5/0.8s；HP100 护甲100(吸收60%)；低血5s后缓回到30。
- AR-9：16伤(头x2) 660rpm 弹匣30 备弹150(上限240) 衰减30-70m 换弹1.9s 曳光hitscan
- Viper：9弹丸x11 75rpm 6发 备24(上限48) 散布4.2° 衰减8-24m 逐发装填0.5s 泵动
- Helix：能量弹 85m/s 34伤+溅射2m/14 300rpm 无弹药；热量+11/发，0.45s后 28/s 冷却，100 过热强制排热2.2s；R 手动排热
- 敌人：Sentry(哨兵 双足 HP80 速3.6 三连发等离子弹30m/s+近战电击)；Stalker(猎手 HP70 速4.4 掩体→探头→红色激光瞄准0.7s→高速弹；侧翼/过近时重新定位)；Juggernaut(重装 HP520 速1.9 正面装甲-60% 背部核心x2；砸地AoE r6.5 前摇1.1s；迫击炮3发落点标记)；Wasp(无人机 HP30 悬停2.2m)
- Boss OMEGA-01 HP4200：追踪能量球(可被柱子挡)、砸地冲击波环(需跳跃)、召唤 Wasp/Sentry；P2(<66%) 扫射光束；P3(<33%) 连招加速、核心常开；核心弱点x2.5；死亡连环爆炸→白闪→胜利

## 待写
1. level/Level01.ts：按 DESIGN.md 布局搭建 8 个分区 + ZoneEnv + 门/终端/拾取物/敌人出生点/存档点/任务状态机(Mission)
2. level/Entities.ts：Door(滑动门, collider.setEnabled, nav.setDoorOpen)、Interactable、Pickup、ExplosiveBarrel、HoloTarget
3. player/Player.ts：Rapier KCC 胶囊(r0.35,h1.8,眼1.65;蹲1.1)，加速度/摩擦/空中控制/冲刺/蹲伏/滑铲/跳跃(土狼时间)/头部晃动/落地/后坐力/震屏；玩家不与敌人做 KCC 碰撞（软推开）
4. weapons/: WeaponDefs、WeaponModels(Extrude 轮廓枪模+手臂)、WeaponSystem(射击/散布/后坐/ADS/换弹/Helix 过热/切枪/视图模型弹簧动画)、Projectiles(玩家能量弹+敌方弹丸池)
5. fx/: Particles(Points 池：additive+smoke)、Decals(InstancedMesh 环形缓冲)、Tracers、Debris、冲击波环
6. enemies/: Enemy FSM(巡逻→警觉→搜索→追击→攻击→重新定位/撤退→死亡)、Sentry(巡逻)/Stalker(战术掩体)/Juggernaut(重型:砸地AoE+迫击炮)/Wasp(无人机)、Boss OMEGA-01(追踪弹、冲击波环需跳跃、召唤、二阶段扫射光束、三阶段连招、死亡演出)、EnemyModels、EnemyManager
7. audio/: AudioEngine(程序化合成+混响+3D)、Music(探索/战斗/Boss 自适应)
8. ui/: HUD(血/甲/弹药/准星/命中标记/任务/罗盘/路标/Boss血条/受伤方向/字幕/提示)、Menus(主菜单/设置/简报/暂停/死亡/胜利)，index.html + css
9. core/Game.ts + main.ts：状态机 menu/briefing/intro/playing/paused/dead/victory，window.__ECLIPSE__ 测试钩子（step(dt,n)）
10. tests/e2e.mjs（playwright 自动通关脚本）、README、预览

## 新增（本轮）
- core/Context.ts：Ctx 接口（gfx,input,settings,audio,mats,physics,nav,fx,hud,player,weapons,projectiles,enemies,level,stats,tuning,time,alarm, shake(pos|null,amount,radius), explode(pos,radius,damage,source,color), hitStop(dur,scale)）；DIFFICULTY 表。类型导入期望：enemies/EnemyManager.ts 导出 EnemyManager；level/Level01.ts 导出 Level；ui/Hud.ts 导出 Hud；weapons/Projectiles.ts 导出 Projectiles；weapons/WeaponSystem.ts 导出 WeaponSystem。
- player/Player.ts：new Player(ctx)；pos(脚底)/vel/yaw/pitch/health/armor/alive/grounded/crouching/sliding/sprinting/controlEnabled/adsAmount/adsZoom/hasKeycard/godMode/zone/bobX/bobY/landOffset/speed2D/recoilPitch/recoilYaw；center(out)/eyePos(out)/currentHeight/radius；teleport(x,y,z,yaw)/reset()/kick(pitchDeg,yawDeg)/addShake(a)/heal(n)/addArmor(n)/damage(amount,sourcePos|null)（调用 ctx.hud.damageIndicator(pos)）/update(dt)/syncCamera(dt)/dispose()
- 约定：ctx.weapons.resolveHit(hit,damage,dir,source) 统一处理玩家命中；ctx.level.damageBarrel(id,dmg)；ctx.enemies.applyHit(...)。
- weapons/Projectiles.ts（未编译，依赖尚未写的模块）：new Projectiles(ctx,count)；spawn({owner,kind:'helix'|'bolt'|'rifle'|'orb'|'mortar'|'wasp',pos,dir,speed,damage,color,size,life,splash,splashDamage,homing,gravity})；spawnMortar(from,target,flight,damage,splash,color)；update(dt)/clear()/dispose()。
  - 它调用：ctx.weapons.resolveHit(hit: RayHit, damage, dir, 'helix')、ctx.weapons.splash(point, radius, damage, excludeTag)、ctx.level.damageBarrel(id, dmg)、ctx.explode(...)、player.damage(...)。

## 下一步顺序（严格按此继续）
1. weapons/WeaponDefs.ts → weapons/WeaponModels.ts（程序化枪模+手臂，layer 1）→ weapons/WeaponSystem.ts（resolveHit/splash、射击、换弹、过热、ADS、切枪、视图模型弹簧、枪口火焰、抛壳、准星扩散值 crosshairSpread、存档 ammo 导入导出）
2. enemies/EnemyModels.ts、Enemy.ts(FSM)、Sentry/Stalker/Juggernaut/Wasp、Boss.ts、EnemyManager.ts（spawn(type,pos,opts)、applyHit(tag,damage,point,dir,weapon)→{killed,headshot,armor}、damageInRadius、alertNear(pos,r)、aliveCount、update、clear）
3. level/Entities.ts（Door/Terminal/Pickup/Barrel/HoloTarget）+ level/Level01.ts（导出 class Level：build、update(dt)、damageBarrel、zoneAt、checkpoints、任务状态机、遭遇战触发）
4. ui/Hud.ts（damageIndicator(pos) 等）、ui/Menus.ts、index.html、src/styles.css
5. core/Game.ts（实现 Ctx：shake/explode/hitStop，状态机，主循环，window.__ECLIPSE__ 测试钩子）+ main.ts
6. typecheck → dev server → headless 实测 → 修复 → tests/e2e.mjs → README → 预览
- weapons/WeaponDefs.ts：WeaponId='ar9'|'viper'|'helix'；WEAPONS[id]: WeaponDef（damage/headMul/pellets/rpm/auto/magSize/reserveStart/reserveMax/reloadTime/shellReload/spreadBase/Max/PerShot/Recover/adsSpreadMul/moveSpread/falloffStart/End/Min/range/recoilPitch/recoilYaw/kickBack/kickRot/adsZoom/adsTime/projectileSpeed/splash/splashDamage/heatPerShot/heatCool/heatDelay/overheatTime/tracerColor/muzzleColor/shake/armorMul）；WEAPON_ORDER。
- weapons/WeaponModels.ts：buildWeaponView(id,mats) → WeaponView{id,root(Group,layer1,枪管-Z),muzzle,mag|null,bolt|null(AR拉机柄/Viper泵动护木(左手挂在其下)/Helix散热片),eject,leftHand,heatMat|null,hipPos,adsPos,dispose()}。ADS 位置 = 使瞄具中心(AR y=0.108, Viper 0.092, Helix 0.125)对准屏幕中心。root 应挂在 gfx.weaponCamera 下的 pivot 组里。（未做视觉验证，需要截图检查造型/手部朝向）
- weapons/WeaponSystem.ts（已写，未编译）：new WeaponSystem(ctx)；state[id]{owned,mag,reserve,heat,overheat}；current/def/cur/reloading/adsAmount/heat01/overheated/crosshairSpread(度)/lastFireTime/enabled；give(id)/addAmmo(id,n):bool/exportState()/importState(weapons,ammo)/reset()/switchTo(id)/resolveHit(hit,damage,dir,source)/splash(point,r,dmg,excludeTag)/update(dt)/setVisible(v)/dispose()。枪口火焰面片已挂在 weaponCamera 下（位置用 weaponCamera.worldToLocal(muzzle 世界坐标)）；首次截图时检查位置/朝向。
  - 它需要的外部接口：ctx.enemies.applyHit(tag,damage,point,dir,source)→{killed,headshot,armor}；ctx.enemies.damageInRadius(point,radius,damage,source,excludeId)；ctx.enemies.alertNear(pos,radius)；ctx.level.damageBarrel(id,dmg)；ctx.level.hitProp(id,dmg,point)；ctx.hud.hitMarker(headshot,killed)；ctx.hud.toast(text)；ctx.hud.damageIndicator(pos)。

## 状态快照（上下文切换点）
- 已完成并通过 tsc（仅剩"找不到尚未编写的模块"TS2307）：core/*、render/*、physics、level/NavGrid、level/LevelBuilder、fx/Fx、audio/AudioEngine、core/Context、player/Player、weapons/{Projectiles,WeaponDefs,WeaponModels,WeaponSystem}
- 下一个要写的文件：enemies/EnemyModels.ts（程序化敌人模型：Sentry 双足哨兵/Stalker 猎手/Juggernaut 重装/Wasp 无人机/OMEGA-01；返回 {root, parts(可动关节), eyeMat, dispose}），然后 Enemy.ts(FSM 基类) 等，按"下一步顺序"第 2 项继续。
- 尚未：index.html、main.ts、Game.ts、Hud、Menus、Level01、Entities、敌人全部、测试、README。
- enemies/EnemyModels.ts（已写）：EnemyType='sentry'|'stalker'|'juggernaut'|'wasp'|'boss'；buildEnemyRig(type,mats)→EnemyRig{root(脚底,朝+Z,前方=(sin yaw,0,cos yaw)),body,head,legs[],arms[],muzzle,extra[](jugg:[迫击炮]; boss:[左炮,右炮,核心上盖,核心下盖]),eyeMat,glowMat(每实例),height,radius,headY,dispose()}；几何体模块级缓存，disposeEnemyGeometry()。尺寸：sentry h1.9 r0.5；stalker h2.0 r0.42；jugg h2.9 r0.95（背部反应堆 z=-0.72 为弱点）；wasp（root 即机体中心，悬浮）；boss h5.6 r3.0 核心在 body(0,3.4,0)+head(0,0.5,1.5)。
- 下一个文件：enemies/Enemy.ts（FSM 基类）。
- enemies/Enemy.ts（已写）：abstract Enemy(ctx,type,stats,x,z,opts{yaw,patrol,alerted,encounter,warpIn})；状态 idle/patrol/alert/search/chase/attack/cover/reposition/stagger/dead；perceive(视野锥+LOS+近身)、hear(pos)、engage()、navigate/slide/tryMove/push、shootAt、applyHit(part,damage,point,dir,source)→HitResult、stun(dur)、kill()、update(dt)、dispose()；removed 标志；engaged getter。需要 ctx.level.playerHidden、ctx.hud.enemyAlerted()、ctx.enemies.takePathBudget()/alertAllies(e,r)/onDeath(e)/damageBarrelsNear(pos,r)。
- enemies/EnemyTypes.ts（已写）：Sentry / Stalker(掩体+激光瞄准) / Juggernaut(砸地+迫击炮, 正面装甲, 背部弱点) / Wasp。构造 (ctx,x,z,opts)。
- Fx.ring 新增第 8 个参数 marker=true（线性、渐亮，用于预警圈）。
- 下一个：enemies/Boss.ts → EnemyManager.ts。
- enemies/Boss.ts（已写）：Boss extends Enemy；mode: dormant/intro/idle/orbs/slam/summon/beam/transition/dying；phase 1..3（66%/33%）；activate()；coreOpen；fighting；deathDone（死亡演出结束 → 关卡触发胜利）。竞技场中心 = 生成位置。需要 ctx.hud.bossPhase(n)、ctx.hud.subtitle(speaker,text)、ctx.enemies.minionCount()/spawn。
- enemies/EnemyManager.ts（已写）：list、boss、spawn(type,x,z,opts)、takePathBudget()、applyHit(tag,damage,point,dir,source)、damageInRadius(point,r,dmg,source,excludeId)→[hits,kills]、alertNear、alertAllies、engageEncounter(name)、aliveCount(enc?)（不含 boss）、minionCount()、engagedCount()、onDeath(e)→ctx.level.onEnemyKilled(e)、killAll(enc?)、stunAll(dur)、damageBarrelsNear(pos,r)→ctx.level.damageBarrelsNear(pos,r,dmg)、update(dt)、clear()、dispose()。
- Level 需提供：playerHidden:boolean、onEnemyKilled(e)、damageBarrel(id,dmg)、damageBarrelsNear(pos,r,dmg)、hitProp(id,dmg,point)。
- Hud 需提供：damageIndicator(pos)、hitMarker(headshot,killed)、toast(text)、enemyAlerted()、bossPhase(n)、subtitle(speaker,text)。
- 下一个：level/Entities.ts + level/Level01.ts（先看 LevelBuilder 签名：grep -n "^  [a-z][A-Za-z]*(" src/level/LevelBuilder.ts）。

## LevelBuilder / GeoBatch / Gfx / Materials 签名速查（自动提取）
```
67:  constructor(public gfx: Gfx, public physics: Physics, public mats: MaterialLibrary, public nav: NavGrid) {
77:  beginZone(index: number): THREE.Group {
86:  endZone(): void {
91:  group(): THREE.Group {
103:  deco(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: BoxOpts = {}): void {
107:  collider(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, rotY = 0, nav?: boolean): RAPIER.Collider {
116:  solid(mat: THREE.Material, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, opts: SolidOpts = {}): void {
122:  block(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, opts: SolidOpts = {}): void {
126:  mesh(mat: THREE.Material, geo: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, cast = false, scale: number | [number, number, number] = 1): void {
130:  floor(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y = 0, nav = true): void {
136:  ceiling(mat: THREE.Material, x0: number, z0: number, x1: number, z1: number, y: number): void {
142:  wallX(mat: THREE.Material, z: number, x0: number, x1: number, y0: number, h: number, thick: number, openings: Opening[] = [], opts: SolidOpts = {}): void {
151:  wallZ(mat: THREE.Material, x: number, z0: number, z1: number, y0: number, h: number, thick: number, openings: Opening[] = [], opts: SolidOpts = {}): void {
174:  doorFrame(x: number, z: number, w: number, h: number, axis: 'x' | 'z', depth: number, glow: THREE.Material): void {
200:  ceilingLamp(x: number, y: number, z: number, color: number, intensity: number, distance: number, opts: { glow?: THREE.Material; shaft?: keyof LevelBuilder['shafts'] | null; size?: number; flicker?: number; shaftH?: number } = {}): void {
216:  strip(mat: THREE.Material, x: number, y: number, z: number, len: number, axis: 'x' | 'z', thick = 0.08): void {
222:  socket(x: number, y: number, z: number, color: number, intensity: number, distance: number, flicker = 0): void {
227:  pipe(mat: THREE.Material, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, r: number, cast = false): void {
247:  cylinder(mat: THREE.Material, x: number, y: number, z: number, r: number, h: number, opts: { collide?: boolean; cast?: boolean; segs?: number; rTop?: number } = {}): void {
257:  crate(x: number, z: number, size: number, mat?: THREE.Material, y = 0, rotY = 0, hScale = 1): void {
264:  crateCluster(x: number, z: number, layout: [number, number, number, number?][]): void {
272:  screen(tex: THREE.Texture, x: number, y: number, z: number, w: number, h: number, rotY: number, intensity = 1.5, tiltX = 0): THREE.Mesh {
286:  sign(tex: THREE.Texture, x: number, y: number, z: number, w: number, h: number, rotY: number, opacity = 0.85): void {
298:  rock(x: number, y: number, z: number, sx: number, sy: number, sz: number, seed: number, collide = true): void {
329:  railing(x0: number, z0: number, x1: number, z1: number, y: number): void {
347:  dispose(): void {
export interface BoxOpts {
  rotY?: number;
  /** 0 表示每个面 UV 0..1；否则为贴图铺设的世界尺寸（米） */
  tile?: number;
  castShadow?: boolean;
  /** 跳过的面：'+x' '-x' '+y' '-y' '+z' '-z' */
  skip?: string[];
}

const _m = new THREE.Matrix4();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _nm = new THREE.Matrix3();

export interface ZoneEnv {
  fogColor: number;
  fogDensity: number;
  hemiSky: number;
  hemiGround: number;
  hemiIntensity: number;
  sunColor: number;
  sunIntensity: number;
  /** 主光方向（从光源指向场景的反方向，即光源所在方向） */
  sunDir: [number, number, number];
  exposure: number;
  envIntensity: number;
}

const FinalShader = {
  name: 'EclipseFinal',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
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

27:  cyan: 0x35e0ff,
28:  cyanDeep: 0x0a8fb5,
29:  orange: 0xff8a2a,
30:  amber: 0xffb347,
31:  red: 0xff2d2d,
32:  redDeep: 0xb00c0c,
33:  white: 0xdcecff,
34:  green: 0x4dff9a,
35:  violet: 0x9a6bff,
36:  steel: 0x8a94a0,
83:  wall: THREE.MeshStandardMaterial;
84:  wallDark: THREE.MeshStandardMaterial;
85:  wallLab: THREE.MeshStandardMaterial;
86:  wallRust: THREE.MeshStandardMaterial;
87:  floor: THREE.MeshStandardMaterial;
88:  floorDark: THREE.MeshStandardMaterial;
89:  floorLab: THREE.MeshStandardMaterial;
90:  ceiling: THREE.MeshStandardMaterial;
91:  concrete: THREE.MeshStandardMaterial;
92:  rock: THREE.MeshStandardMaterial;
93:  ground: THREE.MeshStandardMaterial;
94:  hazard: THREE.MeshStandardMaterial;
95:  trim: THREE.MeshStandardMaterial;
97:  metalDark: THREE.MeshStandardMaterial;
98:  metalMid: THREE.MeshStandardMaterial;
99:  metalLight: THREE.MeshStandardMaterial;
100:  metalRed: THREE.MeshStandardMaterial;
101:  metalOrange: THREE.MeshStandardMaterial;
102:  metalBlue: THREE.MeshStandardMaterial;
103:  gunmetal: THREE.MeshStandardMaterial;
104:  polymer: THREE.MeshStandardMaterial;
105:  rubber: THREE.MeshStandardMaterial;
106:  crateOlive: THREE.MeshStandardMaterial;
107:  crateOrange: THREE.MeshStandardMaterial;
108:  crateBlue: THREE.MeshStandardMaterial;
109:  pipe: THREE.MeshStandardMaterial;
110:  pipeCopper: THREE.MeshStandardMaterial;
111:  grate: THREE.MeshStandardMaterial;
112:  glass: THREE.MeshStandardMaterial;
113:  glassTank: THREE.MeshStandardMaterial;
114:  chrome: THREE.MeshStandardMaterial;
116:  glowCyan: THREE.MeshBasicMaterial;
117:  glowCyanSoft: THREE.MeshBasicMaterial;
118:  glowOrange: THREE.MeshBasicMaterial;
119:  glowRed: THREE.MeshBasicMaterial;
120:  glowWhite: THREE.MeshBasicMaterial;
121:  glowWarm: THREE.MeshBasicMaterial;
122:  glowGreen: THREE.MeshBasicMaterial;
123:  glowViolet: THREE.MeshBasicMaterial;
125:  glowAlarm: THREE.MeshBasicMaterial;
126:  black: THREE.MeshBasicMaterial;
```
- level/Entities.ts（已写）：Door(ctx,x,z,w,h,axis('x'=开在沿X墙上),locked,parent,label)：open/locked/sealed、setLocked(b,silent)、seal()、distTo、update、dispose；Interactable{id,pos,radius,prompt,enabled,onUse}；Pickup(ctx,kind,x,y,z,parent,secret)：kind=health|armor|ammo_ar|ammo_viper|ammo|weapon_viper|weapon_helix|keycard，update(dt)→bool(已拾取)、ttl、taken、dispose；Barrel(ctx,id,x,z,parent,y)：damage(amount,delay)、update、dead、dispose（爆炸调用 ctx.explode(pos,5.5,110,'world')）；HoloTarget(ctx,id,x,y,z,parent)：hit(dmg)→bool、update、dead；disposeEntityGeometry()。需要 ctx.hud.pickupFlash(color)。
- 下一个：level/Level01.ts（导出 class Level）。
- level/LevelGeometry.ts（已写）：buildGeometry(ctx,b)→GeometryRefs{spinners,powerSockets,emergencySockets,powerMat,vents}；ARENA={x:0,z:-210,r:26,h:24}。8 个分区全部搭建（见 DESIGN.md 坐标）。
- level/Level01.ts（已写）：export Stage 常量(Landing..Victory=0..13)、ZONE_NAMES、class Level(ctx)：构造即搭建几何+门+nav.bake；start(cp) 重建动态实体/敌人并设置阶段；spawnPoint(cp)→{x,z,yaw}；update(dt)；字段 stage/zone/checkpoint/playerHidden/prompt/waypoint/defenseProgress/bossActive/completed/onCheckpoint/onVictory；damageBarrel/damageBarrelsNear/hitProp/onEnemyKilled/zoneAt(z)/interact(id)（测试钩子: 'gate'|'security'|'console'）/dispose()。
- Hud 还需提供：setObjective(title,detail,flash)、banner(title,sub)、zoneName(name)、hint(text)、pickupFlash(color)。
- 待办（视觉验证）：竞技场 24 段墙 rotY 方向、楼梯斜坡碰撞、控制室窗、枪模手部朝向、枪口火焰位置。
- 下一个：ui/Hud.ts + ui/Menus.ts + index.html + src/styles.css → core/Game.ts + main.ts。
- ui/Hud.ts、ui/Menus.ts、index.html、src/styles.css、core/Game.ts、main.ts 已写完；`npx tsc --noEmit` 全量通过（0 错误）。
- 测试钩子 window.__ECLIPSE__：ready/error/snapshot()/step(dt,n)/key(code,down)/mouse(dx,dy)/look(yaw,pitch)/aimAt(x,y,z)/teleport(x,z,yaw,y)/virtualLock(on)/god(on)/interact(id)/perf()；URL 加 ?test=1 → game.manual=true（主循环只渲染，step() 手动推进）。
- 下一步：启动 dev server → headless 冒烟测试（控制台错误）→ 截图检查画面 → 修复 → tests/e2e.mjs → README。

## 状态快照 2（运行验证阶段）
- dev server：shell id `dev`，`npm run dev -- --port 5173 --strictPort`（http://localhost:5173/）。已安装 fonts-noto-cjk（中文截图正常）。
- 测试脚本（headless Chrome + SwiftShader，playwright-core）：tests/lib.mjs（launch/snap/shot/frames/startNewGame/step）、tests/smoke.mjs、tests/explore.mjs [视角名…]（传送截图 → tests/out/view-*.png）、tests/play1.mjs（移动/跳跃/射击靶标/换弹/终端/进机库，全部通过）、tests/weapon.mjs（三把枪 hip/ads/fire 截图 → w-*.png）、tests/sheet.py <out> <cols> <names…>（拼图）。
- 已实测通过：初始化 0 报错（~5.5s）；主菜单；新游戏 → 简报 → 部署；行走 5.2m/s、冲刺、跳过 0.84m 路障、3 靶标、换弹、E 开闸门、进入机库后哨兵发现玩家并开火。
- 已修：resetWorld 先传送再 level.start；texSign 自动缩放；hint 位置；武器专用补光 gfx.weaponKey/weaponRim（layer 1）；WeaponModels 重写（WeaponMats 专用材质 + 双手 + 全息瞄具），buildWeaponView(id, wm)；枪口火焰/能量弹光晕缩小。
- 待查：新枪模截图（tests/out/wsheet.png）；竞技场偏暗（zone 7 hemi/exposure 可调高）；实验室略过曝。
- 待做：tests/e2e.mjs（完整通关流程：机库战斗→门禁卡→安全门→实验室→工业区→控制室坚守→Boss→胜利；死亡重试；暂停/设置）、README.md、npm run build 验证、browser_preview 预览、最终汇报（真实测试结果 + 已知限制）。尚未 git init/commit。
- 枪模第二版截图已确认可读（钢灰/橙/白陶瓷配色 + 双手），已缩小前臂发光条与 Viper 枪口火焰。下一步直接写 tests/e2e.mjs 跑完整流程。
- 已写 tests/bot.js（页面内自动游玩机器人：walkTo/goTo/fight/pressE/shootAt）与 tests/e2e.mjs（场景 A 完整通关 / B 暂停·设置·死亡重试·继续 / C 真实 Pointer Lock 与缩放；结果写 tests/out/e2e-results.json）。运行：`node tests/e2e.mjs 2>&1 | tee tests/out/e2e.log`（GOD=0 可关闭无敌）。尚未跑通，需要按失败项逐个修复。
- e2e 首跑结果（tests/out/e2e.log）：场景 A 绝大多数通过。失败项与原因：①冲刺/滑铲=测试路径被路障挡住（改为 teleport(11.5,56) 后再测）；②AI 状态采样太晚没看到 alert（改为从闸门外开始采样）；③隔墙测试被同伴 alertAllies 触发 engaged（只判 canSee，且敌人 yaw=0 面向玩家）；④HELIX 拾取不到（展台半径 0.9 + 玩家 0.35 = 拾取半径 1.25 → 真 bug，武器/门禁卡拾取半径改 2.0）；⑤Boss 900s 未击败 = 机器人没有 HELIX 且实弹打光（真风险：可能软锁 → 核心通道加保底 HELIX、Boss 战竞技场补给每 40s 重生、AR 弹药补给量上调）。机库首战哨兵伤害偏高（HP 76→12）→ 哨兵单发 8→6、散布加大。
- e2e 第二跑：玩家在"AI 观察"阶段站着挨打死亡导致后续全部级联失败（测试问题，已改为观察到 alert+attack 且掉血后立即还击）。真 bug 两个已修：①冲刺达不到 7.8（摩擦×速度 > 加速度）→ 冲刺加速度 96；②蹲下/滑铲瞬间胶囊悬空 → setHeight 后立即 body.setTranslation + world.propagateModifiedBodyPositionsToColliders()。需重跑 e2e 确认。
- 两处真 bug 修复已应用并通过 tsc（Player.setHeight 同步碰撞体；冲刺加速度 96）；e2e 的 AI 观察循环已改。注意：不要用 `pkill -f tests/e2e.mjs`（会杀掉自己的 shell）。下一步：重跑 `node tests/e2e.mjs > tests/out/e2e.log 2>&1`，用 `grep -E "FAIL|结果|exit" tests/out/e2e.log` 看结果，逐项修复；然后 README、npm run build、browser_preview、最终汇报。
- e2e 第三跑：62 PASS。场景 A（完整通关：机库→门禁卡→实验室→HELIX→工业区→坚守→Boss 三阶段→胜利结算）全部通过，仅剩"冲刺中 Ctrl 触发滑铲 — 速度 7.47"失败（需查：滑铲是否触发/速度是否被设为 10.5；可能 sprinting 在按下 Ctrl 的同一帧判断有问题，或测试里 step 3 帧后才读数）。场景 B 失败 2 项为测试写法问题："到达存档点后写入存档"——测试里直接改 g.level.stage=4 后立刻 e.interact('security')，但交互对象要等 level.update 一帧后才 enabled → 应在改 stage 后先 e.step(1/30,2) 再 interact；随后"继续任务"按钮禁用导致点击超时（级联）。场景 C 尚未跑到。
- 滑铲 bug 已修：滑铲分支用帧初 hSpeed 覆盖了 10.5 的起步速度 → 改为读取当前 vel。e2e 场景 B 的测试写法已修（改 stage 后先 step 3 帧再 interact）。tests/slide.mjs 为滑铲诊断脚本。需重跑 e2e（后台：`(nohup node tests/e2e.mjs > tests/out/e2e.log 2>&1; echo "exit $?" >> tests/out/e2e.log) &`，约 4~5 分钟），再看 `grep -E "FAIL|结果|exit" tests/out/e2e.log`。
- ✅ e2e 第四跑：76/76 通过（场景 A 完整通关 + B 暂停/设置/死亡重试/继续 + C 真实 Pointer Lock/缩放）。注意主流程在机库首战后开启了无敌（机器人不会躲避），汇报时必须如实说明；GOD=0 的全程无无敌跑法尚未验证。
- 剩余：README.md（安装/启动/功能清单/真实测试结果/已知限制）、`npm run build` 验证、查看 e2e 截图（tests/out/e2e-*.png）做最终画面检查、browser_preview(5173)、任务列表更新、最终中文汇报。可选：GOD=0 跑一次看机器人能走多远（平衡性参考）、竞技场调亮。
- ✅ `npm run build` 成功（仅有 chunk 体积警告，Rapier wasm 内联所致）。下一步：写 README.md → browser_preview(5173) → 最终汇报。
- 已向用户发送进度消息（76/76，说明了无敌前提）。README.md 尚未创建（下一步立即写）。e2e 截图在 tests/out/e2e-01..13-*.png（尚未逐张查看 08-boss/09/10-victory/11-pause/12-settings/13-dead）。
- ⚠️ 待查（重要）：e2e 截图中 胜利(e2e-10)/暂停(e2e-11)/设置(e2e-12)/死亡(e2e-13) 四张都没有显示出对话框内容（胜利=全暗、暂停=全黑、设置=只有模糊背景、死亡=只有灰度画面）。Boss 战截图(08/09)正常。可能原因：①截图时 CSS 入场动画（dlg/deadIn，from opacity:0）刚开始；②#fade 黑幕（z-index 8）或 .screen 的 z-index/背景问题；③manual 模式下某些状态不渲染。需要：在显示这些界面后 waitForTimeout(800) 再截图并查看；若仍不可见则检查 styles.css 的 .screen/.dialog/@keyframes dlg 与 Menus.show()。确认前不能声称这些界面"视觉上已验证"。
- tests/ui.mjs：暂停后等待 900ms，DOM 检查显示 #screen-pause .dialog 位于 (430,102) 420x516、opacity=1、display=flex、#fade opacity=0 → 对话框在 DOM 层面是可见的；截图 tests/out/ui-pause.png 尚未查看（下一步先 view_image 它；若可见则 e2e 截图问题只是入场动画时机，把 e2e 里这几处截图前加 waitForTimeout(900) 即可）。
- ✅ ui-pause.png 已查看：暂停菜单显示正常（等 900ms 后）。结论：e2e 中这几张截图只是入场动画时机问题 → 在 e2e-10/11/12/13 截图前加 `await page.waitForTimeout(900)` 后重跑并复查；然后写 README、browser_preview、最终汇报。
- e2e.mjs 已在 e2e-10/11/12/13 截图前加 waitForTimeout(900)（共 4 处），尚未重跑。
- e2e 第五跑：74/76，仅 HELIX 拾取（及依赖它的过热测试）失败，上一跑是通过的 → 不稳定（flaky）：机器人 goTo(16,-75.4) 后与展台(16,-77)的距离是否 <2.0 取决于寻路终点/被敌人推挤；需查 Pickup 半径 2.0 是否生效、或把测试改为 goTo 后再 walkTo(16,-75.6) 并 step 0.5s。其余全部通过。
- e2e 第 197 行已改为记录 goTo HELIX 的终点坐标（helixGo），重跑后看日志里 'HELIX goTo' 一行判断是寻路没到位还是拾取半径问题。
- e2e 第六跑：76/76 通过；HELIX goTo 终点 (15.77,-74.74)，距展台中心 2.27m > 拾取半径 2.0 时会失败（上一跑即此原因，属边界不稳定）→ 待修：把武器/门禁卡拾取半径从 2.0 提到 2.6（Entities.ts Pickup.radius），再重跑确认稳定。之后：README、browser_preview(5173)、最终汇报。
- 拾取半径已改为 2.6（未重跑 e2e 验证）。
- ✅ e2e 第七跑（拾取半径 2.6 后）：76/76 通过，exit 0。剩余：README.md、复查 e2e-10..13 截图、browser_preview(5173)、任务列表更新、最终汇报（如实说明无敌前提与 SwiftShader 性能限制）。
- ✅ e2e-10..13 截图已复查：胜利结算/暂停/设置/死亡界面均正常显示。下一步：README.md → git init+commit（本地）→ browser_preview(5173) → 最终汇报。
- README.md 已写（引用 docs/TESTING.md，尚未写）。GOD=0 的 e2e 正在后台跑 → tests/out/e2e-nogod.log（结果文件 e2e-results-nogod.json）。待：看 nogod 结果 → 写 docs/TESTING.md → git commit → browser_preview → 汇报。
- GOD=0 e2e 结果：机器人不开无敌打到工业大厅（HP 66，全程没捡血包），进入大厅 3.3s 内 HP 66→0 死亡。需诊断大厅遭遇战的瞬时伤害来源（Juggernaut 迫击炮/猎手磁轨？）并调平衡。
- 诊断（tests/hall.mjs）：大厅猝死原因=入口正中两只油桶 (-1,-116)/(0.2,-116.7) 被敌人流弹引爆，连锁 91 伤害/0.44s。已把这两只油桶移到重装机器人两侧 (-2.8,-132.4)/(2.9,-133)，油桶对玩家伤害系数 0.55→0.45。待重跑 hall.mjs 与 GOD=0 e2e。
- 油桶移位后 hall.mjs（HP66 起步、不躲避的机器人）：能清掉哨兵/猎手，最终死于重装的迫击炮+砸地（有预警、设计上需躲避）→ 视为合理，不再调。正在重跑默认 e2e 确认 76/76；随后写 docs/TESTING.md、git commit、browser_preview、汇报。
- docs/TESTING.md 已写。等待默认 e2e 重跑结果。
- ✅ 油桶改动后默认 e2e 76/76、build 成功。已 git add，待 commit → browser_preview(5173) → 汇报。

## 用户反馈 1（真机试玩）
- 用户报告：①某些特效有黑块；②开门后屏幕会被黑块遮挡。VM（SwiftShader）截图中未见。首要怀疑：着色器输出 NaN/负值经 Bloom 扩散成黑块（pow 负数、normalize(0)、除零），或 HalfFloat 渲染目标/粒子混合问题。排查 Gfx 最终合成 shader、Fx 粒子/光束 shader、门相关特效。
- 旁支发现：640x360 小窗口下简报界面的「开始空降」按钮超出视口（待修：.screen 内容加 max-height + overflow:auto）。tests/nan.mjs = HDR 缓冲 NaN/Inf 扫描器（结果 tests/out/nan.log）。
- ✅ 根因基本确认（tests/nan2.mjs）：MSAA 下光柱 shader 的 vUv.y 在机库视角有 482 个像素（640x360）外插为负值 → pow(负数,1.6) 在真实 GPU（ANGLE/D3D）上得 NaN → 加色混合写入 HDR 缓冲 → Bloom 多级模糊扩散成大黑块（开门看到机库光柱时出现）；曳光 shader 的 pow(a,2.0) 同理（特效黑块）。SwiftShader 的 pow 不产生 NaN 所以 VM 不复现。修复计划：①所有自定义 shader 的 pow/smoothstep 输入钳制（LevelBuilder 光柱、Fx 曳光、Gfx 最终合成、Sky 反向 smoothstep）；②Bloom 前加 Sanitize 通道（清 NaN/Inf/负值并限幅 64）；③用注入 NaN 的测试验证 Sanitize。
- 已改：光柱/曳光/天空/最终合成 shader 的 pow、反向 smoothstep 全部钳制；Gfx 新增 SanitizeShader + sanitizePass（位于 weaponPass 与 bloomPass 之间）。tests/nan2.mjs 向光柱注入 NaN：清洗关 → 整个 640x360 缓冲全部 NaN（复现了用户的整屏黑块）。注意 composer 交换：清洗开启时应扫描 composer.writeBuffer（两次 swap），正在重跑验证清洗是否生效。
- ✅ 清洗通道验证通过（tests/out/nan2.log）：注入 NaN/Inf/负值时，清洗关 = 全屏 691200 个 NaN 分量；清洗开 = 0。截图 nan-injected-off/on.png 待看。之后：重跑 e2e 回归 → build → commit → 回复用户（说明 VM 无 GPU 无法在真机复现，是通过注入复现+根因分析修的，请用户刷新预览确认）。
