// 設定頁在真的 Chrome 裡：從基地打開 → 拉主音量滑桿、取消「畫面震動」→ 重新整理 → 設定還在；戰鬥中的選單也打得開
//   截圖 art_lab/screenshots/設定_*.png；印出每一步過了沒
//   用法：node perf/settingsshot.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const wait = ms => new Promise(r => setTimeout(r, ms));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
let fails = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) fails++; };
await p.goto(GAME + 'index.html');
await p.evaluate(() => localStorage.clear());
await p.reload(); await wait(1500);
await p.click('[data-act="settings"]'); await wait(400);
ok(await p.evaluate(() => !!document.getElementById('setPage')), '基地的「⚙ 設定」打開設定頁');
await p.screenshot({ path: SHOTS + '設定_基地.png' });
// 主音量拉到 40%：用鍵盤（點滑桿再按左鍵，每次 5%）
await p.focus('[data-set="vol"]');
for (let i = 0; i < 12; i++) await p.keyboard.press('ArrowLeft');
await p.click('[data-set="shake"]');
ok(await p.evaluate(() => Settings.vol === 0.4 && !Settings.shake && document.querySelector('[data-setv="vol"]').textContent === '40%'), '拉滑桿、取消畫面震動：馬上生效、數字跟著變');
await p.click('[data-act="setback"]'); await wait(300);
ok(await p.evaluate(() => Hub.driving), '返回：回到基地');
await p.reload(); await wait(1500);
ok(await p.evaluate(() => Settings.vol === 0.4 && !Settings.shake), '重新整理後設定還在');
// 戰鬥中：Esc 選單 → 設定 → 返回回到選單
await p.evaluate(() => { Game.newRun('range', 'vanguard', 'laser'); });
await wait(500); await p.keyboard.press('Escape'); await wait(300);
await p.click('[data-act="settings"]'); await wait(300);
ok(await p.evaluate(() => !!document.getElementById('setPage') && Game.pauseMenu), '戰鬥中的選單打得開設定');
await p.screenshot({ path: SHOTS + '設定_戰鬥中.png' });
await p.click('[data-act="setback"]'); await wait(300);
ok(await p.evaluate(() => Screen.el.innerHTML.includes('data-act="resume"')), '返回：回到戰鬥的選單');
await b.close();
console.log(fails ? `${fails} 項沒過` : '全部通過');
process.exitCode = fails ? 1 : 0;
