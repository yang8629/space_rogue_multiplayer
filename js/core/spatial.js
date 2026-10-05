// 星環電路 雙人版 · spatial.js：空間格子（碰撞、找附近的東西用）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 空間格子：把一群東西照位置分進 gs 大小的格子（每幀重建），查詢只看範圍附近的格子
//   查詢結果照原本陣列的順序（index 由小到大），跟逐一掃全部的結果一樣（平手時選到的也一樣）
//   建立之後才加進陣列的（例如這一幀才分裂出來的敵人）也會一起回傳
// =====================================================================
class SpatialGrid {
  constructor(gs = 128) { this.gs = gs; this.map = new Map(); this.items = null; this.n = 0; this.stamp = new Int32Array(0); this.q = 0; this.out = []; }
  // box(it) → [x0, y0, x1, y1]：這個東西佔的範圍（跨好幾格就放進好幾格）
  build(items, box) {
    const gs = this.gs, M = this.map;
    M.clear(); this.items = items; this.n = items.length;
    if (this.stamp.length < this.n) this.stamp = new Int32Array(Math.max(this.n, this.stamp.length * 2, 64));
    for (let i = 0; i < this.n; i++) {
      const [x0, y0, x1, y1] = box(items[i]);
      const cx0 = Math.floor(x0 / gs), cx1 = Math.floor(x1 / gs), cy0 = Math.floor(y0 / gs), cy1 = Math.floor(y1 / gs);
      for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
        const k = cx * 100000 + cy, L = M.get(k);
        if (L) L.push(i); else M.set(k, [i]);
      }
    }
    return this;
  }
  // 範圍 [x0, x1] × [y0, y1] 附近的東西（照原本順序）；回傳的陣列下次查詢會被重用
  query(x0, y0, x1, y1) {
    const gs = this.gs, M = this.map, out = this.out, st = this.stamp, items = this.items;
    out.length = 0;
    if (++this.q > 2e9) { this.q = 1; st.fill(0); }
    const q = this.q, idx = [];
    const cx0 = Math.floor(x0 / gs), cx1 = Math.floor(x1 / gs), cy0 = Math.floor(y0 / gs), cy1 = Math.floor(y1 / gs);
    for (let cx = cx0; cx <= cx1; cx++) for (let cy = cy0; cy <= cy1; cy++) {
      const L = M.get(cx * 100000 + cy);
      if (L) for (const i of L) if (st[i] !== q) { st[i] = q; idx.push(i); }
    }
    if (idx.length > 1) idx.sort((a, b) => a - b);
    for (const i of idx) out.push(items[i]);
    for (let i = this.n; i < items.length; i++) out.push(items[i]);  // 建立之後才加進來的
    return out;
  }
}

// 敵人格子：每幀在子彈更新前重建（Game.updateBullets）；enemiesNear 查不到格子（還沒建、敵人陣列換過）就回傳全部
const EGrid = new SpatialGrid(128);
let EGRID_PAD = 0;  // 最大的敵人半徑＋移動餘量
function buildEnemyGrid() {
  const E = Game.enemies;
  let maxR = 0; for (const e of E) if (e.r > maxR) maxR = e.r;
  EGRID_PAD = maxR + 24;
  EGrid.build(E, e => [e.x, e.y, e.x, e.y]);
}
function enemiesNear(x, y, R) {
  if (EGrid.items !== Game.enemies || Game.enemies.length < 24) return Game.enemies;  // 敵人少：直接全部掃比較快
  const p = R + EGRID_PAD;
  return EGrid.query(x - p, y - p, x + p, y + p);  // 共用陣列：拿到就用完，不要在迴圈裡再查一次
}

// 攔截子彈格子：每幀在敵彈更新時重建（Game.updateEnemyBullets）
const IGrid = new SpatialGrid(96);
