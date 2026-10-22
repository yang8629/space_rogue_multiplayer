// （2026-10-05，原本在暫存資料夾；要先 npm i puppeteer-core，用電腦上的 Chrome）
// 瀏覽器實測：沙盒裡放 N 發子彈（散在畫面裡、慢慢飛、不會消失），量 FPS、每幀遊戲運算和畫圖各花多久
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const url = GAME + 'index.html';
const browser = await puppeteer.launch({ executablePath: CHROME, headless: false,
  defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('頁面錯誤', e.message));
await page.goto(url);
await new Promise(r => setTimeout(r, 1500));
const counts = (process.argv[2] || '0,1000,3000,5000,7000,9000').split(',').map(Number);
for (const n of counts) {
  const r = await page.evaluate(async n => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'vanguard', 'scatter');
    const p = Game.player;
    // 幾隻打不死的標靶（碰撞要算）
    Game.enemies = [];
    for (let i = 0; i < 8; i++) { const e = new Enemy('brute', p.x + Math.cos(i) * 300, p.y + Math.sin(i) * 200, 1); e.hp = e.maxHp = 1e9; e.t = { ...e.t, speed: 0, dmg: 0 }; Game.enemies.push(e); }
    const fill = () => {
      const need = n - Game.bullets.length;
      if (need <= 0) return;
      const list = [];
      for (let i = 0; i < need; i++) list.push(shot({ angle: Math.random() * Math.PI * 2, speed: 40 + Math.random() * 60, damage: 1, radius: 3.5, life: 6, color: '#ffb347', shape: 'dot' }));
      const a = Math.random() * Math.PI * 2, d = Math.random() * 420;
      spawnShots(list, p.x + Math.cos(a) * d * 1.4, p.y + Math.sin(a) * d * 0.8, 0, 0, null);
      for (const b of Game.bullets) if (!b._placed) { b._placed = 1; const aa = Math.random() * 6.283, dd = Math.random(); b.x = b.px = p.x + Math.cos(aa) * 600 * dd; b.y = b.py = p.y + Math.sin(aa) * 330 * dd; }
    };
    // 量：每幀遊戲運算、畫圖
    const ou = Game.update, orr = window.render; let tu = 0, tr = 0, frames = 0, worst = 0, lastT = performance.now();
    Game.update = function (dt) { fill(); const t = performance.now(); ou.call(this, dt); tu += performance.now() - t; };
    window.render = function () { const t = performance.now(); orr(); tr += performance.now() - t; };
    await new Promise(r => setTimeout(r, 1000));  // 暖機
    tu = tr = frames = 0; worst = 0;
    const t0 = performance.now();
    await new Promise(res => { const tick = now => { frames++; worst = Math.max(worst, now - lastT); lastT = now; if (now - t0 < 4000) requestAnimationFrame(tick); else res(); }; lastT = performance.now(); requestAnimationFrame(tick); });
    const el = performance.now() - t0;
    Game.update = ou; window.render = orr;
    return { n, bullets: Game.bullets.length, fps: frames / el * 1000, upd: tu / frames, ren: tr / frames, worst };
  }, n);
  console.log(`子彈 ${String(r.n).padStart(5)}（實際 ${r.bullets}）：FPS ${r.fps.toFixed(1)}｜每幀 運算 ${r.upd.toFixed(1)}ms、畫圖 ${r.ren.toFixed(1)}ms｜最慢一幀 ${r.worst.toFixed(0)}ms`);
}
await browser.close();
