// 黑洞能放的位置：大地圖的每個區域，離牆至少 margin 的點有沒有（margin 234 = 以前、350 = 閃避範圍 310 ＋ 40）
//   用法：node perf/holecount.js
'use strict';
const T_ = require('../load_game').loadGame();
const G = T_.Game, A = T_.Arena;
const res = { 234: 0, 350: 0 }; let areas = 0;
for (let s = 0; s < 60; s++) {
  for (const level of [1, 3, 6, 10, 15]) {
    G.newRun('run', 'vanguard', 'laser');
    G.sector = 1 + Math.floor(level / 7);
    G.node = { type: 'combat', L: level % 7, id: 'h' + s };
    G.startCombat({ level, wavesTotal: 3, elites: 0 });
    if (A.rect) continue;
    for (let k = 0; k < A.areas.length; k++) {
      areas++;
      for (const m of [234, 350]) { const p = A.randomIn(k, m); if (A.f(p[0], p[1]) >= m) res[m]++; }
    }
  }
}
console.log(`大地圖區域 ${areas} 個：離牆 234 放得下 ${res[234]}（${Math.round(res[234] / areas * 100)}%）、離牆 350 放得下 ${res[350]}（${Math.round(res[350] / areas * 100)}%）`);
