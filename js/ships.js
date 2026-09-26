// 星環電路 雙人版 · ships.js：3 艘飛船
// 所有 js/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// SHIPS — 可選角色（船體性能與衝刺技能；武器另外選）
// =====================================================================
const SHIPS = {
  vanguard: { name: '先鋒號', en: 'VANGUARD', color: '#4cc9f0', hp: 100, speed: 270, radius: 12, dashCd: 0.9, armor: 0,
    hull: [[17, 0], [-10, -11], [-5, 0], [-10, 11]],
    inv: ['split'],
    desc: '均衡型。各項能力平均，適合熟悉電路構築。',
    ability: 'repair', abilityName: '戰地維修', abilityDesc: '每場戰鬥勝利後修復 10 HP。' },
  bulwark: { name: '堡壘號', en: 'BULWARK', color: '#ffd166', hp: 150, speed: 225, radius: 15, dashCd: 1.3, armor: 0.15,
    hull: [[18, 0], [6, -14], [-12, -14], [-8, 0], [-12, 14], [6, 14]],
    inv: ['enlarge'],
    desc: '重裝型。船體耐打、受到傷害 -15%，但移動較慢。',
    ability: 'shockwave', abilityName: '震盪衝撞', abilityDesc: '衝刺時釋放震波：周圍敵人受到 20 傷害並被擊退。' },
  wraith: { name: '幻影號', en: 'WRAITH', color: '#c77dff', hp: 75, speed: 310, radius: 10, dashCd: 0.55, armor: 0,
    hull: [[21, 0], [-12, -8], [-4, 0], [-12, 8]],
    inv: ['ricochet'],
    desc: '高機動型。船體脆弱，但衝刺冷卻極短，擅長打帶跑。',
    ability: 'phase', abilityName: '相位超載', abilityDesc: '衝刺後 1.2 秒內，開火傷害 ×1.5。' },
};
