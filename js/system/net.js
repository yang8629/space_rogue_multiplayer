// 星環電路 多人版 · net.js：多人連線：大廳、房間、同步、投票、錢包、斷線重連、多人紀錄
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// NET — 雙人連線（PeerJS / WebRTC 點對點）
//   房主：跑整個戰場（敵人、子彈、傷害判定），每秒約 30 次把戰場狀態傳給隊友
//   隊友：自己飛船的移動、衝刺在自己電腦上算（零延遲），把位置與「有沒有按開火」傳給房主
//   房主替隊友開火時，用 withLoadout 換上隊友的武器與電路
// =====================================================================
const NET_PREFIX = 'circuitrogue-mp-';
const NET_CODE_CHARS = 'ABCDEFGHJKLNPQSTUVWXYZ23456789';  // 去掉容易看錯的 I O 0 1，以及快捷鍵 M R
const NET_RATE = 1 / 30;
const NET_IDLE_EVERY = 5;  // 待機（還沒發現玩家）的敵人每幾次同步才送一次完整資料；中間只送 id（隊友那邊沿用上一次的）
const NET_VOTE_TIME = 20;  // 兩人都回到航圖後的投票時間（秒）
const NET_GO_TIME = 3;     // 兩人都選好節點後，倒數幾秒進關卡
const NET_REJOIN_TIME = 120;  // 斷線後房間保留多久等隊友重連（秒）
const NET_ROOM_RATE = 1 / 30;  // 房間（共用的基地）裡每秒同步幾次飛船位置（跟戰鬥一樣；以前 12 次，對方的船每 5 幀才跳一次：tests/roomlag.js）
const NET_ROOM_STALE = 2000;   // 多久沒收到某人的位置就不畫他（ms）
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = v => Math.round(v * 100) / 100;
const BULLET_TOL = 4, BULLET_STALE = 4;  // 子彈：隊友那邊的直線預測差多少（px）才重送；隊友那邊過了射程幾秒還沒消息（訊息掉了）就自己拿掉
const wormAhead = e => { let a = e.ahead; while (a && a.dead) a = a.ahead; return a ? a.id : 0; };
// 其他人的飛船（戰鬥中的隊友、房間裡的其他人，同一套）：
//   x, y = 遊戲判定用的位置：收到新位置就換成新的，兩次同步之間照速度往前推（coast）
//   畫面上的位置 = x, y ＋ ex, ey（Net.drawPos）：收到新位置時畫面不跳，把差距記在 ex, ey，之後每秒收掉 NET_EASE 倍（指數）；差超過 NET_SNAP（瞬移、傳送）直接跳
//   為什麼：訊息時快時慢（網路抖動），直接蓋過去會先被晚到的舊位置拉回、下一幀一口氣跳 2 倍（tests/matelag.js、roomlag.js 加抖動量到）
const NET_EASE = 12, NET_SNAP = 150;
// 武器狀態（隊友那邊畫 HUD、無人機、鉤爪的線、彈反的護盾用）：
//   [熱度, 過熱, 右鍵冷卻, 下一刀強化, 收攏, 還能擋, 彈反格擋, 勾住的敵人 id, 勾住剩幾秒, 多勾幾隻, 場上的飛輪／重力井, 無人機 [x, y, 方向, 壞掉]…]
const weaponRow = p => {
  const W = weaponPlay(p), D = loadoutOf(p).weapon.id === 'drone' ? p.drones || [] : [];
  return [r2(p.hHeat || 0), r2(Math.max(0, p.hLock || 0)), r2(p.altCd || 0), r2(Math.max(0, p.edgeT || 0)), r2(Math.max(0, p.guardT || 0)), p.guardN || 0,
    r2(Math.max(0, p.parryWinT || 0)), p.hookE && !p.hookE.dead ? p.hookE.id : 0, r2(p.hookT || 0), (p.hookX || []).length, W.count ? W.count(p) : 0,
    D.flatMap(d => [Math.round(d.x), Math.round(d.y), r2(d.a || 0), d.down > 0 ? 1 : 0])];
};
const applyWeaponRow = (p, a) => {  // 套用的時候敵人要已經更新完（鉤爪找勾住的那隻）
  if (!Array.isArray(a)) return;
  p.hHeat = num(a[0]); p.hLock = num(a[1]); p.altCd = num(a[2]); p.edgeT = num(a[3]); p.guardT = num(a[4]); p.guardN = num(a[5]); p.parryWinT = num(a[6]);
  p.hookE = a[7] ? Game.enemies.find(e => e.id === a[7]) || null : null; p.hookT = num(a[8]); p.hookX = new Array(clamp(Math.floor(num(a[9])), 0, 9)).fill(null);
  p.wN = num(a[10]);
  const d = Array.isArray(a[11]) ? a[11].slice(0, 4 * 12) : [];
  p.drones = Array.from({ length: Math.floor(d.length / 4) }, (_, i) => ({ x: num(d[i * 4]), y: num(d[i * 4 + 1]), a: num(d[i * 4 + 2]), down: d[i * 4 + 3] ? 1 : 0 }));
};
function netMove(o, x, y) {
  if (Number.isFinite(o.x) && Number.isFinite(o.y)) {
    const ex = (o.ex || 0) + o.x - x, ey = (o.ey || 0) + o.y - y, far = Math.hypot(ex, ey) > NET_SNAP;
    o.ex = far ? 0 : ex; o.ey = far ? 0 : ey;
  }
  o.x = x; o.y = y;
}
function coast(o, dt) {
  o.x += o.vx * dt; o.y += o.vy * dt;
  if (o.ex || o.ey) { const k = Math.exp(-NET_EASE * dt); o.ex *= k; o.ey *= k; }
}
const trimRow = a => { while (a.length && (a[a.length - 1] === 0 || a[a.length - 1] == null)) a.pop(); return a; };  // 尾巴的 0／null 不送（隊友那邊讀不到就當 0／null）

const NET_MAX = 4;  // 一個房間最多幾人（含房主）
// 一則訊息超過幾個字就切段送（Net.put）：PeerJS json 模式的上限是 16300 位元組；4000 字最壞每字 3 位元組（中文）＋包裝 ≈ 12KB
//   NET_PIECE_MAX：最多幾段（約 1MB，再大的不收）
const NET_PIECE = 4000, NET_PIECE_MAX = 250;
// 幾秒沒收到對方任何訊息就當成斷線（keepAlive；平常每秒至少一則 ping）
//   實測：遊玩紀錄最慢一幀 1.6 秒（隊友 2-6 第 1 波）、同步最長間隔 0.52 秒 → 5 秒不會誤判
const NET_SILENT = 5;
// 對方切到背景時放寬到幾秒：背景分頁改用計時器送 ping，Chrome 背景超過 5 分鐘的分頁計時器一分鐘才跑一次
//   （關掉分頁也會先觸發「切到背景」；正常關掉、按離開會先送 bye，不用等到這裡）
const NET_SILENT_HID = 70;

