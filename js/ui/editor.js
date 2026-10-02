// 星環電路 雙人版 · editor.js：電路編輯器（Tab）：拖放、插座、晶片傷害統計分頁
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// EDITOR UI — 電路 / 倉庫 拖放
// =====================================================================
const Editor = {
  init() {
    const $ = id => document.getElementById(id);
    this.el = $('editor'); this.chainEl = $('chain'); this.invEl = $('inv'); this.libEl = $('library');
    this.statsEl = $('stats'); this.layersEl = $('layers'); this.passEl = $('passives'); this.infoEl = $('info');
    this.recycleEl = $('recycle'); this.creditsEl = $('edCredits'); this.toolsEl = $('sandboxTools');

    const R = this.recycleEl;
    R.addEventListener('dragover', e => { e.preventDefault(); R.classList.add('over'); });
    R.addEventListener('dragleave', () => R.classList.remove('over'));
    R.addEventListener('drop', e => {
      e.preventDefault(); R.classList.remove('over');
      const d = parseDrag(e);
      if (d) this.recycle(d);
    });
    R.addEventListener('click', () => { if (this.sel) this.recycle(this.sel); });
    this.selbarEl = $('selbar');
    this.selbarEl.addEventListener('click', e => {
      const b = e.target.closest('[data-sel]');
      if (!b || !this.sel) return;
      const ref = this.ref(this.sel);
      if (b.dataset.sel === 'move' && ref) { this.sel = null; this.quickMove(ref.arr, ref.i); }
      if (b.dataset.sel === 'lv' && ref && ref.arr[ref.i]) {  // 沙盒／靶場：改等級，保持選取
        ref.arr[ref.i] = chipId(baseOf(ref.arr[ref.i]), +b.dataset.lv, socketsOf(ref.arr[ref.i]));
        this.showInfo(ref.arr[ref.i]);
        this.changed();
      }
      if (b.dataset.sel === 'recycle') this.recycle(this.sel);
      if (b.dataset.sel === 'cancel') { this.sel = null; this.render(); }
    });

    this.mainEl = $('edMain'); this.dmgEl = $('edDmg'); this.shipEl = $('edShip'); this.shipTabEl = $('edShipTab');
    this.shipEl.addEventListener('click', e => {  // 靶場：換機體、換武器
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      SFX.play('click');
      const [kind, id, v] = b.dataset.pick.split(':');
      if (!Game.freePlay()) return;  // 遠征、雙人：只能看
      if (kind === 'ship') Game.swapShip(id);
      else if (kind === 'part') {  // 沙盒／靶場：直接加減零件層數（不受零件格限制）
        Game.parts[id] = clamp((Game.parts[id] || 0) + +v, 0, 8);
        Game.recalc();
      } else if (kind === 'module') { Game.module = MODULES[id] ? id : null; Game.recalc(); }
      else if (kind === 'weapon') { Game.weapon = { id, path: null, final: null }; Game.refreshWeapon(); }
      else {
        const [path, final] = id.split('.');
        Game.weapon.path = path || null;
        Game.weapon.final = final ? +final : null;
        Game.refreshWeapon();
      }
      this.render();
      this.renderShip();
    });
    $('edTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-etab]');
      if (b) { SFX.play('click'); this.setTab(b.dataset.etab); }
    });
    $('btnClose').onclick = () => Game.toggleEditor();
    this.quitEl = $('btnQuit');
    this.quitEl.onclick = () => {  // 靶場、沙盒：沒有結算畫面，從這裡離開
      Game.toggleEditor();
      if (Net.linked) { Net.backToRoom(); return; }
      Game.state = 'title'; Game.inArena = false; Screen.title();
    };
    $('btnMute').onclick = () => { SFX.init(); SFX.setMuted(!SFX.muted); };
    $('btnCodex').onclick = () => Codex.open(Game.player ? 'current' : 'rules');
    $('btnAdd').onclick = () => { if (Game.chain.length < CFG.MAX_SLOTS) { Game.chain.push(null); this.changed(); } };
    $('btnRemove').onclick = () => { if (Game.chain.length > 1) { Game.chain.pop(); this.changed(); } };
    $('btnClear').onclick = () => { Game.chain = Game.chain.map((_, i) => i === 0 ? 'weapon' : null); this.changed(); };
    this.wpnEl = $('wpnTools');
    this.wpnEl.addEventListener('click', e => {  // 沙盒：直接切換武器升級
      const b = e.target.closest('[data-w]');
      if (!b) return;
      const [path, final] = b.dataset.w.split(':');
      Game.weapon.path = path || null;
      Game.weapon.final = final === '' || final == null ? null : +final;
      Game.refreshWeapon();
      this.render();
    });
    document.querySelectorAll('[data-preset]').forEach(btn => {
      btn.onclick = () => { Game.chain = PRESETS[btn.dataset.preset].map(fullChip); this.changed(); };
    });

    this.libChips = {};
    for (const id of Object.keys(CHIPS).filter(id => !CHIPS[id].hidden)) {
      const el = chipEl(id);
      el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'lib', id })));
      el.addEventListener('click', () => {  // 點選後再點插槽放入
        const same = this.sel && this.sel.from === 'lib' && this.sel.id === id;
        this.sel = same ? null : { from: 'lib', id };
        this.showInfo(id);
        this.render();
      });
      this.libChips[id] = el;
      this.libEl.appendChild(el);
    }
  },
  sel: null,
  lockedMsg(id) {  // 武器鎖定在第 1 格
    this.sel = null;
    this.showInfo(id);
    this.render();
  },
  recycle(d) {
    this.sel = null;
    const ref = this.ref(d);
    if (!ref || !ref.arr[ref.i]) { this.render(); return; }
    if (CHIPS[ref.arr[ref.i]].locked) return this.lockedMsg(ref.arr[ref.i]);
    if (!Game.freePlay()) Game.earn(sellPrice(ref.arr[ref.i]));  // 雙人：回收的錢進共用的錢包
    ref.arr[ref.i] = null;
    this.changed();
  },
  tapSlot(arr, i, from) {
    const s = this.sel;
    if (s) {
      this.sel = null;
      if (s.from === from && s.index === i) this.render();
      else this.dropOn(arr, i, s);
      return;
    }
    if (arr[i] && CHIPS[arr[i]].locked) return this.lockedMsg(arr[i]);
    if (arr[i]) { this.sel = { from, index: i }; this.showInfo(arr[i]); this.render(); }
  },
  open() {
    this.sel = null;
    this.toolsEl.classList.toggle('hidden', !Game.freePlay());
    this.quitEl.classList.toggle('hidden', !Game.freePlay());
    this.showDefaultInfo();
    this.render();
    this.setTab(this.tab);  // 停在上次的分頁；統計分頁每次打開都重算
    this.el.classList.remove('hidden');
  },
  close() { this.el.classList.add('hidden'); },
  tab: 'main',
  setTab(tab) {
    this.tab = tab;
    document.querySelectorAll('[data-etab]').forEach(b => b.classList.toggle('on', b.dataset.etab === tab));
    this.mainEl.classList.toggle('hidden', tab !== 'main');
    this.dmgEl.classList.toggle('hidden', tab !== 'dmg');
    this.shipEl.classList.toggle('hidden', tab !== 'ship');
    if (tab === 'dmg') this.renderDmg();
    if (tab === 'ship') this.renderShip();
  },
  // 機體分頁：零件、背包模組、已開啟的特性（遠征／雙人只能看）；沙盒／靶場另外可以換機體、武器、直接調零件和模組
  renderShip() {
    const on = (yes, col) => yes ? `outline:2px solid ${col};outline-offset:2px` : '';
    const free = Game.freePlay(), T = Game.mech.traits, M = Game.mech;
    const traits = [...PART_IDS.flatMap(id => [PARTS[id].t2, PARTS[id].t4]).filter(t => T[t.id]), ...(T.balance ? [BALANCE] : [])];
    const partCards = PART_IDS.map(id => partCard(id, free ? `<div class="bar"><button data-pick="part:${id}:-1">−1 層</button><button data-pick="part:${id}:1">+1 層</button></div>` : '')).join('');
    const modCards = (free ? Object.keys(MODULES) : Game.module ? [Game.module] : []).map(id =>
      moduleCard(id, free ? `<button data-pick="module:${id}">${Game.module === id ? '使用中' : '裝上'}</button>` : '')).join('');
    const SH = SHIPS[Game.shipId];  // 目前的飛船：名稱、特殊能力（遠征中也看得到）
    const mech = (SH ? `<h3 style="color:${SH.color}">${SH.name}</h3>
      <div class="sub"><b style="color:${SH.color}">${SH.abilityName}</b>：${SH.abilityDesc}　·　船體 ${SH.hp}　·　速度 ${SH.speed}　·　衝刺冷卻 ${SH.dashCd} 秒　·　零件格 ${SH.partSlots}</div>` : '') +
      `<h3>零件 ${partsUsed(Game.parts)} / ${Game.partSlots} 格${free ? '（沙盒／靶場不受格數限制）' : ''}</h3>
      <div class="sub">最大 HP ${Game.player.maxHp}　·　移動速度 ×${M.speed.toFixed(2)}　·　受到的傷害 ×${M.taken.toFixed(2)}　·　射速 ×${M.rate.toFixed(2)}　·　子彈速度 ×${M.bspeed.toFixed(2)}　·　衝刺冷卻 ×${M.dashCd.toFixed(2)}
        <br>已開啟的特性：${traits.length ? traits.map(t => `<b style="color:#9dff6b" title="${t.desc}">${t.name}</b>`).join('、') : '無'}${M.heavy ? '　·　<span style="color:#ffd166">模組裝甲加成</span>' : ''}${M.light ? '　·　<span style="color:#4cc9f0">模組加速加成</span>' : ''}</div>
      <div class="cards" style="margin:8px 0">${partCards}</div>
      <h3>背包模組${free ? ` <button data-pick="module:none">拿掉模組</button>` : ''}</h3>
      <div class="cards" style="margin:8px 0">${modCards || '<div class="sub">還沒有背包模組（精英戰鬥勝利後三選一）。</div>'}</div>`;
    if (!free) { this.shipEl.innerHTML = mech + '<p class="hint">零件在「🔧 改裝廠」取得或更換，背包模組來自精英戰鬥與擊沉旗艦。</p>'; return; }
    const ships = Object.entries(SHIPS).map(([id, S]) => `<div class="card" style="border-color:${S.color};${on(Game.shipId === id, S.color)}">
        <div class="ttl" style="color:${S.color}">${S.name}</div>
        <div class="ty">船體 ${S.hp}　·　速度 ${S.speed}　·　衝刺冷卻 ${S.dashCd} 秒　·　零件格 ${S.partSlots}</div>
        <div class="ds">${S.desc}<br><b style="color:${S.color}">${S.abilityName}</b>：${S.abilityDesc}</div>
        <button data-pick="ship:${id}">${Game.shipId === id ? '使用中' : '換成' + S.name}</button></div>`).join('');
    const weapons = Object.entries(WEAPONS).map(([id, W]) => {
      const p = weaponParams({ id, path: null, final: null });
      return `<div class="card" style="border-color:${W.color};${on(Game.weapon.id === id, W.color)}">
        <div class="ttl" style="color:${W.color}">${W.name}</div>
        <div class="ty">單發 ${p.damage} × ${p.count}　·　每秒 ${(1 / p.interval).toFixed(1)} 次</div>
        <div class="ds">${W.desc}</div>
        <button data-pick="weapon:${id}">${Game.weapon.id === id ? '使用中' : '換成' + W.name}</button></div>`;
    }).join('');
    const W = WEAPONS[Game.weapon.id], st = Game.weapon;
    const up = (key, label, cur, desc) => `<button data-pick="up:${key}" title="${desc.replace(/<[^>]+>/g, '')}"
      style="${cur ? `border-color:${W.color};color:${W.color}` : ''}">${label}</button>`;
    let ups = up('', '基礎型', !st.path, W.desc);
    for (const [k, P] of Object.entries(W.paths)) {
      ups += up(k, P.name, st.path === k && st.final == null, P.desc);
      P.next.forEach((n, i) => ups += up(`${k}.${i}`, `${P.name}→${n.name}`, st.path === k && st.final === i, n.desc));
    }
    this.shipEl.innerHTML = `${mech}
      <h3>換飛船（換成它的開局零件）</h3><div class="cards" style="margin:8px 0">${ships}</div>
      <h3>武器</h3><div class="cards" style="margin:8px 0">${weapons}</div>
      <h3>武器升級：<span style="color:${W.color}">${weaponTitle(st)}</span></h3><div class="bar">${ups}</div>
      <p class="hint">換飛船或武器時電路與倉庫都會保留，HP 回滿、靶場數據歸零。</p>`;
  },
  // 晶片傷害統計：本關（目前星區）與整局，依整局傷害排序
  renderDmg() {
    const R = Game.runStats;
    if (!R) { this.dmgEl.innerHTML = '<div class="sub">還沒有開始遊戲。</div>'; return; }
    let S = Game.sectorStats;
    if (Game.isClient()) {  // 隊友：傷害由房主算好傳過來，本關 = 整局 − 這一關開始時
      const c0 = S.chips0 || {};
      S = { chips: Object.fromEntries(Object.entries(R.chips).map(([k, v]) => [k, Math.max(0, v - (c0[k] || 0))])) };
    }
    const keys = [...new Set([...Object.keys(R.chips), ...Object.keys(S.chips)])]
      .sort((a, b) => (R.chips[b] || 0) - (R.chips[a] || 0));
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const tR = sum(R.chips), tS = sum(S.chips);
    const fmt = n => Math.round(n).toLocaleString('zh-TW');
    const color = dmgKeyColor;
    const cell = (v, t, c) => `<td>${fmt(v || 0)}<span class="pct">${t ? Math.round((v || 0) / t * 100) : 0}%</span>
      <div class="bar"><div style="width:${t ? ((v || 0) / t * 100).toFixed(1) : 0}%;background:${c}"></div></div></td>`;
    const rows = keys.map(k => {
      const where = k === 'weapon' || k === 'ship' ? '' : Game.chain.some(id => id && baseOf(id) === k) ? ''
        : '<span style="color:#6a79ad">（目前不在電路上）</span>';
      return `<tr><td><b style="color:${color(k)}">${dmgKeyName(k)}</b>${where}</td>${cell(S.chips[k], tS, color(k))}${cell(R.chips[k], tR, color(k))}</tr>`;
    }).join('');
    const label = Game.freePlay() ? (Game.mode === 'range' ? '本次靶場' : '本次沙盒') : Game.isEndless() ? `本關（無盡 · 星區 ${Game.sector}）` : `本關（星區 ${Game.sector}）`;
    const coop = Game.mode === 'coop' && Game.mate, mate = coop && Net.mateChipRows();
    const me = coop ? `<h3>${Net.role === 'host' ? '1P' : '2P'}（你）</h3>` : '';
    const mateTable = !mate ? '' : `<h3>${mate.tag} 隊友（整局）</h3>
      <table class="dmg-table"><thead><tr><th>來源</th><th>整局</th></tr></thead>
        <tbody>${mate.rows.map(([n, c, v]) => `<tr><td><b style="color:${c}">${n}</b></td>${cell(v, mate.total, c)}</tr>`).join('')
          || '<tr><td colspan="2" class="sub">還沒有造成傷害。</td></tr>'}</tbody>
        <tfoot><tr><td><b>合計</b></td><td>${fmt(mate.total)}</td></tr></tfoot></table>`;
    this.dmgEl.innerHTML = `${coop ? Net.teamSummaryHtml() : ''}${me}
      <table class="dmg-table"><thead><tr><th>來源</th><th>${label}</th><th>整局</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="sub">還沒有造成傷害。</td></tr>'}</tbody>
        <tfoot><tr><td><b>合計</b></td><td>${fmt(tS)}</td><td>${fmt(tR)}</td></tr></tfoot></table>
      ${mateTable}
      <p class="hint">怎麼算：每顆子彈的基礎傷害算給產生它的來源（武器；鏡像複製出的子彈算鏡像迴路；觸發器的回響算觸發器）。
        加工過子彈的晶片（倍增、分裂、巨大化…）依它讓傷害變成幾倍，按比例分走多出來的傷害；超頻、冷卻管線依射速提升分攤。
        爆炸、碎片、電弧、燃燒跟著原本那顆子彈算。共振器的效果算在被共振的晶片上。${coop ? '雙人：傷害由房主計算，每秒同步一次。' : ''}</p>`;
  },
  changed() { Game.recalc(); this.render(); },
  ref(d) {
    if (d.from === 'slot') return { arr: Game.chain, i: d.index };
    if (d.from === 'inv') return { arr: Game.inventory, i: d.index };
    return null;
  },
  dropOn(arr, i, d) {
    const src = this.ref(d), id = d.from === 'lib' ? d.id : src && src.arr[src.i];
    if (arr === Game.chain && isHost(arr[i]) && id) {
      if (isComp(id)) return this.plug(i, d);  // 組件拖到晶片（或武器）上 = 插進它的插座
      if (src && src.arr === Game.chain && src.i !== i && isHost(id) && !CHIPS[arr[i]].locked && !CHIPS[id].locked) return this.swapGroups(src.i, i);
    }
    if (arr[i] && CHIPS[arr[i]].locked) return this.lockedMsg(arr[i]);  // 武器格不能放東西
    if (d.from === 'lib') {  // 沙盒：放到同種玩法晶片上 = 升一級；新放的宿主插座給滿
      if (arr[i] && baseOf(arr[i]) === d.id && canLevelUp(arr[i])) arr[i] = chipId(d.id, levelOf(arr[i]) + 1, socketsOf(arr[i]));
      else arr[i] = newChip(d.id, CFG.MAX_SOCKETS);
    } else {
      const s = this.ref(d);
      if (s.arr === arr && s.i === i) return;
      [arr[i], s.arr[s.i]] = [s.arr[s.i], arr[i]];
    }
    this.changed();
  },
  // ---------- 插座：組件直接插進晶片 ----------
  groupOf(i) {  // 宿主 i 和插在它上面的組件（電路的 index，由小到大）
    const info = compileChain(Game.chain).info;
    return [i, ...info.map((I, j) => (I.role === 'comp' && I.host === i ? j : -1)).filter(j => j >= 0)];
  },
  canPlug(hostId, compId, used) {  // 不能插的原因（可以插回傳空字串）
    const b = baseOf(compId), hb = baseOf(hostId);
    if (used >= socketsOf(hostId)) return `${CHIPS[hostId].name}的插座滿了（${socketsOf(hostId)} 個）`;
    if (b === 'overclock' && hostId !== 'weapon') return '超頻是整條電路的射速，只能插在武器上';
    if (hb === 'pull' && b !== 'bigshot' && b !== 'mirror') return '吸引的產物是拉力，只能插巨彈';
    return '';
  },
  // 把組件 d（倉庫、沙盒晶片庫、電路上別的位置）插到宿主 h：放在它最後一個組件後面，吃掉一個空格（組件也佔一格電路）
  plug(h, d) {
    const C = Game.chain, src = this.ref(d), id = d.from === 'lib' ? d.id : src && src.arr[src.i];
    if (!id) return;
    const grp = this.groupOf(h).filter(j => !(src && src.arr === C && src.i === j));
    if (src && src.arr === C && grp.length === this.groupOf(h).length - 1) return this.render();  // 本來就插在這個晶片上
    const why = this.canPlug(C[h], id, grp.length - 1);
    if (why) return this.warn(why);
    if (src) src.arr[src.i] = null;
    const pos = Math.max(...grp) + 1, SA = Game.slotAttr = Game.slotAttr || [];
    while (SA.length < C.length) SA.push(null);
    const move = (k, to) => { C.splice(k, 1); C.splice(to, 0, id); SA.splice(to, 0, SA.splice(k, 1)[0]); };  // 屬性跟著那個空格走
    let k = C.indexOf(null, pos);
    if (k >= 0) move(k, pos);
    else if ((k = C.lastIndexOf(null, pos - 1)) > 0) move(k, pos - 1);
    else { if (src) src.arr[src.i] = id; return this.warn('電路格滿了：組件也佔一格電路，先空出一格（或在補給站買插槽）'); }
    this.sel = null;
    this.changed();
  },
  // 兩個晶片連同插座上的組件一起交換位置
  swapGroups(a, b) {
    const C = Game.chain, used = new Set(), blocks = [];
    for (let i = 0; i < C.length; i++) {
      if (used.has(i)) continue;
      const g = C[i] && isHost(C[i]) ? this.groupOf(i) : [i];
      g.forEach(j => used.add(j));
      blocks.push(g);
    }
    const A = blocks.findIndex(g => g[0] === a), B = blocks.findIndex(g => g[0] === b);
    [blocks[A], blocks[B]] = [blocks[B], blocks[A]];
    const SA = Game.slotAttr || [];
    Game.chain = blocks.flatMap(g => g.map(j => C[j]));
    Game.slotAttr = blocks.flatMap(g => g.map(j => SA[j] || null));  // 晶片連插件、連黑洞屬性一起換位置
    this.sel = null;
    this.changed();
  },
  warn(msg) { this.sel = null; this.render(); this.infoEl.innerHTML = `<b style="color:#ff8a8a">✖ ${msg}</b>`; },
  quickMove(arr, i) {  // 右鍵：電路 ⇄ 倉庫
    const id = arr[i];
    if (!id) return;
    if (CHIPS[id].locked) return this.lockedMsg(id);
    const target = arr === Game.chain ? Game.inventory : Game.chain;
    const j = target.indexOf(null);
    if (j >= 0) { target[j] = id; arr[i] = null; }
    else if (Game.freePlay() && arr === Game.chain) arr[i] = null;
    this.changed();
  },
  showDefaultInfo() {
    this.infoEl.innerHTML = '電路由左至右執行：第 1 格固定是<b style="color:#4cc9f0">你的武器</b>（插座開局 1 個，每打完一隻王 +1，最多 3 個）→ <b style="color:#5ef2d0">玩法晶片</b>依序改變子彈的玩法。' +
      '<b style="color:#ffd166">◇ 組件</b>（分裂、巨彈、穿甲、倍增、超頻、鏡像）插在<b>左邊最近</b>的武器／玩法晶片／觸發器上：插在武器上作用在全部子彈，插在玩法晶片上只作用在它的產物（例：插在環繞上 = 放出的那一波）。' +
      '<b style="color:#ff6b9d">觸發器</b>（命中／消失／定時）用武器再射一次回響（50%），右邊的晶片只作用在回響上。點晶片可看說明。';
  },
  showInfo(id, slot = -1) {
    if (!id) { this.infoEl.innerHTML = slot > 0 ? `第 ${slot + 1} 格：空插槽${slotAttrLine(slot)}` : ''; return; }
    const d = CHIPS[id], m = TYPE_META[d.type];
    const P = HOST_PRODUCT[baseOf(id)];
    const ps = isComp(id) ? '<br><span style="color:#ffd166">◇ 組件：拖到武器、玩法晶片或觸發器上就插進它的插座（佔一格電路）。</span>'
      : P ? `<br><span style="color:#ffd166">◇ 插座 ${socketsOf(id)} 個　插在它上面的組件只作用在：${P}</span>` : '';
    const price = !Game.freePlay() ? `　回收價 ◆${sellPrice(id)}` : '';
    this.infoEl.innerHTML = `<b style="color:${m.color}">${m.icon} ${d.name}</b>　` +
      `<span style="color:#6a79ad">${m.label} · 能量負載 ⚡${d.cost}${d.cost ? `（裝上電路射速 -${Math.round(d.cost * CFG.HEAT_RATE * 100)}%）` : ''}${price}</span><br>${d.desc}` +
      `${!d.lv && LV_INFO[id] ? '<br>' + lvLine(id, 1) : ''}${ps}` +
      (CHIPS[baseOf(id)].grow ? '<br>' + growLine(id, Game.growth, Game.runStats ? Game.runStats.time / 60 : 0) : '') +
      (slot > 0 ? slotAttrLine(slot) : '');
  },

  // 每格狀態（見 compileChain）：role 宿主／組件、host 插在第幾格、seg 在第幾層觸發、idle 沒有作用（why 原因）
  slotInfo(chain) { return compileChain(chain).info; },

  // 插座：一個大圓。j = 插在這裡的組件在電路上的 index（空的插座沒有）；over = 超過插座數（沒作用）
  sockEl(h, j, over, attrCls, A) {
    const el = document.createElement('div'), C = Game.chain, id = j != null ? C[j] : null;
    if (id) {
      const I = compileChain(C).info[j], m = TYPE_META[CHIPS[id].type];
      el.className = 'sock' + (I.idle ? ' idle' : '') + attrCls(j) + (this.sel && this.sel.from === 'slot' && this.sel.index === j ? ' sel' : '');
      el.style.borderColor = m.color; el.style.color = m.color;
      el.innerHTML = `<span>${CHIPS[id].short || CHIPS[id].name}</span>${A[j] ? `<i class="sa ${SLOT_ATTRS[A[j]].good ? 'good' : 'bad'}">${SLOT_ATTRS[A[j]].good ? '✺' : '✖'}</i>` : ''}`;
      el.title = `${CHIPS[id].name}：${chipBrief(id)}${I.idle ? `\n✖ 沒有作用：${I.why}` : ''}${A[j] ? `\n黑洞：${SLOT_ATTRS[A[j]].name}` : ''}`;
      el.draggable = true;
      el.addEventListener('dragstart', e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'slot', index: j })); });
      el.addEventListener('mouseenter', () => this.showInfo(id, j));
      el.addEventListener('contextmenu', e => { e.preventDefault(); this.sel = null; this.quickMove(C, j); });
      el.addEventListener('click', e => { e.stopPropagation(); this.tapSlot(C, j, 'slot'); });
    } else {
      el.className = 'sock empty' + (over ? ' idle' : '');
      el.textContent = '+';
      el.title = `空的插座：把組件拖到這裡（或點選組件再點這裡）插進${CHIPS[C[h]].name}`;
      el.addEventListener('mouseenter', () => { this.infoEl.innerHTML = `<b style="color:#ffd166">◇ ${CHIPS[C[h]].name}的空插座</b>：把組件拖到這裡插進去。插在它上面的組件只作用在：${HOST_PRODUCT[baseOf(C[h])] || ''}`; });
      el.addEventListener('click', e => { e.stopPropagation(); if (this.sel) { const d = this.sel; this.sel = null; this.plug(h, d); } });
    }
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); const d = parseDrag(e); if (d) this.plug(h, d); });
    return el;
  },

  makeSlot(arr, i, from, label, cls, idle, why) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (cls ? ' ' + cls : '');
    slot.innerHTML = `<span class="idx">${label}</span>`;
    const id = arr[i];
    if (id) {
      const el = chipEl(id);
      if (idle) { el.classList.add('idle'); el.title = why; }
      if (this.sel && this.sel.from === from && this.sel.index === i) el.classList.add('sel');
      el.addEventListener('dragstart', e => e.dataTransfer.setData('text/plain', JSON.stringify({ from, index: i })));
      if (from === 'slot') el.addEventListener('mouseenter', e => { e.stopImmediatePropagation(); Editor.showInfo(id, i); }, true);
      slot.appendChild(el);
    } else {
      slot.insertAdjacentHTML('beforeend', '<span class="empty">空插槽</span>');
      if (from === 'slot') slot.addEventListener('mouseenter', () => this.showInfo(null, i));
    }
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('over'));
    slot.addEventListener('drop', e => {
      e.preventDefault(); slot.classList.remove('over');
      const d = parseDrag(e);
      if (d) this.dropOn(arr, i, d);
    });
    slot.addEventListener('contextmenu', e => { e.preventDefault(); this.sel = null; this.quickMove(arr, i); });
    slot.addEventListener('click', () => this.tapSlot(arr, i, from));
    return slot;
  },

  render() {
    const chain = Game.chain, info = this.slotInfo(chain);
    this.creditsEl.textContent = !Game.freePlay() ? `◆ ${Game.credits}` : Game.mode === 'range' ? '🎯 靶場' : '沙盒模式';
    this.recycleEl.innerHTML = !Game.freePlay() ? '♻ 回收<br>拖曳到這裡<br>換成晶體' : '✕ 移除<br>拖曳到這裡刪除';

    this.chainEl.innerHTML = '';
    const TRIG = { hit: '命中時', end: '消失時', time: '每 0.3 秒' }, A = Game.slotAttr || [];
    const attrCls = i => A[i] ? (SLOT_ATTRS[A[i]].good ? ' ag' : ' ab') : '';
    const badge = i => { const S = A[i] && SLOT_ATTRS[A[i]]; return S ? `<span class="sattr ${S.good ? 'good' : 'bad'}" title="${S.desc.replace(/<[^>]+>/g, '')}">${S.good ? '✺' : '✖'} ${S.name}</span>` : ''; };
    let lastHost = -1, first = true;
    const arrow = (cls, html) => { if (first) { first = false; return; } const ar = document.createElement('div'); ar.className = 'arrow' + cls; ar.innerHTML = html; this.chainEl.appendChild(ar); };
    chain.forEach((id, i) => {
      const I = info[i];
      if (I.role === 'comp' && I.host >= 0) return;  // 畫在宿主下面的插座裡
      const trig = lastHost >= 0 && info[lastHost].trig;
      arrow(trig ? ' trig' : '', trig ? '⤷<br>' + (TRIG[CHIPS[chain[lastHost]].trig] || '') : '→');
      if (I.role !== 'host') {  // 空格（或沒有宿主的組件）
        const slot = this.makeSlot(chain, i, 'slot', `${i + 1}${I.seg ? ' · 第' + I.seg + '層' : ''}`, (I.seg ? 'seg' + I.seg : '') + attrCls(i), I.idle, I.why);
        slot.insertAdjacentHTML('beforeend', badge(i));
        this.chainEl.appendChild(slot);
        return;
      }
      lastHost = i;
      const grp = document.createElement('div');
      grp.className = 'hgroup';
      const slot = this.makeSlot(chain, i, 'slot', `${i + 1}${I.seg ? ' · 第' + I.seg + '層' : ''}`, (I.seg ? 'seg' + I.seg : '') + attrCls(i), I.idle, I.why);
      slot.insertAdjacentHTML('beforeend', badge(i));
      grp.appendChild(slot);
      const socks = document.createElement('div');
      socks.className = 'socks';
      const comps = info.map((J, j) => (J.role === 'comp' && J.host === i ? j : -1)).filter(j => j >= 0);
      const n = Math.max(socketsOf(id), comps.length);
      for (let k = 0; k < n; k++) socks.appendChild(this.sockEl(i, comps[k], k >= socketsOf(id), attrCls, A));
      if (!n) socks.innerHTML = '<span class="nosock">沒有插座</span>';
      grp.appendChild(socks);
      this.chainEl.appendChild(grp);
    });
    const usedN = chain.filter(Boolean).length - 1;
    this.chainEl.insertAdjacentHTML('beforeend', `<div class="chaincount">電路 ${usedN} / ${chain.length - 1} 格<br><span>（組件也佔一格）</span></div>`);

    this.invEl.innerHTML = '';
    Game.inventory.forEach((_, i) => this.invEl.appendChild(this.makeSlot(Game.inventory, i, 'inv', '倉庫 ' + (i + 1))));

    const s = Game.stats, P = Game.passives;
    const stat = (k, v) => `<div class="stat">${k}<b>${v}</b></div>`;
    this.statsEl.innerHTML =
      stat('每次開火子彈', s.count + ' 顆') +
      stat('單次總傷害', s.dmg.toFixed(0)) +
      stat('射速', s.rps.toFixed(1) + ' 次/秒') +
      stat('估算 DPS（含命中效果）', s.dpsEst.toFixed(0)) +
      stat('總能量負載', `⚡ ${s.heat}<span style="display:block;font-size:11px;color:${s.heat ? '#ff9dbd' : '#8fa3d9'};margin-top:2px">射速 -${Math.round((1 - heatRateMul(s.heat)) * 100)}%</span>`);
    this.layersEl.innerHTML = s.layers.map((l, i) =>
      `◎ 第 ${i + 1} 層（${TRIG[l.trig] || ''}）：每次觸發展開 ${l.count} 顆 / ${l.dmg.toFixed(0)} 傷害`).join('　');
    const sa = Game.chain.map((_, i) => A[i] && `第 ${i + 1} 格 ${SLOT_ATTRS[A[i]].name}`).filter(Boolean);
    this.passEl.textContent = sa.length ? '黑洞強化的格子：' + sa.join('、') : '黑洞強化的格子：無';

    if (Game.freePlay()) {
      const W = WEAPONS[Game.weapon.id], st = Game.weapon;
      const btn = (key, label, on) => `<button data-w="${key}" style="${on ? `border-color:${W.color};color:${W.color}` : ''}">${label}</button>`;
      let h = btn(':', '基礎型', !st.path);
      for (const [k, P] of Object.entries(W.paths)) {
        h += btn(k + ':', P.name, st.path === k && st.final == null);
        P.next.forEach((n, i) => h += btn(`${k}:${i}`, `${P.name}→${n.name}`, st.path === k && st.final === i));
      }
      this.wpnEl.innerHTML = h;
    }

    for (const [id, el] of Object.entries(this.libChips))
      el.classList.toggle('sel', !!(this.sel && this.sel.from === 'lib' && this.sel.id === id));
    const S = this.sel, ref = S && this.ref(S), selId = ref && ref.arr[ref.i];
    if (S && S.from === 'lib') {
      this.selbarEl.innerHTML = `<span class="hint" style="margin:0">已選取「${CHIPS[S.id].name}」：點電路或倉庫的插槽放入</span><button data-sel="cancel">取消</button>`;
    } else if (selId) {
      const inChain = ref.arr === Game.chain, base = baseOf(selId);
      // 沙盒／靶場：直接切換晶片等級
      const lvs = Game.freePlay() && CHIPS[base].grow
        ? '<span class="hint" style="margin:0">等級</span>' + [1, 2, 3].slice(0, CFG.MAX_CHIP_LV).map(l =>
          `<button data-sel="lv" data-lv="${l}" style="${levelOf(selId) === l ? 'border-color:#9dff6b;color:#9dff6b' : ''}">Lv${l}</button>`).join('') : '';
      this.selbarEl.innerHTML = `<span class="hint" style="margin:0">已選取「${CHIPS[selId].name}」：點其他插槽移動或交換</span>
        ${lvs}
        <button data-sel="move">${inChain ? '移到倉庫' : '裝上電路'}</button>
        <button data-sel="recycle">${!Game.freePlay() ? `回收 ◆${sellPrice(selId)}` : '移除'}</button>
        <button data-sel="cancel">取消</button>`;
    } else this.selbarEl.innerHTML = '';
  },
};


