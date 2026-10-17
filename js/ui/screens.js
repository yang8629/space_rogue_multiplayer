// 星環電路 雙人版 · screens.js：DOM 畫面：標題、選飛船／武器／晶片、航圖、獎勵、商店、結算、紀錄
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SCREENS — DOM 畫面（標題 / 航圖 / 獎勵 / 商店 / 結算）
// =====================================================================
// 卡片的大類（三選一好分辨）：晶片（玩法晶片、觸發器）青藍、組件金、機體強化（零件）銀白
const CARD_CAT = { chip: '晶片', comp: '組件', mech: '機體強化' };
const catBand = k => `<div class="cat">${CARD_CAT[k]}</div>`;

function chipCard(id, footer = '') {
  const d = CHIPS[id], m = TYPE_META[d.type], cat = isComp(id) ? 'comp' : 'chip', r = rareOf(id);
  const ps = d.stored ? `<div class="ps">倉庫被動：${Object.entries(d.stored).map(([k, v]) => PASSIVE_LABEL[k](v)).join('、')}</div>` : '';
  const lv = LV_INFO[baseOf(id)] ? `<div class="ty" style="line-height:1.6">${lvLine(baseOf(id), 1)}<br>每插 1 個組件升 ${CFG.LV_PER_COMP} 級</div>` : '';  // 卡片上的晶片還沒插組件，一律 Lv1
  const sk = isHost(id) && id !== 'weapon' && socketsOf(id) ? ' sk' + socketsOf(id) : '';  // 插座數 = 稀有度：框色 1 灰、2 藍、3 紫
  // 稀有晶片：金色色帶、金框流光，名稱下面一行詞條（框色改金色，插座數看 ◇ 那行）
  const band = r ? '<div class="cat rareband">★ 稀有晶片</div>' : catBand(cat), rl = r ? `<div class="rareln">★ ${rareTxt(r)}</div>` : '';
  return `<div class="card cat-${cat}${sk}${r ? ' rare' : ''}">${band}
    <div class="ty" style="color:${m.color}">${m.icon} ${m.label} · ⚡${d.cost}</div>
    <div class="ttl">${d.name}</div>${rl}
    ${sockLine(id)}
    <div class="ds brief">${chipBrief(id)}</div>
    <div class="det"><div class="ds">${d.desc}</div>${lv}${ps}</div>${footer}</div>`;
}
// 三選一的標題（種類見 CFG.REWARDS）
const REWARD_TITLE = {
  start: () => `🚀 出發準備：三選一（還有 ${Game.bonusPicks} 次）`,
  combat: () => '⚔ 戰鬥勝利：三選一（晶片或零件）',
  elite: () => '☠ 精英擊破：三選一（或電路擴充）',
  boss: () => '♛ 旗艦擊沉：三選一（選完再領旗艦獎勵）',
  event: () => '? 事件：三選一（晶片或零件）',
  eventPart: () => '⚖ 黑市：零件三選一',
};
const REVEAL_MS = 1600;  // 揭曉動畫：有稀有晶片時，其他卡先翻開，稀有那格醞釀到這時候才翻開
// 稀有版本、身上已經有這個晶片：身上那個變稀有。已有不同詞條時兩個按鈕：替換（新詞條從 1 級）／增強（原本的 +1 級）
function rareButtons(id, wait) {
  const o = Game.ownedChip(baseOf(id)), old = o.arr[o.i], r0 = rareOf(old), r1 = rareOf(id), off = wait ? 'disabled' : '';
  const where = `${o.arr === Game.chain ? `電路第 ${o.i + 1} 格` : '倉庫'}的${CHIPS[baseOf(id)].name}`, sk = Math.max(socketsOf(old), socketsOf(id));
  const note = `<div class="ty rareln">${where}變稀有（插座 ${sk} 個，組件不動）</div>`;
  const btn = (mode, txt, dis) => `<button ${off || dis ? 'disabled' : ''} data-act="reward" data-arg="${id}|${mode}">${txt}</button>`;
  const up = r => mergeRare(r0, r1, r);
  if (!r0) return note + btn('boost', `選擇：${RARE[r1.k].name} Lv${r1.lv}`);
  if (r0.k === r1.k) return note + btn('boost', r0.lv >= RARE_MAX_LV ? '詞條已滿級' : `增強：${RARE[r0.k].name} Lv${r0.lv} → Lv${up('boost').lv}`, r0.lv >= RARE_MAX_LV);
  return note + btn('replace', `替換：${RARE[r0.k].name} → ${RARE[r1.k].name} Lv1`)
    + btn('boost', r0.lv >= RARE_MAX_LV ? `${RARE[r0.k].name}已滿級` : `增強：${RARE[r0.k].name} Lv${r0.lv} → Lv${up('boost').lv}`, r0.lv >= RARE_MAX_LV);
}
// 插座說明：宿主顯示插座數與產物；組件顯示「插在左邊的晶片上」
function sockLine(id) {
  if (isComp(id)) return '<div class="ty sockln">◆ 組件：拖進武器、玩法晶片或觸發器的插座（不佔電路格）</div>';
  if (!isHost(id) || id === 'weapon') return '';
  const n = socketsOf(id), P = HOST_PRODUCT[baseOf(id)] || '';
  // 產物（插在上面的組件作用在哪裡）縮起來時也顯示：選晶片時常常要看
  return `<div class="ty sockln">${n ? '◇'.repeat(n) + ` 插座 ${n} 個` : '插座數：掉落時決定（1～3）'}${P ? `<br>產物：${P}` : ''}</div>`;
}

// 零件卡片：名稱＋層數（圓點，4 層開滿）、每層效果（圖示）、2／4 層特性（已開啟的亮起來）
function partCard(id, footer = '', parts = Game.parts, band = false) {
  const P = PARTS[id], n = (parts && parts[id]) || 0;
  const pips = `<span class="pips" style="color:${P.color}">${'●'.repeat(Math.min(n, 4))}${'○'.repeat(Math.max(0, 4 - n))}${n > 4 ? '+' + (n - 4) : ''}　${n} 層</span>`;
  const tr = (t, need) => `<div class="trl${n >= need ? ' on' : ''}"><b style="color:${n >= need ? '#9dff6b' : P.color}">${need} 層　${t.name}</b>${t.desc}</div>`;
  return `<div class="card cat-mech">${band ? catBand('mech') : ''}
    <div class="ttl between">${P.name}${pips}</div>
    <div class="fxl">${partLine(id)}</div>${tr(P.t2, 2)}${tr(P.t4, 4)}${footer}</div>`;
}

