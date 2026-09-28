// 星環電路 雙人版 · parts.js：機體成長線：零件 PARTS、背包模組 MODULES、機體數值 mechStats
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// 零件：每層小好處＋小代價，同種疊到 2 層、4 層開啟特性；零件格有限（開局 6 格，打倒旗艦 +1）
//   5 種零件都至少 1 層時開啟「均衡」：每層的好處 +30%
// =====================================================================
const PART_IDS = ['armor', 'larmor', 'booster', 'sink', 'sensor'];
const PARTS = {
  armor:   { name: '重裝甲', color: '#ffd166', up: '最大 HP +20', dn: '移動速度 −4%',
    t2: { id: 'thick', name: '厚甲', desc: '單次受傷最多扣最大 HP 的 20%' },
    t4: { id: 'ram', name: '衝撞', desc: '撞到敵人造成「重裝甲層數 × 20」傷害並撞飛，自己不受碰撞傷害' } },
  larmor:  { name: '輕裝甲', color: '#9fe8ff', up: '最大 HP +15', dn: '衝刺冷卻 +3%',
    t2: { id: 'deflect', name: '偏折', desc: '被打到後的無敵時間 +0.8 秒' },
    t4: { id: 'counter', name: '反擊裝甲', desc: '被打到時，朝打你的方向回射 8 發子彈' } },
  booster: { name: '加速器', color: '#4cc9f0', up: '移動速度 +6%', dn: '最大 HP −10',
    t2: { id: 'gale', name: '疾風', desc: '移動中射速 +20%' },
    t4: { id: 'assault', name: '突擊', desc: '衝刺穿過的敵人受到「武器傷害 × 4」' } },
  sink:    { name: '散熱片', color: '#ff9f1c', up: '射速 +6%', dn: '受到的傷害 +4%',
    t2: { id: 'quench', name: '急冷', desc: '衝刺後 2 秒內射速 +30%' },
    t4: { id: 'vent', name: '排熱爆發', desc: '衝刺時朝四周放出 12 發子彈' } },
  sensor:  { name: '感測器', color: '#9dff6b', up: '子彈速度 +8%', dn: '衝刺冷卻 +5%',
    t2: { id: 'lock', name: '鎖定', desc: '打中敵人後 1 秒內，子彈會追蹤那一隻（第一發要自己打中）' },
    t4: { id: 'mark', name: '弱點標記', desc: '被打中的敵人 3 秒內受到的傷害 +25%；看得到小行星後面的敵人' } },
};
const BALANCE = { id: 'balance', name: '均衡', desc: '5 種零件都至少 1 層：每層的好處 +30%' };
const PART_SWAP_PRICE = 30;  // 改裝廠：把 1 層零件換成另一種

