// 整套配裝評分（2026-10-09）：要選東西時把每個選項「試裝」上去、用遊戲自己的數字算整套配裝的分數，挑最高的
//   以前零件、武器升級隨機，背包模組照固定排名 → 不會疊數值（玻璃砲＋增加受傷的零件、重量砲＋變慢的零件…）
//   分數 = 每秒傷害 × √(有效 HP) × √(移動速度) × 衝刺 × 特性 × 模組
//     每秒傷害：遊戲的估算 DPS（stats.dpsEst，已含玻璃砲、重量砲）× 機體射速（散熱片、疾風、裝甲供能、架設；重力井）× 動能彈頭（打中時的彈速）
//     有效 HP：最大 HP ÷ 受到的傷害；衝刺：冷卻越短越好（^0.15）；特性：零件 2／4 層的特性每個 ×1.04（效果多半不在數值裡）
//     模組：數值以外的效果（修復無人機、護盾…）照自動對戰模擬的保命排名給係數
//   改玩法晶片的效果（環繞、蓄力…）估算 DPS 算不到 → 晶片仍照晶片價值表（chipScore）；價值表沒有資料的晶片才用試裝

const MOD_VAL = { drone: 1.15, shield: 1.12, thruster: 1.06, endshell: 1.08, gravity: 1.04, swarmcore: 1.05, reactive: 1.03, blink: 1.02 };
const ACCEL_HIT = 1.6;  // 裝加速晶片時，子彈打中時大約是出手彈速的幾倍（動能彈頭用）

function buildScore() {
  const S = G.stats, M = G.mech, p = G.player, T = M.traits;
  const standAvg = S.stand ? 0.1 * standMax(S.stand) * 0.4 : 0;  // 架設：平均約四成滿（模擬裡停下來 4 成時間）
  const rate = (M.rate + (T.gale ? 0.2 * 0.6 : 0) + hpRateAdd(p) + (T.quench ? 0.3 * 0.25 : 0) + standAvg) * M.rateMul;
  let kin = 1;
  const K = G.wp.kinetic;
  if (K) { const v = G.wp.speed * M.bspeed * (hasChip('accel') ? ACCEL_HIT : 1); kin = 1 + Math.max(0, v / K.ref - 1) * K.per; }
  const dps = S.dpsEst * rate * kin;
  const ehp = p.maxHp / M.taken;
  const traits = Object.values(T).filter(Boolean).length;
  return dps * Math.sqrt(ehp) * Math.sqrt(M.speed) * Math.pow(1 / M.dashCd, 0.15) * Math.pow(1.04, traits) * (MOD_VAL[M.module] || 1);
}

