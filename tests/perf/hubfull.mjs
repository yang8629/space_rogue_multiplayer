// 整個基地一張圖（看整體配置：燈、門、窗的位置）→ art_lab/screenshots/基地_全景.png
//   視窗開到放得下整個基地（Hub.follow 的縮放上限 1.3，所以視窗 = 基地大小 × 1.3），鏡頭照 follow 置中
//   用法：node perf/hubfull.mjs
import { GAME, SHOTS, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1280, height: 800 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'index.html'); await new Promise(r => setTimeout(r, 2500));
const [w, h] = await p.evaluate(() => [Math.ceil(HUB.W * 1.3), Math.ceil((HUB.H + HUB.TOP) * 1.3)]);
await p.setViewport({ width: w, height: h });
await new Promise(r => setTimeout(r, 1500));
await p.evaluate(() => Hub.follow());
await new Promise(r => setTimeout(r, 400));
await p.screenshot({ path: SHOTS + '基地_全景.png' });
console.log('拍好 基地_全景', w, 'x', h);
await b.close();
