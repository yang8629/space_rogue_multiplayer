// 星環電路 雙人版 · chips.js：晶片定義 CHIPS、等級 LV_INFO、用量成長、合成升級、黑洞融合、起始電路
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// V2 晶片池：
//   改玩法的晶片（彈道／發射／命中／機體）：照著它的玩法打就會成長（grow），Lv3 進化（evo，改名、玩法再變一次）
//   數值晶片（分裂、巨彈、穿甲、倍增、超頻模組）與觸發器、鏡像：只能靠合成（撿到重複的）升級
//   所有晶片都遵守順序規則：只作用在「它左邊」已經產生的子彈
const CHIPS = {
  // ---------- 武器（固定在電路第 1 格，內容依目前武器與升級而定） ----------
  weapon: { name: '武器', short: '武器', type: 'source', cost: 0, locked: true, hidden: true, desc: '',
    emit: pw => weaponEmit(Game.wp, pw) },
  // 命中觸發器的子電路開頭：用武器再射一次，傷害 50%
  echo: { name: '武器回響', short: '回響', type: 'source', cost: 0, hidden: true, desc: '',
    emit: pw => weaponEmit(Game.wp, pw * 0.5) },

  // ---------- 彈道：子彈怎麼飛 ----------
  boomerang: { name: '迴旋', short: '迴旋', type: 'path', cost: 2, evo: '迴旋風暴',
    grow: { what: '回程命中', need: [180, 540] },
    desc: '去程打中敵人就穿過去折返（有穿甲時穿甲用完才折返），回程會再打牠一次，沒打中就飛到 60% 射程折返；回程飛回飛船，一路無限穿透（最多 1 秒）。傷害 ×0.7。',
    lvs: ['回程傷害 ×1', '回程傷害 ×1.5', '進化：折返時分裂成 3 發'],
    apply: (list, pw, o) => list.map(b => ({ ...b, boom: o.lv, damage: b.damage * 0.7, life: b.life * 0.6 })) },
  orbit: { name: '環繞', short: '環繞', type: 'path', cost: 2, evo: '星環',
    grow: { what: '繞圈或放出後命中', need: [180, 540] },
    desc: '按住射擊時子彈存在飛船旁邊繞圈（碰到敵人照打，同一隻隔 0.5 秒可再打；每打一次扣一次穿甲，用完消失），越繞越快；放開射擊時全部從所在位置朝滑鼠那一點射出，轉越快放出越快：速度倍率就是傷害倍率（Lv1 最多 ×1.5，Lv2 最多 ×2）。右邊晶片的效果從射出後開始。',
    lvs: ['最多存 10 發（一次開火算一發）；3 秒轉滿（放出 ×1.5 速度與傷害）', '最多存 20 發；2 秒轉滿（放出 ×2 速度與傷害）', '進化：射出的子彈追蹤敵人'],
    apply: (list, pw, o) => list.map(b => ({ ...b, orbit: o.lv })) },
  stasis: { name: '停滯', short: '停滯', type: 'path', cost: 1, evo: '伏擊網',
    grow: { what: '擋下敵彈', need: [45, 135] },
    desc: '子彈飛一小段後停住，擋下碰到的敵彈（每擋一發扣一次穿甲，用完就消失）；時間到衝出去：附近有敵人就衝向它，否則照原方向。停住時不會打到敵人。',
    lvs: ['停 1.5 秒，追蹤範圍 150', '停 2.5 秒，追蹤範圍 220', '進化：停住的子彈之間拉出電弧，碰到的敵人持續受傷'],
    apply: (list, pw, o) => list.map(b => ({ ...b, stasis: o.lv })) },
  accel: { name: '加速', short: '加速', type: 'path', cost: 1, evo: '超音速',
    grow: { what: '1.5 倍速以上命中', need: [120, 360] },
    desc: '子彈出手只有 0.5 倍速，越飛越快。速度倍率就是傷害倍率（最多 ×4），所以近距離很虧、遠距離很痛。搭環繞：從放出時的速度倍率繼續加上去，不相乘。',
    lvs: ['從 0.5 倍開始，每秒 +3 倍速', '從 0.5 倍開始，每秒 +4.5 倍速', '進化：速度超過 2 倍時無限穿透'],
    apply: (list, pw, o) => list.map(b => ({ ...b, accel: o.lv })) },
  quick: { name: '疾射', short: '疾射', type: 'path', cost: 1, evo: '衝擊',
    grow: { what: '1.5 倍速以上命中', need: [80, 240] },
    desc: '子彈出手時速度倍率 +1（Lv2 +1.5），之後照飛行距離變慢（最低 0.5 倍）。速度倍率就是傷害倍率，所以近距離很痛、遠距離變弱，射程也變短；不管武器快慢都一樣。跟加速、環繞放出加在同一個倍率上，不相乘。',
    lvs: ['出手 ×2，每飛 200 −1', '出手 ×2.5，每飛 250 −1', '進化：2 倍速以上打中時強力擊退（×3）'],
    apply: (list, pw, o) => list.map(b => ({ ...b, quick: o.lv })) },
  wallbounce: { name: '牆反彈', short: '反彈', type: 'path', cost: 1, evo: '稜鏡',
    grow: { what: '反彈次數', need: [300, 900] },
    desc: '射程 ×1.5，子彈碰到場地邊緣會反彈。搭配穿透（穿甲、加速 Lv3、蓄力 Lv3）效果最好：打中敵人的子彈沒有穿透就會消失。',
    lvs: ['反彈 1 次', '反彈 3 次', '進化：每次反彈分裂成 2 發'],
    apply: (list, pw, o) => list.map(b => ({ ...b, bounce: b.bounce + (o.lv >= 2 ? 3 : 1), life: b.life * 1.5, prism: o.lv >= 3 })) },

  // ---------- 發射：從哪裡、朝哪裡射 ----------
  rear: { name: '反向', short: '反向', type: 'launch', cost: 2, evo: '全向',
    grow: { what: '反向子彈命中', need: [30, 90] },
    desc: '目前的子彈另外朝反方向也射一份。',
    lvs: ['反方向 1 份', '反方向 2 份（稍微張開）', '進化：前後左右 4 個方向'],
    apply: (list, pw, o) => {
      const offs = o.lv >= 3 ? [Math.PI, Math.PI / 2, -Math.PI / 2] : o.lv >= 2 ? [Math.PI - 0.12, Math.PI + 0.12] : [Math.PI];
      return [...list, ...offs.flatMap(d => list.map(b => ({ ...b, angle: b.angle + d, rear: true })))];
    } },
  charge: { name: '蓄力', short: '蓄力', type: 'launch', cost: 0, evo: '過載砲',
    grow: { what: '蓄滿命中', need: [30, 90] },
    desc: '停止射擊時開始蓄力；再按下射擊的第一發依蓄力程度變強（蓄滿：左邊的子彈傷害 ×5、體積 ×2.5），之後照常連射。',
    lvs: ['蓄滿要 1 秒', '蓄滿只要 0.6 秒', '進化：蓄滿的一發無限穿透，飛到盡頭爆炸'],
    apply: (list, pw, o) => {
      const c = Game.chargeC || 0, full = c >= 0.999;  // 只有玩家開火的第一發帶蓄力（觸發、衝刺射擊、擦彈都是 0）
      return list.map(b => ({ ...b, damage: b.damage * (1 + 4 * c), radius: b.radius * (1 + 1.5 * c), speed: b.speed * (1 - 0.2 * c),
        full: full ? o.lv : 0, pierce: full && o.lv >= 3 ? 99 : b.pierce, endBoom: full && o.lv >= 3, color: full ? '#ffffff' : b.color }));
    } },

  // ---------- 命中之後 ----------
  sticky: { name: '黏著', short: '黏著', type: 'impact', cost: 1, evo: '連鎖引爆',
    grow: { what: '一次引爆 5 發以上', need: [30, 90] },
    desc: '子彈黏在敵人身上（先造成 30% 傷害），2 秒後黏著的子彈一起爆炸。會穿透的子彈每穿過一隻就留一份，穿甲用完才黏住。適合打血厚的敵人。',
    lvs: ['爆炸 ×2', '爆炸 ×3', '進化：爆炸波及周圍，並立刻引爆鄰近敵人身上的子彈'],
    apply: (list, pw, o) => list.map(b => ({ ...b, sticky: o.lv })) },
  infect: { name: '感染', short: '感染', type: 'impact', cost: 2, evo: '瘟疫',
    grow: { what: '爆出的子彈命中', need: [15, 45] },
    desc: '被這些子彈擊殺的敵人爆出子彈（傷害 ×1.5，帶著這發子彈身上的晶片效果）。',
    lvs: ['爆出 3 發', '爆出 5 發', '進化：爆出的子彈也帶感染（最多傳 2 代）'],
    apply: (list, pw, o) => list.map(b => ({ ...b, infect: o.lv })) },
  pull: { name: '吸引', short: '吸引', type: 'impact', cost: 1, evo: '引力漩渦',
    grow: { what: '被拉過的敵人', need: [500, 1500] },
    desc: '命中時把附近的敵人往命中點拉（旗艦不會被拉）。',
    lvs: ['範圍 90', '範圍 130', '進化：每命中 8 次生成一個 1.5 秒的引力漩渦'],
    apply: (list, pw, o) => list.map(b => ({ ...b, pull: o.lv })) },

  // ---------- 跟機體連動 ----------
  dashfire: { name: '衝刺射擊', short: '衝射', type: 'body', cost: 1, evo: '流星',
    grow: { what: '衝刺子彈命中', need: [40, 120] },
    desc: '衝刺結束時，用整條電路朝準星額外開一槍（傷害 ×1.5，不佔射擊冷卻；有停火蓄力時會用掉蓄力）。平常開火不受影響。',
    lvs: ['開 1 槍', '連開 2 槍', '進化：衝刺穿過的敵人受到重擊（武器傷害 ×5）'],
    apply: list => Game.fireMode !== 'dashfire' ? list : list.map(b => ({ ...b, damage: b.damage * 1.5, dashShot: true })) },
  graze: { name: '擦彈', short: '擦彈', type: 'body', cost: 1, evo: '反射鏡',
    grow: { what: '擦彈次數', need: [25, 75] },
    desc: '敵彈從身邊擦過（沒打中）時，用整條電路朝最近的敵人回射（不會用掉停火蓄力）。平常開火不受影響。',
    lvs: ['擦彈範圍 18，回射 1 份', '擦彈範圍 30，回射 2 份', '進化：擦過的敵彈直接被吸收，回射 3 份'],
    apply: (list, pw, o) => {
      if (Game.fireMode !== 'graze' || !list.length) return list;
      const n = Math.min(3, o.lv);
      return Array.from({ length: n }, (_, k) => list.map(b => ({ ...b, angle: b.angle + (k - (n - 1) / 2) * 0.15 }))).flat();
    } },

  // ---------- 數值晶片（只能靠合成升級） ----------
  split: { name: '分裂模組', short: '分裂', type: 'mod', cost: 2,
    desc: '目前每顆子彈分裂為 3 顆扇形彈，每顆傷害 ×0.4（3 顆合計 ×1.2）。子彈變多，搭感染、黏著、稜鏡。',
    apply: (list, pw) => {
      const n = Math.round(3 + 2 * (pw - 1));  // Lv2 → 4 顆，Lv3 → 5 顆
      return list.flatMap(b => Array.from({ length: n }, (_, k) =>
        ({ ...b, angle: b.angle + (k - (n - 1) / 2) * 0.18, damage: b.damage * 0.4, splits: (b.splits || 0) + 1 })));
    } },
  bigshot: { name: '巨彈', short: '巨彈', type: 'mod', cost: 1,
    desc: '子彈數量減半（兩兩合併，最少 1 發），合併的傷害加總後再 +30%；子彈體積 ×1.8、擊退變強。跟分裂方向相反，兩個都裝時照順序算。',
    apply: (list, pw) => {
      const out = [];
      for (let i = 0; i < list.length; i += 2) {
        const g = list.slice(i, i + 2), f = g[0];
        let dmg = 0, bonus = 0;
        for (const b of g) { dmg += b.damage; bonus += b.damage * (b.bonus || 0); }
        const ang = g.reduce((a, b) => a + b.angle, 0) / g.length;
        out.push(addBonus({ ...f, angle: ang, damage: dmg, bonus: dmg ? bonus / dmg : 0,
          pierce: Math.max(...g.map(b => b.pierce)), radius: Math.min(22, f.radius * (1 + 0.8 * pw)),
          knock: (f.knock == null ? 1 : f.knock) + 0.5 * pw }, 0.3 * pw));
      }
      return out;
    } },
  pierce: { name: '穿甲塗層', short: '穿甲', type: 'mod', cost: 1, stored: { armor: 0.1 },
    desc: '目前所有子彈穿透 +2。同一發子彈不會連續打同一隻敵人（撞牆反彈後可以再打）。',
    apply: (list, pw) => list.map(b => ({ ...b, pierce: b.pierce + Math.round(2 * pw) })) },
  amp: { name: '威力倍增器', short: '倍增', type: 'amp', cost: 3,
    desc: '目前所有子彈傷害 +100%。增幅加成彼此相加（兩個倍增器是 ×3，不是 ×4）。只影響「它左邊」已產生的子彈。',
    apply: (list, pw) => list.map(b => addBonus(b, pw)) },
  overclock: { name: '超頻模組', short: '超頻', type: 'amp', cost: 2, rate: 0.5, rateFixed: true,
    desc: `整條電路${rateTxt(0.5)}，但連續射擊一段時間後會過熱，停火 1.5 秒。停止射擊時會慢慢散熱。`,
    heatLimit: [3, 4, 5],
    apply: list => list },

  // ---------- 觸發器 ----------
  trigger: { name: '命中觸發器', short: '觸發', type: 'trigger', cost: 1,
    desc: '子彈命中敵人時，從命中點用武器再射一次（傷害 50%，升級會提高），並套用觸發器右側的晶片。右側晶片不會在開火時執行。最多巢狀 3 層。' },

  // ---------- 連結器 ----------
  mirror: { name: '鏡像迴路', short: '鏡像', type: 'link', cost: 2,
    desc: '複製「左側相鄰」晶片的效果，在這一格再執行一次（放在武器右邊 = 武器多射一次）。只能複製武器和數值晶片；接在玩法晶片（彈道、發射、命中、機體）後面沒有效果。' },

  // ---------- 黑洞融合相關 ----------
  scrap: { name: '廢鐵', short: '廢鐵', type: 'scrap', cost: 0, locked: true, hidden: true,
    desc: '融合失敗的殘骸。卡住插槽、沒有任何效果，無法移動或回收，只能在維修站花錢拆除。' },
  // 奇異點超載詞綴（隱藏晶片，只會出現在融合結果裡）
  ov_power:  { name: '超載・威力', type: 'amp', cost: 0, hidden: true, desc: '傷害 +50%',
    apply: list => list.map(b => addBonus(b, 0.5)) },
  ov_rate:   { name: '超載・頻率', type: 'amp', cost: 0, hidden: true, rate: 0.8, desc: '整條電路' + rateTxt(0.8),
    apply: list => list },
  ov_pierce: { name: '超載・貫穿', type: 'mod', cost: 0, hidden: true, desc: '穿透 +1',
    apply: list => list.map(b => ({ ...b, pierce: b.pierce + 1 })) },
  ov_seek:   { name: '超載・導引', type: 'mod', cost: 0, hidden: true, desc: '子彈追蹤敵人',
    apply: list => list.map(b => ({ ...b, homing: b.homing + 3 })) },
};

