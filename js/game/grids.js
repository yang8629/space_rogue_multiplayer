// 星環電路 多人版 · grids.js：戰鬥用的空間格子：敵人（enemiesNear）、攔截子彈（IGrid）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
//   格子本身（SpatialGrid）在 core/spatial.js；這裡是讀 Game 的那幾個
'use strict';

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
