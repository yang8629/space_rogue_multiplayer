// 星環電路 雙人版 · net.js：雙人連線：大廳、選配裝、同步、投票、錢包、斷線重連、雙人紀錄
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// NET — 雙人連線（PeerJS / WebRTC 點對點）
//   房主：跑整個戰場（敵人、子彈、傷害判定），每秒約 30 次把戰場狀態傳給隊友
//   隊友：自己飛船的移動、衝刺在自己電腦上算（零延遲），把位置與「有沒有按開火」傳給房主
//   房主替隊友開火時，用 withLoadout 換上隊友的武器與電路
// =====================================================================
const LOADOUT_KEYS = ['chain', 'inventory', 'weapon', 'wp', 'stats', 'passives', 'shipId', 'growth', 'pullHits', 'parts', 'module', 'partSlots', 'mech'];
const NET_PREFIX = 'circuitrogue-mp-';
const NET_CODE_CHARS = 'ABCDEFGHJKLNPQSTUVWXYZ23456789';  // 去掉容易看錯的 I O 0 1，以及快捷鍵 M R
const NET_RATE = 1 / 30;
const NET_VOTE_TIME = 20;  // 兩人都回到航圖後的投票時間（秒）
const NET_REJOIN_TIME = 120;  // 斷線後房間保留多久等隊友重連（秒）
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const r2 = v => Math.round(v * 100) / 100;

