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

// ---- 大廳 → 房間（共用的基地）→ 各自準備 → 全員準備好就開始 ----
HA.Net.renderLobby(); HB.Net.renderLobby();
connect(B); HB.Net.send({ t: 'hello', v: HB.CFG.VERSION }); pump();
ok(HA.Net.linked && HA.Net.mateInRoom && HB.Net.linked && HB.Net.slot === 2 && HA.Net.peers.length === 1, 'client joined the room as 2P');
ok(HA.Game.state === 'pick' && HB.Game.state === 'pick', 'both in the room (shared base)');
// 位置同步：隊友的船出現在房主的基地，房主的船出現在隊友的基地
HB.Hub.ship.x = 333; HB.Hub.ship.y = 444; HB.Net.sendRoomPos(); HA.Net.sendRoomPos(); pump();
ok(HA.Net.roomShips().some(o => o.slot === 2 && o.x === 333 && o.y === 444) && HB.Net.roomShips().some(o => o.slot === 1), 'room positions synced both ways');
HA.Net.setChapter(1); pump();
HB.Net.ready('gate', 'railgun', 'amp'); pump();
ok(HB.Game.state === 'pick' && HB.Net.meReady && HA.Net.peers[0].ready && HA.Game.state === 'pick', 'client ready, waits in the room');
HA.Net.ready('bulwark', 'plasma', 'amp'); pump(); step(2);
ok(HA.Game.state === 'map' && HB.Game.state === 'map', 'both on map after start');
ok(JSON.stringify(HA.Net.packMap(HA.Game.map)) === JSON.stringify(HB.Net.packMap(HB.Game.map)), 'client received identical map');
ok(HA.Net.peers[0].at === 'map' && HA.Net.voteEnd > 0, 'vote timer started when both on map');
ok(HA.Game.mates[0].L.socks[0][0] === 'amp' && HB.Game.socks[0][0] === 'amp' && HB.Game.chain[1] === null, 'host knows client start chip (component -> weapon socket)');
ok(HA.Game.socks[0][0] === 'amp' && HA.Game.inventory[0] === null && HA.Game.chain[1] === null, 'start component goes to weapon socket, not circuit');

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
// ---- 插座（晶片 id 帶插座數）與配裝同步；隊友電路上的等級（合成過的晶片 id）房主照 id 算 ----
const sk = HB.chipId('stasis', 2);
HB.Game.inventory[0] = sk; HB.Game.socks = [['amp']]; HB.Game.wSock = 2; HB.Game.recalc(); HB.Net.sendLoadout(); pump();
ok(HA.Game.mates[0].L.inventory[0] === sk && HA.CHIPS[sk] && HA.CHIPS[sk].sk === 2, `socketed chip registered on host (${sk})`);
{
  HB.Game.chain[1] = HB.chipId('boomerang', 2, 3); HB.Game.socks = [['amp'], ['frost', 'amp']]; HB.Game.recalc(); HB.Net.sendLoadout(); pump();
  const L = HA.Game.mates[0].L, lv = HA.compileLine(L.chain, L.socks).info[1].lv;
  ok(lv === 3, `mate merged chip level synced to host (${L.chain[1]} → Lv${lv})`);
  HB.Game.chain[1] = null; HB.Game.socks = [['amp']]; HB.Game.recalc(); HB.Net.sendLoadout(); pump();
}
ok(JSON.stringify(HA.Game.mates[0].L.socks[0]) === '["amp"]', 'weapon plugs synced to host');
ok(HA.Game.mates[0].L.wSock === 2, `weapon sockets synced to host (${HA.Game.mates[0].L.wSock})`);

