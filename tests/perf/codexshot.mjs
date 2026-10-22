// 電路總覽截圖（2026-10-13 說明拿掉舊內容）：數值圖表（拿掉「晶片等級與傷害倍率」）、機體與地圖（零件格數）
//   用法：node perf/codexshot.mjs <輸出資料夾>
import { GAME, CHROME } from './paths.mjs';
import puppeteer from 'puppeteer-core';
const dir = process.argv[2], url = GAME + 'index.html';
const b = await puppeteer.launch({ executablePath: CHROME, headless: 'new', defaultViewport: { width: 1400, height: 900 } });
const p = await b.newPage();
p.on('pageerror', e => console.log('頁面錯誤', e.message));
await p.goto(url); await new Promise(r => setTimeout(r, 1200));
for (const [tab, name] of [['charts', '數值圖表'], ['body', '機體與地圖']]) {
  const t0 = await p.evaluate(tab => { const t = performance.now(); Codex.open(tab); return performance.now() - t; }, tab);
  await new Promise(r => setTimeout(r, 500));
  const info = await p.evaluate(() => [...document.querySelectorAll('#codex h4, .viz h4')].map(h => h.textContent).join('｜'));
  console.log(name, `${Math.round(t0)}ms`, info.slice(0, 300));
  await p.screenshot({ path: `${dir}/電路總覽_${name}.png`, fullPage: false });
}
console.log('零件格說明：', await p.evaluate(() => (document.body.innerText.match(/零件格開局[^。]*。/) || ['（沒找到）'])[0]));
await b.close();
