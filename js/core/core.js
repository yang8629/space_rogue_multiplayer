// 星環電路 雙人版 · core.js：子彈資料格式 shot()、增幅相加 addBonus、傷害歸屬（晶片傷害統計）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// CHIP DATABASE — 電路晶片定義
//   source   : emit(pw)         → 產生新子彈，追加到清單
//   mod/amp  : apply(list, pw)  → 加工目前清單中所有子彈
//   trigger  : 右側晶片成為「命中時」的子管線
//   link     : 不直接作用，影響相鄰插槽（共振 / 鏡像）
//   composite: combo 內的晶片依序執行（佔 1 格）
//   pw = 共振倍率（1 = 無共振）
//   stored   : 放在倉庫時提供的被動效果
// =====================================================================
const TYPE_META = {
  source:    { label: '發射源', icon: '◉', color: '#4cc9f0' },
  path:      { label: '彈道', icon: '➰', color: '#5ef2d0' },
  launch:    { label: '發射', icon: '✧', color: '#ffb347' },
  impact:    { label: '命中', icon: '✷', color: '#f78cff' },
  body:      { label: '機體', icon: '⬢', color: '#9dff6b' },
  mod:       { label: '變形器', icon: '◇', color: '#b388ff' },
  amp:       { label: '增幅器', icon: '▲', color: '#ffd166' },
  trigger:   { label: '觸發器', icon: '◎', color: '#ff6b9d' },
  link:      { label: '連結器', icon: '⇄', color: '#2ee6a6' },
  composite: { label: '軍規複合', icon: '✦', color: '#ff9f1c' },
  singularity: { label: '奇異點', icon: '✺', color: '#e0aaff' },
  scrap:     { label: '廢鐵', icon: '✖', color: '#8a8f98' },
};

const PASSIVE_LABEL = {
  speed:  v => `移動速度 +${Math.round(v * 100)}%`,
  armor:  v => `受到傷害 -${Math.round(v * 100)}%`,
  maxHp:  v => `最大 HP +${v}`,
  dashCd: v => `衝刺冷卻 -${Math.round(v * 100)}%`,
  magnet: v => `拾取範圍 +${Math.round(v * 100)}%`,
  greed:  v => `晶體獲得 +${Math.round(v * 100)}%`,
};

function shot(o) {
  return Object.assign({ angle: 0, speed: 600, damage: 10, radius: 4, pierce: 0, bounce: 0,
    homing: 0, life: 1, color: '#fff', shape: 'dot', payload: null,
    explode: null, burn: null, shards: null, arcs: null, slow: 0, knock: 1, lifesteal: 0, shard: false, src: 'weapon', cr: null,
    // V2 改玩法的晶片（見 chips.js）：各自的等級，0 = 沒有
    boom: 0, orbit: 0, stasis: 0, accel: 0, quick: 0, intercept: 0, parry: false, prism: false, rear: false, full: 0, endBoom: false, sticky: 0, infect: 0, pull: 0,
    dashShot: false, infGen: 0 }, o);
}

// ---------- 增幅相加：每顆子彈記住累積的加成 bonus，傷害 ＝ 基礎 ×（1 ＋ 所有加成的總和） ----------
//   分裂、子彈上限換算、聚焦合併這些「數量」類的變化仍然是相乘，只有增幅類的百分比加成是相加
// 命中傷害：加成池全部相加（倍增、巨彈、蓄力、速度倍率…），照武器原本的傷害算，不會互相相乘
//   速度倍率（加速、疾射、環繞放出）打中時才知道，所以在這裡加進去：1 + 加成 + (速度倍率 − 1)
const hitDamage = b => b.damage / Math.max(0.1, 1 + (b.bonus || 0)) * Math.max(0.1, 1 + (b.bonus || 0) + (b.accelMul || 1) - 1);
function addBonus(b, add) {
  const old = b.bonus || 0, nb = old + add;
  return { ...b, bonus: nb, damage: b.damage / Math.max(0.1, 1 + old) * Math.max(0.1, 1 + nb) };
}

// ---------- 晶片傷害歸屬 ----------
//   src：產生這顆子彈的來源（武器、鏡像複製的武器、觸發器的回響）→ 拿「基礎傷害」
//   cr ：加工過這顆子彈的晶片 → 各自記錄 ln(傷害倍率)；多出來的傷害依 ln 倍率比例分給它們
//   射速類晶片（超頻、冷卻管線）的貢獻由 analyzeChain 算成 rateCr，命中時一起分攤
function creditFactor(list, key, f) {
  if (!key || !(f > 0) || Math.abs(Math.log(f)) < 1e-9) return list;
  const lf = Math.log(f);
  for (const b of list) b.cr = Object.assign({}, b.cr, { [key]: ((b.cr && b.cr[key]) || 0) + lf });
  return list;
}
// 命中之後才發生的倍率（黏著爆炸、地雷衝出去、迴旋回程）：把 ln(倍率) 記在那個晶片上
function attCredit(att, key, f) {
  if (!att || !(f > 0)) return att;
  return { ...att, cr: { ...(att.cr || {}), [key]: ((att.cr && att.cr[key]) || 0) + Math.log(f) } };
}
// 好幾發合在一起的傷害（黏著一起爆炸）：各晶片的 ln 倍率照每一發的傷害加權平均
function mergeAtt(list) {
  const tot = list.reduce((a, q) => a + q.w, 0) || 1, cr = {};
  for (const { att, w } of list) if (att && att.cr) for (const k in att.cr) cr[k] = (cr[k] || 0) + att.cr[k] * w / tot;
  return { ...list[0].att, cr };
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
function dmgKeyName(key) {
  if (key === 'weapon') return '武器・' + weaponTitle(Game.weapon);
  if (key === 'ship') return '機體（零件・模組）';
  const d = CHIPS[key];
  return d ? d.name : key;
}
function dmgKeyColor(key) {
  return key === 'weapon' ? WEAPONS[Game.weapon.id].color : key === 'ship' ? SHIPS[Game.shipId].color
    : CHIPS[key] ? TYPE_META[CHIPS[key].type].color : '#8fa3d9';
}

// 本局傷害統計的來源分類（結算畫面用）
const DMG_SOURCES = [
  ['direct', '武器直擊', '#3987e5'],
  ['echo', '命中觸發（回響）', '#d55181'],
  ['explode', '爆炸', '#d95926'],
  ['burn', '燃燒', '#c98500'],
  ['shard', '碎片', '#199e70'],
  ['arc', '電弧', '#5ec8ff'],
  ['shock', '震盪衝撞', '#9085e9'],
];
