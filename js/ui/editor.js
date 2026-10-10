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
      if (b.dataset.sel === 'move' && ref) {
        const d = this.sel; this.sel = null;
        if (d.from === 'sock') { const j = Game.inventory.indexOf(null); if (j >= 0) this.dropOn(Game.inventory, j, d); else this.warn('倉庫滿了'); }
        else this.quickMove(ref.arr, ref.i);
      }
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
    $('btnClear').onclick = () => { Game.chain = Game.chain.map((_, i) => i === 0 ? 'weapon' : null); Game.socks = []; this.changed(); };
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
      btn.onclick = () => { const r = splitChain(PRESETS[btn.dataset.preset].map(fullChip)); while (r.chain.length < 4) r.chain.push(null); Game.chain = r.chain; Game.socks = r.socks; this.changed(); };
    });

    this.libChips = {};
    // 晶片庫分三區：玩法晶片（放電路格）、觸發器（放電路格）、組件（插進晶片的插座）
    const SECS = [['玩法晶片（放在電路格）', '#5ef2d0', id => PLAY_TYPES.includes(CHIPS[id].type)],
      ['觸發器（放在電路格，右邊的晶片作用在回響上）', '#ff6b9d', id => CHIPS[id].type === 'trigger'],
      ['◆ 組件（拖進晶片下面的插座，不佔電路格）', '#ffd166', id => isComp(id)]];
    const grids = SECS.map(([t, col]) => {
      const sec = document.createElement('div');
      sec.className = 'libsec';
      sec.innerHTML = `<h4 style="color:${col}">${t}</h4><div class="libgrid"></div>`;
      this.libEl.appendChild(sec);
      return sec.querySelector('.libgrid');
    });
    for (const id of Object.keys(CHIPS).filter(id => !CHIPS[id].hidden)) {
      const el = chipEl(id);
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'lib', id })); this.markTargets({ from: 'lib', id }); });
      el.addEventListener('dragend', () => this.clearMarks());
      el.addEventListener('click', () => {  // 點選後再點插槽放入；0.4 秒內點同一個兩下：直接裝上
        const now = performance.now(), dbl = this.libLast && this.libLast.id === id && now - this.libLast.t < 400;
        this.libLast = dbl ? null : { id, t: now };
        if (dbl) { this.sel = null; return this.libQuickAdd(id); }  // 不用瀏覽器的 dblclick：第一下會重畫編輯器，第二下常常收不到
        const same = this.sel && this.sel.from === 'lib' && this.sel.id === id;
        this.sel = same ? null : { from: 'lib', id };
        this.showInfo(id);
        this.render();
      });
      el.title = '點兩下直接裝上';
      this.libChips[id] = el;
      const g = SECS.findIndex(([, , f]) => f(id));
      (grids[g] || this.libEl).appendChild(el);
    }
  },
  sel: null,
  lockedMsg(id) {  // 武器鎖定在第 1 格
    if (this.dry) { this.dryOk = false; return; }
    this.sel = null;
    this.showInfo(id);
    this.render();
  },
  warn(msg) { if (this.dry) { this.dryOk = false; return; } this.sel = null; this.render(); this.infoEl.innerHTML = `<b style="color:#ff8a8a">✖ ${msg}</b>`; },
  // 電路上的晶片拿走時，插座上的組件退回倉庫（倉庫放不下就不動，回傳 false）
  returnComps(i) {
    if (Game.mode === 'range') { Game.socks[i] = []; return true; }  // 靶場沒有倉庫：組件直接拿掉
    const S = Game.socks[i] || [], inv = Game.inventory, free = inv.filter(x => !x).length;
    if (S.length > free) { this.warn(`倉庫放不下${CHIPS[Game.chain[i]].name}插座上的 ${S.length} 個組件，先清出倉庫`); return false; }
    for (const c of S) inv[inv.indexOf(null)] = c;
    Game.socks[i] = [];
    return true;
  },
  // 拿掉來源格子裡的東西（插座是整個抽掉，其他格子變空）
  takeOut(d) {
    if (d.from === 'sock') return (Game.socks[d.h] || []).splice(d.k, 1)[0];
    const r = this.ref(d);
    if (!r) return null;
    const id = r.arr[r.i];
    r.arr[r.i] = null;
    return id;
  },
  recycle(d) {
    this.sel = null;
    const ref = this.ref(d), id = ref && ref.arr[ref.i];
    if (!id) { this.render(); return; }
    if (CHIPS[id].locked) return this.lockedMsg(id);
    if (ref.arr === Game.chain && !this.returnComps(ref.i)) return;
    if (!Game.freePlay()) Game.earn(sellPrice(id));  // 雙人：回收的錢進自己的錢包
    this.takeOut(d);
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
    if (arr[i]) { this.sel = { from, index: i }; this.showInfo(arr[i], from === 'slot' ? i : -1); this.render(); }
  },
  open() {
    this.sel = null;
    this.toolsEl.classList.toggle('hidden', !Game.freePlay());
    this.quitEl.classList.toggle('hidden', !Game.freePlay());
    document.getElementById('edMain').classList.toggle('free', Game.freePlay());  // 沙盒／靶場：電路固定在上方，往下捲晶片庫時還看得到
    const noInv = Game.mode === 'range';  // 靶場沒有倉庫：晶片直接從下面的晶片庫拿
    this.invEl.classList.toggle('hidden', noInv); document.getElementById('invTitle').classList.toggle('hidden', noInv);
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
    const SH = SHIPS[Game.shipId];  // 目前的飛船
    // 跟原本比變了多少（%）：沒變就不寫；好綠壞紅
    const pct = (mul, good) => { const v = Math.round((mul - 1) * 100); return v ? `<span class="sv ${v * good > 0 ? 'good' : 'bad'}">${signed(v, true)}</span>` : ''; };
    const stat = (id, val, mul) => {  // 圖示＋數值（＋變化%）；只有變化的（受傷、射速、子彈速度）就只寫 %
      const p = mul != null ? pct(mul, STATS[id].good) : '';
      return `<span>${statIcon(id)}${val}${p ? (val !== '' ? `（${p}）` : p) : ''}</span>`;
    };
    const rows = [stat('hp', Game.player.maxHp), SH && stat('speed', Math.round(SH.speed * M.speed), M.speed), SH && stat('dashCd', `${+(SH.dashCd * M.dashCd).toFixed(2)} 秒`, M.dashCd),
      ...[['taken', M.taken], ['rate', M.rate * M.rateMul], ['bspeed', M.bspeed]].filter(([, m]) => Math.round((m - 1) * 100)).map(([id, m]) => stat(id, '', m))].filter(Boolean);
    const on2 = [...traits.map(t => `<b style="color:#9dff6b" title="${t.desc}">${t.name}</b>`), ...(M.heavy ? ['<span style="color:#ffd166">模組裝甲加成</span>'] : []), ...(M.light ? ['<span style="color:#4cc9f0">模組加速加成</span>'] : [])];
    const ability = SH && !Object.keys(SH.parts).length && SH.ability !== 'slots' ? `<div class="sub"><b style="color:${SH.color}">${SH.abilityName}</b>：${SH.abilityDesc}</div>` : '';  // 星門號的傳送門這種飛船本身的能力
    const mech = `<h3 class="between" style="margin-top:4px"><span style="color:${SH ? SH.color : '#8fa3d9'}">${SH ? SH.name : ''}</span><span>零件 ${partsUsed(Game.parts)} / ${Game.partSlots}${free ? '（靶場不受格數限制）' : ''}</span></h3>
      <div class="statl big">${rows.join('')}</div>${ability}
      <div class="sub">已開啟：${on2.length ? on2.join(' · ') : '無'}</div>
      <div class="cards" style="margin:8px 0">${partCards}</div>
      <h3>背包模組${free ? ` <button data-pick="module:none">拿掉模組</button>` : ''}</h3>
      <div class="cards" style="margin:8px 0">${modCards || '<div class="sub">還沒有背包模組（精英戰鬥勝利後三選一）。</div>'}</div>`;
    if (!free) { this.shipEl.innerHTML = mech + '<p class="hint">零件在「🔧 改裝廠」取得或更換，背包模組來自精英戰鬥與擊沉旗艦。</p>'; return; }
    const ships = Object.entries(SHIPS).map(([id, S]) => `<div class="card" style="border-color:${S.color};${on(Game.shipId === id, S.color)}">
        <div class="ttl" style="color:${S.color}">${S.name}</div>
        ${shipStatLine(S)}
        ${shipDescHtml(S)}
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
  changed() { if (this.dry) return; Game.recalc(); this.render(); },
  // ---------- 拖曳或選取時，標出每個位置放不放得進去 ----------
  // t = { arr, i }（電路格）或 { sock: h }（第 h 格晶片的插座）；d = 拖的東西。試放一次再全部還原
  canDrop(t, d) {
    const s = this.snap(), sel = this.sel;
    this.dry = true; this.dryOk = true;
    try { if (t.sock != null) this.plug(t.sock, d); else this.dropOn(t.arr, t.i, d); } catch (e) { this.dryOk = false; }
    finally { this.dry = false; this.restore(s); this.sel = sel; Game.recalc(); }
    return this.dryOk;
  },
  // 還原成 snap 的樣子（原地改，電路、倉庫的陣列不換：拖放登記的位置還指著它們）
  restore(s) { Game.chain.splice(0, Infinity, ...s.chain); Game.inventory.splice(0, Infinity, ...s.inv); Game.socks = s.socks.map(x => x.slice()); },
  markTargets(d) {
    for (const { el, t } of this.targets || []) {
      const same = t.sock == null ? d.from === 'slot' && d.index === t.i : d.from === 'sock' && d.h === t.sock;
      const id = this.srcId(d), ok = same || (t.sock != null && !isComp(id) ? false : this.canDrop(t, d));  // 插座只收組件
      el.classList.toggle('nogo', !ok); el.classList.toggle('go', ok && !same);
    }
  },
  clearMarks() { for (const { el } of this.targets || []) el.classList.remove('nogo', 'go'); },
  // 拖放的來源：slot = 電路格、inv = 倉庫、sock = 第 h 格晶片的第 k 個插座、lib = 沙盒的晶片庫
  ref(d) {
    if (d.from === 'slot') return { arr: Game.chain, i: d.index };
    if (d.from === 'inv') return { arr: Game.inventory, i: d.index };
    if (d.from === 'sock') return { arr: Game.socks[d.h] || [], i: d.k, sock: true };
    return null;
  },
  srcId(d) { const r = this.ref(d); return d.from === 'lib' ? d.id : r && r.arr[r.i]; },
  // 放到電路格或倉庫格 i
  dropOn(arr, i, d) {
    const C = Game.chain, inv = Game.inventory, id = this.srcId(d), r = this.ref(d), cur = arr[i];
    if (!id) return this.render();
    if (r && r.arr === arr && r.i === i && !r.sock) return this.render();
    if (arr === C) {
      if (isComp(id)) return cur && isHost(cur) ? this.plug(i, d) : this.warn('組件要插在晶片上：拖到武器、玩法晶片或觸發器（或它下面的插座）');
      if (cur && CHIPS[cur].locked) return this.lockedMsg(cur);  // 武器格不能放別的晶片
      const snap = this.snap();
      if (r && r.arr === C) {  // 電路上換位置：插座上的組件跟著晶片走，奇異點屬性留在格子上
        if (CHIPS[id].locked) return this.lockedMsg(id);
        [C[i], C[r.i]] = [C[r.i], C[i]];
        [Game.socks[i], Game.socks[r.i]] = [Game.socks[r.i] || [], Game.socks[i] || []];
        return this.commit(snap);
      }
      // 從倉庫／晶片庫換上來：原本那格的晶片回倉庫，插座上的組件留著插在新的晶片上
      const nid = d.from === 'lib' ? (cur && baseOf(cur) === d.id && canLevelUp(cur) ? chipId(d.id, levelOf(cur) + 1, socketsOf(cur)) : newChip(d.id, CFG.MAX_SOCKETS)) : id;
      if (d.from !== 'lib') r.arr[r.i] = cur || null;
      C[i] = nid;
      return this.commit(snap);
    }
    // 放到倉庫
    if (r && r.arr === C) {  // 電路上的晶片拿回倉庫：插座上的組件也退回倉庫
      if (CHIPS[id].locked) return this.lockedMsg(id);
      if (cur && isComp(cur)) return this.warn('倉庫那格是組件，不能換到電路格上');
      const back = Game.socks[r.i] || [], snap = this.snap();
      if (back.length > inv.filter((x, j) => !x && j !== i).length) return this.warn(`倉庫放不下${CHIPS[id].name}插座上的 ${back.length} 個組件，先清出倉庫`);
      C[r.i] = cur || null; inv[i] = id;
      if (cur) return this.commit(snap);  // 換上去的晶片接手插座上的組件
      Game.socks[r.i] = [];
      for (const c of back) inv[inv.indexOf(null)] = c;
      return this.changed();
    }
    if (r && r.sock) {  // 插座上的組件拔回倉庫
      if (cur && !isComp(cur)) return this.warn('組件只能跟倉庫裡的組件交換');
      const c = r.arr[r.i];
      if (cur) r.arr[r.i] = cur; else r.arr.splice(r.i, 1);
      inv[i] = c;
      return this.changed();
    }
    if (d.from === 'lib') inv[i] = newChip(d.id, CFG.MAX_SOCKETS);
    else [inv[i], r.arr[r.i]] = [r.arr[r.i], inv[i]];
    this.changed();
  },
  // 會變成「沒有作用」的擺法不給放：先記下配裝和沒作用的項目，做完如果多了，就還原並說明原因（拿掉、拔掉這類移除動作不檢查）
  //   沒電的（能量不夠，nopow）不算：可以先放著，容量變大就通電
  snap() { return { chain: Game.chain.slice(), socks: (Game.socks || []).map(x => (x || []).slice()), inv: Game.inventory.slice(), idle: this.idleList() }; },
  idleList() {
    const info = compileChain(Game.chain).info, out = [];
    info.forEach((I, i) => { if (I.idle && !I.nopow) out.push(I.why); for (const J of info.socks[i] || []) if (J.idle && !J.nopow) out.push(J.why); });
    return out;
  },
  commit(snap) {
    const now = this.idleList();
    if (this.dry) { if (now.length > snap.idle.length) this.dryOk = false; return; }
    if (now.length > snap.idle.length) {
      const why = now.find(w => !snap.idle.includes(w)) || now[now.length - 1];
      this.restore(snap);
      Game.recalc();
      return this.warn(`這樣擺會沒有作用，不給放：${why}`);
    }
    this.changed();
  },
  canPlug(h, compId, used) {  // 不能插的原因（可以插回傳空字串）
    const hostId = Game.chain[h], b = baseOf(compId), hb = baseOf(hostId);
    if (used >= socketsOf(hostId)) return `${CHIPS[hostId].name}的插座滿了（${socketsOf(hostId)} 個）${hostId === 'weapon' ? '；武器插座每打完一隻王 +1，最多 3 個' : ''}`;
    if (b === 'overclock' && hostId !== 'weapon') return '超頻是整條電路的射速，只能插在武器上';
    if (hb === 'pull' && b !== 'bigshot') return '吸引的產物是拉力，只能插巨彈';
    return '';
  },
  // 把組件插到第 h 格的晶片上（加在最後面）
  plug(h, d) {
    const id = this.srcId(d), S = Game.socks[h] = Game.socks[h] || [];
    if (!id || !isComp(id)) return this.render();
    const same = d.from === 'sock' && d.h === h;
    if (same) return this.render();
    const why = this.canPlug(h, id, S.length);
    if (why) return this.warn(why);
    const snap = this.snap();
    if (d.from !== 'lib') this.takeOut(d);
    S.push(id);
    this.sel = null;
    this.commit(snap);
  },
  quickMove(arr, i) {  // 右鍵：電路 ⇄ 倉庫
    const id = arr[i];
    if (!id) return;
    if (CHIPS[id].locked) return this.lockedMsg(id);
    const inv = Game.inventory, j = inv.indexOf(null);
    if (arr === Game.chain) {
      if (Game.mode === 'range') { Game.socks[i] = []; arr[i] = null; return this.changed(); }  // 靶場：右鍵直接拿掉
      if (j >= 0) return this.dropOn(inv, j, { from: 'slot', index: i });
      if (Game.freePlay() && this.returnComps(i)) { arr[i] = null; return this.changed(); }
      return this.warn('倉庫滿了');
    }
    if (isComp(id)) {  // 倉庫的組件：插進武器或第一個還有空插座、可以插的晶片
      const h = Game.chain.findIndex((c, k) => c && !this.canPlug(k, id, (Game.socks[k] || []).length));
      return h >= 0 ? this.plug(h, { from: 'inv', index: i }) : this.warn('電路上沒有可以插這個組件的空插座');
    }
    const k = Game.chain.indexOf(null, 1);
    if (k > 0) return this.dropOn(Game.chain, k, { from: 'inv', index: i });
    this.warn('電路沒有空格');
  },
  // 晶片庫點兩下（沙盒／靶場）：晶片放到電路第一個空格；組件插進武器或第一個還有空插座、可以插的晶片
  libQuickAdd(id) {
    const d = { from: 'lib', id };
    if (isComp(id)) {
      const h = Game.chain.findIndex((c, k) => c && !this.canPlug(k, id, (Game.socks[k] || []).length));
      return h >= 0 ? this.plug(h, d) : this.warn('電路上沒有可以插這個組件的空插座');
    }
    const k = Game.chain.indexOf(null, 1);
    if (k > 0) return this.dropOn(Game.chain, k, d);
    this.warn('電路沒有空格');
  },
  showDefaultInfo() {
    this.infoEl.innerHTML = '電路由左至右執行：第 1 格固定是<b style="color:#4cc9f0">你的武器</b> → <b style="color:#5ef2d0">玩法晶片</b>依序改變子彈的玩法。' +
      '晶片下面的圓是<b style="color:#ffd166">插座</b>：把組件（分裂、巨彈、穿甲、倍增、超頻、鏡像、爆裂、燃燒、冰凍、電擊、破甲）拖進去（組件不佔電路格）。插在武器上作用在全部子彈（倍增、巨彈的傷害加成只算直擊，產物不吃），插在玩法晶片上只作用在它的產物（例：插在環繞上 = 放出的那一波）。' +
      '<b style="color:#ff6b9d">觸發器</b>（命中／消失／定時）用武器再射一次回響（50%），右邊的晶片只作用在回響上。滑鼠移到晶片、插座上可看說明。';
  },
  showInfo(id, slot = -1, J = null) {
    if (!id) { this.infoEl.innerHTML = slot > 0 ? `第 ${slot + 1} 格：空插槽${slotAttrLine(slot)}` : ''; return; }
    const d = CHIPS[id], m = TYPE_META[d.type];
    const P = HOST_PRODUCT[baseOf(id)];
    const ps = isComp(id) ? '<br><span style="color:#ffd166">◇ 組件：拖到武器、玩法晶片或觸發器上就插進它的插座（不佔電路格）。</span>'
      : P ? `<br><span style="color:#ffd166">◇ 插座 ${socketsOf(id)} 個　插在它上面的組件只作用在：${P}</span>` : '';
    const price = !Game.freePlay() ? `　回收價 ◆${sellPrice(id)}` : '';
    this.infoEl.innerHTML = `<b style="color:${m.color}">${m.icon} ${d.name}</b>　` +
      `<span style="color:#6a79ad">${m.label} · 能量 ⚡${d.cost}${price}</span>` +
      (CHIPS[baseOf(id)].grow && !Game.freePlay() ? '<br>' + growLine(id, Game.growth, Game.runStats ? Game.runStats.time / 60 : 0) : '') +  // 成長進度放在名稱下面（以前在最後一行，說明框要往下捲才看得到）
      // 各等級效果放在說明前面（說明框高度有限，放最後會被切掉）；Lv2 以上的 desc 本身尾巴就有等級列，改用基本說明避免重複
      (LV_INFO[baseOf(id)] ? '<br>' + lvLine(baseOf(id), levelOf(id)) + `<br>${CHIPS[baseOf(id)].desc}` : `<br>${d.desc}`) +
      `${ps}` +
      (slot > 0 ? slotAttrLine(slot) : '') + (J && J.idle ? `<br><b style="color:#ff8a8a">✖ 這個插座沒有作用：${J.why}</b>` : '');
  },

  // 每格狀態（見 compileChain）：role 宿主／組件、host 插在第幾格、seg 在第幾層觸發、idle 沒有作用（why 原因）
  slotInfo(chain) { return compileChain(chain).info; },

  // 插座：晶片卡下面的大圓。h = 第幾格的晶片，k = 第幾個插座（空的插座 id 是 null）
  sockEl(h, k, J) {
    const el = document.createElement('div'), C = Game.chain, S = Game.socks[h] || [], id = S[k] || null;
    if (id) {
      const m = TYPE_META[CHIPS[id].type], on = this.sel && this.sel.from === 'sock' && this.sel.h === h && this.sel.k === k;
      el.className = 'sock' + (J && J.idle ? ' idle' : '') + (J && J.nopow ? ' nopow' : '') + (on ? ' sel' : '');
      el.style.setProperty('--c', m.color);
      el.innerHTML = `<span>${CHIPS[id].short || CHIPS[id].name}</span>`;
      const fx = sockEffect(h, k);  // 插在這裡的實際效果
      el.title = `${CHIPS[id].name}（插在${h === 0 ? '武器' : CHIPS[C[h]].name}上）\n${fx}`;
      el.draggable = true;
      el.addEventListener('dragstart', e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'sock', h, k })); this.markTargets({ from: 'sock', h, k }); });
      el.addEventListener('dragend', () => this.clearMarks());
      el.addEventListener('mouseenter', () => {
        if (this.sel) return;  // 選取中：說明框固定顯示選取的那一個
        this.showInfo(id, -1, J);
        this.infoEl.innerHTML = `<b style="color:${J && J.idle ? '#ff8a8a' : '#ffd166'}">◆ ${CHIPS[id].name}插在${h === 0 ? '武器' : CHIPS[C[h]].name}上：${fx}</b><br>` + this.infoEl.innerHTML;
      });
      el.addEventListener('contextmenu', e => {  // 右鍵：拔回倉庫
        e.preventDefault(); e.stopPropagation();
        if (Game.mode === 'range') { (Game.socks[h] || []).splice(k, 1); return this.changed(); }  // 靶場：右鍵直接拔掉
        const j = Game.inventory.indexOf(null);
        if (j >= 0) this.dropOn(Game.inventory, j, { from: 'sock', h, k }); else this.warn('倉庫滿了');
      });
      el.addEventListener('click', e => {
        e.stopPropagation();
        if (this.sel && !on) { const d = this.sel; this.sel = null; return this.plug(h, d); }
        this.sel = on ? null : { from: 'sock', h, k };
        this.showInfo(id, -1, J); this.render();
      });
    } else {
      el.className = 'sock empty';
      el.innerHTML = '<span>＋</span>';
      el.title = `空的插座：把組件拖進來插在${CHIPS[C[h]].name}上`;
      el.addEventListener('mouseenter', () => { this.infoEl.innerHTML = `<b style="color:#ffd166">◇ ${CHIPS[C[h]].name}的空插座</b>：把組件拖進來（或先點組件再點這裡）。插在它上面的組件只作用在：${HOST_PRODUCT[baseOf(C[h])] || ''}`; });
      el.addEventListener('click', e => { e.stopPropagation(); if (this.sel) { const d = this.sel; this.sel = null; this.plug(h, d); } });
    }
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); const d = parseDrag(e); if (d) this.plug(h, d); });
    (this.targets = this.targets || []).push({ el, t: { sock: h } });
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
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ from, index: i })); this.markTargets({ from, index: i }); });
      el.addEventListener('dragend', () => this.clearMarks());
      if (from === 'slot') el.addEventListener('mouseenter', e => { e.stopImmediatePropagation(); if (!Editor.sel) Editor.showInfo(id, i); }, true);
      slot.appendChild(el);
      const g = Game.freePlay() ? '' : growBar(id);  // 靶場直接切等級，不顯示成長進度
      if (g) slot.insertAdjacentHTML('beforeend', g);
    } else {
      slot.insertAdjacentHTML('beforeend', `<span class="empty">空插槽</span>`);
      if (from === 'slot') slot.addEventListener('mouseenter', () => { if (!this.sel) this.showInfo(null, i); });
    }
    slot.addEventListener('dragover', e => { e.preventDefault(); slot.classList.add('over'); });
    slot.addEventListener('dragleave', () => slot.classList.remove('over'));
    slot.addEventListener('drop', e => {
      e.preventDefault(); slot.classList.remove('over');
      const d = parseDrag(e);
      if (d) this.dropOn(arr, i, d);
    });
    slot.addEventListener('contextmenu', e => { e.preventDefault(); this.sel = null; this.quickMove(arr, i); });
    if (from === 'slot') (this.targets = this.targets || []).push({ el: slot, t: { arr, i } });
    slot.addEventListener('click', () => this.tapSlot(arr, i, from));
    return slot;
  },

  render() {
    if (this.dry) return;
    this.targets = [];  // 拖曳時要標記的位置（makeSlot、sockEl 登記）
    const chain = Game.chain, info = this.slotInfo(chain);
    {  // 斷電的地方（第一個沒電的晶片或組件）：畫一條斷電線
      const at = info.findIndex((I, i) => I.nopow || (info.socks[i] || []).some(J => J.nopow));
      if (at >= 0) { if (info[at].nopow) info[at].cut = true; else info.socks[at].find(J => J.nopow).cut = true; }
    }
    this.creditsEl.textContent = !Game.freePlay() ? `◆ ${Game.credits}` : Game.mode === 'range' ? '🎯 靶場' : '沙盒模式';
    this.recycleEl.innerHTML = !Game.freePlay() ? '♻ 回收<br>拖曳到這裡<br>換成晶體' : '✕ 移除<br>拖曳到這裡刪除';

    // 電路：每一格是一欄（晶片卡靠上，下面固定留一排插座的位置）
    this.chainEl.innerHTML = '';
    const TRIG = { hit: '命中時', end: '消失時', time: '每 0.3 秒' }, A = Game.slotAttr || [];
    const attrCls = i => A[i] ? (SLOT_ATTRS[A[i]].good ? ' ag' : ' ab') : '';
    const badge = i => { const S = A[i] && SLOT_ATTRS[A[i]]; return S ? `<span class="sattr ${S.good ? 'good' : 'bad'}" title="${S.desc.replace(/<[^>]+>/g, '')}">${S.good ? '✺' : '✖'} ${S.name}</span>` : ''; };
    let lastHost = -1;
    chain.forEach((id, i) => {
      const I = info[i];
      if (i > 0) {
        const trig = lastHost === i - 1 && info[lastHost].trig, ar = document.createElement('div');
        ar.className = 'arrow' + (trig ? ' trig' : '');
        ar.innerHTML = trig ? '⤷<br>' + (TRIG[CHIPS[chain[lastHost]].trig] || '') : '→';
        this.chainEl.appendChild(ar);
      }
      const col = document.createElement('div');
      col.className = 'hgroup' + (I.nopow ? ' nopow' : '') + (I.cut ? ' cut' : '');
      const slot = this.makeSlot(chain, i, 'slot', `${i + 1}${I.seg ? ' · 第' + I.seg + '層' : ''}`,
        [(I.seg ? 'seg' + I.seg : ''), attrCls(i).trim()].filter(Boolean).join(' '), I.idle, I.why);
      slot.insertAdjacentHTML('beforeend', badge(i));
      col.appendChild(slot);
      const socks = document.createElement('div');
      socks.className = 'socks';
      if (id) {
        lastHost = i;
        const S = Game.socks[i] || [], n = Math.max(socketsOf(id), S.length);
        for (let k = 0; k < n; k++) {
          const J = (info.socks[i] || [])[k];
          if (J && J.cut) socks.insertAdjacentHTML('beforeend', '<span class="cutmark" title="斷電：從這裡開始能量不夠，右邊全部沒電"></span>');  // 斷在組件：插座之間畫斷電線
          socks.appendChild(this.sockEl(i, k, J));
        }
        if (!n) socks.innerHTML = '<span class="nosock">沒有插座</span>';
      }
      col.appendChild(socks);
      this.chainEl.appendChild(col);
    });
    this.chainEl.insertAdjacentHTML('beforeend', `<div class="chaincount">電路 ${chain.filter(Boolean).length - 1} / ${chain.length - 1} 格<br><span>插座上 ${sockCount()} 個組件</span>${CFG.MECH_SLOT_EVERY && chain.length < CFG.MAX_SLOTS ? `<br><span>機體強化 ${(Game.mechN || 0) % CFG.MECH_SLOT_EVERY} / ${CFG.MECH_SLOT_EVERY} → 電路格 +1</span>` : ''}</div>`);

    this.invEl.innerHTML = '';
    Game.inventory.forEach((_, i) => this.invEl.appendChild(this.makeSlot(Game.inventory, i, 'inv', '倉庫 ' + (i + 1))));

    const s = Game.stats, P = Game.passives;
    const stat = (k, v) => `<div class="stat">${k}<b>${v}</b></div>`;
    this.statsEl.innerHTML =
      stat('每次開火子彈', s.count + ' 顆') +
      stat('單次總傷害', s.dmg.toFixed(0)) +
      stat('射速', s.rps.toFixed(1) + ' 次/秒') +
      stat('估算 DPS（含命中效果）', s.dpsEst.toFixed(0)) +
      stat('能量 / 容量', `⚡ ${s.used} / ${s.cap}<span style="display:block;font-size:11px;color:${s.off ? '#ff9dbd' : '#8fa3d9'};margin-top:2px">${s.off ? `沒電 ${s.off} 個（全部要 ⚡${s.heat}）` : '全部有電'}</span>`);
    this.layersEl.innerHTML = s.layers.map((l, i) =>
      `◎ 第 ${i + 1} 層（${TRIG[l.trig] || ''}）：每次觸發展開 ${l.count} 顆 / ${l.dmg.toFixed(0)} 傷害`).join('　');
    const sa = Game.chain.map((_, i) => A[i] && `第 ${i + 1} 格 ${SLOT_ATTRS[A[i]].name}`).filter(Boolean);
    this.passEl.textContent = sa.length ? '奇異點強化的格子：' + sa.join('、') : '奇異點強化的格子：無';

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
        ${Game.mode === 'range' && (inChain || S.from === 'sock') ? '' : `<button data-sel="move">${inChain || S.from === 'sock' ? '移到倉庫' : '裝上電路'}</button>`}
        <button data-sel="recycle">${!Game.freePlay() ? `回收 ◆${sellPrice(selId)}` : '移除'}</button>
        <button data-sel="cancel">取消</button>`;
    } else this.selbarEl.innerHTML = '';
    if (this.sel) this.markTargets(this.sel);  // 點選了晶片或組件：放不進去的位置變灰
  },
};


