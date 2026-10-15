// 寶藏無人機截圖：出場（橫幅＋逃跑中）、特寫、打掉（金色爆炸＋橫幅）、戰鬥結束的三選一（保證稀有）
//   用法：node perf/treasureshot.mjs   → art_lab/screenshots/寶藏_出場.png、寶藏_特寫.png、寶藏_到手.png、寶藏_三選一.png
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
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 1, elites: 0, treasure: 1 });
  Game.combat.waveTimer = 1e9; Game.combat.wave = 1;
  const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9;
  Input.autoFire = false;
  Game.spawnEnemy('treasure');
  const e = Game.enemies[Game.enemies.length - 1];
  e.x = P.x + 220; e.y = P.y - 90; e.spawnT = 0.2;
  for (const [dx, dy] of [[-300, -160], [-360, 60], [320, 200]]) { const s = new Enemy('swarmer', P.x + dx, P.y + dy, 1); s.spawnT = 0; s.frozen = true; s.hx = s.x; s.hy = s.y; Game.enemies.push(s); }
  window.__tre = e;
});
await wait(900);
await p.screenshot({ path: SHOTS + '寶藏_出場.png' });
console.log('存好 寶藏_出場.png');
// 特寫：暫停一下，照無人機在畫面上的位置裁一塊
const at = await p.evaluate(() => { const e = window.__tre, c = Game.cam, k = innerWidth / ZW; Game.paused = true; return { x: (e.x - c.x) * k, y: (e.y - c.y) * k, hp: e.hp, dead: e.dead }; });
await p.screenshot({ path: SHOTS + '寶藏_特寫.png', clip: { x: Math.max(0, at.x - 80), y: Math.max(0, at.y - 80), width: 160, height: 160 } });
console.log('存好 寶藏_特寫.png', JSON.stringify(at));
await p.evaluate(() => { Game.paused = false; const e = window.__tre; e.hurt(1e9, 0, 0, 'direct', null); });
await wait(180);
await p.screenshot({ path: SHOTS + '寶藏_到手.png' });
console.log('存好 寶藏_到手.png');
await p.evaluate(() => { for (const e of Game.enemies) e.dead = true; });
await wait(5000);
const st = await p.evaluate(() => ({ state: Game.state, note: Game.reward && Game.reward.note, rare: Game.reward && Game.reward.options.filter(rareOf) }));
await p.screenshot({ path: SHOTS + '寶藏_三選一.png' });
console.log('存好 寶藏_三選一.png', JSON.stringify(st));
await b.close();
