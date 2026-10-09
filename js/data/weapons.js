// 星環電路 雙人版 · weapons.js：5 把武器與兩段升級樹、weaponParams / weaponEmit
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// WEAPONS — 一場固定一把，兩段升級（第一段 3 選 1，第二段 2 選 1）
//   base  : 武器基礎參數
//   paths : 第一段路線；每條路線的 next 是第二段的兩個選項
//   apply : 直接修改參數物件 p
// =====================================================================
// 雷射步槍的終極升級（2026-10-09 改成「每個終極升級一套玩法」）
const FOCUS = { per: 0.1, max: 10 };                                  // 專注：連續打中同一隻每次 +10%
const SPREAD = { n: 3, ratio: 0.4, per: 0.05, max: 12, idle: 2, decay: 0.25 };  // 分散：碎光打中別隻，射速 +5% 疊層；2 秒沒疊開始每 0.25 秒掉 1 層
const GRAZE = { r: 40, per: 0.1, max: 8, idle: 3, decay: 1 };         // 擦彈：敵彈從身邊 40 內飛過，射速 +10% 疊層；3 秒沒擦彈每秒掉 1 層
const RAGE = { per: 1 };                                              // 狂怒：每缺 1% HP 射速 +1%
const SKEWER = { per: 0.3 };                                          // 串燒：每穿過一隻，之後打中的傷害 +30%
// 電漿砲的終極升級（2026-10-09 改成「每個終極升級一套玩法」）
const BREED = { n: 2, ratio: 0.25 };             // 增殖：小電漿打中時再分裂 2 顆（各為大電漿傷害的 25%），第二代不再分裂
const RESONANCE = { t: 2, share: 0.3 };          // 共鳴：同一發打中的敵人連結 2 秒，受到的傷害分 30% 給其他連結的
const FROSTBITE = { slow: 0.4, dur: 2, per: 1 }; // 冰封：命中減速 40%（2 秒）；敵人每被減速 1%，受到你的傷害 +1%
const AFTERSHOCK = { t: 0.6 };                   // 餘震：爆炸 0.6 秒後同一點再炸一次
const COMPRESS = { r: 70, per: 0.2 };            // 壓縮：爆炸半徑 70，第 2 隻起每多炸到 1 隻 +20%
// 軌道砲的終極升級（2026-10-09 改成「每個終極升級一套玩法」）
const TRAIL = { t: 1.5, ratio: 0.5, max: 40 };                   // 殘留彈道：路徑留電軌 1.5 秒，碰到的敵人受到 50%；場上最多 40 條
const CRACK = { per: 0.1, t: 3 };             // 碎甲：每次命中那隻敵人受到傷害 +10%（疊加、沒有上限），3 秒沒被打中掉光；破甲彈頭打中改疊 +25%
const STATIC = { dist: 100, max: 4 };         // 靜電：飛船每移動 100 充一格（最多 4 格），下一發每格多 1 道電弧
const CONDUCT = { jumps: 3, decay: 0.7 };     // 導電：電弧打中後再跳到附近另一隻，最多 3 次，每跳一次 ×0.7
// 相位刃的終極升級（2026-10-09 改成「每個終極升級一套玩法」）
const PARRY_UP = { per: 0.05, max: 12, idle: 2, decay: 0.25 };  // 格擋流：每砍掉一顆敵彈傷害 +5%（最多 12 層）；2 秒沒砍到開始每 0.25 秒掉 1 層
// 散彈砲的終極升級（2026-10-09 改成「每個終極升級一套玩法」）
const CROWD = { r: 250, per: 0.08, max: 8 };                   // 群戰：身邊每隻敵人射速 +8%
const REVENGE = { t: 5, mul: 2.5, explode: { r: 80, ratio: 1 }, first: 0.5 }; // 逆襲：受傷後 5 秒傷害 ×2.5＋爆炸；沒開時被打中那一下傷害 ×0.5
const ASCETIC = { per: 0.5 };                                   // 空格苦行：每個空格傷害 +50%
const CARPET = { r: 25, t: 2, dps: 12, max: 60 };              // 火毯：彈丸消失的地方留一團火（場上最多 60 團）
const WILDFIRE = { every: 0.5, r: 80, deathR: 120 };            // 野火：燃燒傳染
const WALLHIT = { knock: 3, t: 0.4, mul: 2, stun: 0.5, cd: 0.5 }; // 撞牆：擊退 ×3；被打中 0.4 秒內撞到東西 → 彈丸傷害加總 ×2＋暈眩

