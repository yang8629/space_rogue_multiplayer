// 電路編輯器（遠征中）的晶片說明框截圖：有插座的 Lv1 晶片也要看得到各等級效果 → art_lab/screenshots/包包晶片說明.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
const txt = await p.evaluate(() => {
  Game.newRun('run', 'vanguard', 'laser');
  Game.inventory[0] = chipId('orbit', 2); Game.inventory[1] = chipId('orbit', 2); Game.recalc();
  Game.toggleEditor(); Editor.showInfo(Game.inventory[0]);
  Editor.infoEl.scrollIntoView({ block: 'center' });
  return Editor.infoEl.innerText;
});
console.log(txt);
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '包包晶片說明.png' });
await b.close();