// 「強度」＝晶片效果的倍率（Lv2 ×1.5、Lv3 ×2）。這裡寫出每種數值晶片各等級的實際數值；改玩法的晶片用 lvs
const LV_INFO = {
  split:     ['分裂數量', ['3 顆', '4 顆', '5 顆']],
  bigshot:   ['傷害加成／體積', ['+30%／×1.8', '+45%／×2.2', '+60%／×2.6']],
  pierce:    ['穿透', ['+2', '+3', '+4']],
  amp:       ['傷害加成', ['+100%', '+150%', '+200%']],
  overclock: ['連續射擊多久過熱', ['3 秒', '4 秒', '5 秒']],
  trigger:   ['命中時武器回響傷害', ['50%', '75%', '100%']],
};
for (const [id, d] of Object.entries(CHIPS)) if (d.lvs) LV_INFO[id] = ['等級', d.lvs];
const lvLine = (base, cur) => {
  const L = LV_INFO[base];
  if (!L) return '';
  return `${L[0]}：` + L[1].map((v, i) => i + 1 === cur ? `<b style="color:#9dff6b">Lv${i + 1} ${v}</b>` : `Lv${i + 1} ${v}`).join(' → ') +
    (CHIPS[base].stored ? '<br><span style="color:#6a79ad">倉庫被動也會 ×1.5／×2。</span>' : '');
};

