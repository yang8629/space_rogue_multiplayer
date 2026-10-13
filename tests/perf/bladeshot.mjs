// 相位刃新終極升級的畫面截圖（2026-10-09）：格擋流（前方一直有敵彈飛過來讓刃片砍，左上小條）、灼燒處決（燒著、血很少的靶被斬殺）
//   用法：node perf/bladeshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
const start = (path, final) => p.evaluate((path, final) => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'blade');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.weapon = { id: 'blade', path, final }; Game.refreshWeapon(); Game.recalc();
  const P = Game.player; P.maxHp = P.hp = 1e6;
  Game.enemies = []; Game.combat.waveT = 1e9;
  Input.down = true; Input.keys.clear(); Input.mx = innerWidth / 2 + 200; Input.my = innerHeight / 2;
}, path, final);
// 1. 格擋流：每 0.1 秒從右邊飛來一顆敵彈
await start('B', 1);
await p.evaluate(() => { window.__eb = setInterval(() => { const P = Game.player; Game.eBullets.push({ x: P.x + 260, y: P.y + (Math.random() - 0.5) * 40, vx: -260, vy: 0, r: 5, life: 2, dmg: 0, from: 'shot' }); }, 100); });
await wait(1500);
await p.screenshot({ path: `${dir}/相刃_格擋流小條.png`, clip: { x: 0, y: 0, width: 760, height: 90 } });
console.log('格擋流', await p.evaluate(() => { clearInterval(window.__eb); return Game.player.parryK + ' 層'; }));
// 2. 灼燒處決：前方 3 隻燒著、剩 15% 血的刺殼
await start('C', 0);
await p.evaluate(() => {
  const P = Game.player;
  Game.enemies = [[70, -30], [80, 0], [70, 30]].map(([dx, dy]) => { const e = new Enemy('brute', P.x + dx, P.y + dy, 400); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.rollCd = 1e9; e.hp = e.maxHp * 0.15; e.burnT = 3; e.burnDps = 1; return e; });
});
await wait(250);
await p.screenshot({ path: `${dir}/相刃_灼燒處決.png` });
console.log('灼燒處決：剩', await p.evaluate(() => Game.enemies.filter(e => !e.dead).length), '隻');
await b.close();
