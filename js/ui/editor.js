// 星環電路 多人版 · editor.js：電路編輯器（Tab）：一條線、拖放、插座、晶片傷害統計分頁
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// EDITOR UI — 電路 / 倉庫 拖放
// =====================================================================
const Editor = {
  init() {
    const $ = id => document.getElementById(id);
    this.el = $('editor'); this.chainEl = $('chain'); this.countEl = $('chainCount'); this.invEl = $('inv'); this.libEl = $('library');
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
      } else if (kind === 'weapon') { Game.weapon = { id, path: null, final: null }; Game.refreshWeapon(); }
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
    $('btnClear').onclick = () => { Game.chain.splice(0, Infinity, ...Game.chain.map((_, i) => i === 0 ? 'weapon' : null)); Game.socks = []; this.changed(); };
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
      btn.onclick = () => { const r = splitChain(PRESETS[btn.dataset.preset].map(fullChip)); while (r.chain.length < 4) r.chain.push(null); Game.chain.splice(0, Infinity, ...r.chain); Game.socks = r.socks; this.changed(); };
    });

    this.libChips = {};
    // 晶片庫分兩區：晶片（放在線上）、插件（插進晶片的插座）
    const SECS = [['晶片（拖到線上：前一格的產物觸發它）', TYPE_META.chip.color, id => CHIPS[id].type === 'chip'],
      ['◆ 插件（拖進晶片下面的插座，不佔電路格）', TYPE_META.comp.color, id => isComp(id)]];
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
  // 電路上的晶片拿走時，插座上的插件退回倉庫（倉庫放不下就不動，回傳 false）
  returnComps(i) {
    if (Game.mode === 'range') { Game.socks[i] = []; return true; }  // 靶場沒有倉庫：插件直接拿掉
    const S = Game.socks[i] || [], inv = Game.inventory, free = inv.filter(x => !x).length;
    if (S.length > free) { this.warn(`倉庫放不下${CHIPS[Game.chain[i]].name}插座上的 ${S.length} 個插件，先清出倉庫`); return false; }
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
  // 機體分頁：飛船能力、零件、已開啟的特性（遠征／雙人只能看）；沙盒／靶場另外可以換機體、武器、直接調零件
  renderShip() {
    const on = (yes, col) => yes ? `outline:2px solid ${col};outline-offset:2px` : '';
    const free = Game.freePlay(), T = Game.mech.traits, M = Game.mech;
    const traits = [...PART_IDS.flatMap(id => [PARTS[id].t2, PARTS[id].t4]).filter(t => T[t.id]), ...(T.balance ? [BALANCE] : [])];
    const partCards = PART_IDS.map(id => partCard(id, free ? `<div class="bar"><button data-pick="part:${id}:-1">−1 層</button><button data-pick="part:${id}:1">+1 層</button></div>` : '')).join('');
    const SH = SHIPS[Game.shipId];  // 目前的飛船
    // 跟原本比變了多少（%）：沒變就不寫；好綠壞紅
    const pct = (mul, good) => { const v = Math.round((mul - 1) * 100); return v ? `<span class="sv ${v * good > 0 ? 'good' : 'bad'}">${signed(v, true)}</span>` : ''; };
    const stat = (id, val, mul) => {  // 圖示＋數值（＋變化%）；只有變化的（受傷、射速、子彈速度）就只寫 %
      const p = mul != null ? pct(mul, STATS[id].good) : '';
      return `<span>${statIcon(id)}${val}${p ? (val !== '' ? `（${p}）` : p) : ''}</span>`;
    };
    const rows = [stat('hp', Game.player.maxHp), SH && stat('speed', Math.round(SH.speed * M.speed), M.speed), SH && stat('dashCd', `${+(SH.dashCd * M.dashCd).toFixed(2)} 秒`, M.dashCd),
      ...[['taken', M.taken], ['rate', M.rate * M.rateMul], ['bspeed', M.bspeed]].filter(([, m]) => Math.round((m - 1) * 100)).map(([id, m]) => stat(id, '', m))].filter(Boolean);
    const on2 = [...traits.map(t => `<b style="color:#9dff6b" title="${t.desc}">${t.name}</b>`)];
    const ability = SH ? `<div class="sub"><b style="color:${SH.color}">${SH.abilityName}</b>${descList(SH.abilityDesc)}</div>` : '';  // 飛船專屬能力（相位跳躍、灰血、殘影、傳送門）
    const mech = `<h3 class="between" style="margin-top:4px"><span style="color:${SH ? SH.color : '#8fa3d9'}">${SH ? SH.name : ''}</span><span>零件 ${partsUsed(Game.parts)} / ${Game.partSlots}${free ? '（靶場不受格數限制）' : ''}</span></h3>
      <div class="statl big">${rows.join('')}</div>${ability}
      <div class="sub">已開啟：${on2.length ? on2.join(' · ') : '無'}</div>
      <div class="cards" style="margin:8px 0">${partCards}</div>`;
    if (!free) { this.shipEl.innerHTML = mech + '<p class="hint">零件在「🔧 改裝廠」取得或更換。</p>'; return; }
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
        <div class="ds">${descList(W.desc)}</div>
        <button data-pick="weapon:${id}">${Game.weapon.id === id ? '使用中' : '換成' + W.name}</button></div>`;
    }).join('');
    const W = WEAPONS[Game.weapon.id], st = Game.weapon;
    const up = (key, label, cur, desc) => `<button data-pick="up:${key}" title="${desc.replace(/<[^>]+>/g, '')}"
      style="${cur ? `border-color:${W.color};color:${W.color}` : ''}">${label}</button>`;
    let ups = up('', '基礎型', !st.path, W.desc.join('；'));
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
      const where = k === 'weapon' || k === 'ship' ? '' : Game.chain.some(id => id && baseOf(id) === k) || (Game.socks || []).some(S => (S || []).some(id => id && baseOf(id) === k)) ? ''  // 插在插座上的插件也算在電路上
        : '<span style="color:#6a79ad">（目前不在電路上）</span>';
      return `<tr><td><b style="color:${color(k)}">${dmgKeyName(k)}</b>${where}</td>${cell(S.chips[k], tS, color(k))}${cell(R.chips[k], tR, color(k))}</tr>`;
    }).join('');
    const label = Game.freePlay() ? (Game.mode === 'range' ? '本次靶場' : '本次沙盒') : Game.isEndless() ? `本關（無盡 · 星區 ${Game.sector}）` : `本關（星區 ${Game.sector}）`;
    const coop = Game.mode === 'coop' && Game.mates.length, mates = coop ? Net.mateChipRows() : [];
    const me = coop ? `<h3 style="color:${Game.slotColor(Net.mySlot())}">${Net.mySlot()}P（你）</h3>` : '';
    const mateTable = mates.map(mate => `<h3 style="color:${Game.slotColor(parseInt(mate.tag, 10))}">${mate.tag} 隊友（整局）</h3>
      <table class="dmg-table"><thead><tr><th>來源</th><th>整局</th></tr></thead>
        <tbody>${mate.rows.map(([n, c, v]) => `<tr><td><b style="color:${c}">${n}</b></td>${cell(v, mate.total, c)}</tr>`).join('')
          || '<tr><td colspan="2" class="sub">還沒有造成傷害。</td></tr>'}</tbody>
        <tfoot><tr><td><b>合計</b></td><td>${fmt(mate.total)}</td></tr></tfoot></table>`).join('');
    this.dmgEl.innerHTML = `${coop ? NetView.teamSummaryHtml() : ''}${me}
      <table class="dmg-table"><thead><tr><th>來源</th><th>${label}</th><th>整局</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="sub">還沒有造成傷害。</td></tr>'}</tbody>
        <tfoot><tr><td><b>合計</b></td><td>${fmt(tS)}</td><td>${fmt(tR)}</td></tr></tfoot></table>
      ${mateTable}
      <p class="hint">怎麼算：武器打出去的算武器（回響算回響）；晶片放出的東西（迴旋刃、地雷、孢子）算那片晶片。爆炸、電弧、燃燒跟著原本那顆算。${coop ? '多人：傷害由房主計算，每秒同步一次。' : ''}</p>`;
  },
  changed() {
    if (this.dry) return;
    Game.packChain();  // 空格集中到最後（共用的空位）
    Game.recalc();
    this.render();
  },
  // 同種晶片合成：d 拖到 arr[i] 上 → 等級相加、插座取大的（見 mergedChip）
  //   合成後放在電路上的那一格（兩片都不在電路上就放目標那格）；兩片的插件都移過去，插不下的退回倉庫（靶場直接拿掉）
  merge(arr, i, d) {
    const C = Game.chain, inv = Game.inventory, r = this.ref(d), nid = mergedChip(this.srcId(d), arr[i]);
    const srcOnChain = r && r.arr === C, at = arr === C || !srcOnChain ? { arr, i } : r;
    const S = [...(arr === C ? Game.socks[i] || [] : []), ...(srcOnChain ? Game.socks[r.i] || [] : [])];
    const keep = S.slice(0, socketsOf(nid)), back = Game.mode === 'range' ? [] : S.slice(keep.length);
    const free = inv.filter(x => !x).length + (r && (r.arr === inv || arr === inv) ? 1 : 0);  // 倉庫那片合成走了，空出一格
    if (back.length > free) return this.warn(`倉庫放不下插不下的 ${back.length} 個插件，先清出倉庫`);
    if (r) r.arr[r.i] = null;
    if (srcOnChain) Game.socks[r.i] = [];
    if (arr === C) Game.socks[i] = [];
    arr[i] = null;
    at.arr[at.i] = nid;
    if (at.arr === C) Game.socks[at.i] = keep;
    for (const c of back) inv[inv.indexOf(null)] = c;
    if (this.dry) return;
    this.changed();
    Events.emit('upgrade');
    this.infoEl.innerHTML = `<b style="color:#ffd166">▲ 合成：${lvName(nid)}</b>` + (back.length ? `　插座放不下的 ${back.length} 個插件退回倉庫` : '');
  },
  // ---------- 拖曳或選取時，標出每個位置放不放得進去 ----------
  // t = { arr, i }（電路格）、{ sock: h }（第 h 格晶片的插座）或 { tail: true }（排尾的「＋」）；d = 拖的東西。試放一次再全部還原
  canDrop(t, d) {
    const s = this.snap(), sel = this.sel;
    this.dry = true; this.dryOk = true;
    try { if (t.sock != null) this.plug(t.sock, d); else if (t.tail) this.dropAppend(d); else this.dropOn(t.arr, t.i, d); } catch (e) { this.dryOk = false; }
    finally { this.dry = false; this.restore(s); this.sel = sel; Game.recalc(); }
    return this.dryOk;
  },
  // 還原成 snap 的樣子（原地改，電路、倉庫的陣列不換：拖放登記的位置還指著它們）
  restore(s) { Game.chain.splice(0, Infinity, ...s.chain); Game.inventory.splice(0, Infinity, ...s.inv); Game.socks = s.socks.map(x => x.slice()); },
  markTargets(d) {
    for (const { el, t } of this.targets || []) {
      const same = t.tail ? false : t.sock == null ? d.from === 'slot' && d.index === t.i : d.from === 'sock' && d.h === t.sock;
      const id = this.srcId(d), ok = same || (t.sock != null && !isComp(id) ? false : this.canDrop(t, d));  // 插座只收插件
      el.classList.toggle('nogo', !ok); el.classList.toggle('go', ok && !same);
      const m = ok && !same && t.arr && mergedChip(id, t.arr[t.i]);  // 放下去會合成：格子上預告合成後的等級
      if (m) el.dataset.merge = `合成 → Lv${lvOf(m)}`; else delete el.dataset.merge;
    }
  },
  clearMarks() { for (const { el } of this.targets || []) { el.classList.remove('nogo', 'go'); delete el.dataset.merge; } },
  // 拖放的來源：slot = 電路格、inv = 倉庫、sock = 第 h 格晶片的第 k 個插座、lib = 沙盒的晶片庫；目標另外有排尾的「＋」（dropAppend）
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
    if (cur && !(r && r.sock) && hasLv(id) && baseOf(id) === baseOf(cur))  // 同種晶片疊上去 = 合成
      return mergedChip(id, cur) ? this.merge(arr, i, d) : this.warn(`合起來超過 Lv${CFG.MAX_CHIP_LV}，不能合成`);
    if (arr === C) {
      if (isComp(id)) return cur && isHost(cur) ? this.plug(i, d) : this.warn('插件要插在晶片上：拖到武器或晶片（或它下面的插座）');
      if (cur && CHIPS[cur].locked) return this.lockedMsg(cur);  // 武器格不能放別的晶片
      const snap = this.snap();
      if (r && r.arr === C) {  // 電路上換位置：插座上的插件跟著晶片走
        if (CHIPS[id].locked) return this.lockedMsg(id);
        [C[i], C[r.i]] = [C[r.i], C[i]];
        [Game.socks[i], Game.socks[r.i]] = [Game.socks[r.i] || [], Game.socks[i] || []];
        return this.commit(snap);
      }
      // 從倉庫／晶片庫換上來：原本那格的晶片回倉庫，插座上的插件留著插在新的晶片上
      const nid = d.from === 'lib' ? newChip(d.id, CFG.MAX_SOCKETS) : id;
      if (d.from !== 'lib') r.arr[r.i] = cur || null;
      C[i] = nid;
      return this.commit(snap);
    }
    // 放到倉庫
    if (r && r.arr === C) {  // 電路上的晶片拿回倉庫：插座上的插件也退回倉庫
      if (CHIPS[id].locked) return this.lockedMsg(id);
      if (cur && isComp(cur)) return this.warn('倉庫那格是插件，不能換到電路格上');
      const back = Game.socks[r.i] || [], snap = this.snap();
      if (back.length > inv.filter((x, j) => !x && j !== i).length) return this.warn(`倉庫放不下${CHIPS[id].name}插座上的 ${back.length} 個插件，先清出倉庫`);
      C[r.i] = cur || null; inv[i] = id;
      if (cur) return this.commit(snap);  // 換上去的晶片接手插座上的插件
      Game.socks[r.i] = [];
      for (const c of back) inv[inv.indexOf(null)] = c;
      return this.changed();
    }
    if (r && r.sock) {  // 插座上的插件拔回倉庫
      if (cur && !isComp(cur)) return this.warn('插件只能跟倉庫裡的插件交換');
      const c = r.arr[r.i];
      if (cur) r.arr[r.i] = cur; else r.arr.splice(r.i, 1);
      inv[i] = c;
      return this.changed();
    }
    if (d.from === 'lib') inv[i] = newChip(d.id, CFG.MAX_SOCKETS);
    else [inv[i], r.arr[r.i]] = [r.arr[r.i], inv[i]];
    this.changed();
  },
  // 放到線的最後（排尾的「＋」）：用掉一個空位；從電路上拖過來 = 搬到最後（插件跟著走）
  dropAppend(d) {
    const id = this.srcId(d), r = this.ref(d);
    if (!id) return this.render();
    if (isComp(id)) return this.warn('插件要插在晶片上：拖到武器或晶片（或它下面的插座）');
    if (CHIPS[id].locked) return this.lockedMsg(id);
    const fromChain = r && r.arr === Game.chain;
    if (!fromChain && !Game.chain.includes(null)) return this.warn('電路沒有空位了（打完精英可以選電路擴充）');
    const snap = this.snap();
    let sk = [];
    if (fromChain) { sk = Game.socks[r.i] || []; Game.chain[r.i] = null; Game.socks[r.i] = []; }
    else if (r && !r.sock) r.arr[r.i] = null;
    Game.insertChip(d.from === 'lib' ? newChip(d.id, CFG.MAX_SOCKETS) : id, sk);
    this.commit(snap);
  },
  // 會變成「沒有作用」的擺法不給放：先記下配裝和沒作用的項目，做完如果多了，就還原並說明原因（拿掉、拔掉這類移除動作不檢查）
  snap() { return { chain: Game.chain.slice(), socks: (Game.socks || []).map(x => (x || []).slice()), inv: Game.inventory.slice(), idle: this.idleList() }; },
  idleList() {
    const info = compileLine(Game.chain).info, out = [];
    info.forEach((I, i) => { if (I.idle) out.push(I.why); for (const J of info.socks[i] || []) if (J.idle) out.push(J.why); });
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
    const hostId = Game.chain[h];
    if (!isHost(hostId)) return `${CHIPS[hostId].name}沒有插座（插件插在武器或晶片上）`;
    if (used >= socketsOf(hostId)) return `${CHIPS[hostId].name}的插座滿了（${socketsOf(hostId)} 個）${hostId === 'weapon' ? '；武器插座每打完一隻王 +1，最多 3 個' : ''}`;
    return '';
  },
  // 把插件插到第 h 格的晶片上（加在最後面）
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
    if (isComp(id)) {  // 倉庫的插件：插進武器或第一個還有空插座的晶片
      const h = Game.chain.findIndex((c, k) => c && !this.canPlug(k, id, (Game.socks[k] || []).length));
      return h >= 0 ? this.plug(h, { from: 'inv', index: i }) : this.warn('電路上沒有可以插這個插件的空插座');
    }
    this.dropAppend({ from: 'inv', index: i });  // 晶片接在線的最後
  },
  // 晶片庫點兩下（沙盒／靶場）：晶片接在最後；插件插進武器或第一個還有空插座的晶片
  libQuickAdd(id) {
    const d = { from: 'lib', id };
    if (isComp(id)) {
      const h = Game.chain.findIndex((c, k) => c && !this.canPlug(k, id, (Game.socks[k] || []).length));
      return h >= 0 ? this.plug(h, d) : this.warn('電路上沒有可以插這個插件的空插座');
    }
    this.dropAppend(d);
  },
  showDefaultInfo() {
    this.infoEl.innerHTML = '武器打中敵人 → 觸發下一片<b style="color:#5ef2d0">晶片</b> → 它的產物再觸發下一片。' +
      `<b style="color:${TYPE_META.comp.color}">插件</b>往後傳；同種晶片拖到一起＝<b style="color:#ffd166">合成</b>。`;
  },
  showInfo(id, slot = -1, J = null) {
    if (!id) { this.infoEl.innerHTML = ''; return; }
    const d = CHIPS[id], m = TYPE_META[d.type], lv = lvOf(id);
    const sk = isHost(id) ? `　<span style="color:${TYPE_META.comp.color}">◇ 插座 ${socketsOf(id)}</span>` : '';
    const price = !Game.freePlay() ? `　<span style="color:#6a79ad">回收 ◆${sellPrice(id)}</span>` : '';
    const lvT = hasLv(id) ? `　<span style="color:${lv >= CFG.MAX_CHIP_LV ? '#ffd166' : '#9dff6b'}">${LV_INFO[baseOf(id)][1][lv - 1]}${lv < CFG.MAX_CHIP_LV ? '（同種拖上來合成）' : '（滿級）'}</span>` : '';
    this.infoEl.innerHTML = `<b style="color:${m.color}">${m.icon} ${lvName(id)}</b>${sk}${lvT}${price}<br>` +
      (id === 'weapon' ? `插件作用在：${PLUG_ON.weapon}` : chipBrief(id)) + (chipPassLine(id) ? `<br><span style="color:#9dff6b">${chipPassLine(id)}</span>` : '') + (rareOf(id) ? `<br><b style="color:#ffd166">★ 稀有：${RARE_INFO[baseOf(id)]}</b>` : '') + (J && J.idle ? `<br><b style="color:#ff8a8a">✖ 這個插座沒有作用：${J.why}</b>` : '');
  },

  // 每格狀態（見 compileLine）：role 線頭／晶片、idle 沒有作用（why 原因）
  slotInfo(chain) { return compileLine(chain).info; },

  // 實測 DPS 一行（晶片卡、插座下面）：k = 傷害統計的 key，name = 插件要寫名字（插座圓太小）
  measEl(k, name = '') {
    const v = Game.freePlay() && Game.mode !== 'range' ? undefined : Game.measuredDps(k), el = document.createElement('div');
    el.className = 'meas';
    el.style.cssText = 'font-size:11px;text-align:center;color:' + (v == null ? '#6a79ad' : '#9dff6b');
    el.textContent = v == null ? '' : (name ? name + ' ' : '') + `每秒傷害 ${Math.round(v)}`;  // 還在測（不到 MEASURE_MIN 秒）就先空著
    el.title = `從裝在這個位置起，戰鬥中每秒實際造成的傷害（元素插件：那個元素造成的燃燒／爆炸／電弧；滿 ${CFG.MEASURE_MIN} 秒才顯示；換位置重新計算）`;
    return el;
  },
  // 插座：晶片卡下面的大圓。h = 第幾格的晶片，k = 第幾個插座（空的插座 id 是 null）
  sockEl(h, k, J) {
    const el = document.createElement('div'), C = Game.chain, S = Game.socks[h] || [], id = S[k] || null;
    if (id) {
      const m = TYPE_META[CHIPS[id].type], on = this.sel && this.sel.from === 'sock' && this.sel.h === h && this.sel.k === k;
      el.className = 'sock' + (J && J.idle ? ' idle' : '') + (on ? ' sel' : '');
      el.style.setProperty('--c', m.color);
      el.innerHTML = `<span>${CHIPS[id].short || CHIPS[id].name}</span>`;
      const fx = sockEffect(h, k);  // 插在這裡的實際效果
      el.title = `${CHIPS[id].name}\n${fx}`;
      el.draggable = true;
      el.addEventListener('dragstart', e => { e.stopPropagation(); e.dataTransfer.setData('text/plain', JSON.stringify({ from: 'sock', h, k })); this.markTargets({ from: 'sock', h, k }); });
      el.addEventListener('dragend', () => this.clearMarks());
      el.addEventListener('mouseenter', () => {
        if (this.sel) return;  // 選取中：說明框固定顯示選取的那一個
        this.infoEl.innerHTML = `<b style="color:${J && J.idle ? '#ff8a8a' : TYPE_META.comp.color}">◆ ${CHIPS[id].name}</b>　${fx}`;
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
      el.title = `空的插座：把插件拖進來插在${CHIPS[C[h]].name}上`;
      el.addEventListener('mouseenter', () => { this.infoEl.innerHTML = `<b style="color:${TYPE_META.comp.color}">◇ 空插座</b>　把插件拖進來`; });
      el.addEventListener('click', e => { e.stopPropagation(); if (this.sel) { const d = this.sel; this.sel = null; this.plug(h, d); } });
    }
    el.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); e.stopPropagation(); el.classList.remove('over'); const d = parseDrag(e); if (d) this.plug(h, d); });
    (this.targets = this.targets || []).push({ el, t: { sock: h } });
    return el;
  },

  makeSlot(arr, i, from, label, cls, idle, why, lv = lvOf(arr[i])) {
    const slot = document.createElement('div');
    slot.className = 'slot' + (cls ? ' ' + cls : '');
    slot.innerHTML = `<span class="idx">${label}</span>`;
    const id = arr[i];
    if (id) {
      const el = chipEl(id, lv);
      if (idle) { el.classList.add('idle'); el.title = why; }
      if (this.sel && this.sel.from === from && this.sel.index === i) el.classList.add('sel');
      el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/plain', JSON.stringify({ from, index: i })); this.markTargets({ from, index: i }); });
      el.addEventListener('dragend', () => this.clearMarks());
      if (from === 'slot') el.addEventListener('mouseenter', e => { e.stopImmediatePropagation(); if (!Editor.sel) Editor.showInfo(id, i); }, true);
      slot.appendChild(el);
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

  // 一格的欄（晶片卡＋實測＋插座）
  slotCol(i, info) {
    const chain = Game.chain, id = chain[i], I = info[i];
    const col = document.createElement('div');
    col.className = 'hgroup';
    col.appendChild(this.makeSlot(chain, i, 'slot', I.role === 'head' ? '⚡ 命中時觸發' : '', I.role === 'head' ? 'head' : '', I.idle, I.why, I.lv || 1));  // 線頭：角標寫什麼時候觸發
    col.appendChild(this.measEl(baseOf(id)));
    const socks = document.createElement('div');
    socks.className = 'socks';
    const S = Game.socks[i] || [], n = Math.max(socketsOf(id), S.length);
    for (let k = 0; k < n; k++) socks.appendChild(this.sockEl(i, k, (info.socks[i] || [])[k]));
    if (!n) socks.innerHTML = '<span class="nosock">沒有插座</span>';
    col.appendChild(socks);
    [...new Set(S.filter(Boolean).map(baseOf))].forEach(k => col.appendChild(this.measEl(k, CHIPS[k].name)));
    return col;
  },
  // 排尾的「＋」：放到線的最後（空位）
  addSlot(free) {
    const el = document.createElement('div');
    el.className = 'slot addslot';
    el.innerHTML = `<span class="empty">＋<br>空位 ${free}</span>`;
    el.addEventListener('mouseenter', () => { if (!this.sel) this.infoEl.innerHTML = `<b>電路的最後</b>：把晶片拖進來接在最後（空位還剩 ${free} 個）。`; });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); const d = parseDrag(e); if (d) this.dropAppend(d); });
    el.addEventListener('click', () => { if (this.sel) { const d = this.sel; this.sel = null; this.dropAppend(d); } });
    (this.targets = this.targets || []).push({ el, t: { tail: true } });
    return el;
  },

  render() {
    if (this.dry) return;
    this.targets = [];  // 拖曳時要標記的位置（makeSlot、sockEl、addSlot 登記）
    const chain = Game.chain, info = this.slotInfo(chain), free = chain.filter(x => !x).length;
    this.creditsEl.textContent = !Game.freePlay() ? `◆ ${Game.credits}` : Game.mode === 'range' ? '🎯 靶場' : '沙盒模式';
    this.recycleEl.innerHTML = !Game.freePlay() ? '♻ 回收<br>拖曳到這裡<br>換成晶體' : '✕ 移除<br>拖曳到這裡刪除';

    // 電路：一排（飛船晶片在最左，角標寫什麼時候觸發），排尾一個「＋」（空位）
    this.chainEl.innerHTML = '';
    const row = document.createElement('div');
    row.className = 'lrow';
    chain.forEach((id, i) => {
      if (!id) return;
      if (info[i].role === 'chip') row.insertAdjacentHTML('beforeend', '<div class="arrow">→</div>');
      row.appendChild(this.slotCol(i, info));
    });
    row.appendChild(this.addSlot(free));
    this.chainEl.appendChild(row);
    this.countEl.innerHTML = `空位 ${free} · <span>插件 ${sockCount()}</span>${CFG.MECH_SLOT_EVERY && chain.length < CFG.MAX_SLOTS ? ` · <span>機體強化 ${(Game.mechN || 0) % CFG.MECH_SLOT_EVERY} / ${CFG.MECH_SLOT_EVERY} → 電路格 +1</span>` : ''}`;

    this.invEl.innerHTML = '';
    Game.inventory.forEach((_, i) => this.invEl.appendChild(this.makeSlot(Game.inventory, i, 'inv', '倉庫 ' + (i + 1))));

    const s = Game.stats, P = Game.passives;
    const stat = (k, v) => `<div class="stat">${k}<b>${v}</b></div>`;
    this.statsEl.innerHTML =
      stat('每次開火子彈', s.count + ' 顆') +
      stat('單次總傷害', s.dmg.toFixed(0)) +
      stat('射速', s.rps.toFixed(1) + ' 次/秒') +
      stat('武器理論 DPS', s.dpsEst.toFixed(0));
    const L = Game.stats.line;
    this.layersEl.innerHTML = `◎ 線（命中時觸發）：${L.cells.length ? L.cells.map(c => lvName(c.id, c.lv)).join(' → ') : '還沒有晶片'}`;
    const pv = Object.entries(P).filter(([, v]) => v > 0).map(([k, v]) => PASSIVE_LABEL[k](+v.toFixed(2)));
    this.passEl.textContent = pv.length ? '倉庫被動：' + pv.join('、') : '';

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
      const inChain = ref.arr === Game.chain;
      this.selbarEl.innerHTML = `<span class="hint" style="margin:0">已選取「${CHIPS[selId].name}」：點其他插槽移動或交換</span>
        ${Game.mode === 'range' && (inChain || S.from === 'sock') ? '' : `<button data-sel="move">${inChain || S.from === 'sock' ? '移到倉庫' : '裝上電路'}</button>`}
        <button data-sel="recycle">${!Game.freePlay() ? `回收 ◆${sellPrice(selId)}` : '移除'}</button>
        <button data-sel="cancel">取消</button>`;
    } else this.selbarEl.innerHTML = '';
    if (this.sel) this.markTargets(this.sel);  // 點選了晶片或插件：放不進去的位置變灰
  },
};


// 插座上的插件「插在這裡」的實際效果（滑鼠移到插座上時顯示）：h = 第幾格的晶片，k = 第幾個插座
function sockEffect(h, k) {
  const host = Game.chain[h], id = (Game.socks[h] || [])[k];
  if (!host || !id) return '';
  const J = ((compileLine(Game.chain).info.socks || [])[h] || [])[k];
  if (J && J.idle) return `✖ 沒有作用：${J.why}`;
  return `${chipBrief(id)}（${host === 'weapon' ? '飛船所有攻擊' : CHIPS[host].name}和後面的晶片）`;
}

function chipEl(id, lv = lvOf(id)) {
  const d = CHIPS[id], m = TYPE_META[d.type];
  const el = document.createElement('div');
  el.className = 'chip t-' + d.type + (rareOf(id) ? ' rare' : '');
  el.draggable = !d.locked;
  const sk = isHost(id) && id !== 'weapon' ? `<span class="sk">${'◇'.repeat(socketsOf(id))}</span>` : '';  // 插件的卡片本身就是金色圓角，不用再標
  el.innerHTML = `<div class="top"><span>${m.icon} ${m.label}</span></div><div class="nm">${lvName(id, lv)}</div>${sk}`;
  el.addEventListener('mouseenter', () => { if (!Editor.sel) Editor.showInfo(id); });  // 選取中：說明框固定顯示選取的那一個（滑鼠移去目標格的路上不要亂切）
  return el;
}

function parseDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; }
}
