// 裂界獵艦新舊畫面比較：舊畫面、新畫面（現在）、新畫面加幾種染色，各截一張放大圖，再拼成一張
//   用法：node perf/boss2cmp.mjs   （染色只在頁面上試：包住 GLActors.enemy/spr，不改遊戲檔案）
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const CASES = [['canvas', 0, '舊畫面'], ['gl', 0, '新畫面 現在'], ['gl', 0xdcd6ec, '染色 dcd6ec（淺）'], ['gl', 0xcdc6e0, '染色 cdc6e0（建議）'], ['gl', 0xbfb8d6, '染色 bfb8d6（深）']];
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
const imgs = [];
for (const [mode, tint, label] of CASES) {
  await p.goto(url);
  await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, mode);
  await p.reload(); await wait(2500);
  await p.evaluate(`(() => { SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; Game.enemies = []; Game.objs = [];
    const e = new Enemy('boss2', q.x, q.y - 160, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; e.t = { ...e.t, dmg: 0 }; Game.enemies.push(e);
    const T = ${tint};
    if (T && window.GLActors) { const A = GLActors, en = A.enemy, sp = A.spr; let on = false;
      A.spr = function (...a) { const s = sp.apply(this, a); if (on) { s.tint = T; on = false; } return s; };
      A.enemy = function (e) { on = e.type === 'boss2'; const r = en.call(this, e); on = false; return r; }; } })()`);
  await wait(900);
  const pos = await p.evaluate(() => { const e = Game.enemies[0]; return { x: (e.x - Game.cam.x) * ZOOM, y: (e.y - Game.cam.y) * ZOOM }; });
  const buf = await p.screenshot({ clip: { x: pos.x - 110, y: pos.y - 110, width: 220, height: 220 }, encoding: 'base64' });
  imgs.push([label, buf]);
}
// 拼成一張（標上名稱）
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:220px;height:220px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 8 + imgs.length * 228, height: 270, deviceScaleFactor: 2 });
await p.screenshot({ path: `${OUT}裂界獵艦_染色比較.png` });
await b.close();
console.log('done');
