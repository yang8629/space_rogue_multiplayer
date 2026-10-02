// 星環電路 雙人版 · chips.js：晶片定義 CHIPS、等級 LV_INFO、用量成長、插座與組件、奇異點強化格子、起始電路
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// V2 晶片池：
//   改玩法的晶片（彈道／發射／命中／機體）：照著它的玩法打就會成長（grow），Lv3 進化（evo，改名、玩法再變一次）
//   組件（分裂、巨彈、穿甲、倍增、超頻模組、鏡像）：插在武器／玩法晶片／觸發器的插座裡（Game.socks，不佔電路格），不會升級
//   觸發器（命中、消失、定時）：放在電路格，右邊的晶片只作用在它的回響上
//   玩法晶片照順序作用在「它左邊」已經產生的子彈
const CHIPS = {
  // ---------- 武器（固定在電路第 1 格，內容依目前武器與升級而定） ----------
  weapon: { name: '武器', short: '武器', type: 'source', cost: 0, locked: true, hidden: true, desc: '',
    emit: pw => weaponEmit(Game.wp, pw) },
  // 觸發器的子電路開頭：用武器再射一次，傷害 50%（插在觸發器上的組件見 runOps）
  echo: { name: '武器回響', short: '回響', type: 'source', cost: 0, hidden: true, desc: '',
    emit: pw => weaponEmit(Game.wp, pw * 0.5) },

  // ---------- 彈道：子彈怎麼飛 ----------
  boomerang: { name: '迴旋', short: '迴旋', type: 'path', cost: 2, evo: '迴旋風暴',
    grow: { what: '回程擊殺', need: [70, 235] },
    desc: '打中敵人才折返：穿過去再飛回射出它的飛船，回程再打牠一次，一路無限穿透（有穿甲時穿甲用完才折返；相刃的刃片揮到盡頭時有砍到就折返）；沒打中就飛到盡頭消失。傷害 ×0.7。',
    lvs: ['回程傷害 ×1', '回程傷害 ×1.5', '進化：折返時分裂成 3 發'],
    apply: (list, pw, o) => list.map(b => ({ ...b, boom: o.lv, damage: b.damage * 0.7 })) },
  orbit: { name: '環繞', short: '環繞', type: 'path', cost: 2, evo: '星環',
    grow: { what: '環繞擊殺', need: [190, 645] },
    desc: '按住射擊時子彈存在飛船旁邊繞圈（碰到敵人照打，同一隻隔 0.5 秒可再打；每打一次扣一次穿甲，用完消失），越繞越快；放開射擊時全部從所在位置朝滑鼠那一點射出，轉越快放出越快：速度倍率就是傷害倍率（Lv1 最多 ×1.5，Lv2 最多 ×2）。右邊晶片的效果從射出後開始。',
    lvs: ['最多存 10 發（一次開火算一發）；3 秒轉滿（放出 ×1.5 速度與傷害）', '最多存 20 發；2 秒轉滿（放出 ×2 速度與傷害）', '進化：射出的子彈追蹤敵人'],
    apply: (list, pw, o) => list.map(b => ({ ...b, orbit: o.lv })) },
  stasis: { name: '佈雷', short: '佈雷', type: 'path', cost: 1, evo: '伏擊網',  // 程式代號沿用 stasis（原本的「停滯」）
    grow: { what: '地雷擊殺', need: [165, 565] },
    desc: '子彈飛到射程一半時停住變成地雷：敵人靠近就朝牠衝出去（傷害 ×1.2，跑完剩下的射程，至少比觸發範圍遠 30；衝出去後照常吃其他晶片的效果，加速、疾射接著停住前的進度算）；時間到還沒被觸發就消失。停住時不會打到敵人，也不擋子彈。',
    lvs: ['停 4 秒，觸發範圍 50', '停 6 秒，觸發範圍 70', '進化：停住的子彈之間拉出電弧，碰到的敵人持續受傷'],
    apply: (list, pw, o) => list.map(b => ({ ...b, stasis: o.lv })) },
  accel: { name: '加速', short: '加速', type: 'path', cost: 1, evo: '超音速',
    grow: { what: '2 倍速以上擊殺', need: [100, 330] },
    desc: '子彈出手只有 0.5 倍速，越飛越快，射程 ×1.5。速度照「飛了射程的幾成」算，飛到射程盡頭最快，每把武器都一樣（遠近照各自的射程換算）。速度倍率加進傷害加成（0.5 倍速 = −50%，4 倍速 = +300%，和倍增器等加成相加），所以近距離很虧、遠距離很痛。搭環繞：從放出時的倍率繼續加上去；搭佈雷、迴旋：衝出去、回程接著原本的進度算。速度倍率最多 5 倍。',
    lvs: ['0.5 倍 → 射程盡頭 3 倍', '0.5 倍 → 射程盡頭 4 倍', '進化：速度超過 2 倍時無限穿透'],
    apply: (list, pw, o) => list.map(b => ({ ...b, accel: o.lv })) },
  quick: { name: '疾射', short: '疾射', type: 'path', cost: 1, evo: '衝擊',
    grow: { what: '2 倍速以上擊殺', need: [185, 625] },
    desc: '跟加速相反：子彈出手最快，照「飛了射程的幾成」變慢，射程盡頭剩 0.5 倍；射程不變，每把武器都一樣（遠近照各自的射程換算）。速度倍率加進傷害加成，所以近距離很痛、遠距離變弱。跟加速、環繞放出加在同一個倍率上（疾射＋加速同等級 = 整段射程固定倍率），最多 5 倍。',
    lvs: ['出手 3 倍 → 射程盡頭 0.5 倍', '出手 4 倍 → 射程盡頭 0.5 倍', '進化：2 倍速以上打中時強力擊退（×3）'],
    apply: (list, pw, o) => list.map(b => ({ ...b, quick: o.lv })) },
  wallbounce: { name: '牆反彈', short: '反彈', type: 'path', cost: 1, evo: '稜鏡',
    grow: { what: '反彈後擊殺', need: [155, 525] },
    desc: '射程 ×1.5，子彈碰到場地邊緣會反彈。搭配穿透（穿甲、加速 Lv3、蓄力 Lv3）效果最好：打中敵人的子彈沒有穿透就會消失。',
    lvs: ['反彈 1 次', '反彈 3 次', '進化：每次反彈分裂成 2 發'],
    apply: (list, pw, o) => list.map(b => ({ ...b, bounce: b.bounce + (o.lv >= 2 ? 3 : 1), life: b.life * 1.5, prism: o.lv >= 3 })) },

  // ---------- 發射：從哪裡、朝哪裡射 ----------
  rear: { name: '反向', short: '反向', type: 'launch', cost: 2, evo: '全向',
    grow: { what: '反向擊殺', need: [175, 720] },
    desc: '目前的子彈另外朝反方向也射一份。',
    copyCredit: true,  // 傷害統計：只有多射出來的子彈算反向的（當成它的基礎傷害），原本往前的不算
    lvs: ['反方向 1 份', '反方向 2 份（稍微張開）', '進化：前後左右 4 個方向'],
    apply: (list, pw, o) => {
      const offs = o.lv >= 3 ? [Math.PI, Math.PI / 2, -Math.PI / 2] : o.lv >= 2 ? [Math.PI - 0.12, Math.PI + 0.12] : [Math.PI];
      return [...list, ...offs.flatMap(d => list.map(b => ({ ...b, angle: b.angle + d, rear: true, src: o.key || b.src })))];
    } },
  charge: { name: '蓄力', short: '蓄力', type: 'launch', cost: 0, evo: '過載砲',
    grow: { what: '蓄滿擊殺', need: [200, 685] },
    desc: '停止射擊時開始蓄力；再按下射擊的第一發依蓄力程度變強（蓄滿：左邊的子彈傷害 +400%、體積 +150%；和倍增器等加成相加），之後照常連射。',
    lvs: ['蓄滿要 2 秒', '蓄滿只要 1.5 秒', '進化：蓄滿的一發無限穿透，飛到盡頭爆炸'],
    apply: (list, pw, o) => {
      const c = Game.chargeC || 0, full = c >= 0.999;  // 只有玩家開火的第一發帶蓄力（觸發、衝刺射擊、擦彈都是 0）
      return list.map(b => ({ ...(c > 0 ? addBonus(b, 4 * c) : b), ...sizeUp(b, 1.5 * c), speed: b.speed * (1 - 0.2 * c),  // 蓄滿 +400%（加進加成池，跟倍增相加）
        full: full ? o.lv : 0, pierce: full && o.lv >= 3 ? 99 : b.pierce, endBoom: full && o.lv >= 3, color: full ? '#ffffff' : b.color }));
    } },

  // ---------- 命中之後 ----------
  sticky: { name: '黏著', short: '黏著', type: 'impact', cost: 1, evo: '連鎖引爆',
    grow: { what: '黏著擊殺', need: [185, 625] },
    desc: '子彈黏在敵人身上（先造成 30% 傷害）；第一發黏上後 2 秒，黏著的子彈一起爆炸（之後黏上的不重新計時）。黏越多發，爆炸倍率越高。會穿透的子彈每穿過一隻就留一份，穿甲用完才黏住；迴旋每打一隻留一份，照常折返。適合打血厚的敵人。',
    lvs: ['爆炸 ×(1.5 ＋ 每發 0.1)，最多 ×3', '爆炸 ×(2 ＋ 每發 0.15)，最多 ×4.5', '進化：爆炸波及周圍，並立刻引爆鄰近敵人身上的子彈'],
    apply: (list, pw, o) => list.map(b => ({ ...b, sticky: o.lv })) },
  infect: { name: '感染', short: '感染', type: 'impact', cost: 2, evo: '瘟疫',
    grow: { what: '爆出子彈擊殺', need: [65, 215] },
    desc: '被這些子彈擊殺的敵人爆出子彈（傷害 ×1.5，帶著這發子彈身上的晶片效果）。',
    lvs: ['爆出 3 發', '爆出 5 發', '進化：爆出的子彈也帶感染（最多傳 2 代）'],
    apply: (list, pw, o) => list.map(b => ({ ...b, infect: o.lv })) },
  pull: { name: '吸引', short: '吸引', type: 'impact', cost: 1, evo: '引力漩渦',
    grow: { what: '拉過後擊殺', need: [215, 720] },
    desc: '命中時把附近的敵人往命中點拉（旗艦不會被拉；環繞還在繞圈的子彈不會拉，放出去之後才會）。',
    lvs: ['範圍 90', '範圍 130', '進化：每命中 8 次生成一個 1.5 秒的引力漩渦'],
    apply: (list, pw, o) => list.map(b => ({ ...b, pull: o.lv })) },

  // ---------- 跟機體連動 ----------
  dashfire: { name: '衝刺射擊', short: '衝射', type: 'body', cost: 1, evo: '流星',
    grow: { what: '衝刺射擊擊殺', need: [155, 525] },
    desc: '衝刺結束時，用整條電路朝準星額外開一槍（傷害 +50%，不佔射擊冷卻；有停火蓄力時會用掉蓄力）。平常開火不受影響。',
    lvs: ['開 1 槍', '連開 2 槍', '進化：衝刺的那一槍無限穿透，傷害 +100%'],
    apply: (list, pw, o) => Game.fireMode !== 'dashfire' ? list
      : list.map(b => ({ ...addBonus(b, o.lv >= 3 ? 1 : 0.5), dashShot: true, pierce: o.lv >= 3 ? 99 : b.pierce })) },
  intercept: { name: '攔截', short: '攔截', type: 'impact', cost: 1, evo: '反射鏡',
    grow: { what: '回射擊殺', need: [100, 330] },
    desc: '子彈碰到敵彈時把它打掉，並從那裡用整條電路朝最近的敵人回射一次（不會用掉停火蓄力）。打掉一發敵彈跟打中敵人一樣扣 1 穿甲，沒有穿甲就消失。子彈越多、越大越會攔：散彈、相位刃（無限穿透）特別好用。',
    lvs: ['回射傷害 ×0.5', '回射傷害 ×1', '進化：打掉的敵彈也反彈回去（敵彈傷害 ×2）'],
    apply: (list, pw, o) => list.map(b => ({ ...b, intercept: o.lv, damage: Game.fireMode === 'intercept' ? b.damage * (o.lv >= 2 ? 1 : 0.5) : b.damage })) },

  // ---------- 組件：插在武器、玩法晶片、觸發器的插座上（不會升級，拿到重複的就是多一個） ----------
  //   插在武器（或觸發器 = 回響）上：作用在射出的全部子彈，加進武器層
  //   插在玩法晶片上：只作用在那個晶片的「產物」（HOST_PRODUCT），加進宿主層
  split: { name: '分裂模組', short: '分裂', type: 'comp', comp: true, cost: 2,
    desc: '每顆子彈分裂為 3 顆扇形彈，每顆傷害 ×0.4（3 顆合計 ×1.2）。插在玩法晶片上時，那個晶片的產物出現時才分裂（例：環繞放出時、迴旋折返時；黏著是爆炸時噴出 3 發碎片）。',
    apply: (list, pw) => {
      const n = Math.max(2, Math.round(3 + 2 * (pw - 1)));  // 強度 ×1.5（奇異點）→ 4 顆，×0.7 → 2 顆
      return list.flatMap(b => Array.from({ length: n }, (_, k) =>
        ({ ...b, angle: b.angle + (k - (n - 1) / 2) * 0.18, damage: b.damage * 0.4, splits: (b.splits || 0) + 1 })));
    } },
  bigshot: { name: '巨彈', short: '巨彈', type: 'comp', comp: true, cost: 1,
    desc: '子彈數量減半（兩兩合併，最少 1 發），合併的傷害加總後再 +30%；子彈體積 ×1.8、擊退變強。插在玩法晶片上只作用在它的產物（黏著：爆炸波及周圍；吸引：範圍 ×1.5）。',
    apply: (list, pw, o) => {
      const out = [];
      for (let i = 0; i < list.length; i += 2) {
        const g = list.slice(i, i + 2), f = g[0];
        let dmg = 0, bonus = 0;
        for (const b of g) { dmg += b.damage; bonus += b.damage * (b.bonus || 0); }
        const ang = g.reduce((a, b) => a + b.angle, 0) / g.length;
        out.push(addLayer({ ...f, angle: ang, damage: dmg, bonus: dmg ? bonus / dmg : 0,
          pierce: Math.max(...g.map(b => b.pierce)), ...sizeUp(f, 0.8 * pw),
          knock: (f.knock == null ? 1 : f.knock) + 0.5 * pw }, 0.3 * pw, o));
      }
      return out;
    } },
  pierce: { name: '穿甲塗層', short: '穿甲', type: 'comp', comp: true, cost: 1,
    desc: '子彈穿透 +2。同一發子彈不會連續打同一隻敵人（撞牆反彈後可以再打）。插在玩法晶片上只作用在它的產物（例：迴旋的回程、牆反彈之後；黏著：黏住前多穿 2 隻、多留 2 份）。',
    apply: (list, pw) => list.map(b => ({ ...b, pierce: b.pierce + Math.round(2 * pw) })) },
  amp: { name: '威力倍增器', short: '倍增', type: 'comp', comp: true, cost: 3,
    desc: '傷害 +100%。插在武器（或觸發器）上加進武器層，跟蓄力、速度倍率、其他武器上的倍增相加；插在玩法晶片上加進宿主層，只作用在它的產物，再跟武器層相乘。',
    apply: (list, pw, o) => list.map(b => addLayer(b, pw, o)) },
  overclock: { name: '超頻模組', short: '超頻', type: 'comp', comp: true, cost: 2, rate: 0.5, rateFixed: true,
    desc: `整條電路${rateTxt(0.5)}，但連續射擊 3 秒後會過熱，停火 1.5 秒。停止射擊時會慢慢散熱。只能插在武器上。`,
    heatLimit: [3, 4, 5],
    apply: list => list },
  mirror: { name: '鏡像迴路', short: '鏡像', type: 'comp', comp: true, cost: 2,
    desc: '複製同一個晶片上「前一個插座」的組件，再執行一次（不能複製超頻）。插在武器（或觸發器）的第一個插座 = 武器多射一次（兩個鏡像 = 射 3 次）；插在玩法晶片的第一個插座沒有效果。' },

  // ---------- 觸發器：放在電路格；右邊的晶片只作用在回響上，插在觸發器上的組件作用在回響上（跟插在武器上一樣） ----------
  trigger: { name: '命中觸發器', short: '命中', type: 'trigger', trig: 'hit', cost: 1,
    desc: '子彈命中敵人時，從命中點用武器再射一次（回響：傷害 50%，朝最近的另一隻敵人；附近沒有就沿子彈的方向），右邊的晶片只作用在回響上，開火時不執行。插在觸發器上的組件作用在回響上（跟插在武器上一樣）。最多巢狀 3 層。' },
  trigend: { name: '消失觸發器', short: '消失', type: 'trigger', trig: 'end', cost: 1,
    desc: '子彈消失時，從消失的位置射出回響（傷害 50%，朝最近的敵人）：飛完射程、穿甲用完、黏著引爆、地雷時間到、迴旋飛回飛船都算；被盾反彈、被地圖物件擋住、飛出場地不算。右邊的晶片只作用在回響上。最多巢狀 3 層。' },
  trigtime: { name: '定時觸發器', short: '定時', type: 'trigger', trig: 'time', cost: 1,
    desc: '子彈飛行中每 0.3 秒往左右兩側各射一次回響（傷害 50%），每顆子彈最多 5 次（10 發）；停住的地雷不算。右邊的晶片只作用在回響上。最多巢狀 3 層。' },

  // ---------- 超載（奇異點強化格子的好結果；隱藏晶片，當成那一格多插一個組件） ----------
  ov_power:  { name: '超載・威力', type: 'comp', comp: true, cost: 0, hidden: true, desc: '傷害 +50%',
    apply: (list, pw, o) => list.map(b => addLayer(b, 0.5, o)) },
  ov_rate:   { name: '超載・頻率', type: 'comp', comp: true, cost: 0, hidden: true, rate: 0.8, desc: '整條電路' + rateTxt(0.8),
    apply: list => list },
  ov_pierce: { name: '超載・貫穿', type: 'comp', comp: true, cost: 0, hidden: true, desc: '穿透 +1',
    apply: list => list.map(b => ({ ...b, pierce: b.pierce + 1 })) },
  ov_seek:   { name: '超載・導引', type: 'comp', comp: true, cost: 0, hidden: true, desc: '子彈追蹤敵人',
    apply: list => list.map(b => ({ ...b, homing: b.homing + 3 })) },
};

