// 星環電路 雙人版 · weapons.js：5 把武器與兩段升級樹、weaponParams / weaponEmit
// 所有 js/**/*.js 共用同一個全域範圍，載入順序見 index.html
'use strict';

// =====================================================================
// WEAPONS — 一場固定一把，兩段升級（第一段 3 選 1，第二段 2 選 1）
//   base  : 武器基礎參數
//   paths : 第一段路線；每條路線的 next 是第二段的兩個選項
//   apply : 直接修改參數物件 p
// =====================================================================
const WEAPONS = {
  laser: { name: '雷射步槍', short: '雷射', color: '#5ef2ff', desc: '高速單發雷射，射速快、彈速快，最容易上手。',
    base: { interval: 0.16, count: 1, spread: 0, damage: 10, speed: 950, radius: 3, life: 0.85, shape: 'line', knock: 0.6 },
    paths: {
      A: { name: '稜鏡', desc: '命中時折射出 2 道碎光（每道 40% 傷害）。', apply: p => { p.shards = { n: 2, ratio: 0.4 }; },
        next: [
          { name: '全反射', desc: '折射增加到 4 道，每道 50% 傷害。', apply: p => { p.shards = { n: 4, ratio: 0.5 }; } },
          { name: '聚能稜鏡', desc: '不再折射，改成傷害 ×2.2，命中附加燃燒（每秒 8，持續 2 秒）。',
            apply: p => { p.shards = null; p.damage *= 2.2; p.burn = { dps: 8, t: 2 }; } }] },
      B: { name: '連發', desc: '一次射出 2 道雷射，每道傷害 ×0.75。', apply: p => { p.count = 2; p.spread = 0.08; p.damage *= 0.75; },
        next: [
          { name: '三連發', desc: '一次射出 3 道雷射。', apply: p => { p.count = 3; p.spread = 0.14; } },
          { name: '高頻', desc: rateTxt(0.7) + '。', apply: p => { p.rate *= 0.7; } }] },
      C: { name: '貫穿光束', desc: '穿透 +2，彈速 ×1.3，傷害 ×1.25。', apply: p => { p.pierce += 2; p.speed *= 1.3; p.damage *= 1.25; },
        next: [
          { name: '動能彈頭', desc: '打中的那一刻，子彈比雷射原本的彈速快多少 %，傷害就加那個數的一半（最多 +80%）：疊彈速就是疊火力（感測器、加速晶片都算）。',
            apply: p => { p.kinetic = { per: 0.5, max: 0.8, ref: WEAPONS.laser.base.speed }; } },
          { name: '過載射線', desc: '命中時爆炸（半徑 50，60% 傷害）。', apply: p => { p.explode = { r: 50, ratio: 0.6 }; } }] },
    } },
  scatter: { name: '散彈砲', short: '散彈', color: '#ffb347', desc: '扇形噴出 5 顆短程彈丸，近距離爆發高。',
    base: { interval: 0.42, count: 5, spread: 0.5, jitter: 0.04, speedVar: true, damage: 7, speed: 650, radius: 3.5, life: 0.5, shape: 'dot', knock: 1 },
    paths: {
      A: { name: '霰彈擴充', desc: '彈丸 +3。', apply: p => { p.count += 3; },
        next: [
          { name: '地毯轟炸', desc: '彈丸增加到 12 顆，擴散更廣。', apply: p => { p.count = 12; p.spread = 0.8; } },
          { name: '鋼珠', desc: '穿透 +1，擊退 ×2。', apply: p => { p.pierce += 1; p.knock *= 2; } }] },
      B: { name: '獨頭彈', desc: '改成單發大彈：傷害 ×4.5、穿透 2。', apply: p => {
          p.count = 1; p.spread = 0; p.jitter = 0; p.damage *= 4.5; p.radius = 7; p.pierce += 2; p.life = 0.7; p.shape = 'orb'; },
        next: [
          { name: '爆裂獨頭彈', desc: '命中時爆炸（半徑 80，100% 傷害）。', apply: p => { p.explode = { r: 80, ratio: 1 }; } },
          { name: '穿甲獨頭彈', desc: '穿透再 +5，彈速 ×1.5。', apply: p => { p.pierce += 5; p.speed *= 1.5; } }] },
      C: { name: '龍息彈', desc: '命中附加燃燒（每秒 6，持續 3 秒）。', apply: p => { p.burn = { dps: 6, t: 3 }; },
        next: [
          { name: '白磷', desc: '燃燒提升到每秒 12。', apply: p => { p.burn = { dps: 12, t: 3 }; } },
          { name: '焚風', desc: '射程 ×1.6，彈丸 +2。', apply: p => { p.life *= 1.6; p.count += 2; } }] },
    } },
  plasma: { name: '電漿砲', short: '電漿', color: '#c77dff', desc: '慢速的大型電漿球，單發傷害高、可穿透。',
    base: { interval: 0.45, count: 1, spread: 0, damage: 22, speed: 450, radius: 9, pierce: 2, life: 1.33, shape: 'orb', knock: 1.2 },
    paths: {
      A: { name: '分裂電漿', desc: '命中時分裂出 3 顆小電漿（每顆 35% 傷害）。', apply: p => { p.shards = { n: 3, ratio: 0.35 }; },
        next: [
          { name: '連鎖分裂', desc: '分裂增加到 5 顆。', apply: p => { p.shards = { n: 5, ratio: 0.35 }; } },
          { name: '重核分裂', desc: '分裂的每顆提升到 60% 傷害。', apply: p => { p.shards = { n: 3, ratio: 0.6 }; } }] },
      B: { name: '重力井', desc: '電漿更慢、更大、存在更久，穿透 +4。', apply: p => {
          p.speed *= 0.6; p.radius *= 1.6; p.life *= 1.5; p.pierce += 4; },
        next: [
          { name: '重量砲', desc: '飛船的移動速度每比原本慢 1%，傷害 +2%（最多 +80%）：越重越痛（重裝甲、護盾產生器、被凍住都算）。', apply: p => { p.weight = { per: 2, max: 0.8 }; } },
          { name: '黑潮', desc: '命中的敵人減速 50%。', apply: p => { p.slow = 0.5; } }] },
      C: { name: '新星', desc: '命中時爆炸（半徑 90，80% 傷害）。', apply: p => { p.explode = { r: 90, ratio: 0.8 }; },
        next: [
          { name: '超新星', desc: '爆炸半徑擴大到 140。', apply: p => { p.explode = { r: 140, ratio: 0.8 }; } },
          { name: '雙星', desc: '一次發射 2 顆電漿球。', apply: p => { p.count = 2; p.spread = 0.25; } }] },
    } },
  railgun: { name: '軌道砲', short: '軌道', color: '#ffd166', desc: '超高速穿甲彈，射速慢但一發貫穿一排。',
    base: { interval: 0.6, count: 1, spread: 0, damage: 30, speed: 1500, radius: 4, pierce: 3, life: 0.7, shape: 'rail', knock: 2 },
    paths: {
      A: { name: '自動軌道', desc: rateTxt(0.55) + '，傷害 ×0.6。', apply: p => { p.rate *= 0.55; p.damage *= 0.6; },
        next: [
          { name: '加特林', desc: rateTxt(0.7, '再') + '，但會亂飄。', apply: p => { p.rate *= 0.7; p.jitter = 0.08; } },
          { name: '雙軌', desc: '一次射出 2 發。', apply: p => { p.count = 2; p.spread = 0.06; } }] },
      B: { name: '攻城砲', desc: '傷害 ×1.8、擊退 ×2，' + rateTxt(1.3) + '。', apply: p => { p.damage *= 1.8; p.knock *= 2; p.rate *= 1.3; },
        next: [
          { name: '裝甲供能', desc: '最大 HP 超過 100 的部分，每 1 點射速 +0.5%（最多 +60%）：疊血就是疊火力。', apply: p => { p.hpRate = { per: 0.005, max: 0.6 }; } },
          { name: '無限貫穿', desc: '可以穿透所有敵人。', apply: p => { p.pierce = 99; } }] },
      C: { name: '磁暴線圈', desc: '命中時放出 2 道電弧，瞬間打中附近 2 隻敵人（每道 50% 傷害）；附近沒有其他敵人時，電弧打回目標本身（25%）。',
        apply: p => { p.arcs = { n: 2, ratio: 0.5 }; },
        next: [
          { name: '電網', desc: '電弧增加到 4 道。', apply: p => { p.arcs = { n: 4, ratio: 0.5 }; } },
          { name: '感電', desc: '命中的敵人減速 40%。', apply: p => { p.slow = 0.4; } }] },
    } },
  // 雙人版調整：開火從 5 段減為 3 段（每段 7 → 10，一次揮出 35 → 30）；巨刃 7 → 5 段
  blade: { name: '相位刃', short: '相刃', color: '#ff8fd8', desc: '向前揮出 2 段弧形能量刃，無限穿透，只打得到身邊；刃片會砍掉碰到的敵彈（格擋）。',
    base: { interval: 0.3, count: 2, spread: 0.35, damage: 9, speed: 650, radius: 8, pierce: 99, life: 0.2, shape: 'blade', knock: 0.8, parry: true },
    paths: {
      A: { name: '巨刃', desc: '刃片 5 段、範圍更大。', apply: p => { p.count = 5; p.spread = 1.1; p.radius *= 1.4; p.life *= 1.3; },
        next: [
          { name: '旋風斬', desc: '改成 360 度環形斬擊（12 段）。', apply: p => { p.count = 12; p.spread = TAU * 11 / 12; } },
          { name: '斷鋼', desc: '傷害 ×1.4。', apply: p => { p.damage *= 1.4; } }] },
      B: { name: '飛刃', desc: '刃片飛得更快更遠，變成中距離武器。', apply: p => { p.speed *= 1.8; p.life *= 2.2; },
        next: [
          { name: '追蹤飛刃', desc: '刃片會追蹤敵人。', apply: p => { p.homing = 4; } },
          { name: '疾風連斬', desc: rateTxt(0.7) + '。', apply: p => { p.rate *= 0.7; } }] },
      C: { name: '相位灼燒', desc: '命中附加燃燒（每秒 10，持續 2 秒）。', apply: p => { p.burn = { dps: 10, t: 2 }; },
        next: [
          { name: '裂隙擴散', desc: '命中時爆炸（半徑 60，60% 傷害）。', apply: p => { p.explode = { r: 60, ratio: 0.6 }; } },
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
    explode: null, burn: null, shards: null, arcs: null, slow: 0, knock: 1, lifesteal: 0, color: W.color }, W.base);
  if (state.path) {
    W.paths[state.path].apply(p);
    if (state.final != null) W.paths[state.path].next[state.final].apply(p);
  }
  return p;
}
function weaponEmit(p, pw) {
  const out = [], sm = statDmgMul(p);
  for (let k = 0; k < p.count; k++) {
    const a = (p.count > 1 ? -p.spread / 2 + p.spread * k / (p.count - 1) : 0) + (p.jitter ? rand(-p.jitter, p.jitter) : 0);
    out.push(shot({ angle: a, speed: p.speed * (p.speedVar ? rand(0.92, 1.08) : 1), damage: p.damage * pw * sm, kin: p.kinetic || null,
      radius: p.radius, pierce: p.pierce, bounce: p.bounce, homing: p.homing, life: p.life, color: p.color, shape: p.shape,
      explode: p.explode, burn: p.burn, shards: p.shards, arcs: p.arcs, slow: p.slow, knock: p.knock, lifesteal: p.lifesteal, parry: p.parry }));
  }
  return out;
}
// 數值換傷害（武器升級）：重量砲（移動速度越慢越痛）；照開火的人現在的機體算（雙人在 withLoadout 裡就是隊友的）
function statDmgMul(p) {
  if (!p.weight) return 1;
  return 1 + Math.min(p.weight.max, Math.max(0, 1 - shipSpeedNow()) * p.weight.per);
}
// 開火的人現在的移動速度倍率（機體：重裝甲、加速器、護盾產生器；被彗星凍住）
function shipSpeedNow() {
  const P = Game.shooter ? Game.mate : Game.player;
  return Game.mech.speed * (P && P.frostT > 0 ? 1 - OBJ.COMET_FROST.slow : 1);
}
// 動能彈頭（雷射升級）：命中時照子彈當下的速度加傷害
const kineticMul = b => 1 + Math.min(b.kin.max, Math.max(0, b.speed / b.kin.ref - 1) * b.kin.per);
function weaponTitle(state) {
  const W = WEAPONS[state.id], P = state.path && W.paths[state.path];
  return [W.name, P && P.name, P && state.final != null && P.next[state.final].name].filter(Boolean).join('・');
}
