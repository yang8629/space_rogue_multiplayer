'use strict';
// 光束＋網路延遲：房主判定「光束打到隊友」的時間，跟隊友自己畫面上「光束碰到船」的時間差多少
//   兩份遊戲（房主、隊友）用假的網路互連（跟 e2e.js 一樣），但訊息延遲 LAT 毫秒才送到（單程）
//   場景：星環守門者的光束轉過來，掃過站著不動的隊友（只看轉動不同步；隊友移動另外看 --move）
//   用法：node beamlag.js [--lat=0,30,60,100] [--move]（release.js 會跑預設的：站著不動、單程延遲 100ms 時差距要在 LIMIT 以內）
const vm = require('vm');
const { runFiles } = require('./load_game');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const LATS = (arg('lat') || '0,30,60,100').split(',').map(Number), MOVE = process.argv.includes('--move');

function make() {
  let now = 0;
  const timers = [];
  const ctx = { console: { log() {}, warn() {}, error: console.error }, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {}, performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext('globalThis.__T = { Game, Net, CFG, Arena, Enemy, Input, segDist2 };', ctx);
  return { T: ctx.__T, adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); } };
}

function trial(LAT) {
  const A = make(), B = make(), HA = A.T, HB = B.T;
  let clock = 0, lat = 0;  // 準備階段不延遲（只有量的時候才延遲）
  const qA = [], qB = [];
  const wire = q => ({ open: true, send: m => q.push({ m: JSON.parse(JSON.stringify(m)), at: clock + lat }), close() {} });
  HA.Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };
  HA.Net.role = 'host'; HB.Net.role = 'client';
  for (const H of [HA, HB]) { H.Net.resetStats(); H.Net.code = 'TEST'; }
  HB.Net.conn = wire(qA); const hostConn = wire(qB);
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
  // 進第一場戰鬥
  for (let g = 0; g < 20 && !(HA.Game.state === 'play' && HB.Game.state === 'play' && HA.Game.inArena); g++) {
    if (HA.Game.state === 'map' && HB.Game.state === 'map') { const r = HA.Game.reachable().find(n => n.type === 'combat') || HA.Game.reachable()[0]; HA.Net.vote(r.id); HB.Net.vote(r.id); pump(); }
    step(60);
  }
  if (!(HA.Game.state === 'play' && HB.Game.inArena)) return { err: `沒進到戰鬥（${HA.Game.state}/${HB.Game.state}）` };
  step(30);
  const GA = HA.Game, GB = HB.Game, M = GA.mates[0], me = GB.player, W = HA.CFG.WARDEN;
  for (const e of GA.enemies) e.dead = true; GA.enemies = []; GA.objs = []; GA.combat.pending = [];
  GA.player.iframe = 1e9;
  // 守門者放在隊友旁邊 400；光束開著（5 秒），角度算好：暖機 2.5 秒之後離隊友還差 0.6 弧度（再轉 1.6 秒掃到）；中途不重設角度（瞬間倒轉時隊友那邊要好幾次同步才追上，量測會失真）
  const core = new HA.Enemy('boss5', me.x - 400, me.y, 1); core.spawnT = 0; core.skillCd = 1e9; core.cd = W.beam + W.rest - 0.05;
  core.rot = Math.atan2(me.y - core.y, me.x - core.x) - 0.6 - W.spin * 2.5; GA.enemies.push(core);
  lat = LAT; step(150);  // 延遲開始後，讓兩邊都穩定下來（隊友每秒量一次延遲，等它量到）
  M.hp = M.maxHp = 1e6; M.iframe = 0; me.iframe = 0;
  let hostHit = null, seen = null, t = 0;
  const hurt = GA.hurtPlayer.bind(GA);
  GA.hurtPlayer = (dmg, cause, p, sx, sy) => { if (p === M && /光束/.test(cause) && hostHit == null) hostHit = t; return hurt(dmg, cause, p, sx, sy); };
  for (let i = 0; i < 240 && (hostHit == null || seen == null); i++) {
    if (MOVE) HB.Input.keys.add('w');  // 往上走：迎著掃過來的光束穿過去
    step(1); t += 1000 / 60;
    if (seen == null) for (const B2 of GB.bossBeams()) if (!B2.warn && HB.segDist2(B2.x1, B2.y1, B2.x2, B2.y2, me.x, me.y) < (me.r + B2.w / 2) ** 2) { seen = t; break; }
  }
  if (MOVE) HB.Input.keys.delete('w');
  const tip = W.spin * Math.hypot(me.x - core.x, me.y - core.y);  // 光束掃到隊友那裡的速度（px/秒）
  return { hostHit, seen, diff: hostHit != null && seen != null ? seen - hostHit : null, tip };
}

// 門檻照實測（2026-10-19）：隊友那邊補單程延遲之後，單程延遲 100ms 時差 50ms（8px）；不補是 133ms（20px）
const LIMIT = 66;
let fail = 0;
console.log(`光束掃過${MOVE ? '移動中' : '站著不動'}的隊友：房主判定打到 vs 隊友畫面上碰到（正 = 隊友還沒看到碰到就被扣血）`);
for (const L of LATS) {
  const r = trial(L);
  if (r.err) { console.log(`單程延遲 ${L}ms：${r.err}`); fail++; continue; }
  if (!MOVE && L === 100 && !(r.diff != null && r.diff <= LIMIT)) fail++;
  console.log(`單程延遲 ${String(L).padStart(3)}ms：房主判定 ${r.hostHit != null ? Math.round(r.hostHit) + 'ms' : '沒打到'}、隊友看到碰到 ${r.seen != null ? Math.round(r.seen) + 'ms' : '沒碰到'}｜差 ${r.diff != null ? Math.round(r.diff) + 'ms（光束在隊友那裡掃 ' + Math.round(r.tip) + 'px/秒 → 差 ' + Math.round(r.diff / 1000 * r.tip) + 'px）' : '—'}`);
}
if (!MOVE && LATS.includes(100)) console.log(fail ? `FAIL 單程延遲 100ms 時差距超過 ${LIMIT}ms（或沒量到）` : `ok   單程延遲 100ms 時差距在 ${LIMIT}ms 以內`);
if (!fail) console.log('ALL PASSED');  // release.js 照這行判斷（跟其他測試一樣）
process.exitCode = fail ? 1 : 0;