// ---- 跑完整個星區：投票 → 進節點 → 處理 → 回航圖 ----
const both = f => { f(HA); f(HB); };
let drawn = 0, fights = 0, pausedChecked = false, sector2 = false, guard = 0, goChecked = false, treasChecked = false;
let tractorChecked = false, beamChecked = false, nonFightChecked = false;  // nonFightChecked：補給站這類節點不倒數  // beamChecked：守門者的光束在隊友那邊轉得順  // 拖曳艦的牽引：被拉的人自己的電腦上拉、衝刺掙脫
let alertChecked = false;  // 警戒（CFG.ALERT）、警報艇：「!」和響的倒數有同步到隊友
function killAll() { for (const e of HA.Game.enemies) if (!e.dead && e.spawnT <= 0) e.hurt(1e6, 0, 0, 'direct', { src: 'weapon', cr: null, owner: Math.random() < 0.5 ? null : HA.Game.mates[0].L }); }
function finishNode(H) {
  const G = H.Game;
  switch (G.state) {
    case 'reward':  // 可能連選好幾次（寶藏、求救的獎勵：多幾次三選一）
      for (let k = 0; k < 9 && G.state === 'reward'; k++) { G.takeReward(G.reward.options.find(id => G.canAcquire(id)) || null); if (G.state === 'editor') G.toggleEditor(); }
      break;
    case 'workshop': G.wsPick(G.ws.options[0]); G.showMap(); break;
    case 'shop': case 'armory': case 'event': G.showMap(); break;
  }
}
// ？事件：航圖上的事件兩邊一樣；隊友回應求救訊號 → 房主也記下（第一場戰鬥變難、兩邊都多一次三選一）；隊友的終焉護殼傳到房主
{
  const evs = H => H.Game.map.flat().filter(n => n.type === 'event').map(n => `${n.id}:${n.ev}:${n.evArg || ''}`).join(',');
  ok(evs(HA) && evs(HA) === evs(HB), `events synced on the map (${evs(HB)})`);
  HB.Game.addSos('full'); pump();
  ok(HA.Game.sos && HA.Game.sos.team === 'full' && HA.Game.sos.mul === HA.CFG.EVENT.sos.full.mul && HB.Game.sos.mine === 'full', `client answered the SOS: host knows (${JSON.stringify(HA.Game.sos)})`);
  const hc = HA.Game.map.flat().find(n => n.type === 'combat' && n.L >= 1);
  HB.Game.markHoard([hc.id]); pump();
  ok(hc.hoard && HB.Game.nodeById(hc.id).hoard, `client marked a treasure zone: host sees it (${hc.id})`);
  hc.hoard = HB.Game.nodeById(hc.id).hoard = false;
  HB.Game.boons.ward = 1; HB.Net.sendLoadout(); pump();
  ok(HA.Game.mates[0].L.boons.ward === 1, 'client ward synced to host');
}
let sosChecked = false, wardChecked = false;
while (!sector2 && guard++ < 40) {
  step(2);
  if (HA.Game.state !== 'map' || HB.Game.state !== 'map') { console.error('not both on map', HA.Game.state, HB.Game.state); fails++; break; }
  const reach = HA.Game.reachable();
  // 補給站這類不用打的節點：投完票直接進去，沒有倒數（只有 NODE_META 的 fight 才倒數）
  const FIGHT = ['combat', 'elite', 'boss'];  // 測試自己寫（不照遊戲的 fight 標記：不然標記錯了檢查也跟著錯）
  const nf = goChecked && !nonFightChecked ? reach.find(n => !FIGHT.includes(n.type)) : null;
  const a = nf || reach[0], b = nf || reach[reach.length - 1];
  HA.Net.vote(a.id); HB.Net.vote(b.id); pump();
  if (a !== b) drawn++;
  if (nf) { nonFightChecked = true; step(2); ok(HA.Game.state !== 'going' && HB.Game.state !== 'going' && HA.Game.node === nf && HB.Game.node && HB.Game.node.id === nf.id, `non-fight node enters right away, no countdown (${nf.type}: ${HA.Game.state} / ${HB.Game.state})`); }
  const fight = FIGHT.includes(a.type) && FIGHT.includes(b.type);  // 兩個候選都是要打的：一定會倒數
  step(120); if (!goChecked && fight) { goChecked = true; ok(HA.Game.state === "going" && HB.Game.state === "going", `2 秒時還在出發倒數（${HA.Game.state} / ${HB.Game.state}）`); }
  step(80);  // 抽籤畫面、出發倒數 3 秒
  ok(HA.Game.node && HB.Game.node && HA.Game.node.id === HB.Game.node.id, `both entered ${HA.Game.node && HA.Game.node.type} ${HA.Game.node && HA.Game.node.id}${a !== b ? '（抽籤）' : ''}`);
  const type = HA.Game.node.type;
  if (['combat', 'elite', 'boss'].includes(type)) {
    fights++;
    HA.Game.player.hp = HA.Game.player.maxHp = 1e6; HA.Game.mates[0].hp = HA.Game.mates[0].maxHp = 1e6;
    const treas = type === 'combat' && !treasChecked;  // 第一場一般戰：寶藏無人機一定出現在最後一區（打掉 → 兩邊的三選一都保證稀有）
    if (treas) { HA.Game.combat.treasure = HA.Game.combat.wavesTotal; treasChecked = true; }
    if (!pausedChecked) {  // Tab：隊友編輯電路 → 房主整個暫停
      step(200);
      HB.Game.toggleEditor(); pump(); step(1);
      const snap = HA.Game.enemies.map(e => e.x + ',' + e.y).join('|'), t0 = HA.Game.time;
      step(60);
      ok(HA.Net.mateEditing && HA.Game.time === t0 && HA.Game.enemies.map(e => e.x + ',' + e.y).join('|') === snap, 'client editing freezes host simulation');
      HB.Game.chain[2] = 'echo';
      HB.Game.toggleEditor(); pump(); step(5);
      ok(!HA.Net.mateEditing && HA.Game.time > t0 && HA.Game.mates[0].L.chain[2] === 'echo', 'closing editor resumes and syncs new chain');
      pausedChecked = true;
      // 救援：隊友倒下 → 房主離很遠不會救 → 靠近 2 秒救起，房主分出一半血量
      const GA = HA.Game, P = GA.player, M = GA.mates[0], R = HA.CFG.REVIVE;
      P.iframe = M.iframe = 1e9;
      P.hp = 80; P.maxHp = M.maxHp = 100; M.hp = 100;      const AA = HA.Arena, near = (q, d) => { for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, x = q.x + Math.cos(a) * d, y = q.y + Math.sin(a) * d; if (AA.f(x, y) > 40 && AA.clearLine(q.x, q.y, x, y, 10)) return [x, y]; } return [q.x, q.y]; };  // 大地圖：找空地上的點（寫死的座標可能在牆裡）
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
      // 終焉護殼（隊友的由房主判定）：致命傷害留 1 HP，用掉之後隊友那邊也少一次
      M.iframe = 0; M.hp = 10; GA.hurtPlayer(1e9, 'e2e', M); pump();
      ok(!M.dead && M.hp === 1 && M.L.boons.ward === 0 && HB.Game.boons.ward === 0, `ward saved the client (hp ${M.hp}, host ${M.L.boons.ward}, client ${HB.Game.boons.ward})`);
      wardChecked = true;
      GA.boons.ward = 1; step(3);
      ok(HB.Game.mates[0].ward === 1 && HB.Game.wardOf(HB.Game.mates[0]) === 1, `host ward shown on client's HUD (${HB.Game.mates[0].ward})`);
      GA.boons.ward = 0;
      P.iframe = M.iframe = 0;
      P.hp = P.maxHp = 1e6; M.hp = M.maxHp = 1e6;
    }
    if (!tractorChecked && type === 'combat') {  // 拖曳艦（房主的敵人）拉隊友：隊友自己的電腦上被拉過去；隊友衝刺 → 房主那邊光束斷掉
      tractorChecked = true;
      const GA = HA.Game, CB = CL.T.Game, P = GA.player, AA = HA.Arena, me = CB.player;
      const spot = (q, d) => { for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, x = q.x + Math.cos(a) * d, y = q.y + Math.sin(a) * d; if (AA.f(x, y) > 60 && AA.clearLine(q.x, q.y, x, y, 10)) return [x, y]; } return null; };
      for (const e of GA.enemies) e.dead = true; GA.enemies = []; GA.eBullets = [];
      const objs0 = GA.objs; GA.objs = []; step(2);  // 拿掉地圖物件：行星、小行星擋在中間時拖曳艦看不到目標、不會鎖定（spot 只避開牆）
      [P.x, P.y] = AA.randomIn(0, 40, [{ x: me.x, y: me.y }], 900);  // 房主離遠一點：拖曳艦鎖定最近的玩家 = 隊友
      const at = (() => { let best = null, bd = -1; for (let i = 0; i < 64; i++) { const a = i / 64 * Math.PI * 2, x = me.x + Math.cos(a) * 300, y = me.y + Math.sin(a) * 300, dp = Math.hypot(x - P.x, y - P.y);  // 隊友身邊 300、離房主最遠的空地（拖曳艦鎖定最近的玩家）
        if (AA.f(x, y) > 60 && AA.clearLine(me.x, me.y, x, y, 10) && dp > bd) { bd = dp; best = [x, y]; } } return best; })();
      const tr = new HA.Enemy('tractor', at[0], at[1], 1); tr.spawnT = 0; tr.zone = me.zone; tr.skillCd = 0; tr.shotCd = 1e9; GA.enemies.push(tr);
      P.iframe = me.iframe = GA.mates[0].iframe = 1e9;
      step(Math.ceil(HA.CFG.TRACTOR.aim * 60) + 6);
      const ce = CB.enemies.find(e => e.id === tr.id), d0 = Math.hypot(me.x - tr.x, me.y - tr.y);
      const pulling = tr.mode === 'pull' && tr.tgt === 2 && ce && ce.mode === 'pull' && ce.tgt === 2;
      step(20);
      const pulled = d0 - Math.hypot(me.x - tr.x, me.y - tr.y);
      CL.T.Input.dash = true; step(6);
      ok(pulling && pulled > 40 && tr.mode === 'stun' && tr.tgt === 0,
        `tractor: host's tractor pulls the client on the client's side (${pulling}, pulled ${Math.round(pulled)}), client dash breaks the beam (${tr.mode})`);
      tr.dead = true; GA.enemies = GA.enemies.filter(e => e !== tr); GA.objs = objs0;
      // 很長的同步訊息（散彈＋環繞放開那一刻）：以前一則超過 PeerJS 的上限就送不出去、被當成斷線；現在切段送，隊友照樣收到
      const big0 = tooBig;
      A.run(`{ const M = Game.mates[0]; for (let i = 0; i < 600; i++) spawnShots([shot({ speed: 20, life: 3 })], M.x, M.y, i / 600 * TAU, 0, null); }`);
      step(2);
      const sent = GA.bullets.length, got = CB.bullets.length;
      ok(tooBig === big0 && sent >= 600 && got >= 600 && CL.T.Net.linked, `long snapshot is split, client still gets it (host ${sent} bullets, client ${got}, oversized messages ${tooBig - big0})`);
      for (const b of GA.bullets) b.dead = true;
      A.run(`{ const M = Game.mates[0]; spawnShots([shot({ speed: 0, life: 1, vortex: 130 })], M.x, M.y, 0, 0, null); }`);  // 漩渦：隊友那邊也要知道吸引半徑（畫範圍圈）
      step(2);
      ok(CB.bullets.some(b => b.vortex === 130), `vortex radius synced to client (${CB.bullets.map(b => b.vortex).filter(Boolean).join() || 'none'})`);
      for (const b of GA.bullets) b.dead = true;
      P.iframe = me.iframe = GA.mates[0].iframe = 0;
    }
    if (!beamChecked && type === 'combat') {  // 星環守門者的光束：隊友那邊每幀都要轉（同步 1/30 秒一次，以前每兩幀才跳一次、末端一次跳 17px）
      beamChecked = true;
      const GA = HA.Game, CB = CL.T.Game, me = CB.player;
      const core = new HA.Enemy('boss5', me.x + 300, me.y, 1); core.spawnT = 0; core.skillCd = 1e9; core.cd = 7.4; GA.enemies.push(core);
      GA.player.iframe = GA.mates[0].iframe = 1e9;
      step(10);
      const rows = [];
      for (let i = 0; i < 90; i++) { step(1); const ce = CB.enemies.find(e => e.id === core.id); rows.push([core.rot, ce ? ce.rot : NaN]); }
      const dC = rows.slice(1).map((r, i) => r[1] - rows[i][1]), dH = rows[60][0] - rows[59][0];
      const lag = Math.abs(rows[80][0] - rows[80][1]), still = dC.filter(d => !(d > 1e-6)).length, fast = Math.max(...dC);
      // 門檻照實測（2026-10-19，跑 8 次）：修好後最快每次都是房主的 1.47 倍（假網路的時間固定）、跟房主差最多 0.003 弧度；修之前 3.16 倍、45 幀不動
      ok(still === 0 && fast < dH * 1.6 && lag < 0.01, `warden beam turns smoothly on the client (still frames ${still}/${dC.length}, max ${(fast / dH).toFixed(2)}x host, lag ${lag.toFixed(3)} rad)`);
      core.dead = true; GA.enemies = GA.enemies.filter(e => e !== core); GA.player.iframe = GA.mates[0].iframe = 0;
    }    if (!alertChecked && type === 'combat') {  // 分區的一般戰：敵人出場先待機；打到警報艇 → 隊友看到「!」和響的倒數
      alertChecked = true;
      HA.Game.spawnEnemy('alarm'); const al = HA.Game.enemies[HA.Game.enemies.length - 1]; al.spawnT = 0;
      const idle = !al.alert;
      al.hurt(1, 0, 0, 'direct', null); step(3);
      const cb = HB.Game.enemies.find(e => e.id === al.id);
      ok(idle && cb && cb.alertT > 0 && cb.modeT > 0, `alert: idle on spawn, client sees "!" and the alarm ringing (${idle} ${cb && cb.alertT} / ${cb && cb.modeT})`);
      const pid = Object.keys(HA.CHIPS).find(id => HA.CHIPS[id].lvs);  // 玩法擊殺：房主算的次數同步到隊友（跟晶體同一份快照，欄位名不能撞）
      HA.Game.mates[0].L.playKills[pid] = 7; step(3);
      ok(HB.Game.playKills[pid] === 7, `play kills synced to client (${pid}: ${HB.Game.playKills[pid]})`);
      // 待機的敵人中間幾次只送 id（ei）：隊友那邊要一直留著、不閃；打掉之後要消失
      for (let i = 0; i < 3; i++) { HA.Game.spawnEnemy('swarmer'); const w = HA.Game.enemies[HA.Game.enemies.length - 1]; w.spawnT = 0; w.x = HA.Game.player.x + 2000 + i * 30; }
      const send0 = hostConn.send; let partial = 0, missing = 0, idleN = 0;
      hostConn.send = m => { if (m.t === 's' && m.ei && m.ei.length) partial++; send0(m); };
      for (let i = 0; i < 12; i++) {
        step(1);
        const ids = new Set(HB.Game.enemies.map(e => e.id));
        for (const e of HA.Game.enemies) if (!e.dead && e.alert === false && e.spawnT <= 0) { idleN++; if (!ids.has(e.id)) missing++; }
      }
      hostConn.send = send0;
      const idleE = HA.Game.enemies.find(e => !e.dead && e.alert === false && e.spawnT <= 0);
      if (idleE) { idleE.hurt(1e9, 0, 0, 'direct', null); step(3); }
      ok(partial > 0 && idleN > 0 && missing === 0 && idleE && !HB.Game.enemies.some(e => e.id === idleE.id),
        `idle enemies sent as ids only: client keeps them, drops the killed one (partial ${partial}, idle ${idleN}, missing ${missing}, killed ${idleE && idleE.id})`);
    }
    step(10);
    ok(HB.Game.objs.length === HA.Game.objs.filter(o => o.type !== 'cometgen').length, `map objects synced (${HB.Game.objs.map(o => o.type).join(',') || 'none'})`);
    const sA0 = HA.Game.chain.length, sB0 = HB.Game.chain.length;  // 打之前的插槽數（零件的機體強化也會 +1，所以跟打之前比）
    const cA0 = HA.Game.credits, cB0 = HB.Game.credits, rw = { combat: 0, elite: 15, boss: 50 }[type];
    if (type !== 'boss') ok(!HA.Arena.rect && HB.Arena.seed === HA.Arena.seed && HB.Arena.W === HA.Arena.W && HB.Arena.gates.length === HA.Arena.gates.length, `${type}: client built the same big map (seed ${HB.Arena.seed} / ${HA.Arena.seed})`);
    let gatesSeen = 0, crystalsHost = 0, crystalsSeen = 0;  // 晶體：房主地上有的時候，隊友那邊也要看得到
    for (let i = 0; i < 400 && HA.Game.inArena; i++) {  // 大地圖：閘門打開後，房主直接放到閘門前面一點（穿過去）
      killAll();
      const g = HA.Arena.gates[HA.Game.player.zone];
      step(5);
      if (HA.Game.pickups.length) { crystalsHost++; if (HB.Game.pickups.length) crystalsSeen++; }
      if (HB.Arena.gates.some(q => q.open)) gatesSeen = 100;
      if (HA.Game.exit && g && g.open) { HA.Game.player.x = g.x + g.nx * 40; HA.Game.player.y = g.y + g.ny * 40; }
    }
    if (type !== 'boss') ok(gatesSeen >= 100, `${type}: client saw the gate open`);
    if (crystalsHost) ok(crystalsSeen > 0, `${type}: client sees crystals on the ground (${crystalsSeen}/${crystalsHost} steps)`);
    step(5);
    const gA = HA.Game.credits - cA0, gB = HB.Game.credits - cB0;
    ok(gA === gB && gA > rw, `drops shared: host +${gA}, client +${gB}`);
    ok(!HA.Game.inArena && !HB.Game.inArena, `${type} won on both sides (host ${HA.Game.state}, client ${HB.Game.state})`);
    if (!sosChecked && type !== 'boss') {
      sosChecked = true;
      const RA = HA.Game.reward || {}, RB = HB.Game.reward || {}, B = HA.CFG.BONUS;
      ok(HA.Game.combat.sos === HA.CFG.EVENT.sos.full.mul && HA.Game.combat.sosKey === 'full' && HB.Game.combat.sosKey === 'full' && !HA.Game.sos && RA.again >= B.sos.again && RB.again >= B.sos.again,
        `SOS fight: harder, both get an extra pick (host ×${HA.Game.combat.sos} +${RA.again}, client +${RB.again})`);
    }
    if (treas) {
      const rare = H => H.Game.state === 'reward' && H.Game.reward.again >= 1;
      ok((HA.Game.combat.bonus || []).includes('treasure') && (HB.Game.combat.bonus || []).includes('treasure') && rare(HA) && rare(HB), `treasure drone killed: both get an extra pick (host ${(HA.Game.combat.bonus || []).includes('treasure')}/${rare(HA)}, client ${(HB.Game.combat.bonus || []).includes('treasure')}/${rare(HB)})`);
    }
    if (type === 'boss') {
      // 擊沉旗艦：先各自三選一，選完才到勝利畫面
      const RA = HA.Game.reward, RB = HB.Game.reward;
      ok(HA.Game.state === 'reward' && RA.kind === 'boss' && HB.Game.state === 'reward' && RB.kind === 'boss',
        `both get the boss 3-pick first (host ${HA.Game.state}, client ${HB.Game.state})`);
      finishNode(HA); finishNode(HB); pump();
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
      // 選王的獎勵時可以開電路（包包）；隊友開著電路時房主前往下一星區：隊友那邊先關掉電路、照樣跟過去
      const hasBtn = String(HA.Screen.el.innerHTML).includes('data-act="editor"'); HA.Game.toggleEditor(); const hostEd = hasBtn && HA.Game.state === 'editor'; HA.Game.toggleEditor();
      HB.Game.toggleEditor(); const cliEd = HB.Game.state === 'editor';
      HA.Game.nextSector(); pump(); step(3);
      ok(hostEd && cliEd && HB.Game.state === 'map', `victory screen: inventory opens (host ${hostEd}, client ${cliEd}); client editing still follows to the next sector (${HB.Game.state})`);
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
ok(sosChecked && wardChecked, `event checks ran (SOS ${sosChecked}, ward ${wardChecked})`);
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
// 插座數跟房主那邊一樣（一開始放的是 2 插座的佈雷）
ok(HC.CHIPS[skId] && HA.CHIPS[skId] && HC.CHIPS[skId].sk === HA.CHIPS[skId].sk && HC.CHIPS[skId].sk >= 2, `refreshed: socketed chip ${skId} restored`);
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
  const finish = H => { const G = H.Game; if (G.state === 'reward') G.takeReward(null); else if (['shop', 'blackhole', 'event', 'armory', 'workshop', 'victory'].includes(G.state) && G.state !== 'victory') G.showMap(); };
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
  // 延遲廣播（pg）：隊友那邊收到房主量的每個人的延遲（JSON 的 key 是字串，以前讀成 0 號、全部丟掉）
  step(130);
  ok(HE.Net.pings[HE.Net.slot] != null && HE.Net.pings[HE.Net.slot] === HA.Net.pingOf(HE.Net.slot), `client got the ping broadcast (${JSON.stringify(HE.Net.pings)} / host ${HA.Net.pingOf(HE.Net.slot)})`);
  // 全隊投票的事件（求救訊號）：兩人同票 → 就是那個；不同票 → 房主抽籤，兩邊結果一樣（一起變難、一起拿同一種獎勵）
  {
    const node = { id: 'e2e-sos', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'sos' };
    const open = () => { for (const H of [HA, HE]) { H.Game.inArena = false; H.Game.sos = null; H.Game.openEvent(node); } };
    open(); HA.Game.evChoose(0); pump();
    const waitHost = HA.Game.ev && !HA.Game.ev.res && HA.Game.ev.vote === 0;  // 隊友還沒投：房主只是投了票
    HE.Game.evChoose(0); pump();
    const same = [HA, HE].every(H => H.Game.ev && H.Game.ev.res && H.Game.sos && H.Game.sos.mul === HA.CFG.EVENT.sos.full.mul && H.Game.sosPay(H.Game.sos) === 'full');
    for (const H of [HA, HE]) H.Game.evNext();
    const back = HA.Game.state === 'map' && HE.Game.state === 'map';
    let agree = 0;
    for (let k = 0; k < 6; k++) {
      open(); HA.Game.evChoose(0); HE.Game.evChoose(2); pump();
      const a = HA.Game.sos ? HA.Game.sos.mul : 1, b = HE.Game.sos ? HE.Game.sos.mul : 1;
      if (a === b && HA.Game.ev.res && HE.Game.ev.res && HA.Game.ev.res.msg === HE.Game.ev.res.msg) agree++;
      for (const H of [HA, HE]) H.Game.evNext();
    }
    ok(waitHost && same && back && agree === 6, `team event vote: waits for everyone (${waitHost}), same vote applies to both (${same}), split votes give both the same result (${agree}/6)`);
    for (const H of [HA, HE]) H.Game.sos = null;
  }
  // 結束遠征：房主在旗艦結算按結束 → 兩邊各自看結算（隊友不會被拉回房間）；隊友先回房間，房主還在結算；房主再回來
  for (const H of [HA, HE]) { H.Game.inArena = false; H.Game.state = 'victory'; H.Game.victory = { pick: 'part', boss: H.Game.bossId }; }
  HA.Game.finishRun(); pump();
  const s1 = [HA.Game.state, HE.Game.state].join('/');
  HE.Net.backToRoom(); pump();
  const s2 = [HA.Game.state, HE.Game.state].join('/');
  HA.Net.backToRoom(); pump();
  const s3 = [HA.Game.state, HE.Game.state].join('/');
  ok(s1 === 'ended/ended' && s2 === 'ended/pick' && s3 === 'pick/pick' && HA.Net.peers[0].inRoom,
    `finish run: each player leaves the results on their own (finish ${s1}, client back ${s2}, host back ${s3})`);
  // 在看結算時有人離開（關掉、斷線）：不跳錯誤、不等重連；房主可以自己回房間，隊友的結算照看（按鈕換成回到基地）
  for (const H of [HA, HE]) { H.Game.mode = 'coop'; H.Game.inArena = false; H.Game.state = 'victory'; H.Game.victory = { pick: 'part', boss: H.Game.bossId }; }
  HA.Game.finishRun(); pump();
  HA.Net.lost(undefined, HA.Net.peers[0]);  // 隊友那條連線斷了
  const hostOk = HA.Game.state === 'ended' && !HA.Net.waiting && HA.Net.peers.length === 0 && HA.Net.roomOpen();
  HE.Net.lost();  // 隊友那邊：房主斷了
  const cliOk = HE.Game.state === 'ended' && !HE.Net.rejoin && !HE.Net.role;
  HA.Net.backToRoom();
  ok(hostOk && cliOk && HA.Game.state === 'pick',
    `leaving during results: no error, no rejoin wait (host ${HA.Game.state}, waiting ${!!HA.Net.waiting}; client ${HE.Game.state}, rejoin ${!!HE.Net.rejoin})`);
}
ok(tooBig === 0, `no message over the PeerJS json limit (${tooBig}, biggest ${tooBigMax} bytes)`);
console.log('traffic', (bytes / 1024).toFixed(0), 'KB');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
