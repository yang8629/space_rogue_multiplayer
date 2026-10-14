'use strict';
// 端對端：兩份獨立的遊戲（房主、隊友）用假的網路互連，跑完整個星區 1 → 進入星區 2
const vm = require('vm');
const { runFiles } = require('./load_game');

function make(name) {
  let now = 0;
  const timers = [];
  const ctx = { console, setTimeout: (f, ms) => timers.push({ t: now + (ms || 0), f }), clearTimeout() {},
    performance: { now: () => now }, navigator: {} };
  vm.createContext(ctx);
  runFiles((code, opt) => vm.runInContext(code, ctx, opt));
  vm.runInContext('globalThis.__T = { Game, Net, Screen, Editor, CHIPS, NODE_META, Input, chipId, compileChain, WEAPONS, CFG, Arena };', ctx);
  return {
    T: ctx.__T,
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
const wire = (q) => ({ open: true, send: m => { const s = JSON.stringify(m); bytes += s.length; q.push(JSON.parse(s)); }, close() {} });
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

// ---- 大廳 → 選配裝 → 開始 ----
HA.Net.renderLobby(); HB.Net.renderLobby();
connect(B); HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); pump();
ok(HA.Net.linked && HA.Net.mateInRoom && HB.Net.linked && HB.Net.slot === 2 && HA.Net.peers.length === 1, 'client joined the room as 2P');
HA.Net.beginPick(); pump();
ok(HA.Game.state === 'pick' && HB.Game.state === 'pick', 'both in pick');
HB.Net.ready('gate', 'railgun', 'split'); pump();
ok(HB.Game.state === 'wait', 'client waits for host');
HA.Net.ready('bulwark', 'plasma', 'amp'); pump(); step(2);
ok(HA.Game.state === 'map' && HB.Game.state === 'map', 'both on map after start');
ok(JSON.stringify(HA.Net.packMap(HA.Game.map)) === JSON.stringify(HB.Net.packMap(HB.Game.map)), 'client received identical map');
ok(HA.Net.peers[0].at === 'map' && HA.Net.voteEnd > 0, 'vote timer started when both on map');
ok(HA.Game.mates[0].L.inventory[0] === 'split' && HB.Game.inventory[0] === 'split' && HB.Game.chain[1] === null, 'host knows client start chip (component -> inventory)');
ok(HA.Game.inventory[0] === 'amp' && HA.Game.chain[1] === null, 'start component goes to inventory, not circuit');

// ---- 錢：各自的錢包 ----
HA.Game.credits = 100; HB.Game.credits = 40; step(3);
ok(HA.Game.credits === 100 && HB.Game.credits === 40, 'wallets are independent (no sync overwrite)');
let paid = false;
HB.Game.pay(30, () => { paid = true; }); pump(); step(1);
ok(paid && HB.Game.credits === 10 && HA.Game.credits === 100, 'client spends own wallet only');
HB.Game.earn(10); pump(); step(1);
ok(HB.Game.credits === 20 && HA.Game.credits === 100, 'skip/recycle income is own only');
paid = false; HB.Game.pay(30, () => { paid = true; });
ok(!paid && HB.Game.credits === 20, 'cannot overspend own wallet');
// ---- 插座（晶片 id 帶插座數）、黑洞強化的格子與配裝同步；隊友電路上的等級（組件升級）房主照插座算 ----
const sk = HB.chipId('sticky', 2);
HB.Game.inventory[0] = sk; HB.Game.socks = [['amp']]; HB.Game.wSock = 2; HB.Game.slotAttr = [null, 'eff', 'flaky']; HB.Game.recalc(); HB.Net.sendLoadout(); pump();
ok(HA.Game.mates[0].L.inventory[0] === sk && HA.CHIPS[sk] && HA.CHIPS[sk].sk === 2, `socketed chip registered on host (${sk})`);
{
  HB.Game.chain[1] = HB.chipId('rear', 2); HB.Game.socks = [['amp'], ['split', 'pierce']]; HB.Game.recalc(); HB.Net.sendLoadout(); pump();
  const L = HA.Game.mates[0].L, lv = HA.compileChain(L.chain, L.slotAttr, L.socks, 99).info[1].lv;
  ok(lv === 3, `mate chip level from its sockets on host (rear + 2 comps → Lv${lv})`);
  HB.Game.chain[1] = null; HB.Game.socks = [['amp']]; HB.Game.recalc(); HB.Net.sendLoadout(); pump();
}
ok(JSON.stringify(HA.Game.mates[0].L.socks[0]) === '["amp"]' && HA.Game.mates[0].L.slotAttr[1] === 'eff' && HA.Game.mates[0].L.slotAttr[2] === 'flaky', 'slot attributes synced to host');
ok(HA.Game.mates[0].L.wSock === 2, `weapon sockets synced to host (${HA.Game.mates[0].L.wSock})`);

// ---- 跑完整個星區：投票 → 進節點 → 處理 → 回航圖 ----
const both = f => { f(HA); f(HB); };
let drawn = 0, fights = 0, pausedChecked = false, sector2 = false, guard = 0, goChecked = false;
function killAll() { for (const e of HA.Game.enemies) if (!e.dead && e.spawnT <= 0) e.hurt(1e6, 0, 0, 'direct', { src: 'weapon', cr: null, owner: Math.random() < 0.5 ? null : HA.Game.mates[0].L }); }
function finishNode(H) {
  const G = H.Game;
  switch (G.state) {
    case 'reward':
      G.takeReward(G.reward.options.find(id => G.canAcquire(id)) || null); if (G.state === 'editor') G.toggleEditor(); break;
    case 'workshop': G.wsPick(G.ws.options[0]); G.showMap(); break;
    case 'shop': case 'blackhole': case 'armory': G.showMap(); break;
  }
}
while (!sector2 && guard++ < 40) {
  step(2);
  if (HA.Game.state !== 'map' || HB.Game.state !== 'map') { console.error('not both on map', HA.Game.state, HB.Game.state); fails++; break; }
  const reach = HA.Game.reachable();
  const a = reach[0], b = reach[reach.length - 1];
  HA.Net.vote(a.id); HB.Net.vote(b.id); pump();
  if (a !== b) drawn++;
  step(120); if (!goChecked) { goChecked = true; ok(HA.Game.state === "going" && HB.Game.state === "going", `2 秒時還在出發倒數（${HA.Game.state} / ${HB.Game.state}）`); }
  step(80);  // 抽籤畫面、出發倒數 3 秒
  ok(HA.Game.node && HB.Game.node && HA.Game.node.id === HB.Game.node.id, `both entered ${HA.Game.node && HA.Game.node.type} ${HA.Game.node && HA.Game.node.id}${a !== b ? '（抽籤）' : ''}`);
  const type = HA.Game.node.type;
  if (['combat', 'elite', 'boss'].includes(type)) {
    fights++;
    HA.Game.player.hp = HA.Game.player.maxHp = 1e6; HA.Game.mates[0].hp = HA.Game.mates[0].maxHp = 1e6;
    if (!pausedChecked) {  // Tab：隊友編輯電路 → 房主整個暫停
      step(200);
      HB.Game.toggleEditor(); pump(); step(1);
      const snap = HA.Game.enemies.map(e => e.x + ',' + e.y).join('|'), t0 = HA.Game.time;
      step(60);
      ok(HA.Net.mateEditing && HA.Game.time === t0 && HA.Game.enemies.map(e => e.x + ',' + e.y).join('|') === snap, 'client editing freezes host simulation');
      HB.Game.chain[2] = 'pierce';
      HB.Game.toggleEditor(); pump(); step(5);
      ok(!HA.Net.mateEditing && HA.Game.time > t0 && HA.Game.mates[0].L.chain[2] === 'pierce', 'closing editor resumes and syncs new chain');
      pausedChecked = true;
      // 救援：隊友倒下 → 房主離很遠不會救 → 靠近 2 秒救起，房主分出一半血量
      const GA = HA.Game, P = GA.player, M = GA.mates[0], R = HA.CFG.REVIVE;
      P.iframe = M.iframe = 1e9;
      P.hp = 80; P.maxHp = M.maxHp = 100; M.hp = 100;
      const AA = HA.Arena, near = (q, d) => { for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, x = q.x + Math.cos(a) * d, y = q.y + Math.sin(a) * d; if (AA.f(x, y) > 40 && AA.clearLine(q.x, q.y, x, y, 10)) return [x, y]; } return [q.x, q.y]; };  // 大地圖：找空地上的點（寫死的座標可能在牆裡）
      HB.Game.player.x = AA.start.x; HB.Game.player.y = AA.start.y; step(5);
      [P.x, P.y] = AA.randomIn(0, 40, [{ x: AA.start.x, y: AA.start.y }], 700);
      GA.playerDown(M); step(5);
      ok(M.dead && HB.Game.player.dead, 'revive: client downed on both sides');
      step(150);
      ok(M.dead && M.reviveT === 0, 'revive: far away teammate does not revive');
      [P.x, P.y] = near(M, R.range * 0.5); step(60);
      ok(M.dead && HB.Game.player.dead && HB.Game.player.reviveT > 0.8 && HB.Game.mates[0].reviveT === 0, `revive: progress synced to client (${HB.Game.player.reviveT})`);
      step(70);
      ok(!M.dead && !HB.Game.player.dead && Math.abs(M.hp - 40) < 0.01 && Math.abs(P.hp - 40) < 0.01 && Math.abs(HB.Game.player.hp - 40) < 0.01,
        `revive: rescued with half of rescuer HP (mate ${M.hp}, host ${P.hp}, client sees ${HB.Game.player.hp})`);
      // 反過來：房主倒下，隊友走過來救
      M.iframe = 1e9;  // 救起後只有 1.5 秒無敵，測試期間別被怪打到
      GA.playerDown(P); step(5);
      ok(P.dead && HB.Game.mates[0].dead, 'revive: host downed, client sees it');
      HB.Game.player.x = P.x + 20; HB.Game.player.y = P.y; step(130);
      ok(!P.dead && !HB.Game.mates[0].dead && Math.abs(P.hp - 20) < 0.01, `revive: client rescues host (host ${P.hp})`);
      P.iframe = M.iframe = 0;
      P.hp = P.maxHp = 1e6; M.hp = M.maxHp = 1e6;
    }
    step(10);
    ok(HB.Game.objs.length === HA.Game.objs.filter(o => o.type !== 'cometgen').length, `map objects synced (${HB.Game.objs.map(o => o.type).join(',') || 'none'})`);
    const sA0 = HA.Game.chain.length, sB0 = HB.Game.chain.length;  // 打之前的插槽數（零件的機體強化也會 +1，所以跟打之前比）
    const cA0 = HA.Game.credits, cB0 = HB.Game.credits, rw = { combat: 0, elite: 15, boss: 50 }[type];
    if (type !== 'boss') ok(!HA.Arena.rect && HB.Arena.seed === HA.Arena.seed && HB.Arena.W === HA.Arena.W && HB.Arena.gates.length === HA.Arena.gates.length, `${type}: client built the same big map (seed ${HB.Arena.seed} / ${HA.Arena.seed})`);
    let gatesSeen = 0;
    for (let i = 0; i < 400 && HA.Game.inArena; i++) {  // 大地圖：閘門打開後，房主直接放到閘門前面一點（穿過去）
      killAll();
      const g = HA.Arena.gates[HA.Game.player.zone];
      step(5);
      if (HB.Arena.gates.some(q => q.open)) gatesSeen = 100;
      if (HA.Game.exit && g && g.open) { HA.Game.player.x = g.x + g.nx * 40; HA.Game.player.y = g.y + g.ny * 40; }
    }
    if (type !== 'boss') ok(gatesSeen >= 100, `${type}: client saw the gate open`);
    step(5);
    const gA = HA.Game.credits - cA0, gB = HB.Game.credits - cB0;
    ok(gA === gB && gA > rw, `drops shared: host +${gA}, client +${gB}`);
    ok(!HA.Game.inArena && !HB.Game.inArena, `${type} won on both sides (host ${HA.Game.state}, client ${HB.Game.state})`);
    if (type === 'boss') {
      ok(HA.Game.state === 'victory' && HB.Game.state === 'victory', 'both see victory');
      // 旗艦二選一（電路插槽 +1／零件格 +1，各選各的）：房主要等隊友選好才能前往
      const pA0 = HA.Game.partSlots, pB0 = HB.Game.partSlots;
      const btn = (act, arg) => ({ dataset: { act, arg }, disabled: false });
      HA.Screen.clickLock = 0; HB.Screen.clickLock = 0;
      const unpicked = HA.Game.chain.length === sA0 && HB.Game.chain.length === sB0 && HA.Game.partSlots === pA0 && String(HB.Screen.el.innerHTML).includes('data-act="bossslot"');
      HA.Screen.act(btn('next')); pump();
      const blockPick = HA.Game.sector === 1 && String(HA.Screen.el.innerHTML).includes('先選一個獎勵');
      HA.Screen.act(btn('bossslot', 'chain')); pump();
      const waited = HA.Net.modWaiting() && String(HB.Screen.el.innerHTML).includes('data-act="bossslot"');
      HA.Screen.act(btn('next')); pump();
      const blocked = HA.Game.sector === 1 && String(HA.Screen.el.innerHTML).includes('等隊友選好獎勵');
      HB.Screen.act(btn('bossslot', 'part')); pump(); step(1);
      ok(unpicked && HA.Game.chain.length === sA0 + 1 && HA.Game.partSlots === pA0 && HB.Game.chain.length === sB0 && HB.Game.partSlots === pB0 + 1,
        `boss pick: host chain ${sA0} → ${HA.Game.chain.length} (parts ${pA0} → ${HA.Game.partSlots}), client parts ${pB0} → ${HB.Game.partSlots} (chain ${sB0} → ${HB.Game.chain.length})`);
      ok(blockPick && waited && blocked && !HA.Net.modWaiting(),
        `host waits for own pick + teammate's pick (pick block ${blockPick}, waited ${!!waited}, blocked ${blocked}, after pick ${HA.Net.modWaiting()})`);
      HA.Game.nextSector(); pump(); step(3);
      ok(HB.Game.sector === 2 && HA.Game.sector === 2 && HA.Game.bossId === HB.Game.bossId &&
        JSON.stringify(HA.Net.packMap(HA.Game.map)) === JSON.stringify(HB.Net.packMap(HB.Game.map)), 'sector 2 map synced');
      sector2 = true;
      break;
    }
  }
  both(finishNode); pump(); step(3);
}
const np = P => ["armor", "larmor", "booster", "sink", "sensor"].map(k => (P && P[k]) || 0).join(",");
ok(np(HA.Game.mates[0].L.parts) === np(HB.Game.parts) && HA.Game.mates[0].L.partSlots === HB.Game.partSlots,
  `client parts synced to host (client ${JSON.stringify(HB.Game.parts)} / ${HB.Game.partSlots}; host sees ${JSON.stringify(HA.Game.mates[0].L.parts)} / ${HA.Game.mates[0].L.partSlots})`);
