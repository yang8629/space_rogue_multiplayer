// 整局模擬 --probe 時裝上的觸發計數：證明電腦在實戰中真的遇到各種敵人、事件
//   只包一層遊戲的函式／聽事件，不改遊戲；每局開始 reset()，結束 text() 印出有數到的
'use strict';
module.exports = function installProbe(G) {
  const vm = require('vm');
  let C = {};
  const inc = (k, n = 1) => { C[k] = (C[k] || 0) + n; };
  const wrap = (name, fn) => { const o = G[name].bind(G); G[name] = function (...a) { return fn(o, ...a); }; };
  // ---- 包函式 ----
  // 精英詞綴（2026-10-13）：出場幾隻、各詞綴出現幾次、擊殺、地雷爆炸
  //   第二個以後的參數照傳（精英亂入的 { intruder } 在第二個）
  wrap('spawnEnemy', (o, type, ...a) => { const r = o(type, ...a); if (type === 'elite') { const e = G.enemies[G.enemies.length - 1]; inc('精英出場'); if (e.intruder) inc('精英亂入'); for (const id of e.affixes || []) inc('詞綴' + id); } if (type === 'treasure') inc('寶藏出現'); return r; });
  // mp-2.18.0（2026-10-16）：寶藏無人機、蟲潮、？事件、稀有保證
  wrap('startWave', (o, n) => { const r = o(n); if (G.combat.swarmArea) inc('蟲潮區'); return r; });
  wrap('treasureEscape', (o, e) => { inc('寶藏逃走'); return o(e); });
  wrap('bonusLoot', (o, e, k) => { inc('額外獎勵' + k); return o(e, k); });
  // 警戒、警報艇（2026-10-16）：響了幾次、倒數中被打掉幾次、沒響就被打掉幾次
  wrap('alarmPulse', (o, e) => { inc(e.rang ? '警報再叫' : '警報響'); return o(e); });
  wrap('onEnemyKilled', (o, e) => { if (e.t.alarm) inc(e.rang ? '警報艇叫過人才打掉' : e.ringT >= vm.runInThisContext('CFG').ALARM.delay ? '警報艇一擊打掉' : '警報艇倒數中打掉');  /* 一擊：hurt 剛設好倒數就死了 */ return o(e); });
  wrap('evChoose', (o, i) => { const V = G.ev, E = V && vm.runInThisContext('EVENTS')[V.id]; const r = o(i); if (E && (G.ev !== V || V.res)) inc(  /* 選成功才算（選不了的會原封不動） */'事件' + E.name + '：' + E.opts[i].lab); return r; });
  wrap('mineBlast', (o, b) => { inc('地雷爆炸'); return o(b); });
  wrap('onEnemyKilled', (o, e) => { if (e.t.elite) inc('精英擊殺'); return o(e); });
  return {
    reset() { C = {}; },
    text() { return Object.entries(C).map(([k, v]) => `${k} ${v}`).join('、') || '（沒有數到）'; },
  };
};