// 插座上的組件「插在這裡」的實際效果（滑鼠移到插座上時顯示）：h = 第幾格的晶片，k = 第幾個插座
function sockEffect(h, k) {
  const C = Game.chain, host = C[h], id = (Game.socks[h] || [])[k];
  if (!host || !id) return '';
  const J = ((compileChain(C).info.socks || [])[h] || [])[k];
  if (J && J.idle) return `✖ 沒有作用：${J.why}`;
  const at = (Game.slotAttr || [])[h], m = at === 'eff' ? 1.5 : at === 'weak' ? 0.7 : 1, hb = baseOf(host), b = baseOf(id);
  const mtxt = m !== 1 ? `（奇異點 ×${m}）` : '', n = Math.max(2, Math.round(3 + 2 * (m - 1)));
  const wlike = host === 'weapon' || CHIPS[host].type === 'trigger', dmg = b === 'amp' || b === 'bigshot';
  if (b === 'overclock') return '整條電路射速 ×2，連射 3 秒過熱、停火 1.5 秒';
  if (b === 'mirror') {
    if (wlike) return host === 'weapon' ? '武器多射一次（基礎傷害算鏡像的）' : '回響多射一次';
    if (hb === 'sticky') return '黏著的爆炸再爆一次（傷害、碎片都多一份）';
    return `${CHIPS[hb].name}的產物多一份（${HOST_PRODUCT[hb] || ''}）`;
  }
  const fx = { amp: `傷害 +${Math.round(100 * m)}%`, split: `分成 ${n} 顆（每顆 ×0.4）`, pierce: `穿透 +${Math.round(2 * m)}`, bigshot: `變大、擊退變強，傷害 +${Math.round(30 * m)}%`, blast: `命中時爆炸（半徑 60，${Math.round(50 * m)}% 傷害；跟武器的爆炸相加）`, ignite: `命中燃燒 3 秒，每秒 ${Math.round(30 * m)}% 傷害`, frost: `命中減速 ${Math.round(40 * m)}%（2 秒）`, shock: `命中時 ${Math.max(1, Math.round(m))} 道電弧（50% 傷害）`, shred: `命中的敵人 3 秒內受傷 +${Math.round(25 * m)}%` }[b] + mtxt;
  if (host === 'weapon') return `武器射出的全部子彈：${fx}${dmg ? '（傷害加成只算直擊：迴旋回程、環繞放出、黏著爆炸這些產物不吃）' : ''}`;
  if (wlike) return `回響（武器 50%）：${fx}${dmg ? '（傷害加成只算回響的直擊）' : ''}`;
  if (hb === 'sticky') return '黏著的爆炸：' + { amp: `爆炸傷害 +${Math.round(100 * m)}%（晶片加成，跟武器加成相乘）`,
    split: `爆炸時噴出 ${n} 發碎片（每發是爆炸傷害的 ${Math.round(20 * m)}%）`, pierce: `黏住前多穿 ${Math.round(2 * m)} 隻（多留 ${Math.round(2 * m)} 份）`,
    bigshot: `爆炸波及周圍 ${Math.round(70 + 40 * m)}（50% 傷害），爆炸 +${Math.round(30 * m)}%`,
    blast: `再炸一圈（半徑 60，爆炸傷害的 ${Math.round(50 * m)}%）`, ignite: `被炸的敵人燃燒 3 秒，每秒 ${Math.round(30 * m)}% 爆炸傷害`, frost: `被炸的敵人減速 ${Math.round(40 * m)}%`, shock: `放出 ${Math.max(1, Math.round(m))} 道電弧（爆炸傷害的 50%）`, shred: `被炸的敵人 3 秒內受傷 +${Math.round(25 * m)}%` }[b] + mtxt;
  if (hb === 'pull') return `吸引的拉力範圍 ×${(1 + 0.5 * m).toFixed(2)}`;
  return `只作用在${CHIPS[hb].name}的產物（${HOST_PRODUCT[hb] || ''}）：${fx}${dmg ? '，算進晶片加成（跟武器加成相乘）' : ''}`;
}

