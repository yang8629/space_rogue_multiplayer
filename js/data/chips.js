// 星環電路 多人版 · chips.js：晶片定義 CHIPS（飛船晶片、晶片、插件）、插座、起始電路
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 電路 = 一條線（設計見 docs/設計方向.md「線」）：
//   Game.chain 是一排格子：第 1 格是飛船晶片（id 'weapon'，線頭），後面是晶片；空格（null）集中在最後
//   線頭觸發：武器命中時（照 WEAPONS[id].trig 累積，滿 1 觸發一次）、在命中點；招牌動作直接觸發一次（見 Game.lineSig）
//   晶片（type 'chip'）：被觸發就放出自己的東西（產物）；產物照 pass（命中 hit／擊殺 kill／結束 end）往下一格傳，每次 coef（累積滿 1 觸發一次）
//     mul = 產物的物理傷害（× 參考傷害：武器每 REF_T 秒的輸出，見 lineRef）；每往下一層 × LINE_DECAY
//   插件（type 'comp'）：插在晶片（含飛船晶片：作用在飛船的所有攻擊）的插座上（Game.socks），**傳給同一條線上它後面的所有晶片，同種加總**（見 compileLine）
//     只有物理傷害（傷害、大小）和元素（屬性傷害：強度只看疊了幾個同種元素，見 ELEM）；不做增量的插件（數量只靠晶片的觸發）
//     插件不影響晶片等級；晶片等級靠同種晶片合成（等級相加，最多 MAX_CHIP_LV，見 mergedChip）；等級只加物理傷害
const CHIPS = {
  // ---------- 飛船晶片（固定在電路第 1 格：線頭；名字、說明照飛船和武器，見 Game.refreshWeapon） ----------
  weapon: { name: '飛船', short: '飛船', type: 'source', cost: 0, locked: true, hidden: true, desc: '' },

  // ---------- 晶片：被觸發就放出產物；產物照 pass 往下一格傳 ----------
  boomerang: { name: '迴旋', short: '迴旋', type: 'chip', cost: 2, pass: 'hit', coef: 0.35, mul: 0.5, when: '迴旋刃每打中一隻',
    desc: '朝觸發的方向丟出迴旋刃：飛出去再飛回飛船，去程、回程都會打中。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },
  stasis: { name: '佈雷', short: '佈雷', type: 'chip', cost: 1, pass: 'hit', coef: 1, mul: 1.5, when: '地雷每次爆炸',
    desc: '在觸發的位置附近留一顆地雷：敵人靠近就衝過去爆炸（半徑 60）。停 4 秒沒被觸發就消失。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },
  infect: { name: '感染', short: '感染', type: 'chip', cost: 2, pass: 'kill', coef: 1, mul: 0.4, when: '孢子每打死一隻',
    desc: '從觸發的位置往四周放出 3 顆孢子；被孢子打死的敵人再爆出 3 顆孢子（只傳一代）。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },
  echo: { name: '回響', short: '回響', type: 'chip', cost: 1, pass: 'hit', mul: 0.5, when: '回響每打中一隻',
    desc: '在觸發的位置用武器再打一次（傷害 50%，朝最近的敵人）。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },
  shard: { name: '碎片', short: '碎片', type: 'chip', cost: 1, pass: 'hit', coef: 0.2, mul: 0.25, when: '每片碎片打中',
    desc: '在觸發的位置往四周炸出 6 片短程碎片（射程約 100）。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },
  homing: { name: '追蹤彈', short: '追蹤', type: 'chip', cost: 2, pass: 'hit', coef: 1, mul: 1.2, when: '追蹤彈打中',
    desc: '從觸發的位置放出一顆追蹤彈，轉向最近的敵人（飛 1.5 秒；附近沒有別隻時打觸發的那隻）。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },
  vortex: { name: '漩渦', short: '漩渦', type: 'chip', cost: 2, pass: 'end', coef: 1, mul: 0.05, when: '漩渦結束時（在中心）',
    desc: '在觸發的位置開一個漩渦（半徑 120），把附近的敵人吸到中心 1.5 秒（旗艦吸不動），幾乎不打傷害。',
    lvs: ['傷害 ×1', '傷害 ×1.5', '傷害 ×2.5'] },

  // ---------- 插件：插在晶片（含武器）上，傳給同一條線上它後面的所有晶片（同種加總） ----------
  amp: { name: '威力倍增器', short: '傷害', type: 'comp', comp: true, cost: 2, plug: 'dmg',
    desc: '物理傷害 +60%（產物本身打中的那一下；不加元素的傷害）。插在哪一片，那一片和這條線上它後面的都吃得到。' },
  bigshot: { name: '巨彈', short: '大小', type: 'comp', comp: true, cost: 1, plug: 'size',
    desc: '大小 +50%：子彈、迴旋刃、漩渦變大，爆炸、重力井範圍變大。插在哪一片，那一片和這條線上它後面的都吃得到。' },
  // 元素：帶這個元素的產物打到的敵人吃屬性傷害（強度只看疊了幾個同種元素，見 ELEM）；插在哪一片，那一片和這條線上它後面的都帶
  blast: { name: '爆裂彈頭', short: '爆裂', type: 'comp', comp: true, elem: true, cost: 2, desc: '命中時爆炸（半徑 60）。疊越多爆炸越痛。' },
  ignite: { name: '燃燒彈頭', short: '燃燒', type: 'comp', comp: true, elem: true, cost: 1, desc: '命中附加燃燒 3 秒。疊越多燒越痛。' },
  frost: { name: '冰凍塗層', short: '冰凍', type: 'comp', comp: true, elem: true, cost: 1, desc: '命中的敵人減速 40%，持續 2 秒；疊越多越慢（相乘）。' },
  shred: { name: '破甲彈頭', short: '破甲', type: 'comp', comp: true, elem: true, cost: 3, desc: '命中的敵人 3 秒內受到的所有傷害 +25%；疊越多加越多。' },
  shock: { name: '電擊線圈', short: '電擊', type: 'comp', comp: true, elem: true, cost: 2, desc: '命中時放出電弧打附近的敵人：疊幾個電幾隻，疊越多每道越痛。' },
};

// 插件的效果（每個插件 +多少；同種相加）
const PLUG = { dmg: 0.6, size: 0.5 };
// 元素的屬性傷害（× 參考傷害 lineRef；n = 同種疊了幾個）：不吃傷害插件、晶片等級
//   爆裂：半徑 r 的爆炸 k × n；燃燒：每秒 k × n、3 秒；電擊：n 道電弧，每道 k ×（1 ＋ up ×（n − 1））；冰凍：減速 1 − (1 − slow)^n；破甲：受傷 +per × n
const ELEM = { blast: { r: 60, k: 0.5 }, ignite: { k: 0.3 }, shock: { k: 0.4, up: 0.3 }, frost: { slow: 0.4, t: 2 }, shred: { per: 0.25 } };
const ELEM_IDS = Object.keys(ELEM);
const LINE_DECAY = 0.8;  // 每往下一層，產物傷害 ×0.8
const REF_T = 0.4;       // 參考傷害 = 武器每 REF_T 秒的輸出（見 lineRef）

// 晶片每一級的效果（卡片、說明用）
const LV_INFO = {};
for (const [id, d] of Object.entries(CHIPS)) if (d.lvs) LV_INFO[id] = ['等級', d.lvs];

// 卡片上的一行精簡說明（按住 Shift／Alt 才顯示完整說明）
const CHIP_BRIEF = {
  boomerang: '丟出迴旋刃，飛回飛船',
  stasis: '留一顆地雷，敵人靠近就衝過去炸',
  infect: '放出孢子，打死的敵人再爆孢子',
  echo: '用武器再打一次（50%）',
  shard: '往四周炸 6 片短程碎片',
  homing: '放出一顆追蹤彈，轉向最近的敵人',
  vortex: '把附近的敵人吸成一團',
  amp: '物理傷害 +60%（會往後傳）',
  bigshot: '大小 +50%（會往後傳）',
  blast: '命中時爆炸（疊越多越痛）',
  ignite: '命中附加燃燒（疊越多越痛）',
  frost: '命中的敵人減速（疊越多越慢）',
  shock: '命中時電弧：疊幾個電幾隻',
  shred: '命中的敵人受傷增加（疊越多越多）',
};
const chipBrief = id => CHIP_BRIEF[baseOf(id)] || String(CHIPS[id].desc).split(/[。；]/)[0];
// 往下傳的時機（晶片的說明框、卡片都顯示；照 when、coef 產生）：回響照現在武器的觸發係數（WEAPONS[id].trig）
const chipPassLine = id => {
  const d = CHIPS[baseOf(id)];
  if (!d || d.type !== 'chip') return '';
  const W = Game.weapon && WEAPONS[Game.weapon.id], k = d.coef != null ? d.coef : W ? W.trig : null;
  const how = k == null ? '照武器的觸發係數' : k >= 1 ? `觸發 ${+k.toFixed(2)} 次` : `累積 ${+k.toFixed(2)}（滿 1 觸發一次）`;
  return `觸發下一格：${d.when}，${how}${d.coef == null && W ? `（照武器的觸發係數，${W.short}）` : ''}`;
};
const NORMAL_IDS = Object.keys(CHIPS).filter(id => !CHIPS[id].hidden);
const chipPrice = id => (30 + CHIPS[id].cost * 8 + 6 * socketsOf(id)) * lvOf(id) * (rareOf(id) ? CFG.RARE.price : 1);
const isHead = id => id === 'weapon';  // 線頭：飛船晶片

// ---------- 插座 ----------
// 有插座的 = 飛船晶片、晶片；插件插在它們的插座裡（Game.socks），超過插座數就沒有作用
const isComp = id => !!(id && CHIPS[id] && CHIPS[id].comp);
const isHost = id => !!(id && CHIPS[id] && (id === 'weapon' || CHIPS[id].type === 'chip'));
const socketsOf = id => !id || !CHIPS[id] ? 0 : id === 'weapon' ? (Game.wSock ?? CFG.WEAPON_SOCKETS) : CHIPS[id].sk || 0;
// 掉落時隨機決定插座數：1 個 50%、2 個 35%、3 個 15%；沙盒／靶場一律 3 個
function rollSockets() { const r = Math.random(); return r < 0.5 ? 1 : r < 0.85 ? 2 : 3; }
const newChip = (base, sk, rare = false) => isHost(base) && base !== 'weapon' ? chipId(base, sk != null ? sk : Game.freePlay && Game.freePlay() ? CFG.MAX_SOCKETS : rollSockets(), 1, rare) : base;
// 三選一、商店的晶片：照機率變成稀有版（只有晶片有，見 RARE_INFO）
const rollRare = (id, chance = CFG.RARE.chance) => !!RARE_INFO[id] && Math.random() < chance;
// 沙盒、預設電路、機制檢查用：晶片一律給滿插座
const fullChip = id => !id || !isHost(id) || id === 'weapon' || socketsOf(id) ? id : chipId(baseOf(id), CFG.MAX_SOCKETS, lvOf(id), rareOf(id));
// ---------- 電路資料：Game.chain = 電路格（飛船晶片、晶片、空格）；Game.socks[i] = 插在第 i 格上的插件 ----------
const sockCount = (socks = Game.socks) => (socks || []).reduce((a, s) => a + ((s && s.length) || 0), 0);
// 另一種寫法（插件直接排在晶片後面，插在左邊最近的晶片上）→ 電路格＋插座：模擬、預設電路、機制檢查用
function splitChain(flat) {
  const chain = [], socks = [];
  let h = -1;
  for (const id of flat) {
    if (isComp(id)) { if (h >= 0) socks[h].push(id); continue; }
    chain.push(id); socks.push([]);
    if (id) h = chain.length - 1;
  }
  return { chain, socks };
}
// 電路格＋插座 → 插件排在晶片後面的寫法：模擬的電腦用
const flatChain = (chain, socks = []) => chain.flatMap((id, i) => [id, ...(id ? socks[i] || [] : [])]);
// 插在每片晶片上的插件作用在哪裡（電路總覽、編輯器說明用）
const PLUG_ON = {
  weapon: '飛船的所有攻擊（左鍵、右鍵、武器升級、衝刺撞擊、砲台），和線上後面的所有晶片',
  boomerang: '迴旋刃', stasis: '地雷', infect: '孢子', echo: '回響', shard: '碎片', homing: '追蹤彈', vortex: '漩渦',
};

// ---------- 晶片 id：base ＋ ~插座數 ＋ ^等級 ＋ !稀有（例 boomerang~3、boomerang~3^2、boomerang~3^2!） ----------
//   等級、稀有寫在 id：同種晶片合成才會升級（見 mergedChip），倉庫、網路同步都照 id 帶著走
const LV_MARK = ['', '', '²', '³'];
// 等級的物理傷害倍率：Lv3 跳得比 Lv2 多（中期目標）；3 片分開放 = 3 份產物，合成 Lv3 = 1 格 ×2.5，格子滿了以後合成才划算
const LV_MUL = [1, 1, 1.5, 2.5];
const lvMulOf = lv => LV_MUL[lv];
function chipId(base, sk = 0, lv = 1, rare = false) {  // 動態建立有插座、等級、稀有的晶片定義
  const id = base + (sk > 0 ? '~' + sk : '') + (lv > 1 ? '^' + lv : '') + (rare ? '!' : '');
  if (!CHIPS[id]) CHIPS[id] = { ...CHIPS[base], base, sk, lv, rare };
  return id;
}
const lvOf = id => (id && CHIPS[id] && CHIPS[id].lv) || 1;
const rareOf = id => !!(id && CHIPS[id] && CHIPS[id].rare);
// 合成：a 拖到 b 上（同種、合起來不超過最高等級才行）→ 等級相加、插座取大的、有一片是稀有就是稀有（每種晶片只有一種稀有版）；不能合成回傳 null
const mergedChip = (a, b) => a && b && hasLv(a) && baseOf(a) === baseOf(b) && lvOf(a) + lvOf(b) <= CFG.MAX_CHIP_LV
  ? chipId(baseOf(a), Math.max(socketsOf(a), socketsOf(b)), lvOf(a) + lvOf(b), rareOf(a) || rareOf(b)) : null;
// 稀有版（設計見 docs/設計方向.md「稀有晶片」）：每種晶片自己的一種，換往下傳的條件或觸發位置；行為在 pipeline.js、entities.js、game.js 找 rare
const RARE_INFO = {
  infect: '被爆出來的孢子打死的也往下傳（第二代也算）',
  boomerang: '只有回程打中才往下傳，但每次傳 1 次',
  stasis: '地雷沒被觸發、消失時也會自爆並往下傳',
  shard: '碎片也打得到觸發的那隻；6 片都打中同一隻時，額外往下傳 1 次',
  homing: '打中後彈去附近下一隻，第二下也往下傳',
  vortex: '吸到 5 隻以上時，結束時往下傳 2 次',
  echo: '改從飛船朝準星打出去（不在觸發的位置）',
};
// 對方傳來的晶片 id：認得的才收（不認得的回傳 null）
function parseChipId(id) {
  if (typeof id !== 'string') return null;
  if (NORMAL_IDS.includes(id)) return id;
  const m = /^([a-z_]+)(?:~([1-9]))?(?:\^([2-9]))?(!)?$/.exec(id);
  if (!m || !NORMAL_IDS.includes(m[1])) return null;
  const sk = m[2] ? Math.min(CFG.MAX_SOCKETS, +m[2]) : 0, lv = m[3] ? Math.min(CFG.MAX_CHIP_LV, +m[3]) : 1;
  if ((sk && !isHost(m[1])) || (lv > 1 && !CHIPS[m[1]].lvs) || (m[4] && !RARE_INFO[m[1]])) return null;
  return chipId(m[1], sk, lv, !!m[4]);
}
const baseOf = id => (id && CHIPS[id].base) || id;
const hasLv = id => !!(id && CHIPS[id] && CHIPS[baseOf(id)].lvs);  // 晶片才有等級（飛船晶片、插件沒有）
const sellPrice = id => Math.floor(chipPrice(id) * 0.4);
// 電路第 i 格的等級（info = compileLine(...).info；預設看自己的電路）
const slotLv = (i, info = Game.stats && Game.stats.info) => (info && info[i] && info[i].lv) || 1;
// 照等級的名稱：Lv2「迴旋 Lv2」
function lvName(id, lv = lvOf(id)) {
  const B = CHIPS[baseOf(id)], r = rareOf(id) ? '★' : '';
  return r + (!hasLv(id) || lv <= 1 ? CHIPS[id].name : `${B.name} Lv${lv}`);
}
function lvShort(id, lv = lvOf(id)) {
  const B = CHIPS[baseOf(id)], r = rareOf(id) ? '★' : '';
  return r + (!hasLv(id) || lv <= 1 ? CHIPS[id].short : B.short + LV_MARK[lv]);
}

// 開局電路：武器＋三選一的起始晶片（沒選就空著）；插件不佔電路格：武器開局有插座就插在武器上，沒有才放倉庫
const startChain = chip => ['weapon', NORMAL_IDS.includes(chip) && !isComp(chip) ? newChip(chip) : null, ...Array(CFG.START_SLOTS - 2).fill(null)];
const startComp = chip => NORMAL_IDS.includes(chip) && isComp(chip) ? chip : null;
const startInv = chip => { const inv = Array(CFG.INV_SLOTS).fill(null); if (startComp(chip) && !CFG.START_WSOCK) inv[0] = newChip(chip); return inv; };
const startSocks = chip => startComp(chip) && CFG.START_WSOCK ? [[newChip(chip)]] : [];

// 沙盒的預設電路（晶片給滿插座，見 fullChip）
const PRESETS = {
  basic: ['weapon', 'amp', 'boomerang', null],
  multi: ['weapon', 'shock', 'shock', 'shock', 'boomerang', 'shard', null],
  focus: ['weapon', 'echo', 'homing', 'amp', null],
  chain: ['weapon', 'boomerang', 'vortex', 'stasis', 'infect', null],
  reso:  ['weapon', 'infect', 'blast', 'boomerang', 'stasis'],
};
