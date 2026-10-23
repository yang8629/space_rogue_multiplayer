// 星環電路 多人版 · codex.js：📖 電路總覽：規則、晶片、武器、圖表
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CODEX — 電路總覽（規則 / 晶片 / 插件 / 武器 / 目前配置）
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
  // weapon：武器頁捲到這把武器（基地武器架按 Q）
  open(tab, weapon = null) {
    this.tab = tab === 'current' && !this.hasRun() ? 'rules' : tab;
    this.render();
    this.el.classList.remove('hidden');
    this.body.scrollTop = 0;  // 先回到最上面再量：上次捲到的位置會留著（第二次按 Q 以前捲錯武器）
    const sec = weapon && this.body.querySelector(`[data-wpn="${weapon}"]`);
    if (sec) this.body.insertAdjacentHTML('beforeend', '<div style="height:70vh"></div>');  // 底下留白：最後一把（蜂群）也捲得到最上面（切分頁重畫就沒了）
    if (sec) this.body.scrollTop = sec.getBoundingClientRect().top - this.body.getBoundingClientRect().top - 12;
  },
  close() { this.el.classList.add('hidden'); },

  render() {
    const tabs = [['rules', '規則'], ['chips', '晶片'], ['comps', '插件'], ['body', '機體與地圖'], ['weapons', '武器']];
    if (this.hasRun()) tabs.push(['current', '目前配置']);
    tabs.push(['charts', '數值圖表'], ['mech', '機制檢查']);
    this._charts = {};
    const content = { rules: this.rules, chips: this.chips, comps: this.comps, body: this.bodyTab, weapons: this.weapons, current: this.current,
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
  //   xRef／yRef 畫虛線（沒有效果的位置）；超出 clampX／clampY 的點畫在邊上，畫成空心（提示照實際數字並註明超出）
  scatterChart(key, { pts, xName, yName, xFmt, yFmt, xRef, yRef, invertY = false, clampX, clampY, corner, height = 360 }) {
    const W = 640, H = height, L = 50, R = 14, T = 26, B = 40;
    const cl = (v, c) => c ? Math.max(c[0], Math.min(c[1], v)) : v;
    const P = pts.map(p => { const cx = cl(p.x, clampX), cy = cl(p.y, clampY), out = cx !== p.x || cy !== p.y;
      return { ...p, cx, cy, out, tip: out ? p.tip + '<div style="color:#ffd166">超出圖的範圍，畫在邊上（空心）</div>' : p.tip }; });
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
      g += p.out ? `<circle data-i="${i}" data-k="${p.k}" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4.5" fill="#070b1a" stroke="${S[p.k]}" stroke-width="2"/>`
        : `<circle data-i="${i}" data-k="${p.k}" cx="${p.px.toFixed(1)}" cy="${p.py.toFixed(1)}" r="4" fill="${S[p.k]}" stroke="#070b1a" stroke-width="1.5"/>`; });
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

    // 武器升級的估算 DPS 不放（10-13 從這裡拿掉；10-24 「武器」分頁的也拿掉：算不到召回、上限這類效果）

    // 4. 敵人數量、血量（每星區 7 層；單人／雙人）—— 公式跟 Game.startWave、spawnEnemy 一樣
    const pts = [];
    for (let s = 1; s <= 3; s++) for (let L = 0; L < 7; L++) pts.push({ s, L, level: L + (s - 1) * 7 });
    const hpMul = enemyHpMul;
    const hpSeries = [
      { name: '單人 第 1 波', color: S[0], values: pts.map(pt => hpMul(pt.level, 1)) },
      { name: '單人 第 3 波', color: S[1], values: pts.map(pt => hpMul(pt.level, 3)) },
      { name: '多人 第 1 波', color: S[2], values: pts.map(pt => hpMul(pt.level, 1) * coopMul(CFG.COOP_HP, pt.level)) },
      { name: '多人 第 3 波', color: S[3], values: pts.map(pt => hpMul(pt.level, 3) * coopMul(CFG.COOP_HP, pt.level)) }];
    // 一場一般戰的敵人總量（預算：1 ≈ 1 隻蟲群）：每波 (5 ＋ 波次×3 ＋ 難度×3) × 一波倍數；第 1 星區第 4 層起、第 2 星區起 3 波（見 Game.enterNode）；雙人再 × 人數
    const cPts = pts.filter(pt => pt.L < 6);
    const fightBudget = (pt, coop) => { let b = 0; for (let n = 1; n <= 2 + (pt.L >= 3 || pt.s > 1 ? 1 : 0); n++) b += (5 + n * 3 + pt.level * 3) * CFG.WAVE_MUL; return b * (coop ? coopCount(pt.level, coop) : 1); };
    const themeShare = pt => pt.s >= 3 ? 55 : pt.s === 2 ? 40 : pt.L >= 3 ? 30 : 20;  // 見 Game.pickThemes
    // 畫成「單人 1-1 的幾倍」（滑鼠提示和表格另外列實際數量）
    const cntRaw = [cPts.map(pt => fightBudget(pt, 0)), cPts.map(pt => fightBudget(pt, 2)), cPts.map(pt => fightBudget(pt, 4))], cnt0 = cntRaw[0][0];
    const cntSeries = [
      { name: '單人', color: S[0], values: cntRaw[0].map(v => v / cnt0) },
      { name: '雙人', color: S[2], values: cntRaw[1].map(v => v / cnt0) },
      { name: '四人', color: S[3], values: cntRaw[2].map(v => v / cnt0) }];
    const cntTip = i => `<div style="margin-top:4px;color:var(--muted)">敵人總量（預算）</div>` +
      cntSeries.map((s, k) => `<div>${s.name}<span class="v">${Math.round(cntRaw[k][i])}</span></div>`).join('');
    const xsCnt = cPts.map(p => `${p.s}-${p.L + 1}`);
    const hpTip = i => {
      const pt = pts[i], m = hpMul(pt.level, 1);
      const B = ENEMY_TYPES[CHAPTERS[0].bosses[pt.s] || CFG.BOSS_ORDER[0]];  // 第一章各星區的王
      const list = pt.L === 6 ? [[B.name, B.hp]]
        : [['蟲群', ENEMY_TYPES.swarmer.hp], ['刺殼', ENEMY_TYPES.brute.hp], ['噴吐者', ENEMY_TYPES.spitter.hp], ['虛空獵手', ENEMY_TYPES.elite.hp]];
      return `<div style="margin-top:4px;color:var(--muted)">第 1 波實際血量</div>` +
        list.map(([n, hp]) => `<div>${n}<span class="v">${Math.round(hp * m)}</span></div>`).join('');
    };

    // 5. 整局模擬在用的兩張表（資料是 tests 的模擬結果：js/data/simvalue.js，exportvalue.js 產生）
    const SV = typeof SIM_VALUE !== 'undefined' ? SIM_VALUE : null, WK = Object.keys(WEAPONS);
    const x2 = v => '×' + (+v.toFixed(2));
    const svTabs = (group, body) => `<div class="viz-tabs" data-group="${group}">${WK.map((w, i) => `<button type="button" data-pane="${group}-${w}"${i ? '' : ' class="on"'} style="color:${WEAPONS[w].color}">${WEAPONS[w].name}</button>`).join('')}</div>
      ${WK.map((w, i) => `<div data-pane-body="${group}-${w}"${i ? ' hidden' : ''}>${body(w)}</div>`).join('')}`;
    // 分數的格子：顏色照好壞（綠 = 比較好、紅 = 比沒有更差），滑鼠移上去看速度、掉血
    const svCell = (v, lo, hi, tip) => { const c = v == null ? '' : v > hi ? 'rgba(255,140,60,.28)' : v >= lo + 0.25 ? 'rgba(46,230,166,.22)' : v >= lo ? 'rgba(46,230,166,.09)' : v < 1 ? 'rgba(255,77,109,.22)' : 'rgba(255,209,102,.16)';
      return `<td style="background:${c};text-align:right" title="${tip || ''}">${v == null ? '—' : v.toFixed(2)}</td>`; };
    const pathName = (w, k) => k === 'none' ? '沒升級' : k.length === 1 ? WEAPONS[w].paths[k].name : WEAPONS[w].paths[k[0]].next[+k[1]].name;
    const itemName = id => { const m = /^part:(\w+):(\d)$/.exec(id);
      return m ? `${PARTS[m[1]] ? PARTS[m[1]].name : m[1]} +${m[2]} 層` : CHIPS[id] ? CHIPS[id].name : id; };
    let upHtml = '<div class="cap">還沒有模擬資料（在 tests 跑 node botsim.js --upval，再 node exportvalue.js）。</div>', rvHtml = upHtml;
    if (SV && Object.keys(SV.upval).length) upHtml = svTabs('sv-up', w => {
      const U = SV.upval[w]; if (!U) return '<div class="cap">這把武器還沒有資料。</div>';
      const Ls = Object.keys(U).map(Number).sort((a, b) => a - b), P = WEAPONS[w].paths;
      const rows = Object.keys(P).flatMap(p => [[p, true], [p + '0', false], [p + '1', false]]);
      return `<div class="cap">武器升級價值表 ${SV.when[w][0] || ''} 量的。</div><div class="tbl"><table><tr><th>路線</th>${Ls.map(L => `<th>難度 ${L}</th>`).join('')}</tr>
        ${rows.map(([k, first]) => `<tr><td>${first ? '' : '　→ '}${pathName(w, k)}${first ? '<span style="color:#6a79ad">（第一段）</span>' : ''}</td>${Ls.map(L => { const x = U[L] && U[L][k];
          return svCell(x ? x[0] : null, first ? 1.15 : 1.2, first ? 9 : 2.0, x ? `清場速度 ${x2(x[1])}、掉血 ${x2(x[2])}` : ''); }).join('')}</tr>`).join('')}</table></div>`;
    });
    if (SV && Object.keys(SV.route).length) rvHtml = svTabs('sv-rv', w => {
      const R = SV.route[w]; if (!R) return '<div class="cap">這把武器還沒有資料。</div>';
      const P = WEAPONS[w].paths, cols = ['none', ...Object.keys(P), ...Object.keys(P).flatMap(p => [p + '0', p + '1'])].filter(k => R[k]);
      // 列的順序固定（不照分數排）：晶片照晶片清單的順序（玩法晶片、組件、觸發器），再來零件（每種 +1／+2／+4 層）；遊戲裡已經沒有的東西不列
      const have = new Set(cols.flatMap(k => Object.keys(R[k].items)));
      const order = [...Object.keys(CHIPS).filter(id => !id.includes('#') && !id.includes('~')), ...Object.keys(PARTS).flatMap(p => [1, 2, 4].map(n => 'part:' + p + ':' + n))];
      const items = order.filter(id => have.has(id));
      return `<div class="cap">路線價值表 ${SV.when[w][1] || ''} 量的。每一欄是一條路線（括號是量的難度），每一列是一樣東西（順序固定：晶片、零件）。只有「沒升級」那一欄有數值晶片、組件、觸發器（其他路線沒量）。</div>
        <div class="tbl"><table><tr><th>東西</th>${cols.map(k => `<th>${pathName(w, k)}<br><span style="color:#6a79ad;font-weight:normal">（${R[k].L}）</span></th>`).join('')}</tr>
        ${items.map(id => `<tr><td>${itemName(id)}</td>${cols.map(k => { const x = R[k].items[id]; return svCell(x ? x[0] : null, 1, 9, x ? `${pathName(w, k)}：清場速度 ${x2(x[1])}、掉血 ${x2(x[2])}（${x[3]} 組）` : ''); }).join('')}</tr>`).join('')}</table></div>`;
    });

    Game.wp = savedWp; Game.inventory = savedInv;
    const xsHp = pts.map(p => `${p.s}-${p.L + 1}`);
    return `
      <div class="viz"><h4>武器升級價值（自動對戰模擬）</h4>
        <div class="cap">電腦（熟練玩家）用依難度隨機的配裝打一般戰＋精英戰（飛船不會死），同一組配裝比「沒升級」和「升了這條路線」。
          分數 ＝ 清場快幾倍 ÷ √掉血是幾倍（越大越好）；滑鼠移到數字上看速度和掉血。第一段的標準是 1.15 以上，終極是 1.2～2.0（綠 = 合格、黃 = 偏弱、紅 = 比沒升級還差、橘 = 超過 2）。
          ${SV ? `資料匯出 ${SV.date}。` : ''}</div>
        ${upHtml}</div>

      <div class="viz"><h4>路線價值：晶片、零件（自動對戰模擬）</h4>
        <div class="cap">整局模擬的電腦挑晶片、零件時查的表：每條武器升級路線各自量，同一組配裝比「加這樣東西」和「不加」。
          分數 ＝ 清場快幾倍 ÷ √掉血是幾倍（1 ＝ 跟不加一樣；綠 = 比較好、紅 = 加了反而更差）；滑鼠移到數字上看速度和掉血。</div>
        ${rvHtml}</div>

      <div class="viz"><h4>敵人數量成長（一場一般戰）</h4>
        <div class="cap">x 軸為「星區-層」（第 7 層是旗艦戰，不畫）。一場的敵人總量用「預算」表示（1 預算 ≈ 1 隻蟲群；噴吐者 3、刺殼 6、主題小兵 3～8）：
          每一波 ＝ (5 ＋ 波次 × 3 ＋ 難度 × 3) × ${CFG.WAVE_MUL}，第 1 星區第 1～3 層 2 波，之後都是 3 波（新星區開頭不會比上一個星區結尾少）；多人（隊友在線）再 × ${CFG.COOP_COUNT[0]}～${CFG.COOP_COUNT[1]}（三、四人每多一人再 +${CFG.COOP_EXTRA}）（隨難度增加：大家的配裝一起疊，後期成長比單人快）。
          主題小兵佔一波的比例隨星區增加（表格最後一欄）。
          圖上是「單人 1-1 的幾倍」（單人 1-1 ＝ ${Math.round(cnt0)} ＝ ×1）；滑鼠移上去可看實際數量。</div>
        ${this.lineChart('cnt', { xs: xsCnt, series: cntSeries, yFmt: v => '×' + (+v.toFixed(1)), tipTitle: x => `星區 ${x.split('-')[0]}・第 ${x.split('-')[1]} 層`, tipExtra: cntTip })}
        ${this.table(['星區-層', '難度等級', '單人', '雙人', '四人', '主題小兵比例'], cPts.map((p, i) => [xsCnt[i], p.level, ...cntSeries.map((s, k) => `${Math.round(cntRaw[k][i])}（×${(+s.values[i].toFixed(1))}）`), themeShare(p) + '%']))}</div>

      <div class="viz"><h4>敵人血量成長</h4>
        <div class="cap">x 軸為「星區-層」。難度等級 ＝ 層數 ＋（星區 − 1）× 7；血量倍率 ＝ 1 ＋ 0.1 × 難度 ＋ 0.01 × 難度² ＋（波次 − 1）× 0.08；多人（隊友在線）再 × ${CFG.COOP_HP[0]}～${CFG.COOP_HP[1]}（隨難度增加）。滑鼠移上去可看各敵人的實際血量（單人第 1 波）；第 7 層是旗艦戰。</div>
        ${this.lineChart('hp', { xs: xsHp, series: hpSeries, yFmt: v => '×' + f2(v), tipTitle: x => `星區 ${x.split('-')[0]}・第 ${x.split('-')[1]} 層`, tipExtra: hpTip })}
        ${this.table(['星區-層', '難度等級', ...hpSeries.map(q => q.name)], pts.map((p, i) => [xsHp[i], p.level, ...hpSeries.map(q => '×' + f2(q.values[i]))]))}</div>`;
  },

  rules() {
    const R = (t, d) => `<div><b>${t}</b><br>${d}</div>`;
    const bosses = CFG.BOSS_ORDER.map(id => `<b style="color:${ENEMY_TYPES[id].color}">${ENEMY_TYPES[id].name}</b>：${ENEMY_TYPES[id].desc}`).join('<br>');
    return `<div class="rules codex-sec">
      ${R('遠征流程', `遠征分成章節，每章打一段星區（每個星區 7 層，最後一層是守關旗艦）。通關一章開下一章；後面的章節會換王、敵人更強，有的從比較後面的星區開始（開局先補晶體、插座和幾次三選一）：<br>
        ${CHAPTERS.map(c => `<b>${c.name}</b>：星區 ${c.sectors[0]}～${c.sectors[1]}，${Object.entries(c.bosses).map(([s, id]) => `星區 ${s} ${ENEMY_TYPES[id].name}`).join('、')}${c.hp !== 1 ? `，敵人血量 ×${c.hp}、受到的傷害 ×${c.dmg}` : ''}`).join('<br>')}<br>
        旗艦：<br>${bosses}<br>
        打完一章可以選擇結束（存下通關紀錄），或帶著目前的電路繼續<b>無盡模式</b>：星區一直往下，敵人持續變強，旗艦從 ${CFG.BOSS_ORDER.length} 艘裡隨機出現。<br>
        每張航圖只有 1 個軍械台；精英戰之後至少有一條路通往維修站；維修站、補給站都不會連著出現。`)}
      ${R('精英', `精英戰、精英亂入從這幾種隨機抽（星區不夠的還不會出現；有的章節會偏向某幾種）：<br>
        ${Object.keys(CFG.ELITE_POOL).map(k => { const T = ENEMY_TYPES[k], from = CFG.ELITE_POOL[k].from, ch = CHAPTERS.filter(c => c.eliteW && c.eliteW[k] > 1).map(c => c.name.split('　')[0]);
          return `<b style="color:${T.color}">${T.group || T.name}</b>${from > 1 ? `（第 ${from} 星區起）` : ''}${ch.length ? `（${ch.join('、')}比較常出現）` : ''}：${T.desc}`; }).join('<br>')}`)}
      ${R('精英詞綴', `精英戰的最後一區是精英的場子（精英最先出場，護衛只有一般一波的 ${Math.round(CFG.ELITE_ESCORT * 100)}%）。精英隨機帶詞綴：第 1 星區 1 個、第 2 星區 2 個、第 3 星區以後 3 個，名字照詞綴改（例如「分裂・狂暴的虛空獵手」）；閃現＋隱形、召喚＋統帥不會一起出現。<br>
        ${AFFIX_IDS.map(id => `<b>${AFFIX[id].name}</b>：${AFFIX[id].desc}`).join('<br>')}`)}
      ${R('線', `電路是一條<b>線</b>。第 1 格是<span style="color:${TYPE_META.source.color}">◉ 飛船晶片</span>（線頭，固定不能拔）：插在它上面的插件作用在飛船的所有攻擊（左鍵、右鍵、武器升級、衝刺撞擊、砲台），也往下傳給整條線。<br>
        線頭在武器打中敵人時觸發（每把武器命中的次數不同，所以照<b>觸發係數</b>累積：${Object.values(WEAPONS).map(W => `${W.short} ${+W.trig.toFixed(2)}`).join('、')}，滿 1 觸發一次），在命中點；武器的<b>招牌動作</b>直接觸發一次：光束排熱、飛輪召回（每個飛輪回程第一下）、重力井塌縮（每個井）、鉤爪甩擊（第一次撞到）、能量刃重斬（第一下）、蜂群收攏（有擋到敵彈）。<br>
        電路開局 ${CFG.START_SLOTS} 格、最多 ${CFG.MAX_SLOTS} 格。`)}
      ${R('晶片', `<span style="color:${TYPE_META.chip.color}">➰ 晶片</span>被觸發時放出自己的東西（產物）；產物打中（或打死）敵人時，再觸發同一條線的下一片晶片。<b>晶片不改武器的攻擊</b>，武器永遠照自己的打。<br>
        每片晶片有固定的「往下傳」條件和次數：${NORMAL_IDS.filter(id => CHIPS[id].type === 'chip').map(id => `${CHIPS[id].name} ${CHIPS[id].pass === 'kill' ? '擊殺' : CHIPS[id].pass === 'end' ? '結束' : '命中'}${id === 'echo' ? '（照武器的觸發係數）' : ` ×${CHIPS[id].coef}`}`).join('、')}。<br>
        產物的傷害照武器每 ${REF_T} 秒的輸出算（武器變強，晶片跟著變強），每往下一層 ×${LINE_DECAY}。`)}
      ${R('插件與等級', `<span style="color:${TYPE_META.comp.color}">◆ 插件</span>插在武器或晶片的插座上（不佔電路格），<b>會傳給同一條線上它後面的所有晶片，同種加總</b>（插越前面影響越多片）：物理傷害 +${Math.round(PLUG.dmg * 100)}%、大小 +${Math.round(PLUG.size * 100)}%；元素讓產物打到的東西帶上元素。<br>
        傷害分兩種：<b>物理</b>是產物本身打中的那一下，吃傷害插件和晶片等級；<b>屬性</b>是元素造成的（爆炸、燃燒、電弧…），強度只看疊了幾個同種元素（例：3 個電擊 = 電 3 隻、每道更痛）。<br>
        數量只靠晶片的觸發：每個人場上最多 ${CFG.PROD_CAP} 個產物，超過的不再多放，改成讓那一批變大變痛（總傷害不變）。<br>
        插件不影響晶片等級。同種晶片拖到一起就合成升級：等級相加、插座取大的、兩片的插件都移過去（插不下的退回倉庫），最多 Lv${CFG.MAX_CHIP_LV}，物理傷害 Lv2 ×${LV_MUL[2]}、Lv3 ×${LV_MUL[3]}；合成不能拆回來，不合成就分開放。武器插座開局 ${CFG.START_WSOCK} 個，每打完一隻王 +1，最多 ${CFG.WEAPON_SOCKETS} 個；晶片掉落時隨機 1～3 個插座（沙盒、靶場一律 ${CFG.MAX_SOCKETS} 個）。`)}
      ${R('擊退', `每把武器的擊退值不同：${Object.values(WEAPONS).map(W => `${W.name} ${W.base.knock}`).join('、')}。<br>
        一般敵人都會被推。旗艦有抗擊退，子彈的擊退值<b>超過</b>抗性才推得動，力道只看超過的部分：${CFG.BOSS_ORDER.map(id => `${ENEMY_TYPES[id].name} ${ENEMY_TYPES[id].knockResist}`).join('、')}。爆炸、震波、電弧不會推王。被擊退撞上行星的敵人多受 20 傷害。`)}
      ${R('子彈數量', `子彈數量<b>沒有上限</b>：數量插件、連鎖疊多少就放多少（手機可能會卡）。只有一個防止無限連鎖的上限：同一幀最多處理 ${CFG.MAX_TRIGGERS_PER_FRAME} 次觸發，超過的那幾次不會觸發。`)}
      ${R('倉庫', `倉庫 ${CFG.INV_SLOTS} 格，放暫時不用的晶片。不要的晶片可以回收，拿回 40% 售價。`)}
      ${R('插槽', `開局 ${CFG.START_SLOTS} 格，最多 ${CFG.MAX_SLOTS} 格。來源：擊敗 Boss、補給站購買（◆${CFG.SHOP_SLOT} 起，隨星區上漲）、精英戰獎勵、武器升滿後的軍械台。`)}
      ${R('？事件（航圖）', `進去才知道是哪一種；選項上寫著代價、獎勵（🎲 = 賭運氣，寫著機率），賭的結果先揭曉再繼續。<br>${EVENT_IDS.map(k => `<b style="color:${EVENTS[k].color}">${EVENTS[k].icon} ${EVENTS[k].name}</b>：${EVENTS[k].opts.map(o => o.lab).join('／')}`).join('<br>')}<br><b style="color:#ffd166">✦ 寶藏星域</b>：${HOARD_TXT}<br>下一場變難（求救訊號、星圖情報被發現）和寶藏星域是全隊的；其他都是自己的。`)}
      ${R('機體與地圖', '零件（改裝廠）、5 艘飛船（各自的能力）與地圖物件，見「機體與地圖」分頁。')}
    </div>`;
  },

  // 晶片：晶片和觸發器（插件另外一頁）
  chips(groups = ['chip']) {
    return groups.map(t => {
      const ids = NORMAL_IDS.filter(id => CHIPS[id].type === t);
      if (!ids.length) return '';
      const m = TYPE_META[t];
      const cards = ids.map(id => chipCard(id, hasLv(id) ? `<div class="ty" style="color:#9dff6b">同種 2 片合成 → Lv2、3 片 → Lv${CFG.MAX_CHIP_LV}</div>` : '')).join('');
      return `<div class="codex-sec"><h3 style="color:${m.color}">${m.icon} ${m.label}（${ids.length}）</h3><div class="cards" style="justify-content:flex-start;margin:0">${cards}</div></div>`;
    }).join('');
  },
  // 插件：不佔電路格，插在武器或晶片的插座上，只改那一片
  comps() {
    return `<div class="sub" style="margin:6px 0 10px">插件不佔電路格，拖到武器或晶片的<b>插座</b>上才有作用（超過插座數的變灰）。插在哪一片，就只改那一片（插在武器上 = 武器本身；插在晶片上 = 它放出的東西）。</div>` + this.chips(['comp']);
  },

  // 機體與地圖：飛船、零件、地圖物件
  bodyTab() {
    const ships = Object.values(SHIPS).map(S => `<div class="card" style="border-color:${S.color}"><div class="ttl" style="color:${S.color}">${S.name}</div>
      ${shipStatLine(S)}${shipDescHtml(S)}</div>`).join('');
    const parts = PART_IDS.map(id => partCard(id, '', this.hasRun() ? Game.parts : {})).join('');
    const R = (t, d) => `<div><b>${t}</b><br>${d}</div>`;
    return `<div class="codex-sec"><h3>🚀 飛船（開局配置與專屬能力）</h3><div class="cards" style="justify-content:flex-start;margin:0">${ships}</div></div>
      <div class="codex-sec"><h3>⚙ 零件</h3><div class="sub">零件格開局 6 格（先鋒號 8 格），擊沉旗艦時可以選零件格 +1（或電路插槽 +1）。每層小好處＋小代價，同種疊到 2 層、4 層開啟特性；
        <b>${BALANCE.name}</b>：${BALANCE.desc}。零件在「🔧 改裝廠」三選一取得，也可以付 ◆${PART_SWAP_PRICE}（隨星區上漲）把 1 層換成另一種。</div>
        <div class="cards" style="justify-content:flex-start;margin:0">${parts}</div></div>
      <div class="codex-sec"><h3>🪐 地圖物件</h3><div class="rules">
        ${R('大地圖', '一般戰、精英戰是一張不規則的大地圖，分成 2～3 個區域（一區一波），區域之間用通道相連、通道中間有閘門。牆擋住飛船、敵人和雙方的子彈：牆反彈的子彈照牆面的角度彈開，其他子彈打到牆就消失（敵人的子彈也一樣，牆可以當掩護）。閘門在這一區清完才打開，穿過去就開始下一區，不能回頭（多人：一個人穿過去就開始，另一個人之後自己飛過去）。右上角有小地圖。沙盒、靶場是方形場地。旗艦戰是一區的王關場地，形狀照王（母艦：圓形大廳＋凹室；獵艦：細長菱形；核心：中間四根柱子），終焉核心會在你身邊標紅圈轟炸。')}
        ${R('擺放', '大地圖的每個區域各自抽：一半機率沒有，有的話一般戰 1～2 種、精英戰 1 種（行星或彗星）。行星、黑洞放在空地上，不擋閘門；小行星帶從一邊的牆拉到另一邊的牆；彗星只在你所在的區域出現。旗艦戰沒有（王關場地本身就有凹室、柱子這些地形）。沙盒、靶場沒有。')}
        ${R('行星', '實心大球，擋住雙方的子彈。周圍的虛線圈是引力範圍：經過的子彈會被彎過去（彈弓），越慢的子彈彎越多。牆反彈的子彈會從行星表面反彈。')}
        ${R('黑洞', '把附近所有東西（敵人、雙方子彈、飛船）往中心拉；核心吞掉子彈，敵人和飛船碰到核心會受傷。旗艦不會被拉。')}
        ${R('彗星', '定時從場外（大地圖：從這一區的牆邊）沿直線橫越，進場前 1.5 秒有藍白色預警線（敵人的預警線是紅色）。撞到的敵人受 40、飛船受 20 傷害；打爆後碎片沿原本的方向炸出 10 發，敵人和飛船都會被打到（飛船每片 ${CFG.COMET_SHARD_DMG}）；撞到牆會爆炸。行星讓它彎軌道，黑洞吞掉它時會爆炸。')}
        ${R('小行星帶', `一整排小行星，擋住雙方的子彈；<b>被小行星擋住的敵人看不到</b>，只在小行星邊緣顯示「？」（感測器 4 層看得到）。只有單發傷害 ≥ ${OBJ.ROCK_MIN_DMG} 的子彈或爆炸打得動（巨彈、蓄力這類），打爆掉晶體（耐久每 ${OBJ.ROCK_CREDIT_HP} 一顆，大約 2～4 顆）。旗艦的子彈、旗艦和滾動的刺殼撞上去也會打碎（不掉晶體）。`)}
      </div></div>`;
  },

  weapons() {
    // 基礎型數值表：射程 = 子彈速度 × 存活時間（加速、佈雷都照射程比例算）
    const rows = Object.entries(WEAPONS).map(([id, W]) => {
      const p = weaponParams({ id, path: null, final: null });
      return `<tr><td style="color:${W.color}">${W.short}</td><td>${p.damage}</td><td>${p.count}</td><td>${p.damage * p.count}</td>
        <td>${(1 / (p.interval * p.rate)).toFixed(2)}</td><td>${p.speed}${p.speedVar ? '（±8%）' : ''}</td><td>${p.life} 秒</td>
        <td>${Math.round(p.speed * p.life)}</td><td>${p.pierce >= 99 ? '無限' : p.pierce}</td></tr>`;
    }).join('');
    const table = `<div class="codex-sec viz"><h3>基礎數值</h3>
      <div class="sub" style="margin:0">沒升級、沒晶片、沒插件。射程 = 子彈速度 × 存活時間。</div>
      <div class="tbl"><table><tr><th>武器</th><th>單發傷害</th><th>發數</th><th>每次開火</th><th>每秒開火</th><th>子彈速度</th><th>存活時間</th><th>射程</th><th>穿透</th></tr>${rows}</table></div></div>`;
    return table + Object.entries(WEAPONS).map(([id, W]) => {
      const p = weaponParams({ id, path: null, final: null });
      const cur = this.hasRun() && Game.weapon.id === id ? '　<span class="pill">目前使用</span>' : '';
      // 每個升級的估算 DPS 10-24 拿掉：只算單發傷害和射速，召回、上限這類效果算不到，大多顯示 ±0% 看起來像升級沒用
      const cols = Object.entries(W.paths).map(([k, P]) => `<div>
        <div class="wt-stage">第一段</div>
        <b style="color:${W.color}">${P.name}</b><br>${P.desc}
        <div class="wt-stage">第二段：二選一</div>
        ${P.next.map(n => `<div class="leaf"><b>${n.name}</b><br>${n.desc}</div>`).join('')}</div>`).join('');
      return `<div class="codex-sec" data-wpn="${id}"><h3 style="color:${W.color}">${W.name}${cur}</h3>
        <div class="sub" style="margin:0">${descList(W.desc)}單發 ${p.damage} × ${p.count}，每秒 ${(1 / p.interval).toFixed(1)} 次，擊退 ${p.knock}</div>
        <div class="tree">${cols}</div></div>`;
    }).join('');
  },

  current() {
    const s = Game.stats, info = Editor.slotInfo(Game.chain);
    const cell = i => {
      const id = Game.chain[i], d = CHIPS[id], m = TYPE_META[d.type], S = Game.socks[i] || [], SI = info.socks[i] || [];
      const notes = [];
      if (i === 0) notes.push(`武器：${weaponTitle(Game.weapon)}`);
      if (isHost(id)) notes.push(`插座 ${S.length} / ${socketsOf(id)}：${S.length ? S.map((c, k) => SI[k] && SI[k].idle ? `<span style="color:#ff8a8a">${CHIPS[c].name}（沒作用：${SI[k].why}）</span>` : `<b>${CHIPS[c].name}</b>`).join('、') : '空的'}`);
      const color = id === 'weapon' ? Game.wp.color : m.color;
      return `<div class="slotrow"><div class="no">第 ${i + 1} 格</div>
        <div><b style="color:${color}">${m.icon} ${lvName(id, slotLv(i, info))}</b>　<span style="color:#6a79ad">${m.label}</span>
        ${notes.length ? `<br>${notes.join('　·　')}` : ''}<br>${d.desc}${hasLv(id) ? '<br>' + lvLine(baseOf(id), slotLv(i, info)) : ''}</div></div>`;
    };
    const lines = `<div class="codex-sec"><h3>線（命中時觸發）</h3><div class="rules">${Game.chain.map((id, i) => id ? cell(i) : '').join('')}</div></div>`;
    const stat = (k, v) => `<div class="stat">${k}<b>${v}</b></div>`;
    return `<div class="stats">
        ${stat('每次開火子彈', s.count + ' 顆')}${stat('單次總傷害', s.dmg.toFixed(0))}${stat('射速', s.rps.toFixed(1) + ' 次/秒')}
        ${stat('武器估算 DPS', s.dpsEst.toFixed(0))}${stat('電路格', `${Game.chain.filter(Boolean).length - 1} / ${Game.chain.length - 1}`)}</div>
      ${lines}
      <div class="codex-sec"><h3>機體（零件 ${partsUsed(Game.parts)} / ${Game.partSlots}）</h3>
        <div class="sub">${PART_IDS.filter(id => Game.parts[id]).map(id => `${PARTS[id].name} ${Game.parts[id]} 層`).join('、') || '沒有零件'}</div></div>
      <div class="codex-sec"><h3>倉庫（${Game.inventory.filter(Boolean).length} / ${CFG.INV_SLOTS}）</h3>
        <div class="sub">${Game.inventory.filter(Boolean).map(id => CHIPS[id].name).join('、') || '倉庫是空的'}</div></div>`;
  },
};



function niceStep(raw) {  // 圖表刻度：取 1 / 2 / 2.5 / 5 × 10^n
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), n = raw / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
