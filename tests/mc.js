// 只跑名稱或分組含關鍵字的機制檢查，一項一行。用法：node mc.js 迴旋 黏著   （不給關鍵字 = 只印沒過的）
const T_ = require('./load_game').loadGame();
const keys = process.argv.slice(2);
const list = T_.MechCheck.runAll().list;
const pick = keys.length ? list.filter(x => keys.some(k => x.name.includes(k) || x.group.includes(k))) : list.filter(x => !x.ok);
for (const x of pick) console.log(`${x.ok ? 'ok  ' : 'FAIL'} ${x.name}：${x.got}`);
if (!keys.length) console.log(`${list.length - pick.length}/${list.length} 通過`);
else if (!pick.length) console.log('沒有符合的檢查');
process.exitCode = list.some(x => !x.ok) ? 1 : 0;