const WEAPONS = {
  laser: { name: '雷射步槍', short: '雷射', color: '#5ef2ff', desc: '高速單發雷射，射速快、彈速快，最容易上手。',
    base: { interval: 0.16, count: 1, spread: 0, damage: 10, speed: 950, radius: 3, life: 0.85, shape: 'line', knock: 0.6 },
    paths: {
      A: { name: '稜鏡', desc: '命中時折射出 2 道碎光（每道 40% 傷害）。', apply: p => { p.shards = { n: 2, ratio: 0.4 }; },
        next: [
          { name: '專注', desc: `碎光不再散開，改成折回打同一隻；連續打中同一隻（碎光也算）每次傷害 +${FOCUS.per * 100}%，最多 +${FOCUS.per * FOCUS.max * 100}%，打中別隻就歸零：盯死精英和王。`, apply: p => { p.shards = { n: 2, ratio: 0.4, focus: true }; p.focus = FOCUS; } },
          { name: '分散', desc: `碎光增加到 ${SPREAD.n} 道；碎光每打中一隻敵人，射速 +${SPREAD.per * 100}%（最多 ${SPREAD.max} 層 +${SPREAD.per * SPREAD.max * 100}%），${SPREAD.idle} 秒沒疊就開始掉層：專清雜兵。`, apply: p => { p.shards = { n: SPREAD.n, ratio: SPREAD.ratio, spread: true }; p.spreadUp = SPREAD; } }] },
      B: { name: '連發', desc: '一次射出 2 道雷射，每道傷害 ×0.75。', apply: p => { p.count = 2; p.spread = 0.08; p.damage *= 0.75; },
        next: [
          { name: '擦彈', desc: `敵彈從飛船身邊 ${GRAZE.r} 以內飛過（沒打中），射速 +${GRAZE.per * 100}%（最多 ${GRAZE.max} 層 +${GRAZE.per * GRAZE.max * 100}%）；${GRAZE.idle} 秒沒擦彈每秒掉 1 層：貼著子彈閃。`, apply: p => { p.graze = GRAZE; } },
          { name: '狂怒', desc: `每缺 1% HP，射速 +${RAGE.per}%（剩一半血 +${RAGE.per * 50}%，沒有上限）：越殘越快。`, apply: p => { p.rage = RAGE; } }] },
      C: { name: '貫穿光束', desc: '穿透 +2，彈速 ×1.3，傷害 ×1.25。', apply: p => { p.pierce += 2; p.speed *= 1.3; p.damage *= 1.25; },
        next: [
          { name: '動能彈頭', desc: '打中的那一刻，子彈比雷射原本的彈速快多少 %，傷害就加那個數的一半（沒有上限）：疊彈速就是疊火力（感測器、加速晶片都算）。',
            apply: p => { p.kinetic = { per: 0.5, ref: WEAPONS.laser.base.speed }; } },
          { name: '串燒', desc: `光束每穿過一隻敵人，之後打中的傷害 +${SKEWER.per * 100}%（穿到第 4 隻時 ×${1 + SKEWER.per * 3}）：把敵人排成一排打。`, apply: p => { p.skewer = SKEWER; } }] },
    } },
  scatter: { name: '散彈砲', short: '散彈', color: '#ffb347', desc: '扇形噴出 5 顆短程彈丸，近距離爆發高。',
    base: { interval: 0.42, count: 5, spread: 0.5, jitter: 0.04, speedVar: true, damage: 7, speed: 650, radius: 3.5, life: 0.5, shape: 'dot', knock: 1 },
    paths: {
      A: { name: '霰彈擴充', desc: '彈丸 +3。', apply: p => { p.count += 3; },
        next: [
          { name: '群戰', desc: `身邊 ${CROWD.r} 以內每有 1 隻敵人，射速 +${CROWD.per * 100}%（最多算 ${CROWD.max} 隻，+${CROWD.per * CROWD.max * 100}%）：衝進怪堆越打越快。`, apply: p => { p.crowd = CROWD; } },
          { name: '撞牆', desc: `擊退 ×${WALLHIT.knock}；被彈丸打飛的敵人 ${WALLHIT.t} 秒內撞到牆、小行星、行星或別的敵人，受到「打中牠的彈丸傷害加總 ×${WALLHIT.mul}」並暈眩 ${WALLHIT.stun} 秒（同一隻 ${WALLHIT.cd} 秒內只算一次；被撞到的敵人不受傷）：把怪推成一片、推到牆上。`, apply: p => { p.knock *= WALLHIT.knock; p.wallhit = WALLHIT; } }] },
      B: { name: '獨頭彈', desc: '改成單發大彈：傷害 ×4.5、穿透 2。', apply: p => {
          p.count = 1; p.spread = 0; p.jitter = 0; p.damage *= 4.5; p.radius = 7; p.pierce += 2; p.life = 0.7; p.shape = 'orb'; },
        next: [
          { name: '逆襲', desc: `受傷（護盾擋下也算）之後 ${REVENGE.t} 秒內，獨頭彈傷害 ×${REVENGE.mul}、命中時爆炸（半徑 ${REVENGE.explode.r}，100% 傷害）；逆襲沒開時被打中，那一下傷害 ×${REVENGE.first}：挨一下換一波爆發。`, apply: p => { p.revenge = REVENGE; } },
          { name: '空格苦行', desc: `電路上每個沒裝晶片的空格，傷害 +${ASCETIC.per * 100}%（組件插座不算）：晶片越少越痛。`, apply: p => { p.ascetic = ASCETIC; } }] },
      C: { name: '龍息彈', desc: '命中附加燃燒（每秒 6，持續 3 秒）。', apply: p => { p.burn = { dps: 6, t: 3 }; },
        next: [
          { name: '火毯', desc: `每顆彈丸消失的地方（打中敵人或飛到射程盡頭）留一團火（半徑 ${CARPET.r}、燒 ${CARPET.t} 秒），敵人碰到就燃燒（每秒 ${CARPET.dps}，持續 3 秒）：朝敵人要走過來的地方噴，鋪一片火毯封路。`, apply: p => { p.carpet = CARPET; } },
          { name: '野火', desc: `燃燒中的敵人每 ${WILDFIRE.every} 秒把火傳給 ${WILDFIRE.r} 以內一隻還沒燒的敵人；燒著死掉時，火噴到 ${WILDFIRE.deathR} 以內所有敵人身上：敵人越擠燒越快。`, apply: p => { p.wildfire = WILDFIRE; } }] },
    } },
  plasma: { name: '電漿砲', short: '電漿', color: '#c77dff', desc: '慢速的大型電漿球，單發傷害高、可穿透。',
    base: { interval: 0.45, count: 1, spread: 0, damage: 22, speed: 450, radius: 9, pierce: 2, life: 1.33, shape: 'orb', knock: 1.2 },
    paths: {
      A: { name: '分裂電漿', desc: '命中時分裂出 3 顆小電漿（每顆 35% 傷害）。', apply: p => { p.shards = { n: 3, ratio: 0.35 }; },
        next: [
          { name: '增殖', desc: `小電漿打中敵人時再分裂成 ${BREED.n} 顆（各為大電漿傷害的 ${BREED.ratio * 100}%），第二代不再分裂：敵人越分散越好用。`, apply: p => { p.shards = { n: 3, ratio: 0.35, breed: BREED }; } },
          { name: '共鳴', desc: `被大電漿打中的那隻，和同一發小電漿打中的敵人互相連結 ${RESONANCE.t} 秒；連結中任何一隻受到傷害，其他連結的也受到 ${RESONANCE.share * 100}%（分出去的不會再分）：把一群連起來，集中打一隻。`, apply: p => { p.shards = { n: 3, ratio: 0.35, resonance: RESONANCE }; } }] },
      B: { name: '重質電漿', desc: '電漿更慢、更大、存在更久，穿透 +4。', apply: p => {
          p.speed *= 0.6; p.radius *= 1.6; p.life *= 1.5; p.pierce += 4; },
        next: [
          { name: '重量砲', desc: '飛船的移動速度每比原本慢 1%，傷害 +2%（沒有上限）：越重越痛（重裝甲、護盾產生器、被凍住都算）。', apply: p => { p.weight = { per: 2 }; } },
          { name: '冰封', desc: `命中的敵人減速 ${FROSTBITE.slow * 100}%（${FROSTBITE.dur} 秒）；敵人每被減速 1%，受到你的傷害 +${FROSTBITE.per}%（冰凍塗層、重力井模組、彗星的冰可以再疊：剩下的速度相乘）：先冰住再打。`, apply: p => { p.slow = FROSTBITE.slow; p.slowDur = FROSTBITE.dur; p.frostbite = FROSTBITE; } }] },
      C: { name: '新星', desc: '命中時爆炸（半徑 90，80% 傷害）。', apply: p => { p.explode = { r: 90, ratio: 0.8 }; },
        next: [
          { name: '餘震', desc: `爆炸 ${AFTERSHOCK.t} 秒後在同一點再炸一次（同半徑、同傷害），地上先出現縮小的圈：朝敵人要走到的地方打。`, apply: p => { p.aftershock = AFTERSHOCK; } },
          { name: '壓縮', desc: `爆炸半徑縮小到 ${COMPRESS.r}；從第 2 隻開始，每多炸到 1 隻，這次爆炸傷害 +${COMPRESS.per * 100}%：把怪聚在一起再炸。`, apply: p => { p.explode = { r: COMPRESS.r, ratio: 0.8, compress: COMPRESS.per }; } }] },
    } },
  railgun: { name: '軌道砲', short: '軌道', color: '#ffd166', desc: '超高速穿甲彈，射速慢但一發貫穿一排。',
    base: { interval: 0.6, count: 1, spread: 0, damage: 30, speed: 1500, radius: 4, pierce: 3, life: 0.7, shape: 'rail', knock: 2 },
    paths: {
      A: { name: '自動軌道', desc: rateTxt(0.55) + '，傷害 ×0.6。', apply: p => { p.rate *= 0.55; p.damage *= 0.6; },
        next: [
          { name: '殘留彈道', desc: `子彈飛過的路徑留下一條電軌（${TRAIL.t} 秒），敵人碰到受到那發子彈 ${TRAIL.ratio * 100}% 的傷害（每條電軌每隻一次，子彈本身打中的不算；場上最多 ${TRAIL.max} 條）：邊退邊掃，讓追過來的敵人穿過你畫的網。`, apply: p => { p.trail = TRAIL; } },
          { name: '連殺裝填', desc: '每擊殺一隻敵人，下一發的射擊冷卻立刻歸零：連續擊殺時變成連射。', apply: p => { p.reload = true; } }] },
      B: { name: '攻城砲', desc: '傷害 ×1.8、擊退 ×2，' + rateTxt(1.3) + '。', apply: p => { p.damage *= 1.8; p.knock *= 2; p.rate *= 1.3; },
        next: [
          { name: '裝甲供能', desc: '最大 HP 超過 100 的部分，每 1 點射速 +1%（最多 +100%）：疊血就是疊火力。', apply: p => { p.hpRate = { per: 0.01, max: 1 }; } },
          { name: '碎甲', desc: `每次命中，那隻敵人受到的傷害 +${CRACK.per * 100}%（疊加、沒有上限），${CRACK.t} 秒沒被打中就掉光；破甲彈頭打中時改疊 +25%：一發貫穿一排，整排一起變脆。`, apply: p => { p.crack = CRACK; } }] },
      C: { name: '磁暴線圈', desc: '命中時放出 2 道電弧，瞬間打中附近 2 隻敵人（每道 50% 傷害）；附近沒有其他敵人時，電弧打回目標本身（25%）。',
        apply: p => { p.arcs = { n: 2, ratio: 0.5 }; },
        next: [
          { name: '靜電', desc: `飛船每移動 ${STATIC.dist} 的距離充一格電（最多 ${STATIC.max} 格），下一發每格多 1 道電弧，射出去就用掉：邊跑邊打。`, apply: p => { p.static = STATIC; } },
          { name: '導電', desc: `電弧打中後會再跳到附近另一隻（還沒被這道電弧打過的），最多跳 ${CONDUCT.jumps} 次，每跳一次傷害 ×${CONDUCT.decay}：敵人越密集跳越多。`, apply: p => { p.arcs = { ...p.arcs, chain: CONDUCT }; } }] },
    } },
  // 雙人版調整：開火從 5 段減為 3 段（每段 7 → 10，一次揮出 35 → 30）；巨刃 7 → 5 段
  blade: { name: '相位刃', short: '相刃', color: '#ff8fd8', desc: '向前揮出 2 段弧形能量刃，無限穿透，只打得到身邊；刃片會砍掉碰到的敵彈（格擋）。',
    base: { interval: 0.3, count: 2, spread: 0.35, damage: 9, speed: 650, radius: 8, pierce: 99, life: 0.2, shape: 'blade', knock: 0.8, parry: true },
    paths: {
      A: { name: '巨刃', desc: '刃片 5 段、範圍更大。', apply: p => { p.count = 5; p.spread = 1.1; p.radius *= 1.4; p.life *= 1.3; },
        next: [
          { name: '旋風斬', desc: '改成 360 度環形斬擊（12 段）。', apply: p => { p.count = 12; p.spread = TAU * 11 / 12; } },
          { name: '玻璃砲', desc: '受到的傷害 +10%；受到的傷害每比正常多 1%，傷害 +3%（沒有上限）：越脆越痛（輕裝甲、散熱片、反應裝甲、終焉護殼都算）。', apply: p => { p.glass = { per: 3, self: 0.1 }; } }] },
      B: { name: '飛刃', desc: '刃片飛得更快更遠，變成中距離武器。', apply: p => { p.speed *= 1.8; p.life *= 2.2; },
        next: [
          { name: '追蹤飛刃', desc: '刃片會追蹤敵人。', apply: p => { p.homing = 4; } },
          { name: '格擋流', desc: `刃片每砍掉一顆敵彈，傷害 +${PARRY_UP.per * 100}%（最多 ${PARRY_UP.max} 層 +${PARRY_UP.per * PARRY_UP.max * 100}%），${PARRY_UP.idle} 秒沒砍到就開始掉層：主動去迎子彈砍。`, apply: p => { p.parryUp = PARRY_UP; } }] },
      C: { name: '相位灼燒', desc: '命中附加燃燒（每秒 10，持續 2 秒）。', apply: p => { p.burn = { dps: 10, t: 2 }; },
        next: [
          { name: '業火', desc: '燃燒每次命中各自計時、疊加（一般燃燒同一隻只留最強的一個）：在怪群裡來回掃，讓每隻身上疊滿火；燃燒彈頭的燃燒也一起疊。', apply: p => { p.inferno = true; } },
          { name: '吸能刃', desc: '每次命中回復 0.25 HP（每秒最多 4 HP）。', apply: p => { p.lifesteal = 0.25; } }] },
    } },
};