// =====================================================================
// 背包模組：只有 1 格，換上新的舊的就沒了。每個都有代價
//   重裝甲 ≥ 2 層開啟「裝甲加成」、加速器 ≥ 2 層開啟「加速加成」（旗艦模組沒有加成）
// =====================================================================
const MODULES = {
  shield:   { name: '護盾產生器', icon: '⛨', eff: '擋下一次傷害，8 秒回復', cost: '移動速度 −10%', heavy: '2 層護盾', light: '4 秒回復' },
  blink:    { name: '相位跳躍', icon: '⤳', eff: '衝刺變成瞬移（距離 150）', cost: '衝刺冷卻 +50%', heavy: '瞬移落地放出震波', light: '沒有冷卻代價' },
  gravity:  { name: '重力井', icon: '◎', eff: '每 6 秒把周圍敵人吸到飛船前方一點', cost: '自己也會被往那一點拉', heavy: '自己不會被拉', light: '吸引範圍變大' },
  drone:    { name: '修復無人機', icon: '✚', eff: '5 秒沒受傷後開始回血（每秒 8）', cost: '最大 HP −20%', heavy: '回血 ×2', light: '3 秒就開始回血' },
  reactive: { name: '反應裝甲', icon: '✹', eff: '受傷時爆炸，擊退並傷害周圍敵人', cost: '受到的傷害 +5%', heavy: '爆炸範圍 ×1.5', light: '沒有傷害代價' },
  // 旗艦專屬（擊沉旗艦時可以裝上）
  swarmcore: { name: '星噬核心', icon: '✺', boss: 'boss', eff: '每 5 秒朝四周放出 12 發子彈（武器傷害）', cost: '最大 HP −10' },
  thruster:  { name: '裂界推進器', icon: '➹', boss: 'boss2', eff: '衝刺距離 ×2、衝刺冷卻 −30%', cost: '衝刺後 0.5 秒不能射擊' },
  endshell:  { name: '終焉護殼', icon: '⬡', boss: 'boss3', eff: '受到致命傷害時留 1 HP 並無敵 2 秒（每場戰鬥 1 次）', cost: '受到的傷害 +10%' },
};
const NORMAL_MODULES = Object.keys(MODULES).filter(id => !MODULES[id].boss);
const bossModuleOf = bossId => Object.keys(MODULES).find(id => MODULES[id].boss === bossId) || null;

// 機體數值：零件層數＋背包模組 → 倍率、特性
function mechStats(parts, module) {
  const n = id => (parts && parts[id]) || 0;
  const T = {};
  for (const id of PART_IDS) { T[PARTS[id].t2.id] = n(id) >= 2; T[PARTS[id].t4.id] = n(id) >= 4; }
  T.balance = PART_IDS.every(id => n(id) >= 1);
  const k = T.balance ? 1.3 : 1;
  const s = { maxHp: 0, hpMul: 1, speed: 1, taken: 1, rate: 1, bspeed: 1, dashCd: 1, dashDist: 1, traits: T,
    heavy: n('armor') >= 2, light: n('booster') >= 2, module: module || null, armor: n('armor') };
  s.maxHp += 20 * k * n('armor'); s.speed *= Math.pow(0.96, n('armor'));
  s.maxHp += 15 * k * n('larmor'); s.dashCd *= Math.pow(1.03, n('larmor'));
  s.speed *= 1 + 0.06 * k * n('booster'); s.maxHp -= 10 * n('booster');
  s.rate *= 1 + 0.06 * k * n('sink'); s.taken *= Math.pow(1.04, n('sink'));
  s.bspeed *= 1 + 0.08 * k * n('sensor'); s.dashCd *= Math.pow(1.05, n('sensor'));
  switch (module) {
    case 'shield': s.speed *= 0.9; break;
    case 'blink': if (!s.light) s.dashCd *= 1.5; break;
    case 'drone': s.hpMul = 0.8; break;
    case 'reactive': if (!s.light) s.taken *= 1.05; break;
    case 'swarmcore': s.maxHp -= 10; break;
    case 'thruster': s.dashCd *= 0.7; s.dashDist = 2; break;
    case 'endshell': s.taken *= 1.1; break;
  }
  s.maxHp = Math.round(s.maxHp);
  return s;
}
const partsUsed = parts => PART_IDS.reduce((a, id) => a + ((parts && parts[id]) || 0), 0);
// 零件的一句話說明（卡片、編輯器用）
const partLine = id => { const P = PARTS[id]; return `每層：<span style="color:#9dff6b">${P.up}</span>｜<span style="color:#ff8f8f">${P.dn}</span>`; };
const moduleLine = (id, full = true) => {
  const M = MODULES[id];
  if (!M) return '';
  return `${M.eff}<br><span style="color:#ff8f8f">代價：${M.cost}</span>` +
    (full && !M.boss ? `<br><span style="color:#ffd166">重裝甲 ≥ 2：${M.heavy}</span>　<span style="color:#4cc9f0">加速器 ≥ 2：${M.light}</span>` : '');
};
