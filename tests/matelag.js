'use strict';
// 戰鬥中其他人的飛船在自己畫面上動得順不順（跟 roomlag.js 量房間的方法一樣）：兩份遊戲進戰鬥，一邊開船每 0.5 秒急轉，量另一邊畫面上那艘船每幀動多少
//   兩個方向：房主看隊友、隊友看房主；訊息延遲 LAT 毫秒（單程）
//   畫面上的位置：Net.drawPos(飛船)（有的話；沒有就是 x, y）
//   用法：node matelag.js [--lat=0,50,100]（release.js 跑預設的，超過門檻就失敗）
const vm = require('vm');
const { runFiles } = require('./load_game');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const LATS = (arg('lat') || '0,50,100').split(',').map(Number), JIT = +(arg('jit') || 30);  // JIT：網路抖動（毫秒）

function make() {
  let now = 0;
  const timers = [];
  const ctx = { console: { log() {}, warn() {}, error: console.error }, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {}, performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext('globalThis.__T = { Game, Net, CFG, Arena, Enemy, Input };', ctx);
  return { T: ctx.__T, adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); } };
}

function trial(LAT, hostMoves) {
  const A = make(), B = make(), HA = A.T, HB = B.T;
  let clock = 0, lat = 0;
  const qA = [], qB = [];
  // 網路抖動：每則訊息再隨機多延遲 0～JIT 毫秒（固定亂數，每次一樣）；同一條連線的訊息照順序到（跟 WebRTC 的可靠通道一樣）
  let seedJ = 12345, lastAt = { a: 0, b: 0 }; const jit = () => { seedJ = (seedJ * 16807) % 2147483647; return (seedJ / 2147483647) * JIT; };
  const wire = (q, ch) => ({ open: true, send: m => { const at = Math.max(clock + lat + (lat ? jit() : 0), lastAt[ch]); lastAt[ch] = at; q.push({ m: JSON.parse(JSON.stringify(m)), at }); }, close() {} });
  HA.Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };
  HA.Net.role = 'host'; HB.Net.role = 'client';
  for (const H of [HA, HB]) { H.Net.resetStats(); H.Net.code = 'TEST'; }
  HB.Net.conn = wire(qA, 'a'); const hostConn = wire(qB, 'b');
  const rec = { conn: hostConn, slot: 0, linked: false }; hostConn.rec = rec; HA.Net.pending.push(rec);
  const pump = () => { for (let i = 0; i < 20; i++) {
    const a = qA.filter(x => x.at <= clock), b = qB.filter(x => x.at <= clock);
    if (!a.length && !b.length) break;
    for (const x of a) qA.splice(qA.indexOf(x), 1); for (const x of b) qB.splice(qB.indexOf(x), 1);
    a.forEach(x => HA.Net.onData(x.m, hostConn.rec)); b.forEach(x => HB.Net.onData(x.m));
  } };
  const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { clock += dt * 1000; A.adv(dt * 1000); B.adv(dt * 1000); HA.Net.tick(dt); HA.Game.update(dt); HB.Net.tick(dt); HB.Game.update(dt); pump(); } };
  HA.Net.renderLobby(); HB.Net.renderLobby();
  HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); pump();
  HA.Net.setChapter(1); pump();
  HB.Net.ready('vanguard', 'laser', null); pump();
  HA.Net.ready('vanguard', 'laser', null); pump(); step(2);
  for (let g = 0; g < 20 && !(HA.Game.state === 'play' && HB.Game.state === 'play' && HA.Game.inArena); g++) {
    if (HA.Game.state === 'map' && HB.Game.state === 'map') { const r = HA.Game.reachable().find(n => n.type === 'combat') || HA.Game.reachable()[0]; HA.Net.vote(r.id); HB.Net.vote(r.id); pump(); }
    step(60);
  }
  if (!(HA.Game.state === 'play' && HB.Game.inArena)) return { err: `沒進到戰鬥（${HA.Game.state}/${HB.Game.state}）` };
  step(30);
  const GA = HA.Game, GB = HB.Game;
  // 清掉敵人、留一隻不動的標靶在遠處（這一區才不會清完、戰鬥結束）
  for (const e of GA.enemies) e.dead = true; GA.objs = []; GA.combat.pending = [];
  const keep = new HA.Enemy('dummy', GA.player.x + 2000, GA.player.y + 2000, 1); keep.spawnT = 0; keep.frozen = true; keep.hx = keep.x; keep.hy = keep.y; GA.enemies = [keep];
  GA.player.iframe = GA.mates[0].iframe = GB.player.iframe = 1e9;
  lat = LAT; step(150);  // 延遲開始後，讓兩邊都穩定下來（每秒量一次延遲，等它量到）
  // 開船的那一邊（mover）、看的那一邊（viewer）
  const [mv, vw] = hostMoves ? [HA, HB] : [HB, HA], ship = mv.Game.player, other = () => vw.Game.mates.find(m => m.slot === (hostMoves ? 1 : 2));
  const seen = m => vw.Net.drawPos ? vw.Net.drawPos(m) : [m.x, m.y];
  const keys = ['w', 'd', 's', 'a'];
  let k = 0;
  mv.Input.keys.add(keys[0]); step(30);
  const rows = [];
  for (let f = 0; f < 240; f++) {
    if (f % 30 === 0) { mv.Input.keys.delete(keys[k % 4]); k++; mv.Input.keys.add(keys[k % 4]); }
    const r0 = [ship.x, ship.y];
    step(1);
    const o = other();
    rows.push({ seen: o ? seen(o) : null, real: [ship.x, ship.y], realMove: Math.hypot(ship.x - r0[0], ship.y - r0[1]) });
  }
  mv.Input.keys.delete(keys[k % 4]);
  const moves = rows.slice(1).map((r, i) => r.seen && rows[i].seen ? Math.hypot(r.seen[0] - rows[i].seen[0], r.seen[1] - rows[i].seen[1]) : NaN);
  const speed = rows.reduce((a, r) => Math.max(a, r.realMove), 0);
  const still = moves.filter((m, i) => m < 0.01 && rows[i + 1].realMove > 0.5).length;
  const jump = Math.max(...moves.filter(Number.isFinite));
  const err = rows.slice(30).map(r => r.seen ? Math.hypot(r.seen[0] - r.real[0], r.seen[1] - r.real[1]) : NaN), errAvg = err.reduce((a, b) => a + b, 0) / err.length;
  return { still, n: moves.length, jump, speed, errAvg, errMax: Math.max(...err) };
}

