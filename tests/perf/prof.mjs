// （2026-10-05，原本在暫存資料夾；要先 npm i puppeteer-core，用電腦上的 Chrome）
// Chrome 效能分析：迴旋風暴配裝打 12 秒，列出最花時間的函式（自己的時間）
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const url = GAME + 'index.html';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: false,
  defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage();
await page.goto(url);
await new Promise(r => setTimeout(r, 1500));
await page.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'scatter');
  Game.weapon = { id: 'scatter', path: 'A', final: null }; Game.refreshWeapon();
  Game.chain = ['weapon', chipId('trigend', 1), chipId('rear', 2), chipId('boomerang', 3), chipId('wallbounce', 1)];
  Game.socks = [['split'], ['ignite'], ['overclock', 'bigshot'], ['mirror'], []]; Game.wSock = 3; Game.recalc();
  const p = Game.player; p.hp = p.maxHp = 1e9; Game.enemies = [];
  for (const [x, y] of [[260, -120], [300, 60], [220, 180], [-250, 100], [-280, -150], [0, -260], [80, 240], [-60, 220], [380, -20], [-380, 0]]) { const e = new Enemy('brute', p.x + x, p.y + y, 1); e.hp = e.maxHp = 1e9; e.t = { ...e.t, speed: 0, dmg: 0 }; Game.enemies.push(e); }
  let k = 0, tt = 0; const ou = Game.update;
  Game.update = function (dt) { tt += dt; if (tt > 0.5) { tt = 0; k = (k + 1) % Game.enemies.length; } const e = Game.enemies[k]; Input.down = true; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM; ou.call(this, dt); };
});
await new Promise(r => setTimeout(r, 2000));
const cdp = await page.createCDPSession();
await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
await new Promise(r => setTimeout(r, 12000));
const { profile } = await cdp.send('Profiler.stop');
await browser.close();
// （2026-10-05，原本在暫存資料夾；要先 npm i puppeteer-core，用電腦上的 Chrome）
// 每個函式自己的時間（取樣數）
const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
const cnt = new Map(); for (const id of profile.samples) cnt.set(id, (cnt.get(id) || 0) + 1);
let total = 0;
for (const [id, c] of cnt) { const n = byId.get(id), cf = n.callFrame; const k = `${cf.functionName || '(匿名)'}  ${cf.url.split('/').slice(-2).join('/')}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) || 0) + c); total += c; }
const idle = [...self.entries()].filter(([k]) => /\(idle\)|\(program\)|\(garbage collector\)/.test(k));
console.log(`取樣 ${total} 個；` + idle.map(([k, v]) => `${k.trim()} ${(v / total * 100).toFixed(1)}%`).join('、'));
const busy = [...self.entries()].filter(([k]) => !/\(idle\)|\(program\)/.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 25);
for (const [k, v] of busy) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`);
