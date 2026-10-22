// 哨兵號・砲台的截圖 → art_lab/screenshots/
//   選飛船畫面（5 艘）、衝刺後留下的砲台朝敵人開火
//   用法：node perf/turretshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(1800);
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.title(); });
await wait(500);
await p.screenshot({ path: SHOTS + '選飛船畫面_五艘.png' });
await p.evaluate(() => document.body.classList.add('detail'));
await wait(300);
await p.screenshot({ path: SHOTS + '選飛船畫面_五艘_詳細.png' });
// 砲台：玩家往左衝刺，砲台留在原地朝右邊的靶開火
await p.evaluate(() => {
  document.body.classList.remove('detail');
  Game.newRun('sandbox', 'sentry', 'laser');
  Game.node = { type: 'combat', L: 1, id: 'shot' };
  Game.startCombat({ level: 1, wavesTotal: 99, elites: 0, sandbox: true });
  Game.combat.pending = []; Game.combat.waveTimer = 1e9; Input.autoFire = false;
  const P = Game.player; P.hp = P.maxHp = 1e9;
  Game.objs = [];
  Game.enemies = [new Enemy('brute', P.x + 260, P.y - 60, 40), new Enemy('dummy', P.x + 220, P.y + 90, 40)];
  for (const e of Game.enemies) { e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.rollCd = Infinity; }
});
await wait(400);
await p.evaluate(() => { Input.keys.add('a'); Input.dash = true; setTimeout(() => Input.keys.delete('a'), 250); });
await wait(700);
const clip = await p.evaluate(() => { const t = Game.turrets[0] || Game.player; return { x: Math.max(0, (t.x - Game.cam.x) * ZOOM - 300), y: Math.max(0, (t.y - Game.cam.y) * ZOOM - 170), width: 640, height: 340 }; });
await p.screenshot({ path: SHOTS + '哨兵號_砲台開火.png', clip });
console.log('砲台', await p.evaluate(() => Game.turrets.length), '座；砲台子彈', await p.evaluate(() => Game.bullets.filter(b => b.turret).length), '發');
await b.close();
console.log('done');
