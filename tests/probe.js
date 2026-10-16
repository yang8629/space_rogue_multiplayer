// 新終極升級的觸發計數（2026-10-09）：整局模擬 --probe 時裝上，證明電腦在實戰中真的用到每個新效果
//   只包一層遊戲的函式／聽事件，不改遊戲；每局開始 reset()，結束 text() 印出有數到的
'use strict';
module.exports = function installProbe(G) {
  const vm = require('vm');
  let C = {};
  const inc = (k, n = 1) => { C[k] = (C[k] || 0) + n; };
  const max = (k, v) => { if (v > (C[k] || 0)) C[k] = v; };
  const wrap = (name, fn) => { const o = G[name].bind(G); G[name] = function (...a) { return fn(o, ...a); }; };
  const shooter = b => b.ownerP || G.player;
  // ---- 包函式 ----
  wrap('onRevenge', (o, p) => { if (G.wpOf(p).revenge) inc('逆襲觸發'); return o(p); });
  wrap('dropFlame', (o, b) => { inc('火毯留火'); return o(b); });
  wrap('igniteFrom', (o, e, x) => { inc('野火傳火'); return o(e, x); });
  wrap('wallSlam', (o, e) => { const cd = e.whCd; const r = o(e); if (e.whCd !== cd) inc('撞牆撞擊'); return r; });
  wrap('spreadHit', (o, P) => { if (P && (P.L ? P.L.wp : G.wp).spreadUp) inc('分散疊層'); return o(P); });
  wrap('grazeHit', (o, p) => { inc('擦彈'); return o(p); });
  // 精英詞綴（2026-10-13）：出場幾隻、各詞綴出現幾次、擊殺、地雷爆炸
  //   第二個以後的參數照傳（精英亂入的 { intruder } 在第二個）
  wrap('spawnEnemy', (o, type, ...a) => { const r = o(type, ...a); if (type === 'elite') { const e = G.enemies[G.enemies.length - 1]; inc('精英出場'); if (e.intruder) inc('精英亂入'); for (const id of e.affixes || []) inc('詞綴' + id); } if (type === 'treasure') inc('寶藏出現'); return r; });
  // mp-2.18.0（2026-10-16）：寶藏無人機、蟲潮、？事件、稀有保證
  wrap('startWave', (o, n) => { const r = o(n); if (G.combat.swarmArea) inc('蟲潮區'); return r; });
  wrap('treasureEscape', (o, e) => { inc('寶藏逃走'); return o(e); });
  wrap('bonusRare', (o, e, k) => { inc('稀有保證' + k); return o(e, k); });
  // 警戒、警報艇（2026-10-16）：響了幾次、倒數中被打掉幾次、沒響就被打掉幾次
  wrap('alarmPulse', (o, e) => { inc(e.rang ? '警報再叫' : '警報響'); return o(e); });
  wrap('onEnemyKilled', (o, e) => { if (e.t.alarm) inc(e.rang ? '警報艇叫過人才打掉' : e.ringT >= vm.runInThisContext('CFG').ALARM.delay ? '警報艇一擊打掉' : '警報艇倒數中打掉');  /* 一擊：hurt 剛設好倒數就死了 */ return o(e); });
  wrap('evChoose', (o, i) => { const V = G.ev, E = V && vm.runInThisContext('EVENTS')[V.id]; const r = o(i); if (E && (G.ev !== V || V.res)) inc(  /* 選成功才算（選不了的會原封不動） */'事件' + E.name + '：' + E.opts[i].lab); return r; });
  wrap('mineBlast', (o, b) => { inc('地雷爆炸'); return o(b); });
  wrap('onEnemyKilled', (o, e) => { if (e.t.elite) inc('精英擊殺'); return o(e); });
  wrap('shareLink', (o, e, d, a) => { if (e.link && e.link.t > 0) inc('共鳴分傷'); return o(e, d, a); });
  wrap('onReloadKill', (o, e) => { const p = e.killer ? ((G.mates || []).find(m => m.L === e.killer) || null) : G.player; const cd = p ? p.fireCd : 0; const r = o(e); if (p && cd > 0 && p.fireCd <= 0) inc('連殺裝填'); return r; });
  wrap('arcChain', (o, ...a) => { inc('導電連鎖'); return o(...a); });
  wrap('trailHit', (o, L, e) => { inc('殘留彈道命中'); return o(L, e); });
  wrap('parryHit', (o, P) => { if (P && (P.L ? P.L.wp : G.wp).parryUp) inc('格擋流疊層'); return o(P); });
  wrap('explode', (o, x, y, r, dmg, color, skip, att, per) => {
    if (per) { let n = 0; for (const e of G.enemies) if (!e.dead && e.id !== skip && Math.hypot(e.x - x, e.y - y) <= r + e.r) n++; inc('壓縮爆炸'); if (n >= 2) inc('壓縮炸到2隻以上'); max('壓縮最多炸到', n); }
    return o(x, y, r, dmg, color, skip, att, per);
  });
  wrap('tickWeaponFx', (o, p, dt) => {
    const r = o(p, dt), w = G.wp;
    if (w.crowd) max('群戰最多隻', p.crowdK || 0);
    if (w.ascetic) max('空格苦行最多空格', vm.runInThisContext('emptySlots')());
    if (w.static) max('靜電最多格', p.staticK || 0);
    if (w.focus) max('專注最多層', p.focusK || 0);
    if (w.graze) max('擦彈最多層', p.grazeK || 0);
    if (w.spreadUp) max('分散最多層', p.spreadK || 0);
    if (w.parryUp) max('格擋流最多層', p.parryK || 0);
    if (w.rage) max('狂怒最高射速%', Math.round(vm.runInThisContext('rageAdd')(p, w.rage) * 100));
    if (G.mech.traits.streak) max('無傷連殺最多層', p.streak || 0);
    return r;
  });
  // ---- 命中事件 ----
  vm.runInThisContext('Events').on('hit', ({ e, b }) => {
    if (b.skewer && b.skN >= 2) inc('串燒穿後命中');
    if (b.shard && b.shards == null && G.wp.shards && G.wp.shards.breed) inc('增殖第二代命中');
    if (b.frostbite && e.slowT > 0) inc('冰封加成命中');
    if (b.aftershock && b.explode) inc('餘震排程');
    if (b.crack) max('碎甲最高%', Math.round((e.shredAmt || 0) * 100));
    if (b.focus) inc('專注命中');
    if (b.inferno) max('業火最多層', e.burnL ? e.burnL.length : 0);
  });
  return {
    reset() { C = {}; },
    text() { return Object.entries(C).map(([k, v]) => `${k} ${v}`).join('、') || '（沒有數到）'; },
  };
};
