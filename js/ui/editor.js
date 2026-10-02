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
    this.infoEl.innerHTML = '電路由左至右執行：第 1 格固定是<b style="color:#4cc9f0">你的武器</b>（3 個插座）→ <b style="color:#5ef2d0">玩法晶片</b>依序改變子彈的玩法。' +
      '<b style="color:#ffd166">◇ 組件</b>（分裂、巨彈、穿甲、倍增、超頻、鏡像）插在<b>左邊最近</b>的武器／玩法晶片／觸發器上：插在武器上作用在全部子彈（插越多越打折），插在玩法晶片上只作用在它的產物（例：插在環繞上 = 放出的那一波）。' +
      '<b style="color:#ff6b9d">觸發器</b>（命中／消失／定時）用武器再射一次回響（50%），右邊的晶片只作用在回響上。點晶片可看說明。';
  },
  showInfo(id) {
    const d = CHIPS[id], m = TYPE_META[d.type];
    const P = HOST_PRODUCT[baseOf(id)];
    const ps = isComp(id) ? '<br><span style="color:#ffd166">◇ 組件：插在左邊最近的武器／玩法晶片／觸發器上，佔一格電路。</span>'
      : P ? `<br><span style="color:#ffd166">◇ 插座 ${socketsOf(id)} 個　插在它上面的組件只作用在：${P}</span>` : '';
    const price = !Game.freePlay() ? `　回收價 ◆${sellPrice(id)}` : '';
    this.infoEl.innerHTML = `<b style="color:${m.color}">${m.icon} ${d.name}</b>　` +
      `<span style="color:#6a79ad">${m.label} · 能量負載 ⚡${d.cost}${d.cost ? `（裝上電路射速 -${Math.round(d.cost * CFG.HEAT_RATE * 100)}%）` : ''}${price}</span><br>${d.desc}` +
      `${!d.lv && LV_INFO[id] ? '<br>' + lvLine(id, 1) : ''}${ps}` +
      (CHIPS[baseOf(id)].grow ? '<br>' + growLine(id, Game.growth, Game.runStats ? Game.runStats.time / 60 : 0) : '');
  },

  // 每格狀態（見 compileChain）：role 宿主／組件、host 插在第幾格、seg 在第幾層觸發、idle 沒有作用（why 原因）
  slotInfo(chain) { return compileChain(chain).info; },

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
      slot.appendChild(el);
    } else slot.insertAdjacentHTML('beforeend', '<span class="empty">空插槽</span>');
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
    const TRIG = { hit: '命中時', end: '消失時', time: '每 0.3 秒' }, A = Game.slotAttr || [], sockN = {};
    let lastHost = -1, trigShown = false;  // 觸發器那一組（觸發器＋它的插座）之後的第一個晶片前面標觸發時機
    chain.forEach((id, i) => {
      const I = info[i];
      if (i > 0) {
        const ar = document.createElement('div');
        if (I.role === 'comp' && I.host >= 0) { ar.className = 'arrow sock'; ar.textContent = '◇'; }
        else if (lastHost >= 0 && info[lastHost].trig && !trigShown) { trigShown = true; ar.className = 'arrow trig'; ar.innerHTML = '⤷<br>' + (TRIG[CHIPS[chain[lastHost]].trig] || ''); }
        else { ar.className = 'arrow'; ar.textContent = '→'; }
        this.chainEl.appendChild(ar);
      }
      if (I.role === 'host') { lastHost = i; trigShown = false; }
      let label = `${i + 1}`;
      if (I.role === 'comp' && I.host >= 0) { sockN[I.host] = (sockN[I.host] || 0) + 1; label += ` · 插座${sockN[I.host]}/${socketsOf(chain[I.host])}`; }
      else if (I.role === 'host' && i > 0) label += ` · ${'◇'.repeat(socketsOf(id)) || '無插座'}`;
      if (I.seg) label += ` · 第${I.seg}層`;
      const slot = this.makeSlot(chain, i, 'slot', label, [I.seg ? 'seg' + I.seg : '', I.role === 'comp' && I.host >= 0 ? 'socked' : ''].join(' ').trim(), I.idle, I.why);
      if (A[i]) {
        const S = SLOT_ATTRS[A[i]];
        slot.insertAdjacentHTML('beforeend', `<span class="sattr ${S.good ? 'good' : 'bad'}" title="${S.desc.replace(/<[^>]+>/g, '')}">${S.good ? '✺' : '✖'} ${S.name}</span>`);
      }
      this.chainEl.appendChild(slot);
    });

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
