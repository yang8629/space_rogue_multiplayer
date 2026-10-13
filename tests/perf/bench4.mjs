// （2026-10-05）瀏覽器效能實測：三種配裝在沙盒打 40 隻標靶（＋每 1.5 秒一圈 32 發環形敵彈），按住射擊 15 秒
//   每秒記錄 FPS、子彈數；每幀時間拆成：運算（再細分：子彈、敵彈與攔截、敵人、其他）／畫圖
//   用法：node perf/bench4.mjs [storm|intercept|trig2|all]   （要先 npm i puppeteer-core；用電腦上的 Chrome，會開一個視窗）
//   storm：迴旋風暴（QA 第 195 局）；intercept：以前攔截爆量那組；trig2：散彈 A＋消失［分裂］＋消失［分裂］
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const url = GAME + 'index.html';
const which = process.argv[2] || 'all', builds = which === 'all' ? ['storm', 'intercept', 'trig2'] : [which];
const NAME = { storm: '迴旋風暴', intercept: '爆量配裝（攔截）', trig2: '雙觸發器散彈' };
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: false,
  defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
for (const build of builds) {
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('頁面錯誤', e.message));
  await page.goto(url);
  await page.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, process.env.RENDERER || 'gl');  // RENDERER=2d：舊畫面
  await page.reload();
  await new Promise(r => setTimeout(r, 2500));
  const rows = await page.evaluate(async build => {
    SFX.setMuted && SFX.setMuted(true);
    Game.newRun('sandbox', 'vanguard', 'scatter');
    const B = {
      storm: { w: ['scatter', 'A', null], chain: ['weapon', chipId('trigend', 1, 1), chipId('rear', 1, 2), chipId('boomerang', 3, 3), chipId('wallbounce', 1, 1)],
        socks: [['split'], ['ignite'], ['overclock', 'bigshot'], ['mirror'], []] },
      intercept: { w: ['scatter', 'A', 0], chain: ['weapon', chipId('rear', 2, 2), chipId('accel', 3, 2), chipId('orbit', 3, 2), chipId('wallbounce', 2, 1), chipId('quick', 3, 1), chipId('intercept', 3, 2), chipId('dashfire', 1, 3)],
        socks: [['mirror', 'split'], ['shock'], ['ignite'], [], [], ['split'], [], []] },
      trig2: { w: ['scatter', 'A', null], chain: ['weapon', chipId('trigend', 1, 1), chipId('trigend', 2, 1)], socks: [[], ['split'], ['split']] },
    }[build];
    Game.weapon = { id: B.w[0], path: B.w[1], final: B.w[2] }; Game.refreshWeapon();
    Game.chain = B.chain; Game.socks = B.socks; Game.wSock = 3; Game.recalc();
    const p = Game.player; p.hp = p.maxHp = 1e9;
    Game.enemies = [];
    const pos = [[260, -120], [300, 60], [220, 180], [-250, 100], [-280, -150], [0, -260], [80, 240], [-60, 220], [380, -20], [-380, 0]];
    const more = []; for (let i = 0; i < 30; i++) { const a = i / 30 * 6.283, d = 150 + (i % 5) * 70; more.push([Math.cos(a) * d * 1.3, Math.sin(a) * d * 0.8]); }
    for (const [x, y] of [...pos, ...more]) { const e = new Enemy('brute', p.x + x, p.y + y, 1); e.hp = e.maxHp = 1e9; e.t = { ...e.t, speed: 0, dmg: 0 }; Game.enemies.push(e); }
    // 計時：包住幾個主要的更新函式
    const T = { bul: 0, eb: 0, en: 0 }, wrap = (k, name) => { const f = Game[name]; Game[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); T[k] += performance.now() - t; return r; }; return () => { Game[name] = f; }; };
    const un = [wrap('bul', 'updateBullets'), wrap('eb', 'updateEnemyBullets'), wrap('en', 'updateEnemies')];
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
      tu = tr = 0; T.bul = T.eb = T.en = 0; let frames = 0, worst = 0, last = performance.now(), maxB = 0;
      const t0 = performance.now();
      await new Promise(res => { const tick = now => { frames++; worst = Math.max(worst, now - last); last = now; maxB = Math.max(maxB, Game.bullets.length); if (now - t0 < 1000) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
      rows.push({ s, fps: frames, maxB, upd: tu / frames, ren: tr / frames, bul: T.bul / frames, eb: T.eb / frames, en: T.en / frames, worst });
    }
    Game.update = ou; window.render = orr; Input.down = false; un.forEach(f => f());
    return rows;
  }, build);
  console.log(`\n== ${NAME[build]} ==`);
  for (const r of rows) console.log(`第 ${String(r.s + 1).padStart(2)} 秒：FPS ${String(r.fps).padStart(3)}｜子彈 ${String(r.maxB).padStart(5)}｜運算 ${r.upd.toFixed(1)}ms（子彈 ${r.bul.toFixed(1)}、敵彈＋攔截 ${r.eb.toFixed(1)}、敵人 ${r.en.toFixed(1)}）｜畫圖 ${r.ren.toFixed(1)}ms｜最慢一幀 ${r.worst.toFixed(0)}ms`);
  const late = rows.slice(5), avg = k => late.reduce((a, r) => a + r[k], 0) / late.length;
  console.log(`後 10 秒平均：FPS ${avg('fps').toFixed(0)}｜子彈 ${avg('maxB').toFixed(0)}｜運算 ${avg('upd').toFixed(1)}ms（子彈 ${avg('bul').toFixed(1)}、敵彈＋攔截 ${avg('eb').toFixed(1)}、敵人 ${avg('en').toFixed(1)}）｜畫圖 ${avg('ren').toFixed(1)}ms`);
  await page.close();
}
await browser.close();
