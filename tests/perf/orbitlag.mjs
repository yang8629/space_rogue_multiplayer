// 環繞卡頓實測（2026-10-19 使用者實玩：散彈＋環繞會卡，把環繞拿下來）：照那局的配裝在沙盒打 40 隻標靶，
//   按住射擊 2.5 秒（子彈存在身邊繞）→ 放開 0.3 秒（全部射出）一直循環；每秒記 FPS、子彈數、運算／畫圖時間、最慢一幀
//   用法：node perf/orbitlag.mjs [orbit|none]   orbit：散彈［爆裂］＋環繞・爆發＋反向・餘波＋架設；none：同一組拿掉環繞（比較用）
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const which = process.argv[2] || 'all', builds = which === 'all' ? ['orbit', 'none'] : [which];
const browser = await puppeteer.launch({ executablePath: CHROME, headless: false,
  defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
for (const build of builds) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('頁面錯誤', e.message));
  await page.goto(GAME + 'index.html');
  await new Promise(r => setTimeout(r, 2500));
  const rows = await page.evaluate(async build => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'wraith', 'scatter');
    const orbit = chipId('orbit', 1, { k: 'burst', lv: 1 }), rear = chipId('rear', 3, { k: 'aftershock', lv: 1 }), stand = chipId('stand', 1, { k: 'frenzy', lv: 1 });
    Game.chain = build === 'orbit' ? ['weapon', orbit, rear, stand] : ['weapon', rear, stand];
    Game.socks = build === 'orbit' ? [['blast'], ['split'], ['bigshot'], []] : [['blast'], ['bigshot'], []];
    Game.wSock = 3; Game.recalc();
    const p = Game.player; p.hp = p.maxHp = 1e9;
    Game.enemies = [];
    const pos = []; for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283, d = 160 + (i % 5) * 70; pos.push([Math.cos(a) * d * 1.3, Math.sin(a) * d * 0.8]); }
    for (const [x, y] of pos) { const e = new Enemy('brute', p.x + x, p.y + y, 1); e.hp = e.maxHp = 1e9; e.t = { ...e.t, speed: 0, dmg: 0 }; Game.enemies.push(e); }
    let k = 0, tt = 0, cyc = 0, tu = 0, tr = 0;
    const ou = Game.update, orr = window.render;
    Game.update = function (dt) {
      tt += dt; cyc = (cyc + dt) % 2.8; if (tt > 0.5) { tt = 0; k = (k + 1) % Game.enemies.length; }
      const e = Game.enemies[k]; Input.down = cyc < 2.5; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;
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
  console.log(`\n== ${build === 'orbit' ? '有環繞' : '沒有環繞'} ==`);
  for (const r of rows) console.log(`第 ${String(r.s + 1).padStart(2)} 秒：FPS ${String(r.fps).padStart(3)}｜子彈 ${String(r.maxB).padStart(5)}｜運算 ${r.upd.toFixed(1)}ms｜畫圖 ${r.ren.toFixed(1)}ms｜最慢一幀 ${r.worst.toFixed(0)}ms`);
  await page.close();
}
await browser.close();