// 改玩法的晶片每一級的效果（卡片、說明用）
const LV_INFO = {};
for (const [id, d] of Object.entries(CHIPS)) if (d.lvs) LV_INFO[id] = ['等級', d.lvs];
const lvLine = (base, cur) => {
  const L = LV_INFO[base];
  if (!L) return '';
  return `${L[0]}：` + L[1].map((v, i) => i + 1 === cur ? `<b style="color:#9dff6b">Lv${i + 1} ${v}</b>` : `Lv${i + 1} ${v}`).join(' → ');
};

// 卡片上的一行精簡說明（按住 Shift／Alt 才顯示完整說明）
const CHIP_BRIEF = {
  boomerang: '打中後穿過去再飛回來，回程再打一次（傷害 ×0.7）',
  orbit: '按住射擊存彈繞圈，放開一次射出',
  stasis: '子彈飛到射程一半停住變地雷，敵人靠近就衝出去',
  accel: '越飛越快越痛，射程 ×1.5；貼臉很虧',
  quick: '出手最快最痛，越飛越弱；打近用',
  wallbounce: '射程 ×1.5，碰到場地邊緣反彈',
  rear: '朝反方向也射一份',
  charge: '停火蓄力，下一發最多 ×5',
  sticky: '黏在敵人身上，2 秒後一起爆炸',
  infect: '擊殺的敵人爆出子彈',
  pull: '命中時把附近的敵人拉過來',
  dashfire: '衝刺結束時額外開一槍',
  intercept: '子彈打掉敵彈，並回射一次',
  split: '每顆子彈分成 3 顆（每顆 ×0.4）',
  bigshot: '子彈數量減半，合併成更大更痛的',
  pierce: '子彈穿透 +2',
  amp: '傷害 +100%',
  overclock: '射速 ×2，但連射會過熱（只能插武器）',
  mirror: '複製前一個插座的組件；插武器第一格 = 多射一次',
  trigger: '命中時從命中點再射一次（右邊的晶片）',
  trigend: '子彈消失時從那裡再射一次（右邊的晶片）',
  trigtime: '飛行中每 0.3 秒往兩側射一次（右邊的晶片）',
};
const chipBrief = id => CHIP_BRIEF[baseOf(id)] || String(CHIPS[id].desc).split(/[。；]/)[0];
// 子彈體積加成（巨彈、蓄力）：加成彼此相加，照原本大小算（順序不影響），最大半徑 60
const sizeUp = (b, add) => { const r0 = b.r0 || b.radius, sb = (b.sizeB || 0) + add; return { r0, sizeB: sb, radius: Math.min(60, r0 * (1 + sb)) }; };
const NORMAL_IDS = Object.keys(CHIPS).filter(id => CHIPS[id].type !== 'composite' && !CHIPS[id].hidden);
const COMPOSITE_IDS = [];  // V2 拿掉了軍規複合晶片（精英改給背包模組）
const OVERLOADS = ['ov_power', 'ov_rate', 'ov_pierce', 'ov_seek'];
const chipPrice = id => (30 + CHIPS[id].cost * 8) * levelOf(id) + 6 * socketsOf(id);

