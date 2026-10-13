// 反彈子彈的樣子：盾衛把我方子彈反彈回來（紅框＋原本顏色）、反射鏡（攔截 Lv3）把敵彈反彈回去（敵彈外形、綠色）
//   → art_lab/screenshots/新畫面_反彈子彈.png   用法：node perf/reflshots.mjs [canvas]
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const MODE = process.argv[2] === 'canvas' ? 'canvas' : 'gl';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(url);
await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, MODE);
await p.reload(); await wait(2500);
const SCENES = {
  盾衛反彈: `Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; q.invuln = true; Game.enemies = []; Game.objs = []; Game.eBullets = [];
    const e = new Enemy('shield', q.x + 200, q.y, 1); e.spawnT = 0; e.frozen = true; e.hx = e.x; e.hy = e.y; e.t = { ...e.t, dmg: 0 }; e.shieldA = Math.PI; e.hp = e.maxHp = 1e9; Game.enemies.push(e);
    Input.down = true; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;
    window.__c = [q.x + 100, q.y];`,
  反射鏡: `Game.newRun('sandbox', 'vanguard', 'laser'); const q = Game.player; q.hp = q.maxHp = 1e9; q.invuln = true; Game.enemies = []; Game.objs = []; Game.eBullets = [];
    Game.chain = ['weapon', chipId('intercept', 3, 0), null]; Game.socks = [[], [], []]; Game.recalc();
    const e = new Enemy('gunboat', q.x + 260, q.y, 1); e.spawnT = 0; e.t = { ...e.t, dmg: 0, speed: 0 }; e.hp = e.maxHp = 1e9; e.cd = 0.2; Game.enemies.push(e);
    Input.down = true; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;
    window.__c = [q.x + 130, q.y];`,
};
const imgs = [];
for (const [name, code] of Object.entries(SCENES)) {
  await p.evaluate(`(() => { SFX.setMuted && SFX.setMuted(true); ${code} })()`);
  let info = null;
  for (let i = 0; i < 60; i++) {
    await wait(100);
    info = await p.evaluate(name => ({ refl: name === '盾衛反彈' ? Game.eBullets.filter(b => b.col).length : Game.bullets.filter(b => b.shape === 'reflect').length, lv: Game.stats && Game.stats.intercept, eb: Game.eBullets.length, mode: Game.enemies[0] && Game.enemies[0].mode }), name);
    if (info.refl >= 1) break;
  }
  console.log(name, JSON.stringify(info));
  const pos = await p.evaluate(name => { const r = name === '盾衛反彈' ? Game.eBullets.find(b => b.col) : Game.bullets.find(b => b.shape === 'reflect'); const c = r ? [r.x, r.y] : window.__c; return { x: (c[0] - Game.cam.x) * ZOOM, y: (c[1] - Game.cam.y) * ZOOM }; }, name);  // 以反彈的子彈為中心
  imgs.push([name, await p.screenshot({ clip: { x: pos.x - 180, y: pos.y - 120, width: 360, height: 240 }, encoding: 'base64' })]);
  await p.evaluate(() => { Input.down = false; });
}
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:360px;height:240px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 8 + imgs.length * 368, height: 290, deviceScaleFactor: 2 });
await p.screenshot({ path: `${OUT}新畫面_反彈子彈${MODE === 'canvas' ? '_舊畫面' : ''}.png` });
await b.close();
console.log('done');
