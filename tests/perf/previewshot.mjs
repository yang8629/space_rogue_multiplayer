// 「敵人與物件畫風」預覽頁（tools/art/build_preview.js 產生的）：打開看有沒有錯誤，截精英、旗艦兩段
//   用法：node perf/previewshot.mjs   → art_lab/screenshots/畫風頁_精英.png、畫風頁_旗艦.png、畫風頁_敵人.png
import { ROOT, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1200, height: 900 } });
const p = await b.newPage();
let errs = 0;
p.on('pageerror', e => { errs++; console.log('頁面錯誤', e.message); });
await p.goto('file:///' + (ROOT + '../art_lab/敵人與物件畫風.html').replace(/\\/g, '/'));
await new Promise(r => setTimeout(r, 2500));
const n = await p.evaluate(() => ({ e: document.querySelectorAll('#gEnemy .cell').length, el: document.querySelectorAll('#gElite .cell').length, b: document.querySelectorAll('#gBoss .cell').length, o: document.querySelectorAll('#gObj .cell').length, s: document.querySelectorAll('#gShip .cell').length, w: document.querySelectorAll('#gWeapon .cell').length }));
console.log(`卡片：飛船 ${n.s}、武器 ${n.w}、敵人 ${n.e}、精英 ${n.el}、旗艦 ${n.b}、地圖物件 ${n.o}；頁面錯誤 ${errs}`);
for (const [id, name] of [['gShip', '飛船'], ['gWeapon', '武器'], ['gEnemy', '敵人'], ['gElite', '精英'], ['gBoss', '旗艦']]) {
  const el = await p.$('#' + id);
  await el.screenshot({ path: SHOTS + `畫風頁_${name}.png` });
}
console.log('存好截圖');
await b.close();
