// 新畫面（WebGL）檢查截圖：擺出好幾個場景各截一張，存到 art_lab/screenshots/新畫面_*.png
//   用法：node perf/glshots.mjs [場景名…]   場景：enemies、bosses、objects、walls、bullets、gate、drones
//   drones：無人機機頭朝向——一隻靶繞著飛船轉、滑鼠一直在靶上，不開火 2 秒、開火 2 秒；逐幀量機頭跟目標差幾度（只算靶在牠射程內的）、一幀轉幾度，印出來＋兩張拼一張
//   （新畫面要開著：腳本會把 localStorage 的 renderer 設成 gl）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const want = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: process.env.DSF ? +process.env.DSF : 1 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 4).join(' / ')));
p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('console', m.type(), m.text().slice(0, 200)); });
await p.goto(url);
await p.evaluate(() => { try { localStorage.setItem('renderer', 'gl'); } catch (e) {} });
await p.reload(); await new Promise(r => setTimeout(r, 2500));
const ready = await p.evaluate(() => ({ on: GLR.on, ready: GLR.ready, failed: GLR.failed }));
console.log('GLR', JSON.stringify(ready));
const wait = ms => new Promise(r => setTimeout(r, ms));
// 共用：開一場沙盒、飛船不會死、清掉敵人
const SETUP = `
  SFX.setMuted && SFX.setMuted(true);
  Math.random = (() => { let s = 11; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();
  const sandbox = (w = 'laser') => { Game.newRun('sandbox', 'vanguard', w); Game.player.hp = Game.player.maxHp = 1e9; Game.enemies = []; Game.objs = []; return Game.player; };
  const put = (type, x, y, freeze = true) => { const e = new Enemy(type, x, y, 1); e.spawnT = 0; if (freeze) { e.frozen = true; e.hx = x; e.hy = y; e.t = { ...e.t, dmg: 0 }; } e.hp = e.maxHp; Game.enemies.push(e); return e; };
`;
const SCENES = {
  enemies: `const p = sandbox(); const T = ['swarmer','brute','spitter','elite','gunboat','shield','splitter','splitling','lurker','hive','dummy'];
    T.forEach((t, i) => { const e = put(t, p.x - 420 + (i % 6) * 170, p.y - 170 + Math.floor(i / 6) * 200); if (t === 'lurker') e.cloak = 0; if (t === 'shield') e.shieldA = 0.6; });
    let prev = null; for (let i = 0; i < 6; i++) { const w = put('worm', p.x - 200 - i * 22, p.y + 230, false); w.ahead = prev; prev = w; }
    const b2 = put('brute', p.x + 330, p.y + 230); b2.mode = 'windup'; b2.modeT = 0.3; b2.chargeA = 0.5;
    Game.enemies[3].flash = 0.2; Game.enemies[1].slowT = 2; Game.enemies[1].burnT = 2; Game.enemies[2].hp = Game.enemies[2].maxHp * 0.5;`,
  bosses: `const p = sandbox(); put('boss', p.x - 330, p.y - 60); const b2 = put('boss2', p.x, p.y - 160); const b3 = put('boss3', p.x + 330, p.y - 40); b3.enraged = true;`,
  objects: `const p = sandbox(); Game.objs = [
      { type: 'planet', x: p.x - 330, y: p.y - 80, r: 90, r0: 90, hp: 900, maxHp: 900, gm: 1 },
      { type: 'hole', x: p.x + 280, y: p.y - 120, r: 30, R: 220, tick: 0 },
      { type: 'rock', x: p.x - 60, y: p.y + 200, r: 34, hp: 50, maxHp: 100 }, { type: 'rock', x: p.x + 40, y: p.y + 240, r: 22, hp: 60, maxHp: 60 },
      { type: 'comet', id: 999, x: p.x + 380, y: p.y + 200, vx: -120, vy: -40, r: 18, hp: 50, maxHp: 50, warn: 0, hits: new Set(), age: 0 } ];
    Game.portals = [{ ax: p.x - 120, ay: p.y + 60, bx: p.x + 120, by: p.y + 60, t: 2, color: '#2ee6a6', owner: p }];`,
  bullets: `const p = sandbox('scatter'); for (let i = 0; i < 6; i++) put('dummy', p.x + 320, p.y - 250 + i * 100);
    Game.weapon = { id: 'scatter', path: 'A', final: null }; Game.refreshWeapon();
    Game.chain = ['weapon', chipId('boomerang', 1), chipId('shard', 1)]; Game.socks = [[], ['blast'], ['ignite']]; Game.recalc();
    Input.down = true; Input.mx = (p.x + 320 - Game.cam.x) * ZOOM; Input.my = (p.y - Game.cam.y) * ZOOM;
    for (let i = 0; i < 24; i++) Game.eBullets.push({ x: p.x - 300 + i * 25, y: p.y - 280, vx: 0, vy: 40, r: 5, dmg: 0, life: 9, from: 't' });
    floatText(p.x - 100, p.y - 60, 1234, '#ffd166', true); floatText(p.x - 60, p.y - 40, 56, '#ffffff'); floatText(p.x - 140, p.y - 30, '獲得 迴旋', '#ff9f1c', true);`,
  walls: '',
  gate: '',
  drones: '',
};
for (const [name, code] of Object.entries(SCENES)) {
  if (want.length && !want.includes(name)) continue;
  if (name === 'drones') {
    await p.evaluate(`(() => { ${SETUP} const q = sandbox('drone'), e = put('brute', q.x + 180, q.y); e.hp = e.maxHp = 1e9;
      const x0 = q.x, y0 = q.y, t0 = performance.now(), rows = window.__rows = []; let last = null;
      const tick = () => {  // 每幀：靶繞飛船轉（每秒 1.5 弧度）、飛船停在原地；記每架的機頭誤差和這一幀轉了多少
        const s = (performance.now() - t0) / 1000;
        q.x = x0; q.y = y0; q.vx = q.vy = 0; e.x = e.hx = x0 + Math.cos(s * 1.5) * 180; e.y = e.hy = y0 + Math.sin(s * 1.5) * 180;
        Input.down = s > 2; Input.mx = (e.x - Game.cam.x) * ZOOM; Input.my = (e.y - Game.cam.y) * ZOOM;
        const D = (q.drones || []).filter(d => !(d.down > 0)), inR = D.filter(d => Math.hypot(e.x - d.x, e.y - d.y) < DRONE.range);
        if (D.length && last) rows.push({ s, fire: s > 2, err: inR.length ? Math.max(...inR.map(d => Math.abs(angleDiff(d.a, Math.atan2(e.y - d.y, e.x - d.x))))) : null, turn: Math.max(...D.map((d, i) => Math.abs(angleDiff(last[i], d.a)))) });
        last = D.map(d => d.a);
        if (s < 4) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick); })()`);
    const clip = { x: 340, y: 160, width: 600, height: 400 }, imgs = [];
    await wait(1500); imgs.push(['不開火', await p.screenshot({ clip, encoding: 'base64' })]);
    await wait(2000); imgs.push(['開火中', await p.screenshot({ clip, encoding: 'base64' })]);
    await wait(700);
    const rows = await p.evaluate(() => { Input.down = false; return window.__rows; }), deg = r => (r * 180 / Math.PI).toFixed(1);
    for (const fire of [false, true]) {
      const R = rows.filter(r => r.fire === fire && r.s > (fire ? 2.3 : 0.5)), errs = R.map(r => r.err).filter(x => x != null).sort((a, b) => a - b);
      console.log(`無人機${fire ? '開火中' : '不開火'}（${R.length} 幀，靶在射程內 ${errs.length} 幀）：機頭跟目標差 中位數 ${deg(errs[errs.length >> 1])}°、最大 ${deg(errs[errs.length - 1])}°；一幀最多轉 ${deg(Math.max(...R.map(r => r.turn)))}°`);
    }
    const pg = await b.newPage();
    await pg.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:16px sans-serif;color:#dde">${imgs.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:600px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
    await pg.setViewport({ width: 8 + 2 * 608, height: 450 });
    await pg.screenshot({ path: `${OUT}新畫面_無人機瞄準.png` }); await pg.close();
    continue;
  }
  if (name === 'gate') {  // 星門號船尾的傳送環：隔 0.4 秒截兩張，看有沒有在轉
    await p.evaluate(`(() => { ${SETUP} Game.newRun('sandbox', 'gate', 'laser'); Game.player.hp = Game.player.maxHp = 1e9; Game.enemies = []; Game.objs = []; Game.mates = []; Game.player.moving = true; })()`);
    for (const k of [1, 2]) {
      await wait(k === 1 ? 700 : 400);
      const pos = await p.evaluate(() => { const q = Game.player; return { x: (q.x - Game.cam.x) * ZOOM, y: (q.y - Game.cam.y) * ZOOM }; });
      await p.screenshot({ path: `${OUT}新畫面_星門號_${k}.png`, clip: { x: pos.x - 60, y: pos.y - 60, width: 120, height: 120 } });
    }
    continue;
  }
  if (name === 'walls') {
    for (const [sec, seed] of [[1, 0], [1, 1], [2, 0], [2, 1], [3, 0], [3, 1]]) {
      await p.evaluate(`(() => { ${SETUP} Game.newRun('run', 'vanguard', 'laser'); Game.sector = ${sec}; Game.node = { type: 'combat', L: 3, id: 'w' };
        Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 }); Arena.seed = ${seed}; GLWorld.builtLoops = null; Game.player.hp = Game.player.maxHp = 1e9; Game.enemies = [];
        const L = Arena.loops[0], q = L[Math.floor(L.length / 3)]; Game.player.x = q[0]; Game.player.y = q[1]; Game.cam.x = q[0] - ZW / 2; Game.cam.y = q[1] - ZH / 2; })()`);
      await wait(600);
      const sty = await p.evaluate(() => GLWorld.style);
      await p.screenshot({ path: `${OUT}新畫面_牆_${sty}.png` });
    }
    continue;
  }
  await p.evaluate(`(() => { ${SETUP} ${code} })()`);
  await wait(name === 'bullets' ? 1600 : 900);
  await p.screenshot({ path: `${OUT}新畫面_${name}.png` });
  await p.evaluate(() => { Input.down = false; });
}
await b.close();
console.log('done');
