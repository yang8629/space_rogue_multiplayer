// 任意網址整頁截圖：node perf/shot.mjs <網址> <輸出檔> [寬 1200] [高 1400]
import puppeteer from 'puppeteer-core';
import { CHROME } from './paths.mjs';
const [url, out, w = '1200', h = '1400'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: +w, height: +h } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1500));
await p.screenshot({ path: out, fullPage: true });
await b.close();
