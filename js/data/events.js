// 星環電路 多人版 · events.js：？事件節點的事件表 EVENTS（數字在 CFG.EVENT）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 每個事件：name、icon、color、text(G, node) 情境說明、opts 選項
//   選項：lab 短名（遊玩紀錄）、txt(G, node) 按鈕文字、can(G, node) 能不能選（省略 = 可以）、
//         go(G, node) 選了之後做什麼，回傳：
//           true = 已經打開下一個畫面（三選一）；文字 = 回到航圖、顯示這段提示；
//           { msg, color, then } = 賭運氣的結果：先在事件畫面揭曉（msg 大字），按「繼續」才跑 then(G)（回傳 true = 打開了三選一，否則回航圖）
//   target(node, byId)：（可省略）產生航圖時決定的參數，存在 node.evArg、跟著航圖同步；回傳 null = 這個節點不能放這個事件
// 雙人：每個人各自選、各自賭；扣血、晶體、三選一、護殼都是自己的。
//   下一場變難（求救訊號、星圖情報被發現）和寶藏星域是全隊的：誰觸發都告訴所有人（Game.addSos、Game.markHoard）
//   team：全隊投票的事件（多人時選項＝投票，到齊或時間到由房主照票數抽籤，結果全隊一樣；Game.evResolve、Net.evVote）
const pctTxt = v => `${Math.round(v * 100)}%`;
const leaveOpt = (lab, msg) => ({ lab, txt: () => lab, go: () => msg });
const chanceTxt = v => `🎲 ${pctTxt(v)}`;
// 下一場變難的說明（CFG.EVENT.sos 的一種）：敵人 +x%、打贏的獎勵
const sosTxt = k => { const S = CFG.EVENT.sos[k];
  return `下一場戰鬥（一般戰鬥或精英戰）敵人 +${pctTxt(S.mul - 1)}${S.bonus ? `，打贏後多 ${CFG.BONUS[S.bonus].again} 次三選一` : ''}${S.again ? `，打贏後多一次三選一` : ''}`; };