const Net = {
  role: null,          // null = 單人；'host' = 房主；'client' = 加入的隊友
  peer: null, conn: null, ping: null, code: '',  // conn：隊友連到房主的那條（房主的連線在 peers 裡）
  // 房主：每個隊友一筆 { conn, slot, linked, inRoom, ready, pick, at, editing, away, modWait, cleared, perf, ping, waiting }
  //   ready：在房間裡按了準備（開局後清掉）；pick：準備時選的配裝（這一局進行中還要用：紀錄、重連）
  //   slot：幾號玩家（房主 1，隊友 2 起）；隊友的飛船在 Game.mates（同一個 slot）
  peers: [],
  pending: [],         // 房主：連上了但還沒打招呼（hello）的連線
  slot: 1,             // 隊友：房主分配給自己的號碼
  picks: {},           // 隊友：每個人選的配裝（號碼 → pick，房主轉告）
  roomMates: {},       // 房間裡其他人的飛船：號碼 → { x, y, a, s, m, r, b, at }（位置、朝向、飛船、在動、準備好、在看面板、收到的時間）
  meReady: false, roomAcc: 0, pings: {}, evVotes: {}, evEnd: 0,  // 自己在房間裡按了準備；位置同步的計時；pings：房主廣播的每個人的延遲（隊友這邊用）
  hold: null,          // 隊友：房主因為別的隊友斷線而暫停的原因
  // 下面幾個是「所有隊友」彙總出來的（房主由 refreshPeers 從 peers 算；隊友這邊就是房主的狀態）
  linked: false,       // 有隊友已經握手成功
  mateInRoom: false,   // 隊友都回到房間了
  mateEditing: false, mateAway: false,  // 有人在編輯電路／切到其他視窗（全員暫停）
  myPick: null, matePick: null,  // 自己選好的 { ship, weapon, chip }；matePick：隊友這邊記房主的
  chapter: 1,          // 這個房間選的章節：房主在大廳選，隊友照房主的
  at: {},              // 隊友：其他玩家在不在航圖（slot → 'map'；房主轉告）
  stats: null,         // 這一局的連線數據（寫進遊玩紀錄）
  fxBuf: [], sendAcc: 0, sendN: 0, inAcc: 0, pingT: 0,
  active() { return !!this.role; },
  fx(e) { if ((this.conn || this.peers.some(q => q.conn)) && this.fxBuf.length < 400) this.fxBuf.push(e); },
  // 送訊息：隊友 → 房主；房主 → 所有隊友（只送給某一個用 sendTo）
  send(msg) {
    if (this.role === 'host') { for (const q of this.peers) this.sendTo(q, msg); return; }
    this.put(this.conn, msg);
  },
  sendTo(q, msg) { if (q) this.put(q.conn, msg); },
  // 送到一條連線：太長的切成幾段（pc）送，收到的那邊在 onPiece 拼回來
  //   PeerJS 的 json 模式一則訊息 ≥16300 位元組就報錯（不送出、觸發 error，我們當成斷線）：散彈＋環繞放開那一刻同步訊息會衝過去
  put(conn, msg) {
    try {
      if (!conn || !conn.open) return;
      const s = JSON.stringify(msg);
      if (s.length <= NET_PIECE) { conn.send(msg); return; }
      const n = Math.ceil(s.length / NET_PIECE), id = this.pieceN = (this.pieceN || 0) + 1;
      for (let i = 0; i < n; i++) conn.send({ t: 'pc', id, i, n, d: s.slice(i * NET_PIECE, (i + 1) * NET_PIECE) });
    } catch (e) {}
  },
  // 收到一段：同一條連線照順序到（可靠通道），收齊了當成一則完整的訊息處理
  onPiece(m, q) {
    const B = this.pieceBuf || (this.pieceBuf = new Map()), k = q || 0;
    const n = Math.floor(num(m.n)), i = Math.floor(num(m.i, -1));
    if (typeof m.d !== 'string' || !(n > 1 && n <= NET_PIECE_MAX) || i < 0 || i >= n) return;
    let b = B.get(k);
    if (i === 0 || !b || b.id !== m.id || b.parts.length !== i) b = { id: m.id, parts: [] };  // 新的一則（或少了一段：丟掉重來）
    if (b.parts.length !== i) { B.delete(k); return; }
    b.parts.push(m.d); B.set(k, b);
    if (b.parts.length < n) return;
    B.delete(k);
    let full = null;
    try { full = JSON.parse(b.parts.join('')); } catch (e) { return; }
    if (full && full.t !== 'pc') this.onData(full, q);
  },
  reply(q, msg) { if (q) this.sendTo(q, msg); else this.send(msg); },  // 回給送訊息來的那個人（房主：那個隊友；隊友：房主）
  // ---------- 房主：每個隊友 ----------
  mateOf(q) { return Game.mates.find(m => m.slot === q.slot) || null; },
  peerOf(m) { return this.peers.find(q => q.slot === m.slot) || null; },
  mySlot() { return this.role === 'client' ? this.slot : 1; },
  // 其他玩家的號碼（航圖投票顯示用）：房主看還在的隊友；隊友看 Game.mates
  otherSlots() { return this.role === 'host' ? this.peers.filter(q => !q.gone).map(q => q.slot) : Game.mates.map(m => m.slot); },
  atOf(slot) { return this.role === 'host' ? (this.peers.find(q => q.slot === slot) || {}).at : this.at[slot]; },
  // 房主：從每個隊友的狀態算出彙總欄位，並把「別人的暫停狀態」告訴每個隊友
  refreshPeers() {
    if (this.role !== 'host') return;
    const P = this.peers;
    this.linked = P.some(q => q.linked);
    this.mateInRoom = P.length > 0 && P.every(q => q.inRoom);
    this.mateEditing = P.some(q => q.editing); this.mateAway = P.some(q => q.away);
    this.waiting = P.find(q => q.waiting) ? P.find(q => q.waiting).waiting : null;
    const pings = P.filter(q => q.linked && q.ping != null).map(q => q.ping);
    this.ping = pings.length ? Math.max(...pings) : null;
  },
  pushPause() {  // 房主：每個隊友收到「除了自己以外」有沒有人在編輯電路、切到其他視窗
    if (this.role !== 'host') return;
    for (const q of this.peers) {
      const others = this.peers.filter(o => o !== q);
      this.sendTo(q, { t: 'edit', on: !!this.myEditing || others.some(o => o.editing) });
      this.sendTo(q, { t: 'away', on: !!this.myAway || others.some(o => o.away) });
      this.sendTo(q, { t: 'hold', why: others.some(o => o.waiting) ? '有隊友斷線，等待重新連線…' : null });  // 三人以上：別的隊友斷線，房主在等
    }
  },
  waitMods(on) { for (const q of this.peers) { const m = this.mateOf(q); q.modWait = !!on && q.linked && !!m && !m.gone; } },  // 房主：等隊友選好旗艦獎勵（二選一）
  modWaiting() { return this.peers.some(q => q.modWait); },
  resetStats() { this.stats = { pings: [], snaps: 0, inputs: 0, lastRecv: 0, maxGap: 0, maxGapAt: '', gaps: 0 }; this.team = null; this.matePerf = null; },
  close() {
    if (this.role) this.send({ t: 'bye' });  // 告訴對方我走了（連線的關閉通知不一定送得出去：關掉分頁時）
    const peer = this.peer, conns = [this.conn, ...this.peers.map(q => q.conn), ...this.pending.map(q => q.conn)];
    this.peer = this.conn = null; this.role = null; this.ping = null; this.pings = {}; this.fxBuf = []; this.pieceBuf = null; this.heard = 0; this.hostHid = false;
    this.peers = []; this.pending = []; this.slot = 1; this.at = {}; this.myAway = false; this.hold = null; this.picks = {}; this.roomMates = {}; this.meReady = false;
    this.linked = false; this.mateInRoom = false; this.mateEditing = false; this.mateAway = false; this.myPick = this.matePick = null; this.code = '';
    this.chapter = 1;
    for (const c of conns) try { c && c.close(); } catch (e) {}
    try { peer && peer.destroy(); } catch (e) {}
  },
  // 玩家自己離開（回標題）：還在戰鬥中就先存一筆紀錄
  leave() {
    if (Game.mode === 'coop' && Game.inArena && Game.state === 'play') Game.saveRecord('retired');
    this.waiting = null; this.solo = false; this.rejoin = null; this.rejoining = false; this.runId = null; this.mateAway = false;
    this.hideOverlay(); this.nudge(false);
    this.close();
  },
  // 每一幀呼叫：連上之後每秒量一次延遲
  tick(dt) {
    if (this.waiting) {  // 房主等隊友重連：倒數，時間到就結束
      if (performance.now() >= this.waiting.until) this.giveUp();
      else if (this.peers.some(q => q.linked)) this.keepAlive(dt);  // 三人以上：等的時候其他隊友照樣收到 ping（不然會被當成房主斷線）
      return;
    }
    if (!this.linked) return;
    if (Game.state === 'pick') {
      this.roomAcc += dt; if (this.roomAcc >= NET_ROOM_RATE) { this.roomAcc = Math.min(this.roomAcc - NET_ROOM_RATE, NET_ROOM_RATE); this.sendRoomPos(); }
      for (const p of Object.values(this.roomMates)) coast(p, dt);  // 兩次同步之間照速度往前推（跟戰鬥中的隊友同一套）
    }
    // 暫停中（Tab、切到背景）、不在戰鬥、隊友倒下（倒下時不送操作）：同步間隔不累積，恢復後從下一則訊息重新算
    if (this.stats && (Game.state !== 'play' || this.pauseReason() || (this.role === 'host' && Game.mates.some(m => m.dead))))
      this.stats.lastRecv = 0;
    if (Game.mode === 'coop') {
      if (this.role === 'host' && this.voteEnd && performance.now() >= this.voteEnd && !this.pauseReason()) this.tryResolve(true);  // 投票時間到
      if (this.role === 'host' && this.evEnd && performance.now() >= this.evEnd && !this.pauseReason()) this.tryResolveEv(true);  // 全隊事件的投票時間到：照已經投的抽
    }
    this.keepAlive(dt);
  },
  // 每秒 ping 一次（也是「我還在」的訊號）；太久沒收到對方任何訊息就當成斷線（直接關掉瀏覽器、當機時連線不會送出關閉通知）
  //   對方切到背景（hid）時不算：背景分頁的遊戲迴圈停住、計時器被放慢，送不出 ping
  keepAlive(dt) {
    this.pingT += dt;
    if (this.pingT >= 1) {
      this.pingT = 0;
      const PF = Game.runStats && Game.runStats.perf;
      this.send({ t: 'ping', at: performance.now(), wf: PF ? PF.worst : 0, wfAt: PF ? PF.worstAt : '', sl: PF ? PF.slow : 0 });  // 順便告訴對方自己最慢的一幀（雙人紀錄用）
      if (this.role === 'host' && Game.mode === 'coop' && Game.inArena) this.sendDmg();  // 每秒同步一次兩人的傷害統計
    }
    const now = performance.now(), lim = hid => (hid ? NET_SILENT_HID : NET_SILENT), silent = (h, hid) => h && now - h > lim(hid) * 1000;
    if (this.role === 'host') { for (const q of this.peers.slice()) if (q.linked && q.conn && silent(q.heard, q.hid)) this.lost(`隊友沒有回應（超過 ${lim(q.hid)} 秒）`, q); }
    else if (this.linked && this.conn && silent(this.heard, this.hostHid)) this.lost(`房主沒有回應（超過 ${lim(this.hostHid)} 秒）`);
  },
  // ---------- 傷害統計：房主記兩人各自的傷害，同步給隊友 ----------
  // nm：每個晶片的顯示名稱與顏色（用那個人自己的武器、飛船算），對方畫面的「隊友傷害」直接用
  dmgPack(R, L = null) {
    if (!R) return null;
    const rd = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    const nm = Game.withLoadout(L, () => Object.fromEntries(Object.keys(R.chips).map(k => [k, [dmgKeyName(k), dmgKeyColor(k)]])));
    return { dmg: rd(R.dmg), chips: rd(R.chips), kills: R.kills, maxHit: Math.round(R.maxHit), nm, downs: R.downs || 0, revives: R.revives || 0, el: R.elites || 0, ek: R.echoK || 0 };
  },
  sendDmg() {  // 房主：team = { 幾號: 那個人的傷害 }
    const mates = Game.mates.filter(m => m.L);
    if (!mates.length) return;
    this.team = { 1: this.dmgPack(Game.runStats) };
    for (const m of mates) this.team[m.slot] = this.dmgPack(m.L.R, m.L);
    this.send({ t: 'dmg', team: this.team });
  },
  onDmg(m) {  // 隊友：收到每個人的傷害；自己那份寫進自己的 runStats（結算、紀錄都用它）
    const esc = s => String(s).slice(0, 40).replace(/[<>&"]/g, '');
    const clean = (p, mine) => (p && typeof p === 'object' ? {
      dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, num(p.dmg && p.dmg[k])])),
      chips: Object.fromEntries(Object.entries(p.chips || {}).map(([k, v]) => [String(k).slice(0, 40), num(v)])
        .filter(([k]) => !mine || CHIPS[k] || k === 'weapon' || k === 'ship')),
      nm: Object.fromEntries(Object.entries(p.nm && typeof p.nm === 'object' ? p.nm : {}).slice(0, 60)
        .map(([k, v]) => [String(k).slice(0, 40), Array.isArray(v) ? [esc(v[0]), /^#[0-9a-f]{3,8}$/i.test(v[1]) ? v[1] : '#8fa3d9'] : [esc(k), '#8fa3d9']])),
      kills: num(p.kills), maxHit: num(p.maxHit), downs: num(p.downs), revives: num(p.revives), el: num(p.el), ek: num(p.ek) } : null);
    const T = m.team && typeof m.team === 'object' ? m.team : {};
    this.team = {};
    for (let s = 1; s <= NET_MAX; s++) if (T[s]) this.team[s] = clean(T[s], s === this.slot);
    const R = Game.runStats, mine = this.team[this.slot];
    if (R && mine) Object.assign(R, { dmg: mine.dmg, chips: mine.chips, kills: mine.kills, maxHit: mine.maxHit, downs: mine.downs, revives: mine.revives, elites: mine.el, echoK: mine.ek });
  },
  // 每個隊友的晶片傷害 [名稱, 顏色, 傷害]，一人一份 { tag, rows, total }（房主直接讀隊友的配裝；隊友這邊用房主傳來的名稱）：傷害分頁與遊玩紀錄用
  mateChipRows() {
    const make = (tag, chips, name) => {
      const rows = Object.entries(chips).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [...name(k), v]);
      return { tag, rows, total: rows.reduce((a, r) => a + r[2], 0) };
    };
    if (this.role === 'host') return Game.mates.filter(m => m.L && m.L.R)
      .map(m => make(Game.tagOf(m), m.L.R.chips, k => Game.withLoadout(m.L, () => [dmgKeyName(k), dmgKeyColor(k)])));
    return Object.keys(this.team || {}).map(Number).filter(s => s !== this.slot).sort((a, b) => a - b)
      .map(s => { const h = this.team[s]; return make(`${s}P`, h.chips, k => (h.nm && h.nm[k]) || [k, '#8fa3d9']); });
  },
  // 結算用：每個人（照號碼排，1P 是房主）的傷害、擊殺
  teamRows() {
    const host = this.role === 'host' || Game.mates.some(m => m.L);
    const total = R => (R ? Object.values(R.dmg).reduce((a, b) => a + b, 0) : 0);
    const shipId = p => Object.keys(SHIPS).find(k => SHIPS[k] === p.ship) || null;
    const rows = [{ slot: host ? 1 : this.slot, ship: Game.shipId, me: true, R: Game.runStats },
      ...Game.mates.map(m => ({ slot: m.slot, ship: shipId(m), me: false, R: host ? m.L && m.L.R : this.team && this.team[m.slot] }))];
    return rows.sort((a, b) => a.slot - b.slot).map(({ slot, ship, me, R }) => ({ tag: `${slot}P`, ship, me, dmg: total(R),
      kills: R ? R.kills : 0, maxHit: R ? R.maxHit : 0, downs: R ? R.downs || 0 : 0, revives: R ? R.revives || 0 : 0 }));
  },

  // ---------- 大廳：開房 / 輸入房號加入 → 進房間（共用的基地：大家的飛船都在同一個基地，各自準備，全員準備好就開始） ----------
  lobby(msg = '', bad = false) {
    this.close();
    this.resetStats();
    this.renderLobby(msg, bad);
  },
  // 一局結束後回到同一個房間（連線不斷）
  backToRoom() {
    if (!this.roomOpen()) { this.lobby('連線已經中斷，請重新開房或加入', true); return; }
    this.send({ t: 'room' });
    if (this.role === 'client') this.sendProgress();  // 這一局可能剛通關：房主照新的進度開放章節
    this.enterRoom();
  },
  // 連線畫面：開房間、輸入房號加入（連上之後就進房間）
  renderLobby(msg = '', bad = false) {
    Game.state = 'lobby'; Game.inArena = false; Game.mates = [];
    this.view('lobby', { msg, bad });
  },
  // 進房間：共用的基地（Game.state 'pick'）；準備要重新按
  enterRoom() {
    Game.state = 'pick'; Game.inArena = false; Game.mates = [];
    this.meReady = false; this.roomMates = {};
    this.view('screen', { name: 'hubPick' });
  },
  // 房間裡的狀態變了（有人加入、離開、準備、換章）：重畫上方的房間列；開著發射台的面板就重畫面板
  roomStatus() {
    if (Game.state !== 'pick') return;
    this.view('room');
  },
  // 每個人到房主的延遲（ms，來回；房主自己 null）：房主照自己量的（q.ping），隊友照房主廣播的（pg 訊息，每個人獨立）
  pingOf(slot) {
    if (slot === 1) return null;
    if (this.role === 'host') { const q = this.peers.find(o => o.slot === slot && o.linked); return q ? q.ping : null; }
    return this.pings[slot] != null ? this.pings[slot] : slot === this.slot ? this.ping : null;
  },
  // 房間裡的人：[號碼, 準備好了沒, 是不是自己]（自己 + 房主這邊的隊友／隊友這邊收到位置的人）
  roomList() {
    const me = [this.mySlot(), this.meReady, true];
    const others = this.role === 'host' ? this.peers.filter(q => q.linked).map(q => [q.slot, !!q.ready, false])
      : Object.entries(this.roomMates).map(([s, p]) => [+s, !!p.r, false]);
    return [me, ...others].sort((a, b) => a[0] - b[0]);
  },
  // 位置同步：自己的飛船（在看面板 = b）；房主送給所有人，隊友送給房主（房主轉給其他人）
  sendRoomPos() {
    const s = Hub.ship;
    if (!s) return;
    this.send({ t: 'hp', sl: this.mySlot(), x: Math.round(s.x), y: Math.round(s.y), vx: Math.round(s.vx), vy: Math.round(s.vy), a: r2(s.aim), s: Hub.shipId, w: Hub.weaponId, m: s.moving ? 1 : 0, r: this.meReady ? 1 : 0, b: Hub.driving ? 0 : 1,
      f: s.wantFire ? 1 : 0, ds: s.dashSeq || 0, as: s.altSeq || 0, dT: r2(Math.max(0, s.dashT)) });  // 開火、衝刺、右鍵：對方那邊照這些跑一份（Hub.updateGhosts）
  },
  onRoomPos(m, q) {
    const slot = this.role === 'host' ? q && q.slot : clamp(Math.floor(num(m.sl, 0)), 1, NET_MAX);
    if (!slot || slot === this.mySlot()) return;
    const had = this.roomMates[slot], wasReady = had && had.r, p = had || {};  // 同一個物件接著用：畫面位置的差距（ex, ey）要延續
    netMove(p, clamp(num(m.x), 0, HUB.W), clamp(num(m.y), 0, HUB.H));
    Object.assign(p, { vx: clamp(num(m.vx), -2000, 2000), vy: clamp(num(m.vy), -2000, 2000), a: num(m.a), s: SHIPS[m.s] ? m.s : 'vanguard', w: WEAPONS[m.w] ? m.w : null, m: !!m.m, r: !!m.r, b: !!m.b, at: performance.now(),
      f: !!m.f, ds: num(m.ds), as: num(m.as), dT: clamp(num(m.dT), 0, CFG.DASH_TIME) });
    this.roomMates[slot] = p;
    if (this.role === 'host') for (const o of this.peers) if (o !== q) this.sendTo(o, { ...m, sl: slot });  // 轉給其他隊友
    if (!had || wasReady !== p.r) this.roomStatus();  // 新來的人、準備狀態變了：更新房間列
  },
  // 其他人的飛船畫在哪（netMove 記的差距還沒收完的部分加上去）
  drawPos(o) { return [o.x + (o.ex || 0), o.y + (o.ey || 0)]; },
  // 現在要畫的其他人（太久沒收到的不畫）：x, y 是畫面上的位置
  roomShips() {
    const now = performance.now();
    return Object.entries(this.roomMates).filter(([, p]) => now - p.at < NET_ROOM_STALE).map(([s, p]) => { const [x, y] = this.drawPos(p); return { slot: +s, ...p, x, y }; });
  },
  setMsg(text, bad = false) { this.view('msg', { text, bad }); },  // 大廳的提示（bad：錯誤）
  view(k, d = {}) { Events.emit('netView', { k, ...d }); },  // 要畫面做什麼（ui/lobby.js 的 NetView 接）
  // ---------- 章節：房主在發射台選，所有人都解鎖的章節才能選 ----------
  cleanChapter(n) { return CHAPTERS.some(c => c.id === n) ? n : 1; },  // 對方傳來的章號：不認得的當第一章
  mateUnlocked(id) { return id === CHAPTERS[0].id || this.peers.every(q => (q.cleared || []).includes(id - 1)); },  // 隊友都解鎖了
  chapterOk(id) { return chapterUnlocked(id) && this.mateUnlocked(id); },
  chapterButtons() {
    const many = this.peers.length > 1;
    return CHAPTERS.map(c => {
      if (this.chapterOk(c.id)) return `<button data-act="netchapter" data-arg="${c.id}" style="${this.chapter === c.id ? 'border-color:#ffd166;color:#ffd166' : ''}">${c.name}</button>`;
      const who = !chapterUnlocked(c.id) && !this.mateUnlocked(c.id) ? (many ? '你和隊友都' : '兩人都') : !chapterUnlocked(c.id) ? '你' : (many ? '有隊友' : '隊友');
      return `<button disabled title="${who}還沒通關「${chapterById(c.id - 1).name}」">${c.name}（${who}未解鎖）</button>`;
    }).join('');
  },
  setChapter(id) {  // 房主按章節按鈕
    if (this.role !== 'host' || !this.chapterOk(id)) return;
    this.chapter = id;
    this.send({ t: 'chap', chapter: id });
    this.roomStatus();
  },
  sendProgress() { this.send({ t: 'prog', cleared: chapterProgress() }); },  // 隊友：把自己的通關進度告訴房主
  // 隊友：這個分頁在哪個房間是幾號（重新整理後重連時告訴房主，免得兩人同時斷線時坐錯位置）
  rememberSeat() { Save.setSeat({ code: this.code, slot: this.slot }); },
  seatHint(code) { const s = Save.seat(); return s && s.code === code ? s.slot : null; },

  host() {
    this.close();
    this.role = 'host'; this.pending = [];
    const code = this.code = Array.from({ length: 4 }, () => pick([...NET_CODE_CHARS])).join('');
    this.setMsg('正在建立房間…');
    this.view('hosting');  // 開了房間就不再顯示「開房間／加入房間」（離開用下方的按鈕；開房失敗會回到大廳重新顯示）
    const peer = this.peer = new Peer(NET_PREFIX + code);
    peer.on('open', () => { if (Game.state === 'lobby') this.enterRoom(); });  // 房間開好：先進基地等隊友（房號寫在上方的房間列）
    peer.on('connection', conn => {
      if (this.peers.filter(q => q.linked).length + this.pending.length >= NET_MAX - 1) {  // 滿了（斷線等重連的位置不算，讓他回得來）
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      const q = { conn, slot: 0, linked: false };  // 打過招呼（hello）才算進房間
      this.pending.push(q);
      this.bind(conn, q);
    });
    // 和配對伺服器的連線斷了（常見於切到背景一陣子）：玩家之間的連線不受影響，但要重新登記房號，隊友才找得到房間重連
    peer.on('disconnected', () => { setTimeout(() => { try { if (this.peer === peer && !peer.destroyed) peer.reconnect(); } catch (e) {} }, 1000); });
    peer.on('error', e => this.fail(e));
  },
  join(raw, resumeRunId = null) {
    const code = String(raw || '').trim().toUpperCase();
    if (!/^[A-Z0-9]{4}$/.test(code)) { this.setMsg('請輸入 4 碼房號', true); return; }
    this.close();
    this.role = 'client'; this.code = code;
    this.setMsg('連線中…');
    const peer = this.peer = new Peer();
    peer.on('open', () => {
      const conn = this.conn = peer.connect(NET_PREFIX + code, { reliable: true, serialization: 'json' });
      this.bind(conn);
      conn.on('open', () => { this.setMsg('已連上，確認版本中…'); this.send({ t: 'hello', v: CFG.VERSION, resume: resumeRunId, slot: this.seatHint(code) }); });
    });
    peer.on('error', e => this.fail(e));
  },
  // q：房主這邊這條連線是哪個隊友（隊友這邊是 null）；斷線的隊友重連時會換成原本那一筆，所以記在 conn.rec
  bind(conn, q = null) {
    conn.rec = q;
    conn.on('data', m => this.onData(m, conn.rec));
    const gone = () => { const r = conn.rec; if (!r || r.conn === conn) this.lost(undefined, r); };  // 已經換掉的舊連線關掉不算
    conn.on('close', gone);
    conn.on('error', gone);
  },
  fail(e) {
    const t = e && e.type;
    if (t === 'unavailable-id' && this.role === 'host') { this.host(); return; }  // 房號撞到別人，換一個
    const msg = {
      'peer-unavailable': '找不到這個房號（房主還沒開房，或打錯了）',
      network: '連不上配對伺服器，請檢查網路',
      'server-error': '配對伺服器暫時沒有回應，請稍後再試',
      'browser-incompatible': '這個瀏覽器不支援點對點連線',
    }[t] || `連線錯誤（${t || e}）`;
    // 只是和配對伺服器斷線（玩家之間還連著）：不影響遊戲，房主會自動重新登記
    const open = (this.conn && this.conn.open) || this.peers.some(q => q.conn && q.conn.open);
    if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(t) && open) return;
    if (this.rejoining) { this.rejoinFailed(msg); return; }
    this.lost(msg);
  },
  // 正在進行的雙人遠征（斷線時可以等隊友重連）
  inRun() { return Game.mode === 'coop' && !!this.runId && !['lobby', 'title', 'pick', 'ended', 'dead'].includes(Game.state); },
  // 一局打完、在看結算（結束遠征、全員覆滅）：各自看，有人斷線或離開不用等、不跳錯誤
  afterRun() { return Game.mode === 'coop' && ['ended', 'dead'].includes(Game.state); },
  // 回得去房間：房主的房間還開著（只剩自己也可以），隊友要還連著房主
  roomOpen() { return this.role === 'host' ? !!this.peer && !this.peer.destroyed : this.linked; },
  // 斷線：q = 房主這邊斷掉的那個隊友（null：隊友斷了和房主的連線，或房主自己的連線元件出錯）
  lost(msg = '隊友已離線', q = null) {
    if (!this.role) return;
    if (this.role === 'host') {
      if (q && this.pending && this.pending.includes(q)) { this.pending = this.pending.filter(o => o !== q); return; }  // 還沒打招呼就斷了
      if (q && !this.peers.includes(q)) return;
      const list = q ? [q] : this.peers.filter(o => o.linked);
      if (this.inRun() && this.peer && !this.peer.destroyed) { for (const o of list) this.waitForMate(msg, o); if (list.length) return; }
      if (q && (this.peers.length > 1 || Game.state === 'pick' || this.afterRun())) {  // 還沒開始、在看結算：只讓他離開，房間留著（只剩房主也一樣）
        this.peers = this.peers.filter(o => o !== q); this.refreshPeers(); delete this.roomMates[q.slot];
        if (Game.state === 'pick') this.roomStatus(); else if (!this.afterRun()) this.backToRoom();
        return;
      }
      this.endLost(msg);
      return;
    }
    if (this.inRun()) { this.clientLost(msg); return; }
    if (this.afterRun()) { this.close(); this.runId = null; this.view('screen', { name: Game.state }); return; }  // 房主關掉了：結算照看，按鈕換成回到基地
    this.endLost(msg);
  },
  endLost(msg) {  // 放棄這一局：存紀錄、回到「連線中斷」畫面
    if (Game.mode === 'coop' && Game.inArena && Game.state === 'play') Game.saveRecord('disconnect');  // 戰鬥中斷線也存一筆
    this.waiting = null; this.rejoining = null; this.hideOverlay();
    const inLobby = Game.state === 'lobby';
    this.close(); this.runId = null;
    if (inLobby) { this.lobby(msg, true); return; }
    if (Game.state === 'title') return;
    Game.mates = []; Game.state = 'title'; Game.inArena = false;
    this.view('lost', { msg });
  },

  // ---------- 斷線重連 ----------
  // 房主：隊友斷線 → 遊戲暫停，房間保留 NET_REJOIN_TIME 秒等隊友回來（重新整理後輸入同一個房號也可以）
  waitForMate(msg, q) {
    const conn = q.conn;
    q.conn = null; q.linked = false; q.editing = false; q.away = false; q.ping = null; q.at = null; q.heard = 0; q.hid = false; q.bSent = null;  // bSent：重連回來要重送全部子彈；heard 歸零：重連回來的第一則訊息才開始算
    try { conn && conn.close(); } catch (e) {}
    q.waiting = { until: performance.now() + NET_REJOIN_TIME * 1000, msg };
    this.voteEnd = 0;
    this.refreshPeers(); this.pushPause();
    this.waitOverlay();
  },
  waitOverlay() {
    const W = this.waiting;
    if (W) this.view('wait', { msg: W.msg, until: W.until, code: this.code });
  },
  // 房主：不等了，繼續玩。房間仍然開著，斷線的隊友用同一個房號就能回到當下的進度
  soloContinue() {
    if (!this.waiting) return;
    for (const q of this.peers) if (q.waiting) { q.waiting = null; q.gone = true; const m = this.mateOf(q); if (m) m.gone = true; }
    this.solo = true; this.refreshPeers(); this.pushPause();
    this.hideOverlay();
    if (Game.state === 'map') this.view('screen', { name: 'map', msg: `隊友離線，你一個人繼續（房號 ${this.code}，隊友可以隨時回來）` });
  },
  // 隊友：斷線 → 暫停，可以按「重新連線」回到同一局
  clientLost(msg) {
    const conn = this.conn, peer = this.peer, first = !this.rejoin;
    this.conn = this.peer = null; this.linked = false; this.mateEditing = false; this.rejoining = false; this.heard = 0; this.hostHid = false;
    try { conn && conn.close(); } catch (e) {}
    try { peer && peer.destroy(); } catch (e) {}
    this.rejoin = { code: this.code || (this.rejoin && this.rejoin.code), runId: this.runId, tries: first ? 0 : this.rejoin.tries, msg };
    this.rejoinOverlay();
    if (first) setTimeout(() => { if (this.rejoin && !this.rejoining && !this.linked) this.tryRejoin(); }, 1500);  // 先自動試一次
  },
  rejoinOverlay(note = '') {
    const R = this.rejoin;
    if (R) this.view('rejoin', { msg: R.msg, note, code: R.code, busy: !!this.rejoining });
  },
  tryRejoin() {
    const R = this.rejoin;
    if (!R || this.rejoining) return;
    R.tries++;
    this.rejoining = true;
    this.rejoinOverlay();
    this.join(R.code, R.runId);
    this.rejoin = R;  // join 會先 close()，把狀態放回來
    this.role = 'client';
  },
  rejoinFailed(msg) {
    this.rejoining = false;
    try { this.peer && this.peer.destroy(); } catch (e) {}
    this.peer = this.conn = null;
    this.rejoinOverlay(msg);
  },
  giveUp() {  // 按「不等了」或時間到
    const msg = this.waiting ? '等不到隊友重新連線' : '已放棄重新連線';
    this.waiting = null; this.rejoin = null; this.rejoining = false;
    for (const q of this.peers) q.waiting = null;
    this.role = this.role || 'client';
    this.endLost(msg);
  },
  // 房主：斷線的隊友回來了（房主在等，或已經先繼續玩）：換上新的連線，傳這一局的狀態，等他回覆 back 再繼續
  rejoinPeer(q, conn) {
    q.conn = conn; conn.rec = q;
    q.linked = true; q.inRoom = true; q.away = true; q.waiting = null; q.gone = false;
    const m = this.mateOf(q);
    if (m) {
      m.gone = false;
      if (Game.inArena && !m.dead) { m.x = Game.player.x + 50; m.y = Game.player.y; }  // 回到房主旁邊
    }
    this.solo = this.peers.some(o => o.gone);
    this.refreshPeers(); this.pushPause();
    this.sendTo(q, this.resumePayload(q));
    this.view('resuming');
  },
  // 房主：把目前這一局的狀態打包給重新連線的隊友 q
  resumePayload(q) {
    const G = Game, mate = this.mateOf(q), L = mate.L;
    const C = G.combat;
    return {
      t: 'resume', runId: this.runId, hostPick: this.myPick, state: G.screenState(), slot: q.slot,
      others: this.peers.filter(o => o !== q && o.pick).map(o => ({ slot: o.slot, ...o.pick })),  // 其他隊友（三人以上）
      you: { pick: q.pick, weapon: L.weapon, chain: L.chain, sk: L.socks || [], inventory: L.inventory,
        hp: mate.hp, maxHp: mate.maxHp, dead: !!mate.dead, credits: (L.credits || 0) + (this.lootTotal - (L.lootAtLo || 0)), dmg: this.dmgPack(L.R, L),
        parts: L.parts, ps: L.partSlots, cap: L.cap, ws: L.wSock, pk: L.playKills, bp: L.bonusPicks || 0, bn: L.boons },
      map: this.packMap(G.map), chapter: G.chapterId, sector: G.sector, bossId: G.bossId, node: G.node ? G.node.id : null, visited: G.visited,
      combat: G.inArena && C ? { level: C.level, wavesTotal: C.wavesTotal === Infinity ? 0 : C.wavesTotal, elites: C.elites, boss: !!C.boss, wave: C.wave } : null,
      lootTotal: this.lootTotal, victory: G.screenState() === 'victory' ? G.victory : null,
    };
  },
  // 隊友：其他玩家的飛船（房主 + 其他隊友），照號碼排
  setMates(others) {
    const ships = [{ slot: 1, ...this.matePick }, ...(Array.isArray(others) ? others : [])
      .map(o => ({ slot: clamp(Math.floor(num(o && o.slot)), 2, NET_MAX), ...this.cleanPick(o || {}) }))
      .filter(o => o.slot !== this.slot)];
    Game.mates = ships.map(o => { const m = new Player(SHIPS[o.ship]); m.slot = o.slot; m.weaponId = o.weapon; return m; });  // weaponId：畫在船頭
  },
  // 隊友：收到房主的狀態，回到這一局。同一個頁面（沒重新整理）就保留自己的配裝；重新整理過就用房主那邊記住的配裝
  applyResume(m) {
    const G = Game, map = this.unpackMap(m.map);
    if (!map || !ENEMY_TYPES[m.bossId]) { this.giveUp(); return; }
    const soft = typeof m.runId === 'string' && m.runId === this.runId && G.mode === 'coop' && !!G.map;
    this.runId = typeof m.runId === 'string' ? m.runId.slice(0, 16) : null;
    this.linked = true; this.mateInRoom = true; this.rejoin = null; this.rejoining = false;
    this.slot = clamp(Math.floor(num(m.slot, 2)), 2, NET_MAX);
    this.matePick = this.cleanPick(m.hostPick || {});
    this.picks = { 1: this.matePick };
    for (const o of Array.isArray(m.others) ? m.others : []) { const s = clamp(Math.floor(num(o && o.slot)), 2, NET_MAX); this.picks[s] = this.cleanPick(o || {}); }
    const Y = m.you || {};
    if (!soft) {
      this.myPick = this.cleanPick(Y.pick || {});
      this.resetStats();
      this.chapter = G.chapterId = this.cleanChapter(m.chapter);
      G.newRun('coop', this.myPick.ship, this.myPick.weapon, null);
      G.bonusPicks = clamp(Math.floor(num(Y.bp)), 0, 9);  // 開局三選一剩下的次數以房主記住的為準（newRun 會重設，所以放在它後面）
      const lo = this.sanitizeLoadout(Y);
      if (lo.weapon && lo.weapon.id === G.weapon.id) G.weapon = lo.weapon;
      G.chain = lo.chain; G.socks = lo.socks; G.inventory = lo.inventory;
      const YP = Y.parts && typeof Y.parts === 'object' ? Y.parts : {};  // 機體與玩法擊殺也以房主記住的為準
      G.parts = Object.fromEntries(PART_IDS.map(id => [id, clamp(Math.floor(num(YP[id])), 0, 20)]));
      G.partSlots = clamp(Math.floor(num(Y.ps, G.partSlots)), 1, 20);
      G.cap = clamp(Math.floor(num(Y.cap, G.cap)), 0, 40);
      G.wSock = clamp(Math.floor(num(Y.ws, G.wSock)), 1, CFG.WEAPON_SOCKETS);
      G.boons = cleanBoons(Y.bn);
      G.playKills = {};
      if (Y.pk && typeof Y.pk === 'object') for (const k in Y.pk) if (hasLv(k)) G.playKills[k] = Math.max(0, Math.floor(num(Y.pk[k])));
      G.refreshWeapon();
      G.credits = Math.max(0, num(Y.credits));
      this.resetRun();
      if (Y.dmg) this.onDmg({ team: { [this.slot]: Y.dmg } });
    }
    this.mateEditing = false; this.mateAway = false;
    this.lastLoot = Math.max(this.lastLoot || 0, num(m.lootTotal));
    G.map = map; G.sector = clamp(num(m.sector, 1), 1, 99); G.bossId = m.bossId;
    G.visited = (Array.isArray(m.visited) ? m.visited : []).filter(id => typeof id === 'string');
    G.node = typeof m.node === 'string' ? G.nodeById(m.node) || null : null;
    this.setMates(m.others);
    this.rememberSeat();
    const P = G.player;
    P.hp = clamp(num(Y.hp, P.hp), 0, P.maxHp); P.dead = !!Y.dead || P.hp <= 0;
    this.hideOverlay();
    const C = m.combat;
    if (C && G.node && ['combat', 'elite', 'boss'].includes(G.node.type)) {
      G.startCombat({ level: num(C.level), wavesTotal: num(C.wavesTotal) || Infinity, elites: num(C.elites), boss: !!C.boss });
      G.combat.wave = num(C.wave);
      if (Y.dead) P.dead = true;
    } else if (m.state === 'victory' && G.node) {
      G.inArena = false; G.state = 'victory';
      if (!(soft && G.victory)) G.victory = { slot: false, boss: G.bossId, pick: 'lost' };  // pick 'lost'：重新整理過，二選一的結果已經在配裝裡  // 同一個頁面：保留原本的勝利畫面（模組還能裝）
      this.view('screen', { name: 'victory' });
      if (bossDone(G.victory)) this.send({ t: 'moddone' });  // 房主可能在等隊友選旗艦獎勵
    } else if (soft && G.state === 'reward' && G.reward && G.reward.kind === 'start') G.view();  // 同一個頁面、正在開局三選一：留在原本的畫面（showMap 會跳到下一次，少選一次）
    else G.showMap('已重新連線，回到這一局。');
    this.send({ t: 'back' });
  },
  // 暫停的原因（沒有就是 null）：隊友在編輯電路、切到其他視窗、斷線重連中
  pauseReason() {
    if (Game.mode !== 'coop') return null;
    if (this.waiting) return '隊友斷線，等待重新連線…';
    if (this.rejoin) return '連線中斷';
    if (this.hold) return this.hold;  // 隊友這邊：別的隊友斷線，房主在等
    if (this.mateEditing) return '隊友正在編輯電路';
    if (this.mateAway) return this.role === 'host' ? '隊友切到其他視窗' : '房主切到其他視窗';
    return null;
  },
  hideOverlay() { this.view('hideOverlay'); },

  // 收到訊息：q = 房主這邊是哪個隊友送來的（隊友這邊是 null，訊息都來自房主）
  onData(m, q = null) {
    if (!m || typeof m !== 'object') return;
    if (this.role === 'host' && q && m.t !== 'hello' && !this.peers.includes(q)) return;  // 還沒打招呼的連線只收 hello
    if (q) q.heard = performance.now(); else this.heard = performance.now();  // 最後一次收到對方的訊息（keepAlive 判斷斷線）
    if (m.t === 'pc') { this.onPiece(m, q); return; }  // 切段送的長訊息（Net.put）
    if (m.t === 'hid') { if (q) q.hid = !!m.on; else this.hostHid = !!m.on; return; }  // 對方切到背景：斷線判斷放寬（NET_SILENT_HID）
    if (m.t === 'bye') { if (this.role === 'host') this.lost(undefined, q); else this.lost('房主離開了'); return; }  // 對方關掉、離開（close）：馬上知道，不用等逾時
    const now = performance.now(), S = this.stats;
    if (S && (m.t === 's' || m.t === 'i')) {  // 同步訊息之間最長隔多久（卡頓的指標；暫停中不算）
      if (Game.state === 'play' && !this.pauseReason()) {
        if (S.lastRecv) {  // 超過 150ms 算一次停頓；最長的那次記下在哪裡（第幾層、第幾波、場上多少子彈）
          const gap = now - S.lastRecv;
          if (gap > 150) S.gaps++;
          if (gap > S.maxGap) { S.maxGap = gap; S.maxGapAt = Game.whereNow(); }
        }
        S.lastRecv = now;
      } else S.lastRecv = 0;
      if (m.t === 's') S.snaps++; else S.inputs++;
    }
    const host = this.role === 'host', client = this.role === 'client';
    switch (m.t) {
      case 'hello': {
        if (!host || !q || !this.pending.includes(q)) break;
        if (m.v !== CFG.VERSION) {  // 版號不同（有人沒重新整理）：不讓開始
          const theirs = String(m.v || '舊版').slice(0, 40);
          this.sendTo(q, { t: 'ver', v: CFG.VERSION });
          this.setMsg(`隊友的版本不同（你：${CFG.VERSION}／隊友：${theirs}），請兩邊都按 Ctrl+F5 重新整理`, true);
          break;
        }
        this.pending = this.pending.filter(o => o !== q);
        const away = this.inRun() ? this.peers.filter(o => !o.linked) : [];
        const back = away.find(o => o.slot === m.slot) || away[0];  // 照他記得的號碼找回座位；記不得就給第一個空位
        if (back) { this.rejoinPeer(back, q.conn); break; }
        const slot = Array.from({ length: NET_MAX - 1 }, (_, i) => i + 2).find(s => !this.peers.some(o => o.slot === s));
        if (!slot || !['lobby', 'pick'].includes(Game.state)) { this.sendTo(q, { t: 'full' }); setTimeout(() => { try { q.conn.close(); } catch (e) {} }, 500); break; }
        Object.assign(q, { slot, linked: true, inRoom: true, ready: false, pick: null, at: null, cleared: [] });
        this.peers.push(q); this.refreshPeers();
        this.sendTo(q, { t: 'welcome', v: CFG.VERSION, code: this.code, slot });
        this.sendTo(q, { t: 'chap', chapter: this.chapter });
        if (Game.state === 'lobby') this.enterRoom(); else this.roomStatus();
        break;
      }
      case 'welcome': if (client) { this.linked = true; this.slot = clamp(Math.floor(num(m.slot, 2)), 2, NET_MAX); this.sendProgress(); this.enterRoom(); } break;
      case 'prog':  // 房主：隊友的通關進度；目前選的章有人沒解鎖就退回第一章
        if (!host) break;
        q.cleared = (Array.isArray(m.cleared) ? m.cleared : []).filter(n => CHAPTERS.some(c => c.id === n)).slice(0, CHAPTERS.length);
        if (!this.chapterOk(this.chapter)) this.chapter = 1;
        this.send({ t: 'chap', chapter: this.chapter });
        this.roomStatus();
        break;
      case 'chap': if (client) { this.chapter = Game.chapterId = this.cleanChapter(m.chapter); this.roomStatus(); } break;
      case 'hp': this.onRoomPos(m, q); break;
      case 'evv': if (host) this.onEvVote(m, q); break;  // 全隊投票的事件：隊友的票
      case 'evp': if (client && m.v && typeof m.v === 'object') { this.evVotes = {}; for (const k in m.v) this.evVotes[Math.floor(Number(k))] = Math.floor(num(m.v[k])); if (m.s != null) this.evEnd = performance.now() + clamp(num(m.s), 0, 60) * 1000; if (Game.state === 'event') this.view('screen', { name: 'event' }); } break;  // 投票進度、剩幾秒
      case 'evr': if (client && m.v && typeof m.v === 'object') { const v = {}; for (const k in m.v) v[Math.floor(Number(k))] = Math.floor(num(m.v[k])); this.evVotes = {}; this.evEnd = 0; Game.evResolve(Math.floor(num(m.i)), v); } break;  // 房主抽的結果
      case 'pg':  // 房主廣播的每個人的延遲
        if (client && m.p && typeof m.p === 'object') {
          this.pings = {};
          // k 是字串（JSON 的 key）：num() 只認數字，要用 Number（以前讀成 0 號、全部丟掉）
          for (const k in m.p) { const s = Math.floor(Number(k)), v = Math.round(num(m.p[k], -1)); if (s >= 2 && s <= NET_MAX && v >= 0 && v < 60000) this.pings[s] = v; }
          this.view('ping');
        }
        break;
      case 'hold': if (client) this.hold = typeof m.why === 'string' ? m.why.slice(0, 40) : null; break;
      case 'ver': this.lost(`你和房主的版本不同（你：${CFG.VERSION}／房主：${String(m.v || '舊版').slice(0, 40)}），請兩邊都按 Ctrl+F5 重新整理`); break;
      case 'room':
        if (host) { q.inRoom = true; this.refreshPeers(); this.tryStart(); } else this.mateInRoom = true;
        this.roomStatus();
        break;
      case 'full': this.lost(NET_MAX === 2 ? '這個房間已經有兩個人了' : `這個房間已經滿了（最多 ${NET_MAX} 人）`); break;
      case 'ready': this.onMateReady(m, q); break;
      case 'launch': if (client && Game.state === 'pick') { const n = clamp(Math.floor(num(m.n, 2)), 2, NET_MAX); Hub.launch(null, this.launchOff(this.slot, n), this.launchMates(n)); } break;  // 一起出發：播自己的動畫，飛出去等房主的 start
      case 'start': if (client) this.startClient(m); break;
      case 'i': if (host) this.applyInput(m, q); break;
      case 's': if (client) this.applySnap(m); break;
      case 'over':
        if (client && Game.combat && Game.state === 'play') {
          Game.state = 'dead'; Game.combat.wave = num(m.wave, Game.combat.wave); Input.down = false;
          const P = Game.player;
          if (!P.dead) { P.hp = 0; P.dead = true; burst(P.x, P.y, P.ship.color, 80, 400, 1.2, 3); }
          Game.lastHit = typeof m.cause === 'string' ? m.cause.slice(0, 60) : '';
          Game.saveRecord('dead');
          setTimeout(() => { if (Game.state === 'dead') this.view('screen', { name: 'dead' }); }, 900);
        }
        break;
      case 'dmg': if (client) this.onDmg(m); break;
      // ---- 斷線重連、切到背景 ----
      case 'resume': if (client) this.applyResume(m); break;
      case 'back':
        if (host) {
          q.away = false; this.refreshPeers(); this.pushPause();
          if (!this.waiting) this.hideOverlay(); else this.waitOverlay();
          if (Game.state === 'map') { this.checkVoteTimer(); this.view('screen', { name: 'map' }); }
        }
        break;
      case 'away':
        if (host) { q.away = !!m.on; this.refreshPeers(); this.pushPause(); } else this.mateAway = !!m.on;
        break;
      // ---- 共同闖關 ----
      case 'at': {
        const s = m.s === 'map' ? 'map' : null;
        if (host) {
          q.at = s;
          for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'at', s, slot: q.slot });  // 轉告其他隊友
          this.checkVoteTimer();
        } else this.at[clamp(Math.floor(num(m.slot, 1)), 1, NET_MAX)] = s;
        if (Game.state === 'map') this.view('screen', { name: 'map' });
        break;
      }
      case 'vote': {
        const node = typeof m.node === 'string' && Game.map ? Game.nodeById(m.node) : null;
        if (!node || !Game.reachable().includes(node)) break;
        const s = host ? q.slot : clamp(Math.floor(num(m.slot, 1)), 1, NET_MAX);
        if (s === this.mySlot()) break;
        this.votes[s] = m.node;
        if (host) for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'vote', node: m.node, slot: s });  // 轉告其他隊友
        if (!this.votes[this.mySlot()]) this.nudge(true);  // 隊友選好了、自己還沒：提醒（可能還在整理電路、商店）
        if (Game.state === 'map') this.view('screen', { name: 'map' });
        if (host) this.tryResolve();
        break;
      }
      case 'vt': if (client) { this.voteEnd = performance.now() + clamp(num(m.s), 0, 60) * 1000; if (Game.state === 'map') this.view('screen', { name: 'map' }); } break;
      case 'go':
        if (client && Game.map && typeof m.node === 'string' && Game.nodeById(m.node)) {
          if (Game.state === 'editor') { this.view('closeEditor'); Game.recalc(); this.sendLoadout(); }
          const V = m.votes && typeof m.votes === 'object' ? m.votes : {}, ok = id => (typeof id === 'string' && Game.nodeById(id) ? id : null), votes = {};
          for (let s = 1; s <= NET_MAX; s++) if (ok(V[s])) votes[s] = V[s];
          this.go(m.node, votes, !!m.drawn && Object.keys(votes).length >= 2);
        }
        break;
      case 'lo': if (host) this.applyMateLoadout(m, q); break;
      case 'sos':
        if (typeof m.k !== 'string' || !Object.prototype.hasOwnProperty.call(CFG.EVENT.sos, m.k)) break;
        Game.addSos(m.k, true);
        if (host) for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'sos', k: m.k });
        if (Game.state === 'map') this.view('screen', { name: 'map' });
        break;
      case 'hoard':
        if (!Array.isArray(m.ids) || !Game.map) break;
        Game.markHoard(m.ids.filter(id => typeof id === 'string').slice(0, 4), true);
        if (host) for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'hoard', ids: m.ids });
        if (Game.state === 'map') this.view('screen', { name: 'map' });
        break;
      case 'ward':
        if (client && Game.boons && Game.boons.ward > 0) { Game.boons.ward--; bannerFx('⛨ 終焉護殼', `撐住了致命的一擊（無敵 ${CFG.EVENT.ward.iframe} 秒）`, 2); }
        break;
      case 'edit':
        if (host) { q.editing = !!m.on && Game.inArena; this.refreshPeers(); this.pushPause(); } else this.mateEditing = !!m.on && Game.inArena;
        break;
      case 'won':
        if (client && Game.inArena && Game.combat) {
          const P = Game.player;
          P.dead = false; P.hp = clamp(num(m.hp, P.hp), 1, P.maxHp);
          this.applyLoot(m.lt);
          Game.credits += clamp(num(m.loot), 0, 999);
          Game.combat.bonus = (Array.isArray(m.bo) ? m.bo : []).filter(k => typeof k === 'string' && Object.prototype.hasOwnProperty.call(CFG.BONUS, k)).slice(0, 8);
          Game.combatWon();
        }
        break;
      case 'sector':
        if (client && Game.screenState() === 'victory') {
          if (Game.state === 'editor') Game.toggleEditor();  // 隊友開著電路（選王的獎勵時可以開）：先關掉（配裝照常送給房主）
          const map = this.unpackMap(m.map);
          if (!map || !ENEMY_TYPES[m.bossId]) { this.lost('收到的星圖有問題，請兩邊都重新整理'); break; }
          this.nextMap = { map, bossId: m.bossId };
          Game.nextSector();
        }
        break;
      case 'finish': if (client && Game.screenState() === 'victory') { if (Game.state === 'editor') Game.toggleEditor(); Game.finishRun(); } break;
      case 'moddone':  // 隊友選好了旗艦獎勵：大家都好了，房主就可以前往下一星區
        if (host && q.modWait) { q.modWait = false; if (!this.modWaiting() && Game.state === 'victory') this.view('screen', { name: 'victory' }); }
        break;
      case 'ping': {
        this.reply(q, { t: 'pong', at: m.at });
        const perf = m.wf != null ? { worst: Math.round(num(m.wf)), at: String(m.wfAt || '').slice(0, 40), slow: Math.round(num(m.sl)) } : null;
        if (perf) { if (host) q.perf = perf; this.matePerf = perf; }
        break;
      }
      case 'pong': {
        const ms = Math.round(now - num(m.at, now));
        if (ms < 0 || ms > 60000) break;
        if (host) {  // 大家的延遲廣播給所有人（隊友之間互相不知道）
          q.ping = ms; this.refreshPeers();
          this.send({ t: 'pg', p: Object.fromEntries(this.peers.filter(o => o.linked && o.ping != null).map(o => [o.slot, o.ping])) });
        } else this.ping = ms;
        if (S && Game.state === 'play' && S.pings.length < 3600) S.pings.push(ms);
        this.view('ping');
        break;
      }
    }
  },

  // ---------- 準備：在房間（基地）裡選好飛船，到發射台選武器、起始晶片 → 全員準備好（都在房間裡）就開戰 ----------
  cleanPick(m) {  // 對方傳來的選擇：不認得的就換成預設值
    return { ship: SHIPS[m.ship] ? m.ship : 'vanguard', weapon: WEAPONS[m.weapon] ? m.weapon : 'laser',
      chip: NORMAL_IDS.includes(m.chip) ? m.chip : null };
  },
  allReady() { return this.peers.length > 0 && this.peers.every(q => q.linked && q.ready && q.pick && q.inRoom); },
  tryStart() {
    if (this.role !== 'host' || Game.state !== 'pick' || !this.meReady || !this.allReady() || Hub.seq) return;
    const n = this.peers.length + 1;
    this.send({ t: 'launch', n });
    Hub.launch(() => { if (Game.state === 'pick' && this.meReady && this.allReady()) this.startHost(); else this.view('screen', { name: 'hubPick' }); }, this.launchOff(1, n), this.launchMates(n));  // 播完再確認一次（有人中途離開就回基地）
  },
  launchOff(slot, n) { return (slot - 1 - (n - 1) / 2) * Math.min(40, HUB.RUNWAY_W / Math.max(1, n - 1)); },  // 出發動畫：照號碼在跑道上左右錯開（間隔 40，人多時縮到跑道寬放得下；以前 26，兩人的名牌疊在一起）
  launchMates(n) { return this.roomShips().map(o => ({ slot: o.slot, off: this.launchOff(o.slot, n) })); },  // 其他人（房間裡看得到的）：號碼、跑道上的位置
  ready(ship, weapon, chip) {
    if (this.role === 'client' && !this.linked) { this.lost(); return; }  // 房主一個人也可以先準備
    this.myPick = this.cleanPick({ ship, weapon, chip });
    this.meReady = true;
    this.send({ t: 'ready', ...this.myPick, slot: this.mySlot() });
    this.view('screen', { name: 'hubPick' });  // 回到基地等其他人
    this.tryStart();
  },
  onMateReady(m, q) {
    if (this.inRun()) return;
    if (this.role === 'host') {
      q.pick = this.cleanPick(m); q.ready = true; q.inRoom = true;
      for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'ready', ...q.pick, slot: q.slot });  // 轉告其他隊友
    } else {
      const s = clamp(Math.floor(num(m.slot, 1)), 1, NET_MAX);
      this.picks[s] = this.cleanPick(m);
      if (s === 1) this.matePick = this.picks[1];
    }
    this.roomStatus();
    this.tryStart();
  },
  // ---------- 開始 ----------
  makeLoadout(p) {  // 隊友的配裝（房主這邊用來算隊友的子彈）
    const L = { shipId: p.ship, weapon: { id: p.weapon, path: null, final: null },
      chain: startChain(p.chip), socks: startSocks(p.chip), inventory: startInv(p.chip), playKills: {},
      parts: { ...SHIPS[p.ship].parts }, partSlots: SHIPS[p.ship].partSlots, cap: SHIPS[p.ship].cap, wSock: CFG.START_WSOCK, boons: cleanBoons(),
      R: { dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])), chips: {}, kills: 0, maxHit: 0 } };  // 隊友的傷害統計
    const ST = Game.chapter().start;  // 章節的開局補償：電路格、插座先加；晶體和剩下的三選一次數先記著，之後隊友的配裝同步會蓋過去
    applyChapterStart(L, ST);
    L.credits = ST ? ST.credits || 0 : 0; L.bonusPicks = ST ? ST.picks || 0 : 0;
    L.wp = weaponParams(L.weapon);
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.boons); });
    return L;
  },
  startHost() {
    const me = this.myPick;
    this.resetStats();
    Game.newRun('coop', me.ship, me.weapon, me.chip);
    Game.mates = this.peers.map(q => {
      const mate = new Player(SHIPS[q.pick.ship]);
      mate.slot = q.slot;
      mate.L = this.makeLoadout(q.pick);
      mate.hp = mate.maxHp = Game.maxHpOf(SHIPS[q.pick.ship], mate.L.passives, mate.L.mech);
      mate.dashSeq = 0; mate.wantFire = false;
      return mate;
    });
    this.resetRun();
    this.meReady = false; this.roomMates = {};
    for (const q of this.peers) { q.ready = false; q.inRoom = false; }  // 下一次在房間要重新準備；回到房間（room）才算在房間裡
    this.runId = Math.random().toString(36).slice(2, 10);  // 這一局的編號：斷線重連時用來判斷是不是同一局
    for (const q of this.peers)
      this.sendTo(q, { t: 'start', ...me, map: this.packMap(Game.map), bossId: Game.bossId, runId: this.runId, chapter: Game.chapterId,
        others: this.peers.filter(o => o !== q).map(o => ({ slot: o.slot, ...o.pick })) });  // others：其他隊友（三人以上）
    Game.showMap(this.startMsg());
  },
  startClient(m) {
    if (!this.myPick) return;
    this.meReady = false; this.roomMates = {};
    const map = this.unpackMap(m.map);
    if (!map || !ENEMY_TYPES[m.bossId]) { this.lost('收到的星圖有問題，請兩邊都重新整理'); return; }
    this.matePick = this.picks[1] = this.cleanPick(m);
    for (const o of Array.isArray(m.others) ? m.others : []) { const s = clamp(Math.floor(num(o && o.slot)), 2, NET_MAX); this.picks[s] = this.cleanPick(o || {}); }
    this.resetStats();
    this.runId = typeof m.runId === 'string' ? m.runId.slice(0, 16) : null;
    const me = this.myPick;
    this.chapter = Game.chapterId = this.cleanChapter(m.chapter);  // 以房主為準（pick 時已經設過，這裡再保險一次）
    Game.newRun('coop', me.ship, me.weapon, me.chip);
    Game.map = map; Game.bossId = m.bossId;
    this.setMates(m.others);
    this.rememberSeat();
    this.resetRun();
    Game.showMap(this.startMsg());
  },
  startMsg() { return `${Game.chapter().name}：${Game.chapter().intro}<br>多人遠征開始！點選下一個節點投票，大家都選好就出發。`; },

  // ---------- 共同闖關：星圖、投票、共用的錢、各自的配裝 ----------
  resetRun() {
    this.votes = {}; this.at = {}; this.voteEnd = 0;  // votes：幾號 → 投的節點 id
    this.evVotes = {}; this.evEnd = 0;  // 全隊投票的事件（evVote）
    for (const q of this.peers) q.at = null;
    this.mateEditing = false; this.myEditing = false; this.solo = false;
    for (const q of this.peers) q.editing = false;
    this.lootTotal = 0; this.lastLoot = 0;  // 怪物掉落：房主累計被撿走的數量，隊友照差額加錢
  },
  // 節點：[id, 層, 第幾個, 這層幾個, 種類, 下一步, ？事件種類, 事件參數, 寶藏星域]
  packMap(map) { return map.map(row => row.map(n => [n.id, n.L, n.k, n.n, n.type, n.next, n.ev || 0, n.evArg || 0, n.hoard ? 1 : 0])); },
  unpackMap(raw) {  // 隊友：檢查房主傳來的星圖格式
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;
    const ids = new Set();
    try {
      const map = raw.map(row => (Array.isArray(row) ? row : []).map(a => {
        const [id, L, k, n, type, next, ev, evArg, hoard] = Array.isArray(a) ? a : [];
        if (typeof id !== 'string' || !NODE_META[type] || !Array.isArray(next)) throw new Error('bad node');
        ids.add(id);
        return { id, L: num(L), k: num(k), n: num(n, 1) || 1, type, next: next.filter(x => typeof x === 'string'),
          ev: typeof ev === 'string' && Object.prototype.hasOwnProperty.call(EVENTS, ev) ? ev : null, evArg: typeof evArg === 'string' ? evArg : null, hoard: !!hoard };
      }));
      return map.flat().every(n => n.next.every(id => ids.has(id))) ? map : null;
    } catch (e) { return null; }
  },
  // 下一場變難（？事件的求救訊號、星圖情報被發現）、寶藏星域：誰觸發都算全隊的；房主轉告其他隊友
  sendSos(k) { if (this.linked) this.send({ t: 'sos', k }); },
  sendHoard(ids) { if (this.linked) this.send({ t: 'hoard', ids }); },
  // 終焉護殼（？事件）：房主判定隊友 p 用掉了，告訴那個隊友
  sendWard(p) { this.sendTo(this.peers.find(q => q.slot === p.slot), { t: 'ward' }); },
  sendSector() { this.send({ t: 'sector', map: this.packMap(Game.map), bossId: Game.bossId }); },
  // 回到航圖：告訴大家；隊友順便把最新的配裝傳給房主（下一場戰鬥用）
  atMap() {
    if (!this.linked) return;
    if (this.role === 'client') this.sendLoadout();
    this.send({ t: 'at', s: 'map', slot: this.mySlot() });
    this.checkVoteTimer();
  },
  voters() { return [1, ...this.peers.filter(q => q.linked).map(q => q.slot)]; },  // 房主：這次投票算哪些人（離線的不算）
  vote(id) {
    const node = Game.nodeById(id);
    if (!node || !Game.reachable().includes(node) || Game.state !== 'map') return;
    if (!this.linked) { Game.enterNode(node); return; }  // 隊友都離線了：自己走
    this.votes[this.mySlot()] = id;
    this.nudge(false);
    this.send({ t: 'vote', node: id, slot: this.mySlot() });
    this.view('screen', { name: 'map' });
    if (this.role === 'host') this.tryResolve();
  },
  checkVoteTimer() {  // 房主：大家都在航圖時開始倒數
    const on = this.peers.filter(q => q.linked);
    if (this.role !== 'host' || Game.state !== 'map' || !on.length || !on.every(q => q.at === 'map') || this.voteEnd) return;
    this.voteEnd = performance.now() + NET_VOTE_TIME * 1000;
    this.send({ t: 'vt', s: NET_VOTE_TIME });
    this.view('screen', { name: 'map' });
  },
  tryResolve(force = false) {  // 房主：大家都投了（或時間到）就決定目的地
    if (this.role !== 'host' || Game.state !== 'map') return;
    const reach = Game.reachable(), who = this.voters(), V = {};
    for (const s of who) if (this.votes[s] && reach.some(n => n.id === this.votes[s])) V[s] = this.votes[s];
    if (!force && who.some(s => !V[s])) return;
    const cand = Object.values(V);
    const id = cand.length ? pick(cand) : pick(reach).id;  // 票數比例抽籤（一人一票；都沒投就隨機）
    const drawn = new Set(cand).size > 1;
    this.voteEnd = 0;
    this.send({ t: 'go', node: id, votes: V, drawn });
    this.go(id, V, drawn);
  },
  go(id, votes, drawn) {
    const node = Game.nodeById(id);
    if (!node) return;
    this.at = {}; for (const q of this.peers) q.at = null;
    this.voteEnd = 0; this.votes = {}; this.evVotes = {}; this.evEnd = 0;  // 新的節點：上一個事件沒投完的票不算
    this.nudge(false);
    const T = !NODE_META[node.type].fight ? 0 : this.goTime != null ? this.goTime : NET_GO_TIME;  // 只有要打的節點倒數（補給站、維修站這些直接進去）；goTime：模擬用（電腦不用等，設 0）
    if (!(T > 0)) { Game.enterNode(node); return; }
    Game.state = 'going';
    this.goUntil = performance.now() + T * 1000;  // 大家都選好（或投票時間到）：倒數 3 秒再進關卡
    this.view('going', { node, votes, drawn, T });
    setTimeout(() => { if (Game.state === 'going') { this.goUntil = 0; Game.enterNode(node); } }, T * 1000);
  },
  // 提醒還沒選節點的人：畫面最上面的橫幅（開著電路編輯器、在商店也看得到），自己投了票或出發時收起來
  nudge(on) {
    this.view('nudge', { on });
    if (on) Events.emit('nudge');
  },
  voteLeft() { return this.voteEnd ? Math.max(0, Math.ceil((this.voteEnd - performance.now()) / 1000)) : null; },
  // ---------- 全隊投票的事件（EVENTS 的 team，例如求救訊號）：每人一票（evVotes：幾號 → 第幾個選項），
  //   到齊、或第一票之後 NET_VOTE_TIME 秒，由房主照票數抽籤（一人一票），結果全隊一樣（Game.evResolve）
  evVote(i) {
    this.evVotes[this.mySlot()] = i;
    if (this.role === 'host') { if (!this.evEnd) this.evEnd = performance.now() + NET_VOTE_TIME * 1000; this.send({ t: 'evp', v: this.evVotes, s: this.evLeft() }); this.tryResolveEv(); }
    else this.send({ t: 'evv', i });
  },
  onEvVote(m, q) {  // 房主收到隊友的票
    const i = Math.floor(num(m.i, -1));
    if (!q || !q.slot || i < 0 || i > 9) return;
    this.evVotes[q.slot] = i;
    if (!this.evEnd) this.evEnd = performance.now() + NET_VOTE_TIME * 1000;
    this.send({ t: 'evp', v: this.evVotes, s: this.evLeft() });  // 投票進度給所有人看
    if (Game.state === 'event') this.view('screen', { name: 'event' });
    this.tryResolveEv();
  },
  tryResolveEv(force = false) {
    const V = Game.ev, E = V && EVENTS[V.id];
    if (this.role !== 'host' || Game.state !== 'event' || !E || !E.team || V.res) return;
    const who = this.voters(), cast = who.filter(s => this.evVotes[s] != null);
    if (!cast.length || (!force && cast.length < who.length)) return;
    const votes = Object.fromEntries(cast.map(s => [s, this.evVotes[s]])), i = votes[pick(cast)];  // 一人一票，照票數比例抽
    this.evVotes = {}; this.evEnd = 0;
    this.send({ t: 'evr', i, v: votes });
    Game.evResolve(i, votes);
  },
  evLeft() { return this.evEnd ? Math.max(0, Math.ceil((this.evEnd - performance.now()) / 1000)) : null; },
  evWho() { return this.role === 'host' ? this.voters() : [this.slot, ...Game.mates.filter(m => !m.gone).map(m => m.slot)].sort((a, b) => a - b); },  // 這次全隊投票有哪些人（畫面列出每個人投了沒）


  // 配裝：隊友改了電路／倉庫／武器就傳給房主（房主模擬隊友的子彈要用）
  sendLoadout() {
    if (this.role !== 'client' || !this.linked) return;
    const G = Game;
    this.send({ t: 'lo', weapon: G.weapon, chain: G.chain, sk: G.socks || [], inventory: G.inventory, hp: G.player.hp, cr: G.credits,
      parts: G.parts, ps: G.partSlots, cap: G.cap, ws: G.wSock, bp: G.startPicksLeft(), bn: G.boons });
  },
  // 檢查對方傳來的電路、倉庫、武器、強化過的格子：不認得的晶片變空格（晶片 id 可以帶插座數 ~2、等級 ^2，見 parseChipId）
  sanitizeLoadout(m) {
    const fix = id => parseChipId(id);
    const chain = (Array.isArray(m.chain) ? m.chain : []).slice(0, CFG.MAX_SLOTS).map((id, i) => (i === 0 ? 'weapon' : fix(id)));
    while (chain.length < CFG.START_SLOTS) chain.push(null);
    chain[0] = 'weapon';
    const inventory = Array.from({ length: CFG.INV_SLOTS }, (_, i) => fix(Array.isArray(m.inventory) ? m.inventory[i] : null));
    const W = m.weapon && WEAPONS[m.weapon.id] ? m.weapon : null, path = W && W.path && WEAPONS[W.id].paths[W.path] ? W.path : null;
    const weapon = W ? { id: W.id, path, final: path && (W.final === 0 || W.final === 1) ? W.final : null } : null;
    // 插座：只收組件，每格最多插座上限個（多的丟掉）
    const socks = chain.map((id, i) => !id || !Array.isArray(m.sk) || !Array.isArray(m.sk[i]) ? []
      : m.sk[i].slice(0, CFG.MAX_SOCKETS).map(fix).filter(c => c && isComp(c)));
    return { chain, socks, inventory, weapon };
  },
  applyMateLoadout(m, q) {  // 房主：檢查後套用到隊友 q 的配裝
    const mate = this.mateOf(q);
    if (!mate || !mate.L) return;
    const { chain, socks, inventory, weapon } = this.sanitizeLoadout(m), L = mate.L;
    if (weapon && weapon.id === L.weapon.id) L.weapon = weapon;
    L.credits = Math.max(0, num(m.cr, L.credits || 0));  // 隊友的錢包（重新連線時還原用）
    L.lootAtLo = this.lootTotal || 0;  // 之後撿到的掉落另外算
    L.chain = chain; L.socks = socks; L.inventory = inventory; L.wp = weaponParams(L.weapon);
    // 機體：零件層數（0～20）、零件格
    const P = m.parts && typeof m.parts === 'object' ? m.parts : {};
    L.parts = Object.fromEntries(PART_IDS.map(id => [id, clamp(Math.floor(num(P[id])), 0, 20)]));
    L.partSlots = clamp(Math.floor(num(m.ps, L.partSlots || 6)), 1, 20);
    L.cap = clamp(Math.floor(num(m.cap, L.cap || 4)), 0, 40);
    L.wSock = clamp(Math.floor(num(m.ws, L.wSock || CFG.START_WSOCK)), 1, CFG.WEAPON_SOCKETS);
    L.bonusPicks = clamp(Math.floor(num(m.bp, L.bonusPicks || 0)), 0, 9);  // 開局三選一還剩幾次（隊友重新整理時還原）
    L.boons = cleanBoons(m.bn);  // ？事件的這一局效果（終焉護殼用掉時房主會先告訴隊友，所以以隊友傳來的為準）
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.boons); });
    mate.maxHp = Game.maxHpOf(mate.ship, L.passives, L.mech);
    if (!Game.inArena) mate.hp = clamp(num(m.hp, mate.hp), 1, mate.maxHp);  // 戰鬥中的血量以房主為準
    else mate.hp = Math.min(mate.hp, mate.maxHp);
  },

  // 戰鬥中按 Tab：全員一起暫停（房主：告訴每個隊友；隊友：告訴房主，房主再轉告其他人）
  setEditing(on) {
    this.myEditing = on;
    if (this.role === 'host') this.pushPause(); else this.send({ t: 'edit', on: !!on });
  },
  // 戰鬥結束：被擊墜的人以 30% HP 歸隊；房主把隊友的血量傳過去
  applyLoot(raw) {  // 隊友：這一局怪物掉落被撿走的總數，比上次多出來的部分加進自己的錢包
    const lt = num(raw, this.lastLoot);
    if (lt > this.lastLoot && lt - this.lastLoot < 1000) Game.credits += lt - this.lastLoot;
    this.lastLoot = Math.max(this.lastLoot, lt);
  },
  afterCombat(left = 0) {
    const revive = p => { if (p && p.dead) { p.dead = false; p.hp = Math.max(1, Math.round(p.maxHp * 0.3)); } };
    this.mateEditing = false;
    if (this.role === 'host') {
      for (const q of this.peers) q.editing = false;
      for (const p of Game.allShips()) revive(p);
      if (Game.mates.length) this.sendDmg();
      const bo = (Game.combat && Game.combat.bonus) || [];  // 戰鬥中打到的稀有保證（寶藏無人機、精英亂入）：每個人的三選一都保證
      for (const q of this.peers) { const m = this.mateOf(q); if (m) this.sendTo(q, { t: 'won', hp: m.hp, loot: left, lt: this.lootTotal, bo }); }  // loot：地上沒吸完的晶體，隊友也拿
    }
  },
  // 房主：全滅了，告訴每個隊友（帶上他自己最後被什麼打倒）
  sendOver(wave) {
    for (const q of this.peers) { const m = this.mateOf(q); this.sendTo(q, { t: 'over', wave, cause: m ? m.lastHit || '' : '' }); }
  },

  // ---------- 遊玩紀錄（雙人） ----------
  whereText() {
    const G = Game, n = G.node, C = G.combat;
    const at = n ? `${G.isEndless() ? '無盡 · ' : ''}星區 ${G.sector} 第 ${n.L + 1} 層（${NODE_META[n.type].label}）` : `星區 ${G.sector} 航圖`;
    return at + (n && C && G.inArena && C.wavesTotal !== Infinity ? ` 第 ${C.wave} / ${C.wavesTotal} ${G.usesAreas() ? "區" : "波"}` : '');
  },
  // 雙人紀錄：跟單人同一份（受傷來源、各關摘要、走過的節點、取得的晶片、電路數值…，見 Game.buildRecord），再加上雙人的欄位
  buildRecord(result) {
    const G = Game, S = this.stats || { pings: [], snaps: 0, inputs: 0, maxGap: 0 };
    const name = id => (id && CHIPS[id] ? CHIPS[id].name : null);
    const ps = [...S.pings].sort((a, b) => a - b);
    const host = this.role === 'host' || (!this.role && G.mates.some(m => m.L));
    const base = G.buildRecord(result);
    // 隊友的選擇 [號碼, pick]：房主看每個隊友；隊友看房主（matePick）和其他隊友轉告的
    const mates = host ? this.peers.filter(q => q.pick).map(q => [q.slot, q.pick])
      : [[1, this.matePick], ...Object.keys(this.picks || {}).map(Number).filter(s => s > 1 && s !== this.slot).map(s => [s, this.picks[s]])].filter(([, p]) => p);
    return {
      ...base, mode: 'coop',
      where: `多人 · ${this.whereText()}（${host ? '房主 1P' : `隊友 ${this.slot}P`}）`,
      cause: G.player.dead ? G.lastHit : base.cause,
      coop: {
        role: host ? '房主' : '隊友',
        mate: mates.length ? mates.map(([s, p]) => (mates.length > 1 ? `${s}P ` : '') + `${SHIPS[p.ship].name} · ${WEAPONS[p.weapon].name} · 起始晶片 ${name(p.chip) || '無'}`).join('／') : '（不明）',
        mateDown: G.mates.some(m => m.dead),
        ping: ps.length ? { avg: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length), min: ps[0],
          p90: ps[Math.floor(ps.length * 0.9)], max: ps[ps.length - 1], samples: ps.length } : '沒有量到',
        sync: { ...(host ? { inputsReceived: S.inputs } : { snapshotsReceived: S.snaps }), maxGapMs: Math.round(S.maxGap), maxGapAt: S.maxGapAt || '', gaps150: S.gaps || 0 },
        matePerf: this.matePerf,  // 隊友那邊最慢的一幀（每秒的 ping 帶過來）
        team: this.teamRows().map(r => ({ who: `${r.tag}${r.me ? '（你）' : ''}`, ship: SHIPS[r.ship] ? SHIPS[r.ship].name : '？',
          dmg: Math.round(r.dmg), kills: r.kills, maxHit: Math.round(r.maxHit), downs: r.downs, revives: r.revives })),
        mateChipDmg: (T => T.flatMap(t => t.rows.map(([n, , v]) => [(T.length > 1 ? `${t.tag} ` : '') + n, Math.round(v)])))(this.mateChipRows()),  // 隊友的晶片傷害（整局；三人以上名稱前面標號碼）
      },
    };
  },

  // ---------- 房主 ----------
  applyInput(m, q) {  // 隊友 q 傳來的位置與操作
    const p = this.mateOf(q);
    if (!p || p.dead || Game.state !== 'play') return;
    netMove(p, clamp(num(m.x, p.x), p.r, Arena.W - p.r), clamp(num(m.y, p.y), p.r, Arena.H - p.r));  // 畫面上不跳（見 netMove）
    Arena.updateZone(p);  // 大地圖：隊友在第幾區（跟自己的飛船同一套：穿過打開的閘門才 +1；新戰鬥收到上一場的舊座標不會跳區）
    p.vx = num(m.vx); p.vy = num(m.vy); p.aim = num(m.a, p.aim);
    p.moving = !!m.mv; p.dashT = clamp(num(m.dT), 0, CFG.DASH_TIME); p.wantFire = !!m.f;
    p.dashSX = num(m.sx, p.x); p.dashSY = num(m.sy, p.y);  // 衝刺起點由隊友的電腦記（瞬移、衝刺途中穿門都在那邊算）
    p.aimD = num(m.ad, 300); p.autoMode = !!m.au;  // 準星距離（環繞放出）、手機自動攻擊（環繞轉滿就放）
    const ds = num(m.ds, p.dashSeq);
    if (ds > p.dashSeq) { p.dashSeq = ds; Game.withLoadout(p.L, () => p.onDash()); }  // 衝刺技能（震波、相位超載）由房主執行
    const as = num(m.as, p.altSeq || 0);
    if (as > (p.altSeq || 0)) { p.altSeq = as; p.altQ = true; }  // 武器右鍵：下一次 hostUpdateMate 執行
  },
  hostUpdateMates(dt) { for (const m of Game.mates) this.hostUpdateMate(m, dt); },
  hostUpdateMate(m, dt) {
    if (m.dead || m.gone) return;
    coast(m, dt);  // 兩次輸入之間先照速度往前推
    m.x = clamp(m.x, m.r, Arena.W - m.r); m.y = clamp(m.y, m.r, Arena.H - m.r);
    m.iframe -= dt; m.overdrive -= dt; m.dashT -= dt; if (m.frostT > 0) m.frostT -= dt;  // 冰凍時間在房主這邊倒數（隊友那邊照同步的剩餘秒數變慢）
    Game.withLoadout(m.L, () => { m.tickDash(); m.tickAlt(dt); m.tickFire(dt, m.wantFire); });  // 衝刺相關的晶片、武器（每幀的事、右鍵）、開火（蓄力、過熱）
    Objects.hostCheckMate(m);
  },
  hostSend(dt) {
    this.sendAcc += dt;
    const to = this.peers.filter(q => q.conn && q.conn.open && this.mateOf(q));
    if (this.sendAcc < NET_RATE || !to.length || !Game.inArena) return;
    this.sendAcc = Math.min(this.sendAcc - NET_RATE, NET_RATE);  // 保留零頭，才能穩定每秒 30 次
    const G = Game, P = G.player, r = Math.round;
    // 每艘飛船（給別人畫）：[號碼, 17 項狀態, 零件, 拾取範圍, 離線]
    const row = (p, slot, parts, magnet) => [slot, r(p.x), r(p.y), r2(p.aim), r2(p.hp), p.maxHp, r2(Math.max(0, p.dashT)), r2(Math.max(0, p.iframe)),
      p.overdrive > 0 ? 1 : 0, p.moving ? 1 : 0, p.dead ? 1 : 0, r(p.vx), r(p.vy), r2(p.reviveT),
      0, p.shield || 0, p.frostT > 0 ? 1 : 0, 0,  // （空位）、護盾層數、被凍住、（空位）
      PART_IDS.map(id => parts[id] || 0), r(CFG.MAGNET_RANGE * (1 + magnet)), p.gone ? 1 : 0, Game.wardOf(p), weaponRow(p)];  // 最後：終焉護殼還能免死幾次  // 拾取範圍：隊友那邊模擬晶體飛向這艘船時用
    const rows = [row(P, 1, G.parts, G.passives.magnet), ...G.mates.map(m => row(m, m.slot, m.L.parts, m.L.passives.magnet))];
    // 敵人：種類、mode 這些字串寫成 et 的編號；待機的（蟲潮整區可能幾百隻）每 NET_IDLE_EVERY 次才送完整資料，中間只列 id 在 ei
    const full = this.sendN++ % NET_IDLE_EVERY === 0, et = [], etIdx = new Map(), ei = [], live = [];
    const ti = k => { let i = etIdx.get(k); if (i == null) { i = et.length; et.push(k); etIdx.set(k, i); } return i; };
    for (const e of G.enemies) if (!e.dead) {  // netSent：送過一次完整資料（隊友那邊才有東西可以沿用）
      if (!full && e.alert === false && e.spawnT <= 0 && e.netSent) ei.push(e.id); else { live.push(e); e.netSent = true; }
    }
    const shared = {
      ob: Objects.pack(),         // 地圖物件
      pt: G.portals.map(q => [r(q.ax), r(q.ay), r(q.bx), r(q.by), r2(q.t), q.color]),
      zn: G.zones.map(z => [r(z.x), r(z.y), z.r, r2(z.t), z.max]),  // 王的落點轟炸（紅圈）
      dc: G.decoys.map(d => [r(d.x), r(d.y), r2(d.t), d.slot, r2(d.aim)]),  // 殘影（幻影號）
      tu: G.turrets.map(q => [r(q.x), r(q.y), r2(q.t), q.slot, r2(q.aim)]),  // 砲台（哨兵號）
      e: live.map(e => trimRow([e.id, ti(e.type), r(e.x), r(e.y), r(e.vx), r(e.vy), r(e.hp), r(e.maxHp), r2(e.rot),
        e.flash > 0 ? 1 : 0, r2(Math.max(0, e.spawnT)), e.spawnMax, ti(e.mode), r2(e.modeT), r2(e.chargeA),
        e.slowT > 0 ? 1 : 0, e.burnT > 0 ? 1 : 0, e.enraged ? 1 : 0, e.stuck ? e.stuck.length : 0,
        e.shieldA != null ? r2(e.shieldA) : null, r2(e.cloak || 0),  // 盾衛的盾方向、潛伏者的隱形程度
        e.t.syncCd ? r2(e.cd) : null, e.markT > 0 || e.shredT > 0 ? 1 : 0,  // 倒數（t.syncCd：噴吐者鼓起、母巢脈動、星環守門者的光束）、弱點標記／破甲
        e.type === 'worm' ? wormAhead(e) : null,  // 列隊蟲：前面那節（活著的）的 id，0 = 自己是頭
        e.affixes ? e.affixes.join(',') : null, e.r !== e.t.radius ? r2(e.r) : null, e.ledT > 0 ? 1 : 0,  // 精英詞綴、體型（分裂後變小）、被統帥加成
        e.alertT > 0 ? r2(e.alertT) : 0, e.tgt || 0,  // 剛發現玩家（頭上「!」還顯示幾秒）、拖曳艦鎖定／牽引的玩家號碼（被拉的人自己拉自己，Game.beamPull）
        e.grp || 0])),  // 同一隻精英（分裂、編隊）：精英血條同一條

      et, ei,
      pk: G.pickups.map(c => [c.id, r(c.x), r(c.y), r2(c.life), r(c.vx), r(c.vy), c.vacuum ? 1 : 0]),
      lt: this.lootTotal, w: G.combat ? G.combat.wave : 0, k: G.kills, ex: G.exit ? [r(G.exit.x), r(G.exit.y), G.exit.r, G.exit.gate ? 1 : 0] : null, ar: G.combat ? G.combat.areaN || 0 : 0,
      as: Arena.rect ? 0 : [Arena.seed, Arena.n, Arena.bossId || 0, Arena.sc || 1], go: Arena.gates.filter(g => g.open).length,  // 大地圖：種子（隊友照種子產生同一張地圖）、開了幾道閘門
      bn: FX.banner ? [FX.banner.text, FX.banner.sub || '', r2(FX.banner.t)] : null,
      fx: this.fxBuf,
    };
    for (const q of to) {
      const m = this.mateOf(q);
      // 只傳這個隊友附近的子彈（畫面外的不用畫）
      const near = (x, y) => Math.abs(x - m.x) < 1300 && Math.abs(y - m.y) < 1000;
      const pal = [], palIdx = new Map();
      const ci = c => { let i = palIdx.get(c); if (i == null) { i = pal.length; pal.push(c); palIdx.set(c, i); } return i; };
      this.sendTo(q, { t: 's', ...shared,
        p: rows.filter(a => a[0] !== q.slot),  // 其他人的飛船
        me: [r2(m.hp), m.maxHp, r2(Math.max(0, m.iframe)), m.dead ? 1 : 0, m.lastHit || '', r2(m.reviveT),
        0, 0, 0, m.shield || 0, r2(m.drRec || 0), 0, r2(Math.max(0, m.frostT || 0)), 0, 0, 0, m.streak || 0],  // …、（空位 ×3）、護盾、灰血（畫血條用）、（空位）、被凍住剩幾秒（隊友自己的船要變慢）、（空位 ×3）、無傷連殺層數
        ws: weaponRow(m),  // 自己的武器狀態（HUD）
        kp: m.L.playKills,  // 這個隊友各晶片的玩法擊殺數（隊友那邊的紀錄用；pk 是晶體，名字不能撞）
        ...this.bulletRows(q, near, ci),
        eb: G.eBullets.filter(b => near(b.x, b.y)).map(b => [r(b.x), r(b.y), r(b.vx), r(b.vy), b.r, b.col ? ci(b.col) : -1, b.mine ? r2(b.life) : 0]),  // 盾衛反彈的原本顏色、地雷剩幾秒（0 = 不是地雷）
        pal,
      });
    }
    this.fxBuf = [];
  },

  // 子彈：隊友那邊照直線自己飛（clientUpdate），這裡只送他會猜錯的——新的、轉彎、變速、停住的（跟上次送給他的直線預測差超過 BULLET_TOL）；
  //   消失的只送編號（bd）。q.bSent：子彈 → 上次送給這個隊友的 [x, y, 角度, 速度, 時間]（每個隊友各一份：只送他附近的）
  //   b：[編號, x, y, 角度, 速度（停住的 0）, 半徑, 顏色, 形狀, 分裂, 帶子彈, 剩下時間, 尾巴長]
  bulletRows(q, near, ci) {
    const G = Game, S = q.bSent || (q.bSent = new Map()), live = new Set(), b = [], bd = [], r = Math.round, T = BULLET_TOL;
    for (const o of G.bullets) {
      if (o.dead) continue;
      live.add(o);
      if (!near(o.x, o.y)) continue;
      const sp = ['park', 'wait', 'orbit'].includes(o.mode) ? 0 : o.speed, p = S.get(o);
      if (p) {
        const dt = G.time - p[4], ex = p[0] + Math.cos(p[2]) * p[3] * dt - o.x, ey = p[1] + Math.sin(p[2]) * p[3] * dt - o.y;
        if (Math.abs(ex) < T && Math.abs(ey) < T && Math.abs(angleDiff(p[2], o.angle)) < 0.05 && p[5] === o.r) continue;  // 大小變了也重送（疊井、疊輪、磨盤）
      }
      S.set(o, [o.x, o.y, o.angle, sp, G.time, o.r]);
      b.push([o.nid, r(o.x), r(o.y), r2(o.angle), r(sp), r2(o.r), ci(o.color), o.shape, r2(o.life), r(Math.min(60, Math.hypot(o.x - o.sx, o.y - o.sy))), o.vortex ? r(o.vortex) : 0]);  // 最後一欄：漩渦的吸引半徑（隊友畫範圍圈）
    }
    for (const o of S.keys()) if (!live.has(o)) { bd.push(o.nid); S.delete(o); }
    return { b, bd };
  },

  // ---------- 隊友 ----------
  clientUpdate(dt) {
    const G = Game, P = G.player;
    if (G.state === 'play' && !this.pauseReason()) {  // 房主在編輯電路、切到其他視窗、斷線時全員暫停
      G.time += dt;
      if (G.runStats) G.runStats.time += dt;
      if (!P.dead) {
        P.update(dt);
        for (const e of G.enemies) if (e.shieldA != null && e.spawnT <= 0) G.shieldBlock(e, P);  // 盾衛的盾：自己的船自己推開（傷害房主算）
      }
      // 兩次戰場狀態之間：照速度往前推，畫面才會滑順
      for (const e of G.enemies) {
        e.modeT -= dt;
        if (e.cd !== undefined) e.cd -= dt;
        if (e.t.beams && !(e.spawnT > 0)) e.rot += dt * (e.enraged ? CFG.WARDEN.spinRage : CFG.WARDEN.spin) * endlessAtk();  // 星環守門者的光束照轉速往前轉（同步 1/30 秒一次，不然光束每兩幀才跳一次）
        if (e.spawnT > 0) e.spawnT -= dt;
        else { e.x += e.vx * dt; e.y += e.vy * dt; }
      }
      for (const b of G.bullets) { b.x += Math.cos(b.angle) * b.speed * dt; b.y += Math.sin(b.angle) * b.speed * dt; if (b.speed) b.life -= dt; }  // 停住的（速度 0）不倒數：等房主說消失
      for (const b of G.eBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
      Objects.clientStep(dt);
      for (const c of G.pickups) {  // 晶體：用和房主一樣的算法飛向最近的玩家；碰到自己就先藏起來（房主那邊才真的入帳）
        if (c.gone) continue;
        let best = P.dead ? null : P, bd = P.dead ? Infinity : dist2(c.x, c.y, P.x, P.y);  // 一樣近就算自己的
        for (const m of G.mates) if (!m.dead && !m.gone) { const d = dist2(c.x, c.y, m.x, m.y); if (d < bd) { bd = d; best = m; } }
        if (!best) continue;
        stepPickup(c, best, best === P ? CFG.MAGNET_RANGE * (1 + G.passives.magnet) : best.magnet || CFG.MAGNET_RANGE, bd, dt);
        if (bd < 20 * 20) c.gone = true;
      }
      G.pickups = G.pickups.filter(c => !c.gone || G.time - (c.goneT = c.goneT || G.time) < 1);  // 藏起來的留 1 秒，免得下一次同步又冒出來
      for (const m of G.mates) if (!m.dead) { coast(m, dt); m.iframe -= dt; m.dashT -= dt; }
      this.inAcc += dt;
      if (this.inAcc >= NET_RATE && !P.dead) {
        this.inAcc = Math.min(this.inAcc - NET_RATE, NET_RATE);
        this.send({ t: 'i', x: Math.round(P.x), y: Math.round(P.y), vx: Math.round(P.vx), vy: Math.round(P.vy), a: r2(P.aim),
          mv: P.moving ? 1 : 0, dT: r2(Math.max(0, P.dashT)), ds: P.dashSeq || 0, as: P.altSeq || 0, f: P.wantFire ? 1 : 0,
          ad: Math.round(P.aimD || 300), sx: Math.round(P.dashSX == null ? P.x : P.dashSX), sy: Math.round(P.dashSY == null ? P.y : P.dashSY), au: P.autoMode ? 1 : 0 });
      }
    }
    if (G.state === 'play' || G.state === 'dead') G.updateFx(dt);
    if (G.inArena) G.updateCamera(dt);
  },
  applySnap(s) {
    const G = Game;
    if (G.mode !== 'coop' || !G.combat || !G.inArena || (G.state !== 'play' && G.state !== 'dead')) return;
    const arr = v => (Array.isArray(v) ? v : []);
    for (const row of arr(s.p)) {  // 其他人的飛船：[號碼, 17 項狀態, 零件, 拾取範圍, 離線]（見 hostSend）
      const m = Array.isArray(row) && G.mates.find(q => q.slot === row[0]), p = m && row.slice(1);
      if (!m) continue;
      netMove(m, num(p[0], m.x), num(p[1], m.y)); m.aim = num(p[2]);  // 畫面上不跳（見 netMove） m.hp = num(p[3]); m.maxHp = num(p[4], m.maxHp);
      m.dashT = num(p[5]); m.iframe = num(p[6]); m.overdrive = p[7] ? 1 : 0; m.moving = !!p[8]; m.dead = !!p[9];
      m.vx = num(p[10]); m.vy = num(p[11]); m.reviveT = num(p[12]);
      m.shield = clamp(num(p[14]), 0, 9); m.frostT = p[15] ? 0.2 : 0;
      const pp = arr(p[17]); m.parts = Object.fromEntries(PART_IDS.map((id, i) => [id, clamp(num(pp[i]), 0, 20)]));
      m.magnet = num(p[18], CFG.MAGNET_RANGE); m.gone = !!p[19]; m.ward = clamp(Math.floor(num(p[20])), 0, 9);
    }
    const P = G.player;
    if (Array.isArray(s.me)) {  // 自己的血量以房主為準
      const hp = num(s.me[0], P.hp);
      if (hp < P.hp - 0.01 && !P.dead) {
        const R = G.runStats, k = typeof s.me[4] === 'string' && s.me[4] ? s.me[4].slice(0, 60) : '其他';  // 遊玩紀錄：受到的傷害依來源（房主算的，這邊照血量差記）
        if (R) { R.taken[k] = (R.taken[k] || 0) + (P.hp - hp); R.hits++; }
        G.shake(9); Events.emit('playerHurt', { p: G.player, dead: hp <= 0 });
        burst(P.x, P.y, '#ff4d6d', 16, 240, 0.4, 2);
      }
      P.hp = hp; P.maxHp = num(s.me[1], P.maxHp); P.drRec = num(s.me[10], 0);
      if (s.me[2] > 0) P.iframe = num(s.me[2]);
      if (typeof s.me[4] === 'string') G.lastHit = s.me[4].slice(0, 60);
      if (s.me[3] && !P.dead) { P.dead = true; Input.down = false; burst(P.x, P.y, P.ship.color, 80, 400, 1.2, 3); G.shake(20); }
      else if (!s.me[3] && P.dead && hp > 0) { P.dead = false; P.vx = P.vy = 0; P.iframe = CFG.REVIVE.iframe; }  // 被隊友救起來
      P.reviveT = num(s.me[5]);
      P.shield = num(s.me[9]);
      if (s.me[12] > 0) P.frostT = Math.max(P.frostT || 0, num(s.me[12]));
      P.streak = num(s.me[16], 0);  // 無傷連殺（畫左上小條用）
    }
    if (s.kp && typeof s.kp === 'object')  // 玩法擊殺：房主算好的次數，這邊只增不減
      for (const k in s.kp) if (hasLv(k) && num(s.kp[k]) > (G.playKills[k] || 0)) G.playKills[k] = Math.floor(num(s.kp[k]));
    const et = arr(s.et), prev = new Map(G.enemies.map(e => [e.id, e]));
    G.enemies = arr(s.e).map(a => {
      const type = et[a[1]], t = typeof type === 'string' && ENEMY_TYPES[type];
      if (!t) return null;
      return { id: a[0], type, t, r: typeof a[25] === 'number' ? clamp(a[25], 4, t.radius) : t.radius, x: num(a[2]), y: num(a[3]), vx: num(a[4]), vy: num(a[5]),
        hp: num(a[6]), maxHp: num(a[7], 1), rot: num(a[8]), flash: a[9] ? 0.08 : 0, spawnT: num(a[10]), spawnMax: num(a[11], 1) || 1,
        mode: et[a[12]], modeT: num(a[13]), chargeA: num(a[14]), slowT: a[15] ? 1 : 0, burnT: a[16] ? 1 : 0, enraged: !!a[17], stuckN: num(a[18]),
        shieldA: typeof a[19] === 'number' ? a[19] : null, cloak: num(a[20]), dead: false,
        cd: typeof a[21] === 'number' ? a[21] : undefined, markT: a[22] ? 1 : 0, aheadId: type === 'worm' ? num(a[23]) : undefined,
        affixes: typeof a[24] === 'string' ? a[24].split(',').filter(id => AFFIX[id]).slice(0, 3) : null, ledT: a[26] ? 1 : 0, alertT: num(a[27]), tgt: num(a[28]), grp: num(a[29]) || undefined };
    }).filter(Boolean);
    for (const id of arr(s.ei)) { const e = prev.get(id); if (e) G.enemies.push(e); }
    applyWeaponRow(P, s.ws);  // 武器狀態：敵人更新完才套（鉤爪找勾住的那隻）
    for (const row of arr(s.p)) { const m = Array.isArray(row) && G.mates.find(q => q.slot === row[0]); if (m) applyWeaponRow(m, row[22]); }
    // 守門者的光束：同步來的角度是單程延遲之前的，再往前轉「轉速 × 單程延遲（來回延遲的一半）」才跟房主判定用的對齊
    //   （tests/beamlag.js 量過：不補的話單程延遲 100ms 時，隊友看到光束碰到船之前 133ms 就被扣血）；
    //   往目標修一半（自己照轉速推算的跟房主差一點，直接蓋掉會一下快一下慢）
    const lead = (this.ping || 0) / 2000;
    for (const e of G.enemies) {
      if (!e.t.beams) continue;
      const want = e.rot + lead * (e.enraged ? CFG.WARDEN.spinRage : CFG.WARDEN.spin) * endlessAtk(), o = prev.get(e.id);
      e.rot = o && o !== e ? o.rot + angleDiff(o.rot, want) * 0.5 : want;
    }
    const byId = new Map(G.enemies.map(e => [e.id, e]));  // 列隊蟲：用 id 接回前面那節（找不到 = 自己是頭）
    for (const e of G.enemies) if (e.aheadId !== undefined) e.ahead = byId.get(e.aheadId) || null;  // 沿用的那節也要重接（前面那節可能換成新的物件）
    const pal = arr(s.pal);
    // 子彈：只收到新的、跟直線預測不一樣的（見 bulletRows），其他的照直線自己飛；消失的照編號拿掉，太久沒消息的（訊息掉了）自己拿掉
    const byN = new Map(G.bullets.map(b => [b.nid, b])), gone = new Set(arr(s.bd));
    for (const a of arr(s.b)) {
      if (!Array.isArray(a)) continue;
      const ang = num(a[3]), tl = num(a[9]);
      let b = byN.get(a[0]);
      if (!b) { b = { nid: a[0] }; byN.set(a[0], b); G.bullets.push(b); }
      Object.assign(b, { x: num(a[1]), y: num(a[2]), angle: ang, speed: num(a[4]), r: num(a[5], 3), color: typeof pal[a[6]] === 'string' ? pal[a[6]] : '#fff',
        shape: a[7], life: num(a[8], 1), sx: num(a[1]) - Math.cos(ang) * tl, sy: num(a[2]) - Math.sin(ang) * tl, vortex: num(a[10]) });
    }
    G.bullets = G.bullets.filter(b => !gone.has(b.nid) && b.life > -BULLET_STALE);
    if (Array.isArray(s.as)) {  // 大地圖：第一次收到（或換了一張）就照種子產生，自己的飛船放到出生點
      if (Arena.rect || Arena.seed !== num(s.as[0]) || (Arena.sc || 1) !== num(s.as[3], 1)) {
        if (ENEMY_TYPES[s.as[2]] && ENEMY_TYPES[s.as[2]].boss) Arena.genBoss(num(s.as[0]), s.as[2]);  // 旗艦戰
        else Arena.gen(num(s.as[0]), clamp(Math.floor(num(s.as[1], 2)), 2, 5), clamp(num(s.as[3], 1), 0.5, 1));
        G.player.resetPos(); G.player.x += G.slotX(this.slot);
        G.cam.x = G.player.x - ZW / 2; G.cam.y = G.player.y - ZH / 2;
      }
    } else if (s.as === 0 && !Arena.rect) Arena.reset();
    Arena.gates.forEach((g, i) => { g.open = i < num(s.go); });
    G.objs = Objects.unpack(s.ob);
    G.zones = arr(s.zn).filter(Array.isArray).map(a => ({ x: num(a[0]), y: num(a[1]), r: num(a[2], 100), t: num(a[3]), max: num(a[4], 1) || 1 }));
    G.decoys = arr(s.dc).filter(Array.isArray).slice(0, NET_MAX).map(a => ({ x: num(a[0]), y: num(a[1]), t: num(a[2]), slot: clamp(Math.floor(num(a[3], 1)), 1, NET_MAX), aim: num(a[4]), r: 12, decoy: true }));
    G.turrets = arr(s.tu).filter(Array.isArray).slice(0, NET_MAX).map(a => ({ x: num(a[0]), y: num(a[1]), t: num(a[2]), slot: clamp(Math.floor(num(a[3], 1)), 1, NET_MAX), aim: num(a[4]) }));
    G.portals = arr(s.pt).filter(Array.isArray).map(a => ({ ax: num(a[0]), ay: num(a[1]), bx: num(a[2]), by: num(a[3]), t: num(a[4]), color: typeof a[5] === 'string' ? a[5] : '#2ee6a6' }));
    G.eBullets = arr(s.eb).map(a => ({ x: num(a[0]), y: num(a[1]), vx: num(a[2]), vy: num(a[3]), r: num(a[4], 5), col: typeof pal[a[5]] === 'string' ? pal[a[5]] : null,
      mine: num(a[6]) > 0, life: num(a[6]), max: AFFIX.mine.life }));
    // 晶體：隊友這邊自己模擬飛行（見 clientUpdate），房主的位置只拿來慢慢修正，不直接跳過去
    const had = new Map(G.pickups.map(c => [c.id, c]));
    G.pickups = arr(s.pk).map(a => {
      const id = a[0], x = num(a[1]), y = num(a[2]), c = had.get(id);
      if (!c) return { id, x, y, life: num(a[3], 5), vx: num(a[4]), vy: num(a[5]), vacuum: !!a[6] };
      if (c.gone) return c;
      c.x += (x - c.x) * 0.25; c.y += (y - c.y) * 0.25;
      c.life = num(a[3], c.life); c.vacuum = !!a[6];
      return c;
    });
    this.applyLoot(s.lt);
    G.kills = num(s.k, G.kills); G.combat.wave = num(s.w, G.combat.wave);
    G.exit = Array.isArray(s.ex) ? { x: num(s.ex[0]), y: num(s.ex[1]), r: num(s.ex[2], 40), gate: !!s.ex[3] } : null;  // 區域出口（大地圖：閘門）
    if (num(s.ar) !== (G.combat.areaN || 0)) {  // 換區了：倒下的人如果還在後面的區域，搬到新區域的入口（還活著的自己飛過去）
      G.combat.areaN = num(s.ar);
      if (!Arena.rect) { if (G.player.dead) G.toEntry(G.player, G.combat.areaN); }
      else { G.player.resetPos(); G.player.x += G.slotX(this.slot); G.cam.x = G.player.x - ZW / 2; G.cam.y = G.player.y - ZH / 2; }
    }
    FX.banner = Array.isArray(s.bn) ? { text: String(s.bn[0]), sub: String(s.bn[1] || ''), t: num(s.bn[2], 1) } : null;
    for (const f of arr(s.fx)) {  // 房主那邊發生的特效與音效
      if (!Array.isArray(f)) continue;
      switch (f[0]) {
        case 'b': burst(num(f[1]), num(f[2]), String(f[3]), Math.min(150, num(f[4])), num(f[5], 200), num(f[6], 0.5), num(f[7], 2)); break;
        case 't': floatText(num(f[1]), num(f[2]), String(f[3]), String(f[4]), !!f[5]); break;
        case 's': SFX.play(String(f[1]), f[2]); break;
        case 'f': flashFx(num(f[1]), num(f[2]), num(f[3], 60)); break;  // 彗星爆炸的閃光
        case 'r': ringFx(num(f[1]), num(f[2]), num(f[3], 40), String(f[4]), f[5] === 1); break;
        case 'z': zapFx(num(f[1]), num(f[2]), num(f[3]), num(f[4]), { c: typeof f[5] === 'string' ? f[5].slice(0, 9) : null }); break;
      }
    }
  },
};
addEventListener('beforeunload', () => Net.close());
// 背景分頁的遊戲迴圈（requestAnimationFrame）停住：改用計時器送 ping，對方才知道我還在（keepAlive）
if (typeof setInterval === 'function') { const iv = setInterval(() => { if (document.hidden && Net.role) Net.send({ t: 'ping', at: performance.now() }); }, 1000); if (iv && iv.unref) iv.unref(); }  // unref：在 node 跑測試時不擋住程式結束
// 切到其他視窗／分頁時通知隊友：兩人一起暫停（瀏覽器會把背景分頁的遊戲停住，不暫停的話飛船會站著挨打）
document.addEventListener('visibilitychange', () => {
  if (Net.role) Net.send({ t: 'hid', on: document.hidden });  // 房間裡也送：背景分頁送不出 ping，對方先不要判斷斷線（keepAlive）
  if (!document.hidden && Net.role) {  // 自己切回來：背景時的訊息可能晚到，從現在重新算
    const now = performance.now();
    if (Net.heard) Net.heard = now;
    for (const q of Net.peers) if (q.heard) q.heard = now;
  }
  if (!Net.linked || Game.mode !== 'coop') return;
  if (Net.role === 'host') { Net.myAway = document.hidden; Net.pushPause(); } else Net.send({ t: 'away', on: document.hidden });
});
