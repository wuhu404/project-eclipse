// PROJECT ECLIPSE 端到端测试：在 headless Chrome 中用脚本化输入实际游玩整个第一关。
// 用法：先启动 `npm run dev`（或 `npm run preview`，并设置 ECLIPSE_URL），再运行 `npm run test:e2e`。
// 环境变量：GOD=0 关闭无敌（默认主流程在机库战斗之后开启无敌，因为机器人不会躲避攻击）。
import fs from 'node:fs';
import { frames, launch, OUT, shot, snap, startNewGame, step } from './lib.mjs';

const GOD = process.env.GOD !== '0';
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? '  PASS' : '  FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
};
const botSrc = fs.readFileSync(new URL('./bot.js', import.meta.url), 'utf8');

// =====================================================================================
// 场景 A：完整通关流程
// =====================================================================================
console.log('\n[A] 完整通关流程');
let { browser, page, errors } = await launch();
const B = (fn, arg) => page.evaluate(fn, arg);
const info = async (label) => console.log(`    · ${label}: ` + (await B(() => window.__BOT__.info())));

let s = await snap(page);
check('启动后进入主菜单', s.state === 'menu' && s.screen === 'main');
check('无存档时"继续任务"不可用', await page.$eval('#btn-continue', (b) => b.disabled));
await shot(page, 'e2e-01-menu');
await page.click('#btn-new');
s = await snap(page);
check('点击"开始新任务"显示任务简报', s.state === 'briefing' && s.screen === 'briefing');
await page.waitForTimeout(600);
await shot(page, 'e2e-02-briefing');
await page.click('#btn-brief-back');
await startNewGame(page);
await page.evaluate(botSrc);
s = await snap(page);
check('部署后进入游戏（playing）', s.state === 'playing' && s.zone === 0 && s.player.alive);

// ---- 移动 / 跳跃 / 蹲伏 / 滑铲 ----
await step(page, 0.5);
await B(() => { window.__ECLIPSE__.teleport(11.5, 56, 0); window.__ECLIPSE__.step(1 / 60, 20); });
const z0 = (await snap(page)).player.z;
await B(() => window.__ECLIPSE__.key('KeyW', true));
await step(page, 1.5);
s = await snap(page);
check('W 前进（约 5.2 m/s）', z0 - s.player.z > 5 && Math.abs(s.player.speed - 5.2) < 0.4, `速度 ${s.player.speed.toFixed(2)} m/s`);
await B(() => window.__ECLIPSE__.key('ShiftLeft', true));
await step(page, 0.6);
s = await snap(page);
check('Shift 冲刺（约 7.8 m/s）', s.player.sprinting && s.player.speed > 7.2, `速度 ${s.player.speed.toFixed(2)} m/s`);
await B(() => { const e = window.__ECLIPSE__; e.key('ControlLeft', true); e.step(1 / 60, 3); });
s = await snap(page);
check('冲刺中 Ctrl 触发滑铲', s.player.sliding && s.player.speed > 8, `sliding=${s.player.sliding} crouching=${s.player.crouching} grounded=${s.player.grounded} 速度 ${s.player.speed.toFixed(2)} m/s`);
await B(() => { const e = window.__ECLIPSE__; e.key('ControlLeft', false); e.key('ShiftLeft', false); e.key('KeyW', false); e.step(1 / 60, 60); });
await B(() => { const e = window.__ECLIPSE__; e.teleport(10, 52, 0); e.step(1 / 60, 20); e.key('ControlLeft', true); e.step(1 / 60, 20); });
s = await snap(page);
check('Ctrl 蹲伏', s.player.crouching && !s.player.sliding);
await B(() => { const e = window.__ECLIPSE__; e.key('ControlLeft', false); e.step(1 / 60, 20); e.key('Space', true); e.step(1 / 60, 1); e.key('Space', false); });
let maxY = 0;
for (let i = 0; i < 12; i++) {
  await step(page, 0.05);
  maxY = Math.max(maxY, (await snap(page)).player.y);
}
await step(page, 0.6);
s = await snap(page);
check('Space 跳跃并落地', maxY > 0.9 && s.player.grounded && s.player.y < 0.1, `最高 ${maxY.toFixed(2)} m`);
// 碰撞：朝岩石/边界走不会穿出场地
await B(() => { const e = window.__ECLIPSE__; e.teleport(24, 40, -Math.PI / 2); e.key('KeyW', true); e.step(1 / 60, 180); e.key('KeyW', false); });
s = await snap(page);
check('碰撞：无法走出场地边界', s.player.x < 26.6, `x=${s.player.x.toFixed(2)}`);

