// 星環電路 雙人版 · map.js：航圖節點與星圖產生 genMap
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// MAP — 星區節點航圖
// =====================================================================
// desc：航圖下方的節點介紹（數字直接讀 CFG，改數值時說明會跟著變）
const NODE_META = {
  combat: { label: '戰鬥', icon: '⚔', color: '#4cc9f0', desc: () => '2 個區域（第 4 層起 3 個），整場是一張不規則的大地圖，一區一波敵人：清完打開閘門，穿過去到下一區（不能回頭；地上的晶體直接收下）。打完最後一區後從 3 個晶片選 1 個。' },
  elite:  { label: '精英', icon: '☠', color: '#ffd400', desc: () => '分成 2 個區域（大地圖），最後一區出現精英「虛空獵手」，每一區一半機率有行星或彗星。勝利後從 3 個背包模組（只有 1 格，換上新的舊的就沒了）或「插槽 +1」選 1 個，另得 ◆15。之後至少有一條路通往維修站。' },
  workshop: { label: '改裝廠', icon: '🔧', color: '#9fe8ff', desc: () => `零件三選一（佔 1 個零件格）；也可以付 ◆${Game.shopPrice(PART_SWAP_PRICE)} 把 1 層零件換成另一種（價格隨星區上漲）。` },
  shop:   { label: '補給站', icon: '◆', color: '#2ee6a6',
    desc: () => `買晶片、補血（最大 HP 的 ${CFG.SHOP_REPAIR.ratio * 100}%，◆${Game.shopPrice(CFG.SHOP_REPAIR.price)}，限 1 次）、電路擴充（◆${Game.shopPrice(CFG.SHOP_SLOT)}）。不賣武器升級。價格隨星區上漲（第 2 星區 ×${+(1 + CFG.SHOP_PRICE_UP).toFixed(2)}、第 3 星區 ×${+(1 + 4 * CFG.SHOP_PRICE_UP).toFixed(2)}）。` },
  repair: { label: '維修站', icon: '✚', color: '#9dff6b', desc: () => `修復 ${CFG.REPAIR_RATIO * 100}% 最大 HP。` },
  blackhole: { label: '奇異點', icon: '◐', color: '#b388ff', desc: () => `投入 1 個晶片：隨機一個還沒強化過的電路格（武器格也可能）得到一個屬性（好結果 70%～90%，看晶片等級；也可能是壞的）。也可以不投入直接離開。一條路線最多一個黑洞。` },
  armory: { label: '軍械台', icon: '⚒', color: '#ff9f1c', desc: () => `武器升級（每張圖只有 1 個）。武器升滿後改選「插槽 +1」或 ◆${CFG.ARMORY_BONUS.credits}＋HP ${CFG.ARMORY_BONUS.hp}。` },
  boss:   { label: '旗艦', icon: '♛', color: '#ff4d6d', desc: () => '守關旗艦（戰場可能有行星、小行星帶、彗星；旗艦的子彈會削掉行星、打碎小行星）。勝利後插槽 +1、零件格 +1、◆50，可以裝上這隻旗艦的專屬模組；進入下一關時修復 30% HP。' },
};

