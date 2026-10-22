// 星環電路 多人版 · base.js：基地（主畫面）的 DOM 部分：上方列、靠近時的說明卡、門後的面板、發射台（選章、出發）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html（接在 screens.js 後面，往 Screen 加方法）
//   場景本身（開著飛船走）在 js/game/hub.js、js/ui/gl/gl_hub.js；這裡的畫面蓋在場景上面
//   「新」標記：解鎖了、還沒看過的（unlockIsNew）；門後的面板打開 = 那幾類看過了，飛船是靠近它的停機坪就算看過
'use strict';

// 門後的面板：每個面板顯示哪幾類解鎖（「新」標記照這個算）；launch = 發射台
const BASE_PANELS = [
  { id: 'armory', label: '⚔ 軍械庫', kinds: ['weapon'] },
  { id: 'chips', label: '◈ 晶片庫', kinds: ['play', 'comp'] },
  { id: 'stats', label: '🏆 戰績', kinds: [] },
  { id: 'launch', label: '🚀 發射台', kinds: [] },
];

Object.assign(Screen, {

  // 進基地；tab = 直接打開哪個面板（結算畫面的「回基地看」）
  title(tab = null) {
    Game.state = 'title';
    Hub.enter();
    if (tab && BASE_PANELS.some(p => p.id === tab)) this.basePanel(tab);
    else this.hubView();
  },
  // 多人房間：共用的基地（Game.state = 'pick'，Net.enterRoom）：其他人的飛船也在裡面（Net.roomShips）
  hubPick() {
    Hub.enter();
    this.hubView();
  },
  // 基地的上方列（標題、總覽、系統按鈕）＋下方的操作說明＋靠近時的說明卡；不擋滑鼠（只有按鈕能點）
  //   多人房間：上方改成房間列（房號、章節、每個人準備好了沒、延遲）＋離開房間
  hubView() {
    const P = unlockLoad();
    const all = UNLOCK_KINDS.flatMap(([k]) => unlockIds(k).map(id => unlockEntry(k, id)));
    const got = all.filter(u => !u || unlockDone().has(u)).length;
    this.show(`<div class="hub-ui">
      <div class="hub-top">
        <div class="hub-logo"><h1>星環電路</h1><span class="en">CIRCUIT ROGUE</span>
          <div class="ulk-tiles"><span>解鎖 <b>${got} / ${all.length}</b></span><span>完成 <b>${P.runs}</b> 局</span><span>擊殺 <b>${P.kills.toLocaleString('zh-TW')}</b></span><span>最遠 <b>${P.sector ? `第 ${P.sector} 星區` : '—'}</b></span></div></div>
        <div class="base-sys">${this.refreshBtn()}<button data-act="codex">📖 電路總覽</button><button data-act="settings">⚙ 設定</button></div>
      </div>
      ${Hub.coop() ? this.roomBar() : this.unlockFreshHtml(false)}
      <div id="hubInfo" class="hub-info"></div>
    </div>`);
    this.el.classList.add('hub');
    Hub.setDriving(true);
    this.hubInfo(Hub.near);
    this.checkVersion();
    Game.unlockFresh = [];  // 新達成的解鎖只顯示一次
  },
  // 多人房間列：房號（📋 複製）、章節（房主在發射台選）、每個人（號碼色，✓ = 準備好了，後面是他到房主的延遲；房主自己不寫）
  roomBar() {
    const who = Net.roomList().map(([s, r, me]) => `<b style="color:${Game.slotColor(s)}"${me ? ' class="me" title="你"' : ''}>${s}P</b>${r ? '<span class="ok">✓</span>' : '<span class="ty">…</span>'}<span class="ty" data-pslot="${s}">${NetView.pingTag(s)}</span>`).join('　');
    const alone = Net.role === 'host' && !Net.peers.some(q => q.linked);
    return `<div class="ulk-fresh hub-coop">👥 房號 <b class="code">${Net.code}</b><button data-act="copycode" title="複製房號，貼給朋友">📋 複製</button>　${chapterById(Net.chapter).name.split('　')[0]}　${alone ? '<span class="ty">把房號告訴朋友，等隊友加入…</span>' : who}
      <button data-act="title">離開</button></div>`;
  },
  // 靠近的東西的說明卡（hubNear 事件）：停機坪 = 飛船的能力、數值（沒解鎖 = 條件和進度），門、發射台、終端機 = 按 E 做什麼
  hubInfo(z) {
    if (z && z.kind === 'pad' && isUnlocked('ship', z.ship)) unlockMarkSeen([unlockEntry('ship', z.ship)].filter(Boolean));  // 靠近解鎖的飛船 = 看過
    const el = Hub.driving && typeof document !== 'undefined' && document.getElementById('hubInfo');
    if (!el) return;
    if (!z) { el.innerHTML = ''; el.classList.remove('on'); return; }
    let body = '';
    if (z && z.kind === 'rack' && isUnlocked('weapon', z.weapon)) unlockMarkSeen([unlockEntry('weapon', z.weapon)].filter(Boolean));  // 靠近解鎖的武器 = 看過
    if (z.kind === 'rack') {
      const W = WEAPONS[z.weapon], u = unlockEntry('weapon', z.weapon);
      if (z.weapon === Hub.weaponId) body = `<div class="hg-desc">${weaponCardBody(z.weapon)}</div><div class="hub-press">裝備中</div>`;
      else if (Hub.coop() && Net.meReady) body = `<div class="ttl" style="color:${W.color}">${W.name}</div><div class="hub-press">已準備，不能換武器</div>`;
      else if (isUnlocked('weapon', z.weapon)) body = `<div class="hg-desc">${weaponCardBody(z.weapon)}</div><div class="hub-press"><b>E</b> 裝備${W.name}</div>`;
      else {
        const st = unlockState(u);
        body = `<div class="ttl" style="color:${W.color}">🔒 ${W.name}</div><div class="ds">${unlockNeed(u)}</div>
          <div class="ulk-bar"><div style="width:${Math.round(st.cur / st.max * 100)}%"></div></div><div class="ty">${Math.floor(st.cur)} / ${st.max}</div>`;
      }
    } else if (z.kind === 'pad') {
      const S = SHIPS[z.ship], u = unlockEntry('ship', z.ship);
      const mine = z.ship === Hub.shipId;  // 自己開的那艘：一樣看數據
      if (!mine && Hub.coop() && Net.meReady) body = `<div class="ttl" style="color:${S.color}">${S.name}</div><div class="hub-press">已準備，不能換船</div>`;
      else if (isUnlocked('ship', z.ship)) {
        const parts = Object.entries(S.parts).map(([p, n]) => `${PARTS[p].name} ×${n}`).join('、') || '沒有';
        body = `<div class="ttl" style="color:${S.color}">${S.name}<span class="ty">${S.en}</span></div>${shipStatLine(S)}<div class="hg-desc">${shipDescHtml(S)}</div>
          <div class="ty">開局零件：${parts}</div><div class="hub-press">${mine ? '現在開的飛船' : `<b>E</b> 換成${S.name}`}</div>`;
      } else {
        const st = unlockState(u);
        body = `<div class="ttl" style="color:${S.color}">🔒 ${S.name}</div><div class="ds">${unlockNeed(u)}</div>
          <div class="ulk-bar"><div style="width:${Math.round(st.cur / st.max * 100)}%"></div></div><div class="ty">${Math.floor(st.cur)} / ${st.max}</div>`;
      }
    } else {
      const what = Hub.coop() && z.kind === 'term' ? '多人準備中不能用'
        : { console: `打開${z.label.replace(/^\S+ /, '')}`, launch: !Hub.coop() ? '選章節、出發' : Net.meReady ? '已準備，等其他人' : Net.role === 'host' ? '選章、準備' : '準備：選起始晶片', term: z.id === 'coop' ? '開房間或加入朋友的房間' : `用${SHIPS[Hub.shipId].name}＋${WEAPONS[Hub.weaponId].name}進靶場` }[z.kind];
      body = `<div class="ttl" style="color:${z.color}">${z.label}</div><div class="hub-press"><b>E</b> ${what}</div>`;
    }
    el.innerHTML = body; el.classList.add('on');
  },
  // 有幾樣「新」：門 = 那個面板的種類，停機坪 = 那艘船
  hubNew(z, seen = unlockSeen()) {
    const P = BASE_PANELS.find(p => p.id === z.tab);
    const list = z.kind === 'pad' ? [unlockEntry('ship', z.ship)] : z.kind === 'rack' ? [unlockEntry('weapon', z.weapon)] : P ? UNLOCKS.filter(u => P.kinds.includes(u.kind)) : [];
    return list.filter(u => u && unlockIsNew(u, seen)).length;
  },

  // ---------- 門後的面板、發射台 ----------
  basePanel(id) {
    const T = BASE_PANELS.find(p => p.id === id) || BASE_PANELS[0], P = unlockLoad();
    const seen = unlockSeen(), fresh = new Set(UNLOCKS.filter(u => unlockIsNew(u, seen)).map(u => u.kind + ':' + u.id));
    this.show(`<div class="scr base${T.id === 'launch' ? ' compact' : ''}">
      <div class="between"><h2>${T.label}</h2><button data-act="hub" data-back>回到基地 (Esc)</button></div>
      <div class="base-body">${this['base_' + T.id](P, fresh)}</div></div>`);
    unlockMarkSeen(UNLOCKS.filter(u => T.kinds.includes(u.kind)));  // 打開這個面板 = 這幾類的新東西看過了
  },
  newTag(fresh, kind, id) { return fresh.has(kind + ':' + id) ? '<i class="new">新</i>' : ''; },

  // 發射台：選章（沒解鎖的灰掉），出發 → 選武器 → 起始晶片；多人 = 房主選好的章，準備 → 選武器 → 起始晶片 → 等隊友
  base_launch() {
    const S = SHIPS[Hub.shipId], done = chapterProgress();
    if (Hub.coop()) {  // 多人：房主選章（所有人都解鎖的才能選），每個人準備
      const C = chapterById(Net.chapter), P = Net.myPick;
      return `<div class="hg-launch"><div class="ty">${this.loadoutLine()}　·　章節：<b>${C.name}</b>${Net.role === 'host' ? '' : '（房主選的）'}</div>
        ${Net.role === 'host' ? `<div class="hg-chs">${Net.chapterButtons()}</div>` : ''}
        <div class="ds">${C.intro}</div>
        <div class="row hg-go">${Net.meReady && P ? `<span class="ok">✓ 已準備：${SHIPS[P.ship].name} ＋ ${WEAPONS[P.weapon].name} ＋ ${P.chip ? CHIPS[P.chip].name : '無起始晶片'}，等其他人</span>`
          : '<button class="big" data-act="depart">👥 準備：選起始晶片（Enter）</button>'}</div></div>`;
    }
    const ch = chapterById(Hub.chapter());
    const chs = CHAPTERS.map(c => {
      const ok = chapterUnlocked(c.id);
      return `<button class="hg-ch${c.id === ch.id ? ' on' : ''}" data-act="basech" data-arg="${c.id}"${ok ? '' : ` disabled title="通關「${chapterById(c.id - 1).name}」後解鎖"`}>${ok ? '' : '🔒 '}${c.name}${done.includes(c.id) ? ' <b class="ok">✓</b>' : ''}</button>`;
    }).join('');
    const bosses = Object.values(ch.bosses).map(b => `<span style="color:${ENEMY_TYPES[b].color};white-space:nowrap">♛ ${ENEMY_TYPES[b].name}</span>`).join('　');
    return `<div class="hg-launch">
      <div class="ty">${this.loadoutLine()}</div>
      <div class="hg-chs">${chs}</div>
      <div class="ty">星區 ${ch.sectors[0]}～${ch.sectors[1]}${ch.hp !== 1 ? `　·　敵人血量 ×${ch.hp}、受到的傷害 ×${ch.dmg}` : ''}　·　${bosses}${ch.start ? `<br><span style="color:#ffd166">開局補償：◆${ch.start.credits}、武器插座 +${ch.start.wSock}、電路 +${ch.start.slots}、三選一 ×${ch.start.picks}</span>` : ''}</div>
      <div class="ds">${ch.intro}</div>
      <div class="row hg-go"><button class="big" data-act="depart">🚀 出發（Enter）</button></div></div>`;
  },
  // 發射台上寫的配裝：飛船、武器（都在基地裡換）
  loadoutLine() {
    const S = SHIPS[Hub.shipId], W = WEAPONS[Hub.weaponId];
    return `飛船 <b style="color:${S.color}">${S.name}</b>（停機坪換）　·　武器 <b style="color:${W.color}">${W.name}</b>（武器架換）`;
  },
  // 出發：用基地開的飛船、裝的武器、發射台選的章 → 起始晶片（多人：章是房主選的，選完起始晶片就等隊友）
  depart() {
    if (!isUnlocked('ship', Hub.shipId) || !isUnlocked('weapon', Hub.weaponId)) return;
    if (Hub.coop()) { if (!Net.meReady) this.chipPick('coop', Hub.shipId, Hub.weaponId); return; }
    Game.chapterId = Hub.chapter();
    this.chipPick('run', Hub.shipId, Hub.weaponId);
  },

  // ---------- 軍械庫：5 把武器的說明、數值、升級路線 ----------
  base_armory(P, fresh) {
    const cards = Object.entries(WEAPONS).map(([id, W]) => {
      if (!isUnlocked('weapon', id)) return this.lockedCard(W.name, W.color, unlockEntry('weapon', id));
      return `<div class="card" style="border-color:${W.color}">${this.newTag(fresh, 'weapon', id)}${weaponCardBody(id)}
        <div class="ty">用它打倒旗艦 ${P.bossW[id] || 0} 次</div></div>`;
    }).join('');
    return `<div class="cards left">${cards}</div>`;
  },

  // ---------- 晶片庫：玩法晶片、組件、觸發器 ----------
  base_chips(P, fresh) {
    return UNLOCK_KINDS.filter(([k]) => BASE_PANELS[1].kinds.includes(k)).map(([kind, label]) => {
      const ids = unlockIds(kind), cards = ids.map(id => {
        if (!isUnlocked(kind, id)) return this.lockedCard(CHIPS[id].name, TYPE_META[CHIPS[id].type].color, unlockEntry(kind, id));
        const kills = kind === 'play' ? `<div class="ty">累計玩法擊殺 ${(P.play[id] || 0).toLocaleString('zh-TW')}</div>` : '';
        return chipCard(id, kills + this.newTag(fresh, kind, id));
      }).join('');
      return `<h3>${label}<span class="ty">　${ids.filter(id => isUnlocked(kind, id)).length} / ${ids.length}</span></h3><div class="cards left">${cards}</div>`;
    }).join('');
  },

  // ---------- 戰績：累計、章節、旗艦、玩法擊殺排行、遊玩紀錄 ----------
  base_stats(P) {
    const done = chapterProgress(), row = (k, v) => `<div class="st-row"><span>${k}</span><b>${v}</b></div>`;
    const chs = CHAPTERS.map(c => `<div class="st-row"><span>${c.name}</span><b class="${done.includes(c.id) ? 'ok' : ''}">${done.includes(c.id) ? '✓ 已通關' : chapterUnlocked(c.id) ? '還沒通關' : '🔒 未解鎖'}</b></div>`).join('');
    const bosses = Object.entries(ENEMY_TYPES).filter(([, t]) => t.boss).map(([id, t]) => `<div class="st-row"><span style="color:${t.color}">♛ ${t.name}</span><b>${P.boss[id] || 0} 次</b></div>`).join('');
    const top = Object.entries(P.play).filter(([id, n]) => CHIPS[id] && n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10), max = top.length ? top[0][1] : 1;
    const rank = top.map(([id, n]) => `<div class="st-bar"><span>${CHIPS[id].name}</span><div><div style="width:${Math.round(n / max * 100)}%"></div></div><b>${n.toLocaleString('zh-TW')}</b></div>`).join('') || '<div class="ty">還沒有玩法擊殺</div>';
    return `<div class="st-grid">
        <div class="st-box"><h3>累計</h3>${row('完成', P.runs + ' 局')}${row('擊殺', P.kills.toLocaleString('zh-TW'))}${row('打倒精英', P.elites)}${row('回響擊殺', P.echoK.toLocaleString('zh-TW'))}${row('最遠', P.sector ? '第 ' + P.sector + ' 星區' : '—')}</div>
        <div class="st-box"><h3>章節</h3>${chs}</div>
        <div class="st-box"><h3>打倒旗艦</h3>${bosses}</div>
        <div class="st-box st-wide"><h3>玩法擊殺排行（前 10）</h3>${rank}</div>
      </div>
      <div class="row"><button data-act="records">📜 所有遊玩紀錄</button></div>`;
  },
});