const Screen = {
  el: document.getElementById('screen'),
  show(html) {
    // 有卡片的畫面：卡片只顯示精簡說明，按 Shift（手機按「詳細」）切換完整說明
    if (html.includes('class="card')) html += '<div class="detail-hint">按 Shift 切換詳細說明　<button data-act="detail">詳細</button></div>';
    this.el.innerHTML = html; this.el.classList.remove('hidden');
  },
  hide() {
    this.el.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();  // 避免 Space/Enter 再次觸發按鈕
  },
  status() {
    const p = Game.player;
    return `<div class="row"><span class="pill">${statIcon('hp')}${Math.ceil(p.hp)} / ${p.maxHp}</span>
      <span class="pill gold" data-credits>◆ ${Game.credits}</span>${Game.mode === 'coop' ? '<span class="pill" style="color:#ff9dbd" title="怪物掉落的晶體每人都拿；其他收入與花費各自計算">👥 各自的錢包</span>' : ''}
      <span class="pill" title="零件已用／零件格">${statIcon('slots')}零件 ${partsUsed(Game.parts)} / ${Game.partSlots}</span>
      ${Game.boons && Game.boons.ward ? `<span class="pill" style="color:${EVENTS.ward.color}" title="終焉護殼：受到致命傷害時留 1 HP">${EVENTS.ward.icon} 免死 ${Game.boons.ward}</span>` : ''}
      <button data-act="editor">整理電路 (Tab)</button></div>`;
  },
  // 所有畫面按鈕用 data-act 委派，不使用 inline onclick
  act(btn) {
    const a = btn.dataset.act, arg = btn.dataset.arg;
    if (btn.disabled) return;
    if (performance.now() < (this.clickLock || 0)) return;  // 戰鬥剛結束（見 Game.combatWon）
    SFX.init();
    SFX.play('click');
    switch (a) {
      case 'mute': SFX.setMuted(!SFX.muted); break;
      case 'detail': document.body.classList.toggle('detail'); break;
      case 'codex': Codex.open('rules'); break;
      case 'run': this.restart(); break;
      case 'editor': Game.toggleEditor(); break;
      case 'reward': { const [id, mode] = (arg || '').split('|'); Game.takeReward(id || null, mode || 'boost'); break; }  // 稀有版本：id|replace 替換／id|boost 增強
      case 'reroll': Game.rerollReward(); break;
      case 'buy': Game.buy(+arg); break;
      case 'leave': Game.showMap(); break;
      case 'node': if (Game.mode === 'coop') Net.vote(arg); else Game.enterNode(Game.nodeById(arg)); break;
      case 'resume': Game.togglePauseMenu(false); break;
      case 'quitrun': Game.quitRun(); break;
      case 'title': Net.leave(); Game.mates = []; Game.state = 'title'; Game.inArena = false; Screen.title(); break;
      case 'chapters': Screen.chapterSelect(); break;
      case 'chapter': if (chapterUnlocked(+arg)) { Game.chapterId = +arg; Screen.select('run'); } break;
      case 'select': Screen.select(arg); break;
      case 'ship': { const [mode, ship] = arg.split(':'); Screen.weaponSelect(mode, ship); break; }
      case 'weapon': {
        const [mode, ship, wid] = arg.split(':');
        if (mode === 'sandbox' || mode === 'range') Game.newRun(mode, ship, wid); else this.chipPick(mode, ship, wid);
        break;
      }
      case 'startchip': {  // 開局三選一晶片選好了
        const [mode, ship, wid, chip] = arg.split(':');
        if (mode === 'coop') Net.ready(ship, wid, chip); else Game.newRun(mode, ship, wid, chip);
        break;
      }
      case 'coop': Net.lobby(); break;
      case 'nethost': Net.host(); break;
      case 'netjoin': Net.join(document.getElementById('netCode').value); break;
      case 'netstart': Net.beginPick(); break;
      case 'netchapter': Net.setChapter(+arg); break;
      case 'netroom': Net.backToRoom(); break;
      case 'netrejoin': Net.tryRejoin(); break;
      case 'netgiveup': Net.giveUp(); break;
      case 'netsolo': Net.soloContinue(); break;
      case 'upg': Game.upgradeWeapon(arg); break;
      case 'armorybonus': Game.armoryBonus(); break;
      case 'slot': Game.expandSlot(arg); break;
      case 'bhpick': Game.bhToggle(arg); break;
      case 'evopt': Game.evChoose(+arg); break;
      case 'evnext': Game.evNext(); break;
      case 'bhfuse': Game.bhFuse(); break;
      case 'bossslot': Game.pickBossSlot(arg); break;
      case 'next': {
        const V = Game.victory;
        if (V && !V.pick) { this.victory(); break; }  // 二選一還沒選
        if (Net.modWaiting() && Game.coopOn()) { this.victory(); break; }  // 雙人：隊友還沒選好旗艦獎勵
        Game.nextSector();
        break;
      }
      case 'finish': Game.finishRun(); break;
      case 'records': Screen.records(); break;
      case 'refresh': Screen.hardRefresh(); break;
      case 'clearrec': Screen.records('', true); break;  // 先在畫面上確認一次
      case 'clearrecok':
        try { localStorage.removeItem(RECORDS_KEY); } catch (e) {}
        Screen.records('已刪除所有紀錄。');
        break;
      case 'copyrec': Screen.copyRecords(); break;
      case 'copyrun': Screen.copyRun(); break;
      case 'copyone': Screen.copyOne(+arg); break;
      case 'heal': Game.shopHeal(); break;
      case 'cap': Game.buyCap(); break;
      case 'wspick': Game.wsPick(arg); break;
      case 'wsfrom': Game.wsFrom(arg); break;
      case 'wsto': Game.wsTo(arg); break;
      case 'music': Music.toggle(); Screen.title(); break;
    }
  },

  // 開始遠征 → 先選章節（沒解鎖的灰掉、寫解鎖條件；通關過的打勾）
  chapterSelect() {
    const done = chapterProgress();
    const cards = CHAPTERS.map(c => {
      const open = chapterUnlocked(c.id), cleared = done.includes(c.id);
      const bosses = Object.entries(c.bosses).map(([s, id]) => `<span style="color:${ENEMY_TYPES[id].color};white-space:nowrap">♛ ${ENEMY_TYPES[id].name}</span>`).join('　');
      return `<div class="card" style="border-color:${open ? '#4cc9f0' : '#2a3460'};${open ? '' : 'opacity:.5'}">
        <div class="ttl">${c.name}${cleared ? ' <span style="color:#9dff6b">✓ 已通關</span>' : ''}</div>
        <div class="ty">星區 ${c.sectors[0]}～${c.sectors[1]}${c.hp !== 1 ? `　·　敵人血量 ×${c.hp}、受到的傷害 ×${c.dmg}` : ''}</div>
        <div class="ds">${open ? c.intro : `通關「${chapterById(c.id - 1).name}」後解鎖`}<br>${bosses}${c.start ? `<br><span style="color:#ffd166">開局補償：◆${c.start.credits}、武器插座 +${c.start.wSock}、電路 +${c.start.slots}、三選一 ×${c.start.picks}</span>` : ''}</div>
        <button data-act="chapter" data-arg="${c.id}" ${open ? '' : 'disabled'}>${open ? '選這章' : '未解鎖'}</button></div>`;
    }).join('');
    this.show(`<div class="scr pick">
      <div class="between"><div><h2>選擇章節</h2>
        <div class="sub">每章打一段星區，最後一個星區的旗艦擊沉就算通關，開啟下一章。打完可以繼續無盡模式。</div></div>
        <button data-act="title" data-back>返回 (Esc)</button></div>
      <div class="cards left">${cards}</div></div>`);
  },
  select(mode) {
    const free = mode === 'sandbox' || mode === 'range';
    const bar =(label, v, max, col) => `<div class="ty">${label}
      <div style="height:6px;background:#141c3a;border-radius:3px;margin-top:3px">
      <div style="height:6px;width:${Math.round(v / max * 100)}%;background:${col};border-radius:3px"></div></div></div>`;
    const cards = Object.entries(SHIPS).map(([id, S]) => {
      const pts = S.hull.map(([x, y]) => `${x},${y}`).join(' '), icon = shipIconURL(S);  // 飛船小圖跟戰鬥畫面同一個畫法（畫不出來才用多邊形）
      return `<div class="card" style="border-color:${S.color}">
        ${icon ? `<img src="${icon}" width="72" height="72" alt="${S.name}" style="margin:0 auto;display:block">` : `<svg viewBox="-26 -26 52 52" width="72" height="72" style="margin:0 auto;display:block;transform:rotate(-90deg)">
          <polygon points="${pts}" fill="${S.color}" fill-opacity=".3" stroke="${S.color}" stroke-width="2"/></svg>`}
        <div class="ttl" style="color:${S.color};text-align:center">${S.name}<span class="ty" style="margin-left:6px">${S.en}</span></div>
        ${shipStatLine(S)}
        ${shipDescHtml(S)}
        <button data-act="ship" data-arg="${mode}:${id}">選擇${S.name}</button></div>`;
    }).join('');
    this.show(`<div class="scr pick">
      <div class="between"><div><h2>1 / ${free ? 2 : 3}　選擇飛船</h2>
        <div class="sub">${{ run: '開始遠征', coop: '多人連線', sandbox: '沙盒模式', range: '🎯 靶場' }[mode]}：飛船是開局配置（帶哪些零件）加上專屬能力（相位跳躍、灰血、殘影、傳送門），之後的成長靠零件。下一步選武器${free ? '' : '，最後三選一起始晶片'}。</div></div>
        ${mode === 'coop' ? '<button data-act="title">離開房間</button>' : '<button data-act="title" data-back>返回 (Esc)</button>'}</div>
      <div class="cards left">${cards}</div></div>`);
  },

  weaponSelect(mode, shipId) {
    const S = SHIPS[shipId];
    const cards = Object.entries(WEAPONS).map(([id, W]) => {
      const p = weaponParams({ id, path: null, final: null });
      const dps = p.damage * p.count / p.interval;
      const paths = Object.values(W.paths).map(P =>
        `<div><b style="color:${W.color}">${P.name}</b>：${P.desc}<br><span style="color:#6a79ad">→ ${P.next.map(n => n.name).join(' ／ ')}</span></div>`).join('');
      return `<div class="card" style="border-color:${W.color}">
        <div class="ttl" style="color:${W.color}">${W.name}</div>
        <div class="ds brief">${WEAPON_BRIEF[id] || W.desc}</div>
        <div class="ty">單發 ${p.damage} × ${p.count}　·　每秒 ${(1 / p.interval).toFixed(1)} 次　·　基礎 DPS 約 ${Math.round(dps)}　·　擊退 ${p.knock}</div>
        <div class="det"><div class="ds">${W.desc}</div>
        <div class="ds" style="font-size:11px;display:grid;gap:6px">${paths}</div></div>
        <button data-act="weapon" data-arg="${mode}:${shipId}:${id}">使用${W.name}</button></div>`;
    }).join('');
    this.show(`<div class="scr pick">
      <div class="between"><div><h2>2 / ${mode === 'sandbox' || mode === 'range' ? 2 : 3}　選擇武器</h2>
        <div class="sub">飛船：<b style="color:${S.color}">${S.name}</b>。武器這一場固定不換，在「⚒ 軍械台」升級兩段：第一段 3 選 1，第二段 2 選 1。</div></div>
        <button data-act="select" data-arg="${mode}" data-back>返回 (Esc)</button></div>
      <div class="cards left">${cards}</div></div>`);
  },

  // 開局三選一起始晶片（遠征與雙人；取代以前飛船自帶的晶片）
  chipPick(mode, shipId, weaponId) {
    const S = SHIPS[shipId], W = WEAPONS[weaponId];
    const cards = pickN(NORMAL_IDS, 3).map(id =>
      chipCard(id, `<button data-act="startchip" data-arg="${mode}:${shipId}:${weaponId}:${id}">選這個</button>`)).join('');
    this.show(`<div class="scr pick">
      <div class="between"><div><h2>3 / 3　起始晶片（三選一）</h2>
        <div class="sub"><b style="color:${S.color}">${S.name}</b> ＋ <b style="color:${W.color}">${W.name}</b>。選好的晶片直接裝在電路第 2 格（武器右邊）；組件開局沒有插座可插，會放進倉庫。</div></div>
        <button data-act="ship" data-arg="${mode}:${shipId}" data-back>返回 (Esc)</button></div>
      <div class="cards">${cards}</div></div>`);
  },
  // 死亡畫面的「重新開始」：遠征要重新選起始晶片，沙盒直接開
  restart() {
    if (Game.mode === 'run') this.chipPick('run', Game.shipId, Game.weapon.id);
    else Game.newRun(Game.mode);
  },

  // 武器升級只能在軍械台（補給站不賣武器升級）
  armory() {
    const W = WEAPONS[Game.weapon.id], st = Game.weapon, stage = Game.weaponStage();
    let body;
    const card = (key, n, color) => `<div class="card" style="border-color:${color}">
      <div class="ttl" style="color:${color}">${n.name}</div><div class="ds">${n.desc}</div>
      ${n.next ? `<div class="ty">第二段可選（二選一）：</div>${n.next.map(x => `<div class="ds" style="margin-top:4px;padding-left:8px;border-left:2px solid ${color}55"><b style="color:${color}">${x.name}</b>：${x.desc}</div>`).join('')}` : ''}
      <button data-act="upg" data-arg="${key}">選擇</button></div>`;
    // 軍械台一律給武器升級；只有武器升滿之後，才可以改選「電路擴充」
    const canSlot = stage === 2 && Game.chain.length < CFG.MAX_SLOTS;
    const slotCard = canSlot ? `<div class="card" style="border-color:#2ee6a6">
      <div class="ttl" style="color:#2ee6a6">⊞ 電路擴充</div>
      <div class="ds">武器已升滿，改成電路插槽 +1（目前 ${Game.chain.length} 格，最多 ${CFG.MAX_SLOTS} 格）。</div>
      <button data-act="slot" data-arg="armory">選擇</button></div>` : '';
    if (stage === 2) {
      body = `<div class="sub" style="text-align:center;margin:20px 0">武器已經升滿兩段。</div>
        <div class="cards">${slotCard}</div>
        <div class="row" style="justify-content:center">
          <button class="big" data-act="armorybonus">改領 ◆ +${CFG.ARMORY_BONUS.credits}、HP +${CFG.ARMORY_BONUS.hp}</button></div>`;
    } else {
      const opts = stage === 0
        ? Object.entries(W.paths).map(([k, P]) => card(k, P, W.color)).join('')
        : W.paths[st.path].next.map((n, i) => card(i, n, W.color)).join('');
      body = `<div class="cards">${opts}</div>`;
    }
    this.show(`<div class="scr">
      <div class="between"><div><h2 style="color:#ff9f1c">⚒ 軍械台　${stage < 2 ? `第 ${stage + 1} 段升級` : ''}</h2>
        <div class="sub">目前武器：<b style="color:${W.color}">${weaponTitle(st)}</b></div></div>
        ${this.status()}</div>${body}</div>`);
  },

  // 改裝廠：零件三選一（只能拿 1 個）；付錢把 1 層零件換成另一種
  workshop() {
    const W = Game.ws, used = partsUsed(Game.parts), full = used >= Game.partSlots;
    const pick = W.options.map(id => partCard(id, W.picked ? '<button disabled>已經拿過了</button>'
      : `<button ${full ? 'disabled' : ''} data-act="wspick" data-arg="${id}">${full ? '零件格已滿' : '裝上這個'}</button>`)).join('');
    const owned = PART_IDS.filter(id => Game.parts[id] > 0);
    const swap = owned.length ? `<div class="sub" style="text-align:center">換零件（◆ ${Game.shopPrice(PART_SWAP_PRICE)}／次）：先選要拆掉的 1 層，再選要換成哪一種</div>
      <div class="row" style="justify-content:center">${owned.map(id => `<button data-act="wsfrom" data-arg="${id}" style="${W.from === id ? 'border-color:#ffd166;color:#ffd166' : ''}">拆 ${PARTS[id].name}（${Game.parts[id]} 層）</button>`).join('')}</div>
      ${W.from ? `<div class="row" style="justify-content:center">${PART_IDS.filter(id => id !== W.from).map(id => `<button ${Game.credits >= Game.shopPrice(PART_SWAP_PRICE) ? '' : 'disabled'} data-act="wsto" data-arg="${id}">→ ${PARTS[id].name}</button>`).join('')}</div>` : ''}`
      : '<div class="sub" style="text-align:center">目前沒有零件可以換。</div>';
    const T = Game.mech.traits, on = [...PART_IDS.flatMap(id => [PARTS[id].t2, PARTS[id].t4]).filter(t => T[t.id]).map(t => t.name), ...(T.balance ? ['均衡'] : [])];
    this.show(`<div class="scr">
      <div class="between"><div><h2 style="color:#9fe8ff">🔧 改裝廠</h2>
        <div class="sub">零件格 ${used} / ${Game.partSlots}。每層零件都是小好處＋小代價，同種疊到 2 層、4 層開啟特性；5 種都至少 1 層開啟「均衡」（好處 +30%）。
          ${on.length ? `<br>已開啟：<b style="color:#9dff6b">${on.join('、')}</b>` : ''}</div></div>${this.status()}</div>
      <div class="cards">${pick}</div>${swap}
      <div class="row" style="justify-content:center"><button data-act="leave">離開改裝廠</button></div>
      <div class="toast" style="text-align:center">${W.msg || ''}</div></div>`);
  },

  // ？事件：情境＋選項（EVENTS，data/events.js）
  event() {
    const V = Game.ev, E = V && EVENTS[V.id];
    if (!E) return;
    const btns = V.res ? `<div class="ev-res" style="color:${V.res.color}">${V.res.msg}</div><button class="big" data-act="evnext">繼續</button>`  // 賭運氣的結果
      : E.opts.map((o, i) => `<button class="${i === 0 ? 'big ' : ''}ev-opt" data-act="evopt" data-arg="${i}" ${o.can && !o.can(Game, V.node) ? 'disabled' : ''}>${o.txt(Game, V.node)}</button>`).join('');
    this.show(`<div class="scr">
      <div class="between"><div><h2 style="color:${E.color}">${E.icon} ${E.name}</h2><div class="sub">? 事件</div></div>${this.status()}</div>
      <div class="ev-text" style="border-color:${E.color}">${E.text(Game, V.node)}</div>
      <div class="ev-opts">${btns}</div>${this.boonLine()}</div>`);
  },
  // 這一局拿到的事件效果（事件畫面下方）
  boonLine() {
    const B = Game.boons || {}, t = [];
    if (B.ward) t.push(`${EVENTS.ward.icon} 終焉護殼：還能免死 ${B.ward} 次`);
    if (B.taken) t.push(`受到的傷害 +${Math.round(CFG.EVENT.ward.taken * B.taken * 100)}%`);
    if (B.hp) t.push(`最大 HP ×${+Math.pow(1 - CFG.EVENT.market.hpCut, B.hp).toFixed(2)}`);
    return t.length ? `<div class="sub" style="text-align:center;margin-top:10px">這一局的事件效果：${t.join('　·　')}</div>` : '';
  },

  blackhole() {
    const B = Game.bh, owned = Game.ownedFusable(), free = Game.bhFreeSlots(), A = Game.slotAttr || [];
    const attrTag = k => `<b style="color:${SLOT_ATTRS[k].good ? '#9dff6b' : '#ff6b6b'}" title="${SLOT_ATTRS[k].desc.replace(/<[^>]+>/g, '')}">${SLOT_ATTRS[k].name}</b>`;
    // 電路每一格目前的強化狀態
    const slots = Game.chain.map((id, i) => `<span class="bh-slot">${i + 1} ${id ? (i === 0 ? '武器' : CHIPS[id].short || CHIPS[id].name) : '空格'}　${A[i] ? attrTag(A[i]) : '<span style="color:#8fa3d9">未強化</span>'}</span>`).join('');
    let body;
    if (B.result && B.fusing) {
      body = `<div class="bh-core fusing"></div><div class="result" style="color:#b388ff">晶片正在被吞噬……</div>`;
    } else if (B.result) {
      const R = B.result, S = SLOT_ATTRS[R.attr];
      body = `<div class="result" style="color:${R.good ? '#9dff6b' : '#ff6b6b'}">
          ${R.good ? '✺ 強化成功' : '✖ 奇異點反噬'}：電路第 ${R.slot + 1} 格 → ${S.name}</div>
        <div class="sub" style="text-align:center">${S.desc}。屬性留在格子上，換晶片也還在。（投入：${R.chip}）${slotAttrLine(R.slot)}<br>電路編輯器（Tab）裡強化過的格子有綠框／紅框，滑鼠移上去看現在的效果。</div>
        <div class="sub bh-slots">${slots}</div>
        <div class="row" style="justify-content:center;margin-top:14px"><button class="big" data-act="leave">返回航圖</button></div>`;
    } else {
      const cards = owned.map(o => {
        const on = B.sel === o.key, odds = Math.round(bhGood(o.id) * 100);
        return chipCard(o.id, `<div class="ty">位置：${o.sock != null ? `插在${CHIPS[Game.chain[o.sock]].name}上` : o.arr === Game.chain ? '電路第 ' + (o.i + 1) + ' 格' : '倉庫第 ' + (o.i + 1) + ' 格'}　好結果 ${odds}%</div>
          <button data-act="bhpick" data-arg="${o.key}">${on ? '已選取（點擊取消）' : '投入這個'}</button>`)
          .replace('class="card', `class="card${on ? ' picked' : ''}`);
      }).join('');
      body = `<div class="bh-core"></div>
        <div class="sub" style="text-align:center">投入 1 個晶片（晶片會消失）：隨機一個<b>還沒強化過</b>的電路格（武器格也可能）得到一個屬性，每格只能強化一次。<br>
          好結果的機率看投入晶片的插座數：${bhOddsTxt()}。<br>
          好：${GOOD_ATTRS.map(attrTag).join('、')}<br>壞：${BAD_ATTRS.map(attrTag).join('、')}</div>
        <div class="sub bh-slots">${slots}</div>
        <div class="cards">${cards || '<div class="sub">目前沒有可投入的晶片。</div>'}</div>
        <div class="row" style="justify-content:center">
          <button class="big" data-act="bhfuse" ${B.sel && free.length ? '' : 'disabled'}>${free.length ? '投入奇異點' : '電路格都強化過了'}</button>
          <button data-act="leave">不冒險，離開</button></div>`;
    }
    this.show(`<div class="scr">
      <div class="between"><div><h2 style="color:#b388ff">◐ 奇異點</h2>
        <div class="sub">犧牲一個晶片，賭一個電路格的屬性。</div></div>${this.status()}</div>${body}</div>`);
  },

  title() {
    this.show(`<div class="scr title-wrap">
      <div class="refresh-corner">${this.refreshBtn()}</div>
      <h1>星環電路</h1><div class="en">CIRCUIT ROGUE</div>
      <div class="sub">組裝電路，疊出屬於你的彈幕</div>
      <div class="row">
        <button class="big" data-act="chapters">開始遠征</button>
        <button class="big" data-act="select" data-arg="range">🎯 靶場</button>
        <button class="big" data-act="coop" style="border-color:#ff9dbd;color:#ff9dbd">👥 多人連線（測試）</button>
      </div>
      <div class="row"><button data-act="codex">📖 電路總覽</button>
        <button data-act="records">📜 遊玩紀錄</button>
        <button data-act="music">${Music.on ? '🎵 音樂開' : '<span class="slash">🎵</span> 音樂關'}</button>
        <button data-act="mute">${SFX.muted ? '🔇 音效關' : '🔊 音效開'}</button></div>
      <div class="keys">電腦：WASD 移動　·　滑鼠左鍵 射擊　·　Space / 右鍵 衝刺（無敵）　·　Tab 隨時編輯電路（暫停）　·　M 靜音<br>
      手機：自動攻擊時任意位置拖曳移動；關閉自動攻擊後，左半邊移動、右半邊瞄準射擊　·　「衝刺」「電路」「自動」按鈕　·　建議橫向遊玩</div>
      <div class="ver">版本 ${CFG.VERSION}</div>
    </div>`);
    this.checkVersion();
  },
  // 清暫存重新整理：GitHub Pages 的檔案會被瀏覽器暫存，一般重新整理可能還是舊版
  //   開標題畫面時在背景抓一次最新的版號，跟目前的不一樣就讓按鈕亮起來
  refreshBtn() {  // 平常不顯示（只留位置），檢查到新版才出現
    return this.newVer
      ? `<button id="refreshBtn" class="glow" data-act="refresh">🔄 有新版 ${this.newVer}，按這裡更新</button>`
      : '<span id="refreshBtn"></span>';
  },
  checkVersion() {
    if (this.verChecked || typeof fetch !== 'function' || location.protocol === 'file:') return;  // 本機開檔、測試環境不檢查
    this.verChecked = true;
    fetch('js/core/config.js', { cache: 'no-store' }).then(r => r.text()).then(t => {
      const m = t.match(/VERSION: '([^']+)'/);
      if (!m || m[1] === CFG.VERSION) return;
      this.newVer = m[1];
      const b = document.getElementById('refreshBtn');
      if (b) b.outerHTML = this.refreshBtn();
    }).catch(() => {});
  },
  // 重新下載頁面、所有程式檔和樣式（不用暫存，順便更新瀏覽器的暫存），再重新載入；遊玩紀錄、設定存在本機儲存，不會被清掉
  async hardRefresh() {
    const b = document.getElementById('refreshBtn');
    if (b) { b.disabled = true; b.textContent = '更新中…'; }
    try {
      const urls = [location.pathname, ...[...document.querySelectorAll('script[src]')].map(x => x.getAttribute('src')),
        ...[...document.querySelectorAll('link[rel="stylesheet"]')].map(x => x.getAttribute('href'))];
      await Promise.all(urls.map(u => fetch(u, { cache: 'reload' }).catch(() => {})));
      if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
    } catch (e) { /* 抓不到也照樣重新載入 */ }
    location.reload();
  },

  map(toast = '') {
    const layers = Game.map, LN = layers.length, reach = Game.reachable();
    const pos = n => ({ x: 6 + n.L * 88 / (LN - 1), y: (n.k + 1) / (n.n + 1) * 100 });
    const coop = Game.mode === 'coop' && Net.linked, V = coop ? Net.votes : {};
    const marks = n => coop ? Object.keys(V).filter(s => V[s] === n.id).map(s => `<i class="vote v${s}">${s}P</i>`).join('') : '';
    let lines = '', nodes = '';
    for (const row of layers) for (const n of row) {
      const a = pos(n);
      for (const id of n.next) {
        const m = Game.nodeById(id), b = pos(m);
        const walked = Game.visited.includes(n.id) && Game.visited.includes(m.id);
        lines += `<line x1="${a.x}%" y1="${a.y}%" x2="${b.x}%" y2="${b.y}%" stroke="${walked ? '#4cc9f0' : '#26336a'}" stroke-width="${walked ? 3 : 2}"/>`;
      }
      const meta = NODE_META[n.type];
      const cls = ['node', reach.includes(n) && 'reach', Game.visited.includes(n.id) && 'visited', Game.node === n && 'current', n.hoard && 'hoard']
        .filter(Boolean).join(' ');
      nodes += `<button class="${cls}" ${reach.includes(n) ? `data-act="node" data-arg="${n.id}"` : ''} style="left:${a.x}%;top:${a.y}%;color:${meta.color};border-color:${meta.color}"
        title="${meta.label}：${meta.desc()}${n.hoard ? `
${HOARD_TXT}` : ''}">${meta.icon}<small>${meta.label}</small>${n.hoard ? '<i class="hoard-tag">✦ 寶藏</i>' : ''}${marks(n)}</button>`;
    }
    // 節點介紹：列出這張圖上有出現的節點種類
    const types = Object.keys(NODE_META).filter(t => layers.flat().some(n => n.type === t));
    const legend = types.map(t => { const M = NODE_META[t];
      return `<div class="nleg"><span class="nleg-ic" style="color:${M.color};border-color:${M.color}">${M.icon}</span><div><b style="color:${M.color}">${M.label}</b>　${M.desc()}</div></div>`; }).join('')
      + (layers.flat().some(n => n.hoard) ? `<div class="nleg"><span class="nleg-ic" style="color:#ffd166;border-color:#ffd166">✦</span><div><b style="color:#ffd166">寶藏星域</b>　${HOARD_TXT}</div></div>` : '');
    this.show(`<div class="scr">
      <div class="between"><div><h2>${Game.isEndless() ? `無盡模式 · 星區 ${Game.sector}` : `${Game.chapter().name} · 星區 ${Game.sector} / ${Game.lastSector()}`} · 航圖</h2>
        <div class="sub">選擇下一個發光的節點。最右側是守關旗艦：<b style="color:${ENEMY_TYPES[Game.bossId].color}">♛ ${ENEMY_TYPES[Game.bossId].name}</b></div></div>${this.status()}</div>
      ${coop ? (() => {
        const me = Net.mySlot(), others = Net.otherSlots(), left = Net.voteLeft();
        const who = s => (others.length > 1 ? `${s}P ` : '隊友');  // 只有一個隊友時照舊寫「隊友」
        const mateTxt = others.map(s => Net.atOf(s) !== 'map' ? `<span style="color:#ffd166">${who(s)}還在處理上一個節點…</span>` : V[s] ? `<b style="color:#9dff6b">${who(s)}已投票</b>` : `${who(s)}選擇中…`).join('　·　');
        return `<div class="sub" style="color:#ff9dbd">👥 投票（你是 <b style="color:${Game.slotColor(me)}">${me}P</b>）：${V[me] ? '你已投票，可以改投' : '點選一個發光的節點'}　·　${mateTxt}
          　·　<span id="voteTimer">${left != null ? `剩 ${left} 秒` : ''}</span>　·　${others.length > 1 ? '選不同就照票數比例抽籤' : '兩人選不同就各 50% 抽籤'}；時間到沒投的不算</div>`;
      })() : ''}
      <div class="map"><svg>${lines}</svg>${nodes}</div>
      ${Game.sos ? `<div class="sub" style="color:${EVENTS.sos.color}">⚠ 追兵：下一場一般戰鬥或精英戰敵人 +${Math.round((Game.sos.mul - 1) * 100)}%${(k => k ? `；${sosTxt(k).split('，').slice(1).join('，')}` : '')(Game.sosPay(Game.sos))}</div>` : ''}
      <div class="toast">${toast}</div>
      <details class="nlegs" open><summary>節點介紹</summary><div class="nleg-grid">${legend}</div></details></div>`);
  },

  reward() {
    const R = Game.reward, full = !Game.inventory.includes(null);
    if (!R) return;
    if (!R.options.some(rareOf)) R.revealed = true;  // 沒有稀有晶片：不演揭曉
    const slotCard = () => `<div class="card" style="border-color:#2ee6a6">
      <div class="ty" style="color:#2ee6a6">⊞ 電路擴充</div><div class="ttl">插槽 +1</div>
      <div class="ds">電路多一格（目前 ${Game.chain.length} 格，最多 ${CFG.MAX_SLOTS} 格）。適合晶片流。</div>
      <button data-act="slot" data-arg="reward">選擇</button></div>`;
    const cards = R.options.map((id, i) => {
      if (id.startsWith('part:')) {
        const k = id.slice(5), ok = partsUsed(Game.parts) < Game.partSlots;
        return partCard(k, `<button ${ok ? '' : 'disabled'} data-act="reward" data-arg="${id}">${ok ? '裝上' : '零件格已滿'}</button>`, Game.parts, true);  // 跟晶片混在一起：標「機體強化」
      }
      const wait = rareOf(id) && !R.revealed;  // 揭曉動畫：稀有那格最後才翻開，翻開前不能按
      const ok = Game.canAcquire(id) && !wait, label = Game.canAcquire(id) ? '選擇' : '倉庫已滿';
      const html = chipCard(id, rareOf(id) && Game.ownedChip(baseOf(id)) ? rareButtons(id, wait) : `<button ${ok ? '' : 'disabled'} data-act="reward" data-arg="${id}">${label}</button>`);
      return !R.revealed ? html.replace(/^<div class="card([^"]*)">/, (_, c) => wait ? `<div class="card${c} rare-wait"><div class="rare-veil">✦</div>` : `<div class="card${c} flipin" style="animation-delay:${i * 0.12}s">`)
        : rareOf(id) && !R.popped ? html.replace('class="card', 'class="card rare-pop') : html;
    }).join('') + (R.slot ? slotCard() : '');  // 有電路擴充卡的三選一（CFG.REWARDS 的 slotCard）
    if (!R.revealed) setTimeout(() => { if (Game.reward === R && Game.state === 'reward') { R.revealed = true; this.reward(); } }, REVEAL_MS);
    else R.popped = true;  // 翻開的動畫只播一次（之後重畫不再播）
    this.show(`<div class="scr">
      <div class="between"><div><h2>${REWARD_TITLE[R.kind]()}</h2>
        <div class="sub">${R.note ? `<span style="color:#ffd166">${R.note}</span><br>` : ''}獲得的晶片會放入倉庫，按 Tab 裝上電路。</div></div>${this.status()}</div>
      <div class="cards">${cards}</div>
      <div class="row" style="justify-content:center">
        ${full ? '<span class="sub">倉庫已滿：按 Tab 整理，把晶片拖到「回收」可換成晶體。</span>' : ''}
        <button data-act="reroll" ${Game.credits < R.reroll ? 'disabled' : ''}>刷新（◆ ${R.reroll}）</button>
        <button data-act="reward" data-arg="">跳過（◆ +10）</button></div></div>`);
  },

  shop(toast = '') {
    const full = !Game.inventory.includes(null);  // 補給站不賣武器升級；補血每間限 1 次
    const cards = Game.shop.items.map((it, i) => {
      const can = Game.canAcquire(it.id);
      const ok = !it.sold && Game.credits >= it.price && can;
      const label = it.sold ? '已售出' : !can ? '倉庫已滿'
        : `購買 ◆ ${it.price}`;
      return chipCard(it.id, `<button ${ok ? '' : 'disabled'} data-act="buy" data-arg="${i}">${label}</button>`)
        .replace('class="card', `class="card${it.sold ? ' sold' : ''}`);
    }).join('');
    this.show(`<div class="scr">
      <div class="between"><div><h2>◆ 補給站</h2><div class="sub">晶片會放入倉庫。不要的晶片可在電路編輯器拖到「回收」換成晶體。價格隨星區上漲（目前 ×${+Game.shopMul().toFixed(2)}）。</div></div>${this.status()}</div>
      <div class="cards">${cards}</div>
      <div class="row" style="justify-content:center">
        ${Game.shop.healed ? '<button disabled>已補血</button>'
          : `<button ${Game.credits >= Game.shopPrice(CFG.SHOP_REPAIR.price) && Game.player.hp < Game.player.maxHp ? '' : 'disabled'} data-act="heal">✚ 補血 HP +${Game.shopHealHp()}（最大 HP 的 ${CFG.SHOP_REPAIR.ratio * 100}%，◆ ${Game.shopPrice(CFG.SHOP_REPAIR.price)}，限 1 次）</button>`}
        ${!Game.shop.slotBought && Game.chain.length < CFG.MAX_SLOTS
          ? `<button ${Game.credits >= Game.shopPrice(CFG.SHOP_SLOT) ? '' : 'disabled'} data-act="slot" data-arg="shop">⊞ 電路擴充 插槽 +1（◆ ${Game.shopPrice(CFG.SHOP_SLOT)}，每間限 1 次）</button>` : ''}
        ${!Game.shop.capBought
          ? `<button ${Game.credits >= Game.shopPrice(CFG.SHOP_CAP) ? '' : 'disabled'} data-act="cap">⚡ 能量容量 +${CFG.CAP_SHOP_ADD}（目前 ${Game.energyCap()}，◆ ${Game.shopPrice(CFG.SHOP_CAP)}，每間限 1 次）</button>` : ''}
        <button data-act="leave">離開補給站</button></div>
      <div class="toast" style="text-align:center">${toast}</div></div>`);
  },

  // 結算：本局傷害總計（依來源拆開）＋ 擊殺、最高單發、戰鬥時間、平均 DPS
  runSummary() {
    const R = Game.runStats;
    if (!R) return '';
    const total = Object.values(R.dmg).reduce((a, b) => a + b, 0);
    const fmt = n => Math.round(n).toLocaleString('zh-TW');
    const mm = Math.floor(R.time / 60), ss = Math.floor(R.time % 60);
    const rows = DMG_SOURCES.filter(([k]) => R.dmg[k] > 0).sort((a, b) => R.dmg[b[0]] - R.dmg[a[0]]).map(([k, label, color]) => {
      const pct = total ? R.dmg[k] / total * 100 : 0;
      return `<div class="sum-lab"><i style="background:${color}"></i>${label}</div>
        <div class="sum-track"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <div class="sum-val">${fmt(R.dmg[k])}<span>${pct.toFixed(0)}%</span></div>`;
    }).join('');
    // 照晶片分（跟「晶片傷害統計」分頁一樣：武器、各晶片、機體）
    const chips = Object.entries(R.chips).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([k, v]) => {
      const pct = total ? v / total * 100 : 0, color = dmgKeyColor(k);
      return `<div class="sum-lab"><i style="background:${color}"></i>${dmgKeyName(k)}</div>
        <div class="sum-track"><div style="width:${pct.toFixed(1)}%;background:${color}"></div></div>
        <div class="sum-val">${fmt(v)}<span>${pct.toFixed(0)}%</span></div>`;
    }).join('');
    const tile = (k, v) => `<div class="sum-tile"><span>${k}</span><b>${v}</b></div>`;
    return `<div class="summary">
      <div class="sum-head"><span>${Game.mode === 'coop' ? '你的傷害明細' : '本局傷害總計'}</span><b>${fmt(total)}</b></div>
      ${chips ? `<div class="sum-sub">各晶片</div><div class="sum-rows">${chips}</div>` : ''}
      ${rows ? `<div class="sum-sub">傷害方式</div><div class="sum-rows">${rows}</div>` : '<div class="sub">這一局還沒有造成傷害。</div>'}
      <div class="sum-tiles">${tile('擊殺', fmt(R.kills))}${tile('最高單發', fmt(R.maxHit))}
        ${tile('戰鬥時間', `${mm}:${String(ss).padStart(2, '0')}`)}${tile('平均 DPS', R.time > 0 ? fmt(total / R.time) : '—')}</div>
      <div class="sum-note">武器：${weaponTitle(Game.weapon)}　·　飛船：${SHIPS[Game.shipId].name}</div></div>`;
  },

  // 戰鬥中按 Esc 的選單
  pauseMenu() {
    const coop = Game.mode === 'coop';
    this.show(`<div class="scr title-wrap">
      <h1>${coop ? '選單' : '暫停'}</h1>
      <div class="sub">${coop ? '多人模式不會暫停，隊友那邊照常進行。<br>' : ''}${Game.freePlay() ? '離開 = 回到標題。' : '離開遊戲 = 這一局中途結束（存入遊玩紀錄），顯示結算。'}</div>
      <div class="row"><button class="big" data-act="resume" data-back>繼續 (Esc)</button>
        <button class="big" data-act="quitrun">離開遊戲</button></div></div>`);
  },
  // 離開遊戲後的結算（跟死亡畫面一樣的統計，標題是「中途結束」）
  ended() {
    const rec = ['run', 'coop'].includes(Game.mode);
    const where = Game.mode === 'coop' ? Net.whereText() : Game.mode === 'run' ? Game.buildRecord('retired').where : `第 ${Game.combat ? Game.combat.wave : 0} 波`;
    this.show(`<div class="scr title-wrap">
      <h1 style="color:#8fa3d9;text-shadow:0 0 18px #8fa3d9">中途結束</h1>
      <div class="sub">結束在 ${where} · 剩餘晶體 ${Game.credits}${rec ? '<br><span style="color:#6a79ad">這一局已存入「遊玩紀錄」</span>' : ''}</div>
      ${Game.mode === 'coop' ? Net.teamSummaryHtml() : ''}
      ${this.runSummary()}
      <div class="row">${Game.mode !== 'coop' ? `<button class="big" data-act="run" data-arg="${Game.mode}">重新開始</button>` : ''}
        <button class="big" data-act="title">回到標題</button></div>
      ${rec ? '<div class="row" style="margin-top:0"><button data-act="copyrun">📋 複製這局紀錄</button><button data-act="records">📜 所有遊玩紀錄</button></div><div id="copyBox"></div>' : ''}</div>`);
  },
  dead() {
    const run = Game.mode === 'run';
    if (Game.mode === 'coop') {
      this.show(`<div class="scr title-wrap">
        <h1 style="color:#ff4d6d;text-shadow:0 0 18px #ff4d6d">${Game.mates.length > 1 ? '全機覆滅' : '雙機全毀'}</h1>
        <div class="sub">倒在 ${Net.whereText()} · 剩餘晶體 ${Game.credits}${Game.lastHit ? `<br>擊毀原因：${Game.lastHit}` : ''}<br>
          <span style="color:#6a79ad">這一局已存入「遊玩紀錄」（含連線延遲數據）</span></div>
        ${Net.teamSummaryHtml()}
        ${this.runSummary()}
        <div class="row">${Net.linked ? '<button class="big" data-act="netroom">回到房間</button>' : '<span class="sub" style="color:#ff4d6d">隊友已離線</span>'}
          <button data-act="title">離開房間</button></div>
        <div class="row" style="margin-top:0"><button data-act="copyrun">📋 複製這局紀錄</button><button data-act="records">📜 所有遊玩紀錄</button></div>
        <div id="copyBox"></div></div>`);
      return;
    }
    this.show(`<div class="scr title-wrap">
      <h1 style="color:#ff4d6d;text-shadow:0 0 18px #ff4d6d">飛船已毀</h1>
      <div class="sub">${run ? Game.buildRecord('dead').where : `抵達第 ${Game.combat.wave} 波`} · 剩餘晶體 ${Game.credits}
        ${run && Game.lastHit ? `<br>擊毀原因：${Game.lastHit}` : ''}${run ? '<br><span style="color:#6a79ad">這一局已存入「遊玩紀錄」</span>' : ''}</div>
      ${this.runSummary()}
      <div class="row"><button class="big" data-act="run" data-arg="${Game.mode}">重新開始 (R)</button>
      <button class="big" data-act="title">回到標題</button></div>
      ${run ? '<div class="row" style="margin-top:0"><button data-act="copyrun">📋 複製這局紀錄</button><button data-act="records">📜 所有遊玩紀錄</button></div><div id="copyBox"></div>' : ''}</div>`);
  },

  victory() {
    const V = Game.victory, boss = ENEMY_TYPES[V.boss || Game.bossId];
    const cleared = Game.chapterDone() && !Game.isEndless();  // 剛打完這章最後一個星區：章節完成
    const reward = `獎勵：◆ +50${!V.slot && V.pick ? '　· <b style="color:#9fe8ff">零件格 +1</b>（電路插槽已達上限）' : ''}${V.ws ? `　· <b style="color:#ffd166">武器插座 +1（${Game.wSock} 個）</b>` : ''}`;
    const wait = !Game.isClient() && Net.modWaiting() && Game.coopOn();  // 房主：隊友還沒選好旗艦獎勵
    // 二選一：電路插槽 +1（多一格放晶片）或零件格 +1（多疊一層零件）；電路已滿時直接給零件格
    const pk = (k, icon, name, note, col) => `<button class="big" data-act="bossslot" data-arg="${k}"${V.pick ? ' disabled' : ''} style="min-width:230px;line-height:1.5${V.pick === k ? `;opacity:1;border-color:${col};box-shadow:0 0 14px ${col}` : ''}"><b style="color:${col}">${icon} ${name}</b>${V.pick === k ? ' ✓' : ''}<br><small style="color:#8fa3d9">${note}</small></button>`;
    const pick = !V.slot || V.pick === 'lost' ? '' : `<div class="sub" style="margin-bottom:4px;color:${V.pick ? '#8fa3d9' : '#ffd166'}">${V.pick ? '已選好' : '二選一：'}</div><div class="row" style="margin-top:0">
      ${pk('chain', '⊞', '電路插槽 +1', `多一格放晶片（${V.pick === 'chain' ? '現在' : '目前'} ${Game.chain.length} 格）`, '#4cc9f0')}
      ${pk('part', '⚙', '零件格 +1', `多疊一層零件（${V.pick === 'part' ? '現在' : '目前'} ${Game.partSlots} 格，已用 ${partsUsed(Game.parts)}）`, '#9fe8ff')}</div>`;
    const head = cleared
      ? `<h1 style="color:#ffd166;text-shadow:0 0 18px #ffd166">${Game.chapter().name}　完成！</h1>
        <div class="sub">${boss.name}已被擊沉。<br><i style="color:#c8d4ff">${Game.chapter().outro}</i><br>${reward}<br>
          可以帶著目前的電路繼續挑戰<b style="color:#ff9dbd">無盡模式</b>：敵人持續變強，旗艦隨機出現。選「結束遠征」會存下通關紀錄。</div>`
      : `<h1>星區 ${Game.sector} 突破！</h1><div class="sub">${boss.name}已被擊沉。<br>${reward}</div>`;
    this.show(`<div class="scr title-wrap">${head}
      ${pick}
      ${Game.mode === 'coop' ? Net.teamSummaryHtml() : ''}
      ${this.runSummary()}
      ${Game.isClient() ? `<div class="sub" style="color:#ff9dbd">${!V.pick ? '👥 房主在等你：先選二選一的獎勵' : '👥 等待房主決定：前往下一星區，或結束遠征…'}</div>` : `
      ${!V.pick ? '<div class="sub" style="color:#ffd166">先選一個獎勵才能前往</div>' : ''}${wait ? '<div class="sub" style="color:#ff9dbd">👥 等隊友選好獎勵…</div>' : ''}
      <div class="row"><button class="big" data-act="next"${wait || !V.pick ? ' style="opacity:.45"' : ''}>${cleared ? '繼續無盡模式' : Game.isEndless() ? `前往星區 ${Game.sector + 1}（無盡）` : `前往星區 ${Game.sector + 1}`}</button>
        <button class="big" data-act="finish">結束遠征</button></div>`}
      <div class="row" style="margin-top:0"><button data-act="copyrun">📋 複製這局紀錄</button></div><div id="copyBox"></div></div>`);
  },

  records(msg = '', confirmClear = false) {
    const list = Game.loadRecords();
    const RES = { dead: ['飛船已毀', '#ff4d6d'], cleared: ['遠征完成', '#ffd166'], retired: ['中途結束', '#8fa3d9'], disconnect: ['連線中斷', '#ff9f1c'] };
    const fmt = n => Math.round(n).toLocaleString('zh-TW');
    const list2 = (title, items) => items && items.length ? `<div style="margin-top:6px"><b>${title}</b><br>${items.join('<br>')}</div>` : '';
    const rows = list.map((r, i) => {
      const [label, color] = RES[r.result] || [r.result, '#8fa3d9'];
      const top = (r.chipDmg || []).slice(0, 3).map(([n, v]) => `${n} ${r.dmg ? Math.round(v / r.dmg * 100) : 0}%`).join('、');
      const when = new Date(r.at).toLocaleString('zh-TW', { hour12: false });
      // 展開看細節：第 2 版紀錄才有的欄位（舊紀錄沒有就不顯示）
      const S = r.stats;
      const detail = [
        S ? `<div><b>最後的電路數值</b><br>插槽 ${S.slots}、能量 ⚡${S.heat}${S.cap != null ? ' / ' + S.cap : ''}${S.off != null ? (S.off ? `（沒電 ${S.off} 個）` : '') : `（射速 ${S.rateCut}）`}、每秒 ${S.rps} 發、每發 ${S.perFire} 顆共 ${S.fireDmg} 傷害、估算 DPS ${S.estDps}、擊退 ${S.knock}${S.passives.length ? `<br>倉庫被動：${S.passives.join('、')}` : ''}</div>` : '',
        list2('各晶片傷害', (r.chipDmg || []).map(([n, v]) => `${n}　${fmt(v)}（${r.dmg ? Math.round(v / r.dmg * 100) : 0}%）`)),
        r.coop && r.coop.mateChipDmg ? (() => {
          const t = r.coop.mateChipDmg.reduce((a, [, v]) => a + v, 0);
          return list2('隊友的各晶片傷害', r.coop.mateChipDmg.map(([n, v]) => `${n}　${fmt(v)}（${t ? Math.round(v / t * 100) : 0}%）`));
        })() : '',
        r.taken ? list2(`受到的傷害（被打 ${r.hits} 下、衝刺 ${r.dashes} 次）`, Object.entries(r.taken).map(([k, v]) => `${k}　${fmt(v)}`)) : '',
        r.mech ? `<div><b>機體</b><br>零件：${Object.entries(r.mech.parts).map(([k, v]) => `${k} ${v}`).join('、') || '無'}（${r.mech.slots} 格）${r.mech.module ? `　·　模組：${r.mech.module}` : ''}${r.mech.traits.length ? `<br>特性：${r.mech.traits.join('、')}` : ''}${Object.keys(r.mech.playKills || {}).length ? `<br>玩法擊殺：${Object.entries(r.mech.playKills).map(([k, v]) => `${k} ${v}`).join('、')}` : ''}</div>` : '',
        list2('各關摘要', r.sectors), list2('走過的節點', r.path), list2('武器升級', r.upgrades), list2('取得的晶片', r.got),
      ].join('');
      return `<div class="rec"><div class="between"><span><b style="color:${color}">${label}</b>　${r.where || `${r.chapter > 1 ? `第 ${r.chapter} 章 · ` : ''}${r.endless ? '無盡 · ' : ''}星區 ${r.sector} 第 ${r.layer} 層`}　·　${when}</span>
          <button data-act="copyone" data-arg="${i}">📋 複製這筆</button></div>
        ${r.ship} · ${r.weapon}　·　${Math.floor(r.time / 60)} 分 ${r.time % 60} 秒　·　擊殺 ${fmt(r.kills)}　·　總傷害 ${fmt(r.dmg)}
        ${r.cause ? `<br>擊毀原因：${r.cause}` : ''}${r.bosses && r.bosses.length ? `<br>擊沉旗艦：${r.bosses.join('、')}` : ''}
        ${top ? `<br>傷害前三：${top}` : ''}
        ${r.coop ? `<br><b style="color:#ff9dbd">👥 多人（${r.coop.role}）</b>　隊友：${r.coop.mate}${r.coop.mateDown ? '（已被擊墜）' : ''}
          <br>延遲：${typeof r.coop.ping === 'object' ? `平均 ${r.coop.ping.avg} ms、最低 ${r.coop.ping.min}、90% 在 ${r.coop.ping.p90} 以內、最高 ${r.coop.ping.max}（${r.coop.ping.samples} 次）` : r.coop.ping}
          　·　同步最長間隔 ${r.coop.sync.maxGapMs} ms
          ${r.coop.team ? `<br>傷害：${r.coop.team.map(t => `${t.who} ${t.ship} ${fmt(t.dmg)}（擊殺 ${t.kills}）`).join('　｜　')}` : ''}` : ''}<br><span style="color:#6a79ad">電路：${r.chain.map(c => c || '空').join(' → ')}</span>
        ${detail ? `<details style="margin-top:6px"><summary style="cursor:pointer;color:#8fa3d9">展開細節</summary>${detail}</details>` : ''}
        <div id="copyBox${i}"></div></div>`;
    }).join('');
    this.show(`<div class="scr">
      <div class="between"><div><h2>📜 遊玩紀錄</h2>
        <div class="sub">每一局結束（飛船被擊毀、或選「結束遠征」）時自動存一筆，保留最近 ${CFG.MAX_RECORDS} 筆。紀錄只存在這台裝置的瀏覽器裡。
          每筆右上角可以單獨複製、「展開細節」可以看走過的節點與受傷來源；也可以一次複製全部。複製後把文字貼給開發者就能分析。</div></div>
        ${Net.linked ? '<button data-act="netroom" data-back>回到房間 (Esc)</button>' : '<button data-act="title" data-back>返回 (Esc)</button>'}</div>
      <div class="row" style="justify-content:flex-start"><button data-act="copyrec" ${list.length ? '' : 'disabled'}>📋 複製全部紀錄（${list.length} 筆）</button>
        ${confirmClear
          ? `<span style="color:#ff4d6d">確定刪除全部 ${list.length} 筆紀錄？刪除後無法復原。</span>
             <button data-act="clearrecok" style="border-color:#ff4d6d;color:#ff4d6d">確定刪除</button><button data-act="records">取消</button>`
          : `<button data-act="clearrec" ${list.length ? '' : 'disabled'}>🗑 刪除所有紀錄</button>`}</div>
      ${msg ? `<div class="toast">${msg}</div>` : ''}
      <div id="copyBox"></div>
      <div class="rec-list">${rows || '<div class="sub">還沒有紀錄。玩完一局就會出現在這裡。</div>'}</div></div>`);
  },
  copyRecords() {
    this.copyText(JSON.stringify({ game: '星環電路', exported: new Date().toISOString(), records: Game.loadRecords() }));
  },
  copyOne(i) {  // 紀錄頁：只複製其中一筆（提示顯示在那一筆的下面）；精簡文字
    const r = Game.loadRecords()[i];
    if (r) this.copyText(recordText(r), 'copyBox' + i);
  },
  // 結算畫面：複製這一局目前的紀錄（打完 Boss 還沒結束遠征時也能複製）
  copyRun() {
    const result = Game.state === 'dead' ? 'dead' : Game.chapterDone() ? 'cleared' : 'in_progress';
    const rec = Game.mode === 'coop' ? Net.buildRecord(result) : Game.buildRecord(result);
    this.copyText(recordText(rec));
  },
  // 複製文字到剪貼簿；被擋時（例如嵌在 iframe 裡）在畫面上的 #copyBox 顯示文字框讓玩家自己全選複製
  copyText(text, boxId = 'copyBox') {
    const box = document.getElementById(boxId);
    const done = () => { if (box) box.innerHTML = '<div class="toast">已複製到剪貼簿，可以直接貼上。</div>'; };
    const fallback = () => {
      if (!box) return;
      box.innerHTML = '<div class="toast" style="color:#ffd166">無法自動複製，請全選下面的文字（Ctrl+A）後手動複製（Ctrl+C）。</div><textarea class="rec-copy" readonly></textarea>';
      const ta = box.querySelector('textarea');
      ta.value = text; ta.focus(); ta.select();
      try { if (document.execCommand('copy')) done(); } catch (e) {}
    };
    try {
      navigator.clipboard.writeText(text).then(done, fallback);
    } catch (e) { fallback(); }
  },
};

