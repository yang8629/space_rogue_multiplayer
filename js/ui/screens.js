// 星環電路 多人版 · screens.js：DOM 畫面：標題、選飛船／武器／晶片、航圖、獎勵、商店、結算、紀錄
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SCREENS — DOM 畫面（標題 / 航圖 / 獎勵 / 商店 / 結算）
// =====================================================================
// ---------- 從資料組出來的小段 HTML（資料層只放數值和文字，排版在這裡） ----------
// 數值圖示（最大 HP、速度、衝刺冷卻…）
const statIcon = id => `<img class="si" src="assets/ui/stat_${id}.png" alt="${STATS[id].name}" title="${STATS[id].name}">`;
// 一項效果：圖示＋數值，對玩家有利綠色、不利紅色（例：受到的傷害 +3% 紅、衝刺冷卻 −8% 綠）
const statFx = ({ stat, v, pct }) => `<span class="sv ${v * STATS[stat].good > 0 ? 'good' : 'bad'}">${statIcon(stat)}${signed(v, pct)}</span>`;
// 零件疊 n 層的總效果（圖示）
const partLine = (id, n = 1) => PARTS[id].fx.map(f => statFx(fxTimes(f, n))).join('');
// 玩法晶片每一級的效果，現在這一級亮綠
const lvLine = (base, cur) => {
  const L = LV_INFO[base];
  if (!L) return '';
  return `${L[0]}：` + L[1].map((v, i) => i + 1 === cur ? `<b style="color:#9dff6b">Lv${i + 1} ${v}</b>` : `Lv${i + 1} ${v}`).join(' → ');
};
// 收集進度：手上同種、還沒滿級的晶片裡最高的等級（例：碎片 2/3 = 已有一片 Lv2，再拿一片就能合成 Lv3）
const lvHave = base => Math.max(0, ...[...(Game.chain || []), ...(Game.inventory || [])].filter(x => x && baseOf(x) === base && lvOf(x) < CFG.MAX_CHIP_LV).map(lvOf));
// 飛船：開局零件每種幾層＋總效果（沒有零件 = 空）
const shipPartsHtml = S => Object.entries(S.parts).map(([id, n]) => `<div class="fxl"><b>${PARTS[id].name} ${n} 層</b>${partLine(id, n)}</div>`).join('');
// 飛船：專屬能力（條列）＋開局零件開啟的特性（疊到 2、4 層的）
function shipAbilityHtml(S) {
  const head = `<div class="trl on"><b style="color:${S.color}">${S.abilityName}</b>${descList(S.abilityDesc)}</div>`;
  return head + Object.entries(S.parts).flatMap(([id, n]) => [n >= 2 && PARTS[id].t2, n >= 4 && PARTS[id].t4].filter(Boolean))
    .map(t => `<div class="trl"><b style="color:#9dff6b">開啟${t.name}</b>${t.desc}</div>`).join('');
}
// 飛船卡片的說明：平常只顯示一句（brief），按 Shift 看開局零件和專屬能力的完整說明
const shipDescHtml = S => `<div class="ds brief">${S.brief}</div><div class="det"><div class="ds">${shipPartsHtml(S)}${shipAbilityHtml(S)}</div></div>`;
// 開局數值一行（圖示）：船體、速度、衝刺冷卻、零件格
function shipStatLine(S) {
  const st = shipStart(S);
  return `<div class="statl"><span>${statIcon('hp')}${st.hp}</span><span>${statIcon('speed')}${st.speed}</span><span>${statIcon('dashCd')}${st.dashCd} 秒</span><span>${statIcon('slots')}${S.partSlots}</span></div>`;
}

// 傷害統計的來源 → 顏色（武器、飛船的代表色；晶片照種類）
function dmgKeyColor(key) {
  return key === 'weapon' ? WEAPONS[Game.weapon.id].color : key === 'ship' ? SHIPS[Game.shipId].color : key === 'comet' ? '#bfe9ff'
    : CHIPS[key] ? TYPE_META[CHIPS[key].type].color : '#8fa3d9';
}

// 卡片的大類（三選一好分辨）：晶片（玩法晶片、觸發器）青藍、組件金、機體強化（零件）銀白
const CARD_CAT = { chip: '晶片', comp: '組件', mech: '機體強化' };
const catBand = k => `<div class="cat">${CARD_CAT[k]}</div>`;

