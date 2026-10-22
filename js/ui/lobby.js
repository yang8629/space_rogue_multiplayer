// 星環電路 多人版 · lobby.js：多人連線的畫面：大廳、房間重畫、等待／重連遮罩、出發倒數、提醒橫幅、延遲標籤、多人傷害表
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   system/net.js 只管連線和狀態，要畫面做什麼就發 netView 事件（{ k: 種類, ...資料 }），這裡照種類畫。按鈕照樣走 Screen.act（data-act）
'use strict';

const left = until => Math.max(0, Math.ceil((until - performance.now()) / 1000));  // 剩幾秒（倒數字）
const NetView = {
  on(d) {
    switch (d.k) {
      case 'lobby': return this.lobby(d);
      case 'msg': { const el = document.getElementById('netMsg'); if (el) el.innerHTML = d.bad ? `<span style="color:#ff4d6d">${d.text}</span>` : d.text; return; }
      case 'hosting': { const el = document.getElementById('netBtns'); if (el) el.innerHTML = ''; return; }  // 開了房間：不再顯示「開房間／加入房間」
      case 'lost': return this.lost(d);
      case 'wait': return this.wait(d);
      case 'rejoin': return this.rejoin(d);
      case 'resuming': return this.overlay('<h2 style="color:#9dff6b;margin:0">隊友重新連線中…</h2><div class="sub">正在把這一局的狀態傳給隊友。</div>');
      case 'hideOverlay': { const el = document.getElementById('netOverlay'); if (el) el.hidden = true; return; }
      case 'going': return this.going(d);
      case 'nudge': return this.nudge(d.on);
      case 'ping': for (const el of document.querySelectorAll('[data-pslot]')) el.innerHTML = this.pingTag(+el.dataset.pslot); return;
      case 'room':  // 房間裡的狀態變了：重畫上方的房間列；開著發射台的面板就重畫面板
        if (Hub.driving) Screen.hubView();
        else if (Screen.el.querySelector('[data-act="depart"], [data-act="netchapter"]')) Screen.basePanel('launch');
        return;
      case 'screen': return Screen[d.name](d.msg);  // 收到隊友的訊息後重畫這一頁（航圖、事件、勝利、陣亡、房間）
      case 'closeEditor': return Editor.close();
    }
  },
  // 每幀：倒數的數字（重連、投票、全隊事件、出發）
  tick() {
    if (!Net.role) return;
    const set = (id, t) => { const el = document.getElementById(id); if (el) el.textContent = t; };
    if (Net.waiting) set('rejoinLeft', left(Net.waiting.until));
    if (Game.mode !== 'coop') return;
    const v = Net.voteLeft(), e = Net.evLeft();
    set('voteTimer', v != null ? `剩 ${v} 秒` : '');
    set('evTimer', e != null ? `（剩 ${e} 秒）` : '');
    if (Net.goUntil) set('goLeft', Math.max(1, left(Net.goUntil)));
  },
  // 連線畫面：開房間、輸入房號加入（連上之後就進房間）
  lobby(d) {
    const ok = typeof Peer !== 'undefined';  // 連線元件（PeerJS）有沒有載入
    Screen.show(`<div class="scr title-wrap">
      <h1 style="font-size:42px">👥 多人連線</h1>
      <div class="sub">開房間或輸入房號加入（最多 ${NET_MAX} 人）。進房間後大家在同一個基地裡：各自在停機坪選飛船、到發射台準備（房主選章），全員準備好就開始；每局結束後回到這個房間。</div>
      <div id="netBtns">${ok ? `<div class="row"><button class="big" data-act="nethost">開房間</button></div>
        <div class="row"><input id="netCode" maxlength="4" placeholder="房號" autocomplete="off" spellcheck="false"
          style="font-size:22px;width:5.5em;text-align:center;letter-spacing:.3em;text-transform:uppercase;background:#0a1030;color:#fff;border:1px solid #4cc9f0;border-radius:6px;padding:8px">
          <button class="big" data-act="netjoin">加入房間</button></div>`
      : '<div class="sub" style="color:#ff4d6d">連線元件沒有載入（需要網路）。請確認有連上網路後重新整理。</div>'}</div>
      <div class="sub" id="netMsg" style="min-height:3em">${d.bad ? `<span style="color:#ff4d6d">${d.msg}</span>` : d.msg}</div>
      <div class="keys">一人按「開房間」拿到 4 碼房號，其他人輸入房號按「加入房間」。<br>
        多人遠征：航圖投票（選不同就照票數抽籤）、錢包各自獨立（怪物掉落的晶體每人都拿）、獎勵各自選、戰鬥中按 Tab 全員一起暫停。<br>
        一人被擊墜時留在原地，隊友靠近 ${CFG.REVIVE.time} 秒就能救起來（救的人分出自己一半的血量）；沒被救起的在戰鬥結束後以 30% HP 歸隊；全員都被擊墜才結束。</div>
      <div class="row"><button data-act="title" data-back>返回基地 (Esc)</button></div>
      <div class="ver">版本 ${CFG.VERSION}</div></div>`);
  },
  lost(d) {  // 放棄這一局之後的「連線中斷」畫面
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:40px;color:#ff4d6d">連線中斷</h1>
      <div class="sub">${d.msg}</div>
      <div class="row"><button class="big" data-act="title">回到基地</button><button data-act="records">📜 遊玩紀錄</button></div></div>`);
  },
  wait(d) {  // 房主：隊友斷線，遊戲暫停等他回來
    this.overlay(`<h2 style="color:#ffd166;margin:0">⏸ 隊友斷線了</h2>
      <div class="sub">${d.msg}<br>遊戲暫停中，房間保留 <b id="rejoinLeft">${left(d.until)}</b> 秒。<br>
        請隊友按「重新連線」；如果他重新整理了頁面，選「多人連線」後輸入房號 <b style="letter-spacing:.2em;color:#ffd166">${d.code}</b> 就能回到這一局。</div>
      <div class="row"><button class="big" data-act="netsolo">自己繼續玩（隊友之後還能回來）</button>
        <button data-act="netgiveup">結束這一局</button></div>`);
  },
  rejoin(d) {  // 隊友：斷線了，可以按重新連線
    this.overlay(`<h2 style="color:#ff9f1c;margin:0">連線中斷</h2>
      <div class="sub">${d.msg}${d.note ? `<br><span style="color:#ff4d6d">${d.note}</span>` : ''}<br>
        房主那邊會暫停並保留房間 ${NET_REJOIN_TIME} 秒，重新連線就能回到這一局。</div>
      <div class="row"><button class="big" data-act="netrejoin" ${d.busy ? 'disabled' : ''}>${d.busy ? '連線中…' : `重新連線（房號 ${d.code}）`}</button>
        <button data-act="netgiveup">放棄，回到基地</button></div>`);
  },
  going(d) {  // 大家都選好（或投票時間到）：倒數幾秒再進關卡
    const S = Object.keys(d.votes).map(Number).sort((a, b) => a - b);
    const why = S.map(s => `${s}P 投「${NODE_META[Game.nodeById(d.votes[s]).type].label}」`).join('、') + (S.length === 2 ? '，各 50%' : '，照票數比例抽籤');
    Screen.show(`<div class="scr title-wrap"><h1 style="font-size:36px">${d.drawn ? '🎲 意見分歧，抽籤決定' : '➜ 出發'}</h1>
      <div class="sub">${d.drawn ? `${why}。<br>` : ''}
        目的地：<b style="color:${NODE_META[d.node.type].color};font-size:22px">${NODE_META[d.node.type].icon} ${NODE_META[d.node.type].label}</b></div>
      <h1 style="font-size:64px;margin:10px 0 0" id="goLeft">${d.T}</h1></div>`);
  },
  // 提醒還沒選節點的人：畫面最上面的橫幅（開著電路編輯器、在商店也看得到）
  nudge(on) {
    let el = document.getElementById('netNudge');
    if (!on) { if (el) el.hidden = true; return; }
    if (!el) { el = document.createElement('div'); el.id = 'netNudge'; document.body.appendChild(el); }
    el.textContent = '👥 隊友已經選好下一個節點，等你選擇（在航圖點一個發光的節點）';
    el.hidden = false;
  },
  overlay(html) {  // 蓋在畫面上的面板（斷線、重連）
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
  pingColor(ms) { return ms == null ? '#8fa3d9' : ms < 80 ? '#9dff6b' : ms < 150 ? '#ffd166' : '#ff4d6d'; },  // 延遲的顏色：快綠、中黃、慢紅
  // 號碼旁邊的延遲（房間列、戰鬥中的隊友列）
  pingTag(slot) { const ms = Net.pingOf(slot); return ms == null ? '' : `<span style="color:${this.pingColor(ms)}">${ms}ms</span>`; },
  // 多人傷害結算（電路編輯器的傷害分頁、勝利、結算畫面）
  teamSummaryHtml() {
    const rows = Net.teamRows(), sum = rows.reduce((a, r) => a + r.dmg, 0);
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
};
Events.on('netView', d => NetView.on(d));
