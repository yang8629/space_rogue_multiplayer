// 星環電路 雙人版 · chips.js：晶片定義 CHIPS、等級 LV_INFO、合成升級、黑洞融合、起始電路
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

const CHIPS = {
  // ---------- 武器（固定在電路第 1 格，內容依目前武器與升級而定） ----------
  weapon: { name: '武器', short: '武器', type: 'source', cost: 0, locked: true, hidden: true, desc: '',
    emit: pw => weaponEmit(Game.wp, pw) },
  // 命中觸發器的子電路開頭：用武器再射一次，傷害 50%
  echo: { name: '武器回響', short: '回響', type: 'source', cost: 0, hidden: true, desc: '',
    emit: pw => weaponEmit(Game.wp, pw * 0.5) },

  // ---------- 變形器 ----------
  split: { name: '分裂模組', short: '分裂', type: 'mod', cost: 2,
    desc: '目前每顆子彈分裂為 3 顆扇形彈（共振時更多），每顆傷害 ×0.4（3 顆合計 ×1.2）。',
    apply: (list, pw) => {
      const n = Math.round(3 + 2 * (pw - 1));  // 共振 ×1.5 → 4 顆，×2 → 5 顆
      return list.flatMap(b => Array.from({ length: n }, (_, k) =>
        ({ ...b, angle: b.angle + (k - (n - 1) / 2) * 0.18, damage: b.damage * 0.4, splits: (b.splits || 0) + 1 })));
    } },
  focus: { name: '聚焦透鏡', short: '聚焦', type: 'mod', cost: 1, stored: { magnet: 0.6 },
    desc: '把目前所有子彈合併為 1 顆：傷害加總後再 +15%（和其他增幅相加），體積隨合併數量變大。放在分裂前後效果完全不同。',
    apply: (list, pw) => {
      let dmg = 0, ang = 0, pierce = 0, homing = 0, bounce = 0, bonus = 0;
      for (const b of list) {
        dmg += b.damage; ang += b.angle; bonus += b.damage * (b.bonus || 0);
        pierce = Math.max(pierce, b.pierce); homing = Math.max(homing, b.homing); bounce = Math.max(bounce, b.bounce);
      }
      const f = list[0];
      // 合併後的加成取各子彈加成的傷害加權平均，再加上聚焦自己的 +15%
      return [addBonus({ ...f, angle: ang / list.length, damage: dmg, bonus: dmg ? bonus / dmg : 0,
        radius: Math.min(18, f.radius + list.length * 0.9), pierce, homing, bounce }, 0.15 * pw)];
    } },
  pierce: { name: '穿甲塗層', short: '穿甲', type: 'mod', cost: 1, stored: { armor: 0.1 },
    desc: '目前所有子彈穿透 +2。',
    apply: (list, pw) => list.map(b => ({ ...b, pierce: b.pierce + Math.round(2 * pw) })) },
  ricochet: { name: '彈射模組', short: '彈射', type: 'mod', cost: 2, stored: { speed: 0.08 },
    desc: '子彈命中後轉向附近另一名敵人（+2 次，優先於穿透），碰到邊界也會反彈。',
    apply: (list, pw) => list.map(b => ({ ...b, bounce: b.bounce + Math.round(2 * pw), life: b.life + 0.4 })) },

  // ---------- 增幅器 ----------
  amp: { name: '威力倍增器', short: '倍增', type: 'amp', cost: 3,
    desc: '目前所有子彈傷害 +100%。增幅加成彼此相加（兩個倍增器是 ×3，不是 ×4）。只影響「它左邊」已產生的子彈。',
    apply: (list, pw) => list.map(b => addBonus(b, pw)) },
  enlarge: { name: '巨大化線圈', short: '巨大', type: 'amp', cost: 1, stored: { maxHp: 20 },
    desc: '目前所有子彈體積 ×1.8、傷害 +30%、擊退 +0.5，速度 ×0.8。',
    apply: (list, pw) => list.map(b => ({ ...addBonus(b, 0.3 * pw), radius: b.radius * (1 + 0.8 * pw), speed: b.speed * 0.8,
      knock: (b.knock == null ? 1 : b.knock) + 0.5 * pw })) },
  overclock: { name: '超頻核心', short: '超頻', type: 'amp', cost: 0, rate: 0.7, stored: { dashCd: 0.25 },
    desc: `整條電路${rateTxt(0.7)}；目前子彈傷害 -15%、速度 ×1.2。`,
    apply: list => list.map(b => ({ ...addBonus(b, -0.15), speed: b.speed * 1.2 })) },

  // ---------- 晶片流：數量越多越強 ----------
  synergy: { name: '協同處理器', short: '協同', type: 'amp', cost: 2, stored: { maxHp: 10 },
    desc: '電路中每有 1 個其他晶片，目前子彈傷害 +12%（不含武器與廢鐵）。',
    apply: (list, pw, o) => list.map(b => addBonus(b, 0.12 * pw * (o ? o.n : 0))) },
  coolant: { name: '冷卻管線', short: '冷卻', type: 'amp', cost: 0, cool: 3, stored: { armor: 0.05 },
    desc: '整條電路的能量負載 -3（最低 0），射速因此變快。本身不影響子彈。',
    apply: list => list },
  datalink: { name: '資料鏈結', short: '鏈結', type: 'amp', cost: 0, stored: { greed: 0.1 },
    desc: '倉庫中每有 1 個晶片，目前子彈傷害 +10%。鼓勵把倉庫塞滿。',
    apply: (list, pw) => {
      const n = Game.inventory.filter(Boolean).length;
      return list.map(b => addBonus(b, 0.1 * pw * n));
    } },

  // ---------- 觸發器 ----------
  trigger: { name: '命中觸發器', short: '觸發', type: 'trigger', cost: 1,
    desc: '子彈命中敵人時，從命中點用武器再射一次（傷害 50%，升級與共振會提高），並套用觸發器右側的晶片。右側晶片不會在開火時執行。最多巢狀 3 層。' },

  // ---------- 連結器（相鄰效果） ----------
  resonator: { name: '共振器', short: '共振', type: 'link', cost: 1, stored: { greed: 0.2 },
    desc: '本身不作用。左右相鄰的晶片效果 +50%（兩個共振器夾同一格可疊加）。' },
  mirror: { name: '鏡像迴路', short: '鏡像', type: 'link', cost: 2,
    desc: '複製「左側相鄰」晶片的效果，在這一格再執行一次（放在武器右邊 = 武器多射一次）。' },

  // ---------- 軍規複合晶片（精英掉落） ----------
  c_fission: { name: '裂變倍增核', short: '裂倍', type: 'composite', cost: 4, combo: ['split', 'amp'] },
  c_rail:    { name: '穿甲彈射', short: '穿彈', type: 'composite', cost: 2, combo: ['pierce', 'ricochet'] },
  c_bounce:  { name: '巨像倍增', short: '巨倍', type: 'composite', cost: 3, combo: ['enlarge', 'amp'] },
  c_fuse:    { name: '分裂引信', short: '引信', type: 'composite', cost: 2, combo: ['split', 'trigger'] },
  c_swarm:   { name: '聚焦穿甲', short: '焦甲', type: 'composite', cost: 1, combo: ['focus', 'pierce'] },
  c_lens:    { name: '超頻聚焦', short: '頻焦', type: 'composite', cost: 1, combo: ['focus', 'overclock'] },

  // ---------- 黑洞融合相關 ----------
  scrap: { name: '廢鐵', short: '廢鐵', type: 'scrap', cost: 0, locked: true, hidden: true,
    desc: '融合失敗的殘骸。卡住插槽、沒有任何效果，無法移動或回收，只能在補給站花錢拆除。' },
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
for (const d of Object.values(CHIPS))
  if (d.combo) d.desc = '一格內依序執行：' + d.combo.map(c => CHIPS[c].name).join(' → ') + '。';

// 「強度」＝晶片效果的倍率（Lv2 ×1.5、Lv3 ×2，共振器也會提高）。這裡寫出每種晶片各等級的實際數值
const LV_INFO = {
  split:     ['分裂數量', ['3 顆', '4 顆', '5 顆']],
  focus:     ['合併後傷害加成', ['+15%', '+22.5%', '+30%']],
  pierce:    ['穿透', ['+2', '+3', '+4']],
  ricochet:  ['彈射次數', ['+2', '+3', '+4']],
  amp:       ['傷害加成', ['+100%', '+150%', '+200%']],
  enlarge:   ['體積／傷害加成／擊退', ['×1.8／+30%／+0.5', '×2.2／+45%／+0.75', '×2.6／+60%／+1']],
  overclock: ['射速', [1, 1.5, 2].map(k => rateTxt(0.7 ** k).replace('射速', ''))],
  synergy:   ['每個其他晶片的傷害加成', ['+12%', '+18%', '+24%']],
  coolant:   ['能量負載', ['-3', '-4.5', '-6']],
  datalink:  ['每個倉庫晶片的傷害加成', ['+10%', '+15%', '+20%']],
  trigger:   ['命中時武器回響傷害', ['50%', '75%', '100%']],
  resonator: ['相鄰晶片強度', ['+50%', '+75%', '+100%']],
};
const lvLine = (base, cur) => {
  const L = LV_INFO[base];
  if (!L) return '';
  return `${L[0]}：` + L[1].map((v, i) => i + 1 === cur ? `<b style="color:#9dff6b">Lv${i + 1} ${v}</b>` : `Lv${i + 1} ${v}`).join(' → ') +
    '<br><span style="color:#6a79ad">倉庫被動也會 ×1.5／×2。</span>';
};

const NORMAL_IDS = Object.keys(CHIPS).filter(id => CHIPS[id].type !== 'composite' && !CHIPS[id].hidden);
const COMPOSITE_IDS = Object.keys(CHIPS).filter(id => CHIPS[id].type === 'composite');
const OVERLOADS = ['ov_power', 'ov_rate', 'ov_pierce', 'ov_seek'];
const chipPrice = id => {
  const t = CHIPS[id].type;
  return t === 'scrap' ? 0 : t === 'composite' || t === 'singularity' ? 90 : (30 + CHIPS[id].cost * 8) * levelOf(id);
};

// ---------- 晶片等級：再拿到同種晶片時自動合成 Lv2 → Lv3 ----------
const LV_MARK = ['', '', '²', '³'];
const lvMulOf = lv => 1 + 0.5 * (lv - 1);
function leveledId(base, lv) {  // 動態建立 Lv2 / Lv3 版本的晶片定義
  if (lv <= 1) return base;
  const id = base + '#' + lv;
  if (!CHIPS[id]) {
    const B = CHIPS[base], m = lvMulOf(lv);
    CHIPS[id] = { ...B, name: `${B.name} Lv${lv}`, short: B.short + LV_MARK[lv], base, lv, lvMul: m,
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

// 黑洞融合成功：兩個晶片的效果合進一格，再附加一個隨機超載詞綴
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
  focus: ['weapon', 'split', 'focus', 'enlarge'],
  chain: ['weapon', 'trigger', 'split', 'trigger', 'amp', null],
  reso:  ['weapon', 'resonator', 'split', 'resonator', 'amp', null],
};