// ---------- 插座 ----------
// 宿主 = 武器、玩法晶片、觸發器；組件（comp）插在宿主的插座裡（Game.socks），超過插座數就沒有作用
const HOST_TYPES = ['path', 'launch', 'impact', 'body', 'trigger'];
const isComp = id => !!(id && CHIPS[id] && CHIPS[id].comp);
const isHost = id => !!(id && CHIPS[id] && (id === 'weapon' || HOST_TYPES.includes(CHIPS[id].type)));
const socketsOf = id => !id || !CHIPS[id] ? 0 : id === 'weapon' ? (Game.wSock ?? CFG.WEAPON_SOCKETS) : CHIPS[id].sk || 0;
// 掉落時隨機決定插座數：1 個 50%、2 個 35%、3 個 15%；沙盒／靶場一律 3 個
function rollSockets() { const r = Math.random(); return r < 0.5 ? 1 : r < 0.85 ? 2 : 3; }
const newChip = (base, sk) => isHost(base) && base !== 'weapon' ? chipId(base, 1, sk != null ? sk : Game.freePlay && Game.freePlay() ? CFG.MAX_SOCKETS : rollSockets()) : base;
// 沙盒、預設電路、機制檢查用：宿主一律給滿插座
const fullChip = id => !id || !isHost(id) || id === 'weapon' || socketsOf(id) ? id : chipId(baseOf(id), levelOf(id), CFG.MAX_SOCKETS);
// ---------- 電路資料：Game.chain = 電路格（武器、玩法晶片、觸發器、空格）；Game.socks[i] = 插在第 i 格晶片上的組件 ----------
//   組件插在晶片的插座裡，不佔電路格
const sockCount = (socks = Game.socks) => (socks || []).reduce((a, s) => a + ((s && s.length) || 0), 0);
// 舊的寫法（組件直接排在電路裡，插在左邊最近的晶片上）→ 電路格＋插座：模擬、預設電路、機制檢查用（組件拿出來之後電路變短）
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
// 電路格＋插座 → 舊的寫法（組件排在晶片後面）：模擬的電腦用
const flatChain = (chain, socks = []) => chain.flatMap((id, i) => [id, ...(id ? socks[i] || [] : [])]);
// 每個宿主的「產物」：插在它上面的組件只作用在這些東西上（電路總覽、編輯器說明用）
const HOST_PRODUCT = {
  weapon: '射出的全部子彈（不包括觸發器的回響）',
  boomerang: '折返之後的子彈', orbit: '放出的那一波', stasis: '衝出去的地雷', accel: '速度到 1.5 倍之後的子彈',
  quick: '速度 1.5 倍以上的那一段（掉到 1.5 倍以下，倍增等傷害加成就失效）', wallbounce: '第一次反彈之後的子彈', rear: '往後射的那一份',
  charge: '蓄滿的那一發', sticky: '爆炸（分裂：噴出 3 發碎片；巨彈：波及周圍；穿甲：黏住前多穿 2 隻）', infect: '爆出來的子彈',
  pull: '拉力（只能插巨彈：範圍 ×1.5）', intercept: '回射的子彈', dashfire: '衝刺那一槍',
  trigger: '回響（跟插在武器上一樣）', trigend: '回響（跟插在武器上一樣）', trigtime: '回響（跟插在武器上一樣）',
};
// 武器層／宿主層：倍增、巨彈、超載・威力插在武器（或觸發器）上加進武器層（bonus），插在玩法晶片上加進宿主層（hb）；最終 = 基礎 ×（1 ＋ 武器層）×（1 ＋ 宿主層）
function addHB(b, add) {
  const old = b.hb || 0, nb = old + add;
  return { ...b, hb: nb, damage: b.damage / Math.max(0.1, 1 + old) * Math.max(0.1, 1 + nb) };
}
const addLayer = (b, add, o) => (o && o.layer === 'h' ? addHB(b, add) : addBonus(b, add));

