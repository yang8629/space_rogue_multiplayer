// 看整套配裝評分（bot/value.js）怎麼看每條武器升級路線：開局（只有武器）時，每把武器 3 條路線 × 2 個第二段的分數（相對沒升級）
//   用法：node bot/showscore.js [--chips=accel,stand] [--parts=sink:2,larmor:2]
'use strict';
const T_ = require('../load_game').loadGame();
const B = require('./load').loadBot(code => require('vm').runInThisContext(code));
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const G = T_.Game;
for (const w of Object.keys(T_.WEAPONS)) {
  G.newRun('run', 'vanguard', w, null);
  if (arg('chips')) arg('chips').split(',').forEach((c, i) => { G.chain[i + 1] = c; });
  if (arg('parts')) for (const kv of arg('parts').split(',')) { const [k, n] = kv.split(':'); G.parts[k] = +n; }
  G.recalc();
  const base = B.buildScore(), W = T_.WEAPONS[w], rows = [];
  for (const path of Object.keys(W.paths)) {
    rows.push(W.paths[path].name + '：' + W.paths[path].next.map((n, f) => `${n.name} ×${(B.trial(() => { G.weapon = { ...G.weapon, path, final: f }; }) / base).toFixed(2)}`).join('　'));
  }
  console.log(`${W.name}（選 ${W.paths[B.pickUpgrade()].name}）\n  ` + rows.join('\n  '));
}
