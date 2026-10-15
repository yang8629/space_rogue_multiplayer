// 戰鬥中的變化截圖：蟲潮（橫幅、成群湧過來）、精英亂入（橫幅＋精英血條）、寶藏無人機快逃走（閃）
//   用法：node perf/waveeventshot.mjs   → art_lab/screenshots/蟲潮_橫幅.png、蟲潮_湧過來.png、精英亂入.png、寶藏_快逃走.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2000));
const wait = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (await p.evaluate(fn)) return true; await wait(50); } return false; };
const start = cfg => p.evaluate(cfg => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat(cfg);
  const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9;
  Input.autoFire = false;
}, cfg);

// 蟲潮
await start({ level: 3, wavesTotal: 3, elites: 0, swarm: 1 });
await until(() => Game.combat.wave === 1 && Game.enemies.length > 12);
await wait(300);
await p.screenshot({ path: SHOTS + '蟲潮_橫幅.png' });
await wait(2200);
await p.screenshot({ path: SHOTS + '蟲潮_湧過來.png' });
console.log('存好 蟲潮', await p.evaluate(() => `${Game.enemies.length} 隻、血量 ${Math.round(Game.enemies[0].maxHp)}`));

// 精英亂入：第 1 區出場完 → 殺掉一大半 → 精英闖進來
await start({ level: 3, wavesTotal: 3, elites: 0, intrude: 1 });
await until(() => Game.combat.wave === 1 && !Game.combat.pending.length);
await p.evaluate(() => { const E = Game.enemies; for (let i = 0; i < E.length * 0.7; i++) E[i].dead = true; });
if (!await until(() => Game.enemies.some(e => e.intruder))) console.log('精英沒有闖進來');
await wait(1300);
await p.screenshot({ path: SHOTS + '精英亂入.png' });
console.log('存好 精英亂入', await p.evaluate(() => { const e = Game.enemies.find(e => e.intruder); return `${eliteName(e)}、離玩家 ${Math.round(Math.hypot(e.x - Game.player.x, e.y - Game.player.y))}`; }));

// 寶藏快逃走：剩 2 秒
await start({ level: 1, wavesTotal: 1, elites: 0, treasure: 1 });
await p.evaluate(() => {
  const C = Game.combat, P = Game.player; C.waveTimer = 1e9; C.wave = 1;
  Game.spawnEnemy('treasure');
  const e = Game.enemies[Game.enemies.length - 1]; e.x = P.x + 220; e.y = P.y - 90; e.spawnT = 0; e.age = CFG.TREASURE.life - 2.2;
});
await wait(400);
await p.screenshot({ path: SHOTS + '寶藏_快逃走.png' });
console.log('存好 寶藏_快逃走');
await b.close();