// 門檻見 roomlag.js（同一套：房間和戰鬥共用 netMove／coast）
const LIMIT = { still: 0, jumpX: 1.5, err: { 0: 12, 50: 32, 100: 48 } };
let fail = 0;
console.log('戰鬥中，一邊開船（每 0.5 秒急轉），另一邊畫面上那艘船：');
for (const hostMoves of [false, true]) for (const L of LATS) {
  const r = trial(L, hostMoves), who = hostMoves ? '隊友看房主' : '房主看隊友';
  if (r.err) { console.log(`${who} 單程延遲 ${L}ms：${r.err}`); fail++; continue; }
  const bad = r.still > LIMIT.still || r.jump > r.speed * LIMIT.jumpX || r.errAvg > (LIMIT.err[L] != null ? LIMIT.err[L] : Infinity);
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} ${who} 單程延遲 ${String(L).padStart(3)}ms：沒動的幀 ${r.still}/${r.n}｜每幀最多動 ${r.jump.toFixed(1)}px（實際最快 ${r.speed.toFixed(1)}px，${(r.jump / r.speed).toFixed(2)} 倍）｜跟實際位置差 平均 ${Math.round(r.errAvg)}px、最多 ${Math.round(r.errMax)}px`);
}
if (!fail) console.log('ALL PASSED');
process.exitCode = fail ? 1 : 0;