ok(sector2, `reached sector 2 (${fights} fights, ${drawn} drawn votes)`);
const dA = Object.values(HA.Game.runStats.dmg).reduce((x, y) => x + y, 0), dM = Object.values(HA.Game.mates[0].L.R.dmg).reduce((x, y) => x + y, 0);
const dB = Object.values(HB.Game.runStats.dmg).reduce((x, y) => x + y, 0);
ok(dA > 0 && dM > 0 && Math.abs(dB - dM) < 2, `per-player damage: host ${Math.round(dA)}, mate ${Math.round(dM)}, client sees ${Math.round(dB)}`);
ok(HA.Net.lootTotal === HB.Net.lastLoot && HA.Net.lootTotal > 0, `loot counter in sync (${HA.Net.lootTotal})`);
{
  const sum = o => Object.values(o).reduce((x, y) => x + y, 0), RB = HB.Game.runStats;
  ok(Math.abs(sum(RB.chips) - sum(RB.dmg)) <= Object.keys(RB.chips).length + Object.keys(RB.dmg).length,
    `client chip damage adds up (chips ${sum(RB.chips)} vs total ${sum(RB.dmg)})`);
  // 房主記的隊友晶片傷害，傳到隊友那邊照原本的 key 存
  const LR = HA.Game.mates[0].L.R;
  LR.chips.amp = (LR.chips.amp || 0) + 1234; LR.dmg.direct += 1234;
  HA.Net.sendDmg(); pump();
  ok(RB.chips.amp === Math.round(LR.chips.amp), `client keeps chip damage (amp: ${RB.chips.amp})`);
  ok(HB.Net.team[1].nm && HB.Net.team[1].nm.weapon && HB.Net.team[1].nm.weapon[0].includes(HA.WEAPONS[HA.Game.weapon.id].name),
    `client gets host weapon name for the teammate table (${HB.Net.team[1].nm && HB.Net.team[1].nm.weapon})`);
  for (const [H, who] of [[HA, 'host'], [HB, 'client']]) {
    H.Editor.renderDmg();
    const h = H.Editor.dmgEl.innerHTML;
    ok(h.includes('多人傷害結算') && h.includes('隊友（整局）') && !/msg_|sg_\d/.test(h), `${who}: damage tab shows both players with names`);
  }
  for (const [H, who, other] of [[HA, 'host', HB], [HB, 'client', HA]]) {
    const rec = H.Net.buildRecord('in_progress'), mine = other.Net.buildRecord('in_progress');
    const sum = a => a.reduce((x, [, v]) => x + v, 0);
    ok(rec.coop.mateChipDmg.length > 0 && Math.abs(sum(rec.coop.mateChipDmg) - sum(mine.chipDmg)) <= 2 * mine.chipDmg.length,
      `${who}: record has teammate chip damage (${sum(rec.coop.mateChipDmg)} vs teammate's own ${sum(mine.chipDmg)})`);
    // 雙人紀錄跟單人同一份：受傷、各關摘要、走過的節點、取得的晶片、電路數值都要有
    ok(rec.taken && typeof rec.hits === 'number' && rec.sectors.length > 0 && rec.path.length > 0 && Array.isArray(rec.got) && rec.stats && rec.mode === 'coop',
      `${who}: record has the solo fields too (path ${rec.path.length}、sectors ${rec.sectors.length}、hits ${rec.hits}、got ${rec.got.length})`);
    // 救援測試裡兩人各倒一次、各救對方一次；連線停頓的位置、次數有記
    const T = rec.coop.team, txt = H.Screen.compactRecord ? H.Screen.compactRecord(rec) : '';
    ok(T.every(t => t.downs === 1 && t.revives === 1) && typeof rec.coop.sync.gaps150 === 'number' && 'maxGapAt' in rec.coop.sync,
      `${who}: downs/revives recorded (${T.map(t => `${t.who} 倒${t.downs} 救${t.revives}`).join('、')})、停頓 ${rec.coop.sync.gaps150} 次`);
  }
  ok(HA.Net.stats.maxGap < 3000 && HB.Net.stats.maxGap < 3000, `sync max gap ignores time off combat (host ${Math.round(HA.Net.stats.maxGap)} ms, client ${Math.round(HB.Net.stats.maxGap)} ms)`);
}