// 武器卡片的內容（選武器、軍械庫）：名稱、一句話；詳細 = 說明、數值、三條升級路線
function weaponCardBody(id) {
  const W = WEAPONS[id], p = weaponParams({ id, path: null, final: null }), dps = p.damage * p.count / p.interval;
  const paths = Object.values(W.paths).map(P =>
    `<div><b style="color:${W.color}">${P.name}</b>：${P.desc}<br><span style="color:#6a79ad">→ ${P.next.map(n => n.name).join(' ／ ')}</span></div>`).join('');
  return `<div class="ttl" style="color:${W.color}">${W.name}</div>
    <div class="ds brief">${WEAPON_BRIEF[id]}</div>
    <div class="det"><div class="ds">${descList(W.desc)}</div>
    <div class="ty">單發 ${p.damage} × ${p.count}　·　每秒 ${(1 / p.interval).toFixed(1)} 次　·　基礎 DPS 約 ${Math.round(dps)}　·　擊退 ${p.knock}</div>
    <div class="ds" style="font-size:11px;display:grid;gap:6px">${paths}</div></div>`;
}
function chipCard(id, footer = '') {
  const d = CHIPS[id], m = TYPE_META[d.type], cat = isComp(id) ? 'comp' : 'chip';
  const ps = d.stored ? `<div class="ps">倉庫被動：${Object.entries(d.stored).map(([k, v]) => PASSIVE_LABEL[k](v)).join('、')}</div>` : '';
  const have = lvHave(baseOf(id));
  const lv = LV_INFO[baseOf(id)] ? `<div class="ty" style="line-height:1.6">${lvLine(baseOf(id), lvOf(id))}<br>同種晶片拖到一起合成升級${have ? `　<b style="color:#ffd166">已有 ${have}/${CFG.MAX_CHIP_LV}</b>` : ''}</div>` : '';
  const sk = isHost(id) && id !== 'weapon' && socketsOf(id) ? ' sk' + socketsOf(id) : '';  // 插座數 = 稀有度：框色 1 灰、2 藍、3 紫
  const rare = rareOf(id) ? `<div class="ds rareln">★ 稀有：${RARE_INFO[baseOf(id)]}</div>` : '';
  return `<div class="card cat-${cat}${sk}${rareOf(id) ? ' rare' : ''}">${rareOf(id) ? '<div class="cat rareband">★ 稀有晶片</div>' : catBand(cat)}
    <div class="ty" style="color:${m.color}">${m.icon} ${m.label}</div>
    <div class="ttl">${lvName(id)}</div>
    ${sockLine(id)}
    <div class="ds brief">${chipBrief(id)}</div>${chipPassLine(id) ? `<div class="ty" style="color:#9dff6b;opacity:1">${chipPassLine(id)}</div>` : ''}${rare}
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
const FLIP_BEAT_MS = 300;  // 三選一：畫面出來後等這麼久才開始翻卡片
// 三選一卡片：拿了會裝在哪；進倉庫時改成紅字
function placeLine(id) {
  const P = Game.autoPlace(id), line = (t, bad) => `<div class="ty placeln" style="color:${bad ? '#ff8a8a' : '#9dff6b'}">→ ${t}</div>`;
  if (!P) return line(isComp(id) ? '沒有空插座，先放倉庫' : '電路已滿，先放倉庫（要自己換）', true);
  return line(P.sock != null ? `插在${CHIPS[Game.chain[P.sock]].name}上` : '接在電路最後');
}
// 插座說明：晶片顯示插座數；插件顯示怎麼插
function sockLine(id) {
  if (isComp(id)) return '<div class="ty sockln">◆ 插件：拖進武器或晶片的插座（不佔電路格）</div>';
  if (!isHost(id) || id === 'weapon') return '';
  const n = socketsOf(id), P = CHIPS[baseOf(id)];
  return `<div class="ty sockln${n ? '' : ' det'}">${n ? '◇'.repeat(n) + ` 插座 ${n} 個` : '插座數：掉落時決定（1～3）'}<br>往下傳：${P.pass === 'kill' ? '擊殺時' : P.pass === 'end' ? '結束時' : '命中時'}</div>`;
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

const SCROLL_BOXES = '.scr, .panel, .base-body';  // 畫面裡會捲動的框（css overflow: auto）
const Screen = {
  el: document.getElementById('screen'),
  show(html) {
    // 有卡片的畫面：卡片只顯示精簡說明，按 Shift（手機按「詳細」）切換完整說明
    if (html.includes('class="card')) html += '<div class="detail-hint">按 Shift 切換詳細說明　<button data-act="detail">詳細</button></div>';
    // 同一個畫面重畫（奇異點選晶片、商店買東西）：保留捲動位置，不跳回最上面；換了畫面才從頭
    const key = this.scrollKey(), keep = [...this.el.querySelectorAll(SCROLL_BOXES)].map(e => e.scrollTop);
    this.el.innerHTML = html; this.el.classList.remove('hidden', 'hub');
    if (key && key === this.scrollKey()) this.el.querySelectorAll(SCROLL_BOXES).forEach((e, i) => { if (keep[i]) e.scrollTop = keep[i]; });
    Hub.setDriving(false);  // 基地的飛船只在基地畫面（hubView）能動
  },
  scrollKey() {  // 認畫面：最外層框的 class＋標題
    const f = this.el.firstElementChild, h = this.el.querySelector('h2');
    return f ? f.className + '|' + (h ? h.textContent : '') : '';
  },
  hide() {
    this.el.classList.add('hidden');
    if (document.activeElement) document.activeElement.blur();  // 避免 Space/Enter 再次觸發按鈕
  },
  status() {
    const p = Game.player;
    return `<div class="row"><span class="pill">${statIcon('hp')}${Math.ceil(p.hp)} / ${p.maxHp}</span>
      <span class="pill crystal" data-credits>◆ ${Game.credits}</span>${Game.mode === 'coop' ? '<span class="pill" style="color:#ff9dbd" title="怪物掉落的晶體每人都拿；其他收入與花費各自計算">👥 各自的錢包</span>' : ''}
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
      case 'mute': SFX.setMuted(!SFX.muted); if (document.getElementById('setPage')) Screen.settings(); break;
      case 'detail': document.body.classList.toggle('detail'); break;
      case 'codex': Codex.open('rules'); break;
      case 'run': this.restart(); break;
      case 'editor': Game.toggleEditor(); break;
      case 'reward': Game.takeReward(arg || null); break;
      case 'reroll': Game.rerollReward(); break;
      case 'buy': Game.buy(+arg); break;
      case 'leave': Game.showMap(); break;
      case 'node': if (Game.mode === 'coop') Net.vote(arg); else Game.enterNode(Game.nodeById(arg)); break;
      case 'resume': Game.togglePauseMenu(false); break;
      case 'quitrun': Game.quitRun(); break;
      case 'title': Net.leave(); Game.mates = []; Game.state = 'title'; Game.inArena = false; Screen.title(); break;
      case 'base': Screen.title(arg); break;
      case 'hub': Screen.hubView(); break;
      case 'basech': if (chapterUnlocked(+arg)) { Game.chapterId = +arg; Screen.basePanel('launch'); } break;
      case 'depart': Screen.depart(); break;
      case 'startchip': {  // 開局三選一晶片選好了
        const [mode, ship, wid, chip] = arg.split(':');
        if (mode === 'coop') Net.ready(ship, wid, chip); else Hub.launch(() => Game.newRun(mode, ship, wid, chip));  // 從基地出發：先播出發動畫
        break;
      }
      case 'coop': Net.lobby(); break;
      case 'nethost': Net.host(); break;
      case 'netjoin': Net.join(document.getElementById('netCode').value); break;
      case 'netchapter': Net.setChapter(+arg); break;
      case 'netroom': Net.backToRoom(); break;
      case 'netrejoin': Net.tryRejoin(); break;
      case 'netgiveup': Net.giveUp(); break;
      case 'netsolo': Net.soloContinue(); break;
      case 'upg': Game.upgradeWeapon(arg); break;
      case 'armorybonus': Game.armoryBonus(); break;
      case 'slot': Game.expandSlot(arg); break;
      case 'evopt': Game.evChoose(+arg); break;
      case 'evnext': Game.evNext(); break;
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
        Save.remove('records');
        Screen.records('已刪除所有紀錄。');
        break;
      case 'copyrec': Screen.copyRecords(); break;
      case 'copyrun': Screen.copyRun(); break;
      case 'copycode': Screen.copyCode(btn); break;
      case 'copyone': Screen.copyOne(+arg); break;
      case 'heal': Game.shopHeal(); break;
      case 'wspick': Game.wsPick(arg); break;
      case 'wsfrom': Game.wsFrom(arg); break;
      case 'wsto': Game.wsTo(arg); break;
      case 'music': Music.toggle(); Screen.settings(); break;
      case 'settings': Screen.settings(); break;
      case 'setback': Screen.settingsBack(); break;
    }
  },

  // 還沒解鎖的武器、晶片：灰色卡片，寫解鎖條件和進度，沒有選擇按鈕
  lockedCard(name, color, u, icon = null) {
    const st = unlockState(u);
    return `<div class="card locked" style="border-color:${color}">
      ${icon ? `<img src="${icon}" width="72" height="72" alt="${name}" style="margin:0 auto;display:block">` : ''}
      <div class="ttl" style="color:${color};text-align:center">🔒 ${name}</div>
      <div class="ds">${unlockNeed(u)}</div><div class="ulk-bar"><div style="width:${Math.round(st.cur / st.max * 100)}%"></div></div>
      <div class="ty" style="text-align:center">${Math.floor(st.cur)} / ${st.max}</div></div>`;
  },
  // 開局三選一起始晶片（遠征與雙人；取代以前飛船自帶的晶片）
  chipPick(mode, shipId, weaponId) {
    const S = SHIPS[shipId], W = WEAPONS[weaponId];
    const cards = startChipPicks().map(id =>
      chipCard(id, `<button data-act="startchip" data-arg="${mode}:${shipId}:${weaponId}:${id}">選這個</button>`)).join('');
    this.show(`<div class="scr pick">
      <div class="between"><div><h2>起始晶片（三選一）</h2>
        <div class="sub"><b style="color:${S.color}">${S.name}</b> ＋ <b style="color:${W.color}">${W.name}</b>。選一個開局晶片，裝在武器右邊。</div></div>
        <button data-act="hub" data-back>回到基地 (Esc)</button></div>
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
      <div class="ttl" style="color:#2ee6a6">🔌 電路擴充</div>
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
    // 全隊投票的事件（多人）：選項＝投票；投了之後按鈕鎖住，下面列出每個人投了什麼、還剩幾秒
    const team = E.team && Game.mode === 'coop' && Net.linked, voted = team && V.vote != null;
    const tally = team ? `<div class="sub" style="margin-top:6px;color:${E.color}">👥 全隊投票，結果大家一樣（意見不同照票數抽籤）：${Net.evWho().map(s => { const v = s === Net.mySlot() ? V.vote : Net.evVotes[s]; return `${s}P ${v != null && E.opts[v] ? `投「${E.opts[v].lab}」` : '還沒投'}`; }).join('、')}　<span id="evTimer">${Net.evLeft() != null ? `（剩 ${Net.evLeft()} 秒）` : ''}</span></div>` : '';
    const btns = V.res ? `<div class="ev-res" style="color:${V.res.color}">${V.res.msg}</div>${V.res.sub ? `<div class="sub" style="text-align:center">${V.res.sub}</div>` : ''}<button class="big" data-act="evnext">繼續</button>`  // 賭運氣的結果、全隊投票的結果（sub：每個人投了什麼）
      : E.opts.map((o, i) => `<button class="${i === 0 ? 'big ' : ''}ev-opt" data-act="evopt" data-arg="${i}" ${(o.can && !o.can(Game, V.node)) || voted ? 'disabled' : ''}${voted && V.vote === i ? ` style="border-color:${E.color};opacity:1"` : ''}>${o.txt(Game, V.node)}${voted && V.vote === i ? '　✓ 你的票' : ''}</button>`).join('') + tally;
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
      <details class="nlegs"><summary>節點介紹</summary><div class="nleg-grid">${legend}</div></details></div>`);
  },

  reward() {
    const R = Game.reward, full = !Game.inventory.includes(null);
    if (!R) return;
    const slotCard = () => `<div class="card" style="border-color:#2ee6a6">
      <div class="ty" style="color:#2ee6a6">🔌 電路擴充</div><div class="ttl">插槽 +1</div>
      <div class="ds">電路多一格（目前 ${Game.chain.length} 格，最多 ${CFG.MAX_SLOTS} 格）。適合晶片流。</div>
      <button data-act="slot" data-arg="reward">選擇</button></div>`;
    const cardOf = id => {
      if (id === 'slot') return slotCard();
      if (id.startsWith('part:')) {
        const k = id.slice(5), ok = partsUsed(Game.parts) < Game.partSlots;
        return partCard(k, `<button ${ok ? '' : 'disabled'} data-act="reward" data-arg="${id}">${ok ? '裝上' : '零件格已滿'}</button>`, Game.parts, true);  // 跟晶片混在一起：標「機體強化」
      }
      const ok = Game.canAcquire(id), label = ok ? '選擇' : '倉庫已滿';
      return chipCard(id, placeLine(id) + `<button ${ok ? '' : 'disabled'} data-act="reward" data-arg="${id}">${label}</button>`);
    };
    const flip = R.flipFor !== R.options;  // 每組卡片（新開、刷新）翻開一次；同一組重畫不再翻
    R.flipFor = R.options;
    const cards = [...R.options, ...(R.slot ? ['slot'] : [])].map((id, i) => {  // slot：有電路擴充卡的三選一（CFG.REWARDS 的 slotCard）
      const html = cardOf(id);
      // 卡片本身有 style（電路擴充的框色）就接在後面
      return flip ? html.replace(/^<div class="card([^"]*)"(?: style="([^"]*)")?>/, (_, c, st) => `<div class="card${c} flipin" style="${st ? st + ';' : ''}animation-delay:${i * 0.12}s">`) : html;
    }).join('');
    if (flip) requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {  // 畫面先出來（等真的畫上去），慢一拍才開始翻
      const el = this.el.querySelector('.cards.flip-hold');
      if (el) el.classList.remove('flip-hold');
    }, FLIP_BEAT_MS)));
    this.show(`<div class="scr">
      <div class="between"><div><h2>${REWARD_TITLE[R.kind]()}</h2>
        <div class="sub">${R.note ? `<span style="color:#ffd166">${R.note}</span><br>` : ''}選了會自動裝上電路（電路滿了才放倉庫），按 Tab 調整。</div>${this.fightSummary()}</div>${this.status()}</div>
      <div class="cards${flip ? ' flip-hold' : ''}">${cards}</div>
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
          ? `<button ${Game.credits >= Game.shopPrice(CFG.SHOP_SLOT) ? '' : 'disabled'} data-act="slot" data-arg="shop">🔌 電路擴充 插槽 +1（◆ ${Game.shopPrice(CFG.SHOP_SLOT)}，每間限 1 次）</button>` : ''}
        <button data-act="leave">離開補給站</button></div>
      <div class="toast" style="text-align:center">${toast}</div></div>`);
  },

  // 三選一上面：剛打完的這一場，各晶片佔比＋每秒傷害（跟上一場比）；不是剛打完戰鬥（事件、商店的獎勵）就不顯示
  fightSummary() {
    const R = Game.runStats, B = Game.fightBase;
    if (!R || !B || B.node !== (Game.node && Game.node.id)) return '';
    const d = Object.entries(R.chips).map(([k, v]) => [k, v - (B.chips[k] || 0)]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
    const total = d.reduce((a, [, v]) => a + v, 0), dt = R.time - B.time;
    if (!total || dt <= 0) return '';
    const dps = B.dps = total / dt;
    const vs = (now, was, lab) => was ? `（${lab} ${Math.round(was)}，<b style="color:${now >= was ? '#9dff6b' : '#ff8a8a'}">${now >= was ? '+' : ''}${Math.round((now / was - 1) * 100)}%</b>）` : '';
    // 中途改過電路：改之後（滿 5 秒才比）對改之前（同一場、同一批怪）
    let cut = '';
    const C = B.cut, base = Object.values(B.chips).reduce((a, v) => a + v, 0), now = Object.values(R.chips).reduce((a, v) => a + v, 0);
    if (C && R.time - C.t >= 5 && C.t > B.time) {
      const after = (now - C.d) / (R.time - C.t), before = (C.d - base) / (C.t - B.time);
      cut = `<br>　改電路後 ${Math.round(R.time - C.t)} 秒：<b>${Math.round(after)}</b>${vs(after, before, '改之前')}`;
    }
    const on = new Set([...Game.chain, ...Game.socks.flat()].filter(Boolean).map(baseOf));
    const gone = k => CHIPS[k] && k !== 'weapon' && !on.has(k);  // 這場打到一半拆掉的晶片、插件
    const parts = d.map(([k, v]) => `<span style="color:${dmgKeyColor(k)}">${dmgKeyName(k)} ${Math.round(v / total * 100)}%${gone(k) ? '（已拆）' : ''}</span>`).join('　');
    return `<div class="sub" style="margin-top:6px">這一場：每秒傷害 <b>${Math.round(dps)}</b>${vs(dps, Game.prevFightDps, '上一場')}${cut}<br>${parts}</div>`;
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
    return `${this.unlockFreshHtml()}<div class="summary">
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
      <div class="sub">${coop ? '多人模式不會暫停，隊友那邊照常進行。<br>' : ''}${Game.freePlay() ? '離開 = 回到基地。' : '離開遊戲 = 這一局中途結束（存入遊玩紀錄），顯示結算。'}</div>
      <div class="row"><button class="big" data-act="resume" data-back>繼續 (Esc)</button>
        <button class="big" data-act="quitrun">離開遊戲</button></div>
      <div class="row"><button data-act="settings">⚙ 設定</button></div></div>`);
  },
  // 設定頁：聲音、畫面、操作說明、版本；從基地或戰鬥中的選單打開，返回回到原本的地方
  settings() {
    if (!document.getElementById('setPage')) this.settingsFrom = Game.state === 'play' ? 'pause' : 'hub';
    const pct = v => Math.round(v * 100);
    const slider = (k, label) => `<label class="set-row"><span>${label}</span><input type="range" min="0" max="100" step="5" value="${pct(Settings[k])}" data-set="${k}"><b data-setv="${k}">${pct(Settings[k])}%</b></label>`;
    const check = (k, label, note) => `<label class="set-row chk"><span>${label}</span><input type="checkbox" data-set="${k}"${Settings[k] ? ' checked' : ''}><span class="ty">${note}</span></label>`;
    const keys = [['WASD／方向鍵', '移動'], ['滑鼠左鍵', '射擊'], ['Space', '衝刺（無敵）'], ['滑鼠右鍵', '武器技能（排熱、召回、塌縮…）'], ['Tab', '編輯電路（暫停）'], ['E／Enter', '基地：停機坪、門、發射台'], ['Q', '基地：看武器架那把的升級路線'],
      ['Esc', '選單、返回'], ['Shift', '卡片切換完整說明'], ['M', '音效開／關']].map(([k, v]) => `<div class="st-row"><b class="key">${k}</b><span>${v}</span></div>`).join('');
    this.show(`<div class="scr base compact" id="setPage">
      <div class="between"><h2>⚙ 設定</h2><button data-act="setback" data-back>返回 (Esc)</button></div>
      <div class="base-body set-body">
        <h3>聲音</h3>
        ${slider('master', '總音量')}${slider('vol', '音效音量')}${slider('musicVol', '音樂音量')}
        <div class="row"><button data-act="mute">${SFX.muted ? '🔇 音效關' : '🔊 音效開'}</button>
          <button data-act="music">${Music.on ? '🎵 音樂開' : '<span class="slash">🎵</span> 音樂關'}</button></div>
        <h3>畫面</h3>
        ${check('shake', '畫面震動', '爆炸、撞擊時晃動畫面')}${check('fps', '顯示 FPS', '戰鬥畫面右上角')}${check('detail', '卡片顯示完整說明', '預設精簡；按 Shift 可以臨時切換')}
        <h3>操作</h3><div class="st-box set-keys">${keys}</div>
        <h3>測試</h3>
        ${check('unlockAll', '全部解鎖', '飛船、武器、晶片、章節全開（測試用；解鎖進度照樣記）')}
        <h3>版本</h3>
        <div class="row"><span class="ver">${CFG.VERSION}</span><button data-act="refresh">🔄 清暫存重新整理</button></div>
      </div></div>`);
  },
  settingsBack() {
    if (this.settingsFrom === 'pause' && Game.state === 'play') this.pauseMenu();
    else if (Hub.shown()) this.hubView();
    else this.title();
  },
  // 離開遊戲後的結算（跟死亡畫面一樣的統計，標題是「中途結束」；多人打完一章結束遠征是「完成」）
  //   多人：每個人各自看、各自按「回到房間」（房主結束遠征後隊友不會被拉回去）
  ended() {
    const rec = ['run', 'coop'].includes(Game.mode), coop = Game.mode === 'coop';
    const where = coop ? Net.whereText() : Game.mode === 'run' ? Game.buildRecord('retired').where : `第 ${Game.combat ? Game.combat.wave : 0} 波`;
    const head = Game.endCleared ? `<h1 style="color:#ffd166;text-shadow:0 0 18px #ffd166">${Game.chapter().name}　完成！</h1>` : '<h1 style="color:#8fa3d9;text-shadow:0 0 18px #8fa3d9">中途結束</h1>';
    const back = coop && Net.roomOpen() ? '<button class="big" data-act="netroom">回到房間</button><button data-act="title">離開房間</button>' : '<button class="big" data-act="title">回到基地</button>';
    this.show(`<div class="scr title-wrap">
      ${head}
      <div class="sub">結束在 ${where} · 剩餘晶體 ${Game.credits}${rec ? '<br><span style="color:#6a79ad">這一局已存入「遊玩紀錄」</span>' : ''}</div>
      ${coop ? NetView.teamSummaryHtml() : ''}
      ${this.runSummary()}
      <div class="row">${!coop ? `<button class="big" data-act="run" data-arg="${Game.mode}">重新開始</button>` : ''}
        ${back}</div>
      ${rec ? '<div class="row" style="margin-top:0"><button data-act="copyrun">📋 複製這局紀錄</button><button data-act="records">📜 所有遊玩紀錄</button></div><div id="copyBox"></div>' : ''}</div>`);
  },
  dead() {
    const run = Game.mode === 'run';
    if (Game.mode === 'coop') {
      this.show(`<div class="scr title-wrap">
        <h1 style="color:#ff4d6d;text-shadow:0 0 18px #ff4d6d">${Game.mates.length > 1 ? '全機覆滅' : '雙機全毀'}</h1>
        <div class="sub">倒在 ${Net.whereText()} · 剩餘晶體 ${Game.credits}${Game.lastHit ? `<br>擊毀原因：${Game.lastHit}` : ''}<br>
          <span style="color:#6a79ad">這一局已存入「遊玩紀錄」（含連線延遲數據）</span></div>
        ${NetView.teamSummaryHtml()}
        ${this.runSummary()}
        <div class="row">${Net.roomOpen() ? '<button class="big" data-act="netroom">回到房間</button><button data-act="title">離開房間</button>' : '<button class="big" data-act="title">回到基地</button>'}</div>
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
      <button class="big" data-act="title">回到基地</button></div>
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
      ${pk('chain', '🔌', '電路插槽 +1', `多一格放晶片（${V.pick === 'chain' ? '現在' : '目前'} ${Game.chain.length} 格）`, '#4cc9f0')}
      ${pk('part', '⚙', '零件格 +1', `多疊一層零件（${V.pick === 'part' ? '現在' : '目前'} ${Game.partSlots} 格，已用 ${partsUsed(Game.parts)}）`, '#9fe8ff')}</div>`;
    const head = cleared
      ? `<h1 style="color:#ffd166;text-shadow:0 0 18px #ffd166">${Game.chapter().name}　完成！</h1>
        <div class="sub">${boss.name}已被擊沉。<br><i style="color:#c8d4ff">${Game.chapter().outro}</i><br>${reward}<br>
          可以帶著目前的電路繼續挑戰<b style="color:#ff9dbd">無盡模式</b>：敵人持續變強，旗艦隨機出現。選「結束遠征」會存下通關紀錄。</div>`
      : `<h1>星區 ${Game.sector} 突破！</h1><div class="sub">${boss.name}已被擊沉。<br>${reward}</div>`;
    this.show(`<div class="scr title-wrap">${head}
      ${pick}
      ${this.status()}
      ${Game.mode === 'coop' ? NetView.teamSummaryHtml() : ''}
      ${this.runSummary()}
      ${Game.isClient() ? `<div class="sub" style="color:#ff9dbd">${!V.pick ? '👥 房主在等你：先選二選一的獎勵' : '👥 等待房主決定：前往下一星區，或結束遠征…'}</div>` : `
      ${!V.pick ? '<div class="sub" style="color:#ffd166">先選一個獎勵才能前往</div>' : ''}${wait ? '<div class="sub" style="color:#ff9dbd">👥 等隊友選好獎勵…</div>' : ''}
      <div class="row"><button class="big" data-act="next"${wait || !V.pick ? ' style="opacity:.45"' : ''}>${cleared ? '繼續無盡模式' : Game.isEndless() ? `前往星區 ${Game.sector + 1}（無盡）` : `前往星區 ${Game.sector + 1}`}</button>
        <button class="big" data-act="finish">結束遠征</button></div>`}
      <div class="row" style="margin-top:0"><button data-act="copyrun">📋 複製這局紀錄</button></div><div id="copyBox"></div></div>`);
  },

  // 這一局新達成的解鎖條件（結算畫面；回到基地時也顯示一次，例如通關後直接回基地）；btn = 「回基地看」按鈕（第一樣在哪個面板就打開哪個）
  unlockFreshHtml(btn = true) {
    const F = Game.unlockFresh || [];
    if (!F.length) return '';
    const P = BASE_PANELS.find(p => p.kinds.includes(F[0].kind)), arg = P ? ` data-arg="${P.id}"` : '';  // 飛船沒有面板：回基地，停機坪上有「新」
    return `<div class="ulk-fresh">🔓 ${CFG.UNLOCK_ALL ? '達成解鎖條件' : '新解鎖'}：${F.map(u => `<b>${unlockName(u.kind, u.id)}</b>`).join('、')}${btn ? `<button data-act="base"${arg}>回基地看</button>` : ''}</div>`;
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
        S ? `<div><b>最後的電路數值</b><br>插槽 ${S.slots}${S.lines ? `、${S.lines} 條線` : ''}${S.heat != null ? `、能量 ⚡${S.heat}${S.cap != null ? ' / ' + S.cap : ''}` : ''}、每秒 ${S.rps} 發、每發 ${S.perFire} 顆共 ${S.fireDmg} 傷害、估算 DPS ${S.estDps}、擊退 ${S.knock}${S.passives.length ? `<br>倉庫被動：${S.passives.join('、')}` : ''}</div>` : '',
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
  // 房間列的「複製」：房號放進剪貼簿，按鈕變「✓ 已複製」1.5 秒；被擋時把房號選起來，按鈕改提示按 Ctrl+C
  copyCode(btn) {
    const show = t => { btn.textContent = t; setTimeout(() => { if (btn.isConnected) btn.textContent = '📋 複製'; }, 1500); };
    const fallback = () => { const el = btn.parentElement.querySelector('.code'), r = document.createRange(); r.selectNodeContents(el); const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r); show('按 Ctrl+C'); };
    try { navigator.clipboard.writeText(Net.code).then(() => show('✓ 已複製'), fallback); } catch (e) { fallback(); }
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
  enemy: { 蟲群: '蟲', 刺殼: '刺', 噴吐者: '噴', 虛空獵手: '獵', 砲艦: '砲', 拖曳艦: '拖', 三艦編隊: '隊',星噬母艦: '母', 裂界獵艦: '裂', 終焉核心: '核', 雙子獵艦: '雙', 星環守門者: '門', 瞄準砲塔: '瞄', 環形砲塔: '環', 轟炸砲塔: '轟', 召喚砲塔: '召', 彗星: '彗', 黑洞核心: '洞',
    彈幕艇: '艇', 列隊蟲: '列', 盾衛: '盾', 分裂體: '分', 碎裂體: '碎', 潛伏者: '潛', 母巢: '巢' },
  result: { dead: '死', cleared: '通', retired: '退', disconnect: '斷線', in_progress: '進行中' },
  src: { 直接命中: '直擊', 武器直擊: '直擊', '命中觸發（回響）': '回響', 攔截回射: '回射', 震盪衝撞: '衝撞' },
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
  L.push(`電路 ${wsk ? '武器' + wsk[0] + '｜' : ''}${(r.chain || []).slice(1).map(chip).join('｜')}${S ? `（${S.lines ? S.lines + '條線 ' : S.heat != null ? `能量${S.heat}${S.cap != null ? '/' + S.cap : ''} ` : ''}${S.rps}發/秒 每發${S.perFire}顆${S.fireDmg} 估${S.estDps}）` : ''}${r.inv && r.inv.length ? ` 倉庫 ${r.inv.map(chip).join(' ')}` : ''}`);
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
  if (r.perf && r.perf.worst) L.push(`效能 最慢一幀${r.perf.worst}ms(${r.perf.worstAt}) 卡>100ms ${r.perf.slow}次`);
  // 防呆刪了子彈：這局有組合會爆量，要修。來源＋當時電路用來追是哪個組合（舊紀錄沒有這兩項）
  const cap = r.cap;
  if (cap && cap.n) L.push(`子彈上限 觸發${cap.n}幀 刪${cap.cut}顆 最多${cap.max}顆(${cap.at})${cap.first && cap.first !== cap.at ? ` 第一次(${cap.first})` : ''}`
    + `${cap.src && cap.src.length ? `｜來源 ${cap.src.map(([k, v]) => { const m = /^(.+?)(・回響)?$/.exec(k); return chip(m[1]) + (m[2] ? '回響' : '') + v; }).join(' ')}` : ''}`
    + `${cap.chain && cap.chain.length ? `｜當時電路 ${(cap.chain[0].match(/［.+］/) || []).map(s => '武器' + s + '｜').join('')}${cap.chain.slice(1).map(chip).join('｜')}` : ''}`);  // 武器格只寫插座上的組件（同「電路」那行）
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
