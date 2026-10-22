// 截第 n 個 .cell，在指定的毫秒數之後：node perf/shotat.mjs <網址> <輸出> <第幾格> <毫秒>
import puppeteer from 'puppeteer-core';
import { CHROME } from './paths.mjs';
const [url, out, n = '0', ms = '1500'] = process.argv.slice(2);
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1240, height: 900, deviceScaleFactor: 2 } });
const p = await b.newPage(); await p.goto(url); await new Promise(r => setTimeout(r, +ms));
const els = await p.$$('.cell'); await els[+n].screenshot({ path: out });
await b.close();
