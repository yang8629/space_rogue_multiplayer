// 星環電路 整局模擬的電腦（做選擇）
//   在遊戲的全域範圍裡執行（runsim／botsim／qasim 用 vm.runInThisContext，coopsim 每份遊戲各一份 vm context），由 bot/load.js 載入
//   用到遊戲的全域：Game（= G）、CHIPS（= CH）、CFG、Input、Arena、Objects、PARTS、WEAPONS、EVENTS、socketsOf、chipId、hasLv、mergedChip、pick、randInt

// 倉庫裡的晶片填進電路的空格（中等玩家：有空格就裝上）
// 晶片分數：路線價值表（botsim --routeval）有就用；沒有就試裝（bot/value.js）
//   （舊的晶片價值表 chipvalue_base.json 10-24 拿掉：量的是改版前的武器和晶片；晶片接起來的效果改用接線表 chiplink.js 看）
const SCORE_FIX = { trigger: 1.0, scrap: 0 };
const nearKey = (obj, L) => Object.keys(obj).map(Number).reduce((a, b) => Math.abs(b - L) < Math.abs(a - L) ? b : a);
// 換電路格：拿這層零件多出來的電路格價值
//   一格的價值 = 倉庫裡最好的、還沒裝上的晶片分數（裝得上去）；倉庫沒有 → 0.5（要等之後再拿到晶片才用得到）；電路本來就有空格 → 0（用不到）
//   這層零件湊滿一格（第 k、2k… 個機體強化）→ 整格的價值；沒湊滿 → 1/k
function slotGain() {
  const C = CFG, k = C.MECH_SLOT_EVERY;
  if (!k || G.chain.length >= C.MAX_SLOTS || G.chain.includes(null)) return 0;
  const inv = G.inventory.filter(x => x && CH[x] && !CH[x].comp && !CH[x].locked).map(chipScore);
  const slot = inv.length ? Math.max(...inv) : 0.5;
  return ((G.mechN || 0) + 1) % k === 0 ? slot : slot / k;
}
function chipScore(id) {
  if (!id) return -1;
  // 零件：試裝後整套配裝的分數變幾倍（bot/value.js；2026-10-09 以前一律 1.05）；機體強化換電路格開著時（CFG.MECH_SLOT_EVERY = k）再加上「多一格電路」的價值 × 這層零件佔的份量
  if (!CH[id]) {
    const part = String(id).startsWith('part:') && PARTS[String(id).slice(5)];  // 三選一的零件代號是 part:零件
    return part ? partScore(String(id).slice(5)) + slotGain() : 1.05;
  }
  const b = bOf(id), t = CH[id].type;
  const rv = rvItem(b);  // 路線價值表（有就優先用；botsim --routeval）
  let v = rv != null ? rv : SCORE_FIX[b] != null ? SCORE_FIX[b] : (t === 'singularity' || t === 'composite' ? 1.3 : chipTrialGain(id));  // 路線價值表沒有的：試裝（bot/value.js）
  {  // 熟練玩家：玩法晶片疊在同一批子彈上（每顆子彈同時養好幾個晶片、效果一起觸發）
    const play = new Set(G.chain.slice(1).filter(x => x && CH[x] && hasLv(x) && bOf(x) !== b).map(bOf)).size;
    if (hasLv(b)) v *= Math.min(1.5, 1 + 0.1 * play);  // 每多一個玩法晶片 +10%，最多 +50%
  }
  // 插座的價值：每個插座當 6%（以前用兩兩組合表算，10-09 那張表拿掉後一直是 6%）
  const sk = typeof socketsOf === 'function' ? socketsOf(id) : 0, g = 0.06;
  // 組件：電路上（武器或晶片）沒有空插座的話，拿了也插不上
  const freeSock = CH[id].comp && typeof socketsOf === 'function' ? G.chain.some((c, i) => c && ((G.socks || [])[i] || []).length < socketsOf(c)) : true;
  return v * (1 + g * sk) * (freeSock ? 1 : 0.3);
}
// 插座（10-22 插件往下傳）：插件影響插的那格和線上後面的所有晶片 → 先插飛船晶片（作用在飛船所有攻擊＋整條線），再照線的順序往後插
//   傷害、大小排前面（每一格都吃），元素在後；沒有插座數的宿主（模擬直接給的晶片）當成 2 個
const COMP_ORDER = ['amp', 'bigshot', 'shock', 'blast', 'ignite', 'frost', 'shred'];
// 空格苦行（散彈升級，2026-10-09）：每個空格傷害 +50% → 一顆晶片要強過它佔掉的空格才裝；最弱的先拿下來放回倉庫
//   拿掉一顆多一個空格，傷害變 (1 + per × (空格 + 1)) ÷ (1 + per × 空格) 倍；晶片分數比這個低就拿掉
function asceticTrim() {
  const A = G.wp && G.wp.ascetic;
  if (!A) return;
  for (let guard = 0; guard < 8; guard++) {
    const cur = G.chain.map((id, i) => [id, i]).filter(([id, i]) => i > 0 && id && !CH[id].locked && !CH[id].comp);
    const j = G.inventory.indexOf(null);
    if (!cur.length || j < 0) return;
    const empty = G.chain.reduce((n, c, i) => n + (i > 0 && !c ? 1 : 0), 0), need = (1 + A.per * (empty + 1)) / (1 + A.per * empty);
    const [id, i] = cur.sort((a, b) => chipScore(a[0]) - chipScore(b[0]))[0];
    if (chipScore(id) >= need) return;
    G.inventory[j] = id; G.chain[i] = null;  // 插座上的組件由 sortChain 收回去重插
  }
}
// 供電（2026-10-10）：電路從左往右供電，電不夠的那一個和右邊全部沒作用 → 插好組件之後（sortChain 最後）還有沒電的，
//   就把分數最低的一個（電路上的晶片連它的組件、或插座上的一個組件）拿下來放回倉庫，直到全部有電；倉庫放不下就停
//   （之後容量變大，equip／sortChain 會再裝回去）
function capTrim() {
  if (!G.energyCap || globalThis.__NOCAPTRIM) return;  // 自動對戰模擬量價值時不拿（配裝照它給的打）
  for (let guard = 0; guard < 12; guard++) {
    G.recalc();
    if (!G.stats.off) return;
    const items = [];
    G.chain.forEach((id, i) => {
      if (i > 0 && id && !CH[id].locked && !CH[id].comp) items.push({ id, i, k: -1 });
      ((G.socks || [])[i] || []).forEach((c, k) => items.push({ id: c, i, k }));
    });
    const free = G.inventory.filter(x => !x).length;
    const it = items.filter(t => free >= (t.k < 0 ? 1 + ((G.socks || [])[t.i] || []).length : 1)).sort((a, b) => chipScore(a.id) - chipScore(b.id))[0];
    if (!it) return;
    const put = id => { G.inventory[G.inventory.indexOf(null)] = id; };
    if (it.k >= 0) { put(it.id); G.socks[it.i].splice(it.k, 1); }
    else { put(it.id); for (const c of G.socks[it.i] || []) put(c); G.socks[it.i] = []; G.chain[it.i] = null; }
  }
}
function sortChain() {
  asceticTrim();
  // 電路上的晶片＋所有插座上的插件＋倉庫裡的插件（模擬直接給的電路可能把插件寫在晶片後面，一起收進來）
  const invC = G.inventory.map((id, j) => id && CH[id].comp ? j : -1).filter(j => j >= 0);
  const ids = [...G.chain.slice(1).filter(Boolean), ...(G.socks || []).flat(), ...invC.map(j => G.inventory[j])];
  for (const j of invC) G.inventory[j] = null;
  const comps = ids.filter(id => CH[id].comp).map(bOf).sort((a, b) => COMP_ORDER.indexOf(a) - COMP_ORDER.indexOf(b));
  const hosts = ids.filter(id => !CH[id].comp).map(id => socketsOf(id) || globalThis.__KEEP0 === bOf(id) ? id : chipId(bOf(id), 2, lvOf(id), rareOf(id)));
  const S = [[], ...hosts.map(() => [])], cap = [socketsOf('weapon'), ...hosts.map(socketsOf)];
  for (let i = 0; i < S.length && comps.length; i++) while (S[i].length < cap[i] && comps.length) S[i].push(comps.shift());
  const len = Math.max(G.chain.length, hosts.length + 1);
  G.chain = [G.chain[0], ...hosts]; G.socks = S;
  while (G.chain.length < len) { G.chain.push(null); G.socks.push([]); }
  for (const c of comps) { const j = G.inventory.indexOf(null); if (j >= 0) G.inventory[j] = c; }  // 插不下的回倉庫
  capTrim();
}
// 同種晶片能合成就合成（中等玩家：省格子）；合成後留在電路上那格，插件在 sortChain 重新分配
// ponytail: 一律合成，不比較分開放哪個強；要比再拿晶片價值表算
function mergeAll() {
  if (typeof mergedChip === 'undefined') return;  // 舊版（GAME_DIR 指到舊的 worktree）沒有合成
  const at = [...G.chain.map((_, i) => [G.chain, i]), ...G.inventory.map((_, j) => [G.inventory, j])];
  for (const [a, i] of at) for (const [b, k] of at) {
    if ((a === b && i === k) || !a[i] || !b[k] || CH[a[i]].locked) continue;
    const m = mergedChip(a[i], b[k]);
    if (!m) continue;
    if (a === G.chain && b !== G.chain) { a[i] = m; b[k] = null; } else { b[k] = m; a[i] = null; }
  }
}
function equip() {
  mergeAll();
  for (let i = 1; i < G.chain.length; i++) {
    if (G.chain[i]) continue;
    const j = G.inventory.findIndex(id => id && !CH[id].locked && !CH[id].comp);  // 電路格只放晶片（組件在 sortChain 插進插座）
    if (j < 0) break;
    G.chain[i] = G.inventory[j]; G.inventory[j] = null;
  }
  for (let guard = 0; guard < 6; guard++) {  // 倉庫裡比電路上最弱的強 10% 以上：換掉
    const inv = G.inventory.map((id, j) => [id, j]).filter(([id]) => id && !CH[id].locked && !CH[id].comp).sort((a, b) => chipScore(b[0]) - chipScore(a[0]))[0];
    const cur = G.chain.map((id, i) => [id, i]).filter(([id, i]) => i > 0 && id && !CH[id].locked).sort((a, b) => chipScore(a[0]) - chipScore(b[0]))[0];
    if (!inv || !cur || chipScore(inv[0]) <= chipScore(cur[0]) * 1.1) break;
    G.chain[cur[1]] = inv[0]; G.inventory[inv[1]] = cur[0];
  }
  sortChain();
  G.recalc();
}
// 選獎勵：挑分數最高的（同種晶片在 equip 合成）
// 刷新三選一（2026-10-09）：最好的選項沒讓配裝變好（不到 1.03 倍）就花晶體刷新；刷完至少留 ◆40（照星區漲）補血，每次三選一最多刷 2 次
//   「變好幾倍」：零件 = 試裝分數的倍數；晶片（電路有空格）= 晶片分數；晶片（電路滿了）= 跟電路上最弱那顆比；組件 = 晶片分數
function rewardGain(id) {
  if (!CH[id]) return chipScore(id);
  if (CH[id].comp || G.chain.includes(null)) return chipScore(id);
  const cur = G.chain.filter((x, i) => i > 0 && x && !CH[x].locked).map(chipScore);
  return cur.length ? chipScore(id) / Math.max(1e-9, Math.min(...cur)) : chipScore(id);
}
function maybeReroll(R) {
  if (globalThis.__REPLAY) return;
  for (let n = 0; n < 2; n++) {
    const ok = R.options.filter(id => G.canAcquire(id));
    if (G.mergeTarget && ok.some(id => G.mergeTarget(id))) return;
    const best = ok.length ? Math.max(...ok.map(rewardGain)) : 0;
    if (best >= 1.03 || G.credits < R.reroll + G.shopPrice(40)) return;
    const before = G.credits;
    G.rerollReward();
    if (G.credits === before) return;  // 沒刷成功
    if (G.runStats) G.runStats.rerolls = (G.runStats.rerolls || 0) + 1;
  }
}
function pickReward(R) {
  if (globalThis.__REPLAY) return null;  // 照紀錄拿東西：不自己挑（見 applyReplay）
  const ok = R.options.filter(id => G.canAcquire(id)), merge = G.mergeTarget && ok.find(id => G.mergeTarget(id));  // 舊版：能合成升級的優先
  if (merge) return merge;
  if (G.chain.includes(null)) {  // 熟練玩家：電路還有空格就拿晶片（不拿零件）
    const c = ok.filter(id => CH[id]);
    if (c.length) return c.reduce((a, b) => chipScore(b) > chipScore(a) ? b : a);
  }
  return ok.length ? ok.reduce((a, b) => rewardScore(b) > rewardScore(a) ? b : a) : null;
}
// 三選一的分數：電路滿了（沒有空格）時，新的電路晶片裝不上去，只值「換掉電路上最弱那顆的進步」＋ 1/4 的原分數（之後有格子、或拿來換的彈性）
//   2026-10-05 以前直接用晶片分數：電路滿了還一直拿晶片丟倉庫，倉庫有晶片在等位置時也不拿零件換格子
function rewardScore(id) {
  const s = chipScore(id);
  if (!CH[id] || CH[id].comp || G.chain.includes(null)) return s;
  const cur = G.chain.filter((x, i) => i > 0 && x && !CH[x].locked).map(chipScore);
  return cur.length ? Math.max(0, s - Math.min(...cur)) + 0.25 * s : s;
}
// 旗艦二選一：倉庫裡有放不進電路的晶片（電路沒有空格）→ 電路插槽；沒有 → 零件格（多一格電路也沒東西放）
//   電路已經到上限時遊戲直接給零件格
//   2026-10-09 改成比數字：電路格 = 倉庫裡等位置最好的晶片分數（沒有 → 1.02，之後拿到晶片才用得到）；
//   零件格 = 零件格滿了時最好的零件「下一層」分數 × 0.8（之後還要拿到零件），沒滿 → 1（現在用不到）
function slotValues() {
  const wait = G.chain.includes(null) ? [] : G.inventory.filter(x => x && CH[x] && !CH[x].comp && !CH[x].locked).map(chipScore);
  const chain = G.chain.length >= CFG.MAX_SLOTS ? 0 : wait.length ? Math.max(...wait) : 1.02;
  const part = partsUsed(G.parts) >= G.partSlots ? 0.8 * Math.max(...PART_IDS.map(partScore)) : 1;
  return { chain, part };
}
function bossPick() {
  const V = G.victory; if (!V || V.pick) return;
  const S = slotValues();
  G.pickBossSlot(S.chain >= S.part ? 'chain' : 'part');
}
// 補給站：血少補血；電路滿了買插槽；晶片照分數高的先買（有空格、或比電路上最弱的強才買）
function shopBuy() {
  const p = G.player;
  if (p.hp < p.maxHp * 0.7) G.shopHeal();
  if (globalThis.__REPLAY) return;  // 照紀錄拿東西：補給站只補血
  if (!G.chain.includes(null) && G.chain.length < CFG.MAX_SLOTS) G.expandSlot('shop');
  const weakest = () => Math.min(...G.chain.slice(1).filter(Boolean).map(chipScore), Infinity);
  G.shop.items.map((it, i) => [it, i]).filter(([it]) => !it.sold).sort((a, b) => chipScore(b[0].id) - chipScore(a[0].id)).forEach(([it, i]) => {
    if (G.credits >= it.price && (G.chain.includes(null) || chipScore(it.id) > weakest() * 1.1)) G.buy(i);
  });
}
const closeEditor = () => { if (G.state === 'editor') G.toggleEditor(); };