// 試裝：改動 → 算分 → 全部還原（不留下紀錄、不改 HP）
function trial(change) {
  const p = G.player, sv = {
    chain: [...G.chain], socks: (G.socks || []).map(s => [...(s || [])]), inventory: [...G.inventory], parts: { ...G.parts }, module: G.module,
    weapon: { ...G.weapon }, partSlots: G.partSlots, hp: p.hp, maxHp: p.maxHp,
    got: G.runStats ? G.runStats.got.length : 0, upg: G.runStats ? G.runStats.upgrades.length : 0 };
  try {
    change();
    G.refreshWeapon();  // 含 recalc
    return buildScore();
  } finally {
    Object.assign(G, { chain: sv.chain, socks: sv.socks, inventory: sv.inventory, parts: sv.parts, module: sv.module, weapon: sv.weapon, partSlots: sv.partSlots });
    G.refreshWeapon();
    p.hp = sv.hp; p.maxHp = sv.maxHp;
    if (G.runStats) { G.runStats.got.length = sv.got; G.runStats.upgrades.length = sv.upg; }
  }
}
const nowScore = () => trial(() => {});
// 打法方向（第 3 步）：武器還沒升級時，零件、模組照「預定要走的升級」算分（武器升級價值表在難度 6 最強的那個終極升級），
//   在軍械台之前拿的零件就會往之後的升級配（例如預定玻璃砲 → 先拿增加受傷的零件）
//   有指定路線（setRoute，整局模擬每局輪流指定）就照指定的
let ROUTE = null;  // { path: 'A', final: 0 }
function setRoute(r) { ROUTE = r; }
function planUpgrade() {
  if (G.weapon.path) return;
  if (ROUTE) { G.weapon = { ...G.weapon, path: ROUTE.path, final: ROUTE.final }; return; }
  const T = UPV[G.weapon.id]; if (!T) return;
  const t = T[nearKey(T, 6)], v = k => t[k].speed / Math.sqrt(Math.max(0.2, t[k].dmg));
  const k = Object.keys(t).filter(k => k.length === 2).reduce((a, b) => v(b) > v(a) ? b : a);  // 只比終極（'A0'）；'A' 是只升第一段
  G.weapon = { ...G.weapon, path: k[0], final: +k[1] };
}
// ---- 路線價值表（botsim --routeval，2026-10-09）：每條路線 × 每樣東西（晶片、零件 +1／+2／+4 層、模組）實際打出來的「速度 ÷ √掉血」倍數 ----
//   路線：已升滿 = 那個終極升級；升了第一段 = 那條第一段（只升第一段時量的）；還沒升級 = 「沒升級」和預定路線（指定或預定的）各半
//   終極升級那條路線沒量的東西（數值晶片、組件）用「沒升級」的；表裡沒有就回傳 null（呼叫的人退回舊的算法）
//   分數（10-09 改）：每一組各自算倍數再平均（對數），掉血兩邊各加底數 RV_F（兩場合計，最大 HP 的 %），避免沒加的那組幾乎沒掉血時爆掉
//     掉血雜訊大（每格 6 組時兩批差約 20%，速度只差 5%）→ 掉血用「同一樣東西所有路線、難度的組合併」算；
//     這一格單獨重跑到 RV_OWN 組以上（特別的路線，例如近戰＋重裝甲）就用它自己的掉血
const RV = globalThis.__RV || {};
const RV_F = 20, RV_OWN = 24;
const lgMean = (s, f) => s.reduce((a, g) => a + f(g), 0) / s.length;
const rvSpeedLg = s => lgMean(s, g => Math.log(g[2] / g[0]));  // g = [時間, 掉血%, 不加的時間, 不加的掉血%]
const rvBloodLg = s => lgMean(s, g => Math.log((g[1] + RV_F) / (g[3] + RV_F)));
const RV_POOL = new WeakMap();
function rvPoolLg(T, item) {
  let m = RV_POOL.get(T); if (!m) RV_POOL.set(T, m = new Map());
  if (!m.has(item)) { const s = []; for (const rk in T) for (const L in T[rk]) { const x = T[rk][L][item]; if (x && x.s) s.push(...x.s); } m.set(item, s.length ? rvBloodLg(s) : 0); }
  return m.get(item);
}
function rvScore(T, item, x) {  // T = 一把武器的整張表
  if (!x.s || !x.s.length) return (x.t0 / x.t) / Math.sqrt(Math.max(0.2, x.lost / Math.max(1, x.lost0)));  // 舊格式
  return Math.exp(rvSpeedLg(x.s) - 0.5 * (x.s.length >= RV_OWN ? rvBloodLg(x.s) : rvPoolLg(T, item)));
}
function rvRoutes() {
  const w = G.weapon;
  if (w.final != null) return [[w.path + w.final, 1]];
  if (w.path) return [[w.path, 1]];
  const plan = ROUTE || (() => { const p = { ...w }; planUpgrade(); const r = G.weapon; G.weapon = p; return r.path ? r : null; })();
  return plan ? [['none', 0.5], [plan.path + plan.final, 0.5]] : [['none', 1]];
}
function rvItem(item) {
  const T = RV[G.weapon.id]; if (!T || !T.none) return null;
  const L = (G.sector - 1) * 7 + (G.node ? G.node.L : 0);
  const look = rk => { const R = T[rk]; if (!R) return null; const C = R[nearKey(R, L)]; return C && C[item] ? rvScore(T, item, C[item]) : null; };
  let sum = 0, wsum = 0;
  for (const [rk, wt] of rvRoutes()) { const v = look(rk) ?? look('none'); if (v != null) { sum += v * wt; wsum += wt; } }
  return wsum ? sum / wsum : null;
}
// 零件：表是「多 1／2／4 層」的倍數 → 換算成「下一層」的倍數（第 1 層 = +1；第 2 層 = +2 ÷ +1；第 3、4 層 = √(+4 ÷ +2)，2／4 層的特性含在裡面）
//   × 疊數值修正：試裝評分「這一層在現在的配裝上」÷「這一層在沒有零件的配裝上」（玻璃砲疊受傷零件、重量砲疊變慢零件會變高）
function partScore(k) {
  const n = (G.parts[k] || 0) + 1, r1 = rvItem(`part:${k}:1`), r2 = rvItem(`part:${k}:2`), r4 = rvItem(`part:${k}:4`);
  if (r1 == null || r2 == null || r4 == null) return partGain(k);
  const m = n === 1 ? r1 : n === 2 ? r2 / r1 : Math.sqrt(r4 / r2);
  const fix = partGain(k) / Math.max(1e-9, gainOf(() => { G.parts = { [k]: 1 }; }) / Math.max(1e-9, gainOf(() => { G.parts = {}; })));
  return m * Math.max(0.7, Math.min(1.5, fix));
}
// 模組：表裡的倍數（換掉現在的模組時，比兩個的倍數）
const moduleScore = id => rvItem('mod:' + id) ?? moduleGain(id);
// 拿這個東西之後，整套配裝的分數變成幾倍
const gainOf = change => trial(() => { planUpgrade(); change(); }) / trial(planUpgrade);
const partGain = id => gainOf(() => { G.parts[id] = (G.parts[id] || 0) + 1; });
const moduleGain = id => gainOf(() => { G.module = id; });
// 晶片價值表沒有資料的晶片：試裝（晶片放進電路空格、沒有空格就暫時多一格；組件插武器，滿了插第一個晶片）
//   同一套配裝算過就記住（排電路時 chipScore 會被叫很多次）
const TRIAL_CACHE = new Map();
function chipTrialGain(id) {
  const key = [id, G.chain.join(), JSON.stringify(G.socks || []), JSON.stringify(G.parts), G.module, G.weapon.id, G.weapon.path, G.weapon.final].join('|');
  if (TRIAL_CACHE.has(key)) return TRIAL_CACHE.get(key);
  if (TRIAL_CACHE.size > 5000) TRIAL_CACHE.clear();
  const v = chipTrialRaw(id);
  TRIAL_CACHE.set(key, v);
  return v;
}
function chipTrialRaw(id) {
  // 已經裝著的：比「拿掉它」少多少（不然排電路時會算成再多裝一個）
  const ci = G.chain.indexOf(id), si = (G.socks || []).findIndex(s => s && s.includes(id));
  if (ci > 0 || si >= 0) return nowScore() / Math.max(1e-9, trial(() => {
    if (ci > 0) G.chain[ci] = null; else { const s = G.socks[si]; s.splice(s.indexOf(id), 1); }
  }));
  return trial(() => {
    if (CH[id].comp) {
      const S = G.socks || (G.socks = []), i = (S[0] || []).length < socketsOf('weapon') ? 0 : G.chain.findIndex((c, k) => k > 0 && c && (S[k] || []).length < socketsOf(c));
      if (i >= 0) (S[i] = S[i] || []).push(id);
    } else {
      const k = G.chain.indexOf(null);
      if (k > 0) G.chain[k] = id; else { G.chain.push(id); (G.socks || []).push([]); }
    }
  }) / nowScore();
}

