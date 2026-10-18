// 星環電路 多人版 · base.js：主畫面「基地」（局外成長的共同畫面）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html（接在 screens.js 後面，往 Screen 加方法）
//   上方：遊戲名稱、總覽列（解鎖幾樣、累計成績）、系統按鈕；分頁：機庫（選飛船、選章、出發）、軍械庫、晶片庫、戰績
//   「新」標記：解鎖了、還沒在基地看過的（unlockIsNew）；打開那個分頁就算看過
'use strict';

// 分頁：每頁顯示哪幾類解鎖（「新」標記照這個算）
const BASE_TABS = [
  { id: 'hangar', label: '🚀 機庫', kinds: ['ship'] },
  { id: 'armory', label: '⚔ 軍械庫', kinds: ['weapon'] },
  { id: 'chips', label: '◈ 晶片庫', kinds: ['play', 'comp', 'trigger'] },
  { id: 'stats', label: '🏆 戰績', kinds: [] },
];

Object.assign(Screen, {
  baseTab: 'hangar',
  hgShip: null,  // 機庫選中的飛船

  // 主畫面（基地）：tab = 打開哪一頁（不給 = 上次那頁）
  title(tab = this.baseTab) {
    const T = BASE_TABS.find(t => t.id === tab) || BASE_TABS[0];
    this.baseTab = T.id;
    const P = unlockLoad();
    const all = UNLOCK_KINDS.flatMap(([k]) => unlockIds(k).map(id => unlockEntry(k, id)));
    const got = all.filter(u => !u || unlockDone().has(u)).length;
    const seen = unlockSeen(), fresh = new Set(UNLOCKS.filter(u => unlockIsNew(u, seen)).map(u => u.kind + ':' + u.id));
    const tabs = BASE_TABS.map(t => {
      const n = UNLOCKS.filter(u => t.kinds.includes(u.kind) && fresh.has(u.kind + ':' + u.id)).length;
      return `<button class="base-tab${t === T ? ' on' : ''}" data-act="base" data-arg="${t.id}">${t.label}${n ? `<i class="new">${n}</i>` : ''}</button>`;
    }).join('');
    this.show(`<div class="scr base">
      <div class="base-top">
        <div class="base-logo"><h1>星環電路</h1><span class="en">CIRCUIT ROGUE</span></div>
        <div class="base-sys">${this.refreshBtn()}<button data-act="codex">📖 電路總覽</button>
          <button data-act="music">${Music.on ? '🎵 音樂開' : '<span class="slash">🎵</span> 音樂關'}</button>
          <button data-act="mute">${SFX.muted ? '🔇 音效關' : '🔊 音效開'}</button></div>
      </div>
      <div class="ulk-tiles"><span>解鎖 <b>${got} / ${all.length}</b></span><span>完成 <b>${P.runs}</b> 局</span><span>擊殺 <b>${P.kills.toLocaleString('zh-TW')}</b></span><span>最遠 <b>第 ${P.sector || '—'} 星區</b></span></div>
      ${this.unlockFreshHtml(false)}
      <div class="base-tabs">${tabs}</div>
      <div class="base-body">${this['base_' + T.id](P, fresh)}</div>
      <div class="ver">版本 ${CFG.VERSION}</div>
    </div>`);
    unlockMarkSeen(UNLOCKS.filter(u => T.kinds.includes(u.kind)));  // 打開這一頁 = 這頁的新東西看過了
    this.checkVersion();
    Game.unlockFresh = [];  // 新達成的解鎖在基地只顯示一次
  },
  newTag(fresh, kind, id) { return fresh.has(kind + ':' + id) ? '<i class="new">新</i>' : ''; },

  // ---------- 機庫：選飛船、選章、出發 ----------
  hgPick() {
    const id = this.hgShip || Game.shipId;
    return SHIPS[id] ? id : Object.keys(SHIPS)[0];
  },
  hgChapter() { return chapterUnlocked(Game.chapterId) ? Game.chapterId : CHAPTERS[0].id; },
  base_hangar(P, fresh) {
    const id = this.hgPick(), S = SHIPS[id], open = isUnlocked('ship', id), u = unlockEntry('ship', id);
    const slots = Object.entries(SHIPS).map(([k, T]) => {
      const ok = isUnlocked('ship', k);
      return `<button class="hg-slot${k === id ? ' on' : ''}${ok ? '' : ' locked'}" data-act="hgship" data-arg="${k}" style="--c:${T.color}">
        <img src="${shipIconURL(T)}" alt="${T.name}"><span>${ok ? '' : '🔒 '}${T.name}</span>${this.newTag(fresh, 'ship', k)}</button>`;
    }).join('');
    const parts = Object.entries(S.parts).map(([p, n]) => `${PARTS[p].name} ×${n}`).join('、') || '沒有';
    const st = u && !open ? unlockState(u, P) : null;
    const info = open
      ? `${shipStatLine(S)}<div class="hg-desc">${shipDescHtml(S)}</div><div class="ty">開局零件：${parts}</div>`
      : `<div class="ds">🔒 ${unlockNeed(u)}</div><div class="ulk-bar"><div style="width:${Math.round(st.cur / st.max * 100)}%"></div></div><div class="ty">${Math.floor(st.cur)} / ${st.max}　·　還沒解鎖，可以先在靶場試</div>`;
    const ch = chapterById(this.hgChapter()), done = chapterProgress();
    const chs = CHAPTERS.map(c => {
      const ok = chapterUnlocked(c.id);
      return `<button class="hg-ch${c.id === ch.id ? ' on' : ''}" data-act="basech" data-arg="${c.id}"${ok ? '' : ` disabled title="通關「${chapterById(c.id - 1).name}」後解鎖"`}>${ok ? '' : '🔒 '}${c.name}${done.includes(c.id) ? ' <b class="ok">✓</b>' : ''}</button>`;
    }).join('');
    const bosses = Object.entries(ch.bosses).map(([s, b]) => `<span style="color:${ENEMY_TYPES[b].color};white-space:nowrap">♛ ${ENEMY_TYPES[b].name}</span>`).join('　');
    return `<div class="hg-slots">${slots}</div>
      <div class="hg-main">
        <div class="hg-ship${open ? '' : ' locked'}" style="--c:${S.color}"><img src="${shipIconURL(S, 288)}" alt="${S.name}"></div>
        <div class="hg-info"><div class="ttl" style="color:${S.color}">${S.name}<span class="ty">${S.en}</span></div>${info}</div>
      </div>
      <div class="hg-launch">
        <div class="hg-chs">${chs}</div>
        <div class="ty">星區 ${ch.sectors[0]}～${ch.sectors[1]}${ch.hp !== 1 ? `　·　敵人血量 ×${ch.hp}、受到的傷害 ×${ch.dmg}` : ''}　·　${bosses}${ch.start ? `<br><span style="color:#ffd166">開局補償：◆${ch.start.credits}、武器插座 +${ch.start.wSock}、電路 +${ch.start.slots}、三選一 ×${ch.start.picks}</span>` : ''}</div>
        <div class="ds">${ch.intro}</div>
        <div class="row hg-go"><button class="big" data-act="depart"${open ? '' : ' disabled'}>🚀 出發（Enter）</button>
          <button class="big" data-act="hgrange">🎯 靶場</button>
          <button class="big" data-act="coop" style="border-color:#ff9dbd;color:#ff9dbd">👥 多人連線（測試）</button></div>
        <div class="keys">WASD 移動　·　滑鼠左鍵 射擊　·　Space / 右鍵 衝刺（無敵）　·　Tab 隨時編輯電路（暫停）　·　M 靜音</div>
      </div>`;
  },
  // 出發：用機庫選的飛船、章節 → 選武器 → 起始晶片
  depart() {
    const id = this.hgPick();
    if (!isUnlocked('ship', id)) return;
    Game.chapterId = this.hgChapter();
    this.weaponSelect('run', id);
  },

  // ---------- 軍械庫：5 把武器的說明、數值、升級路線 ----------
  base_armory(P, fresh) {
    const cards = Object.entries(WEAPONS).map(([id, W]) => {
      if (!isUnlocked('weapon', id)) return this.lockedCard(W.name, W.color, unlockEntry('weapon', id));
      const kills = P.bossW[id] || 0;
      return `<div class="card" style="border-color:${W.color}">${this.newTag(fresh, 'weapon', id)}${weaponCardBody(id)}
        <div class="ty">用它打倒旗艦 ${kills} 次</div></div>`;
    }).join('');
    return `<div class="cards left full">${cards}</div>`;
  },

  // ---------- 晶片庫：玩法晶片、組件、觸發器 ----------
  base_chips(P, fresh) {
    return UNLOCK_KINDS.filter(([k]) => BASE_TABS[2].kinds.includes(k)).map(([kind, label]) => {
      const ids = unlockIds(kind), cards = ids.map(id => {
        if (!isUnlocked(kind, id)) return this.lockedCard(CHIPS[id].name, TYPE_META[CHIPS[id].type].color, unlockEntry(kind, id));
        const kills = kind === 'play' ? `<div class="ty">累計玩法擊殺 ${(P.play[id] || 0).toLocaleString('zh-TW')}</div>` : '';
        return chipCard(id, kills + this.newTag(fresh, kind, id));
      }).join('');
      return `<h3>${label}<span class="ty">　${ids.filter(id => isUnlocked(kind, id)).length} / ${ids.length}</span></h3><div class="cards left">${cards}</div>`;
    }).join('');
  },

  // ---------- 戰績：章節、旗艦、玩法擊殺排行、遊玩紀錄 ----------
  base_stats(P) {
    const done = chapterProgress();
    const chs = CHAPTERS.map(c => `<div class="st-row"><span>${c.name}</span><b class="${done.includes(c.id) ? 'ok' : ''}">${done.includes(c.id) ? '✓ 已通關' : chapterUnlocked(c.id) ? '還沒通關' : '🔒 未解鎖'}</b></div>`).join('');
    const bosses = Object.entries(ENEMY_TYPES).filter(([, t]) => t.boss).map(([id, t]) => `<div class="st-row"><span style="color:${t.color}">♛ ${t.name}</span><b>${P.boss[id] || 0} 次</b></div>`).join('');
    const top = Object.entries(P.play).filter(([id, n]) => CHIPS[id] && n > 0).sort((a, b) => b[1] - a[1]).slice(0, 10), max = top.length ? top[0][1] : 1;
    const rank = top.map(([id, n]) => `<div class="st-bar"><span>${CHIPS[id].name}</span><div><div style="width:${Math.round(n / max * 100)}%"></div></div><b>${n.toLocaleString('zh-TW')}</b></div>`).join('') || '<div class="ty">還沒有玩法擊殺</div>';
    const row = (k, v) => `<div class="st-row"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="st-grid">
        <div class="st-box"><h3>累計</h3>${row('完成', P.runs + ' 局')}${row('擊殺', P.kills.toLocaleString('zh-TW'))}${row('打倒精英', P.elites)}${row('回響擊殺', P.echoK.toLocaleString('zh-TW'))}${row('最遠', P.sector ? '第 ' + P.sector + ' 星區' : '—')}</div>
        <div class="st-box"><h3>章節</h3>${chs}</div>
        <div class="st-box"><h3>打倒旗艦</h3>${bosses}</div>
        <div class="st-box st-wide"><h3>玩法擊殺排行（前 10）</h3>${rank}</div>
      </div>
      <div class="row"><button data-act="records">📜 所有遊玩紀錄</button></div>`;
  },
});
