// 星環電路 雙人版 · config.js：設定值 CFG 與共用小工具（亂數、距離、角度）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CONFIG
// =====================================================================
const CFG = {
  WORLD_W: 2400, WORLD_H: 1600,
  IFRAME: 0.7,               // 船體 HP / 速度 / 衝刺冷卻改由 SHIPS 定義
  DASH_SPEED: 900, DASH_TIME: 0.14,
  START_SLOTS: 4, MAX_SLOTS: 8, INV_SLOTS: 6,
  MAX_CHIP_LV: 3,           // 晶片等級上限；每級效果強度 +50%
  GROW_TAG_TIME: 1,         // 用量成長：照玩法打中後 1 秒內敵人死掉才算（見 Game.tagGrow）
  STAR_HOME_TURN: 1.5, STAR_HOME_HITS: 2,  // 星環（環繞進化）：追蹤轉向每秒幾弧度（不跟子彈速度放大）、追打幾隻後直線飛
  WAVE_MUL: 1.4,            // 一波的敵人預算倍數（主題小兵加入後調）
  // 雙人（隊友在線時）：敵人數量、血量的倍數隨難度增加（[難度 0, 難度 20]，中間線性，無盡模式停在最後的值）——兩個人的配裝一起疊，後期成長比單人快
  //   成長需求 ×COOP_GROW（兩人都能打到同一隻，每人拿到的不是剛好一半，照雙人模擬實測）
  COOP_COUNT: [2, 2.5], COOP_HP: [1, 1.3], COOP_GROW: 1.25,
  MAX_SHOTS_PER_FIRE: 32,   // 單次開火子彈上限，超過的轉為傷害
  MAX_TRIGGER_DEPTH: 3,     // 命中觸發巢狀上限
  MAX_LIVE_BULLETS: 700,
  MAX_TRIGGERS_PER_FRAME: 80,
  BASE_INTERVAL: 0.16, MIN_INTERVAL: 0.06,
  HEAT_RATE: 0.05,          // 能量負載：每 1 點 ⚡ 射速 -5%（所有武器相同）
  HEAT_RATE_FLOOR: 0.25,    // 射速最多降到 25%（15 點能量以上不再更慢）
  MAGNET_RANGE: 140,
  AUTO_RANGE: 560,          // 手機自動攻擊的索敵距離
  RESONANCE: 0.5,           // 每個相鄰共振器 +50% 效果
  RICOCHET_RANGE: 420,      // 彈射尋找下一個目標的距離
  ARC_RANGE: 260,           // 電弧（軌道砲・磁暴線圈）找附近敵人的距離
  // 刺殼：距離 range 內開始縮球 windup 秒（最後 lock 秒鎖定方向）→ 以 rollSpeed 滾 rollT 秒 → 暈眩 stunT 秒 → 冷卻 cooldown 秒
  BRUTE: { range: 350, windup: 0.7, lock: 0.3, rollSpeed: 520, rollT: 0.9, stunT: 1, cooldown: 1.5 },
  BOSS_KNOCK: 30,          // 推王：每超過抗擊退 1 點，每次命中推 30（王會慢慢拉回自己的速度）
  REPAIR_RATIO: 0.5, SCRAP_REMOVE: 25,  // 維修站修復 50% 最大 HP
  SHOP_REPAIR: { price: 40, ratio: 0.2 },  // 補給站補血：回復最大 HP 的 20%，每間只能補一次
  SHOP_PRICE_UP: 0.35,      // 所有花晶體的價格 ×（1 ＋ 0.35 ×（星區 − 1）²），跟晶體收入的成長一樣（整局模擬實測）：第 2 星區 ×1.35、第 3 ×2.4、第 4 ×4.15；補給站、刷新獎勵、換零件、拆廢鐵
  SHOP_SLOT: 70,            // 補給站購買電路擴充（插槽 +1）
  ARMORY_BONUS: { credits: 30, hp: 20 },  // 武器已升滿時，軍械台改給的補償
  FUSE_SUCCESS: 0.5,
  REVIVE: { range: 70, time: 2, iframe: 1.5 },  // 雙人救援：活著的隊友待在倒下位置 70 內滿 2 秒；救起後無敵 1.5 秒
  VERSION: 'mp-2.2.0（2026-09-30 03:15）',  // 雙人版版號：標題、大廳、遊玩紀錄都會顯示；兩邊版號不同不讓連線
  CAMPAIGN_SECTORS: 3,     // 固定三關；打完可選擇繼續無盡模式
  // 無盡模式：每過一個星區（乘算）敵人攻擊 ×1.25、攻擊頻率 ×1.1、移動速度 ×1.05、血量 ×1.2（另外還有本來的每層血量成長）
  ENDLESS_DMG: 1.25, ENDLESS_ATK: 1.1, ENDLESS_SPD: 1.05, ENDLESS_HP: 1.2,
  BOSS_ORDER: ['boss', 'boss2', 'boss3'],  // 三關依序的旗艦；無盡模式從中隨機抽
  MAX_RECORDS: 50,          // 瀏覽器保留的遊玩紀錄筆數
};

// 遊玩紀錄存在瀏覽器的名稱：V2 用新的名稱，不會蓋掉 V1（同一個網域）的紀錄
const RECORDS_KEY = 'v2_runRecords';
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(rand(a, b + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const pickN = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
const angleDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const mod = (v, m) => ((v % m) + m) % m;
// 射擊間隔倍率 → 說明文字：間隔 ×0.7 寫成「射速加快 1.43 倍」（紅），×1.3 寫成「射速變慢 1.3 倍」（綠）
const rateTxt = (m, pre = '') => m < 1
  ? `<span style='color:#ff6b6b'>射速${pre}加快 ${+(1 / m).toFixed(2)} 倍</span>`
  : `<span style='color:#7dff8a'>射速${pre}變慢 ${+m.toFixed(2)} 倍</span>`;
// 點 (px,py) 到線段 A→B 的最短距離平方：用來判定子彈「整段飛行路徑」有沒有碰到敵人
function segDist2(ax, ay, bx, by, px, py) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  const t = l2 ? clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1) : 0;
  return dist2(ax + dx * t, ay + dy * t, px, py);
}

// 敵人血量倍率（難度 ＝ 層數 ＋（星區 − 1）× 7）：二次成長，後面的星區越來越硬，跟得上玩家疊起來的傷害
//   1 ＋ 0.1×難度 ＋ 0.01×難度² ＋（波次 − 1）× 0.08：第 1 星區 ×1.0～1.96、第 2 星區到 ×3.64、第 3 星區到 ×7.0
function enemyHpMul(level, wave = 1) { return 1 + level * 0.1 + level * level * 0.01 + (wave - 1) * 0.08; }
// 雙人倍數：[開頭, 第 3 星區最後（難度 20）] 之間照難度線性，超過 20（無盡）停在最後的值
function coopMul(pair, level) { return pair[0] + (pair[1] - pair[0]) * clamp(level / 20, 0, 1); }