// 軍械台：每個終極升級的分數 = 武器升級價值表（botsim --upval 實戰量的，upgradevalue_<武器>.json）× 跟現在配裝的加乘
//   加乘 =（裝這個升級時，零件和模組讓分數變幾倍）÷（沒升級時零件和模組讓分數變幾倍）——玻璃砲配增加受傷的零件、重量砲配變慢的零件會變高
//   估算 DPS 本身不拿來比升級：它假設每顆子彈都打中（範圍、多段攻擊高估，追蹤、穿透、控場算不到；2026-10-09 量過旋風斬 ×6、重力井 ×1）
//   價值表沒有這把武器 → 只用加乘以外的整套配裝分數（試裝）
//   第一段挑「這條路線最好的第二段」最高的那條（往後看一步），第二段直接比
const UPV = globalThis.__UPV || {};
function upgradeScore(path, f) {
  const set = () => { G.weapon = { ...G.weapon, path, final: f }; };
  const bare = () => { G.parts = {}; G.module = null; };
  const T = UPV[G.weapon.id];
  if (!T) return trial(set);
  const L = (G.sector - 1) * 7 + (G.node ? G.node.L : 0), x = T[nearKey(T, L)][path + f];
  const tv = x ? x.speed / Math.sqrt(Math.max(0.2, x.dmg)) : 1;
  const syn = (trial(set) / Math.max(1e-9, trial(() => { set(); bare(); }))) / (nowScore() / Math.max(1e-9, trial(bare)));
  return tv * syn;
}
function pickUpgrade() {
  const W = WEAPONS[G.weapon.id];
  if (ROUTE) return G.weaponStage() === 0 ? ROUTE.path : String(ROUTE.final);  // 指定路線：照著升
  if (G.weaponStage() === 0) {
    let best = null, bs = -Infinity;
    for (const path of Object.keys(W.paths)) {
      const s = Math.max(...W.paths[path].next.map((_, f) => upgradeScore(path, f)));
      if (s > bs) { bs = s; best = path; }
    }
    return best;
  }
  let best = 0, bs = -Infinity;
  W.paths[G.weapon.path].next.forEach((_, f) => { const s = upgradeScore(G.weapon.path, f); if (s > bs) { bs = s; best = f; } });
  return String(best);
}
// 改裝廠：三選一挑分數最高的；零件格滿了 → 看「拆掉一層換成選項裡的」有沒有變好 5% 以上（要付錢）
function workshop() {
  const W = G.ws, opts = W.options;
  const best = opts.reduce((a, b) => partScore(b) > partScore(a) ? b : a);
  if (partsUsed(G.parts) < G.partSlots) { G.wsPick(best); return; }
  let sw = null, sg = 1.05;
  for (const from of Object.keys(G.parts).filter(k => G.parts[k] > 0)) for (const to of opts) {
    if (to === from) continue;
    const g = trial(() => { G.parts[from]--; G.parts[to] = (G.parts[to] || 0) + 1; }) / nowScore();
    if (g > sg) { sg = g; sw = [from, to]; }
  }
  if (sw && G.credits >= G.shopPrice(PART_SWAP_PRICE)) { G.wsFrom(sw[0]); G.wsTo(sw[1]); }
}
// 背包模組（精英獎勵三選一）：挑試裝分數最高的
const pickModuleBy = opts => opts.reduce((a, b) => moduleScore(b) > moduleScore(a) ? b : a);
