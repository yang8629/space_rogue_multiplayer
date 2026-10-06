// 星環電路 雙人版 · range.js：🎯 靶場：標靶排列、DPS 計算、慢動作
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// RANGE — 靶場：固定標靶＋DPS 計算＋慢動作，用來確認晶片機制；按 5 切換「實戰」（原本的沙盒：一波波真的敵人，無限波次）
// =====================================================================
const Range = {
  layout: 'single', slow: false, live: false, log: [], total: 0, hits: 0, maxHit: 0, bySrc: {}, t0: 0,
  LAYOUTS: { single: '單一標靶', line: '一排（看穿透）', pack: '密集群（看爆炸、分裂）', wide: '散開（看彈射、追蹤、電弧）',
    flood: '爆量重現（以前攔截爆量那組散彈配裝＋終焉核心環形波）' },
  KEYS: ['single', 'line', 'pack', 'wide', 'flood'],
  KEY_CH: '12346',  // 各排列的快捷鍵（5 是實戰）
  SLOW: 0.25,
  // 手動生成敵人：種類、會不會動、打不打得死、難度（血量照這個難度的第 1 波）
  spawnType: 'swarmer', spawnMove: false, spawnKill: true, spawnLv: 1,
  SPAWN_LV: [1, 3, 6, 10, 17],
  spawnTypes() { return Object.keys(ENEMY_TYPES).filter(k => !ENEMY_TYPES[k].dummy && k !== 'splitling'); },
  // 在 (x, y) 生 n 隻（n > 1 時散在周圍 80 內）；不動 = 跟標靶一樣不移動也不攻擊；打不死 = 血量歸零自動補滿
  spawn(n, x, y) {
    const G = Game, type = this.spawnType, scale = enemyHpMul(this.spawnLv, 1);
    for (let i = 0; i < n; i++) {
      const a = rand(0, TAU), d = n > 1 ? rand(20, 80) : 0;
      const [ex, ey] = Arena.clampIn(x + Math.cos(a) * d, y + Math.sin(a) * d, ENEMY_TYPES[type].radius + 4);
      const e = new Enemy(type, ex, ey, scale);
      e.manual = true; e.spawnT = 0.3;
      if (!this.spawnMove) {
        e.t = { ...e.t, dmg: 0 }; e.frozen = true; e.hx = ex; e.hy = ey; e.cloak = 0;  // 不跑 AI（跟標靶一樣被打退會彈回原位）；潛伏者不隱形
      }
      if (!this.spawnKill) e.immortal = true;
      G.enemies.push(e);
    }
  },
  // 生成的位置：鍵盤 G = 滑鼠指的地方；按鈕（手機）= 飛船前方 300
  spawnAt(n, atMouse) {
    const p = Game.player, c = Game.cam;
    const [x, y] = atMouse ? [c.x + Input.mx / ZOOM, c.y + Input.my / ZOOM] : [p.x + Math.cos(p.aim) * 300, p.y + Math.sin(p.aim) * 300];
    this.spawn(n, x, y);
  },
  reset(layout = this.layout) {
    this.layout = layout; this.live = false;
    const G = Game, p = G.player;
    G.combat.range = true;
    G.enemies = []; G.bullets = []; G.eBullets = []; G.triggerQueue = []; Events.emit('fxClear'); G.nextId = 1;
    p.x = CFG.WORLD_W / 2 - 300; p.y = CFG.WORLD_H / 2; p.vx = p.vy = 0;
    const cx = p.x + 400, cy = p.y;
    const pts = {
      single: [[0, 0]],
      line: [0, 1, 2, 3, 4, 5, 6, 7].map(i => [i * 60, 0]),
      pack: [[0, 0], ...[0, 1, 2, 3, 4, 5].map(k => [Math.cos(k * Math.PI / 3) * 66, Math.sin(k * Math.PI / 3) * 66]),  // 同心排列：中間 1、內圈 6、外圈 12
        ...Array.from({ length: 12 }, (_, k) => [Math.cos(k * Math.PI / 6) * 132, Math.sin(k * Math.PI / 6) * 132])],
      wide: [[0, -300], [120, -220], [200, -110], [230, 0], [200, 110], [120, 220], [0, 300], [-60, -120], [-60, 120], [60, 0]],
      flood: [[-140, -120], [-100, 60], [-180, 180], [-650, 100], [-680, -150], [-400, -260], [-320, 240], [-460, 220], [-20, -20], [-780, 0]],  // 圍在飛船四周（以前效能測試的位置）
    }[layout];
    for (const [dx, dy] of pts) {
      const e = new Enemy('dummy', cx + dx, cy + dy, 1);
      e.hx = e.x; e.hy = e.y;
      G.enemies.push(e);
    }
    if (layout === 'flood') {  // 爆量重現：QA 第 195 局那組配裝（以前一擋下環形波就整條電路回射，幾秒內幾萬發）
      G.weapon = { id: 'scatter', path: 'A', final: 0 }; G.refreshWeapon();
      G.chain = ['weapon', chipId('rear', 2, 2), chipId('accel', 3, 2), chipId('orbit', 3, 2), chipId('wallbounce', 2, 1), chipId('quick', 3, 1), chipId('intercept', 3, 2), chipId('dashfire', 1, 3)];
      G.socks = [['mirror', 'split'], ['shock'], ['ignite'], [], [], ['split'], [], []];
      G.wSock = Math.max(G.wSock || 0, 3); G.setModule('swarmcore'); G.recalc();
      this.ringT = 1;
      floatText(p.x, p.y - 30, '已換上爆量配裝（按住射擊）', '#ff9f1c', true);
    }
    this.clearStats();
  },
  // 爆量重現：每 1.5 秒一圈 32 發從 500 外射向飛船（終焉核心的環形波，不扣血）
  tick(dt) {
    if (this.live || this.layout !== 'flood' || (this.ringT -= dt) > 0) return;
    const G = Game, p = G.player;
    this.ringT = 1.5;
    for (let i = 0; i < 32; i++) {
      const a = i / 32 * TAU;
      G.eBullets.push({ x: p.x + Math.cos(a) * 500, y: p.y + Math.sin(a) * 500, vx: -Math.cos(a) * 160, vy: -Math.sin(a) * 160, r: 6, dmg: 0, life: 5, from: '靶場' });
    }
  },
  clearStats() {
    this.log = []; this.total = 0; this.hits = 0; this.maxHit = 0; this.bySrc = {}; this.t0 = Game.time;
    const R = Game.runStats;  // 電路編輯器「晶片傷害統計」也一起歸零，方便比較不同電路
    if (R) { R.dmg = Object.fromEntries(DMG_SOURCES.map(([k]) => [k, 0])); R.chips = {}; R.maxHit = 0; R.time = 0; }
    if (Game.sectorStats) Game.sectorStats = { chips: {}, t0: 0, kills0: 0, dmg0: 0 };
  },
  hit(dmg, src) {
    if (Game.mode !== 'range' || !(dmg > 0)) return;
    this.log.push([Game.time, dmg]);
    this.total += dmg; this.hits++;
    if (src !== 'burn') this.maxHit = Math.max(this.maxHit, dmg);
    this.bySrc[src] = (this.bySrc[src] || 0) + dmg;
  },
  dps(win = 3) {  // 最近 win 秒的每秒傷害（剛清除數據時用實際經過的時間）
    const t = Game.time;
    if (this.log.length > 4000) this.log = this.log.filter(([s]) => t - s < 10);
    let s = 0;
    for (const [a, d] of this.log) if (t - a < win) s += d;
    return s / Math.min(win, Math.max(0.25, t - this.t0));
  },
  // 實戰（原本的沙盒）：清掉標靶，改成一波波真的敵人（無限波次、越來越強；飛船不會死）
  goLive() {
    const G = Game, C = G.combat;
    this.live = true;
    Object.assign(C, { range: false, wave: 0, waveTimer: 1.2, pending: [], spawnClock: 0, cleared: false });
    G.enemies = []; G.bullets = []; G.eBullets = []; G.triggerQueue = []; Events.emit('fxClear'); G.kills = 0;
    G.player.hp = G.player.maxHp;
    this.clearStats();
  },
  // 畫面上的按鈕（1～5、R、T）：只在靶場戰鬥中顯示，目前的排列／實戰／慢動作亮起來
  bar: null,
  syncBar() {
    if (!this.bar) {
      this.bar = document.getElementById('rangeBar');
      if (!this.bar) return;
      this.bar.addEventListener('click', ev => {
        const b = ev.target.closest('[data-rk]');
        if (!b) return;
        if (b.dataset.rk === 'g') this.spawnAt(1, false);  // 按鈕：生在飛船前方（滑鼠在按鈕上）
        else this.key(b.dataset.rk);
        b.blur();
      });
      const ty = document.getElementById('rgType'), lv = document.getElementById('rgLv');
      if (ty && lv) {
        ty.innerHTML = this.spawnTypes().map(k => `<option value="${k}">${ENEMY_TYPES[k].name}${ENEMY_TYPES[k].boss ? '（王）' : ''}</option>`).join('');
        lv.innerHTML = this.SPAWN_LV.map(l => `<option value="${l}">難度 ${l}</option>`).join('');
        ty.value = this.spawnType; lv.value = String(this.spawnLv);
        ty.addEventListener('change', () => { this.spawnType = ty.value; ty.blur(); });  // 選完就離開選單（不然按鍵會改到選項）
        lv.addEventListener('change', () => { this.spawnLv = +lv.value; lv.blur(); });
      }
    }
    const show = Game.mode === 'range' && Game.state === 'play';
    this.bar.classList.toggle('hidden', !show);
    if (!show) return;
    for (const b of this.bar.querySelectorAll('[data-rk="move"]')) b.textContent = this.spawnMove ? '會動' : '不動';
    for (const b of this.bar.querySelectorAll('[data-rk="kill"]')) b.textContent = this.spawnKill ? '打得死' : '打不死';
    const cur = this.live ? '5' : this.KEY_CH[this.KEYS.indexOf(this.layout)];
    for (const b of this.bar.querySelectorAll('[data-rk]'))
      b.classList.toggle('on', b.dataset.rk === cur || (b.dataset.rk === 't' && this.slow));
  },
  key(k, shift = false) {  // 靶場快捷鍵：1～4 換標靶、5 實戰、R 清除數據、T 慢動作、G 生成敵人（Shift：5 隻）、C 清除手動生的敵人
    if (k === 'g') { this.spawnAt(shift ? 5 : 1, true); return true; }
    if (k === 'c') { Game.enemies = Game.enemies.filter(e => !e.manual); return true; }
    if (k === 'move') { this.spawnMove = !this.spawnMove; return true; }
    if (k === 'kill') { this.spawnKill = !this.spawnKill; return true; }
    const i = this.KEY_CH.indexOf(k);
    if (i >= 0) { this.reset(this.KEYS[i]); return true; }
    if (k === '5') { if (!this.live) this.goLive(); return true; }
    if (k === 'r') { this.clearStats(); return true; }
    if (k === 't') { this.slow = !this.slow; return true; }
    return false;
  },
};
