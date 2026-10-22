'use strict';
// 多人的流量：兩份遊戲進戰鬥、兩邊都按住開火，量房主送給隊友的戰場快照（t: 's'）每秒多少位元組、每個欄位各佔多少
//   接法跟 matelag.js 一樣（假網路，沒有延遲）；兩邊都無敵，敵人照常一波波出來
//   --build=late：進戰鬥後兩個人的電路都換成後期配裝（BUILDS，子彈多）
//   用法：node netsize.js [--weapon=laser,scatter] [--sec=10] [--build=late]
const vm = require('vm');
const { runFiles } = require('./load_game');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const WEAPONS = (arg('weapon') || 'laser,scatter,blade').split(','), SEC = +(arg('sec') || 10);
const BUILDS = { late: ['weapon', 'shock', 'shock', 'shard', 'boomerang', 'shard', 'infect', null] };  // 照 splitChain：插件插在前一個晶片的插座
const BUILD = BUILDS[arg('build')] || null;

function make() {
  let now = 0;
  const timers = [];
  const ctx = { console: { log() {}, warn() {}, error: console.error }, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {}, performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext('globalThis.__T = { Game, Net, CFG, Input, splitChain, fullChip, analyzeChain, computePassives, mechStats };', ctx);
  return { T: ctx.__T, adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); } };
}

function trial(weapon) {
  const A = make(), B = make(), HA = A.T, HB = B.T;
  const qA = [], qB = [], size = {};  // size：欄位 → 累計位元組（量測期間）
  let measuring = false, total = 0, n = 0, bullets = 0;
  const wire = (q, toClient) => ({ open: true, close() {}, send: m => {
    const s = JSON.stringify(m);
    if (toClient && measuring && m.t === 's') {
      total += Buffer.byteLength(s); n++; bullets += (m.b || []).length;
      for (const k in m) size[k] = (size[k] || 0) + Buffer.byteLength(JSON.stringify(m[k]));
    }
    q.push(JSON.parse(s));
  } });
  HA.Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };
  HA.Net.role = 'host'; HB.Net.role = 'client';
  for (const H of [HA, HB]) { H.Net.resetStats(); H.Net.code = 'TEST'; }
  HB.Net.conn = wire(qA, false); const hostConn = wire(qB, true);
  const rec = { conn: hostConn, slot: 0, linked: false }; hostConn.rec = rec; HA.Net.pending.push(rec);
  const pump = () => { for (let i = 0; i < 20 && (qA.length || qB.length); i++) {
    const a = qA.splice(0), b = qB.splice(0);
    a.forEach(m => HA.Net.onData(m, hostConn.rec)); b.forEach(m => HB.Net.onData(m));
  } };
  const step = (k = 1, dt = 1 / 60) => { for (let i = 0; i < k; i++) { A.adv(dt * 1000); B.adv(dt * 1000); HA.Net.tick(dt); HA.Game.update(dt); HB.Net.tick(dt); HB.Game.update(dt); pump(); } };
  HA.Net.renderLobby(); HB.Net.renderLobby();
  HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); pump();
  HA.Net.setChapter(1); pump();
  HB.Net.ready('vanguard', weapon, null); pump();
  HA.Net.ready('vanguard', weapon, null); pump(); step(2);
  for (let g = 0; g < 20 && !(HA.Game.state === 'play' && HB.Game.state === 'play' && HA.Game.inArena); g++) {
    if (HA.Game.state === 'map' && HB.Game.state === 'map') { const r = HA.Game.reachable().find(q => q.type === 'combat') || HA.Game.reachable()[0]; HA.Net.vote(r.id); HB.Net.vote(r.id); pump(); }
    step(60);
  }
  if (!(HA.Game.state === 'play' && HB.Game.inArena)) return { err: `沒進到戰鬥（${HA.Game.state}/${HB.Game.state}）` };
  HA.Game.player.iframe = HA.Game.mates[0].iframe = HB.Game.player.iframe = 1e9;
  if (BUILD) for (const L of [HA.Game.L, HA.Game.mates[0].L]) {  // 子彈都由房主算：只換房主這邊的兩份配裝
    const r = HA.splitChain(BUILD.map(HA.fullChip));
    L.wSock = HA.CFG.WEAPON_SOCKETS; L.cap = 99;
    HA.Game.withLoadout(L, () => { Object.assign(HA.Game, { chain: r.chain, socks: r.socks }); HA.Game.stats = HA.analyzeChain(HA.Game.chain); HA.Game.passives = HA.computePassives(HA.Game.inventory); HA.Game.mech = HA.mechStats(HA.Game.parts, HA.Game.boons); });
  }
  HA.Input.down = HB.Input.down = true;
  step(120);  // 先射 2 秒，場上的子彈數量穩定
  // 子彈對不對：每幀拿隊友畫面上的子彈跟房主同編號的那顆比位置；extra = 房主那邊已經沒有的，miss = 房主在隊友附近、隊友那邊沒有的
  let errSum = 0, errN = 0, errMax = 0, extra = 0, miss = 0, frames = 0;
  const first = new Map();  // 房主的子彈第一次出現在第幾幀（剛射出的還沒輪到同步，不算漏掉）
  measuring = true;
  for (let f = 0; f < SEC * 60; f++) {
    step(1);
    if (!(HA.Game.state === 'play' && HB.Game.inArena)) continue;
    frames++;
    const host = new Map(HA.Game.bullets.filter(b => !b.dead).map(b => [b.nid, b])), mine = new Set();
    for (const b of HB.Game.bullets) {
      mine.add(b.nid);
      const o = host.get(b.nid);
      if (!o) { extra++; continue; }
      const d = Math.hypot(o.x - b.x, o.y - b.y); errSum += d; errN++; errMax = Math.max(errMax, d);
    }
    const P = HB.Game.player;
    for (const id of host.keys()) if (!first.has(id)) first.set(id, frames);
    for (const [id, o] of host) if (!mine.has(id) && Math.abs(o.x - P.x) < 900 && Math.abs(o.y - P.y) < 600 && frames - first.get(id) > 4) miss++;  // 同步 1/30 秒一次：4 幀內一定會送到
  }
  measuring = false;
  return { total, n, bullets, size, enemies: HA.Game.enemies.filter(e => !e.dead).length, acc: { avg: errN ? errSum / errN : 0, max: errMax, extra: extra / Math.max(1, frames), miss: miss / Math.max(1, frames) } };
}

const kb = v => (v / 1024).toFixed(1).padStart(6);
for (const w of WEAPONS) {
  const r = trial(w);
  if (r.err) { console.log(`${w}：${r.err}`); continue; }
  const top = Object.entries(r.size).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${(v / r.total * 100).toFixed(0)}%`).join('、');
  console.log(`${w.padEnd(8)}${BUILD ? '（後期）' : ''} 房主 → 隊友 每秒 ${kb(r.total / SEC)} KB（每則 ${(r.total / r.n / 1024).toFixed(1)} KB、每則平均子彈 ${(r.bullets / r.n).toFixed(0)} 顆、場上敵人 ${r.enemies}）｜${top}`);
  console.log(`         子彈位置誤差 平均 ${r.acc.avg.toFixed(1)}px、最大 ${r.acc.max.toFixed(0)}px｜每幀 隊友多出 ${r.acc.extra.toFixed(1)} 顆、漏掉 ${r.acc.miss.toFixed(1)} 顆`);
}
