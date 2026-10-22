// 敵彈出膛檢查：各種會射擊的敵人放在飛船周圍（不扣血），每隻在剛開火時截一張放大圖，拼成一張
//   → art_lab/screenshots/新畫面_敵彈出膛.png   用法：node perf/ebshots.mjs [canvas]
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const MODE = process.argv[2] === 'canvas' ? 'canvas' : 'gl';
const TYPES = ['spitter', 'gunboat', 'elite', 'boss2', 'boss', 'boss3'];
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(url);
await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, MODE);
await p.reload(); await wait(2500);
const imgs = [];
for (const type of TYPES) {
  await p.evaluate(type => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; q.invuln = true; Game.enemies = []; Game.objs = []; Game.eBullets = [];
    const e = new Enemy(type, q.x + 260, q.y - 120, 1); e.spawnT = 0; e.t = { ...e.t, dmg: 0, speed: 0 }; e.cd = 0.3; e.skillCd = 0.3; Game.enemies.push(e);
    window.__fired = null;
  }, type);
  let got = null;
  for (let i = 0; i < 120 && !got; i++) {
    await wait(50);
    got = await p.evaluate(() => { const e = Game.enemies[0]; if (!e) return null; const y = Game.eBullets.filter(b => { const d = Math.hypot(b.x - e.x, b.y - e.y); return d > e.r * 1.1 && d < e.r * 1.9 + 25; /* 剛飛出機身邊緣 */ }); return y.length ? { x: (e.x - Game.cam.x) * ZOOM, y: (e.y - Game.cam.y) * ZOOM, n: y.length, mode: e.mode } : null; });
  }
  if (!got) { console.log(type, '沒開火'); continue; }
  console.log(type, '開火', got.n, '發', got.mode);
  imgs.push([type, await p.screenshot({ clip: { x: got.x - 120, y: got.y - 120, width: 240, height: 240 }, encoding: 'base64' })]);
}
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;flex-wrap:wrap;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:240px;height:240px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 8 + 3 * 248, height: 8 + 2 * 280, deviceScaleFactor: 2 });
await p.screenshot({ path: `${OUT}新畫面_敵彈出膛${MODE === 'canvas' ? '_舊畫面' : ''}.png` });
await b.close();
console.log('done');