// ---------- 奇異點（航圖節點）：強化格子（每格只能強化一次，武器格也可以；屬性留在格子上，換晶片也還在） ----------
const SLOT_ATTRS = {
  eff:       { good: true, name: '效果 ×1.5', desc: '放在這格的晶片，插座上的組件效果 ×1.5' },
  grow2:     { good: true, name: '成長 ×2', desc: '這格的玩法晶片用量成長 ×2' },
  free:      { good: true, name: '能量歸零', desc: '放在這格的晶片不算能量負載（插座上的組件照算）' },
  ov_power:  { good: true, name: '超載・威力', desc: '這格的晶片多插一個「傷害 +50%」（不佔插座）' },
  ov_rate:   { good: true, name: '超載・頻率', desc: '這格有晶片時，整條電路' + rateTxt(0.8) },
  ov_pierce: { good: true, name: '超載・貫穿', desc: '這格的晶片多插一個「穿透 +1」（不佔插座）' },
  ov_seek:   { good: true, name: '超載・導引', desc: '這格的晶片多插一個「子彈追蹤敵人」（不佔插座）' },
  weak:      { good: false, name: '效果 ×0.7', desc: '放在這格的晶片，插座上的組件效果 ×0.7' },
  nogrow:    { good: false, name: '不會成長', desc: '這格的玩法晶片不會用量成長' },
  heavy:     { good: false, name: '能量 +2', desc: '放在這格的晶片能量負載 +2' },
  flaky:     { good: false, name: '間歇失效', desc: '這格的晶片每 8 秒有 2 秒沒有作用' },
};
const GOOD_ATTRS = Object.keys(SLOT_ATTRS).filter(k => SLOT_ATTRS[k].good);
const BAD_ATTRS = Object.keys(SLOT_ATTRS).filter(k => !SLOT_ATTRS[k].good);
const BH_GOOD = [0.7, 0.8, 0.9];  // 投入的晶片等級 Lv1／Lv2／Lv3 → 好結果的機率
const flakyOff = () => Game.time % 8 >= 6;  // 間歇失效：每 8 秒的最後 2 秒沒有作用
const canSacrifice = id => !!id && !CHIPS[id].locked;  // 可以投入奇異點的晶片（武器以外都可以，插座上的組件也可以）