const Net = {
  role: null,          // null = 單人；'host' = 房主；'client' = 加入的隊友
  peer: null, conn: null, ping: null, code: '',
  linked: false,       // 兩邊已經握手成功
  myPick: null, matePick: null,  // 各自選好的 { ship, weapon, chip }
  stats: null,         // 這一局的連線數據（寫進遊玩紀錄）
  fxBuf: [], sendAcc: 0, inAcc: 0, pingT: 0,
  active() { return !!this.role; },
  fx(e) { if (this.conn && this.fxBuf.length < 400) this.fxBuf.push(e); },
  send(msg) { try { if (this.conn && this.conn.open) this.conn.send(msg); } catch (e) {} },
  resetStats() { this.stats = { pings: [], snaps: 0, inputs: 0, lastRecv: 0, maxGap: 0 }; this.team = null; },
  close() {
    const peer = this.peer, conn = this.conn;
    this.peer = this.conn = null; this.role = null; this.ping = null; this.fxBuf = [];
    this.linked = false; this.mateInRoom = false; this.myPick = this.matePick = null; this.code = '';
    try { conn && conn.close(); } catch (e) {}
    try { peer && peer.destroy(); } catch (e) {}
  },
  // 玩家自己離開（回標題）：還在戰鬥中就先存一筆紀錄
  leave() {
    if (Game.mode === 'coop' && Game.inArena && Game.state === 'play') Game.saveRecord('retired');
    this.waiting = null; this.solo = false; this.rejoin = null; this.rejoining = false; this.runId = null; this.mateAway = false;
    this.hideOverlay();
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
    if (this.stats && (Game.state !== 'play' || this.pauseReason() || (this.role === 'host' && Game.mate && Game.mate.dead)))
      this.stats.lastRecv = 0;
    if (Game.mode === 'coop') {
      if (this.role === 'host' && this.voteEnd && performance.now() >= this.voteEnd && !this.pauseReason()) this.tryResolve(true);  // 投票時間到
      const vt = document.getElementById('voteTimer'), left = this.voteLeft();
      if (vt) vt.textContent = left != null ? `剩 ${left} 秒` : '';
    }
    this.pingT += dt;
    if (this.pingT >= 1) {
      this.pingT = 0;
      this.send({ t: 'ping', at: performance.now() });
      if (this.role === 'host' && Game.mode === 'coop' && Game.inArena) this.sendDmg();  // 每秒同步一次兩人的傷害統計
    }
  },
  // ---------- 傷害統計：房主記兩人各自的傷害，同步給隊友 ----------
  // nm：每個晶片的顯示名稱與顏色（用那個人自己的武器、飛船、奇異點算），對方畫面的「隊友傷害」直接用
  dmgPack(R, L = null) {
    if (!R) return null;
    const rd = o => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]));
    const nm = Game.withLoadout(L, () => Object.fromEntries(Object.keys(R.chips).map(k => [k, [dmgKeyName(k), dmgKeyColor(k)]])));
    return { dmg: rd(R.dmg), chips: rd(R.chips), kills: R.kills, maxHit: Math.round(R.maxHit), nm };
  },
  sendDmg() {
    if (!Game.mate || !Game.mate.L) return;
    this.team = { h: this.dmgPack(Game.runStats), m: this.dmgPack(Game.mate.L.R, Game.mate.L) };
    this.send({ t: 'dmg', ...this.team });
  },
  onDmg(m) {  // 隊友：收到兩人的傷害；自己那份寫進自己的 runStats（結算、紀錄都用它）
    // 房主那邊隊友的奇異點 id 前面多一個 m（msg_1 = 隊友的 sg_1），換回自己的 id 才不會被當成不認得的晶片丟掉
    const own = k => (k[0] === 'm' && CHIPS[k.slice(1)] && !CHIPS[k] ? k.slice(1) : k);
    const esc = s => String(s).slice(0, 40).replace(/[<>&"]/g, '');
    const clean = (p, mine) => (p && typeof p === 'object' ? {
      dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, num(p.dmg && p.dmg[k])])),
      chips: Object.fromEntries(Object.entries(p.chips || {}).map(([k, v]) => [mine ? own(k) : String(k).slice(0, 40), num(v)])
        .filter(([k]) => !mine || CHIPS[k] || k === 'weapon' || k === 'ship')),
      nm: Object.fromEntries(Object.entries(p.nm && typeof p.nm === 'object' ? p.nm : {}).slice(0, 60)
        .map(([k, v]) => [String(k).slice(0, 40), Array.isArray(v) ? [esc(v[0]), /^#[0-9a-f]{3,8}$/i.test(v[1]) ? v[1] : '#8fa3d9'] : [esc(k), '#8fa3d9']])),
      kills: num(p.kills), maxHit: num(p.maxHit) } : null);
    this.team = { h: clean(m.h, false), m: clean(m.m, true) };
    const R = Game.runStats, mine = this.team.m;
    if (R && mine) Object.assign(R, { dmg: mine.dmg, chips: mine.chips, kills: mine.kills, maxHit: mine.maxHit });
  },
  // 隊友的晶片傷害 [名稱, 顏色, 傷害]（房主直接讀隊友的配裝；隊友這邊用房主傳來的名稱）：傷害分頁與遊玩紀錄用
  mateChipRows() {
    let chips, name;
    if (this.role === 'host') {
      const L = Game.mate && Game.mate.L;
      if (!L || !L.R) return null;
      chips = L.R.chips;
      name = k => Game.withLoadout(L, () => [dmgKeyName(k), dmgKeyColor(k)]);
    } else {
      const h = this.team && this.team.h;
      if (!h) return null;
      chips = h.chips;
      name = k => (h.nm && h.nm[k]) || [k, '#8fa3d9'];
    }
    const rows = Object.entries(chips).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => [...name(k), v]);
    return { tag: this.role === 'host' ? '2P' : '1P', rows, total: rows.reduce((a, r) => a + r[2], 0) };
  },
  // 結算用：1P（房主）與 2P（隊友）的傷害、擊殺
  teamRows() {
    const host = this.role === 'host' || !!(Game.mate && Game.mate.L);
    const total = R => (R ? Object.values(R.dmg).reduce((a, b) => a + b, 0) : 0);
    const h = host ? Game.runStats : this.team && this.team.h, m = host ? Game.mate && Game.mate.L && Game.mate.L.R : Game.runStats;
    const mp = this.matePick, myShip = Game.shipId, mateShip = mp ? mp.ship : null;
    return [
      { tag: '1P', ship: host ? myShip : mateShip, me: host, dmg: total(h), kills: h ? h.kills : 0, maxHit: h ? h.maxHit : 0 },
      { tag: '2P', ship: host ? mateShip : myShip, me: !host, dmg: total(m), kills: m ? m.kills : 0, maxHit: m ? m.maxHit : 0 },
    ];
  },
  teamSummaryHtml() {
    const rows = this.teamRows(), sum = rows.reduce((a, r) => a + r.dmg, 0);
    const fmt = n => Math.round(n).toLocaleString('zh-TW');
    const body = rows.map(r => {
      const S = SHIPS[r.ship] || { name: '？', color: '#8fa3d9' }, pct = sum ? r.dmg / sum * 100 : 0;
      return `<div class="sum-lab"><i style="background:${S.color}"></i>${r.tag} ${S.name}${r.me ? '（你）' : ''}</div>
        <div class="sum-track"><div style="width:${pct.toFixed(1)}%;background:${S.color}"></div></div>
        <div class="sum-val">${fmt(r.dmg)}<span>${pct.toFixed(0)}%</span></div>`;
    }).join('');
    const tile = (k, v) => `<div class="sum-tile"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="summary">
      <div class="sum-head"><span>雙人傷害結算</span><b>${fmt(sum)}</b></div>
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
    this.send({ t: 'room' });
    this.renderLobby();
  },
  renderLobby(msg = '') {
    Game.state = 'lobby'; Game.inArena = false; Game.mate = null;
    const ok = typeof Peer !== 'undefined';
    Screen.show(`<div class="scr title-wrap">
      <h1 style="font-size:42px">👥 雙人連線</h1>
      <div class="sub">先進同一個房間，兩人到齊後由房主按「開始」，再各自選飛船、武器與起始晶片。每局結束後會回到這個房間。</div>
      <div id="netBtns">${this.linked ? '' : ok ? `<div class="row"><button class="big" data-act="nethost">開房間</button></div>
        <div class="row"><input id="netCode" maxlength="4" placeholder="房號" autocomplete="off" spellcheck="false"
          style="font-size:22px;width:5.5em;text-align:center;letter-spacing:.3em;text-transform:uppercase;background:#0a1030;color:#fff;border:1px solid #4cc9f0;border-radius:6px;padding:8px">
          <button class="big" data-act="netjoin">加入房間</button></div>`
      : '<div class="sub" style="color:#ff4d6d">連線元件沒有載入（需要網路）。請確認有連上網路後重新整理。</div>'}</div>
      <div class="sub" id="netMsg" style="min-height:3em">${msg}</div>
      <div class="keys">一人按「開房間」拿到 4 碼房號，另一人輸入房號按「加入房間」。<br>
        雙人遠征：航圖投票（選不同就抽籤）、錢包各自獨立（怪物掉落的晶體兩人都拿）、獎勵各自選、戰鬥中按 Tab 兩人一起暫停。<br>
        一人被擊墜時留在原地，隊友靠近 ${CFG.REVIVE.time} 秒就能救起來（救的人分出自己一半的血量）；沒被救起的在戰鬥結束後以 30% HP 歸隊；兩人都被擊墜才結束。</div>
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
    const mate = this.mateInRoom ? '<b style="color:#9dff6b">隊友在房間裡</b>' : '<span style="color:#ffd166">等隊友回到房間…</span>';
    this.setMsg(this.role === 'host'
      ? `房號 <b style="letter-spacing:.2em;color:#ffd166">${this.code}</b>　·　${mate}　·　${ping}
         <div class="row"><button class="big" data-act="netstart" ${this.mateInRoom ? '' : 'disabled'}>開始（選擇配裝）</button></div>`
      : `房間 <b style="letter-spacing:.2em;color:#ffd166">${this.code}</b>　·　${ping}<br>等待房主按「開始」…`);
  },

  host() {
    this.close();
    this.role = 'host';
    const code = this.code = Array.from({ length: 4 }, () => pick([...NET_CODE_CHARS])).join('');
    this.setMsg('正在建立房間…');
    const peer = this.peer = new Peer(NET_PREFIX + code);
    peer.on('open', () => this.setMsg(`房號 <b style="font-size:34px;letter-spacing:.2em;color:#ffd166">${code}</b><br>把房號告訴隊友，等待加入中…`));
    peer.on('connection', conn => {
      if (this.conn) {  // 已經有隊友了
        conn.on('open', () => { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 500); });
        return;
      }
      this.conn = conn;
      this.bind(conn);
    });
    // 和配對伺服器的連線斷了（常見於切到背景一陣子）：兩人之間的連線不受影響，但要重新登記房號，隊友才找得到房間重連
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
      conn.on('open', () => { this.setMsg('已連上，確認版本中…'); this.send({ t: 'hello', v: CFG.VERSION, resume: resumeRunId }); });
    });
    peer.on('error', e => this.fail(e));
  },
  bind(conn) {
    conn.on('data', m => this.onData(m));
    conn.on('close', () => this.lost());
    conn.on('error', () => this.lost());
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
    // 只是和配對伺服器斷線（兩人之間還連著）：不影響遊戲，房主會自動重新登記
    if (['network', 'server-error', 'socket-error', 'socket-closed', 'disconnected'].includes(t) && this.conn && this.conn.open) return;
    if (this.rejoining) { this.rejoinFailed(msg); return; }
    this.lost(msg);
  },
  // 正在進行的雙人遠征（斷線時可以等隊友重連）
  inRun() { return Game.mode === 'coop' && !!this.runId && !['lobby', 'title', 'pick', 'wait'].includes(Game.state); },
  lost(msg = '隊友已離線') {
    if (!this.role) return;
    if (this.inRun() && this.role === 'host' && this.peer && !this.peer.destroyed) { this.waitForMate(msg); return; }
    if (this.inRun() && this.role === 'client') { this.clientLost(msg); return; }
    this.endLost(msg);
  },
  endLost(msg) {  // 放棄這一局：存紀錄、回到「連線中斷」畫面
    if (Game.mode === 'coop' && Game.inArena && Game.state === 'play') Game.saveRecord('disconnect');  // 戰鬥中斷線也存一筆
    this.waiting = null; this.rejoining = null; this.hideOverlay();
    const inLobby = Game.state === 'lobby';
    this.close(); this.runId = null;
    if (inLobby) { this.lobby(`<span style="color:#ff4d6d">${msg}</span>`); return; }
    if (Game.state === 'title') return;
    Game.mate = null; Game.state = 'title'; Game.inArena = false;
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:40px;color:#ff4d6d">連線中斷</h1>
      <div class="sub">${msg}</div>
      <div class="row"><button class="big" data-act="title">回到標題</button><button data-act="records">📜 遊玩紀錄</button></div></div>`);
  },

  // ---------- 斷線重連 ----------
  // 房主：隊友斷線 → 遊戲暫停，房間保留 NET_REJOIN_TIME 秒等隊友回來（重新整理後輸入同一個房號也可以）
  waitForMate(msg) {
    const conn = this.conn;
    this.conn = null; this.linked = false; this.mateEditing = false; this.mateAway = false; this.ping = null;
    try { conn && conn.close(); } catch (e) {}
    this.waiting = { until: performance.now() + NET_REJOIN_TIME * 1000, msg };
    this.mateAt = null; this.voteEnd = 0;
    this.waitOverlay();
  },
  waitOverlay() {
    const W = this.waiting;
    if (!W) return;
    const left = Math.max(0, Math.ceil((W.until - performance.now()) / 1000));
    this.overlay(`<h2 style="color:#ffd166;margin:0">⏸ 隊友斷線了</h2>
      <div class="sub">${W.msg}<br>遊戲暫停中，房間保留 <b id="rejoinLeft">${left}</b> 秒。<br>
        請隊友按「重新連線」；如果他重新整理了頁面，選「雙人連線」後輸入房號 <b style="letter-spacing:.2em;color:#ffd166">${this.code}</b> 就能回到這一局。</div>
      <div class="row"><button class="big" data-act="netsolo">自己繼續玩（隊友之後還能回來）</button>
        <button data-act="netgiveup">結束這一局</button></div>`);
  },
  // 房主：不等了，一個人繼續。房間仍然開著，隊友用同一個房號就能回到當下的進度
  soloContinue() {
    if (!this.waiting) return;
    this.waiting = null; this.solo = true;
    if (Game.mate) Game.mate.gone = true;
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
    this.role = this.role || 'client';
    this.endLost(msg);
  },
  // 房主：把目前這一局的狀態打包給重新連線的隊友
  resumePayload() {
    const G = Game, mate = G.mate, L = mate.L;
    const back = id => (typeof id === 'string' && /^msg_\d+$/.test(id) ? id.slice(1) : id), sg = {};
    for (const id of [...L.chain, ...L.inventory])
      if (id && /^msg_\d+$/.test(id)) sg[id.slice(1)] = { name: CHIPS[id].name, cost: CHIPS[id].cost, combo: CHIPS[id].combo };
    const C = G.combat;
    return {
      t: 'resume', runId: this.runId, hostPick: this.myPick, state: G.state,
      you: { pick: this.matePick, weapon: L.weapon, chain: L.chain.map(back), inventory: L.inventory.map(back), sg,
        hp: mate.hp, maxHp: mate.maxHp, dead: !!mate.dead, credits: (L.credits || 0) + (this.lootTotal - (L.lootAtLo || 0)), dmg: this.dmgPack(L.R, L),
        parts: L.parts, module: L.module, ps: L.partSlots, growth: L.growth },
      map: this.packMap(G.map), sector: G.sector, bossId: G.bossId, node: G.node ? G.node.id : null, visited: G.visited,
      combat: G.inArena && C ? { level: C.level, wavesTotal: C.wavesTotal === Infinity ? 0 : C.wavesTotal, elites: C.elites, boss: !!C.boss, wave: C.wave } : null,
      lootTotal: this.lootTotal, victory: G.state === 'victory' ? G.victory : null,
    };
  },
  // 隊友：收到房主的狀態，回到這一局。同一個頁面（沒重新整理）就保留自己的配裝；重新整理過就用房主那邊記住的配裝
  applyResume(m) {
    const G = Game, map = this.unpackMap(m.map);
    if (!map || !ENEMY_TYPES[m.bossId]) { this.giveUp(); return; }
    const soft = typeof m.runId === 'string' && m.runId === this.runId && G.mode === 'coop' && !!G.map;
    this.runId = typeof m.runId === 'string' ? m.runId.slice(0, 16) : null;
    this.linked = true; this.mateInRoom = true; this.rejoin = null; this.rejoining = false;
    this.matePick = this.cleanPick(m.hostPick || {});
    const Y = m.you || {};
    if (!soft) {
      this.myPick = this.cleanPick(Y.pick || {});
      this.resetStats();
      G.newRun('coop', this.myPick.ship, this.myPick.weapon, null);
      const lo = this.sanitizeLoadout(Y, '');
      if (lo.weapon && lo.weapon.id === G.weapon.id) G.weapon = lo.weapon;
      G.chain = lo.chain; G.inventory = lo.inventory;
      const YP = Y.parts && typeof Y.parts === 'object' ? Y.parts : {};  // 機體與用量成長也以房主記住的為準
      G.parts = Object.fromEntries(PART_IDS.map(id => [id, clamp(Math.floor(num(YP[id])), 0, 20)]));
      G.partSlots = clamp(Math.floor(num(Y.ps, G.partSlots)), 1, 20);
      G.module = typeof Y.module === 'string' && MODULES[Y.module] ? Y.module : null;
      G.growth = {};
      if (Y.growth && typeof Y.growth === 'object') for (const k in Y.growth) if (CHIPS[k] && CHIPS[k].grow) G.growth[k] = Math.max(0, num(Y.growth[k]));
      G.refreshWeapon();
      G.credits = Math.max(0, num(Y.credits));
      this.resetRun();
      if (Y.dmg) this.onDmg({ m: Y.dmg });
    }
    this.mateEditing = false; this.mateAway = false;
    this.lastLoot = Math.max(this.lastLoot || 0, num(m.lootTotal));
    G.map = map; G.sector = clamp(num(m.sector, 1), 1, 99); G.bossId = m.bossId;
    G.visited = (Array.isArray(m.visited) ? m.visited : []).filter(id => typeof id === 'string');
    G.node = typeof m.node === 'string' ? G.nodeById(m.node) || null : null;
    G.mate = new Player(SHIPS[this.matePick.ship]);
    const P = G.player;
    P.hp = clamp(num(Y.hp, P.hp), 0, P.maxHp); P.dead = !!Y.dead || P.hp <= 0;
    this.hideOverlay();
    const C = m.combat;
    if (C && G.node && ['combat', 'elite', 'boss'].includes(G.node.type)) {
      G.startCombat({ level: num(C.level), wavesTotal: num(C.wavesTotal) || Infinity, elites: num(C.elites), boss: !!C.boss });
      G.combat.wave = num(C.wave);
      if (Y.dead) P.dead = true;
    } else if (m.state === 'victory' && G.node) {
      G.inArena = false; G.victory = { slot: false, boss: G.bossId }; G.state = 'victory'; Screen.victory();
    } else G.showMap('已重新連線，回到這一局。');
    this.send({ t: 'back' });
  },
  // 暫停的原因（沒有就是 null）：隊友在編輯電路、切到其他視窗、斷線重連中
  pauseReason() {
    if (Game.mode !== 'coop') return null;
    if (this.waiting) return '隊友斷線，等待重新連線…';
    if (this.rejoin) return '連線中斷';
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

  onData(m) {
    if (!m || typeof m !== 'object') return;
    const now = performance.now(), S = this.stats;
    if (S && (m.t === 's' || m.t === 'i')) {  // 同步訊息之間最長隔多久（卡頓的指標；暫停中不算）
      if (Game.state === 'play' && !this.pauseReason()) {
        if (S.lastRecv) S.maxGap = Math.max(S.maxGap, now - S.lastRecv);
        S.lastRecv = now;
      } else S.lastRecv = 0;
      if (m.t === 's') S.snaps++; else S.inputs++;
    }
    switch (m.t) {
      case 'hello':
        if (this.role !== 'host' || this.linked) break;
        if (m.v !== CFG.VERSION) {  // 版號不同（有人沒重新整理）：不讓開始
          const theirs = String(m.v || '舊版').slice(0, 40);
          this.send({ t: 'ver', v: CFG.VERSION });
          this.setMsg(`<span style="color:#ff4d6d">隊友的版本不同（你：${CFG.VERSION}／隊友：${theirs}），請兩邊都按 Ctrl+F5 重新整理</span>`);
          break;
        }
        if (this.waiting || this.solo) {  // 斷線的隊友回來了（房主在等，或已經一個人先玩）：傳這一局的狀態，等他回覆 back 再繼續
          this.waiting = null; this.solo = false; this.linked = true; this.mateInRoom = true; this.mateAway = true;
          if (Game.mate) {
            Game.mate.gone = false;
            if (Game.inArena && !Game.mate.dead) { Game.mate.x = Game.player.x + 50; Game.mate.y = Game.player.y; }  // 回到房主旁邊
          }
          this.send(this.resumePayload());
          this.overlay('<h2 style="color:#9dff6b;margin:0">隊友重新連線中…</h2><div class="sub">正在把這一局的狀態傳給隊友。</div>');
          break;
        }
        this.linked = true; this.mateInRoom = true;
        this.send({ t: 'welcome', v: CFG.VERSION, code: this.code });
        this.lobbyStatus();
        break;
      case 'welcome': if (this.role === 'client') { this.linked = true; this.lobbyStatus(); } break;
      case 'ver': this.lost(`你和房主的版本不同（你：${CFG.VERSION}／房主：${String(m.v || '舊版').slice(0, 40)}），請兩邊都按 Ctrl+F5 重新整理`); break;
      case 'room': this.mateInRoom = true; this.lobbyStatus(); break;
      case 'full': this.lost('這個房間已經有兩個人了'); break;
      case 'pick': if (this.role === 'client' && Game.state === 'lobby') this.enterPick(); break;
      case 'ready': this.onMateReady(m); break;
      case 'start': if (this.role === 'client') this.startClient(m); break;
      case 'i': if (this.role === 'host') this.applyInput(m); break;
      case 's': if (this.role === 'client') this.applySnap(m); break;
      case 'over':
        if (this.role === 'client' && Game.combat && Game.state === 'play') {
          Game.state = 'dead'; Game.combat.wave = num(m.wave, Game.combat.wave); Input.down = false;
          const P = Game.player;
          if (!P.dead) { P.hp = 0; P.dead = true; burst(P.x, P.y, P.ship.color, 80, 400, 1.2, 3); }
          Game.lastHit = typeof m.cause === 'string' ? m.cause.slice(0, 60) : '';
          Game.saveRecord('dead');
          setTimeout(() => { if (Game.state === 'dead') Screen.dead(); }, 900);
        }
        break;
      case 'dmg': if (this.role === 'client') this.onDmg(m); break;
      // ---- 斷線重連、切到背景 ----
      case 'resume': if (this.role === 'client') this.applyResume(m); break;
      case 'back':
        if (this.role === 'host') {
          this.mateAway = false; this.hideOverlay();
          if (Game.state === 'map') { this.checkVoteTimer(); Screen.map(); }
        }
        break;
      case 'away': this.mateAway = !!m.on; break;
      // ---- 共同闖關 ----
      case 'at':
        this.mateAt = m.s === 'map' ? 'map' : null;
        if (this.role === 'host') this.checkVoteTimer();
        if (Game.state === 'map') Screen.map();
        break;
      case 'vote': {
        const node = typeof m.node === 'string' && Game.map ? Game.nodeById(m.node) : null;
        if (!node || !Game.reachable().includes(node)) break;
        this.votes[this.role === 'host' ? 'c' : 'h'] = m.node;
        if (Game.state === 'map') Screen.map();
        if (this.role === 'host') this.tryResolve();
        break;
      }
      case 'vt': if (this.role === 'client') { this.voteEnd = performance.now() + clamp(num(m.s), 0, 60) * 1000; if (Game.state === 'map') Screen.map(); } break;
      case 'go':
        if (this.role === 'client' && Game.map && typeof m.node === 'string' && Game.nodeById(m.node)) {
          if (Game.state === 'editor') { Editor.close(); Game.recalc(); this.sendLoadout(); }
          const V = m.votes || {}, ok = id => (typeof id === 'string' && Game.nodeById(id) ? id : null);
          this.go(m.node, { h: ok(V.h), c: ok(V.c) }, !!m.drawn && ok(V.h) && ok(V.c));
        }
        break;
      case 'lo': if (this.role === 'host') this.applyMateLoadout(m); break;
      case 'edit': this.mateEditing = !!m.on && Game.inArena; break;
      case 'won':
        if (this.role === 'client' && Game.inArena && Game.combat) {
          const P = Game.player;
          P.dead = false; P.hp = clamp(num(m.hp, P.hp), 1, P.maxHp);
          this.applyLoot(m.lt);
          Game.credits += clamp(num(m.loot), 0, 999);
          Game.combatWon();
        }
        break;
      case 'sector':
        if (this.role === 'client' && Game.state === 'victory') {
          const map = this.unpackMap(m.map);
          if (!map || !ENEMY_TYPES[m.bossId]) { this.lost('收到的星圖有問題，請兩邊都重新整理'); break; }
          this.nextMap = { map, bossId: m.bossId };
          Game.nextSector();
        }
        break;
      case 'finish': if (this.role === 'client' && Game.state === 'victory') Game.finishRun(); break;
      case 'ping': this.send({ t: 'pong', at: m.at }); break;
      case 'pong': {
        const ms = Math.round(now - num(m.at, now));
        if (ms < 0 || ms > 60000) break;
        this.ping = ms;
        if (S && Game.state === 'play' && S.pings.length < 3600) S.pings.push(ms);
        this.lobbyStatus();
        break;
      }
    }
  },

  // ---------- 選配裝：房主按開始 → 兩人各自選飛船、武器、起始晶片 → 都選好就開戰 ----------
  beginPick() {
    if (this.role !== 'host' || !this.linked || !this.mateInRoom) return;  // 隊友回到房間才能開始
    this.send({ t: 'pick' });
    this.enterPick();
  },
  enterPick() {
    this.myPick = this.matePick = null; this.mateInRoom = false;
    Game.state = 'pick'; Game.inArena = false;
    Screen.select('coop');
  },
  cleanPick(m) {  // 對方傳來的選擇：不認得的就換成預設值
    return { ship: SHIPS[m.ship] ? m.ship : 'vanguard', weapon: WEAPONS[m.weapon] ? m.weapon : 'laser',
      chip: NORMAL_IDS.includes(m.chip) ? m.chip : null };
  },
  ready(ship, weapon, chip) {
    if (!this.linked) { this.lost(); return; }
    this.myPick = this.cleanPick({ ship, weapon, chip });
    this.send({ t: 'ready', ...this.myPick });
    if (this.role === 'host' && this.matePick) this.startHost();
    else this.waitScreen();
  },
  onMateReady(m) {
    if (!['pick', 'wait'].includes(Game.state)) return;
    this.matePick = this.cleanPick(m);
    if (this.role === 'host' && this.myPick) this.startHost();
    else if (Game.state === 'wait') this.waitScreen();
  },
  waitScreen() {
    Game.state = 'wait';
    const P = this.myPick, M = this.matePick, line = p => p
      ? `<b style="color:${SHIPS[p.ship].color}">${SHIPS[p.ship].name}</b> ＋ ${WEAPONS[p.weapon].name} ＋ ${p.chip ? CHIPS[p.chip].name : '無起始晶片'}`
      : '<span style="color:#8fa3d9">選擇中…</span>';
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:36px">等待隊友</h1>
      <div class="sub">你：${line(P)}<br>隊友：${line(M)}<br><br>${this.role === 'host' ? '兩人都選好就會開始。' : '兩人都選好後，房主那邊會開始戰鬥。'}</div>
      <div class="row"><button data-act="title">離開房間</button></div></div>`);
  },

  // ---------- 開始 ----------
  makeLoadout(p) {  // 隊友的配裝（房主這邊用來算隊友的子彈）
    const L = { shipId: p.ship, weapon: { id: p.weapon, path: null, final: null },
      chain: startChain(p.chip), inventory: Array(CFG.INV_SLOTS).fill(null), growth: {}, pullHits: 0,
      parts: { ...SHIPS[p.ship].parts }, module: null, partSlots: SHIPS[p.ship].partSlots,
      R: { dmg: Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])), chips: {}, kills: 0, maxHit: 0 } };  // 隊友的傷害統計
    L.wp = weaponParams(L.weapon);
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.module); });
    return L;
  },
  startHost() {
    const me = this.myPick, mp = this.matePick;
    this.resetStats();
    Game.newRun('coop', me.ship, me.weapon, me.chip);
    const mate = Game.mate = new Player(SHIPS[mp.ship]);
    mate.L = this.makeLoadout(mp);
    mate.hp = mate.maxHp = Game.maxHpOf(SHIPS[mp.ship], mate.L.passives, mate.L.mech);
    mate.dashSeq = 0; mate.wantFire = false;
    this.resetRun();
    this.runId = Math.random().toString(36).slice(2, 10);  // 這一局的編號：斷線重連時用來判斷是不是同一局
    this.send({ t: 'start', ...me, map: this.packMap(Game.map), bossId: Game.bossId, runId: this.runId });
    Game.showMap('雙人遠征開始！點選下一個節點投票，兩人都選好就出發。');
  },
  startClient(m) {
    if (!this.myPick) return;
    const map = this.unpackMap(m.map);
    if (!map || !ENEMY_TYPES[m.bossId]) { this.lost('收到的星圖有問題，請兩邊都重新整理'); return; }
    this.matePick = this.cleanPick(m);
    this.resetStats();
    this.runId = typeof m.runId === 'string' ? m.runId.slice(0, 16) : null;
    const me = this.myPick;
    Game.newRun('coop', me.ship, me.weapon, me.chip);
    Game.map = map; Game.bossId = m.bossId;
    Game.mate = new Player(SHIPS[this.matePick.ship]);
    this.resetRun();
    Game.showMap('雙人遠征開始！點選下一個節點投票，兩人都選好就出發。');
  },

  // ---------- 共同闖關：星圖、投票、共用的錢、各自的配裝 ----------
  resetRun() {
    this.votes = { h: null, c: null }; this.mateAt = null; this.voteEnd = 0;
    this.mateEditing = false; this.myEditing = false; this.solo = false;
    this.lootTotal = 0; this.lastLoot = 0;  // 怪物掉落：房主累計被撿走的數量，隊友照差額加錢
  },
  packMap(map) { return map.map(row => row.map(n => [n.id, n.L, n.k, n.n, n.type, n.next])); },
  unpackMap(raw) {  // 隊友：檢查房主傳來的星圖格式
    if (!Array.isArray(raw) || raw.length < 2 || raw.length > 12) return null;
    const ids = new Set();
    try {
      const map = raw.map(row => (Array.isArray(row) ? row : []).map(a => {
        const [id, L, k, n, type, next] = Array.isArray(a) ? a : [];
        if (typeof id !== 'string' || !NODE_META[type] || !Array.isArray(next)) throw new Error('bad node');
        ids.add(id);
        return { id, L: num(L), k: num(k), n: num(n, 1) || 1, type, next: next.filter(x => typeof x === 'string') };
      }));
      return map.flat().every(n => n.next.every(id => ids.has(id))) ? map : null;
    } catch (e) { return null; }
  },
  sendSector() { this.send({ t: 'sector', map: this.packMap(Game.map), bossId: Game.bossId }); },
  // 回到航圖：告訴對方；隊友順便把最新的配裝傳給房主（下一場戰鬥用）
  atMap() {
    if (!this.linked) return;
    if (this.role === 'client') this.sendLoadout();
    this.send({ t: 'at', s: 'map' });
    this.checkVoteTimer();
  },
  myVoteKey() { return this.role === 'host' ? 'h' : 'c'; },
  vote(id) {
    const node = Game.nodeById(id);
    if (!node || !Game.reachable().includes(node) || Game.state !== 'map') return;
    if (!this.linked) { Game.enterNode(node); return; }  // 隊友已離線：自己走
    this.votes[this.myVoteKey()] = id;
    this.send({ t: 'vote', node: id });
    Screen.map();
    if (this.role === 'host') this.tryResolve();
  },
  checkVoteTimer() {  // 房主：兩人都在航圖時開始倒數
    if (this.role !== 'host' || Game.state !== 'map' || this.mateAt !== 'map' || this.voteEnd) return;
    this.voteEnd = performance.now() + NET_VOTE_TIME * 1000;
    this.send({ t: 'vt', s: NET_VOTE_TIME });
    Screen.map();
  },
  tryResolve(force = false) {  // 房主：兩人都投了（或時間到）就決定目的地
    if (this.role !== 'host' || Game.state !== 'map') return;
    const V = this.votes, reach = Game.reachable();
    if (!force && !(V.h && V.c)) return;
    const cand = [V.h, V.c].filter(id => id && reach.some(n => n.id === id));
    const id = cand.length ? pick(cand) : pick(reach).id;  // 票數比例抽籤（一人一票；都沒投就隨機）
    const drawn = cand.length === 2 && V.h !== V.c;
    this.voteEnd = 0;
    this.send({ t: 'go', node: id, votes: V, drawn });
    this.go(id, V, drawn);
  },
  go(id, votes, drawn) {
    const node = Game.nodeById(id);
    if (!node) return;
    this.mateAt = null; this.voteEnd = 0; this.votes = { h: null, c: null };
    const label = NODE_META[node.type].label;
    Game.state = 'going';
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:36px">${drawn ? '🎲 意見分歧，抽籤決定' : '➜ 出發'}</h1>
      <div class="sub">${drawn ? `1P 投「${NODE_META[Game.nodeById(votes.h).type].label}」、2P 投「${NODE_META[Game.nodeById(votes.c).type].label}」，各 50%。<br>` : ''}
        目的地：<b style="color:${NODE_META[node.type].color};font-size:22px">${NODE_META[node.type].icon} ${label}</b></div></div>`);
    setTimeout(() => { if (Game.state === 'going') Game.enterNode(node); }, drawn ? 1800 : 900);
  },
  voteLeft() { return this.voteEnd ? Math.max(0, Math.ceil((this.voteEnd - performance.now()) / 1000)) : null; },


  // 配裝：隊友改了電路／倉庫／武器就傳給房主（房主模擬隊友的子彈要用）
  sendLoadout() {
    if (this.role !== 'client' || !this.linked) return;
    const G = Game, sg = {};
    for (const id of [...G.chain, ...G.inventory])
      if (id && CHIPS[id] && CHIPS[id].type === 'singularity') sg[id] = { name: CHIPS[id].name, cost: CHIPS[id].cost, combo: CHIPS[id].combo };
    this.send({ t: 'lo', weapon: G.weapon, chain: G.chain, inventory: G.inventory, sg, hp: G.player.hp, cr: G.credits,
      parts: G.parts, module: G.module, ps: G.partSlots });
  },
  // 檢查對方傳來的電路、倉庫、武器：不認得的晶片變空格；奇異點（動態產生的晶片）登記成 sgPrefix + 原本的 id
  sanitizeLoadout(m, sgPrefix) {
    const sgMap = {};
    const fix = (id, depth = 0) => {
      if (typeof id !== 'string') return null;
      if (id === 'scrap' || NORMAL_IDS.includes(id) || COMPOSITE_IDS.includes(id) || (depth && OVERLOADS.includes(id))) return id;
      const lv = /^([a-z_]+)#([23])$/.exec(id);
      if (lv && NORMAL_IDS.includes(lv[1]) && lv[1] !== 'mirror') return leveledId(lv[1], +lv[2]);
      if (!depth && /^sg_\d+$/.test(id) && m.sg && m.sg[id]) {
        if (sgMap[id]) return sgMap[id];
        const d = m.sg[id], combo = (Array.isArray(d.combo) ? d.combo : []).slice(0, 8).map(c => fix(c, 1)).filter(Boolean);
        if (!combo.length) return null;
        const hid = sgPrefix + id;
        CHIPS[hid] = { name: String(d.name || '奇異點').slice(0, 30), short: '奇異', type: 'singularity', cost: clamp(num(d.cost), 0, 20), combo,
          desc: '一格內依序執行：' + combo.filter(c => !CHIPS[c].hidden).map(c => CHIPS[c].name).join(' → ') + '。' };
        if (!sgPrefix) singularityCount = Math.max(singularityCount, +id.slice(3));  // 之後自己融合的編號不要撞到
        return (sgMap[id] = hid);
      }
      return null;
    };
    const chain = (Array.isArray(m.chain) ? m.chain : []).slice(0, CFG.MAX_SLOTS).map((id, i) => (i === 0 ? 'weapon' : fix(id)));
    while (chain.length < CFG.START_SLOTS) chain.push(null);
    chain[0] = 'weapon';
    const inventory = Array.from({ length: CFG.INV_SLOTS }, (_, i) => fix(Array.isArray(m.inventory) ? m.inventory[i] : null));
    const W = m.weapon && WEAPONS[m.weapon.id] ? m.weapon : null, path = W && W.path && WEAPONS[W.id].paths[W.path] ? W.path : null;
    const weapon = W ? { id: W.id, path, final: path && (W.final === 0 || W.final === 1) ? W.final : null } : null;
    return { chain, inventory, weapon };
  },
  applyMateLoadout(m) {  // 房主：檢查後套用到隊友的配裝
    const mate = Game.mate;
    if (!mate || !mate.L) return;
    const { chain, inventory, weapon } = this.sanitizeLoadout(m, 'm'), L = mate.L;  // 奇異點在房主這邊登記成 m + id
    if (weapon && weapon.id === L.weapon.id) L.weapon = weapon;
    L.credits = Math.max(0, num(m.cr, L.credits || 0));  // 隊友的錢包（重新連線時還原用）
    L.lootAtLo = this.lootTotal || 0;  // 之後撿到的掉落另外算
    L.chain = chain; L.inventory = inventory; L.wp = weaponParams(L.weapon);
    // 機體：零件層數（0～20）、零件格、背包模組（不認得的模組當作沒有）
    const P = m.parts && typeof m.parts === 'object' ? m.parts : {};
    L.parts = Object.fromEntries(PART_IDS.map(id => [id, clamp(Math.floor(num(P[id])), 0, 20)]));
    L.partSlots = clamp(Math.floor(num(m.ps, L.partSlots || 6)), 1, 20);
    L.module = typeof m.module === 'string' && MODULES[m.module] ? m.module : null;
    Game.withLoadout(L, () => { Game.stats = analyzeChain(Game.chain); Game.passives = computePassives(Game.inventory); Game.mech = mechStats(Game.parts, Game.module); });
    mate.maxHp = Game.maxHpOf(mate.ship, L.passives, L.mech);
    if (!Game.inArena) mate.hp = clamp(num(m.hp, mate.hp), 1, mate.maxHp);  // 戰鬥中的血量以房主為準
    else mate.hp = Math.min(mate.hp, mate.maxHp);
  },

  // 戰鬥中按 Tab：兩邊一起暫停
  setEditing(on) {
    this.myEditing = on;
    this.send({ t: 'edit', on: !!on });
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
      revive(Game.player); revive(Game.mate);
      if (Game.mate) { this.sendDmg(); this.send({ t: 'won', hp: Game.mate.hp, loot: left, lt: this.lootTotal }); }  // loot：地上沒吸完的晶體，隊友也拿
    }
  },

  // ---------- 遊玩紀錄（雙人） ----------
  whereText() {
    const G = Game, n = G.node, C = G.combat;
    const at = n ? `${G.isEndless() ? '無盡 · ' : ''}星區 ${G.sector} 第 ${n.L + 1} 層（${NODE_META[n.type].label}）` : `星區 ${G.sector} 航圖`;
    return at + (n && C && G.inArena && C.wavesTotal !== Infinity ? ` 第 ${C.wave} / ${C.wavesTotal} 波` : '');
  },
  buildRecord(result) {
    const G = Game, R = G.runStats, S = this.stats || { pings: [], snaps: 0, inputs: 0, maxGap: 0 };
    const total = R ? Object.values(R.dmg).reduce((a, b) => a + b, 0) : 0;
    const name = id => (id && CHIPS[id] ? CHIPS[id].name : null);
    const mp = this.matePick, ps = [...S.pings].sort((a, b) => a - b);
    const host = this.role === 'host' || (!this.role && G.mate && G.mate.L);
    return {
      v: 2, build: CFG.VERSION, at: new Date().toISOString(), result, mode: 'coop',
      where: `雙人 · ${this.whereText()}（${host ? '房主 1P' : '隊友 2P'}）`,
      sector: G.sector, layer: G.node ? G.node.L + 1 : 0, endless: G.isEndless(),
      input: Input.touch ? `觸控（自動攻擊${Input.autoFire ? '開' : '關'}）` : '滑鼠鍵盤',
      ship: SHIPS[G.shipId].name, weapon: weaponTitle(G.weapon),
      time: Math.round(R ? R.time : 0), kills: R ? R.kills : 0, dmg: Math.round(total), maxHit: Math.round(R ? R.maxHit : 0),
      dmgBySource: R ? Object.fromEntries(DMG_SOURCES.filter(([k]) => R.dmg[k] > 0).map(([k, label]) => [label, Math.round(R.dmg[k])])) : {},
      chain: G.chain.map(name), inv: G.inventory.filter(Boolean).map(name),
      chipDmg: R ? Object.entries(R.chips).sort((a, b) => b[1] - a[1]).map(([k, v]) => [dmgKeyName(k), Math.round(v)]) : [],
      credits: G.credits, hp: Math.max(0, Math.ceil(G.player.hp)), maxHp: G.player.maxHp, mech: G.mechRecord(),
      cause: G.player.dead ? G.lastHit : '',
      coop: {
        role: host ? '房主' : '隊友',
        mate: mp ? `${SHIPS[mp.ship].name} · ${WEAPONS[mp.weapon].name} · 起始晶片 ${name(mp.chip) || '無'}` : '（不明）',
        mateDown: !!(G.mate && G.mate.dead),
        ping: ps.length ? { avg: Math.round(ps.reduce((a, b) => a + b, 0) / ps.length), min: ps[0],
          p90: ps[Math.floor(ps.length * 0.9)], max: ps[ps.length - 1], samples: ps.length } : '沒有量到',
        sync: host ? { inputsReceived: S.inputs, maxGapMs: Math.round(S.maxGap) } : { snapshotsReceived: S.snaps, maxGapMs: Math.round(S.maxGap) },
        team: this.teamRows().map(r => ({ who: `${r.tag}${r.me ? '（你）' : ''}`, ship: SHIPS[r.ship] ? SHIPS[r.ship].name : '？',
          dmg: Math.round(r.dmg), kills: r.kills, maxHit: Math.round(r.maxHit) })),
        mateChipDmg: (this.mateChipRows() || { rows: [] }).rows.map(([n, , v]) => [n, Math.round(v)]),  // 隊友的晶片傷害（整局）
      },
    };
  },

  // ---------- 房主 ----------
  applyInput(m) {  // 隊友傳來的位置與操作
    const p = Game.mate;
    if (!p || p.dead || Game.state !== 'play') return;
    p.x = clamp(num(m.x, p.x), p.r, CFG.WORLD_W - p.r); p.y = clamp(num(m.y, p.y), p.r, CFG.WORLD_H - p.r);
    p.vx = num(m.vx); p.vy = num(m.vy); p.aim = num(m.a, p.aim);
    p.moving = !!m.mv; p.dashT = clamp(num(m.dT), 0, CFG.DASH_TIME); p.wantFire = !!m.f;
    const ds = num(m.ds, p.dashSeq);
    if (ds > p.dashSeq) { p.dashSeq = ds; Game.withLoadout(p.L, () => p.onDash()); }  // 衝刺技能（震波、相位超載）由房主執行
  },
  hostUpdateMate(dt) {
    const m = Game.mate;
    if (m.dead || m.gone) return;
    m.x = clamp(m.x + m.vx * dt, m.r, CFG.WORLD_W - m.r);  // 兩次輸入之間先照速度往前推
    m.y = clamp(m.y + m.vy * dt, m.r, CFG.WORLD_H - m.r);
    m.iframe -= dt; m.overdrive -= dt; m.dashT -= dt;
    Game.withLoadout(m.L, () => { m.tickDash(); m.tickFire(dt, m.wantFire); });  // 開火（蓄力、過熱）與衝刺相關的晶片
    Objects.hostCheckMate(m);
  },
  hostSend(dt) {
    this.sendAcc += dt;
    if (this.sendAcc < NET_RATE || !this.conn || !this.conn.open || !Game.inArena) return;
    this.sendAcc = Math.min(this.sendAcc - NET_RATE, NET_RATE);  // 保留零頭，才能穩定每秒 30 次
    const G = Game, P = G.player, m = G.mate, r = Math.round;
    // 只傳隊友附近的子彈（畫面外的不用畫）
    const cx = m ? m.x : P.x, cy = m ? m.y : P.y, near = (x, y) => Math.abs(x - cx) < 1300 && Math.abs(y - cy) < 1000;
    const pal = [], palIdx = new Map();
    const ci = c => { let i = palIdx.get(c); if (i == null) { i = pal.length; pal.push(c); palIdx.set(c, i); } return i; };
    this.send({
      t: 's',
      p: [r(P.x), r(P.y), r2(P.aim), r2(P.hp), P.maxHp, r2(Math.max(0, P.dashT)), r2(Math.max(0, P.iframe)),
        P.overdrive > 0 ? 1 : 0, P.moving ? 1 : 0, P.dead ? 1 : 0, r(P.vx), r(P.vy), r2(P.reviveT)],
      me: m ? [r2(m.hp), m.maxHp, r2(Math.max(0, m.iframe)), m.dead ? 1 : 0, m.lastHit || '', r2(m.reviveT),
        r2(m.chargeC), m.L.stats.heatLimit ? r2(m.ohT / m.L.stats.heatLimit) : 0, r2(Math.max(0, m.ohLock)), m.shield || 0] : null,
      gr: m ? m.L.growth : null,  // 隊友各晶片的累積用量（隊友那邊照這個升級）
      ob: Objects.pack(),         // 地圖物件
      pt: G.portals.map(q => [r(q.ax), r(q.ay), r(q.bx), r(q.by), r2(q.t), q.color]),
      pp: [...PART_IDS.map(id => G.parts[id] || 0), G.module || ''],  // 房主的零件與模組（隊友那邊畫房主的船用）
      e: G.enemies.filter(e => !e.dead).map(e => [e.id, e.type, r(e.x), r(e.y), r(e.vx), r(e.vy), r(e.hp), r(e.maxHp), r2(e.rot),
        e.flash > 0 ? 1 : 0, r2(Math.max(0, e.spawnT)), e.spawnMax, e.mode, r2(e.modeT), r2(e.chargeA),
        e.slowT > 0 ? 1 : 0, e.burnT > 0 ? 1 : 0, e.enraged ? 1 : 0, e.stuck ? e.stuck.length : 0]),
      b: G.bullets.filter(b => !b.dead && near(b.x, b.y)).map(b => [r(b.x), r(b.y), r2(b.angle), r(b.speed), r2(b.r),
        ci(b.color), b.shape, b.splits, b.payload ? 1 : 0, r2(b.life), r(Math.min(60, Math.hypot(b.x - b.sx, b.y - b.sy)))]),
      eb: G.eBullets.filter(b => near(b.x, b.y)).map(b => [r(b.x), r(b.y), r(b.vx), r(b.vy), b.r]),
      pk: G.pickups.map(c => [c.id, r(c.x), r(c.y), r2(c.life), r(c.vx), r(c.vy), c.vacuum ? 1 : 0]),
      mg: r(CFG.MAGNET_RANGE * (1 + G.passives.magnet)),  // 房主的拾取範圍（隊友那邊模擬晶體飛向房主時用）
      pal, lt: this.lootTotal, w: G.combat ? G.combat.wave : 0, k: G.kills,
      bn: G.banner ? [G.banner.text, G.banner.sub || '', r2(G.banner.t)] : null,
      fx: this.fxBuf,
    });
    this.fxBuf = [];
  },

  // ---------- 隊友 ----------
  clientUpdate(dt) {
    const G = Game, P = G.player;
    if (G.state === 'play' && !this.pauseReason()) {  // 房主在編輯電路、切到其他視窗、斷線時全員暫停
      G.time += dt;
      if (G.runStats) G.runStats.time += dt;
      if (!P.dead) P.update(dt);
      // 兩次戰場狀態之間：照速度往前推，畫面才會滑順
      for (const e of G.enemies) {
        e.modeT -= dt;
        if (e.spawnT > 0) e.spawnT -= dt;
        else { e.x += e.vx * dt; e.y += e.vy * dt; }
      }
      for (const b of G.bullets) { b.x += Math.cos(b.angle) * b.speed * dt; b.y += Math.sin(b.angle) * b.speed * dt; b.life -= dt; }
      for (const b of G.eBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
      Objects.clientStep(dt);
      for (const c of G.pickups) {  // 晶體：用和房主一樣的算法飛向最近的玩家；碰到自己就先藏起來（房主那邊才真的入帳）
        if (c.gone) continue;
        const m = G.mate, dP = P.dead ? Infinity : dist2(c.x, c.y, P.x, P.y), dM = m && !m.dead ? dist2(c.x, c.y, m.x, m.y) : Infinity;
        if (dP <= dM && dP < Infinity) stepPickup(c, P, CFG.MAGNET_RANGE * (1 + G.passives.magnet), dP, dt);
        else if (dM < Infinity) stepPickup(c, m, this.mateMagnet || CFG.MAGNET_RANGE, dM, dt);
        if (dP < 20 * 20 || (dM < 20 * 20 && dP > dM)) c.gone = true;
      }
      G.pickups = G.pickups.filter(c => !c.gone || G.time - (c.goneT = c.goneT || G.time) < 1);  // 藏起來的留 1 秒，免得下一次同步又冒出來
      const m = G.mate;
      if (m && !m.dead) { m.x += m.vx * dt; m.y += m.vy * dt; m.iframe -= dt; m.dashT -= dt; }
      this.inAcc += dt;
      if (this.inAcc >= NET_RATE && !P.dead) {
        this.inAcc = Math.min(this.inAcc - NET_RATE, NET_RATE);
        this.send({ t: 'i', x: Math.round(P.x), y: Math.round(P.y), vx: Math.round(P.vx), vy: Math.round(P.vy), a: r2(P.aim),
          mv: P.moving ? 1 : 0, dT: r2(Math.max(0, P.dashT)), ds: P.dashSeq || 0, f: P.wantFire ? 1 : 0 });
      }
    }
    if (G.state === 'play' || G.state === 'dead') G.updateFx(dt);
    if (G.inArena) G.updateCamera(dt);
  },
  applySnap(s) {
    const G = Game;
    if (G.mode !== 'coop' || !G.combat || !G.inArena || (G.state !== 'play' && G.state !== 'dead')) return;
    const arr = v => (Array.isArray(v) ? v : []);
    const m = G.mate, p = s.p;
    if (m && Array.isArray(p)) {
      m.x = num(p[0], m.x); m.y = num(p[1], m.y); m.aim = num(p[2]); m.hp = num(p[3]); m.maxHp = num(p[4], m.maxHp);
      m.dashT = num(p[5]); m.iframe = num(p[6]); m.overdrive = p[7] ? 1 : 0; m.moving = !!p[8]; m.dead = !!p[9];
      m.vx = num(p[10]); m.vy = num(p[11]); m.reviveT = num(p[12]);
    }
    const P = G.player;
    if (Array.isArray(s.me)) {  // 自己的血量以房主為準
      const hp = num(s.me[0], P.hp);
      if (hp < P.hp - 0.01 && !P.dead) {
        G.shake(9); SFX.play(hp <= 0 ? 'death' : 'hurt');
        burst(P.x, P.y, '#ff4d6d', 16, 240, 0.4, 2);
      }
      P.hp = hp; P.maxHp = num(s.me[1], P.maxHp);
      if (s.me[2] > 0) P.iframe = num(s.me[2]);
      if (typeof s.me[4] === 'string') G.lastHit = s.me[4].slice(0, 60);
      if (s.me[3] && !P.dead) { P.dead = true; Input.down = false; burst(P.x, P.y, P.ship.color, 80, 400, 1.2, 3); G.shake(20); }
      else if (!s.me[3] && P.dead && hp > 0) { P.dead = false; P.vx = P.vy = 0; P.iframe = CFG.REVIVE.iframe; }  // 被隊友救起來
      P.reviveT = num(s.me[5]);
      P.chargeC = num(s.me[6]); P.heatR = num(s.me[7]); P.ohLock = num(s.me[8]); P.shield = num(s.me[9]);
    }
    if (s.gr && typeof s.gr === 'object') {  // 用量成長：房主算好的累積量，這邊只增不減，到了就升級
      let up = false;
      for (const k in s.gr) if (CHIPS[k] && CHIPS[k].grow && num(s.gr[k]) > (G.growth[k] || 0)) { G.growth[k] = num(s.gr[k]); up = true; }
      if (up) G.checkGrowth();
    }
    G.enemies = arr(s.e).map(a => {
      const t = ENEMY_TYPES[a[1]];
      if (!t) return null;
      return { id: a[0], type: a[1], t, r: t.radius, x: num(a[2]), y: num(a[3]), vx: num(a[4]), vy: num(a[5]),
        hp: num(a[6]), maxHp: num(a[7], 1), rot: num(a[8]), flash: a[9] ? 0.08 : 0, spawnT: num(a[10]), spawnMax: num(a[11], 1) || 1,
        mode: a[12], modeT: num(a[13]), chargeA: num(a[14]), slowT: a[15] ? 1 : 0, burnT: a[16] ? 1 : 0, enraged: !!a[17], stuckN: num(a[18]), dead: false };
    }).filter(Boolean);
    const pal = arr(s.pal);
    G.bullets = arr(s.b).map(a => {
      const ang = num(a[2]), tl = num(a[10]);
      return { x: num(a[0]), y: num(a[1]), angle: ang, speed: num(a[3]), r: num(a[4], 3), color: typeof pal[a[5]] === 'string' ? pal[a[5]] : '#fff',
        shape: a[6], splits: num(a[7]), payload: !!a[8], life: num(a[9], 1),
        sx: num(a[0]) - Math.cos(ang) * tl, sy: num(a[1]) - Math.sin(ang) * tl };
    });
    G.objs = Objects.unpack(s.ob);
    G.portals = arr(s.pt).filter(Array.isArray).map(a => ({ ax: num(a[0]), ay: num(a[1]), bx: num(a[2]), by: num(a[3]), t: num(a[4]), color: typeof a[5] === 'string' ? a[5] : '#2ee6a6' }));
    if (m && Array.isArray(s.pp)) { m.parts = Object.fromEntries(PART_IDS.map((id, i) => [id, clamp(num(s.pp[i]), 0, 20)])); m.module = MODULES[s.pp[5]] ? s.pp[5] : null; }
    G.eBullets = arr(s.eb).map(a => ({ x: num(a[0]), y: num(a[1]), vx: num(a[2]), vy: num(a[3]), r: num(a[4], 5) }));
    // 晶體：隊友這邊自己模擬飛行（見 clientUpdate），房主的位置只拿來慢慢修正，不直接跳過去
    this.mateMagnet = num(s.mg, CFG.MAGNET_RANGE);
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
    G.banner = Array.isArray(s.bn) ? { text: String(s.bn[0]), sub: String(s.bn[1] || ''), t: num(s.bn[2], 1) } : null;
    for (const f of arr(s.fx)) {  // 房主那邊發生的特效與音效
      if (!Array.isArray(f)) continue;
      switch (f[0]) {
        case 'b': burst(num(f[1]), num(f[2]), String(f[3]), Math.min(150, num(f[4])), num(f[5], 200), num(f[6], 0.5), num(f[7], 2)); break;
        case 't': floatText(num(f[1]), num(f[2]), String(f[3]), String(f[4]), !!f[5]); break;
        case 's': SFX.play(String(f[1]), f[2]); break;
        case 'r': if (G.rings.length < 40) G.rings.push({ x: num(f[1]), y: num(f[2]), r: num(f[3], 40), life: 0.3, max: 0.3, color: String(f[4]) }); break;
        case 'z': if (G.zaps.length < 60) G.zaps.push({ x1: num(f[1]), y1: num(f[2]), x2: num(f[3]), y2: num(f[4]), life: 0.18, max: 0.18 }); break;
      }
    }
  },
};
addEventListener('beforeunload', () => Net.close());
// 切到其他視窗／分頁時通知隊友：兩人一起暫停（瀏覽器會把背景分頁的遊戲停住，不暫停的話飛船會站著挨打）
document.addEventListener('visibilitychange', () => {
  if (Net.linked && Game.mode === 'coop') Net.send({ t: 'away', on: document.hidden });
});
