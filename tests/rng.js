// 模擬用的固定亂數（botsim.js、runsim.js 共用）
//   seed(n)：同樣的 n 跑出同樣的結果
//   分成四串亂數（2026-10-05 起；參考 Slay the Spire 各系統各用一串）：
//     敵人：出怪的種類和位置、敵人行動、敵彈、地圖物件、戰鬥開場、戰鬥場地
//     航圖：每個星區的航圖
//     獎勵：三選一、精英的模組、補給站商品、改裝廠零件、奇異點結果
//     其他（主串）：子彈（分裂的角度、感染的方向…）、電腦自己的選擇
//   改晶片數值、改三選一規則時，兩邊走的是同一張航圖、同一場仗、同樣的獎勵選項（只差在改的那個東西）
//   --rng=shared：恢復成同一串亂數（對照用）
'use strict';
const mk = n => () => { n = (n + 0x6D2B79F5) | 0; let t = Math.imul(n ^ (n >>> 15), 1 | n); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const SPLIT = !process.argv.includes('--rng=shared');
let enemyRand = null, mapRand = null, rewardRand = null, cur = Math.random;
const dispatch = () => cur();  // Math.random 固定是這個；現在用哪一串亂數由 cur 決定

function seed(n) {
  cur = mk(n);
  Math.random = dispatch;
  enemyRand = mk(Math.imul(n, 0x9E3779B1) ^ 0x2545F491);
  mapRand = mk(Math.imul(n, 0x85EBCA6B) ^ 0x68E31DA4);
  rewardRand = mk(Math.imul(n, 0xC2B2AE35) ^ 0x1B873593);
}

// 把某個系統的函式包起來：執行期間 Math.random 換成那個系統的亂數
//   只切換 cur（不改 Math.random 本身、不用 ...a／try：敵人的函式每幀都會呼叫，要很省）；這些函式最多 3 個參數
function wrapWith(obj, name, get) {
  const f = obj && obj[name];
  if (typeof f !== 'function') return;
  obj[name] = function (a, b, c) {
    const prev = cur;
    cur = get() || prev;
    const r = f.call(this, a, b, c);
    cur = prev;
    return r;
  };
}
function splitEnemyRng(T) {
  if (!SPLIT || T.__rngSplit) return;
  T.__rngSplit = true;
  const E = () => enemyRand, M = () => mapRand, R = () => rewardRand;
  for (const k of ['startCombat', 'startWave', 'spawnEnemy', 'updateWaves', 'updateEnemyBullets']) wrapWith(T.Game, k, E);
  wrapWith(T.Enemy && T.Enemy.prototype, 'update', E);
  for (const k of ['gen', 'update']) wrapWith(T.Objects, k, E);
  // 航圖：genMap 是全域函式（遊戲程式用名字呼叫），要換掉全域上的那一個
  wrapWith(globalThis, 'genMap', M);
  for (const k of ['rewardOptions', 'combatWon', 'openShop', 'openWorkshop', 'bhFuse']) wrapWith(T.Game, k, R);
}

// 模擬不看畫面：粒子、浮動數字不產生（省時間，也不會用掉亂數）；--fx 保留
function noFx() {
  if (process.argv.includes('--fx')) return;
  globalThis.burst = () => {};
  globalThis.floatText = () => {};
}

// 每一局開始時重設遊戲裡不會自己歸零的東西（不然同一個局號，前面跑過幾局結果就不一樣，--only 重現不了）：
//   Game.time（一直累加；電腦閃避的左右擺動、成長標記都照它算）、電弧計時、敵人尋路的計時器和快取
function resetRun(T) {
  T.Game.time = 0; T.Game.arcT = 0;
  if (T.Objects) { T.Objects.flowT = 0; if (T.Objects.fields && T.Objects.fields.clear) T.Objects.fields.clear(); }  // 敵人尋路每 0.25 秒重算一次：計時器不歸零，重算的時間點會跟著前一局錯開
}

module.exports = { seed, splitEnemyRng, noFx, resetRun, SPLIT };
