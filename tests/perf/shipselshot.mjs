// 選飛船畫面截圖 → art_lab/screenshots/選飛船畫面.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 1500));
await p.evaluate(d => { Screen.select('run'); if (d) document.body.classList.add('detail'); }, !!process.env.DETAIL);
await new Promise(r => setTimeout(r, 500));
await p.screenshot({ path: SHOTS + '選飛船畫面' + (process.env.DETAIL ? '_詳細' : '') + '.png' });
await b.close();