// ---- 斷線重連：同一個頁面（按「重新連線」） ----
const fakeJoin = (C) => function (code, runId) {  // 取代真的 PeerJS：直接接上假網路再打招呼
  this.role = 'client'; this.code = code;
  connect(C);
  this.send({ t: 'hello', v: C.T.CFG.VERSION, resume: runId, slot: 2 });
};
HB.Net.join = fakeJoin(B);
const chainB = JSON.stringify(HB.Game.chain), invB = JSON.stringify(HB.Game.inventory), crB = HB.Game.credits;
HA.Net.lost('測試斷線'); HB.Net.lost('測試斷線');
ok(HA.Net.waiting && HA.Net.pauseReason() && HB.Net.rejoin, 'drop: host waits (paused), client offers rejoin');
const tWait = HA.Game.time; step(30);
ok(HA.Game.time === tWait, 'host frozen while waiting');
step(100);  // 1.5 秒後自動重連
ok(HA.Net.linked && !HA.Net.waiting && !HA.Net.mateAway && HB.Net.linked && !HB.Net.rejoin, 'auto rejoin succeeded');
ok(JSON.stringify(HB.Game.chain) === chainB && JSON.stringify(HB.Game.inventory) === invB && HB.Game.credits === crB && HB.Game.state === 'map',
  'same page: loadout, credits kept, back on map');

