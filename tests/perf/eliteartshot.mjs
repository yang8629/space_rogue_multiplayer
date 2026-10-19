// 新精英美術預覽：用 tools/art/build.html 載入的美術程式，把三種新精英（各種狀態）放大畫在一張圖上（右邊放虛空獵手對照大小）
//   用法：node perf/eliteartshot.mjs   → art_lab/screenshots/新精英_美術.png
import { GAME, SHOTS } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const out = SHOTS + '新精英_美術.png';
const b = await puppeteer.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: 'new', defaultViewport: { width: 1200, height: 420 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(GAME + 'tools/art/build.html');
await p.evaluate(() => {
  document.body.innerHTML = ''; document.body.style.margin = '0';
  const cv = document.createElement('canvas'); cv.width = 1200; cv.height = 420; document.body.appendChild(cv);
  const c = cv.getContext('2d'); c.fillStyle = '#05070f'; c.fillRect(0, 0, 1200, 420);
  const E = id => ENEMIES.find(e => e.id === id), K = 3.2;
  const at = (x, y, f) => { c.save(); c.translate(x, y); c.scale(K, K); f(c); c.restore(); };
  at(130, 120, c => drawArtillery(c, E('artillery').col, E('artillery').r, 0));
  at(130, 310, c => drawArtillery(c, E('artillery').col, E('artillery').r, 1));
  at(420, 120, c => drawTractor(c, E('tractor').col, E('tractor').r, 0, 0));
  at(420, 310, c => drawTractor(c, E('tractor').col, E('tractor').r, 2, 0.25));
  at(660, 120, c => drawTractor(c, E('tractor').col, E('tractor').r, 1, 0.5));
  at(900, 120, c => drawWing(c, E('wing').col, E('wing').r, 0));
  at(900, 310, c => drawWing(c, E('wing').col, E('wing').r, 1));
  at(1100, 210, c => drawElite(c, E('elite').col, E('elite').r * 0.8, 0));
});
await p.screenshot({ path: out });
await b.close();
console.log('存好', out);