// ---- 射击 / 命中 / 换弹 ----
await B(() => { const e = window.__ECLIPSE__; e.teleport(0, 33, 0); e.step(1 / 60, 30); });
s = await snap(page);
check('到达靶场后目标更新', s.stage === 1, s.objective);
const before = (await snap(page)).stats;
await B(() => { const b = window.__BOT__; b.shootAt(-7, 1.7, 18.5, 0.5); b.shootAt(-10, 2.4, 24, 0.5); b.shootAt(8, 1.6, 19.5, 0.5); });
s = await snap(page);
check('左键射击消耗弹药', s.stats.shotsFired - before.shotsFired >= 12 && s.weapon.mag < 30, `弹匣 ${s.weapon.mag}/30`);
check('射线命中靶标并推进任务', s.stats.shotsHit - before.shotsHit >= 6 && s.stage === 2, s.objective);
await B(() => { const e = window.__ECLIPSE__; e.key('KeyR', true); e.step(1 / 60, 2); e.key('KeyR', false); });
const reloading = (await snap(page)).weapon.reloading;
await step(page, 2.2);
s = await snap(page);
check('R 换弹（弹匣回满，备弹减少）', reloading && s.weapon.mag === 30 && s.weapon.reserve < 150, `${s.weapon.mag}/${s.weapon.reserve}`);
// ADS
await B(() => { const e = window.__ECLIPSE__; e.key('Mouse2', true); e.step(1 / 60, 30); });
s = await snap(page);
check('右键开镜（ADS）', s.weapon.ads > 0.95);
await frames(page, 2);
await shot(page, 'e2e-03-ads');
await B(() => { const e = window.__ECLIPSE__; e.key('Mouse2', false); e.step(1 / 60, 20); });

// ---- 交互：闸门终端 ----
await B(() => { const b = window.__BOT__; b.goTo(5.2, 14.4); window.__ECLIPSE__.aimAt(5.2, 1.3, 13.1); window.__ECLIPSE__.step(1 / 30, 3); });
s = await snap(page);
check('靠近终端显示交互提示', s.prompt === '开启机库闸门', String(s.prompt));
await B(() => window.__BOT__.pressE());
s = await snap(page);
check('E 交互开启闸门', s.stage === 3, s.objective);

