'use strict';
// 斷線判斷（Net.keepAlive）：太久沒收到對方任何訊息就當成斷線（直接關掉瀏覽器、當機、網路斷掉時連線不會送出關閉通知）
//   1. 兩邊都正常跑 10 秒：不能誤判
//   2. 隊友切到背景（hid）：遊戲停住但照樣收得到訊息，10 秒沒有任何訊息也不算斷線；超過 NET_SILENT_HID（70 秒）才算
//   3. 隊友停住不送訊息（沒有 hid）：房主 NET_SILENT（5 秒）後把他移出房間；隊友那邊也一樣判斷房主斷線
//   4. 對方按離開、關掉分頁（Net.close 送 bye）：馬上知道
//   用法：node silent.js
const vm = require('vm');
const { runFiles } = require('./load_game');
function make() {
  let now = 0;
  const timers = [];
  const ctx = { console: { log() {}, warn() {}, error: console.error }, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {}, performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext('globalThis.__T = { Game, Net, CFG };', ctx);
  return { T: ctx.__T, now: () => now, adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); } };
}
// 房主＋一個隊友進同一個房間。cli.run false：隊友的遊戲停住（背景分頁）；cli.recv false：連訊息也收不到、送不出（關掉、當機）
//   host.run false：房主停住（訊息也不送到隊友）
function pair() {
  const A = make(), B = make(), HA = A.T, HB = B.T, qA = [], qB = [];
  const wire = q => ({ open: true, send: m => q.push(JSON.parse(JSON.stringify(m))), close() {} });
  for (const H of [HA, HB]) H.Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };
  HA.Net.role = 'host'; HB.Net.role = 'client';
  for (const H of [HA, HB]) { H.Net.resetStats(); H.Net.code = 'TEST'; }
  HB.Net.conn = wire(qA); const hostConn = wire(qB);
  const rec = { conn: hostConn, slot: 0, linked: false }; hostConn.rec = rec; HA.Net.pending.push(rec);
  const P = { A, B, HA, HB, cli: { run: true, recv: true }, host: { run: true } };
  P.pump = () => { for (let i = 0; i < 20 && (qA.length || qB.length); i++) {
    if (P.cli.recv) qA.splice(0).forEach(m => HA.Net.onData(m, hostConn.rec)); else qA.length = 0;
    if (P.cli.recv && P.host.run) qB.splice(0).forEach(m => HB.Net.onData(m)); else qB.length = 0;
  } };
  P.step = (sec, dt = 1 / 60) => { for (let i = 0; i < Math.round(sec * 60); i++) {
    A.adv(dt * 1000); if (P.host.run) { HA.Net.tick(dt); HA.Game.update(dt); }
    B.adv(dt * 1000); if (P.cli.run) { HB.Net.tick(dt); HB.Game.update(dt); }
    P.pump();
  } };
  HA.Net.renderLobby(); HB.Net.renderLobby();
  HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); P.pump();
  return P;
}
// 跑到 cond 成立（最多 max 秒），回傳花了幾秒
const until = (P, cond, max) => { let t = 0; while (t < max && !cond()) { P.step(0.25); t += 0.25; } return t; };
let fails = 0;
const ok = (c, m) => { console.log((c ? 'ok   ' : 'FAIL ') + m); if (!c) fails++; };

{
  const P = pair(), { HA, HB } = P;
  ok(HA.Net.peers.length === 1 && HB.Net.linked && HA.Game.state === 'pick', '隊友進到房間');
  P.step(10);
  ok(HA.Net.peers.length === 1 && HA.Net.peers[0].linked && HB.Net.linked, '兩邊正常跑 10 秒：沒有誤判斷線');
  HB.Net.send({ t: 'hid', on: true }); P.pump(); P.cli.run = false;
  P.step(10);
  ok(HA.Net.peers.length === 1 && HA.Net.peers[0].linked, '隊友切到背景後 10 秒沒有任何訊息：不算斷線');
  P.cli.run = true; HB.Net.send({ t: 'hid', on: false }); P.pump(); P.step(2);
  ok(HA.Net.peers.length === 1 && HA.Net.peers[0].linked && HB.Net.linked, '隊友回來：照常連著');
  P.cli.run = P.cli.recv = false;
  const t = until(P, () => !HA.Net.peers.length, 15);
  ok(!HA.Net.peers.length && t >= 5 && t <= 6, `隊友停住不送訊息：房主 ${t} 秒後把他移出房間（應該 5～6 秒）`);
}
{
  const P = pair(), { HB } = P;
  P.step(2); P.host.run = false;
  const t = until(P, () => !HB.Net.role, 15);
  ok(!HB.Net.role && t >= 5 && t <= 6, `房主停住：隊友 ${t} 秒後判斷房主斷線（應該 5～6 秒）`);
}
{
  const P = pair(), { HA, HB } = P;
  P.step(2); HB.Net.send({ t: 'hid', on: true }); P.pump(); P.cli.run = P.cli.recv = false;  // 切到背景之後就沒消息（關分頁也會先觸發切到背景）、沒送出 bye
  const t = until(P, () => !HA.Net.peers.length, 90);
  ok(!HA.Net.peers.length && t >= 70 && t <= 71, `隊友切到背景後就沒消息：房主 ${t} 秒後才移出（應該 70～71 秒）`);
}
{
  const P = pair(), { HA, HB } = P;
  P.step(2); HB.Net.close(); P.pump();
  ok(!HA.Net.peers.length, '隊友按離開（送 bye）：房主馬上把他移出房間');
  const Q = pair();
  Q.step(2); Q.HA.Net.close(); Q.pump();
  ok(!Q.HB.Net.role, '房主關掉（送 bye）：隊友馬上知道');
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
