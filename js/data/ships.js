// 星環電路 雙人版 · ships.js：4 艘飛船（V2：飛船是「開局配置」，成長都走零件）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SHIPS — 船體數值相同（HP 100、速度 270、衝刺冷卻 1.8 秒），差別在開局帶的零件；
//   星門號沒有開局零件，改成獨有的衝刺能力（傳送門）
// =====================================================================
const SHIPS = {
  vanguard: { name: '先鋒號', en: 'VANGUARD', color: '#4cc9f0', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[17, 0], [-10, -11], [-5, 0], [-10, 11]],
    parts: {}, partSlots: 8, cap: 4,
    desc: '沒有零件，零件格 8 格（其他飛船 6 格）。',
    ability: 'slots', abilityName: '零件格 +2', abilityDesc: '零件格 8 格（其他飛船 6 格）。' },
  bulwark: { name: '堡壘號', en: 'BULWARK', color: '#ffd166', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[18, 0], [6, -14], [-12, -14], [-8, 0], [-12, 14], [6, 14]],
    parts: { armor: 2 }, partSlots: 6, cap: 3,
    desc: null, ability: 'heavy', abilityName: '', abilityDesc: null },  // 帶零件的飛船：說明照零件資料產生（見最下面）  // 開局零件的說明照零件資料產生（見最下面）
  wraith: { name: '幻影號', en: 'WRAITH', color: '#c77dff', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[21, 0], [-12, -8], [-4, 0], [-12, 8]],
    parts: { larmor: 1, booster: 1 }, partSlots: 6, cap: 4,
    desc: null, ability: 'light', abilityName: '', abilityDesc: null },
  gate: { name: '星門號', en: 'GATE', color: '#2ee6a6', hp: 90, speed: 270, radius: 12, dashCd: 2.4,
    hull: [[18, 0], [2, -12], [-11, -7], [-6, 0], [-11, 7], [2, 12]],
    parts: {}, partSlots: 6, cap: 5,
    desc: '衝刺時開出一對傳送門，子彈和飛船可以穿過。',
    ability: 'portal', abilityName: '星門',
    abilityDesc: '衝刺時在起點和落點各開一個門（3 秒，同時只有一對）。自己和隊友的子彈、飛船穿過門會從另一個門出來；敵彈也會穿門，敵人不會。' },
};

// 帶零件的飛船：desc = 每種零件幾層＋總效果（圖示，好綠壞紅）；abilityDesc = 開啟的特性。數值直接從 PARTS 來，改零件時會跟著變
for (const S of Object.values(SHIPS)) {
  if (S.desc == null) S.desc = Object.entries(S.parts).map(([id, n]) => `<div class="fxl"><b>${PARTS[id].name} ${n} 層</b>${partLine(id, n)}</div>`).join('');
  if (S.abilityDesc == null) S.abilityDesc = Object.entries(S.parts).flatMap(([id, n]) => [n >= 2 && PARTS[id].t2, n >= 4 && PARTS[id].t4].filter(Boolean))
    .map(t => `<div class="trl"><b style="color:#9dff6b">開啟${t.name}</b>${t.desc}</div>`).join('');
}

// 開局數值（含開局零件，例如堡壘號的重裝甲 2 層）：選飛船、總覽顯示用
function shipStart(S) {
  const M = mechStats(S.parts);
  return { hp: Math.max(20, Math.round((S.hp + M.maxHp) * M.hpMul)), speed: Math.round(S.speed * M.speed), dashCd: +(S.dashCd * M.dashCd).toFixed(2) };
}
// 飛船卡片的說明：帶零件的飛船一直顯示零件和特性；其他飛船縮起來只顯示一句、按 Shift 看特殊能力
function shipDescHtml(S) {
  if (Object.keys(S.parts).length) return `<div class="ds">${S.desc}${S.abilityDesc}</div>`;
  return `<div class="ds brief">${S.desc}</div><div class="det"><div class="ds"><b style="color:${S.color}">${S.abilityName}</b><br>${S.abilityDesc}</div></div>`;
}
// 開局數值一行（圖示）：船體、速度、衝刺冷卻、零件格
function shipStatLine(S) {
  const st = shipStart(S);
  return `<div class="statl"><span>${statIcon('hp')}${st.hp}</span><span>${statIcon('speed')}${st.speed}</span><span>${statIcon('dashCd')}${st.dashCd} 秒</span><span>${statIcon('slots')}${S.partSlots}</span><span>${statIcon('cap')}${S.cap}</span></div>`;
}
