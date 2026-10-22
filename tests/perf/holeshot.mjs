// 黑洞吸引範圍＋出口箭頭：飛船旁邊放一個黑洞、出口放在畫面外，隔 0.5 秒截兩張 → art_lab/screenshots/新畫面_黑洞範圍_1/2.png
//   用法：node perf/holeshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(url);
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await wait(2500);
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; q.invuln = true; Game.enemies = []; Game.eBullets = [];
  Game.objs = [{ type: 'hole', x: q.x - 260, y: q.y + 40, r: 34, R: 280, tick: 0 }];
  Game.exit = { x: q.x + 2000, y: q.y - 900, r: 60 };
  window.__hold = setInterval(() => { Game.player.x = q.x; Game.player.y = q.y; }, 5);
});
for (const k of [1, 2]) { await wait(k === 1 ? 900 : 500); await p.screenshot({ path: `${OUT}新畫面_黑洞範圍_${k}.png`, clip: { x: 160, y: 120, width: 760, height: 480 } }); }
await b.close();
console.log('done');
