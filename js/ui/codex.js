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
    const tabs = [['rules', '規則'], ['chips', '晶片'], ['body', '機體與地圖'], ['special', '奇異點'], ['weapons', '武器']];
    if (this.hasRun()) tabs.push(['current', '目前配置']);
    tabs.push(['charts', '數值圖表'], ['mech', '機制檢查']);
    this._charts = {};
    const content = { rules: this.rules, chips: this.chips, body: this.bodyTab, special: this.special, weapons: this.weapons, current: this.current,
      charts: this.charts, mech: this.mech }[this.tab].call(this);
    this.body.innerHTML = `<div class="between"><h2>📖 電路總覽</h2><button data-cx="close">關閉 (Esc)</button></div>
      <div class="tabs">${tabs.map(([k, l]) => `<button data-cx="${k}" class="${this.tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${content}`;
    if (this.tab === 'charts') { this.bindCharts(); this.bindScatter(); }
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
  // 落點圖：pts = [{ x, y, k（系列序號）, tip（滑鼠提示 HTML） }]；invertY：數值小的畫在上面（右上角 = 好）
  //   xRef／yRef 畫虛線（沒有效果的位置）；超出 clampX／clampY 的點畫在邊上（提示照實際數字）
  scatterChart(key, { pts, xName, yName, xFmt, yFmt, xRef, yRef, invertY = false, clampX, clampY, corner, height = 360 }) {
    const W = 640, H = height, L = 50, R = 14, T = 26, B = 40;
    const cl = (v, c) => c ? Math.max(c[0], Math.min(c[1], v)) : v;
    const P = pts.map(p => ({ ...p, cx: cl(p.x, clampX), cy: cl(p.y, clampY) }));
    const ext = vs => { const lo = Math.min(...vs), hi = Math.max(...vs), st = niceStep((hi - lo) / 5 || 0.1); return [Math.floor(lo / st - 0.3) * st, Math.ceil(hi / st + 0.3) * st, st]; };
    const [x0, x1, xst] = ext([...P.map(p => p.cx), xRef]), [y0, y1, yst] = ext([...P.map(p => p.cy), yRef]);
    const x = v => L + (W - L - R) * (v - x0) / (x1 - x0);
    const y = v => { const f = (v - y0) / (y1 - y0); return T + (H - T - B) * (invertY ? f : 1 - f); };
    let g = '';
    for (let v = x0; v <= x1 + 1e-9; v += xst)
      g += `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${H - B}" stroke="#182244" stroke-width="1"/>` +
        `<text x="${x(v)}" y="${H - B + 16}" fill="#8fa3d9" font-size="11" text-anchor="middle">${xFmt(+v.toFixed(4))}</text>`;
    for (let v = y0; v <= y1 + 1e-9; v += yst)
      g += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="#182244" stroke-width="1"/>` +
        `<text x="${L - 8}" y="${y(v) + 4}" fill="#8fa3d9" font-size="11" text-anchor="end">${yFmt(+v.toFixed(4))}</text>`;
    g += `<line x1="${x(xRef)}" x2="${x(xRef)}" y1="${T}" y2="${H - B}" stroke="#8fa3d9" stroke-width="1" stroke-dasharray="4 4"/>` +
      `<line x1="${L}" x2="${W - R}" y1="${y(yRef)}" y2="${y(yRef)}" stroke="#8fa3d9" stroke-width="1" stroke-dasharray="4 4"/>`;
    g += `<text x="${(L + W - R) / 2}" y="${H - 6}" fill="#c9d4ff" font-size="12" text-anchor="middle">${xName}</text>` +
      `<text x="${L - 40}" y="${T - 10}" fill="#c9d4ff" font-size="12">${yName}</text>` +
      `<text x="${W - R - 6}" y="${T + 14}" fill="#c9d4ff" font-size="12" text-anchor="end">${corner}</text>`;
    const S = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
    P.forEach((p, i) => { p.px = x(p.cx); p.py = y(p.cy);
      g += `<circle data-i="${i}" data-k="${p.k}" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4" fill="${S[p.k]}" stroke="#070b1a" stroke-width="1.5"/>`; });
    g += `<circle data-role="hl" r="7" fill="none" stroke="#eef2ff" stroke-width="2" visibility="hidden"/>`;
    g += `<rect data-role="hit" x="0" y="0" width="${W}" height="${H}" fill="transparent"/>`;
    this._charts[key] = { scatter: true, P, W, H };
    return `<svg data-scatter="${key}" viewBox="0 0 ${W} ${H}" role="img">${g}</svg><div class="viz-tip" hidden></div>`;
  },
  // 難度切換＋武器圖例（點一下只看那把武器）＋每個難度一張落點圖和數據表
  scatterPanel(group, panes, series) {
    const S = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300'];
    return `<div class="viz-tabs" data-group="${group}">${panes.map((p, i) => `<button type="button" data-pane="${group}-${p.id}"${i ? '' : ' class="on"'}>${p.label}</button>`).join('')}</div>
      <div class="legend" data-group="${group}">${series.map((s, i) => `<button type="button" data-k="${i}"><i style="background:${S[i]}"></i>${s}</button>`).join('')}<span class="hint">點武器：只看那把</span></div>
      ${panes.map((p, i) => `<div data-pane-body="${group}-${p.id}"${i ? ' hidden' : ''}>${p.cap ? `<div class="cap">${p.cap}</div>` : ''}${p.html}</div>`).join('')}`;
  },
  bindScatter() {
    for (const svg of this.body.querySelectorAll('svg[data-scatter]')) {
      const spec = this._charts[svg.dataset.scatter], tip = svg.nextElementSibling, box = svg.closest('.viz');
      const hl = svg.querySelector('[data-role="hl"]'), hit = svg.querySelector('[data-role="hit"]');
      const show = e => {
        const r = svg.getBoundingClientRect(), vx = (e.clientX - r.left) / r.width * spec.W, vy = (e.clientY - r.top) / r.height * spec.H;
        const off = box.__off || new Set();
        let best = null, bd = 14 * 14;
        for (const p of spec.P) { if (off.has(p.k)) continue; const d = (p.px - vx) ** 2 + (p.py - vy) ** 2; if (d < bd) { bd = d; best = p; } }
        if (!best) return hide();
        hl.setAttribute('cx', best.px); hl.setAttribute('cy', best.py); hl.setAttribute('visibility', 'visible');
        tip.innerHTML = best.tip; tip.hidden = false;
        const br = box.getBoundingClientRect(), px = e.clientX - br.left, py = e.clientY - br.top;
        tip.style.left = Math.min(px + 14, br.width - tip.offsetWidth - 8) + 'px';
        tip.style.top = Math.max(8, py - tip.offsetHeight - 12) + 'px';
      };
      const hide = () => { tip.hidden = true; hl.setAttribute('visibility', 'hidden'); };
      hit.addEventListener('pointermove', show);
      hit.addEventListener('pointerdown', show);
      hit.addEventListener('pointerleave', hide);
    }
    for (const tabs of this.body.querySelectorAll('.viz-tabs')) tabs.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const box = tabs.closest('.viz');
      for (const x of tabs.querySelectorAll('button')) x.classList.toggle('on', x === b);
      for (const d of box.querySelectorAll('[data-pane-body]')) d.hidden = d.dataset.paneBody !== b.dataset.pane;
    });
    for (const lg of this.body.querySelectorAll('.legend[data-group]')) lg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const box = lg.closest('.viz'), k = +b.dataset.k, all = [...lg.querySelectorAll('button')];
      // 點一下：只看這把；再點同一把（已經是唯一一把）：全部顯示
      const only = box.__off && box.__off.size === all.length - 1 && !box.__off.has(k);
      box.__off = only ? new Set() : new Set(all.map(x => +x.dataset.k).filter(i => i !== k));
      all.forEach(x => x.classList.toggle('off', box.__off.has(+x.dataset.k)));
      for (const c of box.querySelectorAll('circle[data-k]')) c.setAttribute('visibility', box.__off.has(+c.dataset.k) ? 'hidden' : 'visible');
    });
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

    // 4. 敵人數量、血量（每星區 7 層；單人／雙人）—— 公式跟 Game.startWave、spawnEnemy 一樣
    const pts = [];
    for (let s = 1; s <= 3; s++) for (let L = 0; L < 7; L++) pts.push({ s, L, level: L + (s - 1) * 7 });
    const hpMul = enemyHpMul;
    const hpSeries = [
      { name: '單人 第 1 波', color: S[0], values: pts.map(pt => hpMul(pt.level, 1)) },
      { name: '單人 第 3 波', color: S[1], values: pts.map(pt => hpMul(pt.level, 3)) },
      { name: '雙人 第 1 波', color: S[2], values: pts.map(pt => hpMul(pt.level, 1) * coopMul(CFG.COOP_HP, pt.level)) },
      { name: '雙人 第 3 波', color: S[3], values: pts.map(pt => hpMul(pt.level, 3) * coopMul(CFG.COOP_HP, pt.level)) }];
    // 一場一般戰的敵人總量（預算：1 ≈ 1 隻蟲群）：每波 (5 ＋ 波次×3 ＋ 難度×3) × 一波倍數；第 1 星區第 4 層起、第 2 星區起 3 波（見 Game.enterNode）；雙人再 × 人數
    const cPts = pts.filter(pt => pt.L < 6);
    const fightBudget = (pt, coop) => { let b = 0; for (let n = 1; n <= 2 + (pt.L >= 3 || pt.s > 1 ? 1 : 0); n++) b += (5 + n * 3 + pt.level * 3) * CFG.WAVE_MUL; return b * (coop ? coopMul(CFG.COOP_COUNT, pt.level) : 1); };
    const themeShare = pt => pt.s >= 3 ? 55 : pt.s === 2 ? 40 : pt.L >= 3 ? 30 : 20;  // 見 Game.pickThemes
    // 畫成「單人 1-1 的幾倍」（滑鼠提示和表格另外列實際數量）
    const cntRaw = [cPts.map(pt => fightBudget(pt, false)), cPts.map(pt => fightBudget(pt, true))], cnt0 = cntRaw[0][0];
    const cntSeries = [
      { name: '單人', color: S[0], values: cntRaw[0].map(v => v / cnt0) },
      { name: '雙人', color: S[2], values: cntRaw[1].map(v => v / cnt0) }];
    const cntTip = i => `<div style="margin-top:4px;color:var(--muted)">敵人總量（預算）</div>` +
      cntSeries.map((s, k) => `<div>${s.name}<span class="v">${Math.round(cntRaw[k][i])}</span></div>`).join('');
    const xsCnt = cPts.map(p => `${p.s}-${p.L + 1}`);
    const hpTip = i => {
      const pt = pts[i], m = hpMul(pt.level, 1);
      const B = ENEMY_TYPES[CFG.BOSS_ORDER[pt.s - 1]];
      const list = pt.L === 6 ? [[B.name, B.hp]]
        : [['蟲群', ENEMY_TYPES.swarmer.hp], ['刺殼', ENEMY_TYPES.brute.hp], ['噴吐者', ENEMY_TYPES.spitter.hp], ['虛空獵手', ENEMY_TYPES.elite.hp]];
      return `<div style="margin-top:4px;color:var(--muted)">第 1 波實際血量</div>` +
        list.map(([n, hp]) => `<div>${n}<span class="v">${Math.round(hp * m)}</span></div>`).join('');
    };

    // 5. 晶片價值落點圖（資料是 mp_tests 自動對戰模擬的結果：js/data/chipvalue.js）
    const V = typeof CHIP_VALUE !== 'undefined' ? CHIP_VALUE : null, WK = Object.keys(WEAPONS), WS = WK.map(w => WEAPONS[w].short);
    const cn = id => CHIPS[id] ? CHIPS[id].name : id, x2 = v => '×' + (+v.toFixed(2)), sg = v => (v > 0 ? '+' : v < 0 ? '−' : '') + (+Math.abs(v).toFixed(2));
    const tipRow = (n, v) => `<div>${n}<span class="v">${v}</span></div>`;
    const tierCap = L => { const T = V.tiers[L]; return `難度 ${L}（${L <= 6 ? '第 1 星區' : L <= 13 ? '第 2 星區' : '第 3 星區'}）：電路 ${T.chips} 個晶片${T.chips > 1 ? `（其他 ${T.chips - 1} 個輪流換）` : ''}` +
      `${T.lv2 ? `、其他晶片 Lv2 ${T.lv2 * 100}%` : ''}${T.lv3 ? `、進化 ${T.lv3 * 100}%` : ''}、武器升 ${T.stage} 段、零件 ${T.parts} 層`; };
    let cvHtml = '<div class="cap">還沒有模擬資料（在 mp_tests 跑 node chipvalue.js --save 和 node chipvalue.js --pairs --save）。</div>';
    let pairHtml = cvHtml;
    if (V && Object.keys(V.single).length) {
      const panes = Object.keys(V.single).map(Number).sort((a, b) => a - b).map(L => {
        const rows = V.single[L], ns = rows.map(r => r[4]);
        const pts = rows.map(([c, w, s, d, n]) => ({ x: s, y: d, k: WK.indexOf(w),
          tip: `<b>${cn(c)}</b>${tipRow('武器', WEAPONS[w].short)}${tipRow('清場速度', x2(s))}${tipRow('掉血', x2(d))}${tipRow('場數', n)}` }));
        const chips = [...new Set(rows.map(r => r[0]))], cell = (c, w) => rows.find(r => r[0] === c && r[1] === w);
        const avg = c => WK.reduce((a, w) => a + (cell(c, w) ? cell(c, w)[2] / Math.sqrt(Math.max(0.2, cell(c, w)[3])) : 0), 0);
        chips.sort((a, b) => avg(b) - avg(a));
        return { id: L, label: `難度 ${L}`, cap: `${tierCap(L)}。每個點 ${Math.min(...ns)}～${Math.max(...ns)} 場。`,
          html: this.scatterChart(`cv${L}`, { pts, xName: '清場速度（裝了之後快幾倍）→', yName: '↑ 掉血（越上面越少）', xFmt: x2, yFmt: x2, xRef: 1, yRef: 1, invertY: true,
            clampX: [0.4, 2.2], clampY: [0.2, 2.5], corner: '清得更快又少掉血 ↗' }) +
            this.table(['晶片', ...WS.map(s => s + '（速度／掉血）')], chips.map(c => [cn(c), ...WK.map(w => { const r = cell(c, w); return r ? `${x2(r[2])}／${x2(r[3])}` : '—'; })])) };
      });
      cvHtml = this.scatterPanel('cv', panes, WS);
    }
    if (V && Object.keys(V.pair).length) {
      const panes = Object.keys(V.pair).map(Number).sort((a, b) => a - b).map(L => {
        const rows = V.pair[L];
        const pts = rows.map(([a, b, w, s, d, n]) => ({ x: s, y: d, k: WK.indexOf(w),
          tip: `<b>${cn(a)} ＋ ${cn(b)}</b>${tipRow('武器', WEAPONS[w].short)}${tipRow('速度加乘', x2(s))}${tipRow('多掉的血', sg(d))}${tipRow('場數', n)}` }));
        const keys = [...new Set(rows.map(r => r[0] + '+' + r[1]))], cell = (k, w) => rows.find(r => r[0] + '+' + r[1] === k && r[2] === w);
        const avg = k => WK.reduce((a, w) => a + (cell(k, w) ? cell(k, w)[3] : 0), 0);
        keys.sort((a, b) => avg(b) - avg(a));
        return { id: L, label: `難度 ${L}`, cap: `${tierCap(L).replace(/：.*/, '')}：只有武器＋這兩個晶片（都是 Lv1）、武器升 ${V.tiers[L].stage} 段、零件 ${V.tiers[L].parts} 層。每個點 ${rows[0][5]} 場，場數少，差 20% 以上才算數。`,
          html: this.scatterChart(`cp${L}`, { pts, xName: '速度加乘（一起裝 ÷ 各自的倍數相乘）→', yName: '↑ 多掉的血（越上面越少）', xFmt: x2, yFmt: sg, xRef: 1, yRef: 0, invertY: true,
            clampX: [0.4, 2.2], clampY: [-1.5, 1.5], corner: '一起裝更快又少掉血 ↗' }) +
            this.table(['組合', ...WS.map(s => s + '（速度加乘）')], keys.map(k => [k.split('+').map(cn).join(' ＋ '), ...WK.map(w => { const r = cell(k, w); return r ? x2(r[3]) : '—'; })])) };
      });
      pairHtml = this.scatterPanel('cp', panes, WS);
    }

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

      <div class="viz"><h4>晶片價值：單晶片（每個點 = 一個晶片配一把武器）</h4>
        <div class="cap">電腦照晶片的玩法打真正的戰鬥（一般戰＋精英戰，飛船不會死），同一組配裝比「那格空著」和「那格裝這個晶片」。
          橫軸是清場快幾倍，縱軸是掉血是幾倍（反過來畫：越上面掉血越少），虛線是「跟空著一樣」；右上角 = 清得更快又少掉血。超出圖的點畫在邊上，滑鼠移上去看實際數字。
          命中觸發器先不測。${V ? `模擬日期 ${V.date}。` : ''}</div>
        ${cvHtml}</div>

      <div class="viz"><h4>晶片價值：兩個晶片的組合（每個點 = 一組組合配一把武器）</h4>
        <div class="cap">只有武器＋兩個晶片，和只有其中一個、兩個都沒有比。速度加乘 ×1 = 兩個一起裝剛好是各自效果相乘，大於 1 = 互相加乘、小於 1 = 互相抵銷；
          多掉的血 = 一起裝多掉的血 − 各自多掉的血（以兩個都沒裝時的掉血為 1），負的 = 比預期少掉血，也是越上面越好。</div>
        ${pairHtml}</div>

      <div class="viz"><h4>敵人數量成長（一場一般戰）</h4>
        <div class="cap">x 軸為「星區-層」（第 7 層是旗艦戰，不畫）。一場的敵人總量用「預算」表示（1 預算 ≈ 1 隻蟲群；噴吐者 3、刺殼 6、主題小兵 3～8）：
          每一波 ＝ (5 ＋ 波次 × 3 ＋ 難度 × 3) × ${CFG.WAVE_MUL}，第 1 星區第 1～3 層 2 波，之後都是 3 波（新星區開頭不會比上一個星區結尾少）；雙人（隊友在線）再 × ${CFG.COOP_COUNT[0]}～${CFG.COOP_COUNT[1]}（隨難度增加：兩個人的配裝一起疊，後期成長比單人快）。
          主題小兵佔一波的比例隨星區增加（表格最後一欄）。
          圖上是「單人 1-1 的幾倍」（單人 1-1 ＝ ${Math.round(cnt0)} ＝ ×1）；滑鼠移上去可看實際數量。</div>
        ${this.lineChart('cnt', { xs: xsCnt, series: cntSeries, yFmt: v => '×' + (+v.toFixed(1)), tipTitle: x => `星區 ${x.split('-')[0]}・第 ${x.split('-')[1]} 層`, tipExtra: cntTip })}
        ${this.table(['星區-層', '難度等級', '單人', '雙人', '主題小兵比例'], cPts.map((p, i) => [xsCnt[i], p.level, ...cntSeries.map((s, k) => `${Math.round(cntRaw[k][i])}（×${(+s.values[i].toFixed(1))}）`), themeShare(p) + '%']))}</div>

      <div class="viz"><h4>敵人血量成長</h4>
        <div class="cap">x 軸為「星區-層」。難度等級 ＝ 層數 ＋（星區 − 1）× 7；血量倍率 ＝ 1 ＋ 0.1 × 難度 ＋ 0.01 × 難度² ＋（波次 − 1）× 0.08；雙人（隊友在線）再 × ${CFG.COOP_HP[0]}～${CFG.COOP_HP[1]}（隨難度增加）。滑鼠移上去可看各敵人的實際血量（單人第 1 波）；第 7 層是旗艦戰。</div>
        ${this.lineChart('hp', { xs: xsHp, series: hpSeries, yFmt: v => '×' + f2(v), tipTitle: x => `星區 ${x.split('-')[0]}・第 ${x.split('-')[1]} 層`, tipExtra: hpTip })}
        ${this.table(['星區-層', '難度等級', ...hpSeries.map(q => q.name)], pts.map((p, i) => [xsHp[i], p.level, ...hpSeries.map(q => '×' + f2(q.values[i]))]))}</div>`;
  },

  rules() {
    const R = (t, d) => `<div><b>${t}</b><br>${d}</div>`;
    const bosses = CFG.BOSS_ORDER.map((id, i) => `第 ${i + 1} 關 <b style="color:${ENEMY_TYPES[id].color}">${ENEMY_TYPES[id].name}</b>：${ENEMY_TYPES[id].desc}`).join('<br>');
    return `<div class="rules codex-sec">
      ${R('遠征流程', `遠征共 ${CFG.CAMPAIGN_SECTORS} 關（星區），每關 7 層，最後一層是守關旗艦，每關的旗艦都不同：<br>${bosses}<br>
        打完第 ${CFG.CAMPAIGN_SECTORS} 關算遠征完成，可以選擇結束（存下通關紀錄），或帶著目前的電路繼續<b>無盡模式</b>：星區一直往下，敵人持續變強，旗艦從三隻裡隨機出現。<br>
        每張航圖只有 1 個軍械台；精英戰之後至少有一條路通往維修站；維修站、補給站都不會連著出現。`)}
      ${R('執行順序', '電路由左至右執行。第 1 格固定是你的武器，負責產生子彈；右邊的晶片依序加工「目前已經存在」的子彈，所以順序很重要。例如迴旋放在分裂左邊，只有分裂前的子彈會迴旋；分裂和巨彈誰先誰後，結果也不同。')}
      ${R('晶片種類', `<b>改變玩法的晶片</b>（照著它的玩法打就會成長）：
        <span style="color:${TYPE_META.path.color}">${TYPE_META.path.icon} 彈道</span>（子彈怎麼飛）、
        <span style="color:${TYPE_META.launch.color}">${TYPE_META.launch.icon} 發射</span>（從哪裡、朝哪裡射）、
        <span style="color:${TYPE_META.impact.color}">${TYPE_META.impact.icon} 命中</span>（打中之後）、
        <span style="color:${TYPE_META.body.color}">${TYPE_META.body.icon} 機體</span>（跟衝刺、擦彈連動）。<br>
        <span style="color:${TYPE_META.mod.color}">◇ 變形器</span>、<span style="color:${TYPE_META.amp.color}">▲ 增幅器</span>：數值晶片（分裂、巨彈、穿甲、倍增、超頻模組），只能靠合成升級。<br>
        <span style="color:${TYPE_META.trigger.color}">◎ 觸發器</span>：命中時用武器再射一次（50%），並套用它右邊的晶片。右邊的晶片不會在開火時執行，最多巢狀 ${CFG.MAX_TRIGGER_DEPTH} 層。<br>
        <span style="color:${TYPE_META.link.color}">⇄ 鏡像迴路</span>：複製左邊那一格的效果。`)}
      ${R('用量成長與進化', '改變玩法的晶片裝在電路上，照著它的玩法打（例如迴旋的回程命中、環繞命中、反彈次數）就會累積成長，到了自動升到 Lv2、Lv3；Lv3 是<b>進化</b>，改名、玩法再變一次。撿到重複的晶片可以直接升一級（捷徑）。電路編輯器點晶片可以看目前的成長進度和本局每分鐘成長多少。打爆小行星時，電路上每個會成長的晶片 +8。雙人：各算各的。')}
      ${R('能量負載與射速', `每個晶片右上角的 ⚡ 是能量負載。電路上所有晶片的 ⚡ 加起來，<b>每 1 點讓射速 -${CFG.HEAT_RATE * 100}%</b>，每把武器都一樣。<br>
        例：⚡5 → 射速 -${5 * CFG.HEAT_RATE * 100}%；⚡10 → 射速 -${10 * CFG.HEAT_RATE * 100}%。最多降到原本的 ${CFG.HEAT_RATE_FLOOR * 100}%（⚡${Math.round((1 - CFG.HEAT_RATE_FLOOR) / CFG.HEAT_RATE)} 以上不會再更慢）。<br>
        放在倉庫的晶片不算能量。超頻模組讓射速 ×2，但連續射擊太久會過熱停火 1.5 秒；散熱片零件每層射速 +6%。`)}
      ${R('擊退', `每把武器的擊退值不同：${Object.values(WEAPONS).map(W => `${W.name} ${W.base.knock}`).join('、')}（鋼珠、攻城砲 ×2）。巨彈每級擊退 +0.5。<br>
        一般敵人都會被推。旗艦有抗擊退，子彈的擊退值<b>超過</b>抗性才推得動，力道只看超過的部分：${CFG.BOSS_ORDER.map(id => `${ENEMY_TYPES[id].name} ${ENEMY_TYPES[id].knockResist}`).join('、')}。爆炸、震波、電弧不會推王。被擊退撞上行星的敵人多受 20 傷害。`)}
      ${R('增幅相加', '倍增器、巨彈的 +30%、超載・威力，這些傷害加成全部<b>相加</b>後才乘上去：兩個倍增器是 +100% +100% = ×3，不是 ×4。分裂（每顆 ×0.4）、迴旋（×0.7）、蓄力、子彈上限換算、武器升級則照舊相乘。')}
      ${R('子彈上限', `<b>每次開火</b>（包含每次命中觸發的回響）最多 ${CFG.MAX_SHOTS_PER_FIRE} 發：超過的數量平均換算成每發的傷害，總傷害不變（例：分裂到 64 發 → 只射 32 發，每發傷害 ×2）。<br>
        另外有兩個防止卡頓的上限，超過的部分<b>會直接消失</b>：畫面上的玩家子彈最多 ${CFG.MAX_LIVE_BULLETS} 發；同一幀最多處理 ${CFG.MAX_TRIGGERS_PER_FRAME} 次命中觸發。平常打不到，只有極端的觸發＋分裂電路才會碰到。`)}
      ${R('強度（等級）', '數值晶片的「強度」是效果的倍率：再拿到已擁有的同種晶片會自動合成升級，Lv2 強度 ×1.5、Lv3 強度 ×2（例如分裂 3 → 4 → 5 顆），倉庫被動也一起放大。改變玩法的晶片每一級的效果寫在卡片上。')}
      ${R('倉庫', `倉庫 ${CFG.INV_SLOTS} 格。部分晶片放在倉庫時提供被動效果；同一個晶片要裝上電路，還是留在倉庫拿被動，需要取捨。不要的晶片可以回收，拿回 40% 售價。`)}
      ${R('插槽', `開局 ${CFG.START_SLOTS} 格，最多 ${CFG.MAX_SLOTS} 格。來源：擊敗 Boss、補給站購買（◆${CFG.SHOP_SLOT} 起，隨星區上漲）、精英戰獎勵、武器升滿後的軍械台。`)}
      ${R('黑洞融合', '投入 2 個晶片：50% 融合成奇異點（兩個效果合進一格，再加一個超載詞綴），50% 變成廢鐵（卡住插槽，只能在維修站拆除）。奇異點不會照用量成長。')}
      ${R('機體與地圖', '零件（改裝廠）、背包模組（精英、旗艦）、4 艘飛船與地圖物件，見「機體與地圖」分頁。')}
    </div>`;
  },

  chips() {
    const groups = ['path', 'launch', 'impact', 'body', 'mod', 'amp', 'trigger', 'link'];
    return groups.map(t => {
      const ids = NORMAL_IDS.filter(id => CHIPS[id].type === t);
      if (!ids.length) return '';
      const m = TYPE_META[t];
      const cards = ids.map(id => {
        const g = CHIPS[id].grow;
        return chipCard(id, `${g ? `<div class="ty" style="color:#9dff6b">成長：${g.what} ${g.need[0]} → Lv2、${g.need[1]} → 進化「${CHIPS[id].evo}」</div>` : ''}${id === 'mirror' ? '<div class="ty">不能升級</div>' : ''}<div class="ty">售價 ◆${chipPrice(id)}</div>`);
      }).join('');
      return `<div class="codex-sec"><h3 style="color:${m.color}">${m.icon} ${m.label}（${ids.length}）</h3><div class="cards" style="justify-content:flex-start;margin:0">${cards}</div></div>`;
    }).join('');
  },

  // 機體與地圖：飛船、零件、背包模組、地圖物件
  bodyTab() {
    const ships = Object.values(SHIPS).map(S => `<div class="card" style="border-color:${S.color}"><div class="ttl" style="color:${S.color}">${S.name}</div>
      <div class="ty">船體 ${S.hp}　·　衝刺冷卻 ${S.dashCd} 秒　·　零件格 ${S.partSlots}</div><div class="ds">${S.desc}<br><b style="color:${S.color}">${S.abilityName}</b>：${S.abilityDesc}</div></div>`).join('');
    const parts = PART_IDS.map(id => partCard(id, '', this.hasRun() ? Game.parts : {})).join('');
    const mods = Object.keys(MODULES).map(id => moduleCard(id)).join('');
    const R = (t, d) => `<div><b>${t}</b><br>${d}</div>`;
    return `<div class="codex-sec"><h3>🚀 飛船（開局配置）</h3><div class="cards" style="justify-content:flex-start;margin:0">${ships}</div></div>
      <div class="codex-sec"><h3>⚙ 零件</h3><div class="sub">零件格開局 6 格（先鋒號 7 格），擊沉旗艦 +1。每層小好處＋小代價，同種疊到 2 層、4 層開啟特性；
        <b>${BALANCE.name}</b>：${BALANCE.desc}。零件在「🔧 改裝廠」三選一取得，也可以付 ◆${PART_SWAP_PRICE}（隨星區上漲）把 1 層換成另一種。</div>
        <div class="cards" style="justify-content:flex-start;margin:0">${parts}</div></div>
      <div class="codex-sec"><h3>🎒 背包模組（只有 1 格）</h3><div class="sub">精英戰鬥勝利後三選一；擊沉旗艦時可以裝上那隻旗艦的專屬模組。換上新的，舊的就沒了。</div>
        <div class="cards" style="justify-content:flex-start;margin:0">${mods}</div></div>
      <div class="codex-sec"><h3>🪐 地圖物件</h3><div class="rules">
        ${R('擺放', '一般戰鬥隨機 0～3 個；精英戰固定有行星和彗星；旗艦戰兩側各一顆行星當掩體。沙盒、靶場沒有。')}
        ${R('行星', '實心大球，擋住雙方的子彈。周圍的虛線圈是引力範圍：經過的子彈會被彎過去（彈弓），越慢的子彈彎越多（電漿砲最明顯、軌道砲幾乎不彎）。牆反彈的子彈會從行星表面反彈。')}
        ${R('黑洞', '把附近所有東西（敵人、雙方子彈、飛船）往中心拉；核心吞掉子彈，敵人和飛船碰到核心會受傷。旗艦不會被拉。')}
        ${R('彗星', '定時從場外沿直線橫越，進場前 1.5 秒有藍白色預警線（敵人的預警線是紅色）。撞到的敵人受 40、飛船受 20 傷害；打爆後碎片沿原本的方向炸出 10 發（只傷敵人）。行星讓它彎軌道，黑洞吞掉它時會爆炸。')}
        ${R('小行星帶', `一整排小行星，擋住雙方的子彈；<b>被小行星擋住的敵人看不到</b>，只在小行星邊緣顯示「？」（感測器 4 層看得到）。只有單發傷害 ≥ ${OBJ.ROCK_MIN_DMG} 的子彈或爆炸打得動（電漿砲、軌道砲、獨頭彈、巨彈、蓄力），打爆時電路上每個會成長的晶片 +${OBJ.ROCK_GROW}。`)}
      </div></div>`;
  },

  special() {
    const sg = Object.keys(CHIPS).filter(id => CHIPS[id].type === 'singularity');
    const ov = OVERLOADS.map(id => `<div><b style="color:#e0aaff">${CHIPS[id].name}</b>：${CHIPS[id].desc}</div>`).join('');
    return `<div class="codex-sec"><h3 style="color:#e0aaff">✺ 奇異點超載詞綴（融合成功時隨機附加 1 個）</h3>
        <div class="rules">${ov ? `<div>${ov}</div>` : ''}</div></div>
      <div class="codex-sec"><h3 style="color:#e0aaff">✺ 這一場融合出的奇異點</h3>
        ${sg.length ? `<div class="cards" style="justify-content:flex-start;margin:0">${sg.map(id => chipCard(id)).join('')}</div>`
          : '<div class="sub">還沒有。在航圖上的「◐ 黑洞」節點融合晶片即可取得。</div>'}</div>
      <div class="codex-sec"><h3 style="color:${TYPE_META.scrap.color}">✖ 廢鐵</h3>
        <div class="cards" style="justify-content:flex-start;margin:0">${chipCard('scrap', `<div class="ty">維修站拆除費用 ◆${CFG.SCRAP_REMOVE}（隨星區上漲）</div>`)}</div></div>`;
  },

  weapons() {
    // 基礎型數值表：射程 = 子彈速度 × 存活時間（加速、疾射、佈雷都照射程比例算）
    const rows = Object.entries(WEAPONS).map(([id, W]) => {
      const p = weaponParams({ id, path: null, final: null });
      return `<tr><td style="color:${W.color}">${W.short}</td><td>${p.damage}</td><td>${p.count}</td><td>${p.damage * p.count}</td>
        <td>${(1 / (p.interval * p.rate)).toFixed(2)}</td><td>${p.speed}${p.speedVar ? '（±8%）' : ''}</td><td>${p.life} 秒</td>
        <td>${Math.round(p.speed * p.life)}</td><td>${p.pierce >= 99 ? '無限' : p.pierce}</td></tr>`;
    }).join('');
    const table = `<div class="codex-sec viz"><h3>基礎數值</h3>
      <div class="sub" style="margin:0">沒升級、沒晶片、能量 0。射程 = 子彈速度 × 存活時間；加速、疾射、佈雷的效果都照「飛了射程的幾成」算。</div>
      <div class="tbl"><table><tr><th>武器</th><th>單發傷害</th><th>發數</th><th>每次開火</th><th>每秒開火</th><th>子彈速度</th><th>存活時間</th><th>射程</th><th>穿透</th></tr>${rows}</table></div></div>`;
    return table + Object.entries(WEAPONS).map(([id, W]) => {
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
      <div class="codex-sec"><h3>機體（零件 ${partsUsed(Game.parts)} / ${Game.partSlots}）</h3>
        <div class="sub">${PART_IDS.filter(id => Game.parts[id]).map(id => `${PARTS[id].name} ${Game.parts[id]} 層`).join('、') || '沒有零件'}
          ${Game.module ? `<br>背包模組：<b>${MODULES[Game.module].name}</b>` : ''}</div></div>
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
