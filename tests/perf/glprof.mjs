// 新畫面每幀時間拆解：照 bench4 的配裝跑 8 秒，量 GLWorld.draw、GLFx.draw、GLActors.draw、GLFx.drawTexts、app.render（送給顯示卡）各花多少
//   用法：node perf/glprof.mjs [storm|intercept|trig2]
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const build = process.argv[2] || 'intercept';
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport: { width: 1280, height: 720 }, args: ['--window-size=1300,820', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html');
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} }); await p.reload(); await new Promise(r => setTimeout(r, 2500));
const r = await p.evaluate(async build => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'scatter');
  const B = {
    storm: { w: ['scatter', 'A', null], chain: ['weapon', chipId('trigend', 1), chipId('rear', 2), chipId('boomerang', 3), chipId('wallbounce', 1)], socks: [['split'], ['ignite'], ['overclock', 'bigshot'], ['mirror'], []] },
    intercept: { w: ['scatter', 'A', 0], chain: ['weapon', chipId('rear', 2), chipId('accel', 2), chipId('orbit', 2), chipId('wallbounce', 1), chipId('quick', 1), chipId('intercept', 2), chipId('dashfire', 3)], socks: [['mirror', 'split'], ['shock'], ['ignite'], [], [], ['split'], [], []] },
    trig2: { w: ['scatter', 'A', null], chain: ['weapon', chipId('trigend', 1), chipId('trigend', 1)], socks: [[], ['split'], ['split']] },
  }[build];
  Game.weapon = { id: B.w[0], path: B.w[1], final: B.w[2] }; Game.refreshWeapon();
  Game.chain = B.chain; Game.socks = B.socks; Game.wSock = 3; Game.recalc();
  const pl = Game.player; pl.hp = pl.maxHp = 1e9; Game.enemies = [];
  for (let i = 0; i < 40; i++) { const a = i / 40 * 6.283, d = 150 + (i % 5) * 70; const e = new Enemy('brute', pl.x + Math.cos(a) * d * 1.3, pl.y + Math.sin(a) * d * 0.8, 1); e.hp = e.maxHp = 1e9; e.t = { ...e.t, speed: 0, dmg: 0 }; Game.enemies.push(e); }
  const T = {}, wrap = (obj, name, key) => { const f = obj[name]; T[key] = 0; obj[name] = function (...a) { const t = performance.now(); const r = f.apply(this, a); T[key] += performance.now() - t; return r; }; };
  wrap(GLWorld, 'draw', 'world'); wrap(GLWorld, 'drawBg', 'bg'); wrap(GLFx, 'draw', 'fx'); wrap(GLActors, 'draw', 'actors'); wrap(GLFx, 'drawTexts', 'texts'); wrap(GLR, 'endPools', 'endPools'); wrap(GLR.app, 'render', 'gpuSubmit');
  let k = 0, tt = 0, frames = 0; const ou = Game.update;
  Game.update = function (dt) { tt += dt; if (tt > 0.5) { tt = 0; k = (k + 1) % Game.enemies.length; } const e = Game.enemies[k]; Input.down = true; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;
    if (Math.floor((Game.time + dt) / 1.5) > Math.floor(Game.time / 1.5)) for (let i = 0; i < 32; i++) { const a = i / 32 * Math.PI * 2; Game.eBullets.push({ x: pl.x + Math.cos(a) * 500, y: pl.y + Math.sin(a) * 500, vx: -Math.cos(a) * 160, vy: -Math.sin(a) * 160, r: 6, dmg: 0, life: 5, from: 't' }); }
    frames++; return ou.call(this, dt); };
  await new Promise(r => setTimeout(r, 3000)); for (const key in T) T[key] = 0; frames = 0;
  await new Promise(r => setTimeout(r, 8000));
  Game.update = ou; Input.down = false;
  const out = {}; for (const key in T) out[key] = +(T[key] / frames).toFixed(2); out.bullets = Game.bullets.length; return out;
}, build);
console.log(build, JSON.stringify(r));
await b.close();