// 航圖選路：血少先找維修站；武器還沒升滿找軍械台；其他照喜好加一點亂數
//   往後看整條路（2026-10-09）：每個選項 = 這個節點 ＋ 從它往後走最好的一條路的總分（航圖是單向的，記住算過的節點）；亂數只加在眼前這一步
//   以前只看下一步：每張航圖只有 1 個軍械台，第一步選的分岔走不到就錯過，20 局裡 10 局一次都沒升級武器
//   軍械台（武器還沒升滿）12 分：比一路上其他房間的差距大，走得到就會規劃過去
function chooseNode() {
  const p = G.player, hp = p.hp / p.maxHp, opts = G.reachable();
  const base = n => ({
    repair: hp < 0.6 ? 10 : 1, shop: G.credits >= 60 ? 5 : 2, combat: n.hoard ? 8 : 4, elite: hp > 0.6 ? 5 : 0.5, event: 5,
    armory: G.weaponStage() < 2 ? 12 : 1, workshop: 4, blackhole: 0.3, boss: 9 })[n.type];
  const memo = new Map();
  const future = n => {
    if (memo.has(n.id)) return memo.get(n.id);
    const nx = n.next.map(id => G.nodeById(id)).filter(Boolean);
    const v = nx.length ? Math.max(...nx.map(m => base(m) + future(m))) : 0;
    memo.set(n.id, v);
    return v;
  };
  const total = new Map(opts.map(n => [n, base(n) + future(n) + Math.random() * 2]));
  return opts.reduce((a, b) => total.get(b) > total.get(a) ? b : a);
}