// 黑洞強化的格子：這一格現在實際的效果（編輯器說明欄、黑洞結果畫面用）
function slotAttrLine(i) {
  const at = (Game.slotAttr || [])[i];
  if (!at) return '';
  const S = SLOT_ATTRS[at], id = Game.chain[i], col = S.good ? '#9dff6b' : '#ff8a8a';
  const CV = { amp: m => `傷害 +${Math.round(100 * m)}%`, split: m => `分裂成 ${Math.max(2, Math.round(3 + 2 * (m - 1)))} 顆`,
    pierce: m => `穿透 +${Math.round(2 * m)}`, bigshot: m => `合併後傷害 +${Math.round(30 * m)}%` };
  let fx;
  if (!id) fx = '這格現在是空的，放晶片進來才有效果';
  else if (at === 'eff' || at === 'weak') {
    const k = at === 'eff' ? 1.5 : 0.7, b = baseOf(id);
    fx = isComp(id) ? (CV[b] ? `${CV[b](1)} → <b>${CV[b](k)}</b>` : '這個組件沒有可以放大的數值') : `插在${CHIPS[id].name}上的組件效果 ×${k}`;
  } else if (at === 'free' || at === 'heavy') fx = `能量 ⚡${CHIPS[id].cost} → <b>⚡${slotHeat(id, at)}</b>`;
  else if (at === 'grow2' || at === 'nogrow') fx = CHIPS[baseOf(id)].grow ? `${CHIPS[baseOf(id)].name}${at === 'grow2' ? '的用量成長 ×2' : '不會成長'}` : '這格的晶片不會成長，沒有影響';
  else if (at === 'flaky') fx = `每 8 秒的最後 2 秒沒作用（現在：${flakyOff() ? '<b style="color:#ff8a8a">失效中</b>' : '作用中'}）`;
  else fx = S.desc;
  return `<br><b style="color:${col}">${S.good ? '✺' : '✖'} 黑洞強化・第 ${i + 1} 格：${S.name}</b>　${fx}`;
}

function chipEl(id) {
  const d = CHIPS[id], m = TYPE_META[d.type];
  const el = document.createElement('div');
  el.className = 'chip t-' + d.type;
  el.draggable = !d.locked;
  const sk = isHost(id) && id !== 'weapon' ? `<span class="sk">${'◇'.repeat(socketsOf(id))}</span>` : isComp(id) ? '<span class="sk">◇組件</span>' : '';
  el.innerHTML = `<div class="top"><span>${m.icon} ${m.label}</span><span>⚡${d.cost}</span></div><div class="nm">${d.name}</div>${sk}`;
  el.addEventListener('mouseenter', () => Editor.showInfo(id));
  return el;
}

function parseDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; }
}
