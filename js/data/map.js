// 星環電路 雙人版 · map.js：航圖節點與星圖產生 genMap
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// MAP — 星區節點航圖
// =====================================================================
// desc：航圖下方的節點介紹（數字直接讀 CFG，改數值時說明會跟著變）
const NODE_META = {
  combat: { label: '戰鬥', icon: '⚔', color: '#4cc9f0', desc: () => '2 波敵人（第 4 層起 3 波）。勝利後從 3 個晶片選 1 個。' },
  elite:  { label: '精英', icon: '☠', color: '#ffd400', desc: () => '最後一波出現精英「虛空獵手」。勝利後從 2 個軍規複合晶片或「插槽 +1」選 1 個，另得 ◆15。之後至少有一條路通往維修站。' },
  shop:   { label: '補給站', icon: '◆', color: '#2ee6a6',
    desc: () => `買晶片（60% 機率有軍規複合晶片）、補血 HP +${CFG.SHOP_REPAIR.hp}（◆${CFG.SHOP_REPAIR.price}，限 1 次）、電路擴充（◆${CFG.SHOP_SLOT}）、拆廢鐵（◆${CFG.SCRAP_REMOVE}）。不賣武器升級。` },
  repair: { label: '維修站', icon: '✚', color: '#9dff6b', desc: () => `修復 ${CFG.REPAIR_RATIO * 100}% 最大 HP。` },
  blackhole: { label: '黑洞', icon: '◐', color: '#b388ff', desc: () => `投入 2 個晶片：${CFG.FUSE_SUCCESS * 100}% 融合成奇異點（兩個效果合一格＋超載詞綴），否則變成廢鐵。也可以不投入直接離開。` },
  armory: { label: '軍械台', icon: '⚒', color: '#ff9f1c', desc: () => `武器升級（每張圖只有 1 個）。武器升滿後改選「插槽 +1」或 ◆${CFG.ARMORY_BONUS.credits}＋HP ${CFG.ARMORY_BONUS.hp}。` },
  boss:   { label: '旗艦', icon: '♛', color: '#ff4d6d', desc: () => '守關旗艦。勝利後插槽 +1、◆50；進入下一關時修復 30% HP。' },
};

