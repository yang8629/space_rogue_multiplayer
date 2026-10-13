// 電路編輯器截圖（看晶片格子上的成長數值）→ art_lab/screenshots/電路編輯器_成長數值.png
//   用法：node perf/editorshot.mjs
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
const info = await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser');
  Game.chain = ['weapon', chipId('orbit', 1, 0), chipId('wallbounce', 2, 0), chipId('split', 1, 0)]; Game.socks = [[], [], [], []];
  Game.inventory[0] = chipId('charge', 1, 0);
  Game.growth = { orbit: 62, wallbounce: 300, charge: 5 }; Game.recalc();
  Game.toggleEditor();
  return [...document.querySelectorAll('.gnum')].map(e => e.textContent);
});
console.log('格子上的數字', JSON.stringify(info));
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: `${OUT}電路編輯器_成長數值.png` });
await b.close();
console.log('done');