// ---------- 精簡紀錄文字（「複製這局／這筆紀錄」用；代號對照表在 README「遊玩紀錄的代號」） ----------
//   完整資料還是存在瀏覽器裡（紀錄頁「展開細節」、「複製全部紀錄」是完整 JSON）
const REC_CODE = {
  node: { 戰鬥: '戰', 精英: '精', 旗艦: '王', 改裝廠: '改', 軍械台: '軍', 維修站: '修', 補給站: '補', 奇異點: '奇', 黑洞: '洞' },
  enemy: { 蟲群: '蟲', 刺殼: '刺', 噴吐者: '噴', 虛空獵手: '獵', 星噬母艦: '母', 裂界獵艦: '裂', 終焉核心: '核', 彗星: '彗', 黑洞核心: '洞',
    彈幕艇: '艇', 列隊蟲: '列', 盾衛: '盾', 分裂體: '分', 碎裂體: '碎', 潛伏者: '潛', 母巢: '巢' },
  result: { dead: '死', cleared: '通', retired: '退', disconnect: '斷線', in_progress: '進行中' },
  src: { 武器直擊: '直擊', '命中觸發（回響）': '回響', 攔截回射: '回射', 震盪衝撞: '衝撞' },
};
function recordText(r) {
  const C = REC_CODE, L = [];
  const en = n => C.enemy[n] || n;
  const hurt = k => { const m = /^(.+?)（(子彈|撞擊)）$/.exec(k); return m ? en(m[1]) + (m[2] === '子彈' ? '彈' : '撞') : en(k); };
  // 晶片名稱 → 短名：「超頻模組 Lv2」→ 超頻2；「全向（反向 Lv3）」→ 全向
  const short = {};
  for (const id in CHIPS) if (!/Lv\d|（/.test(CHIPS[id].name)) short[CHIPS[id].name] = CHIPS[id].short;
  const chip = n0 => {
    if (!n0) return '空';
    const mm = /^(.*?)(◇\d)?(［.+］)?$/.exec(n0), n = mm[1], tail = (mm[2] || '') + (mm[3] || '');  // 插座數、黑洞強化的屬性照原樣接在後面
    if (/（.+ Lv3）$/.test(n)) return n.replace(/（.+）$/, '') + tail;
    const m = /^(.+) Lv(\d)$/.exec(n);
    return (m ? (short[m[1]] || m[1]) + m[2] : short[n] || n) + tail;
  };
  const sec = t => { const m = /^(\d+)秒$/.exec(t); return m ? +m[1] : 0; };
  // 第 1 行：版本｜結果、打到哪｜飛船、操作｜時間、擊殺
  const where = r.where || '', bm = /，(\S+?)剩 (\d+)% 血/.exec(where);
  L.push(`星環電路 ${r.build}｜${r.mode === 'coop' ? '多人 ' : ''}${C.result[r.result] || r.result} ${r.chapter > 1 ? `第${r.chapter}章 ` : ''}${r.endless ? '無盡' : ''}${r.sector}-${r.layer}${bm ? ` ${en(bm[1])}剩${bm[2]}%` : ''}${r.cause ? ` 被${hurt(r.cause)}` : ''}｜${r.ship} ${/觸控/.test(r.input) ? (/開/.test(r.input) ? '觸控自動' : '觸控') : '滑鼠'}｜${r.time}秒 殺${r.kills}${r.bosses && r.bosses.length ? ` 擊沉${r.bosses.map(en).join('')}` : ''}`);
  L.push(`武器 ${r.weapon.replace('・', '+')}`);
  const S = r.stats;
  const wsk = ((r.chain || [])[0] || '').match(/［.+］/);  // 武器插座上的組件
  L.push(`電路 ${wsk ? '武器' + wsk[0] + '｜' : ''}${(r.chain || []).slice(1).map(chip).join('｜')}${S ? `（能量${S.heat}${S.cap != null ? '/' + S.cap : ''}${S.off != null ? (S.off ? ` 沒電${S.off}個` : '') : ` 射速${S.rateCut}`} ${S.rps}發/秒 每發${S.perFire}顆${S.fireDmg} 估${S.estDps}）` : ''}${r.inv && r.inv.length ? ` 倉庫 ${r.inv.map(chip).join(' ')}` : ''}`);
  const M = r.mech;
  if (M) {
    L.push(`機體 ${Object.entries(M.parts).map(([k, v]) => k.slice(0, 2) + v).join(' ') || '無零件'}${M.module ? `｜${M.module}${M.traits.length ? `(${M.traits.join(' ')})` : ''}` : M.traits.length ? `(${M.traits.join(' ')})` : ''} HP${r.hp}/${r.maxHp} 晶${r.credits}`);
    const g = Object.entries(M.playKills || {}).sort((a, b) => b[1] - a[1]);  // 舊紀錄沒有 playKills（以前是用量成長）
    if (g.length) L.push(`玩法擊殺 ${g.map(([k, v]) => k + v).join(' ')}`);
  }
  const src = Object.entries(r.dmgBySource || {}).map(([k, v]) => (C.src[k] || k) + v).join(' ');
  const cd = (r.chipDmg || []).map(([k, v]) => (/^武器・/.test(k) ? '武器' : /^機體/.test(k) ? '機體' : chip(k)) + v).join(' ');
  L.push(`傷害 ${r.dmg} 最大${r.maxHit}｜${src}｜${cd}`);
  if (r.taken) L.push(`被打 ${r.hits}下 衝刺${r.dashes}｜${Object.entries(r.taken).map(([k, v]) => hurt(k) + v).join(' ')}`);
  if (r.perf && r.perf.worst) L.push(`效能 最慢一幀${r.perf.worst}ms(${r.perf.worstAt}) 卡>100ms ${r.perf.slow}次`);  // 戰鬥中最慢的一幀在哪（第幾層、第幾波、場上子彈數）
  // 每個星區一行：摘要＋走過的節點（戰28-10 ＝ 戰鬥 28 秒、掉 10 血）
  const nodes = {};
  for (const p of r.path || []) {
    const m = /^(\d+)-\d+ (\S+)(?: (\d+秒) HP (\d+)→(\d+))?/.exec(p);
    if (!m) continue;
    const code = C.node[m[2].replace(/・.*/, '')] || m[2], lost = m[4] ? +m[4] - +m[5] : 0;
    (nodes[m[1]] = nodes[m[1]] || []).push(m[3] ? `${code}${sec(m[3])}${lost > 0 ? '-' + lost : lost < 0 ? '+' + -lost : ''}` : code);
  }
  (r.sectors || []).forEach((t, i) => {
    const m = /星區 (\d+)：戰鬥 (\d+) 秒、擊殺 (\d+)、傷害 (\d+)、離開時 HP (\d+\/\d+)、晶體 (\d+)/.exec(t), n = m ? m[1] : String(i + 1);
    L.push(`S${n} ${m ? `${m[2]}秒 殺${m[3]} 傷${m[4]} HP${m[5]} 晶${m[6]}` : t}｜${(nodes[n] || []).join(' ')}`);
  });
  // 取得：同一層的東西只在第一個前面寫層號
  const got = [...(r.upgrades || []).map(t => [t, 1]), ...(r.got || []).map(t => [t, 0])].map(([t, up]) => {
    const m = /^(\d+)-(\d+) (.*)$/.exec(t);
    if (!m) return null;
    let b = m[3];
    if (up) b = b.replace(/^.*・/, '');
    else b = b.replace(/^零件 (\S+)（(\d+) 層）$/, (_, a, n) => a.slice(0, 2) + n)
      .replace(/^插槽 \+1.*$/, '插槽').replace(/^背包模組 (\S+?)(（.*）)?$/, '$1')
      .replace(/^(\S+) 升到 Lv(\d)（用量成長）$/, (_, a, n) => chip(a) + n).replace(/^\S+ 進化 → (\S+?)！（用量成長）$/, '$1')
      .replace(/^黑洞融合 (\S+)＋(\S+) → (\S+)$/, '融合$1+$2→$3').replace(/^改裝：(\S+) → (\S+)$/, '改裝$1→$2');
    return { s: +m[1], l: +m[2], b: up ? b : chip(b) };
  }).filter(Boolean).sort((a, b) => a.s - b.s || a.l - b.l);
  let last = '';
  if (got.length) L.push('取得 ' + got.map(g => { const k = g.s + '-' + g.l, t = (k === last ? '' : k) + g.b; last = k; return t; }).join(' '));
  if (r.coop) {
    const c = r.coop, ping = typeof c.ping === 'object' ? `延遲${c.ping.avg}ms(最高${c.ping.max})` : '';
    // 同步最長的那次在哪（第幾層、第幾波、場上子彈數）、超過 150ms 的停頓幾次
    L.push(`多人 ${c.role}｜隊友 ${c.mate}${c.mateDown ? '(倒下)' : ''}｜${ping} 同步最長${c.sync.maxGapMs}ms${c.sync.maxGapAt ? `(${c.sync.maxGapAt})` : ''}${c.sync.gaps150 != null ? ` 停頓>150ms ${c.sync.gaps150}次` : ''}`);
    if (c.team) L.push(`分工 ${c.team.map(t => `${t.who} ${t.ship} ${t.dmg}(殺${t.kills}${t.downs ? ` 倒${t.downs}` : ''}${t.revives ? ` 救${t.revives}` : ''})`).join('｜')}`);
    if (c.matePerf && c.matePerf.worst) L.push(`隊友效能 最慢一幀${c.matePerf.worst}ms(${c.matePerf.at}) 卡>100ms ${c.matePerf.slow}次`);
    if (c.mateChipDmg && c.mateChipDmg.length) L.push(`隊友晶片 ${c.mateChipDmg.map(([k, v]) => (/^武器・/.test(k) ? '武器' : chip(k)) + v).join(' ')}`);
  }
  return L.join('\n');
}
