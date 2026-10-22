// 把幾張截圖拼成一張（橫排），方便一次看：node perf/montage.mjs <輸出> <圖1> <圖2> …
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import { CHROME } from './paths.mjs';
const [out, ...files] = process.argv.slice(2);
const imgs = files.map(f => 'data:image/png;base64,' + fs.readFileSync(f).toString('base64'));
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new' });
const p = await b.newPage();
await p.setContent(`<body style="margin:0;background:#000;display:flex;flex-wrap:wrap;width:${180 * 4}px">${imgs.map(s => `<img src="${s}" width="180" height="180">`).join('')}</body>`);
await new Promise(r => setTimeout(r, 300));
await p.setViewport({ width: 720, height: 180 * Math.ceil(imgs.length / 4) });
await p.screenshot({ path: out });
await b.close();