// 奇異點強化的格子：這一格現在實際的效果（編輯器說明欄、奇異點結果畫面用）
function slotAttrLine(i) {
  const at = (Game.slotAttr || [])[i];
  if (!at) return '';
  const S = SLOT_ATTRS[at], id = Game.chain[i], col = S.good ? '#9dff6b' : '#ff8a8a';
  const CV = { blast: m => `爆炸 ${Math.round(50 * m)}%`, ignite: m => `燃燒每秒 ${Math.round(30 * m)}%`, frost: m => `減速 ${Math.round(40 * m)}%`, shock: m => `電弧 ${Math.max(1, Math.round(m))} 道`, shred: m => `受傷 +${Math.round(25 * m)}%`, amp: m => `傷害 +${Math.round(100 * m)}%`, split: m => `分裂成 ${Math.max(2, Math.round(3 + 2 * (m - 1)))} 顆`,
    pierce: m => `穿透 +${Math.round(2 * m)}`, bigshot: m => `傷害 +${Math.round(30 * m)}%` };
  let fx;
  if (!id) fx = '這格現在是空的，放晶片進來才有效果';
  else if (at === 'eff' || at === 'weak') {
    const k = at === 'eff' ? 1.5 : 0.7, b = baseOf(id);
    fx = isComp(id) ? (CV[b] ? `${CV[b](1)} → <b>${CV[b](k)}</b>` : '這個組件沒有可以放大的數值') : `插在${CHIPS[id].name}上的組件效果 ×${k}`;
  } else if (at === 'free' || at === 'heavy') fx = `能量 ⚡${CHIPS[id].cost} → <b>⚡${slotHeat(id, at)}</b>`;
  else if (at === 'grow2' || at === 'nogrow') fx = CHIPS[baseOf(id)].grow ? `${CHIPS[baseOf(id)].name}${at === 'grow2' ? '的用量成長 ×2' : '不會成長'}` : '這格的晶片不會成長，沒有影響';
  else if (at === 'flaky') fx = `每 8 秒的最後 2 秒沒作用（現在：${flakyOff() ? '<b style="color:#ff8a8a">失效中</b>' : '作用中'}）`;
  else fx = S.desc;
  return `<br><b style="color:${col}">${S.good ? '✺' : '✖'} 奇異點強化・第 ${i + 1} 格：${S.name}</b>　${fx}`;
}

function chipEl(id) {
  const d = CHIPS[id], m = TYPE_META[d.type];
  const el = document.createElement('div');
  el.className = 'chip t-' + d.type;
  el.draggable = !d.locked;
  const sk = isHost(id) && id !== 'weapon' ? `<span class="sk">${'◇'.repeat(socketsOf(id))}</span>` : '';  // 組件的卡片本身就是金色圓角，不用再標
  el.innerHTML = `<div class="top"><span>${m.icon} ${m.label}</span><span>⚡${d.cost}</span></div><div class="nm">${d.name}</div>${sk}`;
  el.addEventListener('mouseenter', () => { if (!Editor.sel) Editor.showInfo(id); });  // 選取中：說明框固定顯示選取的那一個（滑鼠移去目標格的路上不要亂切）
  return el;
}

function parseDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; }
}
