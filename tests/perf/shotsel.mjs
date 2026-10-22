// 截網頁某一個元素（CSS 選擇器）：node perf/shotsel.mjs <網址> <輸出> <選擇器>
import puppeteer from 'puppeteer-core';
import { CHROME } from './paths.mjs';
const [url, out, n = '#gEnemy'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1240, height: 900, deviceScaleFactor: 2 } });
const p = await b.newPage(); await p.goto(url); await new Promise(r => setTimeout(r, 1500));
const el = await p.$(n); await el.screenshot({ path: out });
await b.close();