const NORMAL_IDS = Object.keys(CHIPS).filter(id => CHIPS[id].type !== 'composite' && !CHIPS[id].hidden);
const COMPOSITE_IDS = [];  // V2 拿掉了軍規複合晶片（精英改給背包模組）
const OVERLOADS = ['ov_power', 'ov_rate', 'ov_pierce', 'ov_seek'];
const chipPrice = id => {
  const t = CHIPS[id].type;
  return t === 'scrap' ? 0 : t === 'composite' || t === 'singularity' ? 90 : (30 + CHIPS[id].cost * 8) * levelOf(id);
};

// ---------- 晶片等級：再拿到同種晶片時自動合成 Lv2 → Lv3；改玩法的晶片也會照用量成長 ----------
const LV_MARK = ['', '', '²', '³'];
const lvMulOf = lv => 1 + 0.5 * (lv - 1);
function leveledId(base, lv) {  // 動態建立 Lv2 / Lv3 版本的晶片定義
  if (lv <= 1) return base;
  const id = base + '#' + lv;
  if (!CHIPS[id]) {
    const B = CHIPS[base], m = lvMulOf(lv), evo = lv >= 3 && B.evo;
    CHIPS[id] = { ...B, name: evo ? `${B.evo}（${B.name} Lv3）` : `${B.name} Lv${lv}`, short: evo ? B.evo.slice(0, 2) + '³' : B.short + LV_MARK[lv],
      base, lv, lvMul: m,
      desc: B.desc + `<br>${lvLine(base, lv)}`,
      stored: B.stored && Object.fromEntries(Object.entries(B.stored).map(([k, v]) => [k, +(v * m).toFixed(3)])) };
  }
  return id;
}
const baseOf = id => (id && CHIPS[id].base) || id;
const levelOf = id => (id && CHIPS[id].lv) || 1;
const canLevelUp = id => !!id && NORMAL_IDS.includes(baseOf(id)) && baseOf(id) !== 'mirror' && levelOf(id) < CFG.MAX_CHIP_LV;
const sellPrice = id => Math.floor(chipPrice(id) * 0.4);
const canFuse = id => id && !CHIPS[id].locked && !['link', 'scrap'].includes(CHIPS[id].type);