// 生成後檢查保底條件，不符合就重新生成（保底規則之間可能互相覆蓋）
//   精英、黑洞、補給站至少各一；軍械台整張圖剛好一個（第 2～5 層）；每個精英的下一步至少有一條路通維修站；
//   維修站、補給站都不會連著出現（沒有「維修站 → 維修站」「補給站 → 補給站」的路線）
function mapOk(m) {
  const has = (from, to, type) => m.slice(from, to).flat().some(n => n.type === type);
  const all = m.flat(), byId = id => all.find(n => n.id === id);
  const armories = all.filter(n => n.type === 'armory');
  return has(2, 4, 'elite') && has(2, 5, 'blackhole') && has(1, 5, 'shop') && m[m.length - 2].every(n => n.type === 'shop') &&
    armories.length === 1 && armories[0].L >= 1 && armories[0].L <= 4 &&
    all.filter(n => n.type === 'elite').every(n => n.next.some(id => byId(id).type === 'repair')) &&
    !all.some(n => ['repair', 'shop'].includes(n.type) && n.next.some(id => byId(id).type === n.type));
}
function genMap() {
  let m;
  for (let i = 0; i < 200; i++) {
    m = genMapOnce();
    if (mapOk(m)) break;
  }
  return m;
}
function genMapOnce() {
  const LAYERS = 7, layers = [];
  for (let L = 0; L < LAYERS; L++) {
    const n = L === LAYERS - 1 ? 1 : L === 0 ? 2 : randInt(2, 3);
    const row = [];
    for (let k = 0; k < n; k++) row.push({ id: L + '-' + k, L, k, n, type: 'combat', next: [] });
    layers.push(row);
  }
  for (let L = 2; L < LAYERS - 2; L++) for (const nd of layers[L]) {
    const r = Math.random();
    nd.type = r < 0.2 ? 'elite' : r < 0.32 ? 'shop' : r < 0.4 ? 'repair' : r < 0.52 ? 'blackhole' : 'combat';
    // 精英只放第 3～4 層：精英後面要接維修站，而第 6 層（王前）全部是補給站
    if (nd.type === 'elite' && L > 3) nd.type = 'combat';
  }
  if (Math.random() < 0.5) pick(layers[1]).type = 'shop';
  // 保底：優先把「戰鬥」節點改成缺少的類型
  const ensure = (nodes, type) => {
    if (nodes.some(n => n.type === type)) return;
    const cands = nodes.filter(n => n.type === 'combat');
    pick(cands.length ? cands : nodes).type = type;
  };
  const mid = layers.slice(2, 5).flat();
  ensure(layers.slice(2, 4).flat(), 'elite');
  ensure(mid, 'blackhole');
  ensure(layers.slice(1, 5).flat(), 'shop');
  // 軍械台整張圖只有一個，隨機放在第 2～5 層的戰鬥節點上
  const armCands = layers.slice(1, 5).flat().filter(n => n.type === 'combat');
  if (armCands.length) pick(armCands).type = 'armory';
  layers[LAYERS - 2].forEach(nd => nd.type = 'shop');  // 王關前一層全部是補給站
  layers[LAYERS - 1][0].type = 'boss';

  const rel = n => (n.k + 0.5) / n.n;
  const link = (a, b) => { if (!a.next.includes(b.id)) a.next.push(b.id); };
  for (let L = 0; L < LAYERS - 1; L++) {
    const A = layers[L], B = layers[L + 1];
    for (const a of A) {
      const s = [...B].sort((x, y) => Math.abs(rel(x) - rel(a)) - Math.abs(rel(y) - rel(a)));
      link(a, s[0]);
      if (s[1] && Math.random() < 0.45) link(a, s[1]);
    }
    for (const b of B) if (!A.some(a => a.next.includes(b.id)))
      link([...A].sort((x, y) => Math.abs(rel(x) - rel(b)) - Math.abs(rel(y) - rel(b)))[0], b);
  }
  // 精英之後：下一步至少有一條路通維修站（優先把戰鬥節點改掉，其次補給站）
  const byId = id => layers.flat().find(n => n.id === id);
  for (const e of layers.flat().filter(n => n.type === 'elite')) {
    const next = e.next.map(byId);
    if (next.some(n => n.type === 'repair')) continue;
    // 優先挑前後都沒有維修站的節點，避免造成維修站連著出現
    const parents = n => layers.flat().filter(p => p.next.includes(n.id));
    const lonely = n => ![...parents(n), ...n.next.map(byId)].some(x => x.type === 'repair');
    const cands = [...next.filter(n => n.type === 'combat'), ...next.filter(n => n.type === 'shop')];
    const cand = cands.find(lonely) || cands[0];
    if (cand) cand.type = 'repair';
  }
  // 維修站不連著出現：「維修站 → 維修站」時，把不是精英保底的那一個改掉
  const needed = n => layers.flat().some(p => p.type === 'elite' && p.next.includes(n.id));
  for (const a of layers.flat()) {
    if (a.type !== 'repair') continue;
    for (const b of a.next.map(byId)) {
      if (b.type !== 'repair') continue;
      if (!needed(a)) { a.type = 'combat'; break; }
      if (!needed(b)) b.type = 'combat';
    }
  }
  // 補給站也不連著出現：「補給站 → 補給站」時把前面那一個改成戰鬥（第 6 層的補給站保留）
  for (const a of layers.flat()) {
    if (a.type === 'shop' && a.next.some(id => byId(id).type === 'shop')) a.type = 'combat';
  }
  return layers;
}
