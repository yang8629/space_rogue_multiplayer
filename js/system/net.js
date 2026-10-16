// 星環電路 雙人版 · net.js：雙人連線：大廳、選配裝、同步、投票、錢包、斷線重連、雙人紀錄
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// NET — 雙人連線（PeerJS / WebRTC 點對點）
//   房主：跑整個戰場（敵人、子彈、傷害判定），每秒約 30 次把戰場狀態傳給隊友
//   隊友：自己飛船的移動、衝刺在自己電腦上算（零延遲），把位置與「有沒有按開火」傳給房主
//   房主替隊友開火時，用 withLoadout 換上隊友的武器與電路
// =====================================================================
const LOADOUT_KEYS = ['chain', 'socks', 'inventory', 'slotAttr', 'wSock', 'weapon', 'wp', 'stats', 'passives', 'shipId', 'playKills', 'pullHits', 'parts', 'partSlots', 'cap', 'mech', 'boons'];
const NET_PREFIX = 'circuitrogue-mp-';
const NET_CODE_CHARS = 'ABCDEFGHJKLNPQSTUVWXYZ23456789';  // 去掉容易看錯的 I O 0 1，以及快捷鍵 M R
const NET_RATE = 1 / 30;
const NET_VOTE_TIME = 20;  // 兩人都回到航圖後的投票時間（秒）
const NET_GO_TIME = 3;     // 兩人都選好節點後，倒數幾秒進關卡
const NET_REJOIN_TIME = 120;  // 斷線後房間保留多久等隊友重連（秒）
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = v => Math.round(v * 100) / 100;
const wormAhead = e => { let a = e.ahead; while (a && a.dead) a = a.ahead; return a ? a.id : 0; };

const NET_MAX = 4;  // 一個房間最多幾人（含房主）

