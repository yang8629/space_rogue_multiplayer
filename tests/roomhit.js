'use strict';
// 多人房間（共用的基地）：互射推開、牽引鉤抓人。兩份獨立的遊戲用假的網路互連（跟 e2e.js 同一套）；從 e2e.js 拆出來：多跑的幀和房間訊息會改變 e2e 後面戰鬥的時機
const vm = require('vm');
const { runFiles } = require('./load_game');

function make(name) {
  let now = 0;
  const timers = [];
  const ctx = { console, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {},
    performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext('globalThis.__T = { Game, Net, Screen, Editor, CHIPS, NODE_META, Input, chipId, compileLine, WEAPONS, CFG, Arena, Hub, Enemy };', ctx);
  return {
    T: ctx.__T,
    run: code => vm.runInContext(code, ctx),
    adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); },
  };
}
const A = make('host'), B = make('client');
const HA = A.T, HB = B.T;
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } else console.log('ok  ', m); };

// 假網路：送出的訊息先排隊，pump 時才送達（和真的一樣是非同步）
const qA = [], qB = [];
let bytes = 0;
// PeerJS 的 json 模式：一則 ≥16300 位元組的訊息不送出、報錯（真的遊戲會當成斷線）→ 這裡照樣不送，記在 tooBig
let tooBig = 0, tooBigMax = 0;
const wire = (q) => ({ open: true, send: m => { const s = JSON.stringify(m), n = Buffer.byteLength(s); bytes += s.length;
  if (n >= 16300) { tooBig++; tooBigMax = Math.max(tooBigMax, n); return; }
  q.push(JSON.parse(s)); }, close() {} });
HA.Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };  // 房主的房間（假的 PeerJS）
HA.Net.role = 'host'; HB.Net.role = 'client';
for (const H of [HA, HB]) { H.Net.resetStats(); H.Net.code = 'TEST'; }
let CL = B;  // 目前連著的隊友（重新整理後會換成新的一份）
// 隊友連上房主：跟真的 PeerJS 一樣，房主那邊先多一筆還沒打招呼的連線（pending），收到 hello 才分號碼；
//   房主收到的訊息算在 hostConn.rec 那個隊友（斷線重連時 rejoinPeer 會把它換成原本那一筆）
let hostConn = null;
const connect = (C) => {
  C.T.Net.conn = wire(qA); hostConn = wire(qB);
  const q = { conn: hostConn, slot: 0, linked: false };
  hostConn.rec = q; HA.Net.pending.push(q);
};
const pump = () => { for (let i = 0; i < 20 && (qA.length || qB.length); i++) { qA.splice(0).forEach(m => HA.Net.onData(m, hostConn.rec)); qB.splice(0).forEach(m => CL.T.Net.onData(m)); } };
const step = (n = 1, dt = 1 / 60) => {
  for (let i = 0; i < n; i++) {
    A.adv(dt * 1000); CL.adv(dt * 1000);
    HA.Net.tick(dt); HA.Game.update(dt); CL.T.Net.tick(dt); CL.T.Game.update(dt);
    pump();
  }
};

HA.Net.renderLobby(); HB.Net.renderLobby();
connect(B); HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); pump();
ok(HA.Game.state === 'pick' && HB.Game.state === 'pick', 'both in the room (shared base)');
// 房間裡互射（不扣血、被打的人自己的電腦上被推開）、牽引鉤抓人（被勾的人自己的電腦上被拉、衝刺掙脫、右鍵甩出去）（10-23）
{
  const roomStep = n => { for (let i = 0; i < n; i++) { step(1); for (const H of [HA, HB]) if (H.Hub.shown()) { H.Hub.driving = true; H.Hub.update(1 / 60); H.Net.sendRoomPos(); } pump(); } };
  const A1 = HA.Hub, B1 = HB.Hub, place = () => { B1.ship.x = A1.ship.x + 150; B1.ship.y = A1.ship.y; B1.ship.vx = B1.ship.vy = 0; roomStep(20); };
  const aimB = () => { A1.ship.aim = Math.atan2(B1.ship.y - A1.ship.y, B1.ship.x - A1.ship.x); };
  A1.equip('laser'); place();
  const hp0 = B1.ship.hp, x0 = B1.ship.x;
  for (let i = 0; i < 20; i++) { aimB(); HA.Input.down = true; roomStep(1); }
  HA.Input.down = false; roomStep(5);
  ok(B1.ship.x - x0 > 15 && B1.ship.hp === hp0, `room: host's laser pushes the client on the client's side (moved ${Math.round(B1.ship.x - x0)}, hp ${hp0}->${B1.ship.hp})`);
  A1.equip('railgun'); place();
  aimB(); HA.Input.down = true; roomStep(1); HA.Input.down = false; for (let i = 0; i < 40; i++) { aimB(); roomStep(1); }
  const front = Math.hypot(B1.ship.x - (A1.ship.x + Math.cos(A1.ship.aim) * 70), B1.ship.y - (A1.ship.y + Math.sin(A1.ship.aim) * 70));
  const grabbed = B1.ship.grabBy === 1 && front < 40;
  HB.Input.dash = true; roomStep(10);
  const broke = !B1.ship.grabBy;
  roomStep(90); aimB(); HA.Input.down = true; roomStep(1); HA.Input.down = false; for (let i = 0; i < 40; i++) { aimB(); roomStep(1); }
  const held = B1.ship.grabBy === 1;
  HA.Input.alt = true; roomStep(2);
  const v = Math.hypot(B1.ship.vx, B1.ship.vy);
  ok(grabbed && broke && held && v > 500 && !B1.ship.grabBy, `room: grappling hook grabs the client on its side (${grabbed}, ${Math.round(front)} from host front), dash breaks (${broke}), fling (${held}, speed ${Math.round(v)})`);
  A1.equip('laser'); roomStep(30);
}
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exit(fails ? 1 : 0);