// ---- 斷線重連：隊友重新整理了頁面（全新的一份遊戲），輸入同一個房號回來 ----
HA.Net.lost('測試斷線');
const C = make('client-refreshed'), HC = C.T;
CL = C;
HC.Net.join = fakeJoin(C);
HC.Net.renderLobby();
HC.Net.join('TEST', null);  // 重新整理後沒有 runId
pump(); step(3);
const skId = JSON.parse(invB)[0];
ok(HC.Game.mode === 'coop' && HC.Game.state === 'map' && HA.Net.linked && !HA.Net.mateAway, 'refreshed client resumed the run');
ok(JSON.stringify(HC.Game.chain) === chainB && JSON.stringify(HC.Game.inventory) === invB, `refreshed: loadout restored from host (${chainB})`);
ok(HC.CHIPS[skId] && HC.CHIPS[skId].sk === 2 && HC.Game.slotAttr[1] === 'eff', `refreshed: socketed chip ${skId} and slot attributes restored`);
ok(HC.Game.credits === crB, `refreshed: wallet restored (${HC.Game.credits} = ${crB})`);
ok(HC.Game.sector === HA.Game.sector && JSON.stringify(HC.Net.packMap(HC.Game.map)) === JSON.stringify(HA.Net.packMap(HA.Game.map)), 'refreshed: same sector and map');
// 繼續玩：一起進下一個節點
{
  const r = HA.Game.reachable()[0];
  HA.Net.vote(r.id); HC.Net.vote(r.id); pump(); step(200);
  ok(HA.Game.node.id === HC.Game.node.id, `after refresh-resume both entered ${HA.Game.node.type}`);
  if (HA.Game.inArena) {  // 戰鬥中再斷一次 → 重新整理 → 回到戰鬥
    step(120);
    HA.Net.lost('測試斷線');
    const D = make('client-refreshed-2'), HD = D.T;
    CL = D; HD.Net.join = fakeJoin(D); HD.Net.renderLobby(); HD.Net.join('TEST', null); pump(); step(3);
    ok(HD.Game.inArena && HD.Game.state === 'play' && HD.Game.combat.wave === HA.Game.combat.wave, `mid-combat refresh: back in combat wave ${HD.Game.combat.wave}`);
    step(60);
    ok(HD.Game.enemies.length === HA.Game.enemies.filter(e => !e.dead).length, 'mid-combat refresh: snapshots flowing');
  }
}

