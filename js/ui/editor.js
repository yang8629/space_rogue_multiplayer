// 星環電路 雙人版 · editor.js：電路編輯器（Tab）：拖放、晶片傷害統計分頁
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
      if (b.dataset.sel === 'recycle') this.recycle(this.sel);
      if (b.dataset.sel === 'cancel') { this.sel = null; this.render(); }
    });

    this.mainEl = $('edMain'); this.dmgEl = $('edDmg'); this.shipEl = $('edShip'); this.shipTabEl = $('edShipTab');
    this.shipEl.addEventListener('click', e => {  // 靶場：換機體、換武器
      const b = e.target.closest('[data-pick]');
      if (!b) return;
      SFX.play('click');
      const [kind, id] = b.dataset.pick.split(':');
      if (kind === 'ship') Game.swapShip(id);
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
      btn.onclick = () => { Game.chain = PRESETS[btn.dataset.preset].slice(); this.changed(); };
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
  lockedMsg(id) {  // 武器與廢鐵都鎖定在原位
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
    this.shipTabEl.classList.toggle('hidden', Game.mode !== 'range');
    this.showDefaultInfo();
    this.render();
    this.setTab(this.tab === 'ship' && Game.mode !== 'range' ? 'main' : this.tab);  // 停在上次的分頁；統計分頁每次打開都重算
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
  // 靶場：切換機體、武器與武器升級（電路與倉庫保留）
  renderShip() {
    const on = (yes, col) => yes ? `outline:2px solid ${col};outline-offset:2px` : '';
    const ships = Object.entries(SHIPS).map(([id, S]) => `<div class="card" style="border-color:${S.color};${on(Game.shipId === id, S.color)}">
        <div class="ttl" style="color:${S.color}">${S.name}</div>
        <div class="ty">船體 ${S.hp}　·　速度 ${S.speed}　·　衝刺冷卻 ${S.dashCd} 秒${S.armor ? `　·　受傷 -${S.armor * 100}%` : ''}</div>
        <div class="ds">${S.desc}<br><b style="color:${S.color}">技能・${S.abilityName}</b>：${S.abilityDesc}</div>
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
    this.shipEl.innerHTML = `
      <h3>機體</h3><div class="cards" style="margin:8px 0">${ships}</div>
      <h3>武器</h3><div class="cards" style="margin:8px 0">${weapons}</div>
      <h3>武器升級：<span style="color:${W.color}">${weaponTitle(st)}</span></h3><div class="bar">${ups}</div>
      <p class="hint">換機體或武器時電路與倉庫都會保留，HP 回滿、靶場數據歸零。</p>`;
  },
  // 晶片傷害統計：本關（目前星區）與整局，依整局傷害排序
  renderDmg() {
    const R = Game.runStats, S = Game.sectorStats;
    if (!R) { this.dmgEl.innerHTML = '<div class="sub">還沒有開始遊戲。</div>'; return; }
    const keys = [...new Set([...Object.keys(R.chips), ...Object.keys(S.chips)])]
      .sort((a, b) => (R.chips[b] || 0) - (R.chips[a] || 0));
    const sum = o => Object.values(o).reduce((a, b) => a + b, 0);
    const tR = sum(R.chips), tS = sum(S.chips);
    const fmt = n => Math.round(n).toLocaleString('zh-TW');
    const color = k => k === 'weapon' ? WEAPONS[Game.weapon.id].color : k === 'ship' ? SHIPS[Game.shipId].color
      : CHIPS[k] ? TYPE_META[CHIPS[k].type].color : '#8fa3d9';
    const cell = (v, t, c) => `<td>${fmt(v || 0)}<span class="pct">${t ? Math.round((v || 0) / t * 100) : 0}%</span>
      <div class="bar"><div style="width:${t ? ((v || 0) / t * 100).toFixed(1) : 0}%;background:${c}"></div></div></td>`;
    const rows = keys.map(k => {
      const where = k === 'weapon' || k === 'ship' ? '' : Game.chain.some(id => id && baseOf(id) === k) ? ''
        : '<span style="color:#6a79ad">（目前不在電路上）</span>';
      return `<tr><td><b style="color:${color(k)}">${dmgKeyName(k)}</b>${where}</td>${cell(S.chips[k], tS, color(k))}${cell(R.chips[k], tR, color(k))}</tr>`;
    }).join('');
    const label = Game.freePlay() ? (Game.mode === 'range' ? '本次靶場' : '本次沙盒') : Game.isEndless() ? `本關（無盡 · 星區 ${Game.sector}）` : `本關（星區 ${Game.sector}）`;
    this.dmgEl.innerHTML = `
      <table class="dmg-table"><thead><tr><th>來源</th><th>${label}</th><th>整局</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="sub">還沒有造成傷害。</td></tr>'}</tbody>
        <tfoot><tr><td><b>合計</b></td><td>${fmt(tS)}</td><td>${fmt(tR)}</td></tr></tfoot></table>
      <p class="hint">怎麼算：每顆子彈的基礎傷害算給產生它的來源（武器；鏡像複製出的子彈算鏡像迴路；觸發器的回響算觸發器）。
        加工過子彈的晶片（倍增、分裂、巨大化…）依它讓傷害變成幾倍，按比例分走多出來的傷害；超頻、冷卻管線依射速提升分攤。
        爆炸、碎片、燃燒跟著原本那顆子彈算。共振器的效果算在被共振的晶片上。</p>`;
  },
  changed() { Game.recalc(); this.render(); },
  ref(d) {
    if (d.from === 'slot') return { arr: Game.chain, i: d.index };
    if (d.from === 'inv') return { arr: Game.inventory, i: d.index };
    return null;
  },
  dropOn(arr, i, d) {
    if (arr[i] && CHIPS[arr[i]].locked) return this.lockedMsg(arr[i]);  // 武器格、廢鐵格不能放東西
    if (d.from === 'lib') {  // 沙盒：放到同種晶片上 = 升一級
      if (arr[i] && baseOf(arr[i]) === d.id && canLevelUp(arr[i])) arr[i] = leveledId(d.id, levelOf(arr[i]) + 1);
      else arr[i] = d.id;
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
    this.infoEl.innerHTML = '電路由左至右執行：第 1 格固定是<b style="color:#4cc9f0">你的武器</b> → ' +
      '<b style="color:#b388ff">變形器</b>/<b style="color:#ffd166">增幅器</b>加工武器射出的子彈 → ' +
      '<b style="color:#ff6b9d">觸發器</b>讓子彈命中時用武器再射一次（50%），並套用右側晶片。<b style="color:#2ee6a6">連結器</b>強化或複製相鄰的晶片。點晶片可看說明。';
  },
  showInfo(id) {
    const d = CHIPS[id], m = TYPE_META[d.type];
    const ps = d.stored ? `<br><span style="color:#2ee6a6">倉庫被動：${Object.entries(d.stored).map(([k, v]) => PASSIVE_LABEL[k](v)).join('、')}</span>` : '';
    const price = !Game.freePlay() ? `　回收價 ◆${sellPrice(id)}` : '';
    this.infoEl.innerHTML = `<b style="color:${m.color}">${m.icon} ${d.name}</b>　` +
      `<span style="color:#6a79ad">${m.label} · 能量負載 ⚡${d.cost}${d.cost ? `（裝上電路射速 -${Math.round(d.cost * CFG.HEAT_RATE * 100)}%）` : ''}${price}</span><br>${d.desc}` +
      `${!d.lv && LV_INFO[id] ? '<br>' + lvLine(id, 1) : ''}${ps}`;
  },

  // 分析每格狀態：所在區段（第幾層命中）、是否生效
  slotInfo(chain) {
    const info = chain.map(() => ({ seg: 0, idle: false, why: '', trig: false }));
    chain.forEach((id, i) => {
      if (id === 'scrap') Object.assign(info[i], { idle: true, why: '廢鐵：沒有任何效果，只能在維修站拆除' });
      if (baseOf(id) === 'resonator' && ![i - 1, i + 1].some(j => chain[j] && !['link', 'scrap'].includes(CHIPS[chain[j]].type)))
        Object.assign(info[i], { idle: true, why: '左右沒有可共振的晶片' });
      if (id === 'mirror' && (!chain[i - 1] || CHIPS[chain[i - 1]].type === 'link'))
        Object.assign(info[i], { idle: true, why: '左側沒有可複製的晶片' });
    });
    const active = chain.map(() => false), reason = chain.map(() => '');
    let seg = 0, hasSrc = false, dead = false;
    for (const o of compileChain(chain)) {
      const s = o.slot, t = CHIPS[o.id].type;
      if (dead) { reason[s] = reason[s] || 'dead'; continue; }
      if (t === 'source') { hasSrc = true; active[s] = true; }
      else if (t === 'trigger') {
        // 觸發後的子電路開頭會自動用武器再射一次，所以右側一定有子彈可處理
        if (hasSrc && seg < CFG.MAX_TRIGGER_DEPTH) { active[s] = true; info[s].trig = true; seg++; hasSrc = true; }
        else { dead = true; reason[s] = reason[s] || (hasSrc ? 'depth' : 'nosrc'); }
      } else if (hasSrc) active[s] = true;
      else reason[s] = reason[s] || 'nosrc';
    }
    const WHY = { dead: '前方的觸發器無效，這格不會執行', nosrc: '左側（同一層）沒有發射源，沒有子彈可處理', depth: '已達觸發層數上限' };
    let running = 0;
    chain.forEach((id, i) => {
      info[i].seg = Math.min(3, running);
      if (info[i].trig) running++;
      if (id && !['link', 'scrap'].includes(CHIPS[id].type) && !active[i]) Object.assign(info[i], { idle: true, why: WHY[reason[i]] || '' });
    });
    return info;
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
    chain.forEach((id, i) => {
      if (i > 0) {
        const ar = document.createElement('div');
        if (info[i - 1].trig) { ar.className = 'arrow trig'; ar.innerHTML = '⤷<br>命中時'; }
        else { ar.className = 'arrow'; ar.textContent = '→'; }
        this.chainEl.appendChild(ar);
      }
      const I = info[i];
      this.chainEl.appendChild(this.makeSlot(chain, i, 'slot',
        `${i + 1}${I.seg ? ' · 命中第' + I.seg + '層' : ''}`, I.seg ? 'seg' + I.seg : '', I.idle, I.why));
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
      `◎ 命中第 ${i + 1} 層：每次命中展開 ${l.count} 顆 / ${l.dmg.toFixed(0)} 傷害`).join('　');
    const pl = Object.entries(P).filter(([, v]) => v > 0).map(([k, v]) => PASSIVE_LABEL[k](+v.toFixed(2)));
    this.passEl.textContent = pl.length ? '倉庫被動生效中：' + pl.join('、') : '倉庫被動：無';

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
  el.innerHTML = `<div class="top"><span>${m.icon} ${m.label}</span><span>⚡${d.cost}</span></div><div class="nm">${d.name}</div>`;
  el.addEventListener('mouseenter', () => Editor.showInfo(id));
  return el;
}

function parseDrag(e) {
  try { return JSON.parse(e.dataTransfer.getData('text/plain')); } catch { return null; }
}
