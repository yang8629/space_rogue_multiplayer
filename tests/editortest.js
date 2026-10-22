'use strict';
// 電路編輯器的操作：插插件、拔插件、同種晶片合成、晶片換位置時插件跟著走、晶片拿回倉庫時插件退回、排尾的「＋」（接在線的最後）、擋下的情況、靶場沒有倉庫
const T = require('./load_game').loadGame();
const G = T.Game, E = T.Editor;
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const reset = () => {
  G.newRun('run', 'vanguard', 'laser');
  G.wSock = 1;
  G.chain = ['weapon', T.chipId('stasis', 2), T.chipId('boomerang', 1), null, null];
  G.socks = [[], [], []];
  G.inventory = ['amp', 'frost', 'bigshot', T.chipId('infect', 1), T.chipId('echo', 1), null];
  G.recalc(); G.toggleEditor();
};
const S = () => JSON.stringify(G.socks.map(s => s || []));

reset();
E.dropOn(G.chain, 1, { from: 'inv', index: 0 });  // 傷害插件拖到佈雷上
ok(S().startsWith('[[],["amp"]') && G.inventory[0] === null, `插件拖到晶片上 = 插進去（${S()}）`);
E.plug(1, { from: 'inv', index: 1 });  // 冰凍插到佈雷的空插座
ok(G.socks[1].length === 2 && T.slotLv(1) === 1, `插到空插座；插件不讓晶片升級（Lv${T.slotLv(1)}）`);
E.plug(1, { from: 'inv', index: 2 });  // 佈雷插座滿了：擋
ok(G.socks[1].length === 2 && G.inventory[2] === 'bigshot' && /插座滿了/.test(E.infoEl.innerHTML), `插座滿了會擋下並說明（${E.infoEl.textContent.slice(0, 30)}）`);
E.plug(0, { from: 'inv', index: 2 });  // 大小插武器（武器 1 個插座）
ok(G.socks[0][0] === 'bigshot', '插件插武器');
E.dropOn(G.chain, 2, { from: 'sock', h: 1, k: 0 });  // 傷害從佈雷移到迴旋
ok(G.socks[1].join() === 'frost' && G.socks[2].join() === 'amp', '插件從一片晶片移到另一片');
const before = S();
E.dropOn(G.chain, 1, { from: 'slot', index: 2 });  // 迴旋拖到佈雷上：換位置，插件跟著走
ok(T.baseOf(G.chain[1]) === 'boomerang' && G.socks[1].join() === 'amp' && G.socks[2].join() === 'frost', `晶片換位置：插件跟著走（${before} → ${S()}）`);
E.dropOn(G.inventory, 5, { from: 'slot', index: 1 });  // 迴旋（插著傷害）拿回倉庫：傷害也退回倉庫；空格集中到最後
ok(T.baseOf(G.chain[1]) === 'stasis' && G.chain.slice(2).every(x => !x) && T.baseOf(G.inventory[5]) === 'boomerang' && G.inventory.includes('amp'), `晶片拿回倉庫：插件退回、空格集中到最後（${G.chain.map(x => x && T.baseOf(x)).join()}）`);
// 排尾的「＋」：晶片接在線的最後
E.dropAppend({ from: 'inv', index: 3 });  // 感染接在最後
ok(T.baseOf(G.chain[2]) === 'infect' && G.stats.line.cells.length === 2, '晶片放到排尾的＋：接在線的最後');
E.dropAppend({ from: 'inv', index: 4 });  // 回響接在最後
ok(G.stats.line.cells.map(c => c.key).join() === 'stasis,infect,echo', `接在最後（${G.stats.line.cells.map(c => c.key)}）`);
E.dropAppend({ from: 'inv', index: 5 });  // 迴旋接在最後：空位用完
ok(G.stats.line.cells.length === 4 && !G.chain.includes(null), '空位用完');
E.dropAppend({ from: 'inv', index: G.inventory.indexOf('amp') });  // 插件放到＋：擋
ok(/插件要插在晶片上/.test(E.infoEl.innerHTML), '插件放到排尾的＋會擋下');
G.inventory[0] = T.chipId('homing', 1); G.recalc();
E.dropAppend({ from: 'inv', index: 0 });  // 沒有空位：擋
ok(T.baseOf(G.inventory[0]) === 'homing' && /沒有空位/.test(E.infoEl.innerHTML), '沒有空位時擋下');
E.dropAppend({ from: 'slot', index: 1 });  // 電路上的佈雷搬到最後（插件跟著走）
ok(G.stats.line.cells.map(c => c.key).join() === 'infect,echo,boomerang,stasis' && G.socks[G.chain.findIndex(x => x && T.baseOf(x) === 'stasis')].join() === 'frost',
  `晶片搬到最後：插件跟著走（${G.stats.line.cells.map(c => c.key)}）`);