// ---- 机库战斗（不开无敌：验证敌人 AI 与受伤） ----
const hp0 = (await snap(page)).player.hp;
// 观察 AI：玩家走进机库，敌人应从巡逻转入警觉，再进入追击/攻击
const seen = await B(() => {
  const e = window.__ECLIPSE__;
  const states = new Set();
  e.teleport(0, 14, 0);
  e.look(0, 0);
  e.key('KeyW', true);
  const hp = e.game.player.health;
  for (let i = 0; i < 330; i++) {
    if (i === 150) e.key('KeyW', false);
    e.step(1 / 30, 1);
    for (const en of e.game.enemies.list) if (en.alive && en.encounter === 'hangar') states.add(en.state);
    const p = e.game.player;
    // 观察到完整的状态转换并且已经被打中，或生命过低时停止观察、开始还击
    if ((states.has('alert') && states.has('attack') && p.health < hp) || p.health < 50) break;
  }
  e.key('KeyW', false);
  return [...states];
});
await frames(page, 2);
await shot(page, 'e2e-04-hangar');
check('敌人 AI：巡逻 → 警觉 → 追击/攻击 状态转换', seen.includes('alert') && (seen.includes('chase') || seen.includes('attack')), seen.join(','));
s = await snap(page);
check('敌人攻击能对玩家造成伤害', s.player.hp < hp0 || s.stats.damageTaken > 0, `HP ${Math.round(hp0)} → ${Math.round(s.player.hp)}`);
// 敌人不能隔墙发现玩家：实验室敌人尚未生成；用机库北侧哨兵与墙外玩家验证
const wallCheck = await B(() => {
  const e = window.__ECLIPSE__;
  const g = e.game;
  const en = g.enemies.spawn('sentry', 10, -45.5, { yaw: 0, encounter: 'walltest' });
  e.god(true);
  e.teleport(10, -38, 0);
  let saw = false;
  const dmg0 = g.stats.damageTaken;
  for (let i = 0; i < 90; i++) { e.step(1 / 30, 1); if (en.canSee) saw = true; }
  en.kill();
  e.god(false);
  return saw;
});
check('敌人无法隔墙看到玩家（墙后 7.5m、正对玩家）', wallCheck === false);
await B((god) => { window.__ECLIPSE__.god(god); }, false);
const tFight = await B(() => window.__BOT__.fight(() => window.__BOT__.alive('hangar') === 0, 90, (e) => e.encounter === 'hangar'));
s = await snap(page);
check('射击可击杀敌人（机库巡逻队）', s.stats.kills >= 3 && s.state === 'playing', `击杀 ${s.stats.kills}，用时 ${tFight.toFixed(1)}s，HP ${Math.round(s.player.hp)}`);
await info('机库清场后');
if (GOD) await B(() => window.__ECLIPSE__.god(true));

// ---- 门禁卡：楼梯 → 高架走道 → 控制室 ----
await B(() => { const b = window.__BOT__; b.goTo(20.5, 4.5, 30); b.walkTo(20.5, -7.5, 12); });
s = await snap(page);
check('斜坡楼梯可以走上高架走道', s.player.y > 4.0, `y=${s.player.y.toFixed(2)}`);
await B(() => { const b = window.__BOT__; b.walkTo(19.5, -30, 12); b.walkTo(19.5, -33.5, 6); b.walkTo(16.6, -34.6, 6, 0.9); b.walkTo(19.5, -35, 6); b.walkTo(20.5, -37.4, 6, 0.6); window.__ECLIPSE__.step(1 / 30, 10); });
s = await snap(page);
check('拾取 VIPER 霰弹枪', s.weapon.owned.includes('viper'));
check('拾取门禁卡', s.player.keycard && s.stage === 4, s.objective);
check('拿到门禁卡触发伏击增援', s.enemies.filter((e) => e.alive && e.encounter === 'hangar').length === 3);
await frames(page, 2);
await shot(page, 'e2e-05-control-room');
// 武器切换
await B(() => { const e = window.__ECLIPSE__; e.key('Digit2', true); e.step(1 / 30, 2); e.key('Digit2', false); e.step(1 / 30, 20); });
s = await snap(page);
check('数字键切换武器（2 → VIPER）', s.weapon.id === 'viper' && s.weapon.mag === 6);
await B(() => { const e = window.__ECLIPSE__; e.key('Digit1', true); e.step(1 / 30, 2); e.key('Digit1', false); e.step(1 / 30, 20); });
check('数字键切换武器（1 → AR-9）', (await snap(page)).weapon.id === 'ar9');
await B(() => { const b = window.__BOT__; b.walkTo(19.5, -33.5, 6); b.walkTo(19.5, -8, 14); b.walkTo(20.5, -5.5, 5); b.walkTo(20.5, 3.6, 10); });
await B(() => window.__BOT__.fight(() => window.__BOT__.alive('hangar') === 0, 90, (e) => e.encounter === 'hangar'));
s = await snap(page);
check('击退伏击增援', s.enemies.filter((e) => e.alive && e.encounter === 'hangar').length === 0 && s.state === 'playing');
// 没有门禁卡时门不能开已由阶段保证；这里验证刷卡开门
await B(() => { const b = window.__BOT__; b.goTo(2.9, -37.9, 40); window.__ECLIPSE__.aimAt(2.9, 1.3, -39.3); window.__ECLIPSE__.step(1 / 30, 3); b.pressE(); });
s = await snap(page);
check('使用门禁卡开启安全门', s.stage === 5, s.objective);
await info('安全门开启');

