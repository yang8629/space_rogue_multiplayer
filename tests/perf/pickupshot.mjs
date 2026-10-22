// 晶體（錢）跟分裂體、碎裂體擺在一起截圖：看分不分得出來（2026-10-19 使用者「錢跟分裂體看起來太像」）
//   用法：node perf/pickupshot.mjs   → art_lab/screenshots/晶體與分裂體.png（＋放大的 _放大.png）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2000));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  const P = Game.player; P.hp = P.maxHp = 1e9; P.iframe = 1e9; Input.autoFire = false;
  P.x = Arena.start.x; P.y = Arena.start.y;
  Game.combat.pending = []; Game.enemies = [];
  const put = (type, dx, dy) => { const e = new Enemy(type, P.x + dx, P.y + dy, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; Game.enemies.push(e); return e; };
  put('splitter', -160, -140); for (const [dx, dy] of [[-60, -170], [-30, -120], [-90, -100]]) put('splitling', dx, dy);
  window.__hold = setInterval(() => {
    P.x = Arena.start.x; P.y = Arena.start.y;
    Game.pickups = [[60, -150], [90, -130], [75, -110], [120, -160], [-120, -60], [-40, -60], [30, -60], [150, -90]].map(([dx, dy], i) => ({ id: 900 + i, x: P.x + dx, y: P.y + dy, vx: 0, vy: 0, life: 14 }));
  }, 16);
});
await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: SHOTS + '晶體與分裂體.png' });
await p.setViewport({ width: 1280, height: 720, deviceScaleFactor: 3 }); await new Promise(r => setTimeout(r, 900));
await p.screenshot({ path: SHOTS + '晶體與分裂體_放大.png', clip: { x: 430, y: 160, width: 420, height: 220 } });
console.log('存好 晶體與分裂體.png、晶體與分裂體_放大.png');
await b.close();
