// 斷線判斷（真的 PeerJS）：兩個 Chrome 進同一個房間
//   1. 一起放 10 秒：不能誤判
//   2. 房主「網路斷掉」（訊息全部送不出去、頁面還開著）：隊友要在 NET_SILENT（5 秒）左右發現（以前 60 秒內都沒發現）
//   3. 再開一組：房主關掉分頁（照常跑 beforeunload → Net.close 送 bye）：隊友馬上知道
//   用法：node perf/hardclose.mjs
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const launch = () => puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 800 } });
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
const until = async (p, fn, ms = 20000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await p.evaluate(fn)) return true; await wait(100); } return false; };
async function room() {
  const [bA, bB] = await Promise.all([launch(), launch()]);
  const [A, B] = await Promise.all([bA.newPage(), bB.newPage()]);
  for (const [p, n] of [[A, '房主'], [B, '隊友']]) p.on('pageerror', e => console.log(n, '頁面錯誤', e.message));
  await Promise.all([A, B].map(async p => { await p.goto(GAME + 'index.html'); await wait(1500); }));
  await A.evaluate(() => Net.lobby()); await A.click('[data-act="nethost"]');
  await until(A, () => Game.state === 'pick' && Net.code);
  const code = await A.evaluate(() => Net.code);
  await B.evaluate(() => Net.lobby()); await B.type('#netCode', code); await B.click('[data-act="netjoin"]');
  ok(await until(B, () => Game.state === 'pick' && Net.linked) && await until(A, () => Net.peers.some(q => q.linked)), '隊友加入房間');
  return { bA, bB, A, B };
}
const noticeTime = async (B, max) => { const t0 = Date.now(); const ok = await until(B, () => !Net.linked, max); return ok ? (Date.now() - t0) / 1000 : null; };
const lobbyMsg = B => B.evaluate(() => ((document.getElementById('netMsg') || {}).textContent || '').trim());

{
  const { bA, bB, A, B } = await room();
  await wait(10000);
  ok(await B.evaluate(() => Net.linked) && await A.evaluate(() => Net.peers.length === 1 && Net.peers[0].linked), '一起在房間 10 秒：兩邊都還連著（沒有誤判）');
  await A.evaluate(() => { Net.put = () => {}; });  // 房主的網路斷了：什麼都送不出去
  const t = await noticeTime(B, 20000);
  ok(t != null && t >= 4 && t < 7, `房主網路斷掉：隊友 ${t == null ? '20 秒內沒有' : t.toFixed(1) + ' 秒後'}發現（${await lobbyMsg(B)}）`);
  await Promise.all([bA.close(), bB.close()]);
}
{
  const { bA, bB, A, B } = await room();
  await A.close({ runBeforeUnload: true });
  const t = await noticeTime(B, 20000);
  ok(t != null && t < 2, `房主關掉分頁：隊友 ${t == null ? '20 秒內沒有' : t.toFixed(1) + ' 秒後'}發現（${await lobbyMsg(B)}）`);
  await Promise.all([bA.close(), bB.close()]);
}
console.log(fails ? `${fails} 項沒過` : '全部通過');
