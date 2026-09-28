// 星環電路 雙人版 · codex.js：📖 電路總覽：規則、晶片、武器、圖表
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CODEX — 電路總覽（規則 / 晶片 / 複合與奇異點 / 武器 / 目前配置）
// =====================================================================
const Codex = {
  el: document.getElementById('codex'),
  body: document.getElementById('codexBody'),
  tab: 'rules',
  init() {
    this.el.addEventListener('click', e => {
      const b = e.target.closest('[data-cx]');
      if (!b) return;
      SFX.play('click');
      if (b.dataset.cx === 'close') this.close();
      else if (b.dataset.cx === 'runmech') { MechCheck.runAll(); this.render(); }
      else { this.tab = b.dataset.cx; this.render(); this.body.scrollTop = 0; }
    });
  },
  get isOpen() { return !this.el.classList.contains('hidden'); },
  hasRun() { return !!Game.player && Game.state !== 'title'; },
  open(tab) {
    this.tab = tab === 'current' && !this.hasRun() ? 'rules' : tab;
    this.render();
    this.el.classList.remove('hidden');
  },
  close() { this.el.classList.add('hidden'); },

  render() {
    const tabs = [['rules', '規則'], ['chips', '晶片'], ['special', '複合／奇異點'], ['weapons', '武器']];
    if (this.hasRun()) tabs.push(['current', '目前配置']);
    tabs.push(['charts', '數值圖表'], ['mech', '機制檢查']);
    this._charts = {};
    const content = { rules: this.rules, chips: this.chips, special: this.special, weapons: this.weapons, current: this.current,
      charts: this.charts, mech: this.mech }[this.tab].call(this);
    this.body.innerHTML = `<div class="between"><h2>📖 電路總覽</h2><button data-cx="close">關閉 (Esc)</button></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-cx="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${content}`;
    if (this.tab === 'charts') this.bindCharts();
  },

  // ---------- 機制檢查 ----------
  mech() {
    if (!MechCheck.results) MechCheck.runAll();
    const R = MechCheck.results, pass = R.list.filter(r => r.ok).length, all = R.list.length;
    let group = '', rows = '';
    for (const r of R.list) {
      if (r.group !== group) { group = r.group; rows += `<h3 style="margin:12px 0 2px">${group}</h3>`; }
      rows += `<div class="mech-row"><span class="st ${r.ok ? 'ok' : 'ng'}">${r.ok ? '✓' : '✗'}</span>
        <span><b style="color:#fff">${r.name}</b>${r.ok ? '' : '　<span style="color:#ff6b6b">未觸發</span>'}</span>
        <span class="ex">${r.expect}</span><span class="got">${r.got}</span></div>`;
    }
    return `<div class="between codex-sec" style="margin-top:8px">
        <div><span class="pill" style="color:${pass === all ? '#0ca30c' : '#ff6b6b'}">${pass === all ? '✓' : '✗'} 通過 ${pass} / ${all}</span>
          <span class="sub" style="margin-left:8px">用遊戲引擎在測試靶場實際跑一遍，耗時 ${Math.round(R.ms)} ms。你的遊戲進度不受影響。</span></div>
        <button data-cx="runmech">重新檢查</button></div>
      <div class="mech"><div class="mech-row mech-head"><span></span><span>機制</span><span>預期</span><span>實測結果</span></div>${rows}</div>`;
  },

  // ---------- 數值圖表 ----------
  // 折線圖：xs 為 x 軸標籤、series 為 [{ name, color, values }]；回傳 SVG，並登記滑鼠提示資料
  lineChart(key, { xs, series, yFmt = v => v, tipTitle = x => x, tipExtra = () => '', height = 260 }) {
    const W = 640, H = height, L = 46, Rm = 108, Tm = 12, B = 32;
    const all = series.flatMap(s => s.values), max = Math.max(...all), min = Math.min(0, ...all);
    const step = niceStep((max - min) / 5), top = Math.ceil(max / step) * step;
    const x = i => L + (W - L - Rm) * (xs.length === 1 ? 0.5 : i / (xs.length - 1));
    const y = v => Tm + (H - Tm - B) * (1 - (v - min) / (top - min));
    let g = '';
    for (let v = min; v <= top + 1e-9; v += step)
      g += `<line x1="${L}" x2="${W - Rm}" y1="${y(v)}" y2="${y(v)}" stroke="#182244" stroke-width="1"/>` +
        `<text x="${L - 8}" y="${y(v) + 4}" fill="#8fa3d9" font-size="11" text-anchor="end">${yFmt(+v.toFixed(4))}</text>`;
    const every = Math.ceil(xs.length / 8);
    xs.forEach((lab, i) => {
      if (i % every === 0 || i === xs.length - 1)
        g += `<text x="${x(i)}" y="${H - B + 18}" fill="#8fa3d9" font-size="11" text-anchor="middle">${lab}</text>`;
    });
    g += `<line x1="${L}" x2="${W - Rm}" y1="${y(min)}" y2="${y(min)}" stroke="#2c3a66" stroke-width="1"/>`;
    // 線、標記、線尾直接標名稱（避開彼此重疊）
    const ends = [];
    for (const s of series) {
      g += `<polyline fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"
        points="${s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>`;
      if (xs.length <= 12) s.values.forEach((v, i) => g += `<circle cx="${x(i)}" cy="${y(v)}" r="4" fill="${s.color}" stroke="#070b1a" stroke-width="2"/>`);
      ends.push({ name: s.name, y: y(s.values[s.values.length - 1]) });
    }
    ends.sort((a, b) => a.y - b.y);
    for (let i = 1; i < ends.length; i++) ends[i].y = Math.max(ends[i].y, ends[i - 1].y + 13);
    // 最下面的標籤不能超出圖表底部：超出時整組往上推
    if (ends.length) ends[ends.length - 1].y = Math.min(ends[ends.length - 1].y, H - B - 4);
    for (let i = ends.length - 2; i >= 0; i--) ends[i].y = Math.min(ends[i].y, ends[i + 1].y - 13);
    for (const e of ends) g += `<text x="${W - Rm + 8}" y="${e.y + 4}" fill="#c9d4ff" font-size="11">${e.name}</text>`;
    g += `<line data-role="cross" x1="0" x2="0" y1="${Tm}" y2="${H - B}" stroke="#8fa3d9" stroke-width="1" stroke-dasharray="3 3" visibility="hidden"/>`;
    g += `<rect data-role="hit" x="${L}" y="${Tm}" width="${W - L - Rm}" height="${H - Tm - B}" fill="transparent"/>`;
    this._charts[key] = { xs, series, x, W, yFmt, tipTitle, tipExtra };
    const legend = series.length > 1
      ? `<div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${s.name}</span>`).join('')}</div>` : '';
    return `${legend}<svg data-chart="${key}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg><div class="viz-tip" hidden></div>`;
  },
  table(head, rows) {
    return `<details><summary>數據表</summary><div class="tbl"><table>
      <tr>${head.map(h => `<th>${h}</th>`).join('')}</tr>
      ${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`).join('')}</table></div></details>`;
  },
  bindCharts() {
    for (const svg of this.body.querySelectorAll('svg[data-chart]')) {
      const spec = this._charts[svg.dataset.chart], tip = svg.nextElementSibling, box = svg.parentElement;
      const hit = svg.querySelector('[data-role="hit"]'), cross = svg.querySelector('[data-role="cross"]');
      const show = e => {
        const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * spec.W;
        let best = 0;
        spec.xs.forEach((_, i) => { if (Math.abs(spec.x(i) - vx) < Math.abs(spec.x(best) - vx)) best = i; });
        cross.setAttribute('x1', spec.x(best)); cross.setAttribute('x2', spec.x(best)); cross.setAttribute('visibility', 'visible');
        tip.innerHTML = `<b>${spec.tipTitle(spec.xs[best])}</b>` +
          spec.series.map(s => `<div><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${s.color};margin-right:6px"></i>${s.name}<span class="v">${spec.yFmt(s.values[best])}</span></div>`).join('') +
          spec.tipExtra(best);
        tip.hidden = false;
        const br = box.getBoundingClientRect(), px = e.clientX - br.left, py = e.clientY - br.top;
        tip.style.left = Math.min(px + 14, br.width - tip.offsetWidth - 8) + 'px';
        tip.style.top = Math.max(8, py - tip.offsetHeight - 12) + 'px';
      };
      const hide = () => { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', hide);
    }
  },

  charts() {
    const S = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];  // 已驗證：深色面板上色盲安全
    const savedWp = Game.wp, savedInv = Game.inventory;
    const f2 = v => (+v.toFixed(2)).toString();

    // 1. 武器 DPS：照升級樹排（每把武器一張卡，3 條路線，每格標 DPS 與比基礎型提升多少）
    const trees = Object.keys(WEAPONS).map(id => ({ id, W: WEAPONS[id], t: weaponDpsTree(id) }));
    const maxDps = Math.max(...trees.flatMap(({ t }) => [t.base, ...Object.values(t.paths).flatMap(p => [p.dps, ...p.next])]));
    const rows1 = [];
    const node = (name, desc, v, base) => `<div class="wt-node" title="${name}：${desc.replace(/<[^>]+>/g, '')}">
        <div class="wt-top"><b class="wt-name">${name}</b><span class="wt-num">${Math.round(v)}<em>${pctUp(v, base)}</em></span></div>
        <div class="wt-track"><div style="width:${(v / maxDps * 100).toFixed(1)}%"></div></div>
        <div class="wt-desc">${desc}</div></div>`;
    const cards = trees.map(({ id, W, t }) => {
      rows1.push([`${W.name}・基礎型`, Math.round(t.base), '—']);
      const cols = Object.entries(W.paths).map(([k, P]) => {
        const d = t.paths[k];
        rows1.push([`${W.name}・${P.name}`, Math.round(d.dps), pctUp(d.dps, t.base)]);
        P.next.forEach((n, i) => rows1.push([`${W.name}・${P.name} → ${n.name}`, Math.round(d.next[i]), pctUp(d.next[i], t.base)]));
        return `<div class="wt-path">
          <div class="wt-stage">第一段</div>${node(P.name, P.desc, d.dps, t.base)}
          <div class="wt-stage">第二段：二選一</div>
          <div class="wt-finals">${P.next.map((n, i) => node(n.name, n.desc, d.next[i], t.base)).join('')}</div></div>`;
      }).join('');
      return `<div class="wt-card" style="--wc:${W.color}">
        <div class="wt-head"><span><i></i>${W.name}</span><span>基礎型 DPS <b>${Math.round(t.base)}</b></span></div>
        <div class="wt-paths">${cols}</div></div>`;
    }).join('');

    // 2. 射速 vs 能量負載（各武器基礎型）
    const heats = Array.from({ length: 17 }, (_, i) => i);
    const rateSeries = Object.entries(WEAPONS).map(([id, W], i) => {
      const p = weaponParams({ id, path: null, final: null });
      return { name: W.name, color: S[i], values: heats.map(h => 1 / Math.max(CFG.MIN_INTERVAL, p.interval / heatRateMul(h) * p.rate)) };
    });

    // 3. 晶片等級帶來的傷害倍率
    const lv = [1, 2, 3], pw = l => lvMulOf(l);
    const chipSeries = [
      { name: '威力倍增器', f: l => 1 + pw(l) },
      { name: '分裂（總傷害）', f: l => 0.4 * Math.round(3 + 2 * (pw(l) - 1)) },
      { name: '協同（4 晶片）', f: l => 1 + 0.12 * pw(l) * 4 },
      { name: '鏈結（倉庫 4）', f: l => 1 + 0.1 * pw(l) * 4 },
      { name: '巨大化', f: l => 1 + 0.3 * pw(l) },
      { name: '聚焦透鏡', f: l => 1 + 0.15 * pw(l) },
    ].map((c, i) => ({ name: c.name, color: S[i], values: lv.map(c.f) }));

    // 4. 敵人血量倍率（每星區 7 層，第 1 波與第 3 波）
    const pts = [];
    for (let s = 1; s <= 3; s++) for (let L = 0; L < 7; L++) pts.push({ s, L, level: L + (s - 1) * 7 });
    const hpMul = (level, wave) => 1 + level * 0.15 + (wave - 1) * 0.08;
    const hpSeries = [1, 3].map((w, i) => ({ name: `第 ${w} 波`, color: S[i], values: pts.map(pt => hpMul(pt.level, w)) }));
    const hpTip = i => {
      const pt = pts[i], m = hpMul(pt.level, 1);
      const B = ENEMY_TYPES[CFG.BOSS_ORDER[pt.s - 1]];
      const list = pt.L === 6 ? [[B.name, B.hp]]
        : [['蟲群', ENEMY_TYPES.swarmer.hp], ['刺殼', ENEMY_TYPES.brute.hp], ['噴吐者', ENEMY_TYPES.spitter.hp], ['虛空獵手', ENEMY_TYPES.elite.hp]];
      return `<div style="margin-top:4px;color:var(--muted)">第 1 波實際血量</div>` +
        list.map(([n, hp]) => `<div>${n}<span class="v">${Math.round(hp * m)}</span></div>`).join('');
    };

    Game.wp = savedWp; Game.inventory = savedInv;
    const xsHp = pts.map(p => `${p.s}-${p.L + 1}`);
    return `
      <div class="viz"><h4>武器升級 DPS</h4>
        <div class="cap">每把武器照升級樹排：先選第一段（3 條路線之一），再從它下面的 2 個第二段選一個。
          數字是電路沒有其他晶片時的估算 DPS，括號是比基礎型提升多少；「最高」標出這把武器 DPS 最高的最終型態。
          含爆炸、燃燒、碎片的預估傷害，不含彈射。相位刃假設刃片全部打中，實際打單一敵人會低一些。</div>
        ${cards}
        ${this.table(['型態', '估算 DPS', '比基礎型'], rows1)}</div>

      <div class="viz"><h4>射速與能量負載</h4>
        <div class="cap">電路上每 1 點 ⚡，射速 -${CFG.HEAT_RATE * 100}%（每把武器都一樣），最多降到原本的 ${CFG.HEAT_RATE_FLOOR * 100}%。圖上是各武器基礎型在不同能量下的每秒開火次數。</div>
        ${this.lineChart('rate', { xs: heats, series: rateSeries, yFmt: v => (+v.toFixed(1)) + '/秒', tipTitle: x => `能量負載 ${x}` })}
        ${this.table(['能量負載', ...rateSeries.map(s => s.name)], heats.map((h, i) => [h, ...rateSeries.map(s => s.values[i].toFixed(2))]))}</div>

      <div class="viz"><h4>晶片等級與傷害倍率</h4>
        <div class="cap">影響傷害的晶片在 Lv1 → Lv3 的傷害倍率（Lv2 強度 ×1.5、Lv3 強度 ×2）。協同處理器以電路中 4 個其他晶片、資料鏈結以倉庫 4 個晶片計算。</div>
        ${this.lineChart('chiplv', { xs: lv.map(l => 'Lv' + l), series: chipSeries, yFmt: v => '×' + f2(v), height: 280 })}
        ${this.table(['晶片', 'Lv1', 'Lv2', 'Lv3'], chipSeries.map(s => [s.name, ...s.values.map(v => '×' + f2(v))]))}</div>

      <div class="viz"><h4>敵人血量成長</h4>
        <div class="cap">x 軸為「星區-層」。難度等級 ＝ 層數 ＋（星區 − 1）× 7；血量倍率 ＝ 1 ＋ 難度 × 0.15 ＋（波次 − 1）× 0.08。滑鼠移上去可看各敵人的實際血量；第 7 層是 Boss 戰。</div>
        ${this.lineChart('hp', { xs: xsHp, series: hpSeries, yFmt: v => '×' + f2(v), tipTitle: x => `星區 ${x.split('-')[0]}・第 ${x.split('-')[1]} 層`, tipExtra: hpTip })}
        ${this.table(['星區-層', '難度等級', '第 1 波', '第 3 波'], pts.map((p, i) => [xsHp[i], p.level, '×' + f2(hpSeries[0].values[i]), '×' + f2(hpSeries[1].values[i])]))}</div>`;
  },

  rules() {
    const R = (t, d) => `<div><b>${t}</b><br>${d}</div>`;
    const bosses = CFG.BOSS_ORDER.map((id, i) => `第 ${i + 1} 關 <b style="color:${ENEMY_TYPES[id].color}">${ENEMY_TYPES[id].name}</b>：${ENEMY_TYPES[id].desc}`).join('<br>');
    return `<div class="rules codex-sec">
      ${R('遠征流程', `遠征共 ${CFG.CAMPAIGN_SECTORS} 關（星區），每關 7 層，最後一層是守關旗艦，每關的旗艦都不同：<br>${bosses}<br>
        打完第 ${CFG.CAMPAIGN_SECTORS} 關算遠征完成，可以選擇結束（存下通關紀錄），或帶著目前的電路繼續<b>無盡模式</b>：星區一直往下，敵人持續變強，旗艦從三隻裡隨機出現。<br>
        每張航圖只有 1 個軍械台；精英戰之後至少有一條路通往維修站；維修站、補給站都不會連著出現。`)}
      ${R('執行順序', '電路由左至右執行。第 1 格固定是你的武器，負責產生子彈；右邊的晶片依序加工「目前已經存在」的子彈，所以順序很重要。例如分裂放在倍增前或後，加工到的子彈數不同。')}
      ${R('晶片種類', `<span style="color:${TYPE_META.mod.color}">◇ 變形器</span>：改變子彈的數量、軌跡、穿透。<br>
        <span style="color:${TYPE_META.amp.color}">▲ 增幅器</span>：改變傷害、體積、射速。<br>
        <span style="color:${TYPE_META.trigger.color}">◎ 觸發器</span>：命中時用武器再射一次（50%），並套用它右邊的晶片。右邊的晶片不會在開火時執行，最多巢狀 ${CFG.MAX_TRIGGER_DEPTH} 層。<br>
        <span style="color:${TYPE_META.link.color}">⇄ 連結器</span>：不直接加工子彈，而是強化或複製相鄰的晶片。`)}
      ${R('能量負載與射速', `每個晶片右上角的 ⚡ 是能量負載。電路上所有晶片的 ⚡ 加起來，<b>每 1 點讓射速 -${CFG.HEAT_RATE * 100}%</b>，每把武器都一樣。<br>
        例：⚡5 → 射速 -${5 * CFG.HEAT_RATE * 100}%；⚡10 → 射速 -${10 * CFG.HEAT_RATE * 100}%。最多降到原本的 ${CFG.HEAT_RATE_FLOOR * 100}%（⚡${Math.round((1 - CFG.HEAT_RATE_FLOOR) / CFG.HEAT_RATE)} 以上不會再更慢）。<br>
        放在倉庫的晶片不算能量。冷卻管線可以扣掉能量；超頻核心會另外讓射速變快。`)}
      ${R('擊退', `每把武器的擊退值不同：${Object.values(WEAPONS).map(W => `${W.name} ${W.base.knock}`).join('、')}（鋼珠、攻城砲 ×2）。巨大化線圈每級擊退 +0.5。<br>
        一般敵人都會被推。旗艦有抗擊退，子彈的擊退值<b>超過</b>抗性才推得動，力道只看超過的部分：${CFG.BOSS_ORDER.map(id => `${ENEMY_TYPES[id].name} ${ENEMY_TYPES[id].knockResist}`).join('、')}。爆炸、震波、電弧不會推王。`)}
      ${R('增幅相加', '倍增器、巨大化、協同處理器、資料鏈結、超載・威力、聚焦透鏡的 +15%、超頻核心的 -15%，這些傷害加成全部<b>相加</b>後才乘上去：兩個倍增器是 +100% +100% = ×3，不是 ×4。分裂（每顆 ×0.4）、子彈上限換算、武器升級、相位超載則照舊相乘。')}
      ${R('子彈上限', `<b>每次開火</b>（包含每次命中觸發的回響）最多 ${CFG.MAX_SHOTS_PER_FIRE} 發：超過的數量平均換算成每發的傷害，總傷害不變（例：分裂到 64 發 → 只射 32 發，每發傷害 ×2）。<br>
        另外有兩個防止卡頓的上限，超過的部分<b>會直接消失</b>：畫面上的玩家子彈最多 ${CFG.MAX_LIVE_BULLETS} 發；同一幀最多處理 ${CFG.MAX_TRIGGERS_PER_FRAME} 次命中觸發。平常打不到，只有極端的觸發＋分裂電路才會碰到。`)}
      ${R('強度（等級與共振）', `「強度」是晶片效果的倍率，每種晶片放大的東西不同，例如分裂模組放大分裂數量（3 → 4 → 5 顆）、威力倍增器放大傷害倍率（×2 → ×2.5 → ×3）。各晶片的實際數值寫在「晶片」分頁的卡片上。<br>
        強度的來源有兩個：<br>・<b>晶片等級</b>：再拿到已擁有的同種晶片會自動合成升級，Lv2 強度 ×1.5、Lv3 強度 ×2，倉庫被動也一起放大。<br>
        ・<b>共振器</b>：左右相鄰晶片的強度 +${CFG.RESONANCE * 100}%，兩個共振器夾同一格可以疊加。`)}
      ${R('倉庫', `倉庫 ${CFG.INV_SLOTS} 格。部分晶片放在倉庫時提供被動效果；同一個晶片要裝上電路，還是留在倉庫拿被動，需要取捨。不要的晶片可以回收，拿回 40% 售價。`)}
      ${R('插槽', `開局 ${CFG.START_SLOTS} 格，最多 ${CFG.MAX_SLOTS} 格。來源：擊敗 Boss、補給站購買（◆${CFG.SHOP_SLOT}）、精英戰獎勵、武器升滿後的軍械台。`)}
      ${R('黑洞融合', '投入 2 個晶片：50% 融合成奇異點（兩個效果合進一格，再加一個超載詞綴），50% 變成廢鐵（卡住插槽，只能在維修站拆除）。')}
    </div>`;
  },

  chips() {
    const groups = ['mod', 'amp', 'trigger', 'link'];
    return groups.map(t => {
      const ids = NORMAL_IDS.filter(id => CHIPS[id].type === t);
      const m = TYPE_META[t];
      const cards = ids.map(id => chipCard(id,
        `${id === 'mirror' ? '<div class="ty">不能升級</div>' : ''}<div class="ty">售價 ◆${chipPrice(id)}</div>`)).join('');
      return `<div class="codex-sec"><h3 style="color:${m.color}">${m.icon} ${m.label}（${ids.length}）</h3><div class="cards" style="justify-content:flex-start;margin:0">${cards}</div></div>`;
    }).join('');
  },

  special() {
    const sg = Object.keys(CHIPS).filter(id => CHIPS[id].type === 'singularity');
    const ov = OVERLOADS.map(id => `<div><b style="color:#e0aaff">${CHIPS[id].name}</b>：${CHIPS[id].desc}</div>`).join('');
    return `<div class="codex-sec"><h3 style="color:${TYPE_META.composite.color}">✦ 軍規複合晶片（精英戰掉落）</h3>
        <div class="cards" style="justify-content:flex-start;margin:0">${COMPOSITE_IDS.map(id => chipCard(id)).join('')}</div></div>
      <div class="codex-sec"><h3 style="color:#e0aaff">✺ 奇異點超載詞綴（融合成功時隨機附加 1 個）</h3>
        <div class="rules">${ov ? `<div>${ov}</div>` : ''}</div></div>
      <div class="codex-sec"><h3 style="color:#e0aaff">✺ 這一場融合出的奇異點</h3>
        ${sg.length ? `<div class="cards" style="justify-content:flex-start;margin:0">${sg.map(id => chipCard(id)).join('')}</div>`
          : '<div class="sub">還沒有。在航圖上的「◐ 黑洞」節點融合晶片即可取得。</div>'}</div>
      <div class="codex-sec"><h3 style="color:${TYPE_META.scrap.color}">✖ 廢鐵</h3>
        <div class="cards" style="justify-content:flex-start;margin:0">${chipCard('scrap', `<div class="ty">維修站拆除費用 ◆${CFG.SCRAP_REMOVE}</div>`)}</div></div>`;
  },

  weapons() {
    return Object.entries(WEAPONS).map(([id, W]) => {
      const p = weaponParams({ id, path: null, final: null });
      const cur = this.hasRun() && Game.weapon.id === id ? '　<span class="pill">目前使用</span>' : '';
      const t = weaponDpsTree(id);
      const dps = v => `<span style="color:#8fa3d9">估算 DPS <b style="color:#fff">${Math.round(v)}</b>（${pctUp(v, t.base)}）</span>`;
      const cols = Object.entries(W.paths).map(([k, P]) => `<div>
        <div class="wt-stage">第一段</div>
        <b style="color:${W.color}">${P.name}</b>　${dps(t.paths[k].dps)}<br>${P.desc}
        <div class="wt-stage">第二段：二選一</div>
        ${P.next.map((n, i) => `<div class="leaf"><b>${n.name}</b>　${dps(t.paths[k].next[i])}<br>${n.desc}</div>`).join('')}</div>`).join('');
      return `<div class="codex-sec"><h3 style="color:${W.color}">${W.name}${cur}</h3>
        <div class="sub" style="margin:0">${W.desc}　單發 ${p.damage} × ${p.count}，每秒 ${(1 / p.interval).toFixed(1)} 次，擊退 ${p.knock}，基礎型估算 DPS ${Math.round(t.base)}</div>
        <div class="tree">${cols}</div></div>`;
    }).join('');
  },

  current() {
    const s = Game.stats, info = Editor.slotInfo(Game.chain), ops = s.ops;
    const rows = Game.chain.map((id, i) => {
      if (!id) return `<div class="slotrow idle"><div class="no">第 ${i + 1} 格</div><div>空插槽</div></div>`;
      const d = CHIPS[id], m = TYPE_META[d.type], my = ops.filter(o => o.slot === i);
      const pw = my.length ? my[0].pw : (d.lvMul || 1);
      const notes = [];
      if (i === 0) notes.push(`武器：${weaponTitle(Game.weapon)}`);
      if (pw !== 1) notes.push(`強度 ×${+pw.toFixed(2)}（${[d.lv > 1 && `Lv${d.lv}`, pw / (d.lvMul || 1) > 1 && '共振'].filter(Boolean).join('＋')}）`);
      if (info[i].seg) notes.push(`命中第 ${info[i].seg} 層才執行`);
      if (info[i].idle) notes.push(`<span style="color:#ff8a8a">不會生效：${info[i].why}</span>`);
      const color = id === 'weapon' ? Game.wp.color : m.color;
      return `<div class="slotrow${info[i].idle ? ' idle' : ''}"><div class="no">第 ${i + 1} 格</div>
        <div><b style="color:${color}">${m.icon} ${d.name}</b>　<span style="color:#6a79ad">${id === 'weapon' ? '武器' : m.label} · ⚡${d.cost}</span>
        ${notes.length ? `<br>${notes.join('　·　')}` : ''}<br>${d.desc}</div></div>`;
    }).join('');
    const P = Game.passives;
    const pl = Object.entries(P).filter(([, v]) => v > 0).map(([k, v]) => PASSIVE_LABEL[k](+v.toFixed(2)));
    const stat = (k, v) => `<div class="stat">${k}<b>${v}</b></div>`;
    return `<div class="stats">
        ${stat('每次開火子彈', s.count + ' 顆')}${stat('單次總傷害', s.dmg.toFixed(0))}${stat('射速', s.rps.toFixed(1) + ' 次/秒')}
        ${stat('估算 DPS', s.dpsEst.toFixed(0))}${stat('能量負載', '⚡ ' + s.heat)}</div>
      ${s.layers.length ? `<div class="layers">${s.layers.map((l, i) => `◎ 命中第 ${i + 1} 層：每次命中展開 ${l.count} 顆 / ${l.dmg.toFixed(0)} 傷害`).join('　')}</div>` : ''}
      <div class="codex-sec"><h3>電路逐格拆解（${Game.chain.length} 格）</h3><div class="rules">${rows}</div></div>
      <div class="codex-sec"><h3>倉庫（${Game.inventory.filter(Boolean).length} / ${CFG.INV_SLOTS}）</h3>
        <div class="passives" style="margin:0">${pl.length ? '被動生效中：' + pl.join('、') : '沒有生效中的倉庫被動'}</div>
        <div class="sub">${Game.inventory.filter(Boolean).map(id => CHIPS[id].name).join('、') || '倉庫是空的'}</div></div>`;
  },
};


// 一把武器所有型態的估算 DPS（電路只有武器時），照升級樹的形狀回傳
function weaponDpsTree(id) {
  const W = WEAPONS[id], saved = Game.wp;
  const dps = (path, final) => { Game.wp = weaponParams({ id, path, final }); return analyzeChain(['weapon']).dpsEst; };
  const tree = { base: dps(null, null), paths: {} };
  for (const k of Object.keys(W.paths)) tree.paths[k] = { dps: dps(k, null), next: W.paths[k].next.map((_, i) => dps(k, i)) };
  Game.wp = saved;
  return tree;
}
const pctUp = (v, base) => { const p = Math.round((v / base - 1) * 100); return p === 0 ? '±0%' : (p > 0 ? '+' : '') + p + '%'; };

function niceStep(raw) {  // 圖表刻度：取 1 / 2 / 2.5 / 5 × 10^n
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
