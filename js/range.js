// 星環電路 雙人版 · range.js：🎯 靶場：標靶排列、DPS 計算、慢動作
// 所有 js/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// RANGE — 靶場：固定標靶＋DPS 計算＋慢動作，用來確認晶片機制
// =====================================================================
const Range = {
  layout: 'single', slow: false, log: [], total: 0, hits: 0, maxHit: 0, bySrc: {}, t0: 0,
  LAYOUTS: { single: '單一標靶', line: '一排（看穿透）', pack: '密集群（看爆炸、分裂）', wide: '散開（看彈射、追蹤、電弧）' },
  KEYS: ['single', 'line', 'pack', 'wide'],
  SLOW: 0.25,
  reset(layout = this.layout) {
    this.layout = layout;
    const G = Game, p = G.player;
    G.enemies = []; G.bullets = []; G.eBullets = []; G.triggerQueue = []; G.texts = []; G.nextId = 1;
    p.x = CFG.WORLD_W / 2 - 300; p.y = CFG.WORLD_H / 2; p.vx = p.vy = 0;
    const cx = p.x + 400, cy = p.y;
    const pts = {
      single: [[0, 0]],
      line: [0, 1, 2, 3, 4].map(i => [i * 70, 0]),
      pack: [[0, 0], [42, -36], [42, 36], [-42, -36], [-42, 36], [84, 0], [-84, 0], [0, -72], [0, 72]],
      wide: [[0, -280], [140, -150], [200, 0], [140, 150], [0, 280], [-40, 0]],
    }[layout];
    for (const [dx, dy] of pts) {
      const e = new Enemy('dummy', cx + dx, cy + dy, 1);
      e.hx = e.x; e.hy = e.y;
      G.enemies.push(e);
    }
    this.clearStats();
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
  key(k) {  // 靶場快捷鍵：1～4 換標靶、R 清除數據、T 慢動作
    const i = '1234'.indexOf(k);
    if (i >= 0) { this.reset(this.KEYS[i]); return true; }
    if (k === 'r') { this.clearStats(); return true; }
    if (k === 't') { this.slow = !this.slow; return true; }
    return false;
  },
};
