// 武器升級價值表：新舊對照（分數 = 速度 ÷ √掉血，跟沒升級比）
// 用法：node upvaldiff.js <舊表資料夾> [武器...]   例：node upvaldiff.js runs1010/r8/upval_old blade laser
const fs = require('fs'), path = require('path');
const T_ = require('./load_game').loadGame();
const [oldDir, ...ws] = process.argv.slice(2);
const score = r => r ? r.speed / Math.sqrt(r.dmg) : NaN;
for (const w of ws.length ? ws : ['blade', 'laser', 'scatter', 'plasma', 'railgun']) {
  const f = `upgradevalue_${w}.json`, o = path.join(oldDir, f);
  if (!fs.existsSync(f) || !fs.existsSync(o)) { console.log(`${w}：缺檔`); continue; }
  const A = JSON.parse(fs.readFileSync(o, 'utf8')), B = JSON.parse(fs.readFileSync(f, 'utf8'));
  const W = T_.WEAPONS[w], name = k => k.length === 1 ? '第一段' + W.paths[k].name : W.paths[k[0]].next[+k[1]].name;
  console.log(`== ${W.short}（舊 → 新，難度 ${Object.keys(B).join('／')}）`);
  const keys = Object.keys(B[Object.keys(B)[0]]);
  const rows = keys.map(k => ({ k, n: name(k), v: Object.keys(B).map(t => [score(A[t] && A[t][k]), score(B[t][k])]) }));
  const mid = t => { const s = rows.filter(r => r.k.length === 2).map(r => r.v[t][1]).sort((a, b) => a - b); return (s[2] + s[3]) / 2; };  // 終極 6 條的中間值
  for (const r of rows) console.log(`  ${r.n.padEnd(5, '　')} ` + r.v.map(([a, b]) => `${a.toFixed(2)}→${b.toFixed(2)}`).join('　') + `　${r.k.length === 2 ? `（難度 6 跟終極中間值比 ${(r.v[1][1] / mid(1) * 100 - 100).toFixed(0)}%）` : ''}`);
}
