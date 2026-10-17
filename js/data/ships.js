// 星環電路 雙人版 · ships.js：5 艘飛船（V2：飛船是「開局配置」，成長都走零件）
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SHIPS — 船體數值相同（HP 100、速度 270、衝刺冷卻 1.8 秒），差別在開局帶的零件和專屬能力：
//   先鋒號 相位跳躍（CFG.PHASE，零件格多 2 格）、堡壘號 灰血（CFG.GRAY）、幻影號 殘影（CFG.DECOY）、星門號 傳送門、哨兵號 砲台（CFG.TURRET）
// =====================================================================
const SHIPS = {
  vanguard: { name: '先鋒號', en: 'VANGUARD', color: '#4cc9f0', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[17, 0], [-10, -11], [-5, 0], [-10, 11]],
    parts: {}, partSlots: 8, cap: 7,
    brief: '衝刺變成瞬間移動，可以穿過牆和小行星。零件格比較多。',
    desc: null, ability: 'phase', abilityName: '相位跳躍',
    abilityDesc: `衝刺變成朝衝刺方向瞬間移動 ${CFG.PHASE.dist}：可以穿過牆、小行星、行星（落點在裡面就停在前面最遠的空地），也可以跳過打開的閘門；關著的閘門跳不過去，也跳不回走過的區域。` },
  bulwark: { name: '堡壘號', en: 'BULWARK', color: '#ffd166', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[18, 0], [6, -14], [-12, -14], [-8, 0], [-12, 14], [6, 14]],
    parts: { armor: 2 }, partSlots: 6, cap: 6,
    brief: '血多、耐打；受到的傷害有一部分之後會慢慢回來。',
    desc: null, ability: 'gray', abilityName: '灰血',
    skillDesc: () => `受到的傷害有 ${CFG.GRAY.share * 100}% 變成灰血（血條上淡色那段，最多最大 HP 的 ${CFG.GRAY.cap * 100}%）：${CFG.GRAY.delay} 秒沒被打到就開始回，每秒 ${CFG.GRAY.rate}；戰鬥結束時剩下的灰血回滿。` },  // 帶零件的飛船：說明照零件資料產生（見最下面）  // 開局零件的說明照零件資料產生（見最下面）
  wraith: { name: '幻影號', en: 'WRAITH', color: '#c77dff', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[21, 0], [-12, -8], [-4, 0], [-12, 8]],
    parts: { larmor: 1, booster: 1 }, partSlots: 6, cap: 7,
    brief: '快但脆；衝刺時留下殘影，把附近的敵人引開。',
    desc: null, ability: 'decoy', abilityName: '殘影',
    skillDesc: () => `衝刺時在起點留下殘影（${CFG.DECOY.t} 秒）：附近 ${CFG.DECOY.r} 內的敵人改去追殘影、朝殘影開火（殘影打不壞）。` },
  gate: { name: '星門號', en: 'GATE', color: '#2ee6a6', hp: 90, speed: 270, radius: 12, dashCd: 2.4,
    hull: [[18, 0], [2, -12], [-11, -7], [-6, 0], [-11, 7], [2, 12]],
    parts: {}, partSlots: 6, cap: 8,
    brief: '衝刺時開出一對傳送門，子彈和飛船可以穿過。',
    desc: null, ability: 'portal', abilityName: '星門',
    abilityDesc: '衝刺時在起點和落點各開一個門（3 秒，同時只有一對）。自己和隊友的子彈、飛船穿過門會從另一個門出來；敵彈也會穿門，敵人不會。' },
  sentry: { name: '哨兵號', en: 'SENTRY', color: '#ff8c42', hp: 100, speed: 270, radius: 12, dashCd: 1.8,
    hull: [[16, 0], [5, -9], [-4, -13], [-11, -9], [-7, 0], [-11, 9], [-4, 13], [5, 9]],
    parts: {}, partSlots: 6, cap: 7,
    brief: '衝刺時在起點留下砲台，用你的整條電路幫你開火。',
    desc: null, ability: 'turret', abilityName: '砲台',
    skillDesc: () => `衝刺時在起點留下一座砲台（${CFG.TURRET.t} 秒，同時只有一座）：朝射程內最近的敵人，用你的整條電路開火（傷害 ${CFG.TURRET.dmg * 100}%，射速跟飛船一樣）。` },
};

// desc = 開局零件每種幾層＋總效果（圖示，好綠壞紅；沒有零件 = 空）；abilityDesc = 專屬能力（skillDesc）＋開啟的零件特性。數值直接從 PARTS、CFG 來，改了會跟著變
for (const S of Object.values(SHIPS)) {
  if (S.desc == null) S.desc = Object.entries(S.parts).map(([id, n]) => `<div class="fxl"><b>${PARTS[id].name} ${n} 層</b>${partLine(id, n)}</div>`).join('');
  if (S.abilityDesc == null) S.abilityDesc = (S.skillDesc ? `<div class="trl"><b style="color:${S.color}">${S.abilityName}</b>${S.skillDesc()}</div>` : '') + Object.entries(S.parts).flatMap(([id, n]) => [n >= 2 && PARTS[id].t2, n >= 4 && PARTS[id].t4].filter(Boolean))
    .map(t => `<div class="trl"><b style="color:#9dff6b">開啟${t.name}</b>${t.desc}</div>`).join('');
}

// 開局數值（含開局零件，例如堡壘號的重裝甲 2 層）：選飛船、總覽顯示用
function shipStart(S) {
  const M = mechStats(S.parts);
  return { hp: Math.max(20, Math.round((S.hp + M.maxHp) * M.hpMul)), speed: Math.round(S.speed * M.speed), dashCd: +(S.dashCd * M.dashCd).toFixed(2) };
}
// 飛船卡片的說明：平常只顯示一句（brief），按 Shift 看開局零件和專屬能力的完整說明
function shipDescHtml(S) {
  const ability = S.skillDesc ? S.abilityDesc : `<div class="trl"><b style="color:${S.color}">${S.abilityName}</b>${S.abilityDesc}</div>`;
  return `<div class="ds brief">${S.brief}</div><div class="det"><div class="ds">${S.desc}${ability}</div></div>`;
}
// 開局數值一行（圖示）：船體、速度、衝刺冷卻、零件格
function shipStatLine(S) {
  const st = shipStart(S);
  return `<div class="statl"><span>${statIcon('hp')}${st.hp}</span><span>${statIcon('speed')}${st.speed}</span><span>${statIcon('dashCd')}${st.dashCd} 秒</span><span>${statIcon('slots')}${S.partSlots}</span><span>${statIcon('cap')}${S.cap}</span></div>`;
}
