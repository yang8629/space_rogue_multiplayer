// 只剩新畫面（2026-10-09 拿掉舊的 2D 畫面）：標題畫面（沒有切換按鈕）、大地圖戰鬥（牆、敵人、小地圖、HUD）、PixiJS 載入失敗時的提示
//   用法：node perf/onlyglshot.mjs → art_lab/screenshots/只剩新畫面_*.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS, url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: OUT + '只剩新畫面_標題.png' });
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'combat', L: 3, id: 'shot' };
  Game.startCombat({ level: 3, wavesTotal: 3, elites: 0 });
  Game.player.hp = Game.player.maxHp = 1e9;
  Game.player.wantFire = true; Input.down = true;
});
await new Promise(r => setTimeout(r, 3000));
console.log(await p.evaluate(() => `GL ready ${GLR.ready} failed ${GLR.failed}；大地圖 ${!Arena.rect}；敵人 ${Game.enemies.length}`));
await p.screenshot({ path: OUT + '只剩新畫面_戰鬥.png' });
// 載入失敗：擋掉 CDN
const q = await b.newPage();
await q.setRequestInterception(true);
q.on('request', r => r.url().includes('jsdelivr') ? r.abort() : r.continue());
await q.goto(url); await new Promise(r => setTimeout(r, 1000));
await q.evaluate(() => { Game.newRun('run', 'vanguard', 'laser'); Game.node = { type: 'combat', L: 1, id: 'shot' }; Game.startCombat({ level: 1, wavesTotal: 1, elites: 0 }); });
await new Promise(r => setTimeout(r, 600));
await q.screenshot({ path: OUT + '只剩新畫面_載入失敗.png' });
await b.close();
