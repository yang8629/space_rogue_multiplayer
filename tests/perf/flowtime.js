// 敵人尋路路線圖（Objects.buildFlow）算一次要多久：大地圖、有黑洞＋行星＋小行星帶
//   用法：node perf/flowtime.js
'use strict';
const T_ = require('../load_game').loadGame();
const G = T_.Game, O = T_.Objects, A = T_.Arena;
let total = 0, n = 0, worst = 0, holes = 0;
for (let s = 0; s < 30; s++) {
  G.newRun('run', 'vanguard', 'laser');
  G.node = { type: 'combat', L: 3, id: 'f' + s };
  G.startCombat({ level: 6, wavesTotal: 3, elites: 0 });
  if (A.rect) continue;
  holes += G.objs.filter(o => o.type === 'hole').length;
  for (let i = 0; i < 20; i++) { const t0 = process.hrtime.bigint(); O.buildFlow(); const ms = Number(process.hrtime.bigint() - t0) / 1e6; total += ms; n++; worst = Math.max(worst, ms); }
}
console.log(`buildFlow ${n} 次：平均 ${(total / n).toFixed(2)} ms、最慢 ${worst.toFixed(2)} ms（地圖上黑洞共 ${holes} 個）`);
