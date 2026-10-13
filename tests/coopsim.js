// 雙人整局模擬：房主、隊友各一份遊戲（假網路互連，和 e2e.js 一樣），兩邊各由電腦操作（跟 runsim.js 同一套：自動瞄準、閃子彈、危險時衝刺）
// 照真實規則打完三個星區：航圖投票、各自拿獎勵／補給、倒下可以救援、兩人都倒下才輸
// 用法：node coopsim.js --n=20 [--tweak="..."（兩邊都先執行）] [--only=3,13（只跑這幾局，可以重現）]
'use strict';
const vm = require('vm'), fs = require('fs');
const { runFiles } = require('./load_game');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=').slice(1).join('=');
const N = +(arg('n') || 20), TWEAK = arg('tweak');
const WPN = ['laser', 'scatter', 'plasma', 'railgun', 'blade'];

// 電腦（bot/：跟整局模擬同一套），每一份遊戲各放一份
const { botSource } = require('./bot/load');
const BOT = `globalThis.__B = ${botSource(true)};
globalThis.__B.seed = function seed(n) { Math.random = () => { n = (n + 0x6D2B79F5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };`;

function make() {
  let now = 0;
  const timers = [];
  const ctx = { console, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {}, performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext(BOT, ctx);
  if (TWEAK) vm.runInContext(TWEAK, ctx);
  vm.runInContext('globalThis.__T = { Game, Net, CFG, SHIPS, NORMAL_IDS, pick, pickN, Arena, B: __B };', ctx);
  return { T: ctx.__T, adv(ms) { now += ms; const due = timers.filter(x => x.t <= now); timers.splice(0, timers.length, ...timers.filter(x => x.t > now)); due.forEach(x => x.f()); } };
}

// 卡住時的診斷（每一邊各一份）：波次、待生、剩下的敵人（位置、血量、在第幾區、離牆多遠）、兩架飛船、閘門、地圖種子
function why(H, who) {
  const G = H.Game, AR = H.Arena, C = G.combat || {}, r = Math.round;
  const zf = (x, y) => AR.rect ? '' : ` 區${AR.zoneOf(x, y)} 牆${r(AR.f(x, y))}`;
  const ship = (p, n) => p ? `${n} ${r(p.x)},${r(p.y)}${p.dead ? ' 倒下' : ''}${p.gone ? ' 離線' : ''} zone${p.zone}${zf(p.x, p.y)}` : `${n} 無`;
  return `[${who}] 狀態 ${G.state} 波次 ${C.wave}/${C.wavesTotal} 待生 ${(C.pending || []).length}；敵人 ${G.enemies.filter(e => !e.dead).map(e => `${e.t.name}@${r(e.x)},${r(e.y)} HP${r(e.hp)}${zf(e.x, e.y)}`).join(' ') || '無'}；${ship(G.player, '自己')}；${ship(G.mates[0], '隊友')}；閘門 ${AR.rect ? '方形場地' : AR.gates.map(g => (g.open ? '開' : '關')).join('') || '無'} 出口 ${G.exit ? r(G.exit.x) + ',' + r(G.exit.y) : '無'}；種子 ${AR.seed}`;
}
function oneRun(s) {
  const A = make(), C = make(), HA = A.T, HB = C.T;
  HA.B.seed(11000 + s * 7); HB.B.seed(22000 + s * 13);
  const qA = [], qB = [];
  const wire = q => ({ open: true, send: m => q.push(JSON.parse(JSON.stringify(m))), close() {} });
  HB.Net.conn = wire(qA);
  const q2 = { conn: wire(qB), slot: 0, linked: false };  // 房主那邊的隊友連線：打過招呼（hello）才分號碼
  HA.Net.peer = { destroyed: false, destroy() {}, on() {}, reconnect() {} };
  for (const [H, role] of [[HA, 'host'], [HB, 'client']]) { H.Net.role = role; H.Net.resetStats(); H.Net.code = 'SIM'; H.Net.goTime = 0; H.Game.simFast = true; }  // 電腦不用等出發倒數、區域肅清
  HA.Net.pending.push(q2);
  const pump = () => { for (let i = 0; i < 20 && (qA.length || qB.length); i++) { qA.splice(0).forEach(m => HA.Net.onData(m, q2)); qB.splice(0).forEach(m => HB.Net.onData(m)); } };
  const dt = 1 / 60;
  const step = (n = 1, fight = false) => {
    for (let i = 0; i < n; i++) {
      if (fight) { if (HA.Game.state === 'play' && !HA.Game.player.dead) HA.B.bot(HA.Game.player); if (HB.Game.state === 'play' && !HB.Game.player.dead) HB.B.bot(HB.Game.player); }
      A.adv(dt * 1000); C.adv(dt * 1000);
      HA.Net.tick(dt); HA.Game.update(dt); HB.Net.tick(dt); HB.Game.update(dt);
      pump();
    }
  };
  // 大廳 → 各自選飛船、武器、起始晶片 → 開始
  HA.Net.renderLobby(); HB.Net.renderLobby();
  HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); pump();
  HA.Net.beginPick(); pump();
  const wA = WPN[s % 5], wB = WPN[(s * 3 + 2) % 5];
  HB.Net.ready(HB.pick(Object.keys(HB.SHIPS)), wB, HB.pick(HB.pickN(HB.NORMAL_IDS, 3))); pump();
  HA.Net.ready(HA.pick(Object.keys(HA.SHIPS)), wA, HA.pick(HA.pickN(HA.NORMAL_IDS, 3))); pump(); step(2);
  const log = { won: false, sector: 1, layer: 0, fights: 0, downs: [0, 0], revives: 0, w: [wA, wB] };
  const GA = HA.Game;
  const odn = GA.playerDown.bind(GA); GA.playerDown = p => { log.downs[p === GA.player ? 0 : 1]++; return odn(p); };
  const orv = GA.revivePlayer.bind(GA); GA.revivePlayer = (p, q) => { log.revives++; return orv(p, q); };  // 戰鬥中被隊友救起來（房主這邊算）
  for (let guard = 0; guard < 400; guard++) {
    const sa = GA.state, sb = HB.Game.state;
    if (sa === 'map' && sb === 'map') {
      const a = HA.B.chooseNode(), b = HB.B.chooseNode();
      if (!a || !b) break;
      HA.Net.vote(a.id); HB.Net.vote(b.id); pump();
      step(2);  // 出發倒數設成 0（goTime）
      if (GA.node) log.layer = GA.node.L + 1;
      continue;
    }
    if (sa === 'play' || sb === 'play') {
      log.fights++;
      let t = 0;
      while ((GA.state === 'play' || HB.Game.state === 'play') && t < 300) { step(1, true); t += dt; }
      if (GA.state === 'play') { log.timeout = true; log.why = why(HA, '房主') + '\n    ' + why(HB, '隊友'); break; }
      step(3);
      continue;
    }
    if (sa === 'victory') {
      HA.B.handle(); HB.B.handle();  // 旗艦二選一、裝上旗艦模組（bot/pick.js 的 handle）
      pump(); step(1);
      if (GA.sector >= GA.lastSector()) { log.won = true; break; }
      GA.nextSector(); pump(); step(3); log.sector = GA.sector;
      continue;
    }
    if (sa === 'dead' || sa === 'lobby' || sa === 'title') break;
    HA.B.handle(); HB.B.handle(); pump(); step(3);
  }
  log.sector = GA.sector;
  const sum = o => Object.values(o || {}).reduce((x, y) => x + y, 0);
  log.dmg = [sum(GA.runStats && GA.runStats.dmg), sum(GA.mates[0] && GA.mates[0].L && GA.mates[0].L.R && GA.mates[0].L.R.dmg)];
  return log;
}