const Net = {
  role: null,          // null = 單人；'host' = 房主；'client' = 加入的隊友
  peer: null, conn: null, ping: null, code: '',  // conn：隊友連到房主的那條（房主的連線在 peers 裡）
  // 房主：每個隊友一筆 { conn, slot, linked, inRoom, pick, at, editing, away, modWait, cleared, perf, ping, waiting }
  //   slot：幾號玩家（房主 1，隊友 2 起）；隊友的飛船在 Game.mates（同一個 slot）
  peers: [],
  pending: [],         // 房主：連上了但還沒打招呼（hello）的連線
  slot: 1,             // 隊友：房主分配給自己的號碼
  picks: {}, roster: [],  // 隊友：每個人選的配裝（號碼 → pick，房主轉告）、這一局的隊友號碼（等待畫面用）
  hold: null,          // 隊友：房主因為別的隊友斷線而暫停的原因
  // 下面幾個是「所有隊友」彙總出來的（房主由 refreshPeers 從 peers 算；隊友這邊就是房主的狀態）
  linked: false,       // 有隊友已經握手成功
  mateInRoom: false,   // 隊友都回到房間了
  mateEditing: false, mateAway: false,  // 有人在編輯電路／切到其他視窗（全員暫停）
  myPick: null, matePick: null,  // 自己選好的 { ship, weapon, chip }；matePick：隊友這邊記房主的
  chapter: 1,          // 這個房間選的章節：房主在大廳選，隊友照房主的
  at: {},              // 隊友：其他玩家在不在航圖（slot → 'map'；房主轉告）
  stats: null,         // 這一局的連線數據（寫進遊玩紀錄）
  fxBuf: [], sendAcc: 0, inAcc: 0, pingT: 0,
  active() { return !!this.role; },
  fx(e) { if ((this.conn || this.peers.some(q => q.conn)) && this.fxBuf.length < 400) this.fxBuf.push(e); },
  // 送訊息：隊友 → 房主；房主 → 所有隊友（只送給某一個用 sendTo）
  send(msg) {
    if (this.role === 'host') { for (const q of this.peers) this.sendTo(q, msg); return; }
    try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) {}
  },
  sendTo(q, msg) { try { if (q && q.conn && q.conn.open) q.conn.send(msg); } catch (e) {} },
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
    const peer = this.peer, conns = [this.conn, ...this.peers.map(q => q.conn), ...this.pending.map(q => q.conn)];
    this.peer = this.conn = null; this.role = null; this.ping = null; this.fxBuf = [];
    this.peers = []; this.pending = []; this.slot = 1; this.at = {}; this.myAway = false; this.hold = null; this.picks = {}; this.roster = [];
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
      const left = Math.max(0, Math.ceil((this.waiting.until - performance.now()) / 1000)), el = document.getElementById('rejoinLeft');
      if (el) el.textContent = left;
      if (left <= 0) this.giveUp();
      return;
    }
    if (!this.linked) return;
    // 暫停中（Tab、切到背景）、不在戰鬥、隊友倒下（倒下時不送操作）：同步間隔不累積，恢復後從下一則訊息重新算
    if (this.stats && (Game.state !== 'play' || this.pauseReason() || (this.role === 'host' && Game.mates.some(m => m.dead))))
      this.stats.lastRecv = 0;
    if (Game.mode === 'coop') {
      if (this.role === 'host' && this.voteEnd && performance.now() >= this.voteEnd && !this.pauseReason()) this.tryResolve(true);  // 投票時間到
      const vt = document.getElementById('voteTimer'), left = this.voteLeft();
      if (vt) vt.textContent = left != null ? `剩 ${left} 秒` : '';
      const gl = this.goUntil && document.getElementById('goLeft');  // 出發倒數
      if (gl) gl.textContent = Math.max(1, Math.ceil((this.goUntil - performance.now()) / 1000));
    }
    this.pingT += dt;
    if (this.pingT >= 1) {
      this.pingT = 0;
      const PF = Game.runStats && Game.runStats.perf;
      this.send({ t: 'ping', at: performance.now(), wf: PF ? PF.worst : 0, wfAt: PF ? PF.worstAt : '', sl: PF ? PF.slow : 0 });  // 順便告訴對方自己最慢的一幀（雙人紀錄用）
      if (this.role === 'host' && Game.mode === 'coop' && Game.inArena) this.sendDmg();  // 每秒同步一次兩人的傷害統計
    }
  },
  // ---------- 傷害統計：房主記兩人各自的傷害，同步給隊友 ----------
  // nm：每個晶片的顯示名稱與顏色（用那個人自己的武器、飛船算），對方畫面的「隊友傷害」直接用
  dmgPack(R, L = null) {
    if (!R) return null;
    const rd = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    const nm = Game.withLoadout(L, () => Object.fromEntries(Object.keys(R.chips).map(k => [k, [dmgKeyName(k), dmgKeyColor(k)]])));
    return { dmg: rd(R.dmg), chips: rd(R.chips), kills: R.kills, maxHit: Math.round(R.maxHit), nm, downs: R.downs || 0, revives: R.revives || 0 };
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
      kills: num(p.kills), maxHit: num(p.maxHit), downs: num(p.downs), revives: num(p.revives) } : null);
    const T = m.team && typeof m.team === 'object' ? m.team : {};
    this.team = {};
    for (let s = 1; s <= NET_MAX; s++) if (T[s]) this.team[s] = clean(T[s], s === this.slot);
    const R = Game.runStats, mine = this.team[this.slot];
    if (R && mine) Object.assign(R, { dmg: mine.dmg, chips: mine.chips, kills: mine.kills, maxHit: mine.maxHit, downs: mine.downs, revives: mine.revives });
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
  teamSummaryHtml() {
    const rows = this.teamRows(), sum = rows.reduce((a, r) => a + r.dmg, 0);
    const fmt = n => Math.round(n).toLocaleString('zh-TW');
    const body = rows.map(r => {
      const S = SHIPS[r.ship] || { name: '？', color: '#8fa3d9' }, pct = sum ? r.dmg / sum * 100 : 0;
      const c = Game.slotColor(parseInt(r.tag, 10));  // 玩家色（照號碼）
      return `<div class="sum-lab"><i style="background:${c}"></i><b style="color:${c}">${r.tag}</b> ${S.name}${r.me ? '（你）' : ''}</div>
        <div class="sum-track"><div style="width:${pct.toFixed(1)}%;background:${c}"></div></div>
        <div class="sum-val">${fmt(r.dmg)}<span>${pct.toFixed(0)}%</span></div>`;
    }).join('');
    const tile = (k, v) => `<div class="sum-tile"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="summary">
      <div class="sum-head"><span>多人傷害結算</span><b>${fmt(sum)}</b></div>
      <div class="sum-rows">${body}</div>
      <div class="sum-tiles">${rows.map(r => tile(`${r.tag} 擊殺`, fmt(r.kills)) + tile(`${r.tag} 最高單發`, fmt(r.maxHit))).join('')}</div></div>`;
  },
  pingColor(ms) { return ms == null ? '#8fa3d9' : ms < 80 ? '#9dff6b' : ms < 150 ? '#ffd166' : '#ff4d6d'; },

  // ---------- 大廳：開房 / 輸入房號加入 → 兩人到齊後房主按「開始」 ----------
  lobby(msg = '') {
    this.close();
    this.resetStats();
    this.renderLobby(msg);
  },
  // 一局結束後回到同一個房間（連線不斷），房主可以直接再按開始
  backToRoom() {
    if (!this.linked) { this.lobby('<span style="color:#ff4d6d">連線已經中斷，請重新開房或加入</span>'); return; }
    this.myPick = this.matePick = null;
    for (const q of this.peers) q.pick = null;
    this.send({ t: 'room' });
    if (this.role === 'client') this.sendProgress();  // 這一局可能剛通關：房主照新的進度開放章節
    this.renderLobby();
  },
  renderLobby(msg = '') {
    Game.state = 'lobby'; Game.inArena = false; Game.mates = [];
    const ok = typeof Peer !== 'undefined';
    Screen.show(`<div class="scr title-wrap">
      <h1 style="font-size:42px">👥 多人連線</h1>
      <div class="sub">先進同一個房間（最多 ${NET_MAX} 人），到齊後由房主按「開始」，再各自選飛船、武器與起始晶片。每局結束後會回到這個房間。</div>
      <div id="netBtns">${this.linked ? '' : ok ? `<div class="row"><button class="big" data-act="nethost">開房間</button></div>
        <div class="row"><input id="netCode" maxlength="4" placeholder="房號" autocomplete="off" spellcheck="false"
          style="font-size:22px;width:5.5em;text-align:center;letter-spacing:.3em;text-transform:uppercase;background:#0a1030;color:#fff;border:1px solid #4cc9f0;border-radius:6px;padding:8px">
          <button class="big" data-act="netjoin">加入房間</button></div>`
      : '<div class="sub" style="color:#ff4d6d">連線元件沒有載入（需要網路）。請確認有連上網路後重新整理。</div>'}</div>
      <div class="sub" id="netMsg" style="min-height:3em">${msg}</div>
      <div class="keys">一人按「開房間」拿到 4 碼房號，其他人輸入房號按「加入房間」。<br>
        多人遠征：航圖投票（選不同就照票數抽籤）、錢包各自獨立（怪物掉落的晶體每人都拿）、獎勵各自選、戰鬥中按 Tab 全員一起暫停。<br>
        一人被擊墜時留在原地，隊友靠近 ${CFG.REVIVE.time} 秒就能救起來（救的人分出自己一半的血量）；沒被救起的在戰鬥結束後以 30% HP 歸隊；全員都被擊墜才結束。</div>
      <div class="row">${this.linked ? '<button data-act="title">離開房間</button>' : '<button data-act="title" data-back>返回標題 (Esc)</button>'}</div>
      <div class="ver">版本 ${CFG.VERSION}</div></div>`);
    if (this.linked) this.lobbyStatus();
  },
  setMsg(html) { const el = document.getElementById('netMsg'); if (el) el.innerHTML = html; },
  // 連上之後的大廳狀態（延遲每秒更新）
  lobbyStatus() {
    if (Game.state !== 'lobby') return;
    const btns = document.getElementById('netBtns');
    if (btns && this.linked) btns.innerHTML = '';
    const ping = `<span style="color:${this.pingColor(this.ping)}">連線延遲 ${this.ping == null ? '測量中…' : this.ping + ' ms'}</span>`;
    if (!this.linked) return;
    const mate = this.mateInRoom ? `<b style="color:#9dff6b">隊友在房間裡${this.peers.length > 1 ? `（${this.peers.length} 人）` : ''}</b>` : '<span style="color:#ffd166">等隊友回到房間…</span>';
    this.setMsg(this.role === 'host'
      ? `房號 <b style="letter-spacing:.2em;color:#ffd166">${this.code}</b>　·　${mate}　·　${ping}
         <div class="row">${this.chapterButtons()}</div>
         <div class="row"><button class="big" data-act="netstart" ${this.mateInRoom ? '' : 'disabled'}>開始（選擇配裝）</button></div>`
      : `房間 <b style="letter-spacing:.2em;color:#ffd166">${this.code}</b>　·　${ping}<br>章節：<b style="color:#ffd166">${chapterById(this.chapter).name}</b>（房主選）<br>等待房主按「開始」…`);
  },
  // ---------- 章節：房主在大廳選，所有人都解鎖的章節才能選 ----------
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
    this.lobbyStatus();
  },
  sendProgress() { this.send({ t: 'prog', cleared: chapterProgress() }); },  // 隊友：把自己的通關進度告訴房主
  // 隊友：這個分頁在哪個房間是幾號（重新整理後重連時告訴房主，免得兩人同時斷線時坐錯位置）
  rememberSeat() { try { sessionStorage.setItem('v2_seat', JSON.stringify({ code: this.code, slot: this.slot })); } catch (e) {} },
  seatHint(code) { try { const s = JSON.parse(sessionStorage.getItem('v2_seat') || 'null'); return s && s.code === code ? s.slot : null; } catch (e) { return null; } },

  host() {
    this.close();
    this.role = 'host'; this.pending = [];
    const code = this.code = Array.from({ length: 4 }, () => pick([...NET_CODE_CHARS])).join('');
    this.setMsg('正在建立房間…');
    const btns = document.getElementById('netBtns');
    if (btns) btns.innerHTML = '';  // 開了房間就不再顯示「開房間／加入房間」（離開用下方的按鈕；開房失敗會回到大廳重新顯示）
    const peer = this.peer = new Peer(NET_PREFIX + code);
    peer.on('open', () => this.setMsg(`房號 <b style="font-size:34px;letter-spacing:.2em;color:#ffd166">${code}</b><br>把房號告訴隊友，等待加入中…`));
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
    if (!/^[A-Z0-9]{4}$/.test(code)) { this.setMsg('<span style="color:#ff4d6d">請輸入 4 碼房號</span>'); return; }
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
  inRun() { return Game.mode === 'coop' && !!this.runId && !['lobby', 'title', 'pick', 'wait'].includes(Game.state); },
  // 斷線：q = 房主這邊斷掉的那個隊友（null：隊友斷了和房主的連線，或房主自己的連線元件出錯）
  lost(msg = '隊友已離線', q = null) {
    if (!this.role) return;
    if (this.role === 'host') {
      if (q && this.pending && this.pending.includes(q)) { this.pending = this.pending.filter(o => o !== q); return; }  // 還沒打招呼就斷了
      if (q && !this.peers.includes(q)) return;
      const list = q ? [q] : this.peers.filter(o => o.linked);
      if (this.inRun() && this.peer && !this.peer.destroyed) { for (const o of list) this.waitForMate(msg, o); if (list.length) return; }
      if (q && this.peers.length > 1) {  // 還沒開始、還有其他隊友：只讓他離開
        this.peers = this.peers.filter(o => o !== q); this.refreshPeers();
        if (Game.state === 'lobby') this.lobbyStatus(); else this.backToRoom();
        return;
      }
      this.endLost(msg);
      return;
    }
    if (this.inRun()) { this.clientLost(msg); return; }
    this.endLost(msg);
  },
  endLost(msg) {  // 放棄這一局：存紀錄、回到「連線中斷」畫面
    if (Game.mode === 'coop' && Game.inArena && Game.state === 'play') Game.saveRecord('disconnect');  // 戰鬥中斷線也存一筆
    this.waiting = null; this.rejoining = null; this.hideOverlay();
    const inLobby = Game.state === 'lobby';
    this.close(); this.runId = null;
    if (inLobby) { this.lobby(`<span style="color:#ff4d6d">${msg}</span>`); return; }
    if (Game.state === 'title') return;
    Game.mates = []; Game.state = 'title'; Game.inArena = false;
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:40px;color:#ff4d6d">連線中斷</h1>
      <div class="sub">${msg}</div>
      <div class="row"><button class="big" data-act="title">回到標題</button><button data-act="records">📜 遊玩紀錄</button></div></div>`);
  },

  // ---------- 斷線重連 ----------
  // 房主：隊友斷線 → 遊戲暫停，房間保留 NET_REJOIN_TIME 秒等隊友回來（重新整理後輸入同一個房號也可以）
  waitForMate(msg, q) {
    const conn = q.conn;
    q.conn = null; q.linked = false; q.editing = false; q.away = false; q.ping = null; q.at = null;
    try { conn && conn.close(); } catch (e) {}
    q.waiting = { until: performance.now() + NET_REJOIN_TIME * 1000, msg };
    this.voteEnd = 0;
    this.refreshPeers(); this.pushPause();
    this.waitOverlay();
  },
  waitOverlay() {
    const W = this.waiting;
    if (!W) return;
    const left = Math.max(0, Math.ceil((W.until - performance.now()) / 1000));
    this.overlay(`<h2 style="color:#ffd166;margin:0">⏸ 隊友斷線了</h2>
      <div class="sub">${W.msg}<br>遊戲暫停中，房間保留 <b id="rejoinLeft">${left}</b> 秒。<br>
        請隊友按「重新連線」；如果他重新整理了頁面，選「多人連線」後輸入房號 <b style="letter-spacing:.2em;color:#ffd166">${this.code}</b> 就能回到這一局。</div>
      <div class="row"><button class="big" data-act="netsolo">自己繼續玩（隊友之後還能回來）</button>
        <button data-act="netgiveup">結束這一局</button></div>`);
  },
  // 房主：不等了，繼續玩。房間仍然開著，斷線的隊友用同一個房號就能回到當下的進度
  soloContinue() {
    if (!this.waiting) return;
    for (const q of this.peers) if (q.waiting) { q.waiting = null; q.gone = true; const m = this.mateOf(q); if (m) m.gone = true; }
    this.solo = true; this.refreshPeers(); this.pushPause();
    this.hideOverlay();
    if (Game.state === 'map') Screen.map(`隊友離線，你一個人繼續（房號 ${this.code}，隊友可以隨時回來）`);
  },
  // 隊友：斷線 → 暫停，可以按「重新連線」回到同一局
  clientLost(msg) {
    const conn = this.conn, peer = this.peer, first = !this.rejoin;
    this.conn = this.peer = null; this.linked = false; this.mateEditing = false; this.rejoining = false;
    try { conn && conn.close(); } catch (e) {}
    try { peer && peer.destroy(); } catch (e) {}
    this.rejoin = { code: this.code || (this.rejoin && this.rejoin.code), runId: this.runId, tries: first ? 0 : this.rejoin.tries, msg };
    this.rejoinOverlay();
    if (first) setTimeout(() => { if (this.rejoin && !this.rejoining && !this.linked) this.tryRejoin(); }, 1500);  // 先自動試一次
  },
  rejoinOverlay(note = '') {
    const R = this.rejoin;
    if (!R) return;
    this.overlay(`<h2 style="color:#ff9f1c;margin:0">連線中斷</h2>
      <div class="sub">${R.msg}${note ? `<br><span style="color:#ff4d6d">${note}</span>` : ''}<br>
        房主那邊會暫停並保留房間 ${NET_REJOIN_TIME} 秒，重新連線就能回到這一局。</div>
      <div class="row"><button class="big" data-act="netrejoin" ${this.rejoining ? 'disabled' : ''}>${this.rejoining ? '連線中…' : `重新連線（房號 ${R.code}）`}</button>
        <button data-act="netgiveup">放棄，回到標題</button></div>`);
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
    this.overlay('<h2 style="color:#9dff6b;margin:0">隊友重新連線中…</h2><div class="sub">正在把這一局的狀態傳給隊友。</div>');
  },
  // 房主：把目前這一局的狀態打包給重新連線的隊友 q
  resumePayload(q) {
    const G = Game, mate = this.mateOf(q), L = mate.L;
    const C = G.combat;
    return {
      t: 'resume', runId: this.runId, hostPick: this.myPick, state: G.state, slot: q.slot,
      others: this.peers.filter(o => o !== q && o.pick).map(o => ({ slot: o.slot, ...o.pick })),  // 其他隊友（三人以上）
      you: { pick: q.pick, weapon: L.weapon, chain: L.chain, sk: L.socks || [], inventory: L.inventory, sa: L.slotAttr || [],
        hp: mate.hp, maxHp: mate.maxHp, dead: !!mate.dead, credits: (L.credits || 0) + (this.lootTotal - (L.lootAtLo || 0)), dmg: this.dmgPack(L.R, L),
        parts: L.parts, ps: L.partSlots, cap: L.cap, ws: L.wSock, pk: L.playKills, bp: L.bonusPicks || 0, bn: L.boons },
      map: this.packMap(G.map), chapter: G.chapterId, sector: G.sector, bossId: G.bossId, node: G.node ? G.node.id : null, visited: G.visited,
      combat: G.inArena && C ? { level: C.level, wavesTotal: C.wavesTotal === Infinity ? 0 : C.wavesTotal, elites: C.elites, boss: !!C.boss, wave: C.wave } : null,
      lootTotal: this.lootTotal, victory: G.state === 'victory' ? G.victory : null,
    };
  },
  // 隊友：其他玩家的飛船（房主 + 其他隊友），照號碼排
  setMates(others) {
    const ships = [{ slot: 1, ship: this.matePick.ship }, ...(Array.isArray(others) ? others : [])
      .map(o => ({ slot: clamp(Math.floor(num(o && o.slot)), 2, NET_MAX), ship: this.cleanPick(o || {}).ship }))
      .filter(o => o.slot !== this.slot)];
    Game.mates = ships.map(o => { const m = new Player(SHIPS[o.ship]); m.slot = o.slot; return m; });
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
    this.roster = Object.keys(this.picks).map(Number).filter(s => s > 1).concat(this.slot);
    const Y = m.you || {};
    if (!soft) {
      this.myPick = this.cleanPick(Y.pick || {});
      this.resetStats();
      this.chapter = G.chapterId = this.cleanChapter(m.chapter);
      G.newRun('coop', this.myPick.ship, this.myPick.weapon, null);
      G.bonusPicks = clamp(Math.floor(num(Y.bp)), 0, 9);  // 開局三選一剩下的次數以房主記住的為準（newRun 會重設，所以放在它後面）
      const lo = this.sanitizeLoadout(Y);
      if (lo.weapon && lo.weapon.id === G.weapon.id) G.weapon = lo.weapon;
      G.chain = lo.chain; G.socks = lo.socks; G.inventory = lo.inventory; G.slotAttr = lo.slotAttr;
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
      Screen.victory();
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
  overlay(html) {
    let el = document.getElementById('netOverlay');
    if (!el) {
      el = document.createElement('div');
      el.id = 'netOverlay';
      el.addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b) Screen.act(b); });
      document.body.appendChild(el);
    }
    el.innerHTML = `<div class="panel">${html}</div>`;
    el.hidden = false;
  },
  hideOverlay() { const el = document.getElementById('netOverlay'); if (el) el.hidden = true; },

  // 收到訊息：q = 房主這邊是哪個隊友送來的（隊友這邊是 null，訊息都來自房主）
  onData(m, q = null) {
    if (!m || typeof m !== 'object') return;
    if (this.role === 'host' && q && m.t !== 'hello' && !this.peers.includes(q)) return;  // 還沒打招呼的連線只收 hello
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
          this.setMsg(`<span style="color:#ff4d6d">隊友的版本不同（你：${CFG.VERSION}／隊友：${theirs}），請兩邊都按 Ctrl+F5 重新整理</span>`);
          break;
        }
        this.pending = this.pending.filter(o => o !== q);
        const away = this.inRun() ? this.peers.filter(o => !o.linked) : [];
        const back = away.find(o => o.slot === m.slot) || away[0];  // 照他記得的號碼找回座位；記不得就給第一個空位
        if (back) { this.rejoinPeer(back, q.conn); break; }
        const slot = Array.from({ length: NET_MAX - 1 }, (_, i) => i + 2).find(s => !this.peers.some(o => o.slot === s));
        if (!slot || Game.state !== 'lobby') { this.sendTo(q, { t: 'full' }); setTimeout(() => { try { q.conn.close(); } catch (e) {} }, 500); break; }
        Object.assign(q, { slot, linked: true, inRoom: true, pick: null, at: null, cleared: [] });
        this.peers.push(q); this.refreshPeers();
        this.sendTo(q, { t: 'welcome', v: CFG.VERSION, code: this.code, slot });
        this.lobbyStatus();
        break;
      }
      case 'welcome': if (client) { this.linked = true; this.slot = clamp(Math.floor(num(m.slot, 2)), 2, NET_MAX); this.sendProgress(); this.lobbyStatus(); } break;
      case 'prog':  // 房主：隊友的通關進度；目前選的章有人沒解鎖就退回第一章
        if (!host) break;
        q.cleared = (Array.isArray(m.cleared) ? m.cleared : []).filter(n => CHAPTERS.some(c => c.id === n)).slice(0, CHAPTERS.length);
        if (!this.chapterOk(this.chapter)) this.chapter = 1;
        this.send({ t: 'chap', chapter: this.chapter });
        this.lobbyStatus();
        break;
      case 'chap': if (client) { this.chapter = this.cleanChapter(m.chapter); this.lobbyStatus(); } break;
      case 'hold': if (client) this.hold = typeof m.why === 'string' ? m.why.slice(0, 40) : null; break;
      case 'ver': this.lost(`你和房主的版本不同（你：${CFG.VERSION}／房主：${String(m.v || '舊版').slice(0, 40)}），請兩邊都按 Ctrl+F5 重新整理`); break;
      case 'room':
        if (host) { q.inRoom = true; this.refreshPeers(); } else this.mateInRoom = true;
        this.lobbyStatus();
        break;
      case 'full': this.lost(NET_MAX === 2 ? '這個房間已經有兩個人了' : `這個房間已經滿了（最多 ${NET_MAX} 人）`); break;
      case 'pick':
        if (client && Game.state === 'lobby') {
          this.chapter = Game.chapterId = this.cleanChapter(m.chapter);
          this.roster = (Array.isArray(m.slots) ? m.slots : []).map(s => Math.floor(num(s))).filter(s => s >= 2 && s <= NET_MAX);  // 這一局的隊友號碼
          this.enterPick();
        }
        break;
      case 'ready': this.onMateReady(m, q); break;
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
          setTimeout(() => { if (Game.state === 'dead') Screen.dead(); }, 900);
        }
        break;
      case 'dmg': if (client) this.onDmg(m); break;
      // ---- 斷線重連、切到背景 ----
      case 'resume': if (client) this.applyResume(m); break;
      case 'back':
        if (host) {
          q.away = false; this.refreshPeers(); this.pushPause();
          if (!this.waiting) this.hideOverlay(); else this.waitOverlay();
          if (Game.state === 'map') { this.checkVoteTimer(); Screen.map(); }
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
        if (Game.state === 'map') Screen.map();
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
        if (Game.state === 'map') Screen.map();
        if (host) this.tryResolve();
        break;
      }
      case 'vt': if (client) { this.voteEnd = performance.now() + clamp(num(m.s), 0, 60) * 1000; if (Game.state === 'map') Screen.map(); } break;
      case 'go':
        if (client && Game.map && typeof m.node === 'string' && Game.nodeById(m.node)) {
          if (Game.state === 'editor') { Editor.close(); Game.recalc(); this.sendLoadout(); }
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
        if (Game.state === 'map') Screen.map();
        break;
      case 'hoard':
        if (!Array.isArray(m.ids) || !Game.map) break;
        Game.markHoard(m.ids.filter(id => typeof id === 'string').slice(0, 4), true);
        if (host) for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'hoard', ids: m.ids });
        if (Game.state === 'map') Screen.map();
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
        if (client && Game.state === 'victory') {
          const map = this.unpackMap(m.map);
          if (!map || !ENEMY_TYPES[m.bossId]) { this.lost('收到的星圖有問題，請兩邊都重新整理'); break; }
          this.nextMap = { map, bossId: m.bossId };
          Game.nextSector();
        }
        break;
      case 'finish': if (client && Game.state === 'victory') Game.finishRun(); break;
      case 'moddone':  // 隊友選好了旗艦獎勵：大家都好了，房主就可以前往下一星區
        if (host && q.modWait) { q.modWait = false; if (!this.modWaiting() && Game.state === 'victory') Screen.victory(); }
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
        if (host) { q.ping = ms; this.refreshPeers(); } else this.ping = ms;
        if (S && Game.state === 'play' && S.pings.length < 3600) S.pings.push(ms);
        this.lobbyStatus();
        break;
      }
    }
  },

  // ---------- 選配裝：房主按開始 → 每個人各自選飛船、武器、起始晶片 → 都選好就開戰 ----------
  beginPick() {
    if (this.role !== 'host' || !this.linked || !this.mateInRoom) return;  // 隊友都回到房間才能開始
    if (!this.chapterOk(this.chapter)) this.chapter = 1;
    Game.chapterId = this.chapter;
    this.send({ t: 'pick', chapter: this.chapter, slots: this.peers.map(q => q.slot) });
    this.enterPick();
  },
  enterPick() {
    this.myPick = this.matePick = null; this.mateInRoom = false; this.picks = {};
    for (const q of this.peers) { q.pick = null; q.inRoom = false; }
    Game.state = 'pick'; Game.inArena = false;
    Screen.select('coop');
  },
  cleanPick(m) {  // 對方傳來的選擇：不認得的就換成預設值
    return { ship: SHIPS[m.ship] ? m.ship : 'vanguard', weapon: WEAPONS[m.weapon] ? m.weapon : 'laser',
      chip: NORMAL_IDS.includes(m.chip) ? m.chip : null };
  },
  allPicked() { return this.peers.length > 0 && this.peers.every(q => q.pick); },
  ready(ship, weapon, chip) {
    if (!this.linked) { this.lost(); return; }
    this.myPick = this.cleanPick({ ship, weapon, chip });
    this.send({ t: 'ready', ...this.myPick, slot: this.mySlot() });
    if (this.role === 'host' && this.allPicked()) this.startHost();
    else this.waitScreen();
  },
  onMateReady(m, q) {
    if (!['pick', 'wait'].includes(Game.state)) return;
    if (this.role === 'host') {
      q.pick = this.cleanPick(m);
      for (const o of this.peers) if (o !== q) this.sendTo(o, { t: 'ready', ...q.pick, slot: q.slot });  // 轉告其他隊友
    } else {
      const s = clamp(Math.floor(num(m.slot, 1)), 1, NET_MAX);
      this.picks[s] = this.cleanPick(m);
      if (s === 1) this.matePick = this.picks[1];
    }
    if (this.role === 'host' && this.myPick && this.allPicked()) this.startHost();
    else if (Game.state === 'wait') this.waitScreen();
  },
  waitScreen() {
    Game.state = 'wait';
    const line = p => p
      ? `<b style="color:${SHIPS[p.ship].color}">${SHIPS[p.ship].name}</b> ＋ ${WEAPONS[p.weapon].name} ＋ ${p.chip ? CHIPS[p.chip].name : '無起始晶片'}`
      : '<span style="color:#8fa3d9">選擇中…</span>';
    const others = this.role === 'host' ? this.peers.map(q => [q.slot, q.pick]) : [1, ...this.roster].filter(s => s !== this.slot).map(s => [s, this.picks[s]]);
    const tagHtml = s => `<b style="color:${Game.slotColor(s)}">${s}P</b>`;  // 號碼用玩家色
    const mates = others.map(([s, p]) => [others.length > 1 ? (s === 1 ? `${tagHtml(1)} 房主` : tagHtml(s)) : '隊友', p]);
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:36px">等待隊友</h1>
      <div class="sub">你：${line(this.myPick)}<br>${mates.map(([who, p]) => `${who}：${line(p)}`).join('<br>')}<br><br>${this.role === 'host' ? '大家都選好就會開始。' : '大家都選好後，房主那邊會開始戰鬥。'}</div>
      <div class="row"><button data-act="title">離開房間</button></div></div>`);
  },

  // ---------- 開始 ----------
  makeLoadout(p) {  // 隊友的配裝（房主這邊用來算隊友的子彈）
    const L = { shipId: p.ship, weapon: { id: p.weapon, path: null, final: null },
      chain: startChain(p.chip), socks: [], inventory: startInv(p.chip), slotAttr: [], playKills: {}, pullHits: 0,
      parts: { ...SHIPS[p.ship].parts }, partSlots: SHIPS[p.ship].partSlots, cap: SHIPS[p.ship].cap, wSock: CFG.START_WSOCK, boons: cleanBoons(),
      R: { dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])), chips: {}, kills: 0, maxHit: 0 } };  // 隊友的傷害統計
    const ST = Game.chapter().start;  // 章節的開局補償：電路格、插座先加；晶體和剩下的三選一次數先記著，之後隊友的配裝同步會蓋過去
    applyChapterStart(L, ST);
    L.credits = ST ? ST.credits || 0 : 0; L.bonusPicks = ST ? ST.picks || 0 : 0;
    L.wp = weaponParams(L.weapon);
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.wp, Game.boons); });
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
    this.runId = Math.random().toString(36).slice(2, 10);  // 這一局的編號：斷線重連時用來判斷是不是同一局
    for (const q of this.peers)
      this.sendTo(q, { t: 'start', ...me, map: this.packMap(Game.map), bossId: Game.bossId, runId: this.runId, chapter: Game.chapterId,
        others: this.peers.filter(o => o !== q).map(o => ({ slot: o.slot, ...o.pick })) });  // others：其他隊友（三人以上）
    Game.showMap(this.startMsg());
  },
  startClient(m) {
    if (!this.myPick) return;
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
    Screen.map();
    if (this.role === 'host') this.tryResolve();
  },
  checkVoteTimer() {  // 房主：大家都在航圖時開始倒數
    const on = this.peers.filter(q => q.linked);
    if (this.role !== 'host' || Game.state !== 'map' || !on.length || !on.every(q => q.at === 'map') || this.voteEnd) return;
    this.voteEnd = performance.now() + NET_VOTE_TIME * 1000;
    this.send({ t: 'vt', s: NET_VOTE_TIME });
    Screen.map();
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
    this.voteEnd = 0; this.votes = {};
    this.nudge(false);
    const label = NODE_META[node.type].label;
    const T = this.goTime != null ? this.goTime : NET_GO_TIME;  // goTime：模擬用（電腦不用等，設 0）
    if (!(T > 0)) { Game.enterNode(node); return; }
    Game.state = 'going';
    this.goUntil = performance.now() + T * 1000;  // 大家都選好（或投票時間到）：倒數 3 秒再進關卡
    const S = Object.keys(votes).map(Number).sort((a, b) => a - b);
    const why = S.map(s => `${s}P 投「${NODE_META[Game.nodeById(votes[s]).type].label}」`).join('、') + (S.length === 2 ? '，各 50%' : '，照票數比例抽籤');
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:36px">${drawn ? '🎲 意見分歧，抽籤決定' : '➜ 出發'}</h1>
      <div class="sub">${drawn ? `${why}。<br>` : ''}
        目的地：<b style="color:${NODE_META[node.type].color};font-size:22px">${NODE_META[node.type].icon} ${label}</b></div>
      <h1 style="font-size:64px;margin:10px 0 0" id="goLeft">${T}</h1></div>`);
    setTimeout(() => { if (Game.state === 'going') { this.goUntil = 0; Game.enterNode(node); } }, T * 1000);
  },
  // 提醒還沒選節點的人：畫面最上面的橫幅（開著電路編輯器、在商店也看得到），自己投了票或出發時收起來
  nudge(on) {
    let el = document.getElementById('netNudge');
    if (!on) { if (el) el.hidden = true; return; }
    if (!el) { el = document.createElement('div'); el.id = 'netNudge'; document.body.appendChild(el); }
    el.textContent = '👥 隊友已經選好下一個節點，等你選擇（在航圖點一個發光的節點）';
    el.hidden = false;
    Events.emit('nudge');
  },
  voteLeft() { return this.voteEnd ? Math.max(0, Math.ceil((this.voteEnd - performance.now()) / 1000)) : null; },


  // 配裝：隊友改了電路／倉庫／武器就傳給房主（房主模擬隊友的子彈要用）
  sendLoadout() {
    if (this.role !== 'client' || !this.linked) return;
    const G = Game;
    this.send({ t: 'lo', weapon: G.weapon, chain: G.chain, sk: G.socks || [], inventory: G.inventory, sa: G.slotAttr || [], hp: G.player.hp, cr: G.credits,
      parts: G.parts, ps: G.partSlots, cap: G.cap, ws: G.wSock, bp: G.startPicksLeft(), bn: G.boons });
  },
  // 檢查對方傳來的電路、倉庫、武器、強化過的格子：不認得的晶片變空格（晶片 id 可以帶插座數 ~2，見 parseChipId）
  sanitizeLoadout(m) {
    const fix = id => parseChipId(id);
    const chain = (Array.isArray(m.chain) ? m.chain : []).slice(0, CFG.MAX_SLOTS).map((id, i) => (i === 0 ? 'weapon' : fix(id)));
    while (chain.length < CFG.START_SLOTS) chain.push(null);
    chain[0] = 'weapon';
    const inventory = Array.from({ length: CFG.INV_SLOTS }, (_, i) => fix(Array.isArray(m.inventory) ? m.inventory[i] : null));
    const W = m.weapon && WEAPONS[m.weapon.id] ? m.weapon : null, path = W && W.path && WEAPONS[W.id].paths[W.path] ? W.path : null;
    const weapon = W ? { id: W.id, path, final: path && (W.final === 0 || W.final === 1) ? W.final : null } : null;
    const slotAttr = chain.map((_, i) => (i > 0 && Array.isArray(m.sa) && SLOT_ATTRS[m.sa[i]] ? m.sa[i] : null));
    // 插座：只收組件，每格最多插座上限個（多的丟掉）
    const socks = chain.map((id, i) => !id || !Array.isArray(m.sk) || !Array.isArray(m.sk[i]) ? []
      : m.sk[i].slice(0, CFG.MAX_SOCKETS).map(fix).filter(c => c && isComp(c)));
    return { chain, socks, inventory, weapon, slotAttr };
  },
  applyMateLoadout(m, q) {  // 房主：檢查後套用到隊友 q 的配裝
    const mate = this.mateOf(q);
    if (!mate || !mate.L) return;
    const { chain, socks, inventory, weapon, slotAttr } = this.sanitizeLoadout(m), L = mate.L;
    if (weapon && weapon.id === L.weapon.id) L.weapon = weapon;
    L.credits = Math.max(0, num(m.cr, L.credits || 0));  // 隊友的錢包（重新連線時還原用）
    L.lootAtLo = this.lootTotal || 0;  // 之後撿到的掉落另外算
    L.chain = chain; L.socks = socks; L.inventory = inventory; L.slotAttr = slotAttr; L.wp = weaponParams(L.weapon);
    // 機體：零件層數（0～20）、零件格
    const P = m.parts && typeof m.parts === 'object' ? m.parts : {};
    L.parts = Object.fromEntries(PART_IDS.map(id => [id, clamp(Math.floor(num(P[id])), 0, 20)]));
    L.partSlots = clamp(Math.floor(num(m.ps, L.partSlots || 6)), 1, 20);
    L.cap = clamp(Math.floor(num(m.cap, L.cap || 4)), 0, 40);
    L.wSock = clamp(Math.floor(num(m.ws, L.wSock || CFG.START_WSOCK)), 1, CFG.WEAPON_SOCKETS);
    L.bonusPicks = clamp(Math.floor(num(m.bp, L.bonusPicks || 0)), 0, 9);  // 開局三選一還剩幾次（隊友重新整理時還原）
    L.boons = cleanBoons(m.bn);  // ？事件的這一局效果（終焉護殼用掉時房主會先告訴隊友，所以以隊友傳來的為準）
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.wp, Game.boons); });
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
    p.x = clamp(num(m.x, p.x), p.r, Arena.W - p.r); p.y = clamp(num(m.y, p.y), p.r, Arena.H - p.r);
    Arena.updateZone(p);  // 大地圖：隊友在第幾區（跟自己的飛船同一套：穿過打開的閘門才 +1；新戰鬥收到上一場的舊座標不會跳區）
    p.vx = num(m.vx); p.vy = num(m.vy); p.aim = num(m.a, p.aim);
    p.moving = !!m.mv; p.dashT = clamp(num(m.dT), 0, CFG.DASH_TIME); p.wantFire = !!m.f;
    p.dashSX = num(m.sx, p.x); p.dashSY = num(m.sy, p.y);  // 衝刺起點由隊友的電腦記（瞬移、衝刺途中穿門都在那邊算）
    p.aimD = num(m.ad, 300); p.autoMode = !!m.au;  // 準星距離（環繞放出）、手機自動攻擊（環繞轉滿就放）
    const ds = num(m.ds, p.dashSeq);
    if (ds > p.dashSeq) { p.dashSeq = ds; Game.withLoadout(p.L, () => p.onDash()); }  // 衝刺技能（震波、相位超載）由房主執行
  },
  hostUpdateMates(dt) { for (const m of Game.mates) this.hostUpdateMate(m, dt); },
  hostUpdateMate(m, dt) {
    if (m.dead || m.gone) return;
    m.x = clamp(m.x + m.vx * dt, m.r, Arena.W - m.r);  // 兩次輸入之間先照速度往前推
    m.y = clamp(m.y + m.vy * dt, m.r, Arena.H - m.r);
    m.iframe -= dt; m.overdrive -= dt; m.dashT -= dt; if (m.frostT > 0) m.frostT -= dt;  // 冰凍時間在房主這邊倒數（隊友那邊照同步的剩餘秒數變慢）
    Game.withLoadout(m.L, () => { m.tickDash(); m.tickFire(dt, m.wantFire); });  // 開火（蓄力、過熱）與衝刺相關的晶片
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
      0, p.shield || 0, p.frostT > 0 ? 1 : 0, p.revengeT > 0 ? 1 : 0,  // （空位）、護盾層數、被凍住、逆襲中
      PART_IDS.map(id => parts[id] || 0), r(CFG.MAGNET_RANGE * (1 + magnet)), p.gone ? 1 : 0, Game.wardOf(p)];  // 最後：終焉護殼還能免死幾次  // 拾取範圍：隊友那邊模擬晶體飛向這艘船時用
    const rows = [row(P, 1, G.parts, G.passives.magnet), ...G.mates.map(m => row(m, m.slot, m.L.parts, m.L.passives.magnet))];
    const shared = {
      ob: Objects.pack(),         // 地圖物件
      pt: G.portals.map(q => [r(q.ax), r(q.ay), r(q.bx), r(q.by), r2(q.t), q.color]),
      zn: G.zones.map(z => [r(z.x), r(z.y), z.r, r2(z.t), z.max]),  // 王的落點轟炸（紅圈）
      fl: G.flames.map(z => [r(z.x), r(z.y), z.r, r2(z.t), z.max]),  // 火毯（散彈升級）留在地上的火
      qk: G.quakes.map(q => [r(q.x), r(q.y), q.r, r2(q.t), q.max]),  // 餘震（電漿升級）的預告圈
      dc: G.decoys.map(d => [r(d.x), r(d.y), r2(d.t), d.slot, r2(d.aim)]),  // 殘影（幻影號）
      tr: G.trails.map(L => [r(L.x1), r(L.y1), r(L.x2), r(L.y2), r2(L.t), L.max]),  // 殘留彈道（軌道升級）的電軌
      lk: G.links.map(L => [r2(L.t), ...L.es.filter(e => !e.dead && e.link === L).map(e => e.id)]),  // 共鳴（電漿升級）：剩幾秒、連結的敵人
      e: G.enemies.filter(e => !e.dead).map(e => [e.id, e.type, r(e.x), r(e.y), r(e.vx), r(e.vy), r(e.hp), r(e.maxHp), r2(e.rot),
        e.flash > 0 ? 1 : 0, r2(Math.max(0, e.spawnT)), e.spawnMax, e.mode, r2(e.modeT), r2(e.chargeA),
        e.slowT > 0 ? 1 : 0, e.burnT > 0 || e.burnL ? 1 : 0, e.enraged ? 1 : 0, e.stuck ? e.stuck.length : 0,
        e.shieldA != null ? r2(e.shieldA) : null, r2(e.cloak || 0),  // 盾衛的盾方向、潛伏者的隱形程度
        e.type === 'spitter' || e.type === 'hive' ? r2(e.cd) : null, e.markT > 0 || e.shredT > 0 ? 1 : 0,  // 開火倒數（噴吐者鼓起、母巢脈動）、弱點標記／破甲
        e.type === 'worm' ? wormAhead(e) : null,  // 列隊蟲：前面那節（活著的）的 id，0 = 自己是頭
        e.affixes ? e.affixes.join(',') : null, e.r !== e.t.radius ? r2(e.r) : null, e.ledT > 0 ? 1 : 0,  // 精英詞綴、體型（分裂後變小）、被統帥加成
        e.alertT > 0 ? r2(e.alertT) : 0]),  // 剛發現玩家（頭上「!」還顯示幾秒）
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
        r2(m.chargeC), m.L.stats.heatLimit ? r2(m.ohT / m.L.stats.heatLimit) : 0, r2(Math.max(0, m.ohLock)), m.shield || 0, r2(m.drRec || 0), 0, r2(Math.max(0, m.frostT || 0)), standStacks(m, m.L.stats.stand), m.crowdK || 0, r2(Math.max(0, m.revengeT || 0)), m.streak || 0, m.focusK || 0, m.spreadK || 0, m.grazeK || 0, m.staticK || 0, m.parryK || 0],  // …、群戰的敵人數、逆襲剩幾秒、無傷連殺層數、專注／分散／擦彈層數  // 灰血（畫血條用）、（空位）、被凍住剩幾秒（隊友自己的船要變慢）
        pk: m.L.playKills,  // 這個隊友各晶片的玩法擊殺數（隊友那邊的紀錄用）
        b: G.bullets.filter(b => !b.dead && near(b.x, b.y)).map(b => [r(b.x), r(b.y), r2(b.angle), r(b.speed), r2(b.r),
          ci(b.color), b.shape, b.splits, b.payload ? 1 : 0, r2(b.life), r(Math.min(60, Math.hypot(b.x - b.sx, b.y - b.sy)))]),
        eb: G.eBullets.filter(b => near(b.x, b.y)).map(b => [r(b.x), r(b.y), r(b.vx), r(b.vy), b.r, b.col ? ci(b.col) : -1, b.mine ? r2(b.life) : 0]),  // 盾衛反彈的原本顏色、地雷剩幾秒（0 = 不是地雷）
        pal,
      });
    }
    this.fxBuf = [];
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
        if (e.spawnT > 0) e.spawnT -= dt;
        else { e.x += e.vx * dt; e.y += e.vy * dt; }
      }
      for (const b of G.bullets) { b.x += Math.cos(b.angle) * b.speed * dt; b.y += Math.sin(b.angle) * b.speed * dt; b.life -= dt; }
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
      for (const m of G.mates) if (!m.dead) { m.x += m.vx * dt; m.y += m.vy * dt; m.iframe -= dt; m.dashT -= dt; }
      this.inAcc += dt;
      if (this.inAcc >= NET_RATE && !P.dead) {
        this.inAcc = Math.min(this.inAcc - NET_RATE, NET_RATE);
        this.send({ t: 'i', x: Math.round(P.x), y: Math.round(P.y), vx: Math.round(P.vx), vy: Math.round(P.vy), a: r2(P.aim),
          mv: P.moving ? 1 : 0, dT: r2(Math.max(0, P.dashT)), ds: P.dashSeq || 0, f: P.wantFire ? 1 : 0,
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
      m.x = num(p[0], m.x); m.y = num(p[1], m.y); m.aim = num(p[2]); m.hp = num(p[3]); m.maxHp = num(p[4], m.maxHp);
      m.dashT = num(p[5]); m.iframe = num(p[6]); m.overdrive = p[7] ? 1 : 0; m.moving = !!p[8]; m.dead = !!p[9];
      m.vx = num(p[10]); m.vy = num(p[11]); m.reviveT = num(p[12]);
      m.shield = clamp(num(p[14]), 0, 9); m.frostT = p[15] ? 0.2 : 0; m.revengeT = p[16] ? 0.2 : 0;  // 逆襲中（畫那艘船發紅光）
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
      P.chargeC = num(s.me[6]); P.heatR = num(s.me[7]); P.ohLock = num(s.me[8]); P.shield = num(s.me[9]);
      if (s.me[12] > 0) P.frostT = Math.max(P.frostT || 0, num(s.me[12]));
      P.standK = num(s.me[13], 0);  // 架設的層數  // 被彗星凍住（房主判定，自己的船自己變慢）
      P.crowdK = num(s.me[14], 0); P.revengeT = num(s.me[15], 0); P.streak = num(s.me[16], 0);  // 群戰、逆襲、無傷連殺（畫左上小條用）
      P.focusK = num(s.me[17], 0); P.spreadK = num(s.me[18], 0); P.grazeK = num(s.me[19], 0); P.staticK = num(s.me[20], 0); P.parryK = num(s.me[21], 0);  // 專注、分散、擦彈、靜電、格擋流
    }
    if (s.pk && typeof s.pk === 'object')  // 玩法擊殺：房主算好的次數，這邊只增不減
      for (const k in s.pk) if (hasLv(k) && num(s.pk[k]) > (G.playKills[k] || 0)) G.playKills[k] = Math.floor(num(s.pk[k]));
    G.enemies = arr(s.e).map(a => {
      const t = ENEMY_TYPES[a[1]];
      if (!t) return null;
      return { id: a[0], type: a[1], t, r: typeof a[25] === 'number' ? clamp(a[25], 4, t.radius) : t.radius, x: num(a[2]), y: num(a[3]), vx: num(a[4]), vy: num(a[5]),
        hp: num(a[6]), maxHp: num(a[7], 1), rot: num(a[8]), flash: a[9] ? 0.08 : 0, spawnT: num(a[10]), spawnMax: num(a[11], 1) || 1,
        mode: a[12], modeT: num(a[13]), chargeA: num(a[14]), slowT: a[15] ? 1 : 0, burnT: a[16] ? 1 : 0, enraged: !!a[17], stuckN: num(a[18]),
        shieldA: typeof a[19] === 'number' ? a[19] : null, cloak: num(a[20]), dead: false,
        cd: typeof a[21] === 'number' ? a[21] : undefined, markT: a[22] ? 1 : 0, aheadId: a[1] === 'worm' ? num(a[23]) : undefined,
        affixes: typeof a[24] === 'string' ? a[24].split(',').filter(id => AFFIX[id]).slice(0, 3) : null, ledT: a[26] ? 1 : 0, alertT: num(a[27]) };
    }).filter(Boolean);
    const byId = new Map(G.enemies.map(e => [e.id, e]));  // 列隊蟲：用 id 接回前面那節（找不到 = 自己是頭）
    for (const e of G.enemies) if (e.aheadId !== undefined) e.ahead = byId.get(e.aheadId) || null;
    const pal = arr(s.pal);
    G.bullets = arr(s.b).map(a => {
      const ang = num(a[2]), tl = num(a[10]);
      return { x: num(a[0]), y: num(a[1]), angle: ang, speed: num(a[3]), r: num(a[4], 3), color: typeof pal[a[5]] === 'string' ? pal[a[5]] : '#fff',
        shape: a[6], splits: num(a[7]), payload: !!a[8], life: num(a[9], 1),
        sx: num(a[0]) - Math.cos(ang) * tl, sy: num(a[1]) - Math.sin(ang) * tl };
    });
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
    G.flames = arr(s.fl).filter(Array.isArray).map(a => ({ x: num(a[0]), y: num(a[1]), r: num(a[2], 30), t: num(a[3]), max: num(a[4], 1) || 1 }));
    G.quakes = arr(s.qk).filter(Array.isArray).map(a => ({ x: num(a[0]), y: num(a[1]), r: num(a[2], 90), t: num(a[3]), max: num(a[4], 1) || 1 }));
    G.decoys = arr(s.dc).filter(Array.isArray).slice(0, NET_MAX).map(a => ({ x: num(a[0]), y: num(a[1]), t: num(a[2]), slot: clamp(Math.floor(num(a[3], 1)), 1, NET_MAX), aim: num(a[4]), r: 12, decoy: true }));
    G.trails = arr(s.tr).filter(Array.isArray).map(a => ({ x1: num(a[0]), y1: num(a[1]), x2: num(a[2]), y2: num(a[3]), t: num(a[4]), max: num(a[5], 1) || 1 }));
    G.links = arr(s.lk).filter(Array.isArray).map(a => ({ t: num(a[0]), ids: a.slice(1) }));
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
// 切到其他視窗／分頁時通知隊友：兩人一起暫停（瀏覽器會把背景分頁的遊戲停住，不暫停的話飛船會站著挨打）
document.addEventListener('visibilitychange', () => {
  if (!Net.linked || Game.mode !== 'coop') return;
  if (Net.role === 'host') { Net.myAway = document.hidden; Net.pushPause(); } else Net.send({ t: 'away', on: document.hidden });
});
