'use strict';
// 多人房間（共用的基地）裡，對方飛船在自己畫面上動得順不順：隊友在基地裡開船繞圈，量房主畫面上（Net.roomShips）那艘船每幀動多少
//   兩份遊戲用假的網路互連（跟 e2e.js 一樣），訊息延遲 LAT 毫秒（單程）
//   印：沒動的幀（對方一直在動）、每幀最多動多少（跟實際速度比）、跟對方實際位置差多少
//   用法：node roomlag.js [--lat=0,50,100]（release.js 跑預設的，超過門檻就失敗）
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
  vm.runInContext('globalThis.__T = { Game, Net, CFG, Hub, Input };', ctx);
  return { T: ctx.__T, adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); } };
}

function trial(LAT) {
  const A = make(), B = make(), HA = A.T, HB = B.T;
  let clock = 0;
  const qA = [], qB = [];
  const wire = q => ({ open: true, send: m => q.push({ m: JSON.parse(JSON.stringify(m)), at: clock + LAT }), close() {} });
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
  // 每幀：兩邊的基地更新（隊友開船）、連線、送訊息
  const step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { clock += dt * 1000; A.adv(dt * 1000); B.adv(dt * 1000); HA.Net.tick(dt); HB.Net.tick(dt); HA.Hub.update(dt); HB.Hub.update(dt); pump(); } };
  HA.Net.renderLobby(); HB.Net.renderLobby();
  HB.Net.send({ t: 'hello', v: HB.CFG.VERSION });
  for (let i = 0; i < 20 && !(HB.Net.linked && HA.Game.state === 'pick' && HB.Game.state === 'pick'); i++) step(10);
  if (!(HB.Net.linked && HA.Game.state === 'pick' && HB.Game.state === 'pick')) return { err: `沒進到房間（${HA.Game.state}/${HB.Game.state}）` };
  const S = HB.Hub.ship;
  // 隊友在大廳中間開船：每 0.5 秒換一個方向（上右下左），一直在動
  const keys = ['w', 'd', 's', 'a'];
  let k = 0;
  HB.Input.keys.add(keys[0]);
  step(60);
  const rows = [];
  for (let f = 0; f < 240; f++) {
    if (f % 30 === 0) { HB.Input.keys.delete(keys[k % 4]); k++; HB.Input.keys.add(keys[k % 4]); }
    const real0 = [S.x, S.y];
    step(1);
    const o = HA.Net.roomShips().find(q => q.slot === 2);
    rows.push({ seen: o ? [o.x, o.y] : null, real: [S.x, S.y], realMove: Math.hypot(S.x - real0[0], S.y - real0[1]) });
  }
  HB.Input.keys.delete(keys[k % 4]);
  const moves = rows.slice(1).map((r, i) => r.seen && rows[i].seen ? Math.hypot(r.seen[0] - rows[i].seen[0], r.seen[1] - rows[i].seen[1]) : NaN);
  const speed = rows.reduce((a, r) => Math.max(a, r.realMove), 0);  // 對方實際每幀最多動多少
  const still = moves.filter((m, i) => m < 0.01 && rows[i + 1].realMove > 0.5).length;
  const jump = Math.max(...moves.filter(Number.isFinite));
  if (process.env.RL_DBG) { const i = moves.indexOf(jump); console.log('DBG 跳最大在第', i, '幀；前後實際每幀移動', rows.slice(Math.max(0, i - 4), i + 4).map(r => r.realMove.toFixed(1)).join(' '), '｜畫面上每幀移動', moves.slice(Math.max(0, i - 4), i + 4).map(m => m.toFixed(1)).join(' ')); }
  const err = rows.slice(60).map(r => r.seen ? Math.hypot(r.seen[0] - r.real[0], r.seen[1] - r.real[1]) : NaN), errMax = Math.max(...err), errAvg = err.reduce((a, b) => a + b, 0) / err.length;
  return { still, n: moves.length, jump, speed, errMax, errAvg };
}

// 門檻照實測（2026-10-19，每 0.5 秒急轉、網路抖動 0～30ms）：房間和戰鬥共用 netMove／coast 之後，每幀最多 1.03～1.18 倍；
//   平均位置差（不補延遲，≈ 速度 × 延遲）房間 7／24／38px、戰鬥 2／19／31px（延遲 0／50／100ms）。以前直接蓋過去：抖動時跳 2 倍
const LIMIT = { still: 0, jumpX: 1.5, err: { 0: 12, 50: 32, 100: 48 } };
let fail = 0;
console.log('隊友在基地裡開船（一直在動），房主畫面上那艘船：');
for (const L of LATS) {
  const r = trial(L);
  if (r.err) { console.log(`單程延遲 ${L}ms：${r.err}`); fail++; continue; }
  const bad = r.still > LIMIT.still || r.jump > r.speed * LIMIT.jumpX || r.errAvg > (LIMIT.err[L] != null ? LIMIT.err[L] : Infinity);
  if (bad) fail++;
  console.log(`${bad ? 'FAIL' : 'ok  '} 單程延遲 ${String(L).padStart(3)}ms：沒動的幀 ${r.still}/${r.n}｜每幀最多動 ${r.jump.toFixed(1)}px（實際最快 ${r.speed.toFixed(1)}px，${(r.jump / r.speed).toFixed(2)} 倍）｜跟實際位置差 平均 ${Math.round(r.errAvg)}px、最多 ${Math.round(r.errMax)}px`);
}
if (!fail) console.log('ALL PASSED');  // release.js 照這行判斷（跟其他測試一樣）
process.exitCode = fail ? 1 : 0;