const WN = { laser: '雷射', scatter: '散彈', plasma: '電漿', railgun: '軌道', blade: '相刃' };
let won = 0, done = 0, stuck = 0, downs = 0, revives = 0, share = [];
const dieAt = {};
// --only=3,13：只跑這幾局（每局的亂數種子照局號固定，可以重現某一局）
const ONLY = arg('only') ? arg('only').split(',').map(Number) : null;
for (const s of ONLY || [...Array(N).keys()]) {
  const r = oneRun(s);
  if (r.timeout) { stuck++; process.stderr.write(`第 ${s} 局卡住：${WN[r.w[0]]}＋${WN[r.w[1]]}（星區 ${r.sector} 第 ${r.layer} 層）
    ${r.why}
`); continue; }
  done++;
  if (r.won) won++; else { const k = `${r.sector}-${r.layer}`; dieAt[k] = (dieAt[k] || 0) + 1; }
  downs += r.downs[0] + r.downs[1]; revives += r.revives;
  const tot = r.dmg[0] + r.dmg[1]; if (tot > 0) share.push(Math.max(r.dmg[0], r.dmg[1]) / tot);
  process.stderr.write(`第 ${s} 局：${WN[r.w[0]]}＋${WN[r.w[1]]} ${r.won ? '通關' : `死在 ${r.sector}-${r.layer}`}，倒下 ${r.downs.join('／')} 次（救起 ${r.revives}），傷害 ${r.dmg.map(Math.round).join('／')}\n`);
}
const top = Object.entries(dieAt).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, v]) => `${k}×${v}`).join('、');
const bySector = [1, 2, 3].map(sec => Object.entries(dieAt).filter(([k]) => k.startsWith(sec + '-')).reduce((a, [, v]) => a + v, 0));
console.log(`雙人整局：${done} 局（${stuck} 局卡住不算），通關 ${Math.round(won / Math.max(1, done) * 100)}%；死在第 1／2／3 星區 ${bySector.join('／')} 局（${top || '—'}）`);
console.log(`平均每局倒下 ${(downs / Math.max(1, done)).toFixed(1)} 次、戰鬥中被救起 ${(revives / Math.max(1, done)).toFixed(1)} 次；傷害比較多的那個人平均打了 ${Math.round(share.reduce((a, b) => a + b, 0) / Math.max(1, share.length) * 100)}% 的傷害`);
