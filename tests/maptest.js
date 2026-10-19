'use strict';
// 航圖：產生很多張，確認保底規則（黑洞後的路上有維修站、一條路最多一個黑洞…）每張都成立
require('./load_game').loadGame();
const vm = require('vm');
const T = vm.runInThisContext('({ genMap, genMapOnce, mapOk })');
let fails = 0;
const ok = (c, m) => { if (!c) { fails++; console.error('FAIL:', m); } else console.log('ok  ', m); };

const N = +((process.argv.find(a => a.startsWith('--n=')) || '').slice(4)) || 3000;  // --n=1000：release.js 拆成 3 份同時跑（一份 1000 張）
let bad = 0, once = 0, maxHoles = 0, holeL = new Set(), repairs = 0, holesTotal = 0, dup = 0;
for (let i = 0; i < N; i++) {
  if (T.mapOk(T.genMapOnce())) once++;
  const m = T.genMap(), all = m.flat(), byId = id => all.find(n => n.id === id);
  if (!T.mapOk(m)) { bad++; continue; }
  // 自己再數一次：從起點走到旗艦的每一條路線上，黑洞最多一個
  const walk = (n, k) => {
    k += n.type === 'blackhole' ? 1 : 0;
    maxHoles = Math.max(maxHoles, k);
    n.next.forEach(id => walk(byId(id), k));
  };
  m[0].forEach(n => walk(n, 0));
  for (const h of all.filter(n => n.type === 'blackhole')) { holeL.add(h.L); holesTotal++; }
  repairs += all.filter(n => n.type === 'repair').length;
  // 自己再數一次：每個分岔（含起點那一列）的選項不重複：沒有兩個同種的重要房間，也沒有兩個一模一樣的選項
  for (const opts of [m[0], ...all.map(n => n.next.map(byId))])
    for (let a = 0; a < opts.length; a++) for (let b = a + 1; b < opts.length; b++)
      if (opts[a].type === opts[b].type && (opts[a].type !== 'combat' || opts[a].next.join() === opts[b].next.join())) dup++;
}
ok(bad === 0, `${N} 張航圖全部符合保底規則（單次生成就符合的 ${(once / N * 100).toFixed(0)}%）`);
ok(dup === 0, `分岔的選項不重複（重複 ${dup} 組）`);
ok(maxHoles === 1, `任何一條路線最多 ${maxHoles} 個黑洞`);
ok([...holeL].every(L => L === 2 || L === 3), `黑洞只在第 ${[...holeL].sort().map(L => L + 1).join('、')} 層`);
console.log(`     平均每張：黑洞 ${(holesTotal / N).toFixed(2)} 個、維修站 ${(repairs / N).toFixed(2)} 個`);
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
