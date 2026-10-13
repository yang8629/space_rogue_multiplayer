'use strict';
// 電路編輯器的操作：插組件、拔組件、晶片換位置時插件跟著走、晶片拿回倉庫時組件退回、擋下的情況、靶場沒有倉庫
const T = require('./load_game').loadGame();
const G = T.Game, E = T.Editor;
let fails = 0;
const ok = (c, msg) => { console.log(`${c ? 'ok  ' : 'FAIL'} ${msg}`); if (!c) fails++; };
const reset = () => {
  G.newRun('run', 'vanguard', 'laser');
  G.wSock = 1;
  G.chain = ['weapon', T.chipId('sticky', 1, 2), T.chipId('orbit', 1, 1), null, null];
  G.socks = [[], [], []];
  G.slotAttr = [null, 'eff', null, 'flaky'];
  G.inventory = ['amp', 'split', 'overclock', T.chipId('rear', 1, 1), null, null];
  G.recalc(); G.toggleEditor();
};
const S = () => JSON.stringify(G.socks.map(s => s || []));

reset();
E.dropOn(G.chain, 1, { from: 'inv', index: 0 });  // 倍增拖到黏著上
ok(S().startsWith('[[],["amp"]') && G.inventory[0] === null, `組件拖到晶片上 = 插進去（${S()}）`);
E.plug(1, { from: 'inv', index: 1 });  // 分裂插到黏著的空插座
ok(G.socks[1].length === 2, '插到空插座');
E.plug(1, { from: 'inv', index: 2 });  // 超頻插黏著：擋
ok(G.socks[1].length === 2 && G.inventory[2] === 'overclock' && /超頻|插座滿了/.test(E.infoEl.innerHTML), `插不進去會擋下並說明（${E.infoEl.textContent.slice(0, 30)}）`);
E.plug(0, { from: 'inv', index: 2 });  // 超頻插武器（武器 1 個插座）
ok(G.socks[0][0] === 'overclock', '超頻插武器');
E.dropOn(G.chain, 2, { from: 'sock', h: 1, k: 0 });  // 倍增從黏著移到環繞
ok(G.socks[1].join() === 'split' && G.socks[2].join() === 'amp', '組件從一個晶片移到另一個晶片');
E.dropOn(G.chain, 3, { from: 'inv', index: 0 });  // 倉庫裡沒東西：不動
const before = S();
E.dropOn(G.chain, 1, { from: 'slot', index: 2 });  // 環繞拖到黏著上：換位置，插件跟著走，屬性留在格子上
ok(T.baseOf(G.chain[1]) === 'orbit' && G.socks[1].join() === 'amp' && G.socks[2].join() === 'split' && G.slotAttr[1] === 'eff', `晶片換位置：插件跟著走、屬性留在格子（${before} → ${S()}）`);
E.dropOn(G.inventory, 4, { from: 'slot', index: 2 });  // 黏著（插著分裂）拿回倉庫：分裂也退回倉庫
ok(G.chain[2] === null && T.baseOf(G.inventory[4]) === 'sticky' && G.inventory.includes('split') && (G.socks[2] || []).length === 0, '晶片拿回倉庫：插座上的組件退回倉庫');
E.dropOn(G.chain, 2, { from: 'inv', index: 3 });  // 反向放到空格
ok(T.baseOf(G.chain[2]) === 'rear', '晶片從倉庫放到空格');
E.dropOn(G.chain, 3, { from: 'inv', index: G.inventory.indexOf('split') });  // 組件拖到空格：擋
ok(G.chain[3] === null && /組件要插在晶片上/.test(E.infoEl.innerHTML), '組件拖到空格會擋下');
// 倉庫滿了：晶片拿不回來
reset();
G.socks[1] = ['amp', 'split'];
G.inventory = ['bigshot', 'pierce', 'amp', 'split', 'mirror', null]; G.recalc();
E.dropOn(G.inventory, 5, { from: 'slot', index: 1 });
ok(T.baseOf(G.chain[1]) === 'sticky' && G.socks[1].length === 2 && /倉庫放不下/.test(E.infoEl.innerHTML), '倉庫放不下插座上的組件時擋下');
// 回收電路上的晶片：組件退回倉庫
reset();
G.socks[1] = ['amp']; G.recalc();
E.recycle({ from: 'slot', index: 1 });
ok(G.chain[1] === null && G.inventory.includes('amp'), '回收晶片：組件退回倉庫');
// 從倉庫換掉電路上的晶片：組件留下來插在新的晶片上
reset();
G.socks[1] = ['amp']; G.recalc();
E.dropOn(G.chain, 1, { from: 'inv', index: 3 });
ok(T.baseOf(G.chain[1]) === 'rear' && G.socks[1].join() === 'amp' && G.inventory.some(x => x && T.baseOf(x) === 'sticky'), '倉庫的晶片換上去：組件留著插在新的晶片上');
// 右鍵：組件自動插進還有空插座的晶片
reset();
E.quickMove(G.inventory, 0);
ok(G.socks.some(s => s && s.includes('amp')) && G.inventory[0] === null, '倉庫的組件按右鍵：自動插進有空插座的晶片');
// 會沒有作用的擺法不給放
reset();
G.inventory[4] = 'mirror'; G.recalc();
E.plug(1, { from: 'inv', index: 4 });  // 鏡像插在黏著的第一格：再爆一次 → 可以放
ok((G.socks[1] || []).join() === 'mirror' && G.inventory[4] === null, '鏡像插在玩法晶片第一格：可以放（產物多一份）');
reset();
G.chain[1] = T.chipId('pull', 1, 2); G.inventory[4] = 'mirror'; G.recalc();
E.plug(1, { from: 'inv', index: 4 });  // 吸引只能插巨彈 → 擋
ok((G.socks[1] || []).length === 0 && G.inventory[4] === 'mirror' && /只能插巨彈/.test(E.infoEl.innerHTML), '鏡像插在吸引上：不給放');
reset();
G.chain[3] = T.chipId('trigger', 1, 1); G.recalc();
E.dropOn(G.chain, 4, { from: 'slot', index: 2 });  // 環繞移到觸發器右邊：沒作用 → 擋
ok(T.baseOf(G.chain[2]) === 'orbit' && G.chain[4] === null && /不給放/.test(E.infoEl.innerHTML), '環繞放到觸發器右邊：不給放');
G.socks[1] = ['amp', 'split']; G.recalc();
E.dropOn(G.chain, 1, { from: 'inv', index: 3 });  // 反向（1 個插座）換掉黏著（插著 2 個）：多的沒作用 → 擋
ok(T.baseOf(G.chain[1]) === 'sticky' && G.socks[1].length === 2 && /不給放/.test(E.infoEl.innerHTML), '換上插座比較少的晶片、組件放不下：不給放');
G.toggleEditor();
// 靶場：沒有倉庫，右鍵直接拿掉
G.toggleEditor();
G.newRun('range', 'vanguard', 'laser'); G.chain = ['weapon', T.chipId('sticky', 1, 3), null, null, null, null]; G.socks = [['amp'], ['split']]; G.recalc(); G.toggleEditor();
ok(E.invEl.classList.contains('hidden'), '靶場：倉庫藏起來');
E.quickMove(G.chain, 1);
ok(G.chain[1] === null && (G.socks[1] || []).length === 0, '靶場：右鍵直接拿掉晶片（插件一起拿掉）');
console.log(fails ? `${fails} FAILED` : 'ALL PASSED');
process.exitCode = fails ? 1 : 0;
