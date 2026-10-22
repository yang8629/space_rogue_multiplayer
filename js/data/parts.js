// 星環電路 多人版 · parts.js：機體成長線：零件 PARTS、機體數值 mechStats
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 零件：每層小好處＋小代價，同種疊到 2 層、4 層開啟特性；零件格有限（開局 6 格，打倒旗艦 +1）
//   5 種零件都至少 1 層時開啟「均衡」：每層的好處 +30%
// =====================================================================
// 數值：名稱、越大越好（good 1）還是越小越好（-1）；圖示是 assets/ui/stat_<id>.png（tools/art/art_ui.js 畫的）
const STATS = {
  hp: { name: '最大 HP', good: 1 }, speed: { name: '移動速度', good: 1 }, dashCd: { name: '衝刺冷卻', good: -1 },
  taken: { name: '受到的傷害', good: -1 }, rate: { name: '射速', good: 1 }, bspeed: { name: '子彈速度', good: 1 }, slots: { name: '零件格', good: 1 }, cap: { name: '能量容量', good: 1 },
};
const signed = (v, pct) => `${v > 0 ? '+' : '−'}${Math.abs(v)}${pct ? '%' : ''}`;
const statFxText = ({ stat, v, pct }) => `${STATS[stat].name} ${signed(v, pct)}`;  // 純文字（複製紀錄、滑鼠提示）
// 疊 n 層的總效果：增加的百分比相加（+4% × 3 = +12%）；減少的百分比相乘（0.96² = −8%，疊再多也不會變成 0 或負的）；數值相加
const fxTimes = (f, n) => ({ ...f, v: f.pct && f.v < 0 ? Math.round(((1 + f.v / 100) ** n - 1) * 100) : f.v * n });

const PART_IDS = ['armor', 'larmor', 'booster', 'sink', 'sensor'];
const RAM_HP = 0.45;  // 衝撞（重裝甲 4 層）：傷害 = 最大 HP × 這個比例
const STREAK = { per: 0.03, max: 15 };  // 無傷連殺（輕裝甲 4 層，2026-10-09 取代反擊裝甲）：每層傷害 +3%
// fx：每層的效果（第一項是好處、第二項是代價）；up／dn 是同樣內容的文字（由 fx 產生）
const PARTS = {
  armor:   { name: '重裝甲', color: '#ffd166', fx: [{ stat: 'hp', v: 20 }, { stat: 'speed', v: -4, pct: true }],
    t2: { id: 'thick', name: '厚甲', desc: '單次受傷最多扣最大 HP 的 20%' },
    t4: { id: 'ram', name: '衝撞', desc: '撞到敵人造成「最大 HP × 45%」傷害並撞飛，自己不受碰撞傷害（HP 越高撞越痛）' } },
  larmor:  { name: '輕裝甲', color: '#9fe8ff', fx: [{ stat: 'dashCd', v: -8, pct: true }, { stat: 'taken', v: 3, pct: true }],
    t2: { id: 'deflect', name: '偏折', desc: '被打到後的無敵時間 +0.8 秒' },
    t4: { id: 'streak', name: '無傷連殺', desc: `沒被打中時每擊殺 1 隻，傷害 +${STREAK.per * 100}%（最多 ${STREAK.max} 層 +${STREAK.per * STREAK.max * 100}%）；被打中就歸零（護盾擋下不算）` } },
  booster: { name: '加速器', color: '#4cc9f0', fx: [{ stat: 'speed', v: 6, pct: true }, { stat: 'hp', v: -10 }],
    t2: { id: 'gale', name: '疾風', desc: '移動中射速 +20%' },
    t4: { id: 'assault', name: '突擊', desc: '衝刺穿過的敵人受到「武器傷害 × 4」' } },
  sink:    { name: '散熱片', color: '#ff9f1c', fx: [{ stat: 'cap', v: CFG.CAP_SINK }, { stat: 'taken', v: 4, pct: true }],
    t2: { id: 'quench', name: '急冷', desc: '衝刺後 2 秒內射速 +30%' },
    t4: { id: 'vent', name: '排熱爆發', desc: '衝刺時朝四周放出 12 發子彈' } },
  sensor:  { name: '感測器', color: '#9dff6b', fx: [{ stat: 'bspeed', v: 8, pct: true }, { stat: 'dashCd', v: 5, pct: true }],
    t2: { id: 'lock', name: '鎖定', desc: '打中敵人後 1 秒內，子彈會追蹤那一隻（第一發要自己打中）' },
    t4: { id: 'mark', name: '弱點標記', desc: '被打中的敵人 3 秒內受到的傷害 +25%；看得到小行星後面的敵人' } },
};
for (const P of Object.values(PARTS)) { P.up = statFxText(P.fx[0]); P.dn = statFxText(P.fx[1]); }
const BALANCE = { id: 'balance', name: '均衡', desc: '5 種零件都至少 1 層：每層的好處 +30%' };
const PART_SWAP_PRICE = 30;  // 改裝廠：把 1 層零件換成另一種

// 機體數值：零件層數 → 倍率、特性
// 疊法：同一項屬性「增加」的百分比全部相加，「減少」的各自相乘（疊再多也不會變成 0 或負的），最後 =（1 ＋ 增加的總和）× 減少的乘積
//   rate＝1 ＋ 射速增加（開火時再加上疾風、急冷、架設），rateMul＝射速減少；dashUp＝衝刺冷卻增加（最後乘進 dashCd）
// boons：？事件拿到的這一局效果（Game.boons：黑市 hp 次、終焉護殼 taken 次）
function mechStats(parts, boons) {
  const n = id => (parts && parts[id]) || 0;
  const T = {};
  for (const id of PART_IDS) { T[PARTS[id].t2.id] = n(id) >= 2; T[PARTS[id].t4.id] = n(id) >= 4; }
  T.balance = PART_IDS.every(id => n(id) >= 1);
  const k = T.balance ? 1.3 : 1;
  const s = { maxHp: 0, hpMul: 1, speed: 1, taken: 1, rate: 1, rateMul: 1, bspeed: 1, dashCd: 1, dashUp: 0, cap: 0, traits: T,
    armor: n('armor') };
  s.maxHp += 20 * k * n('armor'); s.speed *= Math.pow(0.96, n('armor'));
  s.dashCd *= Math.pow(1 - 0.08 * k, n('larmor')); s.taken += 0.03 * n('larmor');  // 輕裝甲：裝甲薄、身手快
  s.speed *= 1 + 0.06 * k * n('booster'); s.maxHp -= 10 * n('booster');
  s.cap += CFG.CAP_SINK * n('sink'); s.taken += 0.04 * n('sink');  // 散熱片：能量容量 +2（2026-10-10，以前射速 +6%）；受到的傷害：增加的都相加
  s.bspeed *= 1 + 0.08 * k * n('sensor'); s.dashUp += 0.05 * n('sensor');
  if (boons) { s.hpMul *= Math.pow(1 - CFG.EVENT.market.hpCut, boons.hp || 0); s.taken += CFG.EVENT.ward.taken * (boons.taken || 0); }  // 減少的相乘、增加的相加
  s.dashCd *= 1 + s.dashUp;
  s.maxHp = Math.round(s.maxHp);
  return s;
}
const partsUsed = parts => PART_IDS.reduce((a, id) => a + ((parts && parts[id]) || 0), 0);
// 零件的一句話說明（卡片、編輯器用）
// 每層的效果（圖示＋數值）；n：疊 n 層的總效果