// 用量成長的進度說明（編輯器、卡片用）：目前累積、下一級需要多少、本局平均每分鐘多少
function growLine(id, growth, minutes) {
  const base = baseOf(id), g = CHIPS[base] && CHIPS[base].grow;
  if (!g) return '';
  const lv = levelOf(id), have = Math.floor((growth && growth[base]) || 0);
  const rate = minutes > 0.05 ? `（本局每分鐘 +${(have / minutes).toFixed(1)}）` : '';
  if (lv >= CFG.MAX_CHIP_LV) return `<span style="color:#ffd166">已進化</span>　累積${g.what} ${have}${rate}`;
  return `<span style="color:#9dff6b">成長：${g.what} ${have} / ${g.need[lv - 1]}</span>${rate}　到了自動升 Lv${lv + 1}${lv + 1 >= 3 ? '（進化）' : ''}`;
}

// 黑洞融合成功：兩個晶片的效果合進一格，再附加一個隨機超載詞綴（融合後不會再照用量成長）
let singularityCount = 0;
function fuseChips(a, b) {
  const A = CHIPS[a], B = CHIPS[b], affix = pick(OVERLOADS);
  const combo = [...(A.combo || [a]), ...(B.combo || [b]), affix];
  const id = 'sg_' + (++singularityCount);
  CHIPS[id] = { name: `奇異點・${A.short}${B.short}`, short: '奇異', type: 'singularity',
    cost: Math.ceil((A.cost + B.cost) * 0.6), combo,
    desc: '一格內依序執行：' + combo.filter(c => !CHIPS[c].hidden).map(c => CHIPS[c].name).join(' → ') +
      `。附加 <b style="color:#e0aaff">${CHIPS[affix].name}</b>（${CHIPS[affix].desc}）。` };
  return id;
}

// 開局電路：武器＋三選一的起始晶片（沒選就空著）
const startChain = chip => ['weapon', NORMAL_IDS.includes(chip) ? chip : null, ...Array(CFG.START_SLOTS - 2).fill(null)];

const PRESETS = {
  basic: ['weapon', 'split', 'amp', null],
  multi: ['weapon', 'mirror', 'split', 'amp'],
  focus: ['weapon', 'split', 'bigshot', 'pierce'],
  chain: ['weapon', 'trigger', 'split', 'trigger', 'amp', null],
  reso:  ['weapon', 'wallbounce', 'pierce', 'accel', null, null],
};
