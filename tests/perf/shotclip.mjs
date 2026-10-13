// 截網頁某一個元素（第 n 個 .cell）：node perf/shotclip.mjs <網址> <輸出> <第幾格>
import puppeteer from 'puppeteer-core';
const [url, out, n = '0'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1240, height: 900, deviceScaleFactor: 2 } });
const p = await b.newPage(); await p.goto(url); await new Promise(r => setTimeout(r, 1500));
const els = await p.$$('.cell'); await els[+n].screenshot({ path: out });
await b.close();
