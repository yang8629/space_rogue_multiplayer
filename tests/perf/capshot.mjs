// 能量容量制的畫面截圖（2026-10-10）：選船（容量）、補給站（買容量的按鈕）、電路編輯器（能量 / 容量、超載）
//   用法：node perf/capshot.mjs <輸出資料夾>
import { GAME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1280, height: 720 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
const wait = ms => new Promise(r => setTimeout(r, ms));
await p.evaluate(() => { SFX.setMuted && SFX.setMuted(true); Screen.select('run'); });
await wait(300); await p.screenshot({ path: `${dir}/能量_選船.png` });
await p.evaluate(() => {
  Game.mode = 'run'; Game.newRun('run', 'vanguard', 'laser');
  Game.chain = ['weapon', 'orbit', 'boomerang', 'rear', null]; Game.credits = 300; Game.recalc();
  Game.node = { type: 'shop', L: 3, id: 'shot' }; Game.openShop();
});
await wait(300);
console.log('補給站', await p.evaluate(() => Game.state + ' ' + !!document.querySelector('[data-act="cap"]')));
await p.screenshot({ path: `${dir}/能量_補給站.png` });
await p.evaluate(() => { Game.state = 'map'; Game.toggleEditor(); });
await wait(400);
await p.screenshot({ path: `${dir}/能量_編輯器.png` });
console.log(await p.evaluate(() => `能量 ${Game.stats.heat} / 容量 ${Game.stats.cap}`));
await b.close();
