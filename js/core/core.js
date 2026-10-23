// 星環電路 多人版 · core.js：子彈資料格式 shot()、增幅相加 addBonus、傷害歸屬（晶片傷害統計）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// 晶片的種類（見 chips.js）：飛船晶片（線頭）、晶片、插件（插在晶片的插座裡）
const TYPE_META = {
  source:  { label: '飛船', icon: '◉', color: '#4cc9f0' },
  chip:    { label: '晶片', icon: '➰', color: '#5ef2d0' },
  comp:    { label: '插件', icon: '◆', color: '#d4a373' },  // 青銅色
};

const PASSIVE_LABEL = {
  speed:  v => `移動速度 +${Math.round(v * 100)}%`,
  armor:  v => `受到傷害 -${Math.round(v * 100)}%`,
  maxHp:  v => `最大 HP +${v}`,
  dashCd: v => `衝刺冷卻 -${Math.round(v * 100)}%`,
  magnet: v => `拾取範圍 +${Math.round(v * 100)}%`,
  greed:  v => `晶體獲得 +${Math.round(v * 100)}%`,
};
// 條列說明（武器、飛船的 desc 是一串句子）：每句一條；畫面和電路第 1 格的說明（Game.refreshWeapon）共用
const descList = items => `<ul class="dlist">${items.map(s => `<li>${s}</li>`).join('')}</ul>`;

function shot(o) {
  return Object.assign({ angle: 0, speed: 600, damage: 10, radius: 4, pierce: 0, bounce: 0,
    homing: 0, life: 1, color: '#fff', shape: 'dot',
    explode: null, burn: null, arcs: null, slow: 0, knock: 1, lifesteal: 0, src: 'weapon', cr: null,
    boom: 0, stasis: 0, infect: 0, infGen: 0, park: null, hook: false,  // 晶片產物：迴旋刃、地雷、孢子（見 LINE_FX）；武器：停在場上、鉤爪
    ln: null }, o);  // ln：這顆是哪條線第幾格的產物（往下傳，見 Game.linePass）
}

const decay = (f, dt) => Math.pow(f, dt * 60);  // 「每幀乘 f」照 60fps 調的衰減 → 跟幀率無關（120fps 不會煞得比較快；10-22 以前直接 *= f）
const hitDamage = b => b.damage * (b.mode === 'park' && b.park.dmg || 1);  // 命中傷害；停在場上的照停住設定再乘（飛輪停住 ×DISC.parkMul）

// ---------- 晶片傷害歸屬 ----------
//   src：產生這顆子彈的來源（武器、鏡像複製的武器、觸發器的回響）→ 拿「基礎傷害」
//   cr ：加工過這顆子彈的晶片 → 各自記錄 ln(傷害倍率)；多出來的傷害依 ln 倍率比例分給它們
//   射速類晶片（超頻、冷卻管線）的貢獻由 analyzeChain 算成 rateCr，命中時一起分攤
// 命中之後才發生的倍率（黏著爆炸、地雷衝出去、迴旋回程）：把 ln(倍率) 記在那個晶片上
function attCredit(att, key, f) {
  if (!att || !(f > 0)) return att;
  return { ...att, cr: { ...(att.cr || {}), [key]: ((att.cr && att.cr[key]) || 0) + Math.log(f) } };
}
function splitDamage(amount, att, rateCr) {
  const w = {};
  for (const src of [att && att.cr, rateCr]) if (src) for (const k in src) w[k] = (w[k] || 0) + src[k];
  let L = 0;
  for (const k in w) if (w[k] > 0) L += w[k]; else delete w[k];
  const out = {}, base = amount * Math.exp(-L), srcKey = (att && att.src) || 'weapon';
  out[srcKey] = base;
  for (const k in w) out[k] = (out[k] || 0) + (amount - base) * w[k] / L;
  return out;
}
// 本局傷害統計的來源分類（結算畫面用）
const DMG_SOURCES = [
  ['direct', '直接命中', '#3987e5'],  // 武器子彈和晶片產物直接打中的（不是只有武器）
  ['echo', '回響', '#d55181'],
  ['turret', '砲台', '#ff8c42'],  // 哨兵號的砲台打出去的子彈（直擊；爆炸、燃燒等照各自的分類）
  ['explode', '爆炸', '#d95926'],
  ['burn', '燃燒', '#c98500'],
  ['arc', '電弧', '#5ec8ff'],
  ['shock', '震盪衝撞', '#9085e9'],
  ['comet', '彗星', '#bfe9ff'],  // 玩家打爆的彗星（碎片）；自己撞爆的不算任何人的
];
