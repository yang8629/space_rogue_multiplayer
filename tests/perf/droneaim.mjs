// 無人機機頭朝向（真的 Chrome）：沙盒拿無人機蜂群，一隻靶繞著飛船轉；不開火 2 秒、開火 2 秒
//   滑鼠一直放在靶上；逐幀記每架無人機（靶在牠射程內的）機頭和目標方向差幾度、一幀轉了幾度 → 印出來；不開火、開火中各截一張拼起來 → art_lab/screenshots/無人機_瞄準.png
//   用法：node perf/droneaim.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.goto(GAME + 'index.html'); await wait(2500);
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('sandbox', 'vanguard', 'drone'); const q = Game.player; q.hp = q.maxHp = 1e9; Game.enemies = []; Game.eBullets = []; Game.objs = [];
  const e = new Enemy('brute', q.x + 180, q.y, 1); e.spawnT = 0; e.t = { ...e.t, speed: 0, dmg: 0, ranged: null }; e.rollCd = Infinity; e.hp = e.maxHp = 1e9; Game.enemies.push(e);
  const x0 = q.x, y0 = q.y, t0 = performance.now(), rows = window.__rows = [];
  let last = null;
  const tick = () => {  // 每幀：靶繞飛船轉（每秒 1.5 弧度），飛船停在原地；記每架的機頭誤差和這一幀轉了多少
    const s = (performance.now() - t0) / 1000;
    q.x = x0; q.y = y0; q.vx = q.vy = 0; e.x = x0 + Math.cos(s * 1.5) * 180; e.y = y0 + Math.sin(s * 1.5) * 180;
    Input.down = s > 2; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;  // 前 2 秒不開火、後 2 秒開火；滑鼠一直在靶上（開火時無人機飛到靶附近）
    const D = (q.drones || []).filter(d => !(d.down > 0)), inR = D.filter(d => Math.hypot(e.x - d.x, e.y - d.y) < DRONE.range);
    if (D.length && last) rows.push({ s, fire: s > 2, err: inR.length ? Math.max(...inR.map(d => Math.abs(angleDiff(d.a, Math.atan2(e.y - d.y, e.x - d.x))))) : null, turn: Math.max(...D.map((d, i) => Math.abs(angleDiff(last[i], d.a)))) });
    last = D.map(d => d.a);
    if (s < 4) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});
const clip = { x: 340, y: 160, width: 600, height: 400 }, imgs = [];
await wait(1500); imgs.push(['不開火', await p.screenshot({ clip, encoding: 'base64' })]);
await wait(2000); imgs.push(['開火中', await p.screenshot({ clip, encoding: 'base64' })]);
await wait(700);
const rows = await p.evaluate(() => window.__rows);
await p.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:600px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await p.setViewport({ width: 8 + 2 * 608, height: 450 });
await p.screenshot({ path: SHOTS + '無人機_瞄準.png' });
const deg = r => (r * 180 / Math.PI).toFixed(1);
for (const fire of [false, true]) {
  const R = rows.filter(r => r.fire === fire && r.s > (fire ? 2.3 : 0.5)), errs = R.map(r => r.err).filter(x => x != null).sort((a, b) => a - b);
  console.log(`${fire ? '開火中' : '不開火'}（${R.length} 幀，靶在射程內 ${errs.length} 幀）：機頭跟目標差 中位數 ${deg(errs[errs.length >> 1])}°、最大 ${deg(errs[errs.length - 1])}°；一幀最多轉 ${deg(Math.max(...R.map(r => r.turn)))}°`);
}
await b.close();
