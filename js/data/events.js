// 星環電路 雙人版 · events.js：？事件節點的事件表 EVENTS（數字在 CFG.EVENT）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 每個事件：name、icon、color、text(G, node) 情境說明、opts 選項
//   選項：lab 短名（遊玩紀錄）、txt(G) 按鈕文字、can(G) 能不能選（省略 = 可以）、
//         go(G, node) 選了之後做什麼：回傳 true = 已經打開下一個畫面（三選一），回傳文字 = 回到航圖、顯示這段提示
//   target(node, byId)：（可省略）產生航圖時決定的參數，存在 node.evArg、跟著航圖同步；回傳 null = 這個節點不能放這個事件
//   enter(G, node)：（可省略）一進來就生效的部分（雙人時每個人都會執行，結果要一樣）
// 雙人：每個人各自選；扣血、晶體、三選一、護殼都是自己的；求救訊號任何一個人回應，全隊下一場都變難（獎勵也全隊都有）
const pctTxt = v => `${Math.round(v * 100)}%`;
const leaveOpt = (lab, msg) => ({ lab, txt: () => lab, go: () => msg });
const EVENTS = {
  wreck: {
    name: '漂流殘骸', icon: '⚙', color: '#8fa3d9',
    text: () => '一艘被擊毀的運輸艦在漂流，貨艙還封著。反應爐很不穩定，搜刮時一定會被波及。',
    opts: [
      { lab: '搜刮', txt: G => `搜刮貨艙：HP −${G.wreckHp()}（最大 HP 的 ${pctTxt(CFG.EVENT.wreck.hp)}，最少留 1 HP），晶片三選一`,
        go: G => { const p = G.player; p.hp = Math.max(1, p.hp - G.wreckHp()); G.openReward('event', { note: '漂流殘骸的貨艙' }); return true; } },
      leaveOpt('不冒險，離開', '你沒有靠近殘骸'),
    ],
  },
  market: {
    name: '黑市商人', icon: '⚖', color: '#ff9f1c',
    text: () => '一艘沒有識別碼的貨船靠過來：「改造過的晶片，保證稀有。只是裝的時候要拆掉你一點裝甲。」',
    opts: [
      { lab: '交易', txt: G => `買一批改造晶片：◆${G.marketPrice()}，這一局最大 HP −${pctTxt(CFG.EVENT.market.hpCut)}；三選一保證 ${CFG.EVENT.market.rare} 格稀有`,
        can: G => G.credits >= G.marketPrice(),
        go: G => G.pay(G.marketPrice(), () => { G.boons.hp++; G.recalc(); G.openReward('event', { rareAdd: CFG.EVENT.market.rare, note: '黑市的改造晶片' }); }) },
      leaveOpt('不交易，離開', '黑市商人消失在星塵裡'),
    ],
  },
  sos: {
    name: '求救訊號', icon: '📡', color: '#ff6b6b',
    text: () => '一支被圍攻的運輸船隊在求救。趕過去的話，下一場戰鬥會撞上追兵的主力；救下他們，他們會拿最好的貨答謝。',
    opts: [
      { lab: '回應', txt: () => `回應：下一場戰鬥（一般戰鬥或精英戰）敵人 +${pctTxt(CFG.EVENT.sos.mul - 1)}，打贏的三選一保證 ${CFG.BONUS.sos.rare} 格稀有`,
        go: G => { G.acceptSos(); return '已回應求救訊號：下一場戰鬥敵人變多，打贏保證稀有晶片'; } },
      leaveOpt('不回應', '訊號漸漸斷了'),
    ],
  },
  ward: {
    name: '終焉護殼', icon: '⛨', color: '#ffd166',
    text: () => '殘骸裡有一具還能運作的終焉護殼：能撐住一次致命的攻擊，但它會干擾機體的護甲。',
    opts: [
      { lab: '裝上', txt: () => `裝上：這一局有一次受到致命傷害時留 1 HP、無敵 ${CFG.EVENT.ward.iframe} 秒；這一局受到的傷害 +${pctTxt(CFG.EVENT.ward.taken)}`,
        go: G => { G.boons.ward++; G.boons.taken++; G.recalc(); return '裝上終焉護殼：這一局可以免死一次'; } },
      leaveOpt('不裝，離開', '你留下了護殼'),
    ],
  },
  chart: {
    name: '星圖情報', icon: '✦', color: '#ffd166',
    // 標哪一格：從這裡走得到的一般戰鬥（產生航圖時就決定，雙人兩邊一樣）
    target: (node, byId) => { const c = descendants(node, byId).filter(d => d.type === 'combat'); return c.length ? pick(c).id : null; },
    enter: (G, node) => { const t = G.nodeById(node.evArg); if (t) t.hoard = true; },
    text: (G, node) => { const t = G.nodeById(node.evArg);
      return `截獲一段走私者的通訊：前方第 ${t ? t.L + 1 : '?'} 層的戰鬥是寶藏無人機的巢，那場戰鬥<b>每一區都有一架寶藏無人機</b>（每打掉一架，三選一多保證 1 格稀有，最多 2 格）。航圖上用金色 ✦ 標出來了。`; },
    opts: [leaveOpt('記下位置，返回航圖', '已在航圖上標出寶藏星域（金色 ✦）')],
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
    const i = pool.findIndex(k => !EVENTS[k].target || EVENTS[k].target(n, byId));
    const k = pool.splice(Math.max(0, i), 1)[0];
    n.ev = k; n.evArg = EVENTS[k].target ? EVENTS[k].target(n, byId) : null;
    if (EVENTS[k].target && !n.evArg) n.ev = 'wreck';  // 這一格放不了（後面沒有一般戰鬥）
  }
}
