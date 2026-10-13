'use strict';
// 插座檢查的總表（檢查本身在遊戲的機制檢查裡：SockCheck，見 multiplayer/js/ui/mechcheck.js）
//   用法：node sockcheck.js              雷射、散彈、相位刃三張表＋只算直擊（只印沒過的）
//         node sockcheck.js scatter 黏著  只看散彈、名字有「黏著」的晶片（每格都印）
const T = require('./load_game').loadGame();
const S = T.SockCheck, CH = T.CHIPS;
const args = process.argv.slice(2), W = ['laser', 'scatter', 'blade', 'plasma', 'railgun'];
const ws = args.filter(a => W.includes(a)), keys = args.filter(a => !W.includes(a));
const name = h => h === 'weapon' ? '武器' : CH[h] ? CH[h].name : h;
let bad = 0;
for (const w of ws.length ? ws : ['laser', 'scatter', 'blade']) {
  const rows = S.rows(w).filter(r => !keys.length || keys.some(k => name(r.h).includes(k) || r.h.includes(k)));
  for (const r of rows) if (keys.length || !r.ok) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${T.WEAPONS[w].name} ${name(r.h)}［${CH[r.c].name}］${r.note || ''}：${r.got}`);
  bad += rows.filter(r => !r.ok).length;
  console.log(`\n${T.WEAPONS[w].name}` + S.COMPS.map(c => CH[c].short.padStart(4)).join(''));
  for (const h of [...new Set(rows.map(r => r.h))]) console.log(name(h).padEnd(8) + S.COMPS.map(c => { const r = rows.find(x => x.h === h && x.c === c && !x.note); return (r ? (r.ok ? '✓' : '✗') : '-').padStart(5); }).join(''));
}
if (!keys.length) {
  const D = S.direct();
  for (const r of D) if (!r.ok) console.log(`FAIL 只算直擊 ${r.h}：${r.got}`);
  bad += D.filter(r => !r.ok).length;
  console.log(`\n武器、觸發器插座只算直擊：${D.length - D.filter(r => !r.ok).length}/${D.length}`);
}
console.log(bad ? `\n${bad} 組沒過` : '\nALL PASSED');
process.exitCode = bad ? 1 : 0;
