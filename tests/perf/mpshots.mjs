// 雙人新畫面實測：開兩個瀏覽器（房主、隊友），訊息由這個腳本轉送（假的 PeerJS），進一場戰鬥擺好場景，
//   兩邊各截一張，拼成「房主看到的／隊友看到的」比較圖 → art_lab/screenshots/新畫面_雙人比較.png
//   用法：node perf/mpshots.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const MODE = 'gl';  // 舊畫面（2D）10-09 拿掉了
const wait = ms => new Promise(r => setTimeout(r, ms));
const open = async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 } });
  const p = await b.newPage();
  p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
  p.on('console', m => { if (m.type() === 'error') console.log('console', m.text().slice(0, 200)); });
  await p.goto(url);
  await p.evaluate(m => { try { localStorage.setItem('renderer', m); } catch (e) {} }, MODE);
  await p.reload(); await wait(2000);
  return { b, p };
};
const H = await open(), C = await open();
let sent = 0;
const relay = (to) => s => { sent++; to.p.evaluate(s => Net.onData(JSON.parse(s), Net.role === 'host' ? window.__q : null), s).catch(e => console.log('轉送失敗', e.message)); };
await H.p.exposeFunction('__send', relay(C));
await C.p.exposeFunction('__send', relay(H));
for (const [X, role] of [[H, 'host'], [C, 'client']]) await X.p.evaluate(role => {
  SFX.setMuted && SFX.setMuted(true);
  const conn = { open: true, send: m => window.__send(JSON.stringify(m)), close() {} };
  if (role === 'host') { window.__q = { conn, slot: 0, linked: false }; Net.pending.push(window.__q); } else Net.conn = conn;  // 房主：隊友打過招呼才分號碼
  Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };
  Net.role = role; Net.resetStats(); Net.code = 'TEST';
  if (role === 'host') Game.state = 'lobby';  // 房主在大廳才收新隊友
}, role);
await C.p.evaluate(() => Net.send({ t: 'hello', v: CFG.VERSION })); await wait(500);
// 大廳 → 選配裝 → 航圖
await H.p.evaluate(() => Net.setChapter(1)); await wait(500);  // 打完招呼就在共用的基地（房間），房主選章
await C.p.evaluate(() => Net.ready('gate', 'railgun', 'boomerang')); await wait(300);
await H.p.evaluate(() => Net.ready('wraith', 'plasma', 'amp'));
for (let i = 0; i < 60 && !(await H.p.evaluate(() => Game.state === 'map') && await C.p.evaluate(() => Game.state === 'map')); i++) await wait(200);  // 出發動畫播完才到航圖
console.log('狀態', await H.p.evaluate(() => Game.state), await C.p.evaluate(() => Game.state));
// 投票進同一個戰鬥節點
const nid = await H.p.evaluate(() => { const r = Game.reachable(); return (r.find(n => n.type === 'combat') || r[0]).id; });
await H.p.evaluate(id => Net.vote(id), nid); await C.p.evaluate(id => Net.vote(id), nid);
await wait(3500);
console.log('節點', await H.p.evaluate(() => Game.state + ' ' + (Game.node && Game.node.type)), await C.p.evaluate(() => Game.state));
// 擺場景：兩邊的配裝（零件、模組）、隊友站在房主旁邊；房主那邊放一排敵人（列隊蟲、王、各種狀態）
await C.p.evaluate(() => { Game.parts = { armor: 2, sink: 2, sensor: 1, booster: 1, larmor: 1 }; Game.recalc(); Net.sendLoadout && Net.sendLoadout(); Game.player.hp = Game.player.maxHp = 1e9; });
await H.p.evaluate(() => { Game.parts = { armor: 1, sink: 1 }; Game.recalc(); Game.player.hp = Game.player.maxHp = 1e9; });
await wait(400);
await H.p.evaluate(() => {
  const p = Game.player, A = Arena;
  Game.enemies = []; Game.combat.wave = 99; Game.combat.wavesTotal = 999; Game.combat.spawnQ = []; Game.combat.spawnT = 1e9;
  const free = (dx, dy) => { const x = p.x + dx, y = p.y + dy; return A.f ? (A.f(x, y) > 30 ? [x, y] : null) : [x, y]; };
  const put = (type, dx, dy, freeze = true) => { const q = free(dx, dy); if (!q) return null; const e = new Enemy(type, q[0], q[1], 1); e.spawnT = 0; if (freeze) { e.frozen = true; e.hx = q[0]; e.hy = q[1]; } e.t = { ...e.t, dmg: 0 }; e.hp = e.maxHp; Game.enemies.push(e); return e; };
  const T = ['swarmer', 'brute', 'spitter', 'elite', 'gunboat', 'shield', 'splitter', 'lurker', 'hive'];
  T.forEach((t, i) => { const e = put(t, -360 + (i % 5) * 170, -200 + Math.floor(i / 5) * 150); if (!e) return; if (t === 'lurker') e.cloak = 0; if (i === 1) { e.slowT = 3; e.burnT = 3; } if (i === 2) e.hp = e.maxHp * 0.4; if (i === 4) e.markT = 1e9; });
  let prev = null; for (let i = 0; i < 6; i++) { const w = put('worm', -200 - i * 22, 200, false); if (w) { w.ahead = prev; prev = w; } }
  window.__tick = setInterval(() => { for (const e of Game.enemies) if (e.frozen) { e.x = e.hx; e.y = e.hy; } }, 5);
});
await C.p.evaluate(() => { window.__hold = setInterval(() => { const q = Game.player; if (Game.mates[0]) { q.x = Game.mates[0].x + 60; q.y = Game.mates[0].y + 20; } }, 5); });
await wait(1500);
const info = async X => X.p.evaluate(() => ({ state: Game.state, enemies: Game.enemies.length, worms: Game.enemies.filter(e => e.type === 'worm').length, mate: !!Game.mates[0], gl: window.GLR ? GLR.on : null }));
console.log('房主', JSON.stringify(await info(H)));
console.log('隊友', JSON.stringify(await info(C)));
const shots = [];
for (const [X, label] of [[H, '房主看到的'], [C, '隊友看到的']]) {
  // 兩邊都以房主的船為中心截圖
  const pos = await X.p.evaluate(() => { const q = Net.role === 'host' ? Game.player : Game.mates[0]; return { x: (q.x - Game.cam.x) * ZOOM, y: (q.y - Game.cam.y) * ZOOM }; });
  const x = Math.max(0, Math.min(1280 - 760, pos.x - 380)), y = Math.max(0, Math.min(720 - 560, pos.y - 280));
  shots.push([label, await X.p.screenshot({ clip: { x, y, width: 760, height: 560 }, encoding: 'base64' })]);
}
await H.p.setContent(`<body style="margin:0;background:#05070f;display:flex;gap:8px;padding:8px;font:18px sans-serif;color:#dde">${shots.map(([l, d]) => `<div style="text-align:center"><img src="data:image/png;base64,${d}" style="width:760px;height:560px;display:block"><div style="padding:4px">${l}</div></div>`).join('')}</body>`);
await H.p.setViewport({ width: 16 + 2 * 768, height: 610 });
await H.p.screenshot({ path: `${OUT}新畫面_雙人比較.png` });
console.log('轉送訊息', sent);
await H.b.close(); await C.b.close();
console.log('done');