// 生成後檢查保底條件，不符合就重新生成（保底規則之間可能互相覆蓋）
//   精英、黑洞、補給站至少各一；軍械台整張圖剛好一個（第 2～5 層）；
//   每個精英的下一步至少有一條路通維修站；黑洞之後的路上走得到維修站；
//   任何一條路線最多經過一個黑洞；維修站、補給站都不會連著出現（沒有「維修站 → 維修站」「補給站 → 補給站」）；
//   每條路線到旗艦前至少打 3 場（戰鬥或精英）；旗艦前一層至少一個補給站、一個維修站；
//   同一個分岔的選項不重複：不會兩個都是同一種重要房間，也不會兩個選項一模一樣（同種、接到同樣的下一步）
const NEED_REPAIR_AFTER = ['elite'];  // 下一步就要有維修站的節點
// 從 n 往後走得到的所有節點（不含 n 自己）
function descendants(n, byId) {
  const seen = new Set(), stack = [...n.next];
  while (stack.length) {
    const id = stack.pop();
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...byId(id).next);
  }
  return [...seen].map(byId);
}
function mapOk(m) {
  const has = (from, to, type) => m.slice(from, to).flat().some(n => n.type === type);
  const all = m.flat(), byId = id => all.find(n => n.id === id);
  const armories = all.filter(n => n.type === 'armory'), holes = all.filter(n => n.type === 'blackhole');
  const pre = m[m.length - 2], memo = {};
  const minFights = n => n.type === 'boss' ? 0 : memo[n.id] != null ? memo[n.id]
    : (memo[n.id] = (['combat', 'elite'].includes(n.type) ? 1 : 0) + Math.min(...n.next.map(id => minFights(byId(id)))));
  return has(2, 4, 'elite') && has(2, 4, 'blackhole') && has(1, 5, 'shop') && has(1, 5, 'workshop') &&
    pre.some(n => n.type === 'shop') && pre.some(n => n.type === 'repair') && m[0].every(n => minFights(n) >= 3) &&
    armories.length === 1 && armories[0].L >= 1 && armories[0].L <= 4 &&
    all.filter(n => NEED_REPAIR_AFTER.includes(n.type)).every(n => n.next.some(id => byId(id).type === 'repair')) &&
    holes.every(h => descendants(h, byId).some(d => d.type === 'repair')) &&
    holes.every(h => !descendants(h, byId).some(d => d.type === 'blackhole')) &&
    !all.some(n => ['repair', 'shop'].includes(n.type) && n.next.some(id => byId(id).type === n.type)) &&
    !all.some(n => branchDup(n.next.map(byId))) && !branchDup(m[0]);
}
// 一組分岔選項裡有沒有重複：兩個同種的重要房間（戰鬥以外），或兩個選項一模一樣（同種、下一步也一樣）
function branchDup(opts) {
  for (let i = 0; i < opts.length; i++) for (let j = i + 1; j < opts.length; j++) {
    const a = opts[i], b = opts[j];
    if (a.type === b.type && (a.type !== 'combat' || a.next.join() === b.next.join())) return true;
  }
  return false;
}
// 修補：分岔裡重複的重要房間，多出來的改成戰鬥（保底條件之後由 mapOk 再檢查，不行才整張重來）
function fixBranches(m) {
  const all = m.flat(), byId = id => all.find(n => n.id === id);
  for (const opts of [m[0], ...all.map(n => n.next.map(byId))]) {
    const seen = new Set();
    for (const o of opts) { if (o.type !== 'combat' && o.type !== 'boss' && seen.has(o.type)) o.type = 'combat'; seen.add(o.type); }
  }
}
function genMap() {
  let m;
  for (let i = 0; i < 1000; i++) {  // 保底規則多，單次生成符合的機率低（約 2%），多試幾次
    m = genMapOnce();
    fixBranches(m);
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
    nd.type = r < 0.2 ? 'elite' : r < 0.3 ? 'shop' : r < 0.38 ? 'repair' : r < 0.48 ? 'blackhole' : r < 0.58 ? 'workshop' : 'combat';
    // 精英、黑洞只放第 3～4 層（精英後面要接維修站；黑洞之後的路上要有維修站）
    if (['elite', 'blackhole'].includes(nd.type) && L > 3) nd.type = 'combat';
  }
  if (Math.random() < 0.5) pick(layers[1]).type = 'shop';
  // 保底：優先把「戰鬥」節點改成缺少的類型
  const ensure = (nodes, type) => {
    if (nodes.some(n => n.type === type)) return;
    const cands = nodes.filter(n => n.type === 'combat');
    pick(cands.length ? cands : nodes).type = type;
  };
  ensure(layers.slice(2, 4).flat(), 'elite');
  ensure(layers.slice(2, 4).flat(), 'blackhole');
  ensure(layers.slice(1, 5).flat(), 'shop');
  ensure(layers.slice(1, 5).flat(), 'workshop');
  // 軍械台整張圖只有一個，隨機放在第 2～5 層的戰鬥節點上
  const armCands = layers.slice(1, 5).flat().filter(n => n.type === 'combat');
  if (armCands.length) pick(armCands).type = 'armory';
  layers[LAYERS - 2].forEach(nd => nd.type = 'combat');  // 王關前一層：先全部當戰鬥，最後再放一個補給站、一個維修站
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
  const byId = id => layers.flat().find(n => n.id === id);
  // 一條路線最多一個黑洞：黑洞後面走得到的其他黑洞改成戰鬥
  for (const h of layers.flat().filter(n => n.type === 'blackhole'))
    if (h.type === 'blackhole') for (const d of descendants(h, byId)) if (d.type === 'blackhole') d.type = 'combat';
  // 黑洞之後：路上走得到維修站就好（旗艦前一層之後會放一個；走不到的話，把後面一個戰鬥節點改成維修站）
  for (const h of layers.flat().filter(n => n.type === 'blackhole')) {
    const ds = descendants(h, byId);
    if (ds.some(d => d.type === 'repair' || d.L === LAYERS - 2)) continue;
    const c = ds.find(d => d.type === 'combat');
    if (c) c.type = 'repair';
  }
  // 精英之後：下一步至少有一條路通維修站（優先把戰鬥節點改掉，其次補給站）
  for (const e of layers.flat().filter(n => NEED_REPAIR_AFTER.includes(n.type))) {
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
  const needed = n => layers.flat().some(p => NEED_REPAIR_AFTER.includes(p.type) && p.next.includes(n.id));
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
  // 王關前一層：一個補給站、一個維修站（挑前一層沒有同類的位置，避免連著出現），其他是戰鬥
  const parentsOf = n => layers.flat().filter(p => p.next.includes(n.id));
  const pre = [...layers[LAYERS - 2]].sort(() => Math.random() - 0.5);
  for (const type of ['shop', 'repair']) {
    const c = pre.find(n => n.type === 'combat' && !parentsOf(n).some(p => p.type === type));
    if (c) c.type = type;
  }
  // 每條路線至少 3 場戰鬥：找出戰鬥最少的那條路，把路上可以改的節點改成戰鬥
  //   （改裝廠、補給站、黑洞要留至少一個；精英後面必要的維修站不改）
  const count = (type, from, to) => layers.slice(from, to).flat().filter(n => n.type === type).length;
  const spare = x => x.type === 'workshop' ? count('workshop', 1, 5) > 1 : x.type === 'shop' ? count('shop', 1, 5) > 1
    : x.type === 'blackhole' ? count('blackhole', 2, 4) > 1 : x.type === 'repair' ? !needed(x) : false;
  for (let tries = 0; tries < 6; tries++) {
    const memo = {};
    const mf = n => n.type === 'boss' ? 0 : memo[n.id] != null ? memo[n.id]
      : (memo[n.id] = (['combat', 'elite'].includes(n.type) ? 1 : 0) + Math.min(...n.next.map(id => mf(byId(id)))));
    const low = (a, b) => mf(a) <= mf(b) ? a : b;
    let n = layers[0].reduce(low);
    if (mf(n) >= 3) break;
    const path = [];
    while (n.type !== 'boss') { path.push(n); n = n.next.map(byId).reduce(low); }
    const c = path.find(x => x.L >= 1 && x.L <= LAYERS - 3 && spare(x));
    if (!c) break;
    c.type = 'combat';
  }
  return layers;
}