// 合成：同種晶片拖到一起 → 等級相加、插座取大的、兩片的插件都移過去（插不下的退回倉庫）
reset();
G.chain[2] = T.chipId('stasis', 1); G.socks[1] = ['amp', 'frost']; G.socks[2] = ['shred']; G.recalc();
E.dropOn(G.chain, 1, { from: 'slot', index: 2 });  // 佈雷（1 插座，插破甲）疊到佈雷（2 插座，插 2 個）上
ok(G.chain[1] === T.chipId('stasis', 2, 2) && G.socks[1].join() === 'amp,frost' && G.inventory.includes('shred') && G.chain.filter(x => x && T.baseOf(x) === 'stasis').length === 1 && T.slotLv(1) === 2,
  `電路上兩片合成：Lv2、插座 2、插不下的退回倉庫（${G.chain[1]}，插座 ${G.socks[1]}）`);
G.inventory = [T.chipId('stasis', 3), null, null, null, null, null]; E.dropOn(G.chain, 1, { from: 'inv', index: 0 });
ok(G.chain[1] === T.chipId('stasis', 3, 3) && !G.inventory.some(x => x && T.baseOf(x) === 'stasis') && G.socks[1].join() === 'amp,frost' && T.slotLv(1) === 3, `倉庫的疊到電路上：Lv3、插座取大的（${G.chain[1]}）`);
G.inventory[0] = T.chipId('stasis', 1); E.dropOn(G.chain, 1, { from: 'inv', index: 0 });
ok(G.chain[1] === T.chipId('stasis', 3, 3) && G.inventory.some(x => x && T.baseOf(x) === 'stasis') && /超過 Lv3/.test(E.infoEl.innerHTML), '合起來超過 Lv3：擋下');
reset();
G.socks[2] = ['amp']; G.inventory[5] = T.chipId('boomerang', 3); G.recalc();
E.dropOn(G.inventory, 5, { from: 'slot', index: 2 });  // 電路上的迴旋拖到倉庫的迴旋上：合成後留在電路上
ok(G.chain[2] === T.chipId('boomerang', 3, 2) && G.socks[2].join() === 'amp' && G.inventory[5] === null, `電路的疊到倉庫的：合成後留在電路上（${G.chain[2]}）`);
ok(T.parseChipId(T.chipId('boomerang', 3, 2)) === T.chipId('boomerang', 3, 2) && T.parseChipId('amp^2') === null, '合成過的晶片 id 對方認得；插件不能帶等級');
// 倉庫滿了：晶片拿不回來
reset();
G.socks[1] = ['amp', 'frost'];
G.inventory = ['bigshot', 'amp', 'frost', 'shred', 'shock', null]; G.recalc();
E.dropOn(G.inventory, 5, { from: 'slot', index: 1 });
ok(T.baseOf(G.chain[1]) === 'stasis' && G.socks[1].length === 2 && /倉庫放不下/.test(E.infoEl.innerHTML), '倉庫放不下插座上的插件時擋下');
// 回收電路上的晶片：插件退回倉庫
reset();
G.socks[1] = ['amp']; G.recalc();
E.recycle({ from: 'slot', index: 1 });
ok(!G.chain.some(x => x && T.baseOf(x) === 'stasis') && G.inventory.includes('amp'), '回收晶片：插件退回倉庫');
// 從倉庫換掉電路上的晶片：插件留下來插在新的晶片上
reset();
G.socks[2] = ['amp']; G.recalc();
E.dropOn(G.chain, 2, { from: 'inv', index: 3 });
ok(T.baseOf(G.chain[2]) === 'infect' && G.socks[2].join() === 'amp' && G.inventory.some(x => x && T.baseOf(x) === 'boomerang'), '倉庫的晶片換上去：插件留著插在新的晶片上');
// 右鍵：插件自動插進還有空插座的晶片；晶片接在武器線最後
reset();
E.quickMove(G.inventory, 0);
ok(G.socks.some(s => s && s.includes('amp')) && G.inventory[0] === null, '倉庫的插件按右鍵：自動插進有空插座的晶片');
E.quickMove(G.inventory, 3);
ok(G.stats.line.cells.map(c => c.key).join() === 'stasis,boomerang,infect', '倉庫的晶片按右鍵：接在武器線最後');
// 換上插座比較少的晶片、插件放不下：不給放
reset();
G.socks[1] = ['amp', 'frost']; G.recalc();
E.dropOn(G.chain, 1, { from: 'inv', index: 3 });  // 感染（1 個插座）換掉佈雷（插著 2 個）
ok(T.baseOf(G.chain[1]) === 'stasis' && G.socks[1].length === 2 && /不給放/.test(E.infoEl.innerHTML), '換上插座比較少的晶片、插件放不下：不給放');
G.toggleEditor();
// 靶場：沒有倉庫，右鍵直接拿掉
G.newRun('range', 'vanguard', 'laser'); G.chain = ['weapon', T.chipId('stasis', 3), null, null, null, null]; G.socks = [['amp'], ['frost']]; G.recalc(); G.toggleEditor();
ok(E.invEl.classList.contains('hidden'), '靶場：倉庫藏起來');
E.quickMove(G.chain, 1);
ok(!G.chain.some(x => x && T.baseOf(x) === 'stasis') && !(G.socks[1] || []).length, '靶場：右鍵直接拿掉晶片（插件一起拿掉）');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
