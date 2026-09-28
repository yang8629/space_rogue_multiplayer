// 星環電路 雙人版 · ships.js：4 艘飛船（V2：飛船是「開局配置」，成長都走零件）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SHIPS — 船體數值相同（HP 100、速度 270、衝刺冷卻 0.9 秒），差別在開局帶的零件；
//   星門號沒有開局零件，改成獨有的衝刺能力（傳送門）
// =====================================================================
const SHIPS = {
  vanguard: { name: '先鋒號', en: 'VANGUARD', color: '#4cc9f0', hp: 100, speed: 270, radius: 12, dashCd: 0.9,
    hull: [[17, 0], [-10, -11], [-5, 0], [-10, 11]],
    parts: {}, partSlots: 7,
    desc: '白紙一張：沒有開局零件，但零件格多 1 格（7 格），怎麼長都可以。',
    ability: 'slots', abilityName: '零件格 +1', abilityDesc: '零件格 7 格（其他飛船 6 格）。' },
  bulwark: { name: '堡壘號', en: 'BULWARK', color: '#ffd166', hp: 100, speed: 270, radius: 12, dashCd: 0.9,
    hull: [[18, 0], [6, -14], [-12, -14], [-8, 0], [-12, 14], [6, 14]],
    parts: { armor: 2 }, partSlots: 6,
    desc: '開局帶重裝甲 2 層，直接開啟「厚甲」。適合往重裝、衝撞發展。',
    ability: 'heavy', abilityName: '重裝甲 ×2', abilityDesc: '開局重裝甲 2 層：最大 HP +40、速度 −8%，開啟厚甲（單次受傷最多扣 20% 最大 HP）。' },
  wraith: { name: '幻影號', en: 'WRAITH', color: '#c77dff', hp: 100, speed: 270, radius: 12, dashCd: 0.9,
    hull: [[21, 0], [-12, -8], [-4, 0], [-12, 8]],
    parts: { larmor: 1, booster: 1 }, partSlots: 6,
    desc: '開局帶輕裝甲 1 層、加速器 1 層。適合往閃避、高機動發展。',
    ability: 'light', abilityName: '輕裝甲＋加速器', abilityDesc: '開局輕裝甲 1 層（HP +15、衝刺冷卻 +3%）、加速器 1 層（速度 +6%、HP −10）。' },
  gate: { name: '星門號', en: 'GATE', color: '#2ee6a6', hp: 90, speed: 270, radius: 12, dashCd: 1.2,
    hull: [[18, 0], [2, -12], [-11, -7], [-6, 0], [-11, 7], [2, 12]],
    parts: {}, partSlots: 6,
    desc: '沒有開局零件，衝刺會開出一對傳送門。HP 90、衝刺冷卻 1.2 秒。',
    ability: 'portal', abilityName: '星門',
    abilityDesc: '衝刺時在起點和落點各開一個門（3 秒，同時只有一對）。自己和隊友的子彈、飛船穿過門會從另一個門出來；敵彈也會穿門，敵人不會。' },
};