const hoardIds = node => String(node.evArg || '').split('|').filter(Boolean);  // 星圖情報可以標的寶藏星域（第一個 = 解讀座標標的那個）
const EVENTS = {
  wreck: {
    name: '漂流殘骸', icon: '⚙', color: '#8fa3d9',
    text: () => '一艘被擊毀的運輸艦在漂流，貨艙還封著。反應爐很不穩定，靠近一定會被波及；要是敢拆開反應爐，裡面的核心晶片可值錢了。',
    opts: [
      { lab: '搜刮', txt: G => `搜刮貨艙：HP −${G.evHp(CFG.EVENT.wreck.hp)}（最大 HP 的 ${pctTxt(CFG.EVENT.wreck.hp)}，最少留 1 HP），晶片三選一`,
        go: G => { G.evHurt(CFG.EVENT.wreck.hp); G.openReward('event', { note: '漂流殘骸的貨艙' }); return true; } },
      { lab: '拆反應爐', txt: G => { const C = CFG.EVENT.wreck.core;
          return `${chanceTxt(C.chance)} 強行拆反應爐：成功 → 三選一 ${1 + C.again} 次；失敗 → 爆炸 HP −${G.evHp(C.hp)}（最大 HP 的 ${pctTxt(C.hp)}，最少留 1 HP），什麼都沒拿到`; },
        go: G => { const C = CFG.EVENT.wreck.core;
          if (Math.random() < C.chance) return { msg: '✦ 拆到了！完好的核心晶片', color: '#ffd166', then: G => { G.openReward('event', { again: C.again, note: '反應爐的核心晶片' }); return true; } };
          const hp = G.evHurt(C.hp);
          return { msg: `💥 反應爐爆炸！HP −${hp}`, color: '#ff4d6d' }; } },
      leaveOpt('不冒險，離開', '你沒有靠近殘骸'),
    ],
  },
  market: {
    name: '黑市商人', icon: '⚖', color: '#ff9f1c',
    text: () => '一艘沒有識別碼的貨船靠過來：「改造晶片、走私零件、還有幾個連我都不知道裝了什麼的包裹。改造晶片要拆掉你一點裝甲，其他的付錢就行。」',
    opts: [
      { lab: '改造晶片', txt: G => `改造晶片：◆${G.shopPrice(CFG.EVENT.market.price)}，這一局最大 HP −${pctTxt(CFG.EVENT.market.hpCut)}；三選一 ${1 + CFG.EVENT.market.again} 次`,
        can: G => G.credits >= G.shopPrice(CFG.EVENT.market.price),
        go: G => G.pay(G.shopPrice(CFG.EVENT.market.price), () => { G.boons.hp++; G.recalc(); G.openReward('event', { again: CFG.EVENT.market.again, note: '黑市的改造晶片' }); }) },
      { lab: '走私零件', txt: G => `走私零件：◆${G.shopPrice(CFG.EVENT.market.part)}，零件三選一（佔 1 個零件格）${partsUsed(G.parts) < G.partSlots ? '' : '——零件格已滿'}`,
        can: G => G.credits >= G.shopPrice(CFG.EVENT.market.part) && partsUsed(G.parts) < G.partSlots,
        go: G => G.pay(G.shopPrice(CFG.EVENT.market.part), () => { G.openReward('eventPart', { note: '黑市的走私零件' }); }) },
      { lab: '神祕包裹', txt: G => { const B = CFG.EVENT.market.box;
          return `🎲 神祕包裹：◆${G.shopPrice(B.price)}，${pctTxt(B.chip)} 直接拿到一個晶片、${pctTxt(1 - B.chip)} 空包${G.inventory.includes(null) ? '' : '——倉庫已滿'}`; },
        can: G => G.credits >= G.shopPrice(CFG.EVENT.market.box.price) && G.inventory.includes(null),
        go: G => { const B = CFG.EVENT.market.box;
          G.pay(G.shopPrice(B.price), () => {});
          const pool = G.chipOffers();
          if (Math.random() >= B.chip || !pool.length) return { msg: '📦 空包……只有一堆填充泡棉', color: '#8fa3d9' };
          const id = newChip(pick(pool));
          G.acquire(id);
          return { msg: `📦 ${CHIPS[id].name}（放進倉庫）`, color: '#cfe8ff' }; } },
      leaveOpt('不交易，離開', '黑市商人消失在星塵裡'),
    ],
  },
  sos: {  // 全隊投票：一起變難、一起拿同一種獎勵（2026-10-19 使用者：兩邊的選擇結果要一起）
    name: '求救訊號', icon: '📡', color: '#ff6b6b', team: true,
    text: () => '一支被圍攻的運輸船隊在求救。趕過去的話，下一場戰鬥會撞上追兵；全力救下整支船隊，他們會拿最好的貨答謝，只護送幾艘出去就輕鬆一點。',
    opts: [
      { lab: '全力救援', txt: () => `全力救援：${sosTxt('full')}`, go: G => { G.addSos('full'); return '已回應求救訊號：下一場戰鬥敵人變多'; } },
      { lab: '只護送', txt: () => `只護送出去：${sosTxt('escort')}`, go: G => { G.addSos('escort'); return '已回應求救訊號：下一場戰鬥敵人變多'; } },
      leaveOpt('不回應', '訊號漸漸斷了'),
    ],
  },
  ward: {
    name: '終焉護殼', icon: '⛨', color: '#ffd166',
    text: () => '殘骸裡有一具還能運作的終焉護殼：能撐住一次致命的攻擊，但它會干擾機體的護甲。也可以拆下它的能量核心，馬上修好船。',
    opts: [
      { lab: '裝上', txt: () => `裝上：這一局有一次受到致命傷害時留 1 HP、無敵 ${CFG.EVENT.ward.iframe} 秒；這一局受到的傷害 +${pctTxt(CFG.EVENT.ward.taken)}`,
        go: G => { G.boons.ward++; G.boons.taken++; G.recalc(); return '裝上終焉護殼：這一局可以免死一次'; } },
      { lab: '拆下核心', txt: G => `拆下核心：馬上回復 HP +${G.evHp(CFG.EVENT.ward.heal)}（最大 HP 的 ${pctTxt(CFG.EVENT.ward.heal)}）`,
        go: G => { const p = G.player, hp = G.evHp(CFG.EVENT.ward.heal); p.hp = Math.min(p.maxHp, p.hp + hp); return `拆下核心：HP +${hp}`; } },
      leaveOpt('不碰它，離開', '你留下了護殼'),
    ],
  },
  chart: {
    name: '星圖情報', icon: '✦', color: '#ffd166',
    // 標哪幾格：從這裡走得到的一般戰鬥挑 2 個（產生航圖時就決定，雙人兩邊一樣）；不到 2 個就不能放
    target: (node, byId) => { const c = descendants(node, byId).filter(d => d.type === 'combat'); return c.length >= 2 ? pickN(c, 2).map(n => n.id).join('|') : null; },
    text: () => '截獲一段走私者的加密通訊，提到前方有寶藏無人機的巢：那場戰鬥<b>每一區都有一架寶藏無人機</b>（每打掉一架，三選一多保證 1 格稀有，最多 2 格）。解讀得出一個座標；強行破解整段可能挖出兩個，但會被對方發現。',
    opts: [
      { lab: '解讀座標', txt: (G, node) => `解讀座標：在航圖上標出 1 個寶藏星域（第 ${G.nodeById(hoardIds(node)[0]).L + 1} 層）`,
        go: (G, node) => { G.markHoard(hoardIds(node).slice(0, 1)); return '已在航圖上標出寶藏星域（金色 ✦）'; } },
      { lab: '強行破解', txt: () => `${chanceTxt(CFG.EVENT.chart.chance)} 強行破解：成功 → 標出 2 個寶藏星域；失敗 → 被發現，${sosTxt('caught')}，什麼都沒標到`,
        go: (G, node) => {
          if (Math.random() < CFG.EVENT.chart.chance) { G.markHoard(hoardIds(node)); return { msg: '✦ 破解成功！標出 2 個寶藏星域', color: '#ffd166' }; }
          G.addSos('caught');
          return { msg: `⚠ 被發現了！下一場敵人 +${pctTxt(CFG.EVENT.sos.caught.mul - 1)}`, color: '#ff4d6d' }; } },
    ],
  },
};
const EVENT_IDS = Object.keys(EVENTS);
const HOARD_TXT = '星圖情報標出的一般戰鬥：每一區都有一架寶藏無人機，每打掉一架，三選一多保證 1 格稀有晶片（最多 2 格：一定留一格組件）。';  // 寶藏星域的說明（航圖）
// 這一局的事件效果（Game.boons）：黑市 hp、終焉護殼 taken 各拿了幾次，ward 還剩幾次免死；o = 對方傳來的（雙人同步，檢查格式）
const cleanBoons = (o = {}) => Object.fromEntries(['hp', 'taken', 'ward'].map(k => [k, clamp(Math.floor(num(o && o[k])), 0, 9)]));
// 產生航圖時：每個事件節點抽一種事件（同一張圖盡量不重複；需要參數的事件找不到目標就換一種）
function assignEvents(m) {
  const all = m.flat(), byId = id => all.find(n => n.id === id);
  let pool = [];
  for (const n of all.filter(n => n.type === 'event').sort((a, b) => a.L - b.L)) {
    if (!pool.length) pool = [...EVENT_IDS].sort(() => Math.random() - 0.5);
    const args = pool.map(k => EVENTS[k].target ? EVENTS[k].target(n, byId) : null);
    let i = pool.findIndex((k, j) => !EVENTS[k].target || args[j]);
    if (i < 0) { pool = EVENT_IDS.filter(k => !EVENTS[k].target); i = 0; args.length = 0; }  // 剩下的都放不了：重抽一輪不需要參數的
    n.ev = pool[i]; n.evArg = args[i] || null;
    pool.splice(i, 1);
  }
}
