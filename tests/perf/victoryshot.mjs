// 擊沉旗艦的勝利畫面截圖（二選一還沒選／選了電路插槽）→ art_lab/screenshots/勝利畫面_*.png
//   用法：node perf/victoryshot.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.node = { type: 'boss', L: 9, id: 'shot' };
  Game.startCombat({ level: 4, wavesTotal: 1, elites: 0, boss: true });
  Game.combatWon();
  Screen.clickLock = 0;
});
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: OUT + '勝利畫面_還沒選.png' });
await p.evaluate(() => Game.pickBossSlot('chain'));
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: OUT + '勝利畫面_選了插槽.png' });
await b.close();
