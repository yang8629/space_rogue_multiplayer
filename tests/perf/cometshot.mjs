// 彗星爆炸（新畫面）：飛船旁邊讓彗星撞爆，爆炸後 0.08／0.25／0.6 秒各截一張，拼成一張 → art_lab/screenshots/新畫面_彗星爆炸.png
//   用法：node perf/cometshot.mjs [canvas]
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const MODE = process.argv[2] === 'canvas' ? 'canvas' : 'gl';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(url);
await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, MODE);
await p.reload(); await wait(2500);
const pos = await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; Game.enemies = []; Game.eBullets = []; Game.objs = [];
  for (const [dx, dy] of [[120, -60], [180, 40], [90, 90]]) { const e = new Enemy('brute', q.x + 200 + dx, q.y + dy, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; e.t = { ...e.t, dmg: 0 }; e.hp = e.maxHp = 1e9; Game.enemies.push(e); }
  window.__hold = setInterval(() => { Game.player.x = q.x; Game.player.y = q.y; }, 5);
  return { x: (q.x + 200 - Game.cam.x) * ZOOM, y: (q.y - Game.cam.y) * ZOOM, wx: q.x + 200, wy: q.y };
});
await wait(300);
await p.evaluate(({ wx, wy }) => { const o = { type: 'comet', id: 997, x: wx, y: wy, vx: 0, vy: 0, r: 26, hp: 60, maxHp: 60, warn: 0, hits: new Set(), age: 2 }; Game.objs = [o]; Objects.cometBoom(o, 100, 40); }, pos);
const imgs = [];
let last = 0;
for (const ms of [80, 250, 600]) { await wait(ms - last); last = ms; imgs.push([`${ms / 1000} 秒`, await p.screenshot({ clip: { x: pos.x - 260, y: pos.y - 200, width: 520, height: 400 }, encoding: 'base64' })]); }
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:416px;height:320px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 8 + 3 * 424, height: 370 });
await p.screenshot({ path: `${OUT}新畫面_彗星爆炸${MODE === 'canvas' ? '_舊畫面' : ''}.png` });
await b.close();
console.log('done');