// ---------- 晶片 id：base、#等級（Lv2／Lv3，改玩法的晶片照用量成長）、~插座數 ----------
const LV_MARK = ['', '', '²', '³'];
const lvMulOf = lv => 1 + 0.5 * (lv - 1);
function chipId(base, lv = 1, sk = 0) {  // 動態建立 Lv2 / Lv3、有插座的晶片定義
  const id = base + (lv > 1 ? '#' + lv : '') + (sk > 0 ? '~' + sk : '');
  if (!CHIPS[id]) {
    const B = CHIPS[base], m = lvMulOf(lv), evo = lv >= 3 && B.evo;
    CHIPS[id] = { ...B, base, lv, lvMul: m, sk };
    if (lv > 1) Object.assign(CHIPS[id], { name: evo ? `${B.evo}（${B.name} Lv3）` : `${B.name} Lv${lv}`, short: evo ? B.evo.slice(0, 2) + '³' : B.short + LV_MARK[lv],
      desc: B.desc + `<br>${lvLine(base, lv)}` });
  }
  return id;
}
const leveledId = (base, lv) => chipId(base, lv, 0);
// 對方傳來的晶片 id：認得的才收（不認得的回傳 null）
function parseChipId(id) {
  if (typeof id !== 'string') return null;
  if (NORMAL_IDS.includes(id)) return id;
  const m = /^([a-z_]+)(?:#([23]))?(?:~([1-9]))?$/.exec(id);
  if (!m || !NORMAL_IDS.includes(m[1])) return null;
  const lv = m[2] ? +m[2] : 1, sk = m[3] ? Math.min(CFG.MAX_SOCKETS, +m[3]) : 0;
  if (lv > 1 && !CHIPS[m[1]].grow) return null;
  if (sk && !isHost(m[1])) return null;
  return chipId(m[1], lv, sk);
}
const baseOf = id => (id && CHIPS[id].base) || id;
const levelOf = id => (id && CHIPS[id].lv) || 1;
const canLevelUp = id => !!id && !!CHIPS[baseOf(id)].grow && levelOf(id) < CFG.MAX_CHIP_LV;
const sellPrice = id => Math.floor(chipPrice(id) * 0.4);

// 成長需求：雙人（隊友在線）×COOP_GROW
const growNeed = (base, lv) => Math.round(CHIPS[base].grow.need[lv - 1] * (Game.coopOn && Game.coopOn() ? CFG.COOP_GROW : 1));
// 用量成長的進度說明（編輯器、卡片用）：目前累積、下一級需要多少、本局平均每分鐘多少
function growLine(id, growth, minutes) {
  const base = baseOf(id), g = CHIPS[base] && CHIPS[base].grow;
  if (!g) return '';
  const lv = levelOf(id), have = Math.floor((growth && growth[base]) || 0);
  const rate = minutes > 0.05 ? `（本局每分鐘 +${(have / minutes).toFixed(1)}）` : '';
  if (lv >= CFG.MAX_CHIP_LV) return `<span style="color:#ffd166">已進化</span>　累積${g.what} ${have}${rate}`;
  return `<span style="color:#9dff6b">成長：${g.what} ${have} / ${growNeed(base, lv)}</span>${rate}　到了自動升 Lv${lv + 1}${lv + 1 >= 3 ? '（進化）' : ''}`;
}

// 開局電路：武器＋三選一的起始晶片（沒選就空著）
const startChain = chip => ['weapon', NORMAL_IDS.includes(chip) ? newChip(chip) : null, ...Array(CFG.START_SLOTS - 2).fill(null)];

// 沙盒的預設電路（宿主給滿插座，見 fullChip）
const PRESETS = {
  basic: ['weapon', 'split', 'amp', null],
  multi: ['weapon', 'split', 'mirror', 'amp'],
  focus: ['weapon', 'split', 'bigshot', 'pierce'],
  chain: ['weapon', 'trigger', 'split', 'trigger', 'amp', null],
  reso:  ['weapon', 'wallbounce', 'pierce', 'accel', null, null],
};