// ？事件選哪個選項（EVENTS 的 opts 順序；最後一個是離開）：血夠才冒險
//   回傳選項順序（第一個選得了的就選）
const EV_PICK = {
  wreck: hp => hp > 0.75 ? [1, 0, 2] : hp > 0.5 ? [0, 2] : [2],  // 血很多才拆反應爐
  market: hp => hp > 0.5 ? [0, 1, 2, 3] : [1, 2, 3],
  sos: hp => hp > 0.7 ? [0] : hp > 0.5 ? [1] : [2],
  ward: hp => hp < 0.5 ? [1] : [0],
  chart: hp => hp > 0.6 ? [1, 0] : [0],
};
function eventPick() {
  if (G.ev.res) { G.evNext(); return; }
  const E = EVENTS[G.ev.id], order = [...EV_PICK[G.ev.id](G.player.hp / G.player.maxHp), ...E.opts.keys()];
  for (const i of order) { G.evChoose(i); if (G.state !== 'event' || (G.ev && G.ev.res)) return; }
}

// 非戰鬥畫面（單人、雙人共用）：獎勵三選一、精英獎勵、補給站、改裝廠、軍械台、維修站／黑洞、編輯器；
//   旗艦勝利畫面只做二選一（前往下一星區由呼叫的人決定）。回傳 true = 有處理
function handle() {
  const st = G.state;
  if (st === 'reward') {
    const R = G.reward;
    if (R.kind === 'elite') {
      // 精英獎勵：跟一般戰鬥同一個三選一，另外多一張電路擴充：電路格的分數（slotValues）比最好的選項高就拿電路擴充
      maybeReroll(R);
      const id = pickReward(R);
      if (R.slot && (!id || slotValues().chain > rewardGain(id))) G.expandSlot('reward');
      else { G.takeReward(id); closeEditor(); }
    } else {
      maybeReroll(R);
      G.takeReward(pickReward(R)); closeEditor();
    }
    equip();
  } else if (st === 'shop') {
    shopBuy(); equip(); G.showMap();
  } else if (st === 'workshop') {
    workshop(); G.showMap();  // 改裝廠：試裝挑最好的；零件格滿了看值不值得付錢換（bot/value.js）
  } else if (st === 'armory') {
    const W = WEAPONS[G.weapon.id];
    if (G.weaponStage() < 2) G.upgradeWeapon(pickUpgrade());  // 試裝挑最好的路線（第一段往後看一步）（bot/value.js；以前隨機）
    else G.armoryBonus();
  } else if (st === 'event') eventPick();
  else if (st === 'blackhole' || st === 'repair') G.showMap();
  else if (st === 'victory') bossPick();
  else if (st === 'editor') closeEditor();
  else return false;
  return true;
}