// ---- 安检通道（存档点 1）→ 实验室 ----
await B(() => window.__BOT__.goTo(0, -46, 30));
s = await snap(page);
const save1 = await B(() => JSON.parse(localStorage.getItem('project-eclipse.save.v1') || 'null'));
check('安全门自动开启，存档点 1 已保存（localStorage）', s.checkpoint === 1 && save1 && save1.checkpoint === 1);
await B(() => window.__BOT__.goTo(0, -60, 30));
s = await snap(page);
check('进入研究实验室', s.zone === 3 && s.stage === 6, s.objective);
const stalkerStates = await B(() => {
  const b = window.__BOT__;
  const g = window.__ECLIPSE__.game;
  const states = new Set();
  const t = b.fight(() => {
    for (const e of g.enemies.list) if (e.alive && e.type === 'stalker') states.add(e.state);
    return g.level.stage >= 7;
  }, 240, (e) => e.encounter === 'lab');
  return { t, states: [...states] };
});
s = await snap(page);
check('肃清实验室（含增援波）→ 北门解锁', s.stage === 7, `用时 ${stalkerStates.t.toFixed(1)}s`);
check('猎手 AI 使用掩体/重新定位', stalkerStates.states.includes('cover') || stalkerStates.states.includes('reposition'), stalkerStates.states.join(','));
const helixGo = await B(() => { const b = window.__BOT__; const ok = b.goTo(16, -75.4, 60, 0.7); const p = window.__ECLIPSE__.game.player.pos; return { ok, x: p.x, z: p.z }; });
console.log("    · HELIX goTo", JSON.stringify(helixGo));
await step(page, 0.3);
s = await snap(page);
check('拾取 HELIX 能量步枪', s.weapon.owned.includes('helix'));
// HELIX 热量 / 过热
const heat = await B(() => {
  const e = window.__ECLIPSE__;
  e.key('Digit3', true); e.step(1 / 30, 2); e.key('Digit3', false); e.step(1 / 30, 20);
  e.look(Math.PI, 0.3);
  e.key('Mouse0', true);
  let max = 0; let over = false;
  for (let i = 0; i < 120; i++) { e.step(1 / 30, 1); max = Math.max(max, e.game.weapons.heat01); over = over || e.game.weapons.overheated; }
  e.key('Mouse0', false);
  e.step(1 / 30, 100);
  return { id: e.game.weapons.current, max, over, after: e.game.weapons.heat01 };
});
check('HELIX：连续射击积累热量并过热，随后冷却', heat.id === 'helix' && heat.max >= 0.99 && heat.over && heat.after < 0.2, `最高 ${(heat.max * 100).toFixed(0)}% → ${(heat.after * 100).toFixed(0)}%`);
await info('实验室清场后');

// ---- 工业区 ----
await B(() => window.__BOT__.goTo(0, -101.5, 40));
check('存档点 2 已保存', (await snap(page)).checkpoint === 2);
await B(() => window.__BOT__.goTo(0, -113, 20));
s = await snap(page);
check('进入机械大厅触发遭遇战', s.stage === 8 && s.enemies.some((e) => e.type === 'juggernaut' && e.alive));
await frames(page, 2);
await shot(page, 'e2e-06-hall');
const tHall = await B(() => window.__BOT__.fight(() => window.__ECLIPSE__.game.level.stage >= 9, 300, (e) => e.encounter === 'hall'));
s = await snap(page);
check('击毁重型机器人并肃清大厅（含无人机波）', s.stage === 9, `用时 ${tHall.toFixed(1)}s`);
await info('大厅清场后');

