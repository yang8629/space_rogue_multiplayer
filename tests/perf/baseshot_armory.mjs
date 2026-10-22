// 基地軍械庫面板截圖：精簡說明、按 Shift 後的完整說明 → art_lab/screenshots/軍械庫_精簡.png、軍械庫_詳細.png
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2000));
await p.evaluate(() => { document.body.classList.remove('detail'); Screen.basePanel('armory'); });
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '軍械庫_精簡.png' });
await p.keyboard.press('Shift'); await new Promise(r => setTimeout(r, 300));
console.log('按 Shift 後 body.detail =', await p.evaluate(() => document.body.classList.contains('detail')), '｜有「詳細」按鈕 =', await p.evaluate(() => !!document.querySelector('[data-act="detail"]')));
await p.screenshot({ path: SHOTS + '軍械庫_詳細.png' });
await b.close();
