// 全隊投票的事件（求救訊號）畫面：多人時投了票之後的樣子（按鈕鎖住、列出每個人投了什麼、倒數），和抽籤結果
//   用法：node perf/evvoteshot.mjs   → art_lab/screenshots/事件投票_投票中.png、事件投票_結果.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  // 假裝是房主、有一個隊友（不連線：只看畫面）
  Game.mode = 'coop'; Net.role = 'host'; Net.linked = true; Net.peers = [{ slot: 2, linked: true, conn: { open: true, send() {} } }];
  Game.openEvent({ id: 'shot', L: 1, k: 0, n: 1, type: 'event', next: [], ev: 'sos' });
  Game.evChoose(0);
});
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '事件投票_投票中.png' });
await p.evaluate(() => { Net.evVotes[2] = 2; Net.tryResolveEv(true); });
await new Promise(r => setTimeout(r, 300));
await p.screenshot({ path: SHOTS + '事件投票_結果.png' });
console.log('存好 事件投票_投票中.png、事件投票_結果.png');
await b.close();
