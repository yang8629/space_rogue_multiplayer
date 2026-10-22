// 開一個頁面、等幾秒、印出 document.title（小實驗用：頁面把結果寫在標題）並截圖
import puppeteer from 'puppeteer-core';
import { CHROME } from './paths.mjs';
const [url, out, ms = '4000'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: false, defaultViewport: { width: 800, height: 500 } });
const p = await b.newPage(); p.on('pageerror', e => console.log('頁面錯誤', e.message)); p.on('console', m => { if (m.type() === 'error') console.log('console', m.text()); });
await p.goto(url); await new Promise(r => setTimeout(r, +ms));
console.log(await p.title()); if (out) await p.screenshot({ path: out });
await b.close();