// ---- 能源控制室：激活控制台 + 坚守 ----
await B(() => window.__BOT__.goTo(0, -146.5, 40));
check('存档点 3 已保存', (await snap(page)).checkpoint === 3);
await B(() => { const b = window.__BOT__; b.goTo(0, -150.6, 20, 0.5); window.__ECLIPSE__.aimAt(0, 1.3, -152.2); window.__ECLIPSE__.step(1 / 30, 3); });
s = await snap(page);
check('控制台交互提示', s.prompt === '激活能源控制台', String(s.prompt));
await B(() => window.__BOT__.pressE());
s = await snap(page);
check('激活能源控制台 → 开始坚守', s.stage === 10);
const tDef = await B(() => window.__BOT__.fight(() => window.__ECLIPSE__.game.level.stage >= 11, 90, (e) => e.encounter === 'defense'));
s = await snap(page);
check('坚守 60 秒后能源恢复，EMP 清场，核心门解锁', s.stage === 11 && s.enemies.filter((e) => e.alive && e.encounter === 'defense').length === 0, `用时 ${tDef.toFixed(1)}s`);
await frames(page, 2);
await shot(page, 'e2e-07-power');
await info('能源恢复后');

// ---- 核心通道 → Boss ----
await B(() => window.__BOT__.goTo(0, -172, 40));
check('存档点 4 已保存', (await snap(page)).checkpoint === 4);
await B(() => { const b = window.__BOT__; b.goTo(0, -181, 20); b.walkTo(0, -191, 12); });
await step(page, 4);
s = await snap(page);
check('进入中央核心触发 Boss 战（OMEGA-01 启动，入口封闭）', s.stage === 12 && s.boss && s.boss.mode !== 'dormant');
await frames(page, 2);
await shot(page, 'e2e-08-boss');
const bossRun = await B(() => {
  const b = window.__BOT__;
  const g = window.__ECLIPSE__.game;
  const boss = g.enemies.boss;
  const modes = new Set();
  const phases = new Set();
  let minions = 0;
  const t = b.fight(() => {
    modes.add(boss.mode);
    phases.add(boss.phase);
    minions = Math.max(minions, g.enemies.minionCount());
    return !boss.alive;
  }, 900);
  return { t, modes: [...modes], phases: [...phases], minions, hp: boss.hp };
});
check('Boss 使用了追踪能量球 / 地面冲击 / 召唤三种攻击', ['orbs', 'slam', 'summon'].every((m) => bossRun.modes.includes(m)), bossRun.modes.join(','));
check('Boss 二阶段解锁扫射光束', bossRun.modes.includes('beam'));
check('Boss 经历三个阶段', [1, 2, 3].every((p) => bossRun.phases.includes(p)), bossRun.phases.join(','));
check('Boss 召唤了小型防御机器人', bossRun.minions > 0, `同时存在最多 ${bossRun.minions}`);
check('OMEGA-01 可以被击败', bossRun.hp <= 0, `战斗用时 ${bossRun.t.toFixed(1)}s`);
await frames(page, 2);
await shot(page, 'e2e-09-boss-dying');
await step(page, 12, 1 / 30);
await page.waitForTimeout(300);
s = await snap(page);
check('击败 Boss 后触发胜利结算界面', s.state === 'victory' && s.screen === 'victory', `总用时 ${s.stats.time.toFixed(0)}s，击杀 ${s.stats.kills}`);
await page.waitForTimeout(900);
await shot(page, 'e2e-10-victory');
check('通关后清除存档', (await B(() => localStorage.getItem('project-eclipse.save.v1'))) === null);
await page.click('#btn-victory-quit');
s = await snap(page);
check('胜利界面"返回主菜单"可用', s.state === 'menu' && s.screen === 'main');
check('全流程无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();

// =====================================================================================
// 场景 B：暂停 / 设置 / 死亡重试 / 继续游戏
// =====================================================================================
console.log('\n[B] 暂停 / 设置 / 死亡与重试 / 继续游戏');
({ browser, page, errors } = await launch());
await startNewGame(page);
await page.evaluate(botSrc);
await step(page, 0.5);
await page.keyboard.press('Escape');
s = await snap(page);
check('Esc 暂停', s.state === 'paused' && s.screen === 'pause');
const tPause = s.time;
await page.waitForTimeout(400);
check('暂停时游戏时间不流逝', (await snap(page)).time === tPause);
await page.waitForTimeout(900);
await shot(page, 'e2e-11-pause');
await page.click('#btn-pause-settings');
check('暂停菜单可打开设置', (await snap(page)).screen === 'settings');
await page.$eval('#s-fov', (el) => { el.value = '100'; el.dispatchEvent(new Event('input', { bubbles: true })); });
await page.selectOption('#s-difficulty', 'easy');
await page.$eval('#s-invertY', (el) => el.click());
const st = await page.evaluate(() => ({ ...window.__ECLIPSE__.game.settings.data, stored: JSON.parse(localStorage.getItem('project-eclipse.settings.v1')), tuning: window.__ECLIPSE__.game.tuning.enemyDamage }));
check('设置生效并写入 localStorage（FOV/难度/反转 Y）', st.fov === 100 && st.difficulty === 'easy' && st.invertY === true && st.stored.fov === 100 && st.tuning === 0.6);
await page.waitForTimeout(900);
await shot(page, 'e2e-12-settings');
await page.click('#btn-reset-settings');
check('"恢复默认"可用', (await page.evaluate(() => window.__ECLIPSE__.game.settings.data.fov)) === 90);
await page.click('#screen-settings [data-back]');
check('设置返回暂停菜单', (await snap(page)).screen === 'pause');
await page.click('#btn-resume');
await page.waitForTimeout(100);
s = await snap(page);
check('"继续"恢复游戏', s.state === 'playing' && s.screen === null);

// 死亡 → 重试
await B(() => { const e = window.__ECLIPSE__; e.interact('gate'); });
await B(() => {
  const e = window.__ECLIPSE__;
  const g = e.game;
  g.level.stage = 3;
  e.teleport(2, -4, 0);
  g.player.health = 12;
  for (let i = 0; i < 600 && g.state === 'playing'; i++) e.step(1 / 30, 1);
});
s = await snap(page);
check('生命归零后进入死亡状态', s.state === 'dead' && !s.player.alive, `HP ${s.player.hp}`);
await step(page, 3, 1 / 30);
await page.waitForTimeout(200);
s = await snap(page);
check('显示死亡界面', s.screen === 'dead');
await page.waitForTimeout(900);
await shot(page, 'e2e-13-dead');
await page.click('#btn-retry');
await page.waitForTimeout(200);
s = await snap(page);
check('"重试"后重生：生命恢复、状态重置、死亡计数 +1', s.state === 'playing' && s.player.alive && s.player.hp >= 70 && s.stats.deaths === 1 && s.stage === 0 && s.enemies.filter((e) => e.alive).length === 3, `HP ${s.player.hp} 阶段 ${s.stage}`);

// 继续游戏（从存档点恢复）
await page.evaluate(() => {
  const e = window.__ECLIPSE__;
  const g = e.game;
  g.weapons.give('viper', false);
  g.player.hasKeycard = true;
  e.interact('gate');
  g.level.stage = 4;
  e.step(1 / 30, 3);
  e.interact('security');
  e.teleport(0, -45, 0);
  e.step(1 / 30, 5);
});
s = await snap(page);
check('到达存档点后写入存档', s.checkpoint === 1);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => window.__ECLIPSE__ && window.__ECLIPSE__.ready, null, { timeout: 180000 });
check('重新加载后"继续任务"可用', !(await page.$eval('#btn-continue', (b) => b.disabled)), await page.$eval('#continue-info', (e) => e.textContent));
await page.evaluate(() => window.__ECLIPSE__.virtualLock(true));
await page.click('#btn-continue');
await page.waitForTimeout(200);
s = await snap(page);
check('"继续任务"从存档点恢复（位置/武器/门禁卡/阶段）', s.state === 'playing' && s.checkpoint === 1 && Math.abs(s.player.z + 45) < 1 && s.weapon.owned.includes('viper') && s.player.keycard && s.stage === 5, `z=${s.player.z.toFixed(1)} 阶段 ${s.stage}`);
await page.keyboard.press('Escape');
await page.click('#btn-quit');
s = await snap(page);
check('暂停菜单"返回主菜单"可用', s.state === 'menu' && s.screen === 'main');
await page.click('#btn-controls');
check('主菜单"操作说明"可用', (await snap(page)).screen === 'controls');
await page.keyboard.press('Escape');
check('Esc 关闭子界面', (await snap(page)).screen === 'main');
check('场景 B 无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();

// =====================================================================================
// 场景 C：真实 Pointer Lock（非测试模式，真实点击）
// =====================================================================================
console.log('\n[C] 真实 Pointer Lock 与窗口缩放');
({ browser, page, errors } = await launch({ query: '' }));
await page.click('#btn-new');
await page.click('#btn-deploy');
await page.waitForTimeout(1500);
const lock = await page.evaluate(() => ({ locked: document.pointerLockElement === document.getElementById('game-canvas'), state: window.__ECLIPSE__.game.state }));
check('点击部署后鼠标被锁定（Pointer Lock）', lock.locked && lock.state === 'playing', JSON.stringify(lock));
if (lock.locked) {
  await page.mouse.move(700, 380);
  await page.mouse.move(820, 380, { steps: 6 });
  await page.waitForTimeout(600);
  const yaw = await page.evaluate(() => window.__ECLIPSE__.game.player.yaw);
  check('锁定状态下鼠标移动转动视角', Math.abs(yaw) > 0.01, `yaw=${yaw.toFixed(3)}`);
  await page.evaluate(() => document.exitPointerLock());
  await page.waitForTimeout(500);
  s = await snap(page);
  check('指针锁定丢失后自动暂停', s.state === 'paused' && s.screen === 'pause');
  await page.waitForTimeout(1200);
  await page.click('#btn-resume');
  await page.waitForTimeout(800);
  const relock = await page.evaluate(() => ({ locked: document.pointerLockElement === document.getElementById('game-canvas'), state: window.__ECLIPSE__.game.state }));
  check('点击"继续"后重新锁定并恢复游戏', relock.locked && relock.state === 'playing', JSON.stringify(relock));
}
await page.setViewportSize({ width: 900, height: 600 });
await page.waitForTimeout(600);
const size = await page.evaluate(() => { const c = document.getElementById('game-canvas'); const g = window.__ECLIPSE__.game; return { cw: c.clientWidth, ch: c.clientHeight, aspect: g.gfx.camera.aspect }; });
check('窗口缩放后画布与相机宽高比同步', size.cw === 900 && size.ch === 600 && Math.abs(size.aspect - 1.5) < 0.01, JSON.stringify(size));
const perf = await page.evaluate(() => window.__ECLIPSE__.perf());
console.log(`    · 本机（SwiftShader 软件渲染，无 GPU）帧时间 ≈ ${perf.avgMs.toFixed(0)} ms —— 不代表真实硬件性能`);
check('场景 C 无控制台错误', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 300));
await browser.close();

// =====================================================================================
const failed = results.filter((r) => !r.ok);
console.log(`\n结果：${results.length - failed.length}/${results.length} 通过` + (GOD ? '（主流程在机库首战之后开启了无敌）' : '（全程未开启无敌）'));
fs.writeFileSync(OUT + (GOD ? 'e2e-results.json' : 'e2e-results-nogod.json'), JSON.stringify({ god: GOD, results }, null, 2));
if (failed.length) {
  console.log('失败项：\n' + failed.map((f) => '  - ' + f.name + (f.detail ? ' — ' + f.detail : '')).join('\n'));
  process.exit(1);
}
