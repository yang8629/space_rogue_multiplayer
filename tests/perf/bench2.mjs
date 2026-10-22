// （2026-10-05，原本在暫存資料夾；要先 npm i puppeteer-core，用電腦上的 Chrome）
// 瀏覽器實測：照 QA 第 195 局的配裝（散彈 A＋迴旋風暴［鏡像］等）在沙盒打標靶，每秒記錄 FPS、子彈數、運算／畫圖時間
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const url = GAME + 'index.html';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: false,
  defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('頁面錯誤', e.message));
await page.goto(url);
await new Promise(r => setTimeout(r, 1500));
const build = process.argv[2] || 'boom';
const rows = await page.evaluate(async build => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'scatter');
  const B = {
    boom: { w: ['scatter', 'A', null], chain: ['weapon', chipId('trigend', 1), chipId('rear', 2), chipId('boomerang', 3), chipId('wallbounce', 1)],
      socks: [['split'], ['ignite'], ['overclock', 'bigshot'], ['mirror'], []] },
    intercept: { w: ['scatter', 'A', 0], chain: ['weapon', chipId('rear', 2), chipId('accel', 2), chipId('orbit', 2), chipId('wallbounce', 1), chipId('quick', 1), chipId('intercept', 2), chipId('dashfire', 3)],
      socks: [['mirror', 'split'], ['shock'], ['ignite'], [], [], ['split'], [], []] },
  }[build];
  Game.weapon = { id: B.w[0], path: B.w[1], final: B.w[2] }; Game.refreshWeapon();
  Game.chain = B.chain; Game.socks = B.socks; Game.wSock = 3; Game.recalc();
  const p = Game.player; p.hp = p.maxHp = 1e9;
  Game.enemies = [];
  const pos = [[260, -120], [300, 60], [220, 180], [-250, 100], [-280, -150], [0, -260], [80, 240], [-60, 220], [380, -20], [-380, 0]];
  for (const [x, y] of pos) { const e = new Enemy('brute', p.x + x, p.y + y, 1); e.hp = e.maxHp = 1e9; e.t = { ...e.t, speed: 0, dmg: 0 }; Game.enemies.push(e); }
  // 一直按住射擊，準星輪流對著標靶（每 0.5 秒換一隻）；終焉核心風格的敵彈：每 1.5 秒一圈 32 發射向飛船（給攔截用）
  let k = 0, tt = 0;
  const ou = Game.update, orr = window.render; let tu = 0, tr = 0;
  Game.update = function (dt) {
    tt += dt; if (tt > 0.5) { tt = 0; k = (k + 1) % Game.enemies.length; }
    const e = Game.enemies[k]; Input.down = true; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;
    if (Math.floor((Game.time + dt) / 1.5) > Math.floor(Game.time / 1.5)) for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2, sx = p.x + Math.cos(a) * 500, sy = p.y + Math.sin(a) * 500; Game.eBullets.push({ x: sx, y: sy, vx: -Math.cos(a) * 160, vy: -Math.sin(a) * 160, r: 6, dmg: 0, life: 5, from: '測試' }); }
    const t = performance.now(); ou.call(this, dt); tu += performance.now() - t;
  };
  window.render = function () { const t = performance.now(); orr(); tr += performance.now() - t; };
  const rows = [];
  for (let s = 0; s < 15; s++) {
    tu = tr = 0; let frames = 0, worst = 0, last = performance.now(), maxB = 0;
    const t0 = performance.now();
    await new Promise(res => { const tick = now => { frames++; worst = Math.max(worst, now - last); last = now; maxB = Math.max(maxB, Game.bullets.length); if (now - t0 < 1000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    rows.push({ s, fps: frames, maxB, upd: tu / frames, ren: tr / frames, worst });
  }
  Game.update = ou; window.render = orr; Input.down = false;
  return rows;
}, build);
for (const r of rows) console.log(`第 ${String(r.s + 1).padStart(2)} 秒：FPS ${String(r.fps).padStart(3)}｜子彈最多 ${String(r.maxB).padStart(5)}｜每幀 運算 ${r.upd.toFixed(1)}ms、畫圖 ${r.ren.toFixed(1)}ms｜最慢一幀 ${r.worst.toFixed(0)}ms`);
await browser.close();
