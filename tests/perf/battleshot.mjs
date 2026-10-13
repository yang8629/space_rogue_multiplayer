// 戰鬥畫面截圖：開一場大地圖一般戰（有牆、閘門、地圖物件），跑幾秒後截整個畫面
//   用法：node perf/battleshot.mjs <輸出檔> [遊戲資料夾網址]
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const out = process.argv[2], url = process.argv[3] || GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Math.random = (() => { let s = 7; return () => (s = (s * 16807) % 2147483647) / 2147483647; })();  // 固定亂數：兩個版本產生同一張地圖
  Game.newRun('run', 'vanguard', 'scatter');
  Game.node = { type: 'combat', L: 4, id: 'shot' };
  Game.startCombat({ level: 4, wavesTotal: 3, elites: 0 });
  Game.player.hp = Game.player.maxHp = 1e9;
});
await new Promise(r => setTimeout(r, 2500));
await p.screenshot({ path: out });
await b.close();