// ---- 房主選「自己繼續」，之後隊友再回來 ----
{
  if (HA.Game.inArena) { for (let i = 0; i < 400 && HA.Game.inArena; i++) { killAll(); step(5); } }
  const finish = H => { const G = H.Game; if (G.state === 'reward') G.takeReward(null); else if (['shop', 'blackhole', 'armory', 'workshop', 'victory'].includes(G.state) && G.state !== 'victory') G.showMap(); };
  finish(HA); step(3);
  HA.Net.lost('測試斷線');
  ok(HA.Net.waiting, 'host waiting again');
  HA.Net.soloContinue();
  ok(!HA.Net.waiting && HA.Net.solo && HA.Game.mates[0].gone && !HA.Net.pauseReason() && HA.Game.players().length === 1, 'host continues solo (not paused, mate absent)');
  if (HA.Game.state === 'map') {
    const r = HA.Game.reachable()[0];
    HA.Net.vote(r.id); step(200);
    ok(HA.Game.node && HA.Game.node.id === r.id, `solo host moves alone to ${r.type}`);
    if (HA.Game.inArena) {
      step(200);
      const e = HA.Game.enemies.find(x => !x.t.boss);
      const lv = HA.Game.combat.level, wv = HA.Game.combat.wave;  // 單人血量倍率：1 ＋ 0.1×難度 ＋ 0.01×難度² ＋（波次 − 1）× 0.08（見 enemyHpMul）
      ok(!e || Math.abs(e.hpScale - (1 + lv * 0.1 + lv * lv * 0.01 + (wv - 1) * 0.08)) < 1e-6, 'solo: enemy HP back to single-player scale');
    }
  }
  const E = make('client-back-later'), HE = E.T;
  CL = E; HE.Net.join = fakeJoin(E); HE.Net.renderLobby(); HE.Net.join('TEST', null); pump(); step(3);
  ok(HA.Net.linked && !HA.Net.solo && !HA.Game.mates[0].gone && HE.Game.mode === 'coop' && ['map', 'play'].includes(HE.Game.state),
    `teammate rejoined a solo run (client state ${HE.Game.state})`);
}
console.log('traffic', (bytes / 1024).toFixed(0), 'KB');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