// 選武器卡片的一行精簡說明
const WEAPON_BRIEF = {
  laser: '高速單發雷射，射速快、彈速快，最好上手。',
  scatter: '一次噴出 5 顆短程彈丸，貼近敵人時爆發最高。',
  plasma: '慢速的大型電漿球，單發傷害高、可以穿透。',
  railgun: '超高速穿甲彈，一發貫穿一排；射速慢，打得動小行星。',
  blade: '向前揮出 2 段能量刃，只打得到身邊；刃片會砍掉敵彈。' };

function weaponParams(state) {
  const W = WEAPONS[state.id];
  const p = Object.assign({ rate: 1, jitter: 0, speedVar: false, pierce: 0, bounce: 0, homing: 0,
    explode: null, burn: null, shards: null, arcs: null, slow: 0, knock: 1, lifesteal: 0, color: W.color,
    crowd: null, revenge: null, ascetic: null, carpet: null, wildfire: null, wallhit: null, focus: null, spreadUp: null, graze: null, rage: null, skewer: null, slowDur: 0, frostbite: null, aftershock: null, trail: null, reload: false, crack: null, static: null, parryUp: null, inferno: false }, W.base);
  if (state.path) {
    W.paths[state.path].apply(p);
    if (state.final != null) W.paths[state.path].next[state.final].apply(p);
  }
  return p;
}
function weaponEmit(p, pw) {
  const out = [], sm = statDmgMul(p), rv = p.revenge && revengeOn(), arcs = staticArcs(p);
  for (let k = 0; k < p.count; k++) {
    const a = (p.count > 1 ? -p.spread / 2 + p.spread * k / (p.count - 1) : 0) + (p.jitter ? rand(-p.jitter, p.jitter) : 0);
    out.push(shot({ angle: a, speed: p.speed * (p.speedVar ? rand(0.92, 1.08) : 1), damage: p.damage * pw * sm * (rv ? p.revenge.mul : 1), kin: p.kinetic || null,
      radius: p.radius, pierce: p.pierce, bounce: p.bounce, homing: p.homing, life: p.life, color: rv ? '#ff4d6d' : p.color, shape: p.shape,
      explode: rv ? p.revenge.explode : p.explode, burn: p.burn, shards: p.shards, arcs, slow: p.slow, knock: p.knock, lifesteal: p.lifesteal, parry: p.parry,
      wild: p.wildfire || null, wallhit: p.wallhit || null, carpet: p.carpet || null, focus: p.focus || null, skewer: p.skewer || null, slowDur: p.slowDur || 0, frostbite: p.frostbite || null, aftershock: p.aftershock || null, trail: p.trail || null, crack: p.crack || null, inferno: !!p.inferno }));
  }
  return out;
}
// 靜電（軌道升級）：充的電每格多 1 道電弧（射出去之後在 Player.tickFire 用掉）
function staticArcs(p) {
  if (!p.static || !p.arcs) return p.arcs;
  const P = shooterNow(), k = P ? P.staticK || 0 : 0;
  return k ? { ...p.arcs, n: p.arcs.n + k } : p.arcs;
}
// 開火的人（雙人：隊友的電路在 withLoadout 裡開火時是隊友）
const shooterNow = () => Game.shooter ? Game.mate : Game.player;
// 逆襲（散彈升級）：開火的人受傷後的爆發時間還在
function revengeOn() { const P = shooterNow(); return !!P && P.revengeT > 0; }
// 數值換傷害（武器升級）：重量砲（移動速度越慢越痛）、玻璃砲（受到的傷害越多越痛）；照開火的人現在的機體算（雙人在 withLoadout 裡就是隊友的）
//   空格苦行（電路空格越多越痛）、無傷連殺（輕裝甲 4 層：沒被打中的連續擊殺）
function statDmgMul(p) {  // 增加的相加
  let k = 1;
  if (p.weight) k += Math.max(0, 1 - shipSpeedNow()) * p.weight.per;
  if (p.glass) k += Math.max(0, Game.mech.taken - 1) * p.glass.per;
  if (p.ascetic) k += emptySlots() * p.ascetic.per;
  if (p.parryUp) { const P = shooterNow(); if (P) k += (P.parryK || 0) * p.parryUp.per; }  // 格擋流（相位刃升級）
  if (Game.mech && Game.mech.traits.streak) { const P = shooterNow(); if (P) k += (P.streak || 0) * STREAK.per; }  // 雙人開房時隊友的機體還沒算好
  return k;
}
const emptySlots = () => Game.chain.reduce((n, c, i) => n + (i > 0 && !c ? 1 : 0), 0);  // 電路上沒裝晶片的格子（第 0 格是武器）
// 開火的人現在的移動速度倍率（機體：重裝甲、加速器、護盾產生器；被彗星凍住）
function shipSpeedNow() {
  const P = shooterNow();
  return Game.mech.speed * (P && P.frostT > 0 ? 1 - OBJ.COMET_FROST.slow : 1);
}
// 動能彈頭（雷射升級）：命中時照子彈當下的速度加傷害
const kineticMul = b => 1 + Math.max(0, b.speed / b.kin.ref - 1) * b.kin.per;
function weaponTitle(state) {
  const W = WEAPONS[state.id], P = state.path && W.paths[state.path];
  return [W.name, P && P.name, P && state.final != null && P.next[state.final].name].filter(Boolean).join('・');
}
