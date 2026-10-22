// 電路編輯器截圖（看組件升級：晶片名稱上的等級、說明框的等級來源）→ art_lab/screenshots/電路編輯器_組件升級.png
//   用法：node perf/editorshot.mjs（環境變數 CHROME 指定 Chrome 位置，預設 Windows 的）
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const OUT = SHOTS;
const url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: process.env.CHROME || CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message, String(e.stack || '').split(/\r?\n/).slice(1, 3).join(' / ')));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
const info = await p.evaluate(() => {
  SFX.setMuted && SFX.setMuted(true);
  Game.newRun('run', 'vanguard', 'laser'); Game.cap = 20;
  // 環繞插 2 個（進化）、牆反彈插 1 個（Lv2）、吸引插鏡像（只升級，沒有效果）
  Game.chain = ['weapon', chipId('orbit', 2), chipId('wallbounce', 2), chipId('pull', 1)];
  Game.socks = [[], ['amp', 'split'], ['pierce'], ['mirror']];
  Game.inventory[0] = chipId('charge', 3); Game.recalc();
  Game.toggleEditor();
  Editor.showInfo(Game.chain[2], 2);
  return [...document.querySelectorAll('#editor .chip .nm')].map(e => e.textContent);
});
console.log('格子上的名稱', JSON.stringify(info));
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: `${OUT}電路編輯器_組件升級.png` });
await b.close();
console.log('done');
